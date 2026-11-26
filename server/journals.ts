import {readFileSync} from 'node:fs';
import type {DB} from './core.ts';
import {impactComparator,passesImpact,type ImpactOperator,type ImpactThreshold} from '../shared/impact.ts';

type Journal = {
  name: string;
  issns: string[];
  impact_factor: number | null;
  jif_label: string;
  jif_status?: 'suppressed' | 'no_catalog_jif';
  categories: Record<string, string>;
  cas_zone: number | null;
  source: string;
};
const catalog = JSON.parse(readFileSync(new URL('../assets/journals/catalog.json', import.meta.url), 'utf8')) as {
  edition: number;
  jif_year: number;
  reload_date: string;
  reload_applied: number;
  nature_verified: number;
  suppressed_count: number;
  supplemental_count: number;
  nature_portfolio: string[];
  journals: Journal[];
};
export const journalKey = (name: string) => name.toLowerCase().replaceAll('&', ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const issnKey = (value: string) => {
  const id = value.trim().replace('-', '').toUpperCase();
  return /^\d{7}[0-9X]$/.test(id) ? id : '';
};
const formatIssn = (id: string) => id.slice(0, 4) + '-' + id.slice(4);
const names = new Map<string, Journal[]>();
const issns = new Map<string, Journal[]>();
for (const record of catalog.journals) {
  const name = journalKey(record.name);
  names.set(name, [...(names.get(name) || []), record]);
  for (const id of record.issns) issns.set(id, [...(issns.get(id) || []), record]);
}
const idsByJournal = new Map<Journal, string>();
const journalsById = new Map<string, Journal>();
for (const journal of catalog.journals) {
  const id = journal.issns.find(id => issns.get(id)?.length === 1);
  if (id) {
    idsByJournal.set(journal, id);
    journalsById.set(id, journal);
  }
}

function journalRecord(name: string, ids: string[] = []) {
  const exact = [...new Set(ids.flatMap(id => issns.get(issnKey(id)) || []))];
  const candidates = exact.length ? exact : names.get(journalKey(name)) || (journalAliases.get(journalKey(name)) ? issns.get(journalAliases.get(journalKey(name))!) || [] : []);
  return {
    record: candidates.length === 1 ? candidates[0] : null,
    match: candidates.length === 1 ? (exact.length ? 'issn' : 'title') : (candidates.length ? 'ambiguous' : 'unmatched'),
  };
}
export function matchJournal(name: string, ids: string[] = []) {
  const {record, match} = journalRecord(name, ids);
  return {
    impact_factor: record?.impact_factor ?? null,
    jif_label: record?.jif_label || '',
    jif_status: record?.jif_status || '',
    journal_id: record ? idsByJournal.get(record) || '' : '',
    cas_zone: record?.cas_zone ?? null,
    metric_match: match,
    metric_journal: record?.name || '',
    metric_source: record?.source || '',
    metric_year: record && record.jif_status !== 'no_catalog_jif' ? catalog.jif_year : null,
    metric_edition: record && record.jif_status !== 'no_catalog_jif' ? catalog.edition : null,
  };
}
export function enrichPaper(db: DB, id: string) {
  const paper = db.prepare('SELECT journal,journal_issns FROM papers WHERE id=?').get(id);
  if (!paper) return;
  const result = matchJournal(String(paper.journal), JSON.parse(String(paper.journal_issns)));
  db.prepare(`UPDATE papers SET impact_factor=?,jif_label=?,jif_status=?,journal_id=?,cas_zone=?,metric_match=?,
    metric_journal=?,metric_source=?,metric_year=?,metric_edition=? WHERE id=?`).run(
    result.impact_factor, result.jif_label, result.jif_status, result.journal_id, result.cas_zone, result.metric_match,
    result.metric_journal, result.metric_source, result.metric_year, result.metric_edition, id,
  );
}
export function enrichLibrary(db: DB) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const paper of db.prepare('SELECT id FROM papers').all()) enrichPaper(db, String(paper.id));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export type JournalFilter = {threshold: ImpactThreshold | null; ids: string[]};

