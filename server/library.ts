import {aiConfigured,modelJobStatus} from './ai.ts';
import {z} from 'zod';
import {type DB,type PaperInput,hydrate,settings,upsertPaperRecord,linkPaper} from './core.ts';
import {mailboxJournalWhere} from './journals.ts';
export const listSchema=z.object({
 folder:z.string().default('inbox'),
 q:z.string().max(500).default(''),
 filter:z.enum(['all','unread','read','ready']).default('all'),
 page:z.coerce.number().int().min(1).default(1),
 page_size:z.coerce.number().int().min(5).max(50).default(50),
});
export type ListOptions=z.infer<typeof listSchema>;
const manualArchive = "p.archived=1 AND p.archive_origin IS 'manual'";
const removed = `(p.archived=1 OR p.in_library=0) AND NOT (${manualArchive})`;

export function mailboxCounts(db:DB){
 return db.prepare(`SELECT COUNT(*) FILTER (WHERE in_library=1) AS total,
   COUNT(*) FILTER (WHERE archived=0 AND in_library=1) AS inbox,
   COUNT(*) FILTER (WHERE archived=0 AND in_library=1 AND is_read=0) AS unread,
   COUNT(*) FILTER (WHERE starred=1) AS starred,
   COUNT(*) FILTER (WHERE ${manualArchive}) AS archived,
   COUNT(*) FILTER (WHERE ${removed}) AS removed,
   COUNT(*) FILTER (WHERE ? AND (in_library=1 OR starred=1) AND (digest_status IN ('pending','generating') OR title_status IN ('pending','generating'))) AS pending
   FROM papers p WHERE ${mailboxJournalWhere(db)}`).get(Number(aiConfigured()));
}

export function qualityStats(db:DB){
 const status=settings(db).quality_enabled!=='true'?'paused':aiConfigured()?'enabled':'unconfigured';
 const counts=db.prepare(`SELECT
   COUNT(*) FILTER (WHERE r.status IN ('pending','running') AND ps.paper_id IS NOT NULL) AS pending,
   COUNT(*) FILTER (WHERE r.status='error' AND ps.paper_id IS NOT NULL) AS failed,
   COUNT(*) FILTER (WHERE r.verdict='relevant' AND ps.paper_id IS NOT NULL) AS relevant,
   COUNT(*) FILTER (WHERE r.verdict='borderline' AND ps.paper_id IS NOT NULL) AS borderline,
   COUNT(*) FILTER (WHERE r.verdict='irrelevant' AND ps.paper_id IS NULL) AS irrelevant
   FROM relevance_reviews r JOIN papers p ON p.id=r.paper_id
   LEFT JOIN paper_subscriptions ps ON ps.paper_id=r.paper_id AND ps.subscription_id=r.subscription_id
   WHERE p.in_library=1`).get()!;
 return {...counts,status,pending:status==='enabled'?Number(counts.pending):0};
}

export const paperTopicChangesSchema=z.array(z.object({
 subscription_id:z.string().min(1).max(128),
 included:z.boolean(),
}).strict()).min(1).refine(changes=>new Set(changes.map(change=>change.subscription_id)).size===changes.length,{
 message:'同一研究方向只能修改一次',
});

export function editPaperTopics(db:DB,paperId:string,changes:z.infer<typeof paperTopicChangesSchema>){
 const exists=db.prepare('SELECT 1 FROM subscriptions WHERE id=?');
 if(changes.some(change=>!exists.get(change.subscription_id)))return false;

 const override=db.prepare(`INSERT INTO paper_topic_overrides(paper_id,subscription_id,included) VALUES(?,?,?)
   ON CONFLICT(paper_id,subscription_id) DO UPDATE SET included=excluded.included`);
 const include=db.prepare('INSERT OR IGNORE INTO paper_subscriptions(paper_id,subscription_id) VALUES(?,?)');
 const exclude=db.prepare('DELETE FROM paper_subscriptions WHERE paper_id=? AND subscription_id=?');
 const clearReview=db.prepare('DELETE FROM relevance_reviews WHERE paper_id=? AND subscription_id=?');
 for(const {subscription_id,included} of changes){
  override.run(paperId,subscription_id,Number(included));
  clearReview.run(paperId,subscription_id);
  (included?include:exclude).run(paperId,subscription_id);
 }
 // A manual label can restore a paper previously removed by topic review.
 if(changes.some(change=>change.included)){
  db.prepare("UPDATE papers SET archived=0,archive_origin=NULL WHERE id=? AND archive_origin='quality'").run(paperId);
 }
 return true;
}

