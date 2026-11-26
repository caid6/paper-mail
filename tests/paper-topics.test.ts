import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setSetting,upsertPaper} from '../server/core.ts';
import {replaceLibrary,type Initialization} from '../server/initialization.ts';
import {
 editPaperTopics,getPaper,listPapers,listSchema,paperTopicChangesSchema,recordQualityRemoval,saveSubscription,topicCounts,
} from '../server/library.ts';
import {crossrefPaper,importPaper} from '../server/manual-import.ts';
import {connectTestLibrary as connect} from './helpers/library.ts';

const now='2026-11-26T08:00:00.000Z';
const paper={id:'pmid:1234',source:'pubmed',title:'A clinical benchmark',abstract:'The abstract.',authors:[],categories:[],
 published:'2026-11-25',updated:'2026-11-25',url:'https://pubmed.ncbi.nlm.nih.gov/1234/',pdf_url:''};
const topic={name:'测试方向',query:'evaluation[Title]',color:'#4477aa',enabled:true,description:'',query_explanation:''};
const initialization:Initialization={start:'2026-11-01',end:'2026-11-26',date_field:'crdt',range:'custom',limit:100,
 quality_enabled:true,min_impact_factor:null};

test('手动添加的 DOI 论文可以加多个方向，即使期刊低于订阅阈值也显示在方向列表',()=>{
 const db=connect();
 try{
  setSetting(db,'min_impact_factor','10');
  const {id}=importPaper(db,crossrefPaper({DOI:'10.1038/example',title:['Study'],type:'journal-article'})!,now);
  assert.equal(editPaperTopics(db,id,[{subscription_id:'topic-b',included:true},{subscription_id:'topic-c',included:true}]),true);
  assert.deepEqual(getPaper(db,id)?.subscriptions.map(s=>s.id),['topic-b','topic-c']);
  assert.equal(listPapers(db,listSchema.parse({folder:'sub:topic-b'})).items[0].id,id);
  assert.equal(topicCounts(db).find(r=>r.id==='topic-b')?.total,1);
  assert.deepEqual(getPaper(db,id)?.quality_reviews,[]);
  assert.equal(editPaperTopics(db,id,[{subscription_id:'topic-b',included:false}]),true);
  assert.equal(listPapers(db,listSchema.parse({folder:'sub:topic-b'})).total,0);
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
 }finally{db.close();}
});

test('纠正标签后重新收信、更新订阅、初始化和重启都保留手动增删',()=>{
 const root=mkdtempSync(join(tmpdir(),'paper-mail-topics-')),filename=join(root,'papers.sqlite');
 let db=connect(filename);
 try{
  upsertPaper(db,paper,'topic-a',now);
  db.prepare("UPDATE relevance_reviews SET status='running' WHERE paper_id=?").run(paper.id);
  assert.equal(editPaperTopics(db,paper.id,[{subscription_id:'topic-a',included:false},{subscription_id:'topic-b',included:true}]),true);
  // The result of a review already in flight cannot update or remove the manual choice.
  assert.equal(db.prepare("UPDATE relevance_reviews SET status='complete',verdict='irrelevant' WHERE paper_id=? AND subscription_id=? AND status='running'").run(paper.id,'topic-a').changes,0);
  upsertPaper(db,paper,'topic-a',now);
  saveSubscription(db,'topic-a',topic,[paper.id]);
  saveSubscription(db,'topic-b',topic,[]);
  const run=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES(?,'initialize','running')").run(now);
  replaceLibrary(db,[{subscriptionId:'topic-a',papers:[paper]}],initialization,now,'2026-11-26',run.lastInsertRowid);
  db.close();
  db=connect(filename);
  assert.deepEqual(getPaper(db,paper.id)?.subscriptions.map(s=>s.id),['topic-b']);
  assert.deepEqual(getPaper(db,paper.id)?.quality_reviews,[]);
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
  assert.equal(listPapers(db,listSchema.parse({folder:'sub:topic-a'})).total,0);
  assert.equal(editPaperTopics(db,paper.id,[{subscription_id:'topic-b',included:false}]),true);
  upsertPaper(db,paper,'topic-b',now);
  assert.deepEqual(getPaper(db,paper.id)?.subscriptions,[]);
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('提交已删除或重复的方向时不应用标签变更',()=>{
 const db=connect();
 try{
  upsertPaper(db,paper,'topic-a',now);
  const remove={subscription_id:'topic-a',included:false};
  assert.equal(paperTopicChangesSchema.safeParse([remove,{...remove,included:true}]).success,false);
  assert.equal(editPaperTopics(db,paper.id,[remove,{subscription_id:'missing-topic',included:true}]),false);
  assert.deepEqual(getPaper(db,paper.id)?.subscriptions.map(s=>s.id),['topic-a']);
  db.prepare('DELETE FROM paper_subscriptions WHERE paper_id=?').run(paper.id);
  recordQualityRemoval(db,paper.id);
  assert.equal(getPaper(db,paper.id)?.archive_origin,'quality');
  assert.equal(editPaperTopics(db,paper.id,[{subscription_id:'topic-b',included:true}]),true);
  assert.equal(getPaper(db,paper.id)?.archived,0);
 }finally{db.close();}
});
