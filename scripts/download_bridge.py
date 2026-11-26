"""Download and verify public PDF copies for Paper-mail."""
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener

import certifi

from openalex_sources import candidate_urls, matches_doi
from pdf_identity import verify_pdf

MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_METADATA_BYTES = 4 * 1024 * 1024
PUBLIC_HOSTS = (
    'doi.org', 'ncbi.nlm.nih.gov', 'europepmc.org', 'ebi.ac.uk',
    'pmc-oa-opendata.s3.amazonaws.com', 'api.openalex.org',
    'nature.com', 'springer.com', 'springernature.com', 'biomedcentral.com',
    'bmj.com', 'oup.com', 'oxfordjournals.org', 'plos.org', 'frontiersin.org',
    'wiley.com', 'sciencedirect.com', 'elsevier.com', 'cell.com', 'thelancet.com',
    'jamanetwork.com', 'nejm.org', 'science.org', 'pnas.org', 'tandfonline.com',
    'sagepub.com', 'cambridge.org', 'mdpi.com', 'elifesciences.org',
)


def public_url(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    return (
        parsed.scheme == 'https' and not parsed.username and not parsed.password
        and parsed.port in (None, 443)
        and any(host == domain or host.endswith('.' + domain) for domain in PUBLIC_HOSTS)
    )


class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not public_url(newurl):
            raise ValueError('重定向目标超出支持的公开全文来源')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, accept, limit):
    if not public_url(url):
        raise ValueError('该来源需通过浏览器打开')
    opener = build_opener(PublicRedirect(), HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    request = Request(url, headers={'User-Agent': 'Paper-mail/2.15 (public academic PDF reader)', 'Accept': accept})
    with opener.open(request, timeout=15) as response:
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError('响应超过文件大小上限')
        return response.geturl(), data


class CitationMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.pdf_urls = []

    def handle_starttag(self, tag, attrs):
        if tag == 'meta':
            fields = dict(attrs)
            if str(fields.get('name')).lower() == 'citation_pdf_url' and fields.get('content'):
                self.pdf_urls.append(fields['content'])


def pmc_candidates(pmcid, prepared_pdf):
    if not re.fullmatch(r'PMC\d+', pmcid):
        return []
    candidates = []
    prepared = urlsplit(prepared_pdf)
    if (prepared.scheme == 'https' and prepared.netloc == 'pmc-oa-opendata.s3.amazonaws.com'
            and not prepared.fragment and re.fullmatch(rf'/{pmcid}\.\d+/[^/]+\.pdf', prepared.path)):
        candidates.append(prepared_pdf)
    return candidates + [f'https://europepmc.org/articles/{pmcid}?pdf=render',
                              f'https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/']


def europe_pmc_candidates(pmid, pmcid, doi):
    query = urlencode({'query': f'EXT_ID:{pmid} AND SRC:MED', 'format':'json', 'resultType':'core'})
    endpoint = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + query
    _, data = fetch(endpoint, 'application/json', MAX_METADATA_BYTES)
    records = json.loads(data).get('resultList', {}).get('result', [])
    record = next((item for item in records if str(item.get('pmid')) == pmid), {})
    if not record or (doi and record.get('doi') and record['doi'].casefold() != doi.casefold()):
        return []
    if pmcid and record.get('pmcid') and record['pmcid'] != pmcid:
        return []
    links = record.get('fullTextUrlList', {}).get('fullTextUrl', [])
    if isinstance(links, dict):
        links = [links]
    return [entry['url'] for entry in links
            if entry.get('url') and entry.get('availabilityCode') in ('OA', 'F')]


def openalex_candidates(doi):
    endpoint = 'https://api.openalex.org/works/https://doi.org/' + quote(doi, safe='/')
    query = {'select':'doi,locations'}
    if key := os.environ.get('OPENALEX_API_KEY'):
        query['api_key'] = key
    _, data = fetch(endpoint + '?' + urlencode(query), 'application/json', MAX_METADATA_BYTES)
    work = json.loads(data)
    return candidate_urls(work, doi) if matches_doi(work, doi) else []


def retrieve(url, target, doi, title, seen):
    if url in seen:
        return None
    seen.add(url)
    final_url, data = fetch(url, 'application/pdf,text/html', MAX_PDF_BYTES)
    if urlsplit(url).hostname == 'pmc-oa-opendata.s3.amazonaws.com':
        checksums = parse_qs(urlsplit(url).query).get('md5', [])
        if checksums and checksums != [hashlib.md5(data, usedforsecurity=False).hexdigest()]:
            raise ValueError('PMC 文件与官方清单的校验值不一致')
    candidates = [(final_url, data)] if data.startswith(b'%PDF-') else []
    if not candidates and len(data) <= MAX_METADATA_BYTES:
        metadata = CitationMetadata()
        metadata.feed(data.decode('utf-8', errors='replace'))
        for candidate in dict.fromkeys(urljoin(final_url, link) for link in metadata.pdf_urls):
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                pdf_url, pdf = fetch(candidate, 'application/pdf', MAX_PDF_BYTES)
                if pdf.startswith(b'%PDF-'):
                    candidates.append((pdf_url, pdf))
            except (OSError, ValueError):
                continue
    for pdf_url, pdf in candidates:
        temporary = target / 'download.part'
        temporary.write_bytes(pdf)
        try:
            verified = verify_pdf(temporary, target, doi, title)
            temporary.replace(target / 'article.pdf')
            return {'status':'ready', 'file_name':'article.pdf', 'source_url':pdf_url, **verified}
        finally:
            temporary.unlink(missing_ok=True)
    return None


def download(request):
    pmid = str(request.get('pmid') or '')
    pmcid = request.get('pmcid') or ''
    doi = request.get('doi') or ''
    if (pmid and not re.fullmatch(r'\d+', pmid)) or not (pmid or doi):
        raise ValueError('缺少有效的论文标识符')
    title = request.get('title') or ''
    target = Path(request['output_dir'])
    target.mkdir(parents=True, exist_ok=True)
    prepared_pdf = request.get('prepared_pdf') or ''
    attempts = []
    landing = 'https://doi.org/' + quote(doi, safe='/') if doi else 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/'
    sources = []
    if pmid:
        sources.extend([
            ('PubMed Central', lambda: pmc_candidates(pmcid, prepared_pdf)),
            ('Europe PMC', lambda: europe_pmc_candidates(pmid, pmcid, doi)),
        ])
    if doi:
        sources.extend([
            ('出版社公开全文', lambda: [request.get('publisher_pdf'), landing]),
            ('OpenAlex', lambda: openalex_candidates(doi)),
        ])
    seen = set()
    for source, candidates in sources:
        detail = '没有找到通过身份校验的公开 PDF'
        try:
            urls = candidates()
        except HTTPError as error:
            detail, urls = f'来源返回 HTTP {error.code}', []
        except (OSError, ValueError):
            detail, urls = '获取来源记录时遇到网络或格式错误', []
        for url in urls:
            if not url or not public_url(url):
                continue
            try:
                result = retrieve(url, target, doi, title, seen)
                if result:
                    attempts.append({'source':source, 'status':'ready', 'detail':None})
                    return {**result, 'source':source, 'attempts':attempts}
            except HTTPError as error:
                detail = f'文件来源返回 HTTP {error.code}'
            except (URLError, TimeoutError):
                detail = '公开来源暂时无法连接'
            except ValueError as error:
                detail = str(error)
            except Exception:
                detail = '文件无法通过 PDF 解析和身份校验'
        attempts.append({'source':source, 'status':'not_available', 'detail':detail})
    if pmid and (skill := request.get('skill')):
        try:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name('download_with_skill.py'))],
                input=json.dumps(request), text=True, capture_output=True, check=True, timeout=90,
            )
            output = json.loads(result.stdout)
            return {**output, 'attempts':attempts + output.get('attempts', [])}
        except (OSError, ValueError, subprocess.SubprocessError):
            attempts.append({'source':'本机机构下载器', 'status':'not_available', 'detail':'请检查本机下载器及其依赖'})
    return {'status':'needs_browser', 'error':'未取得可直接下载的公开 PDF，可打开原文或上传 PDF。',
            'handoff_url':landing, 'attempts':attempts}


if __name__ == '__main__':
    print(json.dumps(download(json.load(sys.stdin)), ensure_ascii=False))
