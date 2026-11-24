"""Run ordered free and institutional sources from the installed paper-download skill."""
import contextlib, importlib.util, io, json, re, sys
from pathlib import Path
from urllib.parse import urlparse, quote
from openalex_sources import candidate_urls, matches_doi
from pdf_identity import verify_pdf
request=json.loads(sys.stdin.read());target=Path(request['output_dir']);target.mkdir(parents=True,exist_ok=True)
skill=Path(request['skill']);spec=importlib.util.spec_from_file_location('paper_download_runtime',skill)
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
attempts=[]

def attempt(name,operation,empty_detail='未发现可直接下载的 PDF'):
    try:
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            value=operation()
            if value:
                verify_pdf(value.pdf_path,target,request.get('doi') or '',request.get('title') or '')
        attempts.append({'source':name,'status':'ready' if value else 'not_available','detail':None if value else empty_detail})
        return value
    except Exception as exc:
        detail=re.sub(r'https?://\S+','[来源地址]',str(exc))
        attempts.append({'source':name,'status':'not_available','detail':detail[:240] or exc.__class__.__name__})
        return None

metadata=module.PaperMetadata(query=request['pmid'],pmid=request['pmid'],pmcid=request.get('pmcid') or None,doi=request.get('doi') or None,title=request.get('title'),pubmed_url='https://pubmed.ncbi.nlm.nih.gov/'+request['pmid']+'/')
session=module.make_session()
def prepared_pmc_download():
    url=request.get('prepared_pdf') or ''
    parsed=urlparse(url)
    if parsed.scheme!='https' or parsed.netloc!='pmc-oa-opendata.s3.amazonaws.com':
        return None
    if not parsed.path.startswith('/'+str(metadata.pmcid)+'.'):
        raise RuntimeError('PMC PDF 与论文标识不符')
    content=module.request_pdf(session,url)
    if not content:
        return None
    pdf=module.write_pdf(content,target/module.choose_pdf_name(metadata))
    return module.DownloadResult('pmc-cloud',pdf,url,metadata)
result=attempt('PMC 官方全文文件',prepared_pmc_download) if request.get('prepared_pdf') else None
if result is None:
    if metadata.doi:metadata.publisher_url=module.resolve_doi_landing_page(session,metadata.doi)
    result=attempt('PubMed / PMC 免费全文',lambda:module.download_via_pubmed(session,metadata,target))
def europe_pmc_download():
    response=module.http_get(session,'https://www.ebi.ac.uk/europepmc/webservices/rest/search',params={
        'query':'EXT_ID:'+request['pmid'],'format':'json','resultType':'core'
    },timeout=20)
    records=response.json().get('resultList',{}).get('result',[])
    record=next((item for item in records if str(item.get('pmid',''))==str(request['pmid'])),None)
    if record is None:
        raise RuntimeError('Europe PMC 未返回对应 PMID 记录')
    if request.get('pmcid') and record.get('pmcid') and record['pmcid'].casefold()!=request['pmcid'].casefold():
        raise RuntimeError('Europe PMC 返回的 PMCID 与论文记录不一致')
    if request.get('doi') and record.get('doi') and record['doi'].casefold()!=request['doi'].casefold():
        raise RuntimeError('Europe PMC 返回的 DOI 与论文记录不一致')
    if str(record.get('isOpenAccess','')).upper()!='Y':
        return None
    links=record.get('fullTextUrlList',{}).get('fullTextUrl',[])
    if isinstance(links,dict):links=[links]
    for entry in links:
        if str(entry.get('availabilityCode','')).upper() not in {'OA','F'}:
            continue
        url=entry.get('url')
        if not url:
            continue
        style=str(entry.get('documentStyle','')).lower()
        candidates=[url] if style=='pdf' or urlparse(url).path.lower().endswith('.pdf') or 'pdf=render' in url.lower() else []
        try:
            page=module.http_get(session,url,timeout=module.REQUEST_TIMEOUT)
            if 'text/html' in page.headers.get('content-type','').lower():
                candidates.extend(module.extract_pdf_urls_from_html(page.text,url))
        except Exception:
            pass
        for candidate in module.dedupe(candidates):
            content=module.request_pdf(session,candidate)
            if content:
                pdf=module.write_pdf(content,target/module.choose_pdf_name(metadata))
                return module.DownloadResult('europe-pmc',pdf,candidate,metadata)
    return None
if result is None:result=attempt('Europe PMC 开放全文',europe_pmc_download)
def openalex_download():
    response=module.http_get(session,'https://api.openalex.org/works/https://doi.org/'+quote(request['doi'],safe='/'),params={
        'select':'doi,open_access,locations',
    },timeout=20)
    work=response.json()
    if not matches_doi(work,request['doi']):
        raise RuntimeError('OpenAlex 未返回 DOI 完全匹配的论文')
    urls=candidate_urls(work,request['doi'])
    for candidate in urls:
        content=module.request_pdf(session,candidate)
        if content:
            pdf=module.write_pdf(content,target/module.choose_pdf_name(metadata))
            return module.DownloadResult('openalex-oa',pdf,candidate,metadata)
        try:
            page=module.http_get(session,candidate,timeout=module.REQUEST_TIMEOUT)
            if 'text/html' not in page.headers.get('content-type','').lower():
                continue
            for pdf_url in module.extract_pdf_urls_from_html(page.text,candidate):
                content=module.request_pdf(session,pdf_url)
                if content:
                    pdf=module.write_pdf(content,target/module.choose_pdf_name(metadata))
                    return module.DownloadResult('openalex-oa',pdf,pdf_url,metadata)
        except Exception:
            continue
    if urls:
        raise RuntimeError('找到了开放版本，但其链接当前未返回可下载的 PDF')
    return None
if result is None and metadata.doi:
    result=attempt('OpenAlex 开放获取版本',openalex_download,empty_detail='OpenAlex 未找到该 DOI 的开放全文 PDF')
if result is None:result=attempt('出版社页面 PDF',lambda:module.download_via_article_pdf_links(session,metadata,target,source='publisher-article-pdf'))
if result is None and module.url_looks_like_nature(metadata.publisher_url):result=attempt('Nature 机构访问',lambda:module.download_via_nature_institution(metadata,target,headless=True))
if result is None and module.url_looks_like_springerlink(metadata.publisher_url):result=attempt('Springer 机构访问',lambda:module.download_via_springer_institution(metadata,target,headless=True))
if result is not None:
    try:
        pdf=result.pdf_path.resolve()
        verified=verify_pdf(pdf,target,request.get('doi') or '',request.get('title') or '')
        print(json.dumps({'status':'ready','file_name':pdf.name,'source':result.source,'source_url':result.pdf_url,**verified,'attempts':attempts},ensure_ascii=False))
    except Exception:
        print(json.dumps({'status':'error','error':'下载文件未通过 PDF 文件或页面校验。','attempts':attempts},ensure_ascii=False))
else:
    note=target/'manual-handoff.json'
    handoff=json.loads(note.read_text()) if note.exists() else {}
    url=handoff.get('publisher_url') or metadata.publisher_url or ('https://doi.org/'+metadata.doi if metadata.doi else metadata.pubmed_url)
    status='needs_browser' if metadata.publisher_url or metadata.pmcid else 'unavailable'
    error='自动来源未取得有效 PDF，可能需要浏览器验证或机构订阅。' if status=='needs_browser' else '未找到可自动获取的开放全文 PDF。'
    print(json.dumps({'status':status,'error':error,'handoff_url':url,'attempts':attempts},ensure_ascii=False))
