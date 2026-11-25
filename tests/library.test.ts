import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect,upsertPaper} from '../server/core.ts';
import {getPaper,listPapers,listSchema,mailboxCounts,recordQualityRemoval,saveSubscription,setArchive} from '../server/library.ts';
function library(){const db=connect(':memory:');for(let i=1;i<=37;i++)upsertPaper(db,{id:'pmid:'+i,title:'Clinical model '+i,abstract:'Study abstract',authors:['Author'],categories:[],published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/'+i,pdf_url:'',source:'pubmed',journal:i%2?'Journal A':'Journal B'},'medical-ai');return db;}
test('分页覆盖所有论文且页面不重复，列表只返回必要字段',()=>{const db=library();const ids:string[]=[];for(let page=1;page<=3;page++){const r=listPapers(db,listSchema.parse({page,page_size:15}));assert.equal(r.total,37);assert.equal(r.pages,3);assert.equal(r.items.length,page===3?7:15);assert.equal('abstract' in r.items[0],false);ids.push(...r.items.map(x=>String(x.id)));}assert.equal(new Set(ids).size,37);assert.equal(listPapers(db,listSchema.parse({page:100,page_size:15})).page,3);db.close();});
test('默认按 PubMed 收录时间排序并显示50篇',()=>{const parsed=listSchema.parse({});assert.equal(parsed.sort,'published');assert.equal(parsed.page_size,50);});
test('已读、未读、期刊搜索和文件夹过滤均在服务端执行',()=>{const db=library();db.prepare("UPDATE papers SET is_read=1 WHERE id IN ('pmid:1','pmid:2')").run();setArchive(db,'pmid:3',true);assert.equal(listPapers(db,listSchema.parse({filter:'unread'})).total,34);assert.equal(listPapers(db,listSchema.parse({filter:'read'})).total,2);assert.equal(listPapers(db,listSchema.parse({q:'Journal B'})).total,18);assert.equal(listPapers(db,listSchema.parse({folder:'archive'})).total,1);assert.equal(listPapers(db,listSchema.parse({q:"' OR 1=1 --"})).total,0);db.close();});

test('归档和移出使用不同的计数，质控保留手动归档与其他方向',()=>{
 const db=library();
 try{
  setArchive(db,'pmid:1',true);
  db.prepare("UPDATE papers SET in_library=0,starred=1,note='保留的笔记' WHERE id='pmid:3'").run();
  db.prepare("DELETE FROM paper_subscriptions WHERE paper_id IN ('pmid:1','pmid:2')").run();
  for(const id of ['pmid:1','pmid:2','pmid:4'])recordQualityRemoval(db,id);
  const archived=listPapers(db,listSchema.parse({folder:'archive'}));
  const removed=listPapers(db,listSchema.parse({folder:'removed'}));
  assert.deepEqual(archived.items.map(p=>[p.id,p.archive_origin]),[['pmid:1','manual']]);
  assert.deepEqual(removed.items.map(p=>[p.id,p.in_library,p.archive_origin]),[['pmid:3',0,null],['pmid:2',1,'quality']]);
  assert.equal(getPaper(db,'pmid:4')!.archived,0);
  assert.equal(mailboxCounts(db)!.archived,1);
  assert.equal(mailboxCounts(db)!.removed,2);
  setArchive(db,'pmid:3',false);
  assert.deepEqual(listPapers(db,listSchema.parse({folder:'removed'})).items.map(p=>p.id),['pmid:2']);
  const restored=getPaper(db,'pmid:3')!;
  assert.equal(restored.archived,0);
  assert.equal(restored.starred,1);
  assert.equal(restored.note,'保留的笔记');
 }finally{db.close();}
});

test('旧数据库归档历史保留，来源未记录的论文仍可恢复',()=>{
 const temp=mkdtempSync(join(tmpdir(),'paper-mail-archive-'));
 const file=join(temp,'papers.sqlite');
 try{
  const prior=connect(file);
  try{
   upsertPaper(prior,{id:'pmid:1',title:'Existing paper',abstract:'Abstract',authors:[],published:'2026-11-18',updated:'2026-11-18',categories:[],url:'',pdf_url:'',source:'pubmed'},'medical-ai');
   prior.exec("ALTER TABLE papers DROP COLUMN archive_origin; UPDATE papers SET archived=1, note='旧笔记' WHERE id='pmid:1'");
  }finally{prior.close();}
  const db=connect(file);
  try{
   assert.equal(listPapers(db,listSchema.parse({folder:'archive'})).total,0);
   assert.equal(listPapers(db,listSchema.parse({folder:'removed'})).items[0].archive_origin,'legacy');
   setArchive(db,'pmid:1',false);
   assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
   assert.equal(getPaper(db,'pmid:1')!.note,'旧笔记');
  }finally{db.close();}
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('论文列表返回独立中文题名并支持中文搜索',()=>{const db=library();db.prepare("UPDATE papers SET title_zh='临床人工智能基础模型' WHERE id='pmid:1'").run();const items=listPapers(db,listSchema.parse({page_size:50})).items;assert.equal((items.find(item=>item.id==='pmid:1') as any).title_zh,'临床人工智能基础模型');assert.equal(listPapers(db,listSchema.parse({q:'人工智能基础模型'})).total,1);db.close();});
test('多方向只增加标签，方向修改重新关联，私人阅读记录不变',()=>{const db=library();db.prepare("UPDATE papers SET is_read=1,starred=1,note='研究笔记' WHERE id='pmid:1'").run();const topic={name:'交叉方向',query:'new query',description:'我的研究',query_explanation:'逻辑',color:'#3366ff',enabled:true};saveSubscription(db,'cross',topic,['pmid:1','pmid:2']);let r=listPapers(db,listSchema.parse({folder:'sub:cross'}));assert.equal(r.total,2);assert.equal(r.items.find(x=>x.id==='pmid:1')!.subscriptions.length,2);saveSubscription(db,'cross',{...topic,query:'changed'},['pmid:1']);assert.equal(listPapers(db,listSchema.parse({folder:'sub:cross'})).total,1);const p=db.prepare("SELECT * FROM papers WHERE id='pmid:1'").get()!;assert.equal(p.is_read,1);assert.equal(p.starred,1);assert.equal(p.note,'研究笔记');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM papers').get()!.n,37);db.close();});

test('切换为收信排序时，真实收信时间不会被 PubMed 日期掩盖',()=>{
 const db=library();
 try{
  db.prepare("UPDATE papers SET received_at='2026-11-20T00:00:00Z'").run();
  db.prepare("UPDATE papers SET received_at='2026-11-20T23:30:00Z',published='2026-11-20' WHERE id='pmid:1'").run();
  db.prepare("UPDATE papers SET received_at='2026-11-22T23:30:00Z',published='2026-11-22' WHERE id='pmid:2'").run();
  const r=listPapers(db,listSchema.parse({sort:'received_at'}));
  assert.equal(r.items[0].id,'pmid:2');assert.equal(r.items[1].id,'pmid:1');
  assert.equal((r.items[0] as any).received_at,'2026-11-22T23:30:00Z');
  assert.equal((r.items[0] as any).published,'2026-11-22');
 }finally{db.close();}
});
