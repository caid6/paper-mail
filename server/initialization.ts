import type {ImpactOperator} from '../shared/impact.ts';
import {linkPaper,setSetting,upsertPaperRecord,type DB,type PaperInput} from './core.ts';

export type Initialization={start:string;end:string;range:'7'|'30'|'90'|'180'|'365'|'custom';date_field:'crdt'|'pdat';limit:number;quality_enabled:boolean;min_impact_factor:number|null;min_impact_operator?:ImpactOperator;journal_filter_ids?:string[];journal_filter_description?:string};
export type TopicMatches={subscriptionId:string;papers:PaperInput[]};

export function replaceLibrary(db:DB,groups:TopicMatches[],options:Initialization,now:string,day:string,runId:number|bigint){
 const matched=new Set<string>();
 let added=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  const previous=Number(db.prepare("SELECT COUNT(*) AS n FROM papers WHERE (source='pubmed' OR manual_added=1) AND in_library=1").get()!.n);
  db.prepare("UPDATE papers SET in_library=0 WHERE source='pubmed' AND in_library=1 AND manual_added=0").run();
  const unlink=db.prepare(`DELETE FROM paper_subscriptions WHERE paper_id=?
    AND NOT EXISTS(SELECT 1 FROM paper_topic_overrides o
      WHERE o.paper_id=paper_subscriptions.paper_id AND o.subscription_id=paper_subscriptions.subscription_id)`);
  for(const group of groups){
   for(const paper of group.papers){
    const stored=upsertPaperRecord(db,paper,now);
    if(stored.added)added++;
    if(!matched.has(stored.id)){
     matched.add(stored.id);
     unlink.run(stored.id);
    }
    linkPaper(db,stored.id,group.subscriptionId,options.quality_enabled);
   }
  }
  const activateMatched=db.prepare(`UPDATE papers SET in_library=1 WHERE id=? AND source='pubmed'
    AND (EXISTS(SELECT 1 FROM paper_subscriptions WHERE paper_id=papers.id)
      OR EXISTS(SELECT 1 FROM paper_topic_overrides WHERE paper_id=papers.id))`);
  for(const paperId of matched)activateMatched.run(paperId);
  const inbox=Number(db.prepare("SELECT COUNT(*) AS n FROM papers WHERE (source='pubmed' OR manual_added=1) AND in_library=1 AND archived=0").get()!.n);
  const values={initialize_status:'complete',initialize_start:options.start,initialize_end:options.end,initialize_date_field:options.date_field,
    initialize_matched:matched.size,initialize_inbox:inbox,initialize_previous:previous,initialize_finished_at:now,
    library_initialized_on:day,last_sync:now,min_impact_factor:options.min_impact_factor??'',min_impact_operator:options.min_impact_operator??'gte',quality_enabled:options.quality_enabled,
    ...(options.journal_filter_ids!==undefined?{journal_filter_ids:JSON.stringify(options.journal_filter_ids),journal_filter_description:options.journal_filter_description||''}:{}),
    backfill_range:options.range,backfill_date_field:options.date_field,backfill_limit:options.limit,
    ...(options.range==='custom'?{backfill_start:options.start,backfill_end:options.end}:{backfill_days:options.range})};
  for(const [key,value] of Object.entries(values))setSetting(db,key,String(value));
  db.prepare("UPDATE sync_runs SET finished_at=?,status='success',added=? WHERE id=?").run(now,added,runId);
  db.exec('COMMIT');
  return {matched:matched.size,inbox,added,previous};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
