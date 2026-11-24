import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,upsertPaper,type PaperInput} from '../server/core.ts';
import {replaceLibrary} from '../server/initialization.ts';
import {journalFilter} from '../server/journals.ts';
import {listPapers,listSchema} from '../server/library.ts';

function paper(id:string,date:string):PaperInput{
 return {id:'pmid:'+id,title:'Medical AI study '+id,abstract:'A clinical study.',authors:['A. Author'],categories:[],published:date,updated:date,url:'https://pubmed.ncbi.nlm.nih.gov/'+id+'/',pdf_url:'',source:'pubmed',journal:'Journal A',publication_date:date,indexed_at:date};
}

test('初始化按检索结果重建邮箱范围，归档窗外文献并保留阅读记录',()=>{
 const db=connect(':memory:');
 try{
  const outside=paper('100','2026-08-01'),retained=paper('200','2026-11-10'),added=paper('300','2026-11-18');
  upsertPaper(db,outside,'medical-ai');
  upsertPaper(db,retained,'medical-ai');
  db.prepare("UPDATE papers SET is_read=1,starred=1,note='保留的研究笔记' WHERE id='pmid:200'").run();
  const firstRun=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES('now','initialize','running')").run();
  const options={start:'2026-11-01',end:'2026-11-20',range:'custom' as const,date_field:'crdt' as const,limit:200,quality_enabled:true,min_impact_factor:null};
  const first=replaceLibrary(db,[{subscriptionId:'medical-ai',papers:[retained,added]},{subscriptionId:'medical-foundation',papers:[retained]}],options,'2026-11-20T00:00:00.000Z','2026-11-20',firstRun.lastInsertRowid);
  assert.deepEqual(first,{matched:2,inbox:2,added:1,previous:2});
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,2);
  assert.equal(listPapers(db,listSchema.parse({folder:'archive'})).total,1);
  const preserved=db.prepare("SELECT is_read,starred,note,in_library FROM papers WHERE id='pmid:200'").get() as any;
  assert.equal(preserved.is_read,1);
  assert.equal(preserved.starred,1);
  assert.equal(preserved.note,'保留的研究笔记');
  assert.equal(preserved.in_library,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM paper_subscriptions WHERE paper_id='pmid:200'").get()!.n,2);
  assert.equal(db.prepare("SELECT in_library FROM papers WHERE id='pmid:100'").get()!.in_library,0);

  const secondRun=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES('later','initialize','running')").run();
  const second=replaceLibrary(db,[{subscriptionId:'medical-ai',papers:[added]}],{...options,start:'2026-11-15',min_impact_operator:'gt',min_impact_factor:10},'2026-11-21T00:00:00.000Z','2026-11-21',secondRun.lastInsertRowid);
  assert.deepEqual(second,{matched:1,inbox:1,added:0,previous:2});
  assert.deepEqual(journalFilter(db).threshold,{operator:'gt',value:10});
  db.prepare("UPDATE settings SET value='' WHERE key='min_impact_factor'").run();
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
  assert.equal(listPapers(db,listSchema.parse({folder:'archive'})).total,2);
  assert.equal(db.prepare("SELECT note FROM papers WHERE id='pmid:200'").get()!.note,'保留的研究笔记');

  assert.equal(upsertPaper(db,retained,'medical-ai','2026-11-22T00:00:00.000Z'),true);
  assert.equal(db.prepare("SELECT in_library FROM papers WHERE id='pmid:200'").get()!.in_library,1);
  assert.equal(settingsStatus(db),'2026-11-21');
 }finally{db.close();}
});

test('初始化写入失败时事务回滚并保留现有邮箱范围',()=>{
 const db=connect(':memory:');
 try{
  const existing=paper('400','2026-11-10');
  upsertPaper(db,existing,'medical-ai');
  const run=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES('now','initialize','running')").run();
  assert.throws(()=>replaceLibrary(db,[{subscriptionId:'missing-topic',papers:[paper('500','2026-11-15')]}],{
   start:'2026-11-01',end:'2026-11-20',range:'custom',date_field:'crdt',limit:200,quality_enabled:true,min_impact_factor:null,
  },'2026-11-20T00:00:00.000Z','2026-11-20',run.lastInsertRowid));
  assert.equal(listPapers(db,listSchema.parse({folder:'inbox'})).total,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM papers').get()!.n,1);
  assert.equal(db.prepare("SELECT status FROM sync_runs WHERE id=?").get(run.lastInsertRowid)!.status,'running');
 }finally{db.close();}
});

function settingsStatus(db:ReturnType<typeof connect>){return db.prepare("SELECT value FROM settings WHERE key='library_initialized_on'").get()!.value;}
