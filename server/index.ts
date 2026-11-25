import {subscriptionDateClause} from './subscription-refresh.ts';
import 'dotenv/config';
import express from 'express';
import { mkdirSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { connect, settings, setSetting, subscriptions, upsertPaper, parseArxiv, hydrate, dailyDue, localClock, type PaperInput } from './core.ts';
import { fetchPubmed, pubmedDefaults, pubmedLegacyQueries,medicalAgentsExplanation, previewPubmed, matchPubmedIds, fetchPubmedMetadata, prepareJournalSearch, pubmedDateClause } from './pubmed.ts';
import { generateDigest, translateTitle, generateRelevanceReview, activeAI, aiConfigured, aiConfig, aiInputSchema, aiServiceSchema, resolveAI, testAI, listModels, generateSearch } from './ai.ts';
import {listSchema,listPapers,getPaper,topicCounts,saveSubscription,mailboxCounts,setArchive,recordQualityRemoval} from './library.ts';
import {enrichLibrary,enrichPaper,journalFilter,journalWhere,journalInfo,matchJournal,passesJournal,journalOptions,requireJournalIds,searchJournals} from './journals.ts';
import {downloadInfo,downloadState,requestDownload,downloadedPath} from './downloads.ts';
import {figureState,queueFulltext,pumpFigures,pumpPublisherFigures,retryPublisherFigures} from './figures.ts';
import {replaceLibrary,type Initialization,type TopicMatches} from './initialization.ts';
import {ensureDocument,documentState,uploadDocument,chatHistory,askDocument,clearChat,DocumentError} from './documents.ts';
import {prepareReading,readingPreparationStats} from './reading-preparation.ts';

import {generateJournalPlan} from './journal-plans.ts';

const root=process.cwd();mkdirSync(path.join(root,'data'),{recursive:true});
const db=connect(path.join(root,'data','papers.sqlite'));
enrichLibrary(db);
if(!settings(db).impact_filter_initialized){setSetting(db,'min_impact_factor','10');setSetting(db,'impact_filter_initialized','true');}
if(!settings(db).min_impact_operator)setSetting(db,'min_impact_operator','gte');
if(!settings(db).pubmed_migration){
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE papers SET archived=1, archive_origin='legacy' WHERE source='arxiv'").run();
    for(const id of ['ai','foundation','agents'])db.prepare('DELETE FROM subscriptions WHERE id=?').run(id);
    for(const s of pubmedDefaults)db.prepare('INSERT OR IGNORE INTO subscriptions(id,name,color,query) VALUES(?,?,?,?)').run(s.id,s.name,s.color,s.query);
    setSetting(db,'pubmed_migration','true');setSetting(db,'last_daily_date','');setSetting(db,'last_sync','');
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
const app=express();app.use(express.json({limit:'128kb'}));
// 本机单用户服务；阻止网页跨站修改本机数据。
app.use('/api',(req,res,next)=>{
  const host=req.headers.host||''; const origin=req.headers.origin;
  if(!/^127\.0\.0\.1:\d+$/.test(host)&&!/^localhost:\d+$/.test(host))return res.status(403).json({error:'此服务只允许本机访问'});
  if(origin && origin!==`http://${host}`)return res.status(403).json({error:'不允许跨站请求'});
  res.setHeader('Cache-Control','no-store');next();
});
let syncing=false;let workers=0;let titleWorkers=0;let qualityWorkers=0;
let libraryTail=Promise.resolve();
async function withLibraryLock<T>(operation:()=>Promise<T>|T):Promise<T>{const previous=libraryTail;let release!:()=>void;libraryTail=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await operation();}finally{release();}}
type SyncOptions={dateClause?:string;initialize?:Initialization};
async function sync(kind:string,options:SyncOptions={}){if(syncing)return;syncing=true;try{await withLibraryLock(()=>performSync(kind,options));}finally{syncing=false;}}
async function pumpDigests(){
  if(!aiConfigured())return;
  while(workers<2){
    const row=db.prepare(`SELECT * FROM papers p WHERE digest_status='pending' AND (in_library=1 OR starred=1) AND ${journalWhere(db)} ORDER BY starred DESC,published DESC LIMIT 1`).get();
    if(!row)break;
    db.prepare("UPDATE papers SET digest_status='generating',digest_error=NULL WHERE id=?").run(row.id as string);workers++;
    const paper=hydrate(db,row);const version=paper.updated;const config=activeAI();const model=config.model;
    void generateDigest(paper,config).then(d=>{
      db.prepare("UPDATE papers SET digest=?,title_zh=?,title_status='ready',title_error=NULL,digest_status='ready',digest_error=NULL,digest_model=?,digest_at=? WHERE id=? AND updated=? AND abstract=? AND title=?").run(JSON.stringify(d),d.title_zh,model,new Date().toISOString(),paper.id,version,paper.abstract,paper.title);
    }).catch(e=>{
      db.prepare("UPDATE papers SET digest_status='error',digest_error=? WHERE id=? AND updated=? AND abstract=? AND title=?").run(e.message,paper.id,version,paper.abstract,paper.title);
      console.error('解读失败',paper.id,e.message);
    }).finally(()=>{workers--;void pumpDigests();void pumpTitles();});
  }
}
async function pumpTitles(){
 if(!aiConfigured())return;
 while(titleWorkers<2){
  const row:any=db.prepare(`SELECT p.id,p.title,p.updated FROM papers p
    WHERE p.title_status='pending' AND (p.in_library=1 OR p.starred=1) AND ${journalWhere(db)}
    ORDER BY p.starred DESC,p.received_at DESC LIMIT 1`).get();
  if(!row)break;
  db.prepare("UPDATE papers SET title_status='generating',title_error=NULL WHERE id=? AND title_status='pending'").run(row.id);titleWorkers++;
  const config=activeAI();
  void translateTitle(String(row.title),config).then(result=>{
   db.prepare("UPDATE papers SET title_zh=?,title_status='ready',title_error=NULL WHERE id=? AND updated=? AND title=?").run(result.title_zh,row.id,row.updated,row.title);
  }).catch(error=>{
   db.prepare("UPDATE papers SET title_status='error',title_error=? WHERE id=? AND updated=? AND title=?").run(error instanceof Error?error.message:'标题翻译失败',row.id,row.updated,row.title);
  }).finally(()=>{titleWorkers--;void pumpTitles();});
 }
}
async function pumpQuality(){
  if(settings(db).quality_enabled!=='true'||!aiConfigured())return;
  while(qualityWorkers<2){
    const row:any=db.prepare(`SELECT r.paper_id,r.subscription_id,p.title,p.abstract,p.authors,p.published,p.updated,p.categories,p.url,p.pdf_url,p.source,p.journal,p.publication_date,p.indexed_at,p.doi,p.pmcid,p.pub_types,p.full_text_url,s.name AS topic_name,s.description AS topic_description,s.query AS topic_query
      FROM relevance_reviews r JOIN papers p ON p.id=r.paper_id JOIN subscriptions s ON s.id=r.subscription_id
      JOIN paper_subscriptions ps ON ps.paper_id=r.paper_id AND ps.subscription_id=r.subscription_id
      WHERE r.status='pending' AND p.in_library=1 ORDER BY p.received_at DESC LIMIT 1`).get();
    if(!row)return;
    db.prepare("UPDATE relevance_reviews SET status='running',error=NULL WHERE paper_id=? AND subscription_id=?").run(row.paper_id,row.subscription_id);qualityWorkers++;
    const paper={...row,id:String(row.paper_id),authors:JSON.parse(row.authors||'[]'),categories:JSON.parse(row.categories||'[]'),pub_types:JSON.parse(row.pub_types||'[]')} as PaperInput;
    const topic={name:String(row.topic_name),description:String(row.topic_description||''),query:String(row.topic_query)};const model=activeAI().model;
    void generateRelevanceReview(paper,topic).then(review=>{
      if(db.prepare('SELECT query FROM subscriptions WHERE id=?').get(row.subscription_id)?.query!==topic.query)return;
      if(settings(db).quality_enabled!=='true'){
        db.prepare("UPDATE relevance_reviews SET status='pending',error=NULL WHERE paper_id=? AND subscription_id=?").run(row.paper_id,row.subscription_id);
        return;
      }
      db.exec('BEGIN IMMEDIATE');
      try{
        const updated=db.prepare("UPDATE relevance_reviews SET status='complete',verdict=?,reason=?,evidence=?,model=?,reviewed_at=?,error=NULL WHERE paper_id=? AND subscription_id=? AND status='running'").run(review.verdict,review.reason,review.evidence,model,new Date().toISOString(),row.paper_id,row.subscription_id);
        if(updated.changes&&review.verdict==='irrelevant'){
          db.prepare('DELETE FROM paper_subscriptions WHERE paper_id=? AND subscription_id=?').run(row.paper_id,row.subscription_id);
          recordQualityRemoval(db,row.paper_id);
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }).catch(e=>{
      if(db.prepare('SELECT query FROM subscriptions WHERE id=?').get(row.subscription_id)?.query!==topic.query)return;
      const paused=settings(db).quality_enabled!=='true';
      db.prepare("UPDATE relevance_reviews SET status=?,error=? WHERE paper_id=? AND subscription_id=? AND status='running'").run(paused?'pending':'error',paused?null:e.message,row.paper_id,row.subscription_id);
    }).finally(()=>{qualityWorkers--;void pumpQuality();prepareReading(db,root);});
  }
}
async function migrateDefaultQueries(){
  const key='pubmed_quality_query_version';if(settings(db)[key]==='3')return;
  for(const legacy of pubmedLegacyQueries){
    const next=pubmedDefaults.find(s=>s.id===legacy.id);const current:any=db.prepare('SELECT * FROM subscriptions WHERE id=?').get(legacy.id);
    if(!next||!current||current.query!==legacy.query)continue;
    await writeTopic(next.id,{...current,enabled:!!current.enabled,query:next.query,description:current.description||'医学与生物医学场景中的人工智能智能体，包括临床、健康管理和药物研发',query_explanation:medicalAgentsExplanation});
  }
  setSetting(db,key,'3');
}
async function performSync(kind:string,options:SyncOptions={}){
  const run=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES(?,?,'running')").run(new Date().toISOString(),kind);
  const initial=options.initialize;
  let added=0;const errors:string[]=[];const groups:TopicMatches[]=[];
  try {
    const s=settings(db);
    const savedFilter=journalFilter(db);
    const filter=initial?{
      threshold:initial.min_impact_factor===null?null:{value:initial.min_impact_factor,operator:initial.min_impact_operator??'gte'},
      ids:initial.journal_filter_ids??savedFilter.ids,
    }:savedFilter;
    const topics=subscriptions(db).filter(x=>x.enabled);
    if(initial&&!topics.length)throw new Error('至少需要启用一个研究方向');
    const journalSearch=await prepareJournalSearch(filter.threshold?.value??null,filter.ids,filter.threshold?.operator);
    for(const sub of topics){
      try{
        const papers=journalSearch.empty?[]:(await fetchPubmed(
          journalSearch.restriction?`(${sub.query}) AND ${journalSearch.restriction}`:sub.query,
          initial?.limit??Number(s.per_topic),journalSearch.allowedMissingJournalIssns||[],
          journalSearch.webEnv,options.dateClause||'',
        )).filter(p=>passesJournal(matchJournal(p.journal||'',p.journal_issns||[]),filter));
        if(initial)groups.push({subscriptionId:sub.id,papers});
        else for(const p of papers)if(upsertPaper(db,p,sub.id))added++;
      }
      catch(e:any){errors.push(`${sub.name}：${e.message}`);}
    }
    const finishedAt=new Date().toISOString();
    if(initial){
      if(errors.length)throw new Error(errors.join('；'));
      replaceLibrary(db,groups,initial,finishedAt,localClock(new Date(finishedAt),s.timezone).date,run.lastInsertRowid);
      void pumpDigests();void pumpTitles();void pumpQuality();prepareReading(db,root);
      return;
    }
    const status=errors.length?'error':'success';
    db.prepare('UPDATE sync_runs SET finished_at=?,status=?,added=?,error=? WHERE id=?').run(finishedAt,status,added,errors.length?errors.join('；'):null,run.lastInsertRowid);
    if(!errors.length){setSetting(db,'last_sync',finishedAt);if(kind==='daily')setSetting(db,'last_daily_date',localClock(new Date(),s.timezone).date);}
    void pumpDigests();void pumpTitles();void pumpQuality();prepareReading(db,root);
  }catch(e:any){db.prepare("UPDATE sync_runs SET finished_at=?,status='error',added=?,error=? WHERE id=?").run(new Date().toISOString(),added,e.message,run.lastInsertRowid);if(initial){setSetting(db,'initialize_status','error');setSetting(db,'initialize_error',e.message);}}
}

function qualityStats(){return db.prepare(`SELECT COUNT(*) FILTER (WHERE r.status IN ('pending','running','error') AND ps.paper_id IS NOT NULL) AS pending,COUNT(*) FILTER (WHERE r.verdict='relevant' AND ps.paper_id IS NOT NULL) AS relevant,COUNT(*) FILTER (WHERE r.verdict='borderline' AND ps.paper_id IS NOT NULL) AS borderline,COUNT(*) FILTER (WHERE r.verdict='irrelevant' AND ps.paper_id IS NULL) AS irrelevant
 FROM relevance_reviews r JOIN papers p ON p.id=r.paper_id LEFT JOIN paper_subscriptions ps ON ps.paper_id=r.paper_id AND ps.subscription_id=r.subscription_id WHERE p.in_library=1`).get();}
app.get('/api/health',(_req,res)=>res.json({app:'paper-mail'}));
app.get('/api/state',(_req,res)=>res.json({settings:settings(db),subscriptions:subscriptions(db),stats:mailboxCounts(db),quality:qualityStats(),topic_counts:topicCounts(db),syncing,ai:aiConfig(),journals:journalInfo,selectedJournals:journalOptions(journalFilter(db).ids),download:downloadInfo(),readingPreparation:readingPreparationStats(db),recentDailyRuns:db.prepare("SELECT * FROM sync_runs WHERE kind='daily' ORDER BY id DESC LIMIT 7").all(),dailyRun:db.prepare("SELECT * FROM sync_runs WHERE kind='daily' ORDER BY id DESC LIMIT 1").get()||null,lastRun:db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get()||null}));
app.get('/api/papers',(req,res)=>res.json(listPapers(db,listSchema.parse(req.query))));
app.get('/api/papers/:id',(req,res)=>{const p=getPaper(db,req.params.id);if(!p)return res.status(404).json({error:'论文不存在'});res.json(p);});
app.get('/api/papers/:id/download', (req,res)=>{if(!getPaper(db,req.params.id))return res.status(404).json({error:'论文不存在'});res.json(downloadState(db,req.params.id));});
app.get('/api/papers/:id/document',(req,res)=>{if(!getPaper(db,req.params.id))return res.status(404).json({error:'论文不存在'});res.json(documentState(db,root,req.params.id));});
app.post('/api/papers/:id/document/ensure',async(req,res)=>{const state=await ensureDocument(db,root,req.params.id);prepareReading(db,root);res.json(state);});
app.post('/api/papers/:id/document/upload',express.raw({type:'application/pdf',limit:'50mb'}),async(req,res)=>{
  if(!Buffer.isBuffer(req.body))return res.status(400).json({error:'请上传 PDF 文件'});
  const result=await uploadDocument(db,root,req.params.id,req.body);prepareReading(db,root);res.json(result);
});
app.get('/api/papers/:id/chat',(req,res)=>res.json({messages:chatHistory(db,req.params.id)}));
app.post('/api/papers/:id/chat',async(req,res)=>{
  const {question}=z.object({question:z.string().trim().min(1).max(3000)}).parse(req.body);
  res.json({messages:await askDocument(db,req.params.id,question)});
});
app.post('/api/papers/:id/chat/reset',(req,res)=>{clearChat(db,req.params.id);res.json({ok:true});});
app.post('/api/papers/:id/download',async(req,res)=>{requestDownload(db,req.params.id);prepareReading(db,root);res.status(202).json({ok:true});});
app.get('/api/papers/:id/pdf',(req,res)=>{const file=downloadedPath(db,root,req.params.id);if(!file)return res.status(404).json({error:'本机尚无该论文 PDF'});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',(req.query.download==='1'?'attachment':'inline')+'; filename="'+req.params.id.replace('pmid:','')+'.pdf"');res.sendFile(file);});
const journalIdsSchema=z.array(z.string().regex(/^\d{7}[0-9X]$/)).max(2500);
const journalDescriptionSchema=z.string().trim().max(1500);
app.get('/api/journals/search',(req,res)=>{
  const query=z.string().trim().max(150).parse(req.query.q);
  res.json({journals:searchJournals(query)});
});
app.post('/api/journals/generate',async(req,res)=>{
  const description=journalDescriptionSchema.min(2).parse(req.body.description);
  res.json(await generateJournalPlan(description));
});
const preferencesSchema=z.object({
  journal_filter_ids:journalIdsSchema.optional(),
  journal_filter_description:journalDescriptionSchema.optional(),
  min_impact_factor:z.number().min(0).max(1000).nullable().optional(),
  min_impact_operator:z.enum(['gt','gte']).optional(),
  backfill_days:z.number().int().min(1).max(3650).optional(),
  backfill_range:z.enum(['7','30','90','180','365','custom']).optional(),
  backfill_start:z.iso.date().optional(),
  backfill_end:z.iso.date().optional(),
  backfill_limit:z.number().int().min(1).max(5000).optional(),
  backfill_date_field:z.enum(['crdt','pdat']).optional(),
  quality_enabled:z.boolean().optional(),
});
app.put('/api/preferences',(req,res)=>{
  if(settings(db).initialize_status==='running')return res.status(409).json({error:'文献库正在初始化，请稍候'});
  const preferences=preferencesSchema.parse(req.body);
  const dateStart=preferences.backfill_start;
  const dateEnd=preferences.backfill_end;
  if((dateStart!==undefined||dateEnd!==undefined)&&(!dateStart||!dateEnd||dateStart>dateEnd)){
    return res.status(400).json({error:'请选择有效的开始和结束日期'});
  }
  if(preferences.journal_filter_ids)preferences.journal_filter_ids=requireJournalIds(preferences.journal_filter_ids);
  if(preferences.min_impact_factor!==undefined&&preferences.min_impact_operator===undefined)preferences.min_impact_operator='gte';
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [key,value] of Object.entries(preferences)){
      if(value!==undefined)setSetting(db,key,Array.isArray(value)?JSON.stringify(value):value===null?'':String(value));
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const filterChanged=preferences.min_impact_factor!==undefined||preferences.min_impact_operator!==undefined||preferences.journal_filter_ids!==undefined;
  if(filterChanged)void pumpDigests();
  if(preferences.quality_enabled)void pumpQuality();
  if(preferences.quality_enabled!==undefined||filterChanged)prepareReading(db,root);
  res.json({ok:true});
});
const initializationSchema=z.object({start:z.iso.date(),end:z.iso.date(),date_field:z.enum(['crdt','pdat']),range:z.enum(['7','30','90','180','365','custom']),limit:z.number().int().min(1).max(5000),min_impact_factor:z.number().min(0).max(1000).nullable(),min_impact_operator:z.enum(['gt','gte']).optional(),journal_filter_ids:journalIdsSchema.optional(),journal_filter_description:journalDescriptionSchema.optional(),quality_enabled:z.boolean()}).refine(x=>x.start<=x.end,{message:'开始日期不能晚于结束日期'});
app.post('/api/initialize',(req,res)=>{
  const input=initializationSchema.parse(req.body);if(syncing)return res.status(409).json({error:'正在收取论文，请稍候'});
  if(input.journal_filter_ids)input.journal_filter_ids=requireJournalIds(input.journal_filter_ids);
  setSetting(db,'initialize_status','running');setSetting(db,'initialize_error','');setSetting(db,'initialize_started_at',new Date().toISOString());
  void sync('initialize',{dateClause:pubmedDateClause(input.start,input.end,input.date_field),initialize:input});res.status(202).json({ok:true});
});
app.patch('/api/papers/:id',(req,res)=>{
  const {archived,...patch}=z.object({is_read:z.boolean().optional(),starred:z.boolean().optional(),archived:z.boolean().optional(),note:z.string().max(20000).optional()}).strict().parse(req.body);
  if(!db.prepare('SELECT id FROM papers WHERE id=?').get(req.params.id))return res.status(404).json({error:'论文不存在'});
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [key,value] of Object.entries(patch))db.prepare(`UPDATE papers SET ${key}=? WHERE id=?`).run(typeof value==='boolean'?Number(value):value,req.params.id);
    if(archived!==undefined)setArchive(db,req.params.id,archived);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  if(archived===false)prepareReading(db,root);
  res.json(hydrate(db,db.prepare('SELECT * FROM papers WHERE id=?').get(req.params.id)));
});
app.post('/api/papers/:id/digest',(req,res)=>{
  const p=db.prepare('SELECT * FROM papers WHERE id=?').get(req.params.id);
  if(!p)return res.status(404).json({error:'论文不存在'});
  if(!String(p.abstract).trim())return res.status(409).json({error:'PubMed 未提供摘要，请打开全文阅读'});
  if(!aiConfigured())return res.status(409).json({error:'请先在设置 → API 与模型中完成配置'});
  if(p.digest_status!=='generating')db.prepare("UPDATE papers SET digest_status='pending',digest_error=NULL WHERE id=?").run(req.params.id);
  void pumpDigests();res.json({ok:true});
});
app.post('/api/papers/:id/title/retry',(req,res)=>{
  if(!db.prepare('SELECT 1 FROM papers WHERE id=?').get(req.params.id))return res.status(404).json({error:'论文不存在'});
  if(!aiConfigured())return res.status(409).json({error:'请先在设置 → API 与模型中完成配置'});
  db.prepare("UPDATE papers SET title_status='pending',title_error=NULL WHERE id=? AND title_status<>'generating'").run(req.params.id);
  void pumpTitles();res.status(202).json({ok:true});
});
app.post('/api/read-all',(_req,res)=>{db.prepare('UPDATE papers SET is_read=1 WHERE archived=0 AND in_library=1').run();res.json({ok:true});});
app.post('/api/sync',(_req,res)=>{if(syncing)return res.status(409).json({error:'正在更新，请稍候'});const s=settings(db);void sync('manual',{dateClause:s.library_initialized_on?dailyDateClause(s):''});res.status(202).json({ok:true});});
const subscriptionSchema=z.object({name:z.string().trim().min(1).max(40),query:z.string().trim().min(1).max(5000),color:z.string().regex(/^#[\da-fA-F]{6}$/),enabled:z.boolean(),description:z.string().trim().max(3000).default(''),query_explanation:z.string().max(5000).default('')});
app.post('/api/subscriptions/generate',async(req,res)=>{const {description}=z.object({description:z.string().trim().min(4).max(3000)}).parse(req.body);const plan=await generateSearch(description);const validation=await previewPubmed(plan.query);res.json({...plan,...validation});});
app.post('/api/subscriptions/preview',async(req,res)=>{const {query}=z.object({query:z.string().trim().min(1).max(5000)}).parse(req.body);res.json(await previewPubmed(query));});
async function writeTopic(id:string,s:z.infer<typeof subscriptionSchema>){
 const validation=await previewPubmed(s.query);
 if(validation.warnings.length)throw new Error('PubMed 未识别部分检索词，请调整并重新验证：'+validation.warnings.join('；'));
 const previous=db.prepare('SELECT query FROM subscriptions WHERE id=?').get(id);
 const changed=previous?.query!==s.query;
 const ids=db.prepare("SELECT id FROM papers WHERE source='pubmed'").all().map(x=>String(x.id));
 const matches=changed?await matchPubmedIds(s.query,ids):db.prepare('SELECT paper_id FROM paper_subscriptions WHERE subscription_id=?').all(id).map(x=>String(x.paper_id));
 let papers:PaperInput[]=[];
 if(changed){
  const prefs=settings(db),filter=journalFilter(db),journals=await prepareJournalSearch(filter.threshold?.value??null,filter.ids,filter.threshold?.operator);
  papers=journals.empty?[]:(await fetchPubmed(journals.restriction?'('+s.query+') AND '+journals.restriction:s.query,Number(prefs.library_initialized_on?prefs.backfill_limit:prefs.per_topic),journals.allowedMissingJournalIssns||[],journals.webEnv,subscriptionDateClause(prefs))).filter(p=>passesJournal(matchJournal(p.journal||'',p.journal_issns||[]),filter));
 }
 const result=saveSubscription(db,id,s,[...new Set([...matches,...papers.map(p=>p.id)])],papers);
 if(changed)db.prepare("UPDATE relevance_reviews SET status='pending',verdict=NULL,reason='',evidence='',model=NULL,reviewed_at=NULL,error=NULL WHERE subscription_id=?").run(id);
 void pumpQuality();void pumpDigests();prepareReading(db,root);return {id,...result};
}
app.post('/api/subscriptions',async(req,res)=>res.json(await withLibraryLock(()=>writeTopic(crypto.randomUUID(),subscriptionSchema.parse(req.body)))));
app.put('/api/subscriptions/:id',async(req,res)=>{res.json(await withLibraryLock(()=>{if(!db.prepare('SELECT id FROM subscriptions WHERE id=?').get(req.params.id))throw new Error('研究方向已不存在');return writeTopic(req.params.id,subscriptionSchema.parse(req.body));}));});
app.delete('/api/subscriptions/:id',async(req,res)=>{await withLibraryLock(()=>db.prepare('DELETE FROM subscriptions WHERE id=?').run(req.params.id));res.json({ok:true});});
app.put('/api/settings',(req,res)=>{
  const s=z.object({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timezone:z.string().refine(x=>{try{new Intl.DateTimeFormat('en',{timeZone:x});return true;}catch{return false;}}),per_topic:z.number().int().min(1).max(100),auto_sync:z.boolean()}).parse(req.body);
  for(const [k,v] of Object.entries(s))setSetting(db,k,String(v));res.json({ok:true});
});
app.post('/api/ai/test',async(req,res)=>res.json(await testAI(resolveAI(aiInputSchema.parse(req.body)))));
app.post('/api/ai/models',async(req,res)=>res.json({models:await listModels(resolveAI(aiServiceSchema.parse(req.body)))}));
app.put('/api/ai',async(req,res)=>{
  const input=aiInputSchema.parse(req.body);const config=resolveAI(input);
  await testAI(config);
  const values:Record<string,string>={AI_PROVIDER:config.provider,AI_BASE_URL:config.base_url,AI_MODEL:config.model,AI_FIGURE_MODEL:config.figure_model};if(input.key)values.AI_API_KEY=input.key;
  const envPath=path.join(root,'.env');let env=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
  for(const [k,v] of Object.entries(values)){const line=`${k}=${JSON.stringify(v)}`;env=new RegExp(`^${k}=.*$`,'m').test(env)?env.replace(new RegExp(`^${k}=.*$`,'m'),()=>line):env+'\n'+line;}
  writeFileSync(envPath,env+'\n',{mode:0o600});chmodSync(envPath,0o600);for(const [k,v] of Object.entries(values))process.env[k]=v;
  db.prepare("UPDATE papers SET digest_status='pending',digest_error=NULL WHERE digest_status='error'").run();db.prepare("UPDATE papers SET title_status='pending',title_error=NULL WHERE title_status='error'").run();db.prepare("UPDATE figures SET status='pending',error=NULL WHERE status='error'").run();db.prepare("UPDATE relevance_reviews SET status='pending',error=NULL WHERE status='error'").run();void pumpDigests();void pumpTitles();void pumpQuality();prepareReading(db,root);res.json({ok:true,config:aiConfig()});
});
app.post('/api/papers/bulk',(req,res)=>{
  const {ids,action}=z.object({ids:z.array(z.string()).min(1).max(50),action:z.enum(['read','unread','archive','restore','star','unstar'])}).parse(req.body);
  const fields={read:['is_read',1],unread:['is_read',0],star:['starred',1],unstar:['starred',0]} as const;
  db.exec('BEGIN IMMEDIATE');
  try{
    if(action==='archive'||action==='restore'){
      for(const id of ids)setArchive(db,id,action==='archive');
    }else{
      const [field,value]=fields[action];
      const update=db.prepare(`UPDATE papers SET ${field}=? WHERE id=?`);
      for(const id of ids)update.run(value,id);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  if(action==='restore')prepareReading(db,root);
  res.json({ok:true});
});
app.get('/api/papers/:id/figures',(req,res)=>{if(!getPaper(db,req.params.id))return res.status(404).json({error:'论文不存在'});res.json(figureState(db,req.params.id));});
app.post('/api/papers/:id/fulltext',(req,res)=>{if(!getPaper(db,req.params.id))return res.status(404).json({error:'论文不存在'});queueFulltext(db,req.params.id);prepareReading(db,root);res.status(202).json({ok:true});});
app.post('/api/figures/:id/retry',(req,res)=>{if(!aiConfigured())return res.status(409).json({error:'请先配置 AI 服务'});db.prepare("UPDATE figures SET status='pending',error=NULL WHERE id=? AND status='error'").run(req.params.id);void pumpFigures(db,root);res.json({ok:true});});
app.post('/api/papers/:id/figures/retry',async(req,res)=>{if(!aiConfigured())return res.status(409).json({error:'请先配置 AI 服务'});retryPublisherFigures(db,req.params.id);await prepareReading(db,root);void pumpPublisherFigures(db,root);res.json({ok:true});});
app.get('/api/figures/:id/image',(req,res)=>{const f:any=db.prepare('SELECT image_path,image_type FROM figures WHERE id=?').get(req.params.id);if(!f?.image_path)return res.sendStatus(404);res.setHeader('Content-Type',f.image_type);res.setHeader('Cache-Control','private,max-age=86400');res.sendFile(path.join(root,'data','figures',f.image_path));});
app.get('/api/export',(_req,res)=>{
  const rows=db.prepare('SELECT * FROM papers WHERE starred=1 ORDER BY published DESC').all().map(p=>hydrate(db,p));
  const md='# 研邮 Paper-mail · 收藏论文\n\n'+rows.map(p=>`## ${p.title_zh||p.digest?.title_zh||p.title}\n\n${p.title}\n\n${p.authors.join(', ')} · ${p.journal?p.journal+' · ':''}${p.publication_date||p.published.slice(0,10)}\n\n[原文](${p.url}) · [${p.pdf_url?'PDF':'全文'}](${p.pdf_url||p.full_text_url||p.url})\n\n${p.digest?`${p.digest.summary}\n\n### 核心发现\n${p.digest.findings.map(x=>'- '+x).join('\n')}\n\n### 证据边界\n${p.digest.limitations.map(x=>'- '+x).join('\n')}\n\n解读依据：作者摘要，未读取全文。`:p.abstract}\n\n${p.note?'### 我的笔记\n'+p.note:''}`).join('\n\n---\n\n');
  res.setHeader('Content-Disposition','attachment; filename="paper-morning-starred.md"');res.type('text/markdown').send(md);
});
app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
app.use((req,res,next)=>{if(req.path.split('/').some(part=>part.startsWith('.')))return res.sendStatus(404);next();});
if(!process.argv.includes('--dev')&&existsSync(path.join(root,'dist','index.html'))){app.use(express.static(path.join(root,'dist')));app.get('/{*splat}',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));}
else{const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
app.use((err:any,_req:any,res:any,_next:any)=>{if(err instanceof DocumentError)return res.status(err.status).json({error:err.message});if(err.type==='entity.too.large')return res.status(413).json({error:'上传文件不能超过 50 MB'});if(err instanceof z.ZodError)return res.status(400).json({error:'输入内容不符合要求，请检查字段'});console.error(err.message);res.status(500).json({error:err.name==='TimeoutError'?'请求超时，请稍后重试':err.message==='fetch failed'?'无法连接远端服务，请检查地址与网络后重试':err.message||'服务处理失败'});});
const port=Number(process.env.PORT||4317);
app.listen(port,'127.0.0.1',async()=>{console.log(`研邮 Paper-mail已启动：http://127.0.0.1:${port}`);try{await withLibraryLock(migrateDefaultQueries);}catch(e:any){console.error('研究方向检索式迁移失败：'+e.message);}void pumpDigests();void pumpTitles();void pumpQuality();prepareReading(db,root);void refreshJournalMetadata().finally(()=>{prepareReading(db,root);void tick();});});
let attemptedDate='';
async function tick(){const s=settings(db);const day=localClock(new Date(),s.timezone).date;if(!syncing&&dailyDue(new Date(),s)&&attemptedDate!==day){attemptedDate=day;await sync('daily',{dateClause:dailyDateClause(s)});}}
setInterval(()=>void tick(),30000).unref();

function dailyDateClause(s:Record<string,string>){
 const today=localClock(new Date(),s.timezone).date;
 const valid=[s.last_daily_date,s.library_initialized_on].filter(date=>z.iso.date().safeParse(date).success&&date<=today).sort();
 return pubmedDateClause(valid.at(-1)||today,today,'crdt');
}
async function refreshJournalMetadata(){
 const ids=db.prepare("SELECT id FROM papers WHERE source='pubmed' AND journal_issns='[]'").all().map(p=>String(p.id));
 if(!ids.length)return;
 try{const records=await fetchPubmedMetadata(ids);db.exec('BEGIN IMMEDIATE');try{for(const p of records){db.prepare('UPDATE papers SET journal_issns=? WHERE id=?').run(JSON.stringify(p.journal_issns||[]),p.id);enrichPaper(db,p.id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}catch(e:any){console.error('期刊 ISSN 更新失败：'+e.message);}
}
