import {z} from 'zod';
import {type DB,type PaperInput,hydrate,upsertPaperRecord} from './core.ts';
import {journalWhere} from './journals.ts';
export const listSchema=z.object({folder:z.string().default('inbox'),q:z.string().max(500).default(''),filter:z.enum(['all','unread','read','ready']).default('all'),sort:z.enum(['published','received_at']).default('published'),page:z.coerce.number().int().min(1).default(1),page_size:z.coerce.number().int().min(5).max(50).default(50)});
export type ListOptions=z.infer<typeof listSchema>;
export function listPapers(db:DB,opts:ListOptions){
 const where:string[]=[journalWhere(db)];const args:(string|number)[]=[];
 if(opts.folder==='inbox')where.push('p.archived=0 AND p.in_library=1');
 else if(opts.folder==='unread')where.push('p.archived=0 AND p.in_library=1 AND p.is_read=0');
 else if(opts.folder==='starred')where.push('p.starred=1');
 else if(opts.folder==='archive')where.push('(p.archived=1 OR p.in_library=0)');
 else if(opts.folder.startsWith('sub:')){where.push('p.archived=0 AND p.in_library=1 AND EXISTS(SELECT 1 FROM paper_subscriptions ps WHERE ps.paper_id=p.id AND ps.subscription_id=?)');args.push(opts.folder.slice(4));}
 else throw new Error('未知文件夹');
 if(opts.filter==='unread')where.push('p.is_read=0');
 if(opts.filter==='read')where.push('p.is_read=1');
 if(opts.filter==='ready')where.push("p.digest_status='ready'");
 if(opts.q){const pattern='%'+opts.q.replace(/[\\%_]/g,'\\$&')+'%';where.push("(p.title LIKE ? ESCAPE '\\' OR p.title_zh LIKE ? ESCAPE '\\' OR p.authors LIKE ? ESCAPE '\\' OR p.journal LIKE ? ESCAPE '\\' OR p.abstract LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR json_extract(p.digest,'$.title_zh') LIKE ? ESCAPE '\\')");for(let i=0;i<7;i++)args.push(pattern);}
 const sqlWhere=where.join(' AND ');
 const total=Number(db.prepare(`SELECT COUNT(*) AS n FROM papers p WHERE ${sqlWhere}`).get(...args)!.n);
 const pages=Math.max(1,Math.ceil(total/opts.page_size)),page=Math.min(opts.page,pages);
 const rows=db.prepare(`SELECT p.id,p.title,p.title_zh,p.title_status,p.journal,p.publication_date,p.published,p.received_at,p.is_read,p.starred,(p.archived=1 OR p.in_library=0) AS archived,p.digest_status,p.source,p.pmcid,p.impact_factor,p.jif_label,p.jif_status,p.cas_zone,p.metric_year,p.metric_edition,p.metric_match FROM papers p WHERE ${sqlWhere} ORDER BY p.${opts.sort} DESC,p.id DESC LIMIT ? OFFSET ?`).all(...args,opts.page_size,(page-1)*opts.page_size);
 const items=rows.map(row=>({...row,id:String(row.id),subscriptions:db.prepare('SELECT s.id,s.name,s.color FROM subscriptions s JOIN paper_subscriptions ps ON ps.subscription_id=s.id WHERE ps.paper_id=? ORDER BY s.rowid').all(row.id as string)}));
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