export function journalFilter(db: DB): JournalFilter {
  const rows = db.prepare("SELECT key,value FROM settings WHERE key IN ('min_impact_factor','min_impact_operator','journal_filter_ids')").all();
  const values = new Map(rows.map(row => [String(row.key), String(row.value)]));
  const min = values.get('min_impact_factor');
  const op: ImpactOperator = values.get('min_impact_operator') === 'gt' ? 'gt' : 'gte';
  const threshold = min === undefined || min === '' ? null : {value:Number(min),operator:op};
  return {threshold, ids:JSON.parse(values.get('journal_filter_ids') || '[]')};
}
export function journalWhere(db: DB, alias = 'p') {
  const {threshold, ids} = journalFilter(db);
  const predicates: string[] = [];
  if (threshold !== null) {
    const exact = `${alias}.impact_factor ${impactComparator(threshold.operator)} ${threshold.value}`;
    const includesBelowReportingLimit = threshold.operator === 'gte' && threshold.value === 0;
    predicates.push(includesBelowReportingLimit ? `(${exact} OR ${alias}.jif_label='<0.1')` : exact);
  }
  if (ids.length) predicates.push(`${alias}.journal_id IN (
    SELECT value FROM json_each((SELECT value FROM settings WHERE key='journal_filter_ids'))
  )`);
  return predicates.join(' AND ') || '1=1';
}
export function mailboxJournalWhere(db:DB) {
  return `(p.manual_added=1 OR (${journalWhere(db)}))`;
}
export function passesJournal(record: ReturnType<typeof matchJournal>, {threshold, ids}: JournalFilter) {
  return passesImpact(record, threshold) && (!ids.length || ids.includes(record.journal_id));
}
export function eligibleJournalIssns(min: number | null, ids: string[] = [], operator:ImpactOperator = 'gte') {
  const selected = new Set(ids);
  const threshold = min === null ? null : {value:min,operator};
  return [...issns].filter(([, records]) => {
    if (records.length !== 1) return false;
    const record = records[0];
    return (!selected.size || selected.has(idsByJournal.get(record) || '')) && passesImpact(record, threshold);
  }).map(([id]) => formatIssn(id));
}
export function journalRestriction(query: string, min: number | null) {
  if (min === null) return query;
  const eligible = eligibleJournalIssns(min).map(id => id + '[Journal]');
  if (!eligible.length) throw new Error('影响因子资料中没有达到此阈值的期刊，请调整筛选值');
  return `(${query}) AND (${eligible.join(' OR ')})`;
}
export function requireJournalIds(ids: string[]) {
  const unknown = ids.filter(id => !journalsById.has(id));
  if (unknown.length) throw new Error('期刊目录没有匹配的 ISSN：' + unknown.map(formatIssn).join('、'));
  return [...new Set(ids)];
}
function journalOption(record: Journal) {
  return {id: idsByJournal.get(record)!, name: record.name, issns: record.issns.map(formatIssn), impact_factor: record.impact_factor, jif_label: record.jif_label, jif_status: record.jif_status || ''};
}
export function journalOptions(ids: string[]) {
  return ids.map(id => journalsById.get(id)).filter((record): record is Journal => !!record).map(journalOption);
}
const journalAliases = new Map(Object.entries({
  nejm: '00284793', jama: '00987484', bmj: '17561833', lancet: '01406736',
  'the bmj': '17561833', 'the lancet': '01406736',
  'new england journal of medicine': '00284793',
}));
export function resolveJournal(value: string) {
  const identifier = issnKey(value) || journalAliases.get(journalKey(value));
  const result = identifier ? journalRecord('', [identifier]) : journalRecord(value);
  return result.record ? idsByJournal.get(result.record) : undefined;
}
export function searchJournals(query: string) {
  const exact = resolveJournal(query);
  const name = journalKey(query);
  const matches = exact ? [exact] : [];
  if (name) {
    for (const [id, record] of journalsById) {
      if (id !== exact && journalKey(record.name).includes(name)) matches.push(id);
      if (matches.length >= 24) break;
    }
  }
  return journalOptions(matches);
}
export const journalCategories = [...new Set(catalog.journals.flatMap(journal => Object.keys(journal.categories)))].sort();
const cellPress = [
  'Cell', 'Cancer Cell', 'Cell Biomaterials', 'Cell Chemical Biology', 'Cell Genomics', 'Cell Host & Microbe',
  'Cell Metabolism', 'Cell Reports', 'Cell Reports Medicine', 'Cell Reports Methods', 'Cell Reports Physical Science',
  'Cell Stem Cell', 'Cell Systems', 'Chem', 'Chem Catalysis', 'Current Biology', 'Developmental Cell', 'Immunity',
  'iScience', 'Joule', 'Matter', 'Molecular Cell', 'Neuron', 'One Earth', 'Patterns', 'Structure',
  'Trends in Biochemical Sciences', 'Trends in Biotechnology', 'Trends in Cancer', 'Trends in Cell Biology',
  'Trends in Chemistry', 'Trends in Cognitive Sciences', 'Trends in Ecology & Evolution', 'Trends in Endocrinology & Metabolism',
  'Trends in Genetics', 'Trends in Immunology', 'Trends in Microbiology', 'Trends in Molecular Medicine',
  'Trends in Neurosciences', 'Trends in Parasitology', 'Trends in Pharmacological Sciences', 'Trends in Plant Science',
];
const scienceFamily = ['Science', 'Science Advances', 'Science Signaling', 'Science Translational Medicine', 'Science Immunology', 'Science Robotics'];
export const journalGroups = {
  cns: [...cellPress, ...catalog.nature_portfolio, ...scienceFamily],
  cell_family: cellPress,
  nature_family: catalog.nature_portfolio,
  science_family: scienceFamily,
  medical_four: ['NEJM', 'The Lancet', 'JAMA', 'The BMJ'],
};
export function categoryJournals(category: string, q1Only: boolean) {
  return [...journalsById].filter(([, journal]) => {
    const quartile = journal.categories[category];
    return quartile && (!q1Only || quartile === 'Q1');
  }).map(([id]) => id);
}
export const journalInfo = {
  edition: catalog.edition, jif_year: catalog.jif_year, count: catalog.journals.length,
  reload_date: catalog.reload_date, reload_applied: catalog.reload_applied,
  nature_verified: catalog.nature_verified, supplemental_count: catalog.supplemental_count,
  suppressed_count: catalog.suppressed_count, jcr_count: catalog.journals.length - catalog.supplemental_count,
};
