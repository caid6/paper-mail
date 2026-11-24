import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,upsertPaper} from '../server/core.ts';
import {listPapers,listSchema,saveSubscription} from '../server/library.ts';
function library(){const db=connect(':memory:');for(let i=1;i<=37;i++)upsertPaper(db,{id:'pmid:'+i,title:'Clinical model '+i,abstract:'Study abstract',authors:['Author'],categories:[],published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/'+i,pdf_url:'',source:'pubmed',journal:i%2?'Journal A':'Journal B'},'medical-ai');return db;}
test('分页覆盖所有论文且页面不重复，列表只返回必要字段',()=>{const db=library();const ids:string[]=[];for(let page=1;page<=3;page++){const r=listPapers(db,listSchema.parse({page,page_size:15}));assert.equal(r.total,37);assert.equal(r.pages,3);assert.equal(r.items.length,page===3?7:15);assert.equal('abstract' in r.items[0],false);ids.push(...r.items.map(x=>String(x.id)));}assert.equal(new Set(ids).size,37);assert.equal(listPapers(db,listSchema.parse({page:100})).page,3);db.close();});
test('已读、未读、期刊搜索和文件夹过滤均在服务端执行',()=>{const db=library();db.prepare("UPDATE papers SET is_read=1 WHERE id IN ('pmid:1','pmid:2')").run();db.prepare("UPDATE papers SET archived=1 WHERE id='pmid:3'").run();assert.equal(listPapers(db,listSchema.parse({filter:'unread'})).total,34);assert.equal(listPapers(db,listSchema.parse({filter:'read'})).total,2);assert.equal(listPapers(db,listSchema.parse({q:'Journal B'})).total,18);assert.equal(listPapers(db,listSchema.parse({folder:'archive'})).total,1);assert.equal(listPapers(db,listSchema.parse({q:"' OR 1=1 --"})).total,0);db.close();});
test('多方向只增加标签，方向修改重新关联，私人阅读记录不变',()=>{const db=library();db.prepare("UPDATE papers SET is_read=1,starred=1,note='研究笔记' WHERE id='pmid:1'").run();const topic={name:'交叉方向',query:'new query',description:'我的研究',query_explanation:'逻辑',color:'#3366ff',enabled:true};saveSubscription(db,'cross',topic,['pmid:1','pmid:2']);let r=listPapers(db,listSchema.parse({folder:'sub:cross'}));assert.equal(r.total,2);assert.equal(r.items.find(x=>x.id==='pmid:1')!.subscriptions.length,2);saveSubscription(db,'cross',{...topic,query:'changed'},['pmid:1']);assert.equal(listPapers(db,listSchema.parse({folder:'sub:cross'})).total,1);const p=db.prepare("SELECT * FROM papers WHERE id='pmid:1'").get()!;assert.equal(p.is_read,1);assert.equal(p.starred,1);assert.equal(p.note,'研究笔记');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM papers').get()!.n,37);db.close();});

test('默认按真实收信时间排序，PubMed 日期不同不会掩盖今日收信',()=>{
 const db=library();
 try{
  db.prepare("UPDATE papers SET received_at='2026-11-20T00:00:00Z'").run();
  db.prepare("UPDATE papers SET received_at='2026-11-20T23:30:00Z',published='2026-11-20' WHERE id='pmid:1'").run();
  db.prepare("UPDATE papers SET received_at='2026-11-22T23:30:00Z',published='2026-11-22' WHERE id='pmid:2'").run();
  const r=listPapers(db,listSchema.parse({}));
  assert.equal(r.items[0].id,'pmid:2');assert.equal(r.items[1].id,'pmid:1');
  assert.equal((r.items[0] as any).received_at,'2026-11-22T23:30:00Z');
  assert.equal((r.items[0] as any).published,'2026-11-22');
 }finally{db.close();}
});
