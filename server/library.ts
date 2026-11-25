import {aiConfigured} from './ai.ts';
import {z} from 'zod';
import {type DB,type PaperInput,hydrate,upsertPaperRecord} from './core.ts';
import {journalWhere} from './journals.ts';
import {paperSortFields} from '../shared/paper-sort.ts';
export const listSchema=z.object({
 folder:z.string().default('inbox'),
 q:z.string().max(500).default(''),
 filter:z.enum(['all','unread','read','ready']).default('all'),
 sort:z.enum([...paperSortFields,'published']).default('indexed_at').transform(value=>value==='published'?'indexed_at':value),
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
   FROM papers p WHERE ${journalWhere(db)}`).get(Number(aiConfigured()));
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
   AND archive_origin IS NOT 'manual'
   AND NOT EXISTS (SELECT 1 FROM paper_subscriptions WHERE paper_id=papers.id)`).run(id);
}

export function listPapers(db:DB,opts:ListOptions){
 const where:string[]=[journalWhere(db)];const args:(string|number)[]=[];
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
 if(opts.q){const pattern='%'+opts.q.replace(/[\\%_]/g,'\\$&')+'%';where.push("(p.title LIKE ? ESCAPE '\\' OR p.title_zh LIKE ? ESCAPE '\\' OR p.authors LIKE ? ESCAPE '\\' OR p.journal LIKE ? ESCAPE '\\' OR p.abstract LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR json_extract(p.digest,'$.title_zh') LIKE ? ESCAPE '\\')");for(let i=0;i<7;i++)args.push(pattern);}
 const sqlWhere=where.join(' AND ');
 const total=Number(db.prepare(`SELECT COUNT(*) AS n FROM papers p WHERE ${sqlWhere}`).get(...args)!.n);
 const pages=Math.max(1,Math.ceil(total/opts.page_size)),page=Math.min(opts.page,pages);
 // MEDLINE 文字日期只用明确记录的年份排序，保留显示时的原文。
 const sortDate=opts.sort==='publication_date'
  ? "CASE WHEN p.publication_date GLOB '[0-9][0-9][0-9][0-9] *' THEN substr(p.publication_date,1,4) ELSE p.publication_date END"
  : `p.${opts.sort}`;
 const rows=db.prepare(`SELECT p.id,p.title,p.title_zh,p.title_status,p.journal,p.publication_date,p.published,p.indexed_at,p.received_at,p.is_read,p.starred,(p.archived=1 OR p.in_library=0) AS archived,p.in_library,p.archive_origin,p.digest_status,p.source,p.pmcid,p.impact_factor,p.jif_label,p.jif_status,p.cas_zone,p.metric_year,p.metric_edition,p.metric_match
   FROM papers p WHERE ${sqlWhere}
   ORDER BY ${sortDate} DESC,p.id DESC LIMIT ? OFFSET ?`).all(...args,opts.page_size,(page-1)*opts.page_size);
 const topics=db.prepare('SELECT s.id,s.name,s.color FROM subscriptions s JOIN paper_subscriptions ps ON ps.subscription_id=s.id WHERE ps.paper_id=? ORDER BY s.rowid');
 const items=rows.map(row=>({
  ...row,
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
export function getPaper(db:DB,id:string){const row=db.prepare('SELECT * FROM papers WHERE id=?').get(id);return row?hydrate(db,row):null;}
export function topicCounts(db:DB){return db.prepare(`SELECT s.id,COUNT(*) FILTER (WHERE p.archived=0 AND p.in_library=1 AND ${journalWhere(db)}) AS total,COUNT(*) FILTER (WHERE p.archived=0 AND p.in_library=1 AND p.is_read=0 AND ${journalWhere(db)}) AS unread FROM subscriptions s LEFT JOIN paper_subscriptions ps ON ps.subscription_id=s.id LEFT JOIN papers p ON p.id=ps.paper_id GROUP BY s.id`).all();}
export function saveSubscription(db:DB,id:string,s:{name:string;query:string;color:string;enabled:boolean;description:string;query_explanation:string},matches:string[],papers:PaperInput[]=[],now=new Date().toISOString()){
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('INSERT INTO subscriptions(id,name,query,color,enabled,description,query_explanation) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,query=excluded.query,color=excluded.color,enabled=excluded.enabled,description=excluded.description,query_explanation=excluded.query_explanation').run(id,s.name,s.query,s.color,Number(s.enabled),s.description,s.query_explanation);
  db.prepare("DELETE FROM paper_subscriptions WHERE subscription_id=? AND paper_id IN (SELECT id FROM papers WHERE source='pubmed')").run(id);
  db.prepare("DELETE FROM relevance_reviews WHERE subscription_id=? AND paper_id NOT IN (SELECT paper_id FROM paper_subscriptions WHERE subscription_id=?)").run(id,id);
  let added=0;
  for(const paper of papers){if(upsertPaperRecord(db,paper,now))added++;db.prepare("UPDATE papers SET in_library=1 WHERE id=? AND source='pubmed'").run(paper.id);}
  for(const paperId of matches){db.prepare('INSERT OR IGNORE INTO paper_subscriptions VALUES(?,?)').run(paperId,id);db.prepare("INSERT OR IGNORE INTO relevance_reviews(paper_id,subscription_id,status) VALUES(?,?,'pending')").run(paperId,id);}
  db.exec('COMMIT');
  return {added,matched:matches.length};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
