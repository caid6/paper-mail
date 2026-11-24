import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionDateClause} from '../server/subscription-refresh.ts';
import {connect,upsertPaper} from '../server/core.ts';
import {saveSubscription,listPapers,listSchema,topicCounts} from '../server/library.ts';

test('方向更新覆盖原初始化窗口和之后的每日窗口，不把远期旧文献重新纳入',()=>{
 const prefs={library_initialized_on:'2026-11-20',initialize_start:'2026-10-21',initialize_end:'2026-11-20',initialize_date_field:'crdt',timezone:'Asia/Shanghai'};
 assert.equal(subscriptionDateClause(prefs,new Date('2026-11-22T23:30:00Z')),'(2026/10/21:2026/11/20[crdt]) OR (2026/11/20:2026/11/23[crdt])');
 assert.equal(subscriptionDateClause({...prefs,initialize_start:'2025-01-01',initialize_end:'2025-02-01',initialize_date_field:'pdat'},new Date('2026-11-23T00:00Z')),'(2025/01/01:2025/02/01[pdat]) OR (2026/11/20:2026/11/23[crdt])');
 assert.equal(subscriptionDateClause({}), '');
});
const paper={id:'pmid:1',source:'pubmed',title:'Clinical agents',abstract:'Study',authors:[],categories:[],published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/1/',pdf_url:''};
const topic={name:'医疗智能体',query:'agentic[tiab]',color:'#4477aa',enabled:true,description:'Medical agents',query_explanation:'test query'};
test('更新单个方向的结果与检索式一起提交，去重并保留其他方向和个人记录',()=>{
 const db=connect(':memory:');
 try{
  upsertPaper(db,paper,'medical-ai');db.prepare("UPDATE papers SET is_read=1,starred=1,note='笔记' WHERE id=?").run(paper.id);
  const result=saveSubscription(db,'agents',topic,['pmid:1','pmid:2'],[paper,{...paper,id:'pmid:2'}]);
  assert.equal(result.added,1);assert.equal(listPapers(db,listSchema.parse({folder:'sub:agents'})).total,2);
  assert.deepEqual(topicCounts(db).find(r=>r.id==='agents'),Object.assign(Object.create(null),{id:'agents',total:2,unread:1}));
  const saved:any=db.prepare('SELECT is_read,starred,note FROM papers WHERE id=?').get(paper.id);
  assert.equal(saved.is_read,1);assert.equal(saved.starred,1);assert.equal(saved.note,'笔记');
  assert.equal(db.prepare("SELECT count(*) n FROM paper_subscriptions WHERE subscription_id='medical-ai'").get()!.n,1);
 }finally{db.close();}
});
test('方向更新中写入失败会回滚检索式、新论文与标签',()=>{
 const db=connect(':memory:');
 try{
  saveSubscription(db,'agents',{...topic,query:'previous query'},[]);
  upsertPaper(db,paper,'agents');
  const old:any=db.prepare("SELECT query FROM subscriptions WHERE id='agents'").get();
  db.exec("CREATE TRIGGER fail_new_paper BEFORE INSERT ON papers WHEN NEW.id='pmid:2' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>saveSubscription(db,'agents',topic,['pmid:1','pmid:2'],[{...paper,id:'pmid:2'}]),/test failure/);
  assert.equal(db.prepare("SELECT query FROM subscriptions WHERE id='agents'").get()!.query,old.query);
  assert.equal(db.prepare('SELECT count(*) n FROM papers').get()!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM paper_subscriptions WHERE subscription_id='agents'").get()!.n,1);
 }finally{db.close();}
});
