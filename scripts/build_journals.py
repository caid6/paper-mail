"""Build the 2025 JIF catalog from the June workbook and Clarivate's October reload."""
import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from bs4 import BeautifulSoup
from openpyxl import load_workbook

BASE = Path(__file__).resolve().parents[1] / 'assets/journals'
BASE_URL = 'https://www.sciencepub.cn/download/'
RELOAD_URL = 'https://journalcitationreports.zendesk.com/hc/en-gb/articles/47808147130129-2026'
SUPPRESSIONS_URL = 'https://journalcitationreports.zendesk.com/hc/en-gb/articles/28351398819089-Title-Suppressions'
NATURE_URL = 'https://www.nature.com/nature-portfolio/about-journals/journal-metrics'

def key(name):
    name = str(name or '').lower().replace('&', ' and ')
    return re.sub(r'[^a-z0-9]+', ' ', re.sub(r"['’]", '', name)).strip()

def issn(value):
    compact = str(value or '').strip().replace('-', '').upper()
    return compact if re.fullmatch(r'\d{7}[\dX]', compact) else ''

def jif(value):
    value = str(value or '').strip()
    if value == '<0.1':
        return None, value
    if not value or value.upper() in {'N/A', 'NOT AVAILABLE', 'SUPPRESSED', '—', '-'}:
        return None, ''
    return float(value), ''

def workbook_rows(path):
    sheet = load_workbook(path, read_only=True, data_only=True).active
    header = next(sheet.iter_rows(min_row=3, max_row=3, values_only=True))
    if tuple(header[:8]) != ('期刊名', 'ISSN号', 'eISSN号', 'Wos学科信息', '引用索引版本', '总引用', '2025影响因子', '分区'):
        raise ValueError('Expected the June 2026 workbook with a 2025 JIF column')
    records = {}
    for name, print_issn, eissn, category, _, _, value, quartile in sheet.iter_rows(min_row=4, values_only=True):
        if not name:
            continue
        name = str(name).strip()
        ids = list(dict.fromkeys(v for v in map(issn, (print_issn, eissn)) if v))
        identity = (name, tuple(ids))
        factor, label = jif(value)
        row = records.setdefault(identity, {
            'name': name, 'issns': ids, 'impact_factor': factor, 'jif_label': label,
            'categories': {}, 'cas_zone': None, 'source': '2026 JCR 6 月发布数据',
        })
        if (row['impact_factor'], row['jif_label']) != (factor, label):
            raise ValueError(f'Conflicting June JIF for {identity}')
        if category and quartile in {'Q1', 'Q2', 'Q3', 'Q4'}:
            if category in row['categories'] and row['categories'][category] != quartile:
                raise ValueError(f'Conflicting quartile for {identity} in {category}')
            row['categories'][category] = quartile
    if len(records) != 22643:
        raise ValueError(f'Expected 22643 journals in June 2026, got {len(records)}')
    return list(records.values())

def apply_reload(records, path):
    article = json.loads(path.read_text())['article']
    if article['html_url'] != RELOAD_URL or not article['updated_at'].startswith('2026-10-14'):
        raise ValueError('Expected the official October 14, 2026 reload')
    soup = BeautifulSoup(article['body'], 'html.parser')
    table = next(table for table in soup.find_all('table') if 'Reload JIF' in table.get_text() and 'June JIF' in table.get_text())
    names = defaultdict(list)
    for row in records:
        names[key(row['name'])].append(row)
    applied, unresolved, differences = 0, [], []
    for tr in table.find_all('tr')[1:]:
        _, name, value, june = [td.get_text(strip=True) for td in tr.find_all('td')]
        candidates = names[key(name)]
        if len(candidates) == 1:
            target = candidates[0]
            factor, label = jif(value)
            if (target['impact_factor'], target['jif_label']) not in (jif(june), (factor, label)):
                differences.append((name, target["impact_factor"], june))
            target.update(impact_factor=factor, jif_label=label, source='Clarivate 2026-10-14 修正')
            applied += 1
        else:
            unresolved.append(name)
    return applied, unresolved, differences

def mark_suppressions(records, path):
    article = json.loads(path.read_text())['article']
    if article['html_url'] != SUPPRESSIONS_URL:
        raise ValueError('Expected the Clarivate title suppressions article')
    soup = BeautifulSoup(article['body'], 'html.parser')
    heading = soup.find('h2', string=re.compile(r'Suppressed from 2025 JCR Data'))
    if not heading:
        raise ValueError('Expected suppressions for 2025 JIF')
    names = {key(tr.select('td')[1].get_text(' ', strip=True))
             for tr in heading.find_next('table').select('tr')[1:]}
    matched = set()
    for row in records:
        name = key(row['name'])
        if name not in names:
            continue
        if row['impact_factor'] is not None or row['jif_label']:
            raise ValueError(f'Suppressed journal has a JIF: {row["name"]}')
        row.update(jif_status='suppressed', source='Clarivate 2025 JIF 暂停公布名录')
        matched.add(name)
    if matched != names:
        raise ValueError(f'Suppression list contains unknown journals: {names - matched}')
    return len(matched)