export function setArchive(db:DB,id:string,archive:boolean){
 if(archive){
  db.prepare("UPDATE papers SET archived=1, archive_origin='manual' WHERE id=?").run(id);
 }else{
  db.prepare("UPDATE papers SET archived=0, archive_origin=NULL, in_library=1 WHERE id=?").run(id);
 }
}

export function recordQualityRemoval(db:DB,id:string){
 db.prepare(`UPDATE papers SET archived=1, archive_origin='quality' WHERE id=?
   AND archive_origin IS NOT 'manual' AND manual_added=0
   AND NOT EXISTS (SELECT 1 FROM paper_subscriptions WHERE paper_id=papers.id)`).run(id);
}

export function listPapers(db:DB,opts:ListOptions){
 const where:string[]=[mailboxJournalWhere(db)];const args:(string|number)[]=[];
 if(opts.folder==='inbox')where.push('p.archived=0 AND p.in_library=1');
 else if(opts.folder==='unread')where.push('p.archived=0 AND p.in_library=1 AND p.is_read=0');
 else if(opts.folder==='starred')where.push('p.starred=1');
 else if(opts.folder==='archive')where.push(manualArchive);
 else if(opts.folder==='removed')where.push(removed);
 else if(opts.folder.startsWith('sub:')){where.push('p.archived=0 AND p.in_library=1 AND EXISTS(SELECT 1 FROM paper_subscriptions ps WHERE ps.paper_id=p.id AND ps.subscription_id=?)');args.push(opts.folder.slice(4));}
 else throw new Error('未知文件夹');
 if(opts.filter==='unread')where.push('p.is_read=0');
 if(opts.filter==='read')where.push('p.is_read=1');
 if(opts.filter==='ready')where.push("p.digest_status='ready'");
 if(opts.q){const pattern='%'+opts.q.replace(/[\\%_]/g,'\\$&')+'%';where.push("(p.title LIKE ? ESCAPE '\\' OR p.title_zh LIKE ? ESCAPE '\\' OR p.authors LIKE ? ESCAPE '\\' OR p.journal LIKE ? ESCAPE '\\' OR p.abstract LIKE ? ESCAPE '\\' OR p.pmid LIKE ? ESCAPE '\\' OR p.doi LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR json_extract(p.digest,'$.title_zh') LIKE ? ESCAPE '\\')");for(let i=0;i<9;i++)args.push(pattern);}
 const sqlWhere=where.join(' AND ');
 const total=Number(db.prepare(`SELECT COUNT(*) AS n FROM papers p WHERE ${sqlWhere}`).get(...args)!.n);
 const pages=Math.max(1,Math.ceil(total/opts.page_size)),page=Math.min(opts.page,pages);
 const rows=db.prepare(`SELECT p.id,p.title,p.title_zh,p.title_status,p.journal,p.publication_date,p.published,p.indexed_at,p.received_at,p.is_read,p.starred,(p.archived=1 OR p.in_library=0) AS archived,p.in_library,p.archive_origin,p.digest_status,p.source,p.pmcid,p.impact_factor,p.jif_label,p.jif_status,p.cas_zone,p.metric_year,p.metric_edition,p.metric_match
   FROM papers p WHERE ${sqlWhere}
   ORDER BY p.received_at DESC,p.id DESC LIMIT ? OFFSET ?`).all(...args,opts.page_size,(page-1)*opts.page_size);
 const topics=db.prepare('SELECT s.id,s.name,s.color FROM subscriptions s JOIN paper_subscriptions ps ON ps.subscription_id=s.id WHERE ps.paper_id=? ORDER BY s.rowid');
 const configured=aiConfigured();
 const items=rows.map(row=>({
  ...row,
  title_status:modelJobStatus(row.title_status,configured),
  digest_status:modelJobStatus(row.digest_status,configured),
  id:String(row.id),
  publication_date:String(row.publication_date),
  indexed_at:String(row.indexed_at),
  received_at:String(row.received_at),
  in_library:Number(row.in_library),
  archive_origin:row.archive_origin,
  subscriptions:topics.all(String(row.id)),
 }));
 return {items,total,page,page_size:opts.page_size,pages};
}
export function getPaper(db:DB,id:string){
 const row=db.prepare('SELECT * FROM papers WHERE id=?').get(id);
 if(!row)return null;
 const paper=hydrate(db,row),configured=aiConfigured();
 const qualityEnabled=settings(db).quality_enabled==='true';
 return {...paper,
  title_status:modelJobStatus(paper.title_status,configured),
  digest_status:modelJobStatus(paper.digest_status,configured),
  quality_reviews:paper.quality_reviews.map(review=>({...review,
   status:review.status==='pending'&&!qualityEnabled?'paused':modelJobStatus(review.status,configured),
  })),
 };
}
export function topicCounts(db:DB){return db.prepare(`SELECT s.id,COUNT(*) FILTER (WHERE p.archived=0 AND p.in_library=1 AND ${mailboxJournalWhere(db)}) AS total,COUNT(*) FILTER (WHERE p.archived=0 AND p.in_library=1 AND p.is_read=0 AND ${mailboxJournalWhere(db)}) AS unread FROM subscriptions s LEFT JOIN paper_subscriptions ps ON ps.subscription_id=s.id LEFT JOIN papers p ON p.id=ps.paper_id GROUP BY s.id`).all();}
export function saveSubscription(db:DB,id:string,s:{name:string;query:string;color:string;enabled:boolean;description:string;query_explanation:string},matches:string[],papers:PaperInput[]=[],now=new Date().toISOString()){
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('INSERT INTO subscriptions(id,name,query,color,enabled,description,query_explanation) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,query=excluded.query,color=excluded.color,enabled=excluded.enabled,description=excluded.description,query_explanation=excluded.query_explanation').run(id,s.name,s.query,s.color,Number(s.enabled),s.description,s.query_explanation);
  db.prepare(`DELETE FROM paper_subscriptions WHERE subscription_id=?
    AND paper_id IN (SELECT id FROM papers WHERE source='pubmed')
    AND NOT EXISTS(SELECT 1 FROM paper_topic_overrides o
      WHERE o.paper_id=paper_subscriptions.paper_id AND o.subscription_id=paper_subscriptions.subscription_id)`).run(id);
  db.prepare("DELETE FROM relevance_reviews WHERE subscription_id=? AND paper_id NOT IN (SELECT paper_id FROM paper_subscriptions WHERE subscription_id=?)").run(id,id);
  let added=0;
  for(const paper of papers){
   const stored=upsertPaperRecord(db,paper,now);
   if(stored.added)added++;
   db.prepare("UPDATE papers SET in_library=1 WHERE id=? AND source='pubmed'").run(stored.id);
  }
  const byPmid=db.prepare("SELECT id FROM papers WHERE pmid<>'' AND pmid=?");
  const storedMatches=new Set(matches.map(paperId=>paperId.startsWith('pmid:')?String(byPmid.get(paperId.slice(5))?.id??paperId):paperId));
  for(const paperId of storedMatches)linkPaper(db,paperId,id,false);
  db.exec('COMMIT');
  return {added,matched:storedMatches.size};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
