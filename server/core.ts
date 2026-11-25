import { DatabaseSync } from 'node:sqlite';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import {enrichPaper} from './journals.ts';

export {pubmedDefaults as defaults} from './pubmed.ts';
import {pubmedDefaults as defaults} from './pubmed.ts';
export type Subscription = {id:string;name:string;color:string;query:string;enabled:number;description:string;query_explanation:string};
export type PaperInput = {id:string;title:string;abstract:string;authors:string[];published:string;updated:string;categories:string[];url:string;pdf_url:string;source?:string;journal?:string;publication_date?:string;indexed_at?:string;doi?:string;pmcid?:string;pub_types?:string[];full_text_url?:string;journal_issns?:string[]};
export type Paper = PaperInput & {title_zh:string|null;title_status:string;title_error:string|null;received_at:string;is_read:number;starred:number;archived:number;archive_origin:'manual'|'quality'|'legacy'|null;in_library:number;note:string;digest_status:string;digest_error:string|null;digest:Digest|null;subscriptions:Subscription[];quality_reviews:any[]};
export const digestSchema=z.object({
  title_zh:z.string().min(1), one_liner:z.string().min(1), summary:z.string().min(1),
  problem:z.string().min(1), method:z.string().min(1), findings:z.array(z.string().min(1)).min(1).max(6),
  limitations:z.array(z.string().min(1)).min(1).max(5), reading_advice:z.string().min(1),
});
export type Digest=z.infer<typeof digestSchema>;
export function connect(path:string) {
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,query TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY,title TEXT NOT NULL,abstract TEXT NOT NULL,authors TEXT NOT NULL,published TEXT NOT NULL,updated TEXT NOT NULL,categories TEXT NOT NULL,url TEXT NOT NULL,pdf_url TEXT NOT NULL,received_at TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,starred INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',digest TEXT,digest_status TEXT NOT NULL DEFAULT 'pending',digest_error TEXT,digest_model TEXT,digest_at TEXT);
    CREATE TABLE IF NOT EXISTS paper_subscriptions(paper_id TEXT REFERENCES papers(id) ON DELETE CASCADE,subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,PRIMARY KEY(paper_id,subscription_id));
    CREATE TABLE IF NOT EXISTS relevance_reviews(paper_id TEXT REFERENCES papers(id) ON DELETE CASCADE,subscription_id TEXT REFERENCES subscriptions(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',verdict TEXT,reason TEXT NOT NULL DEFAULT '',evidence TEXT NOT NULL DEFAULT '',model TEXT,reviewed_at TEXT,error TEXT,PRIMARY KEY(paper_id,subscription_id));
    CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,started_at TEXT NOT NULL,finished_at TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,added INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE INDEX IF NOT EXISTS papers_received ON papers(received_at DESC);
    CREATE INDEX IF NOT EXISTS papers_digest ON papers(digest_status);
    CREATE INDEX IF NOT EXISTS papers_inbox_order ON papers(archived,published DESC,id DESC);
    CREATE INDEX IF NOT EXISTS papers_unread_order ON papers(archived,is_read,published DESC,id DESC);
    CREATE INDEX IF NOT EXISTS paper_subscriptions_by_topic ON paper_subscriptions(subscription_id,paper_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS relevance_reviews_status ON relevance_reviews(status,paper_id);
    INSERT OR IGNORE INTO relevance_reviews(paper_id,subscription_id,status)
      SELECT ps.paper_id,ps.subscription_id,'pending' FROM paper_subscriptions ps;`);
  const columns=new Set(db.prepare('PRAGMA table_info(papers)').all().map(c=>String(c.name)));
  if(!columns.has('in_library'))db.exec('ALTER TABLE papers ADD COLUMN in_library INTEGER NOT NULL DEFAULT 1');
  if(!columns.has('archive_origin')){
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE papers ADD COLUMN archive_origin TEXT CHECK (archive_origin IN ('manual','quality','legacy'));
      UPDATE papers SET archive_origin='legacy' WHERE archived=1;
      COMMIT;`);
  }
  for(const [name,def] of Object.entries({source:"TEXT NOT NULL DEFAULT 'arxiv'",journal:"TEXT NOT NULL DEFAULT ''",publication_date:"TEXT NOT NULL DEFAULT ''",indexed_at:"TEXT NOT NULL DEFAULT ''",doi:"TEXT NOT NULL DEFAULT ''",pmcid:"TEXT NOT NULL DEFAULT ''",pub_types:"TEXT NOT NULL DEFAULT '[]'",full_text_url:"TEXT NOT NULL DEFAULT ''"}))if(!columns.has(name))db.exec(`ALTER TABLE papers ADD COLUMN ${name} ${def}`);
  for(const [name,def] of Object.entries({journal_issns:"TEXT NOT NULL DEFAULT '[]'",journal_id:"TEXT NOT NULL DEFAULT ''",jif_label:"TEXT NOT NULL DEFAULT ''",jif_status:"TEXT NOT NULL DEFAULT ''",impact_factor:'REAL',cas_zone:'INTEGER',metric_match:"TEXT NOT NULL DEFAULT 'unmatched'",metric_journal:"TEXT NOT NULL DEFAULT ''",metric_source:"TEXT NOT NULL DEFAULT ''",metric_year:'INTEGER',metric_edition:'INTEGER'}))if(!columns.has(name))db.exec(`ALTER TABLE papers ADD COLUMN ${name} ${def}`);
  for(const [name,def] of Object.entries({title_zh:'TEXT',title_status:"TEXT NOT NULL DEFAULT 'pending'",title_error:'TEXT'}))if(!columns.has(name))db.exec(`ALTER TABLE papers ADD COLUMN ${name} ${def}`);
  db.exec("UPDATE papers SET title_zh=json_extract(digest,'$.title_zh'),title_status='ready',title_error=NULL WHERE digest IS NOT NULL AND title_zh IS NULL AND json_valid(digest) AND json_type(digest,'$.title_zh')='text'");
  db.exec(`CREATE INDEX IF NOT EXISTS papers_impact ON papers(impact_factor,archived,published);
    CREATE TABLE IF NOT EXISTS downloads(paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',source TEXT,source_url TEXT,file_name TEXT,error TEXT,handoff_url TEXT,created_at TEXT NOT NULL,completed_at TEXT);`);
  const downloadColumns=new Set(db.prepare('PRAGMA table_info(downloads)').all().map(c=>String(c.name)));
  for(const [name,definition] of Object.entries({attempts:"TEXT NOT NULL DEFAULT '[]'",automatic:'INTEGER NOT NULL DEFAULT 0',index_error:'TEXT'})){
    if(!downloadColumns.has(name))db.exec(`ALTER TABLE downloads ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE downloads SET status='pending' WHERE status='running'");
  db.prepare("UPDATE downloads SET status='pending',error=NULL,completed_at=NULL WHERE status='unavailable' AND error IN (?,?)").run(
    '本机自动下载器不可用，请上传原文 PDF',
    'PDF 环境未就绪。请在项目目录运行 npm run setup:python，再重启 Paper-mail。'
  );
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_documents(
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,file_name TEXT NOT NULL,page_count INTEGER NOT NULL,pages TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS paper_chats(
    id INTEGER PRIMARY KEY AUTOINCREMENT,paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS paper_chats_document ON paper_chats(paper_id,sha256,id);`);
  const topicColumns=new Set(db.prepare('PRAGMA table_info(subscriptions)').all().map(c=>String(c.name)));
  for(const name of ['description','query_explanation'])if(!topicColumns.has(name))db.exec(`ALTER TABLE subscriptions ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE TABLE IF NOT EXISTS fulltexts(paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'idle',error TEXT,source_url TEXT,license TEXT,pdf_url TEXT,fetched_at TEXT);
  CREATE TABLE IF NOT EXISTS figures(id TEXT PRIMARY KEY,paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,position INTEGER NOT NULL,label TEXT NOT NULL,caption TEXT NOT NULL,context TEXT NOT NULL,alt TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL,image_path TEXT NOT NULL DEFAULT '',image_type TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',analysis TEXT,error TEXT,model TEXT,generated_at TEXT,origin TEXT NOT NULL DEFAULT 'pmc',source_page INTEGER);
  CREATE TABLE IF NOT EXISTS pdf_figure_indexes(paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,sha256 TEXT NOT NULL,status TEXT NOT NULL,error TEXT,extracted_at TEXT);
  CREATE TABLE IF NOT EXISTS publisher_figure_indexes(paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,fingerprint TEXT NOT NULL,status TEXT NOT NULL,error TEXT,fetched_at TEXT);
  CREATE INDEX IF NOT EXISTS figures_paper ON figures(paper_id,position);`);
  const fulltextColumns=new Set(db.prepare('PRAGMA table_info(fulltexts)').all().map(c=>String(c.name)));
  if(!fulltextColumns.has('automatic'))db.exec('ALTER TABLE fulltexts ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0');
  const figureColumns=new Set(db.prepare('PRAGMA table_info(figures)').all().map(c=>String(c.name)));
  if(!figureColumns.has('origin'))db.exec("ALTER TABLE figures ADD COLUMN origin TEXT NOT NULL DEFAULT 'pmc'");
  if(!figureColumns.has('source_page'))db.exec('ALTER TABLE figures ADD COLUMN source_page INTEGER');
  db.exec("UPDATE fulltexts SET status='pending' WHERE status='loading'");
  db.prepare("UPDATE figures SET status='pending' WHERE status='generating'").run();
  const put=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for(const [k,v] of Object.entries({time:'07:30',timezone:'Asia/Shanghai',per_topic:'10',auto_sync:'true',quality_enabled:'true',last_daily_date:'',last_sync:'',min_impact_operator:'gte',backfill_status:'not_started',backfill_range:'30',backfill_days:'30',backfill_limit:'200',backfill_date_field:'crdt',json_output_migration:'pending',figure_queue_migration:'pending',content_retry_migration:'pending',queue_retry_migration:'pending',figure_sources_migration:'pending'}))put.run(k,v);
  if(settings(db).json_output_migration==='pending'){
    const oldError='AI 请求失败（HTTP 400）：该服务不支持当前参数或模型，请检查配置';
    db.prepare("UPDATE papers SET digest_status='pending',digest_error=NULL WHERE digest_status='error' AND digest_error=? AND (in_library=1 OR starred=1)").run(oldError);
    db.prepare("UPDATE figures SET status='pending',error=NULL WHERE status='error' AND error=?").run(oldError);
    db.prepare("UPDATE relevance_reviews SET status='pending',error=NULL WHERE status='error' AND error=?").run(oldError);
    setSetting(db,'json_output_migration','complete');
  }
  db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status='processing'").run();
  if(settings(db).figure_queue_migration==='pending'){
    db.prepare("UPDATE publisher_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status='no_figures' AND (EXISTS(SELECT 1 FROM publisher_figure_indexes pi WHERE pi.paper_id=pdf_figure_indexes.paper_id AND pi.status='partial') OR NOT EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=pdf_figure_indexes.paper_id AND f.origin IN ('pmc','publisher')))").run();
    db.prepare("UPDATE downloads SET index_error=NULL WHERE index_error='PDF 主图索引待重试'").run();
    setSetting(db,'figure_queue_migration','complete');
  }
  if(settings(db).content_retry_migration==='pending'){
    db.prepare("UPDATE papers SET digest_status='pending',digest_error=NULL WHERE digest_status='error' AND (in_library=1 OR starred=1)").run();
    db.prepare("UPDATE relevance_reviews SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE figures SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE publisher_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    setSetting(db,'content_retry_migration','complete');
  }
  if(settings(db).queue_retry_migration==='pending'){
    db.prepare("UPDATE papers SET digest_status='pending',digest_error=NULL WHERE digest_status='error' AND (in_library=1 OR starred=1)").run();
    db.prepare("UPDATE papers SET title_status='pending',title_error=NULL WHERE title_status='error' AND (in_library=1 OR starred=1)").run();
    db.prepare("UPDATE figures SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE publisher_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    setSetting(db,'queue_retry_migration','complete');
  }
  if(settings(db).figure_sources_migration==='pending'){
    db.prepare("UPDATE papers SET title_status='pending',title_error=NULL WHERE title_status='error' AND (in_library=1 OR starred=1)").run();
    db.prepare("UPDATE publisher_figure_indexes SET status='pending',error=NULL WHERE status='error'").run();
    db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE status IN ('error','no_figures')").run();
    setSetting(db,'figure_sources_migration','complete');
  }
  const currentSettings=settings(db);
  if(currentSettings.per_topic_migration!=='2'){
    if(currentSettings.per_topic==='8')setSetting(db,'per_topic','10');
    setSetting(db,'per_topic_migration','2');
  }
  if(!db.prepare("SELECT value FROM settings WHERE key='initialized'").get()) {
    const ins=db.prepare('INSERT INTO subscriptions(id,name,color,query) VALUES(?,?,?,?)');
    for(const s of defaults)ins.run(s.id,s.name,s.color,s.query);
    put.run('initialized','true');
  }
  db.prepare("UPDATE papers SET digest_status='pending' WHERE digest_status='generating'").run();
  db.prepare("UPDATE papers SET title_status='pending' WHERE title_status='generating'").run();
  db.prepare("UPDATE relevance_reviews SET status='pending' WHERE status='running'").run();
  db.prepare("UPDATE sync_runs SET status='interrupted',finished_at=?,error='服务在更新过程中停止，请重新更新' WHERE status='running'").run(new Date().toISOString());
  if(settings(db).initialize_status==='running'){
    setSetting(db,'initialize_status','error');
    setSetting(db,'initialize_error','初始化被中断，原文献库已保留');
  }
  return db;
}
export type DB=ReturnType<typeof connect>;
export function settings(db:DB):Record<string,string>{ return Object.fromEntries((db.prepare('SELECT * FROM settings').all() as {key:string;value:string}[]).map(x=>[x.key,x.value])); }
export function setSetting(db:DB,key:string,value:string){db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
export function subscriptions(db:DB){return db.prepare('SELECT * FROM subscriptions ORDER BY rowid').all() as Subscription[];}
export function upsertPaper(db:DB,p:PaperInput,subscriptionId:string,now=new Date().toISOString()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const wasInLibrary=Boolean(db.prepare('SELECT in_library FROM papers WHERE id=?').get(p.id)?.in_library);
    const added=upsertPaperRecord(db,p,now);
    db.prepare("UPDATE papers SET in_library=1 WHERE id=? AND source='pubmed'").run(p.id);
    linkPaper(db,p.id,subscriptionId,settings(db).quality_enabled==='true');
    db.exec('COMMIT');
    return added||!wasInLibrary;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function upsertPaperRecord(db:DB,p:PaperInput,now:string){
  const existing=db.prepare('SELECT updated,title,abstract FROM papers WHERE id=?').get(p.id) as {updated:string;title:string;abstract:string}|undefined;
    db.prepare(`INSERT INTO papers(id,title,abstract,authors,published,updated,categories,url,pdf_url,received_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,abstract=excluded.abstract,authors=excluded.authors,published=excluded.published,updated=excluded.updated,categories=excluded.categories,url=excluded.url,pdf_url=excluded.pdf_url,digest=CASE WHEN (papers.updated<>excluded.updated OR papers.abstract<>excluded.abstract OR papers.title<>excluded.title) THEN NULL ELSE papers.digest END,digest_status=CASE WHEN (papers.updated<>excluded.updated OR papers.abstract<>excluded.abstract OR papers.title<>excluded.title) THEN 'pending' ELSE papers.digest_status END,digest_error=CASE WHEN (papers.updated<>excluded.updated OR papers.abstract<>excluded.abstract OR papers.title<>excluded.title) THEN NULL ELSE papers.digest_error END,title_zh=CASE WHEN papers.title<>excluded.title THEN NULL ELSE papers.title_zh END,title_status=CASE WHEN papers.title<>excluded.title THEN 'pending' ELSE papers.title_status END,title_error=CASE WHEN papers.title<>excluded.title THEN NULL ELSE papers.title_error END WHERE excluded.updated>=papers.updated`).run(p.id,p.title,p.abstract,JSON.stringify(p.authors),p.published,p.updated,JSON.stringify(p.categories),p.url,p.pdf_url,now);
    db.prepare("UPDATE papers SET source=?,journal=?,publication_date=?,indexed_at=?,doi=?,pmcid=?,pub_types=?,full_text_url=? WHERE id=? AND updated=?").run(p.source||'arxiv',p.journal||'',p.publication_date||p.published,p.indexed_at||p.published,p.doi||'',p.pmcid||'',JSON.stringify(p.pub_types||[]),p.full_text_url||'',p.id,p.updated);
    if(p.journal_issns)db.prepare('UPDATE papers SET journal_issns=? WHERE id=? AND updated=?').run(JSON.stringify(p.journal_issns),p.id,p.updated);
    enrichPaper(db,p.id);
    if(!p.abstract)db.prepare("UPDATE papers SET digest_status='unavailable',digest_error='PubMed 未提供摘要，请打开全文阅读' WHERE id=? AND updated=?").run(p.id,p.updated);
    if(existing&&p.updated>=existing.updated&&(existing.updated!==p.updated||existing.title!==p.title||existing.abstract!==p.abstract))db.prepare("UPDATE relevance_reviews SET status='pending',verdict=NULL,reason='',evidence='',model=NULL,reviewed_at=NULL,error=NULL WHERE paper_id=?").run(p.id);
  return !existing;
}
export function linkPaper(db:DB,paperId:string,subscriptionId:string,qualityEnabled:boolean){
  db.prepare("INSERT OR IGNORE INTO relevance_reviews(paper_id,subscription_id,status) VALUES(?,?,'pending')").run(paperId,subscriptionId);
  db.prepare(`INSERT OR IGNORE INTO paper_subscriptions SELECT ?,? WHERE NOT EXISTS(
    SELECT 1 FROM relevance_reviews WHERE paper_id=? AND subscription_id=? AND status='complete' AND verdict='irrelevant' AND ?=1)`).run(paperId,subscriptionId,paperId,subscriptionId,Number(qualityEnabled));
}
export function hydrate(db:DB,row:any):Paper {
  return {...row,archived:row.in_library===0?1:row.archived,journal_issns:JSON.parse(row.journal_issns||'[]'),pub_types:JSON.parse(row.pub_types||'[]'),authors:JSON.parse(row.authors),categories:JSON.parse(row.categories),digest:row.digest?JSON.parse(row.digest):null,subscriptions:db.prepare('SELECT s.* FROM subscriptions s JOIN paper_subscriptions ps ON ps.subscription_id=s.id WHERE ps.paper_id=? ORDER BY s.rowid').all(row.id),quality_reviews:db.prepare('SELECT subscription_id,status,verdict,reason,evidence,model,reviewed_at,error FROM relevance_reviews WHERE paper_id=? ORDER BY subscription_id').all(row.id)};
}
export function parseArxiv(xml:string):PaperInput[] {
  if(XMLValidator.validate(xml)!==true)throw new Error('arXiv 返回的 XML 格式无效');
  const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,isArray:(name)=>['entry','author','category','link'].includes(name)});
  const parsed=parser.parse(xml);const feed=parsed.feed;
  if(!Object.prototype.hasOwnProperty.call(parsed,'feed'))throw new Error('arXiv 返回的内容不是有效 Atom feed');
  return (feed.entry||[]).map((e:any)=>{
    if(String(e.id).includes('/api/errors'))throw new Error('arXiv 查询无效：'+String(e.summary));
    const raw=String(e.id).split('/abs/')[1];
    if(!raw || !e.title || !e.summary || !e.published || !e.updated)throw new Error('arXiv 论文缺少必需字段');
    const id=raw.replace(/v\d+$/,'');
    const clean=(s:unknown)=>String(s).replace(/\s+/g,' ').trim();
    return {id,title:clean(e.title),abstract:clean(e.summary),authors:(e.author||[]).map((a:any)=>clean(a.name)),published:e.published,updated:e.updated,categories:(e.category||[]).map((c:any)=>c['@_term']),url:`https://arxiv.org/abs/${raw}`,pdf_url:`https://arxiv.org/pdf/${raw}`};
  });
}
export function localClock(now:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(t:string)=>parts.find(p=>p.type===t)!.value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}
export function dailyDue(now:Date,s:Record<string,string>){const clock=localClock(now,s.timezone);return s.auto_sync==='true' && clock.time>=s.time && clock.date!==s.last_daily_date;}