def audit_nature(records, path):
    soup = BeautifulSoup(path.read_text(), 'html.parser')
    peer_review = soup.find('h2', string=re.compile(r'2025\s+Peer Review Metrics'))
    metric_heading = soup.find('h2', string=re.compile(r'2025\s+Journal Metrics'))
    if not peer_review or not metric_heading:
        raise ValueError('Expected the 2025 Nature metrics page')
    tables = soup.select('table')
    review_tables = [table for table in tables if table.find_previous('h2') == peer_review]
    metric_tables = [table for table in tables if table.find_previous('h2') == metric_heading]
    titles = {tr.select_one('td a').get_text(' ', strip=True)
              for table in review_tables for tr in table.select('tr') if tr.select_one('td a')}
    by_name = defaultdict(list)
    for row in records:
        by_name[key(row['name'])].append(row)
    verified = set()
    for table in metric_tables:
        header, *rows = [tr.select('td,th') for tr in table.select('tr')]
        if header[1].get_text(' ', strip=True) != 'Journal Impact Factor':
            raise ValueError('Unexpected Nature JIF column')
        for cells in rows:
            if not cells:
                continue
            name = cells[0].get_text(' ', strip=True)
            factor, label = jif(cells[1].get_text(' ', strip=True))
            if factor is None and not label:
                continue
            candidates = by_name[key(name)]
            if len(candidates) != 1 or (candidates[0]['impact_factor'], candidates[0]['jif_label']) != (factor, label):
                raise ValueError(f'Nature and JCR differ for {name}: {factor}, {label}')
            verified.add(name)
    if not titles or not verified:
        raise ValueError('Nature portfolio source is empty')
    return sorted(titles), len(verified)

def add_verified_identities(records, path):
    used_issns = {identifier for row in records for identifier in row['issns']}
    names = {key(row['name']) for row in records}
    entries = json.loads(path.read_text())
    for entry in entries:
        identifiers = [issn(value) for value in entry['issns']]
        name = key(entry['name'])
        if name in names or not identifiers or not all(identifiers) or used_issns.intersection(identifiers):
            raise ValueError(f'Conflicting supplemental journal identity: {entry["name"]}')
        used_issns.update(identifiers)
        names.add(name)
        records.append({'name': entry['name'], 'issns': identifiers, 'impact_factor': None,
                        'jif_label': '', 'jif_status': 'no_catalog_jif', 'categories': {},
                        'cas_zone': None, 'source': entry['url']})
    return len(entries)

def build(args):
    records = workbook_rows(args.workbook)
    applied, unresolved, differences = apply_reload(records, args.reload)
    cas = next(BASE.glob('2025中科院期刊分区表*.xlsx'))
    zone_sheet = load_workbook(cas, read_only=True, data_only=True)['完整表格']
    zones = {key(r[0]): int(r[1]) for r in zone_sheet.iter_rows(min_row=2, values_only=True) if r[0] and str(r[1]) in ('1','2','3','4')}
    for row in records:
        row['cas_zone'] = zones.get(key(row['name']))
    suppressions = mark_suppressions(records, args.suppressions)
    nature_titles, nature_verified = audit_nature(records, args.nature)
    supplemental = BASE / 'supplemental-identities.json'
    supplemental_count = add_verified_identities(records, supplemental)
    sources = [{'url': url, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file, url in
               [(args.workbook, BASE_URL), (args.reload, RELOAD_URL), (args.nature, NATURE_URL),
                (args.suppressions, SUPPRESSIONS_URL), (supplemental, None)]]
    catalog = {'edition': 2026, 'jif_year': 2025, 'reload_date': '2026-10-14',
               'reload_applied': applied, 'reload_unresolved': unresolved, 'june_discrepancies': differences,
               'sources': sources, 'nature_portfolio': nature_titles, 'nature_verified': nature_verified,
               'suppressed_count': suppressions, 'supplemental_count': supplemental_count, 'journals': records}
    (BASE / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(records)} identities including {supplemental_count} supplemental. {applied} corrections, {suppressions} suppressions, {nature_verified} publisher JIF cross-checks. Unresolved reload: {unresolved}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('workbook', 'reload', 'nature', 'suppressions'):
        parser.add_argument(option, type=Path)
    build(parser.parse_args())
