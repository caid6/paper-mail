import test from 'node:test';
import assert from 'node:assert/strict';
import {connectTestLibrary} from './helpers/library.ts';
import {crossrefPaper,importPaper,parseLookup} from '../server/manual-import.ts';
import {setSetting,upsertPaper} from '../server/core.ts';
import {listPapers,listSchema,recordQualityRemoval,setArchive} from '../server/library.ts';
import {replaceLibrary} from '../server/initialization.ts';
import {queueReadingPreparation} from '../server/reading-preparation.ts';

const work={
 DOI:'10.1038/demo',type:'journal-article',title:['A medical model &amp; its evaluation'],
 abstract:'<jats:title>Abstract</jats:title><jats:p>Authors describe a model.</jats:p>',
 'container-title':['An example journal'],published:{'date-parts':[[2026,11]]},
 deposited:{'date-time':'2026-11-23T02:25:00Z'},
 author:[{given:'A',family:'Author'}],
};

test('识别题目、PMID、DOI 和 DOI 链接，并保留登记来源与日期精度',()=>{
 assert.deepEqual(parseLookup(' PMID: 1234 '),{kind:'pmid',value:'1234'});
 assert.deepEqual(parseLookup('https://doi.org/10.1038/DEMO'),{kind:'doi',value:'10.1038/demo'});
 assert.deepEqual(parseLookup('10.1038/DEMO'),{kind:'doi',value:'10.1038/demo'});
 assert.deepEqual(parseLookup('A title with PMID inside'),{kind:'title',value:'A title with PMID inside'});
 assert.throws(()=>parseLookup('DOI: 1234'),/完整的 DOI/);
 assert.throws(()=>parseLookup('PMID: abcd'),/一串数字/);
 const paper=crossrefPaper(work)!;
 assert.equal(paper.abstract,'Authors describe a model.');
 assert.equal(paper.title,'A medical model & its evaluation');
 assert.equal(paper.publication_date,'2026-11');
 assert.equal(paper.indexed_at,undefined);
 assert.equal(paper.url,'https://doi.org/10.1038/demo');
 assert.equal(crossrefPaper({...work,type:'book'}),null);
});

test('手动加入的论文独立于订阅条件，并进入阅读准备队列',()=>{
 const db=connectTestLibrary();
 try{
  setSetting(db,'min_impact_factor','10');
  const paper=crossrefPaper(work)!;
  const time='2026-11-26T04:00:00.000Z';
  const {id,status}=importPaper(db,paper,time);
  assert.equal(status,'added');
  assert.deepEqual(importPaper(db,paper),{id,status:'existing'});
  recordQualityRemoval(db,id);
  const run=db.prepare("INSERT INTO sync_runs(started_at,kind,status) VALUES(?,'initialize','running')").run(time);
  replaceLibrary(db,[],{
   start:'2026-11-25',end:'2026-11-26',range:'custom',date_field:'crdt',limit:50,quality_enabled:true,min_impact_factor:10,
  },time,'2026-11-26',run.lastInsertRowid);
  const inbox=listPapers(db,listSchema.parse({q:'10.1038/demo'}));
  assert.equal(inbox.total,1);
  assert.equal(inbox.items[0].received_at,time);
  queueReadingPreparation(db);
  assert.equal(db.prepare('SELECT status FROM downloads WHERE paper_id=?').get(id)?.status,'pending');
  setArchive(db,id,true);
  assert.deepEqual(importPaper(db,paper),{id,status:'restored'});
 }finally{db.close();}
});

test('后来进入 PubMed 的同 DOI 文章沿用本机 ID 和阅读记录',()=>{
 const db=connectTestLibrary();
 try{
  const paper=crossrefPaper(work)!;
  const {id}=importPaper(db,paper);
  db.prepare("UPDATE papers SET note='已读笔记',is_read=1 WHERE id=?").run(id);
  const pubmed={...paper,id:'pmid:1234',doi:'10.1038/DEMO',source:'pubmed',url:'https://pubmed.ncbi.nlm.nih.gov/1234/',abstract:'',updated:'2026-11-20'};
  assert.equal(upsertPaper(db,pubmed,'topic-a'),false);
  const saved=db.prepare('SELECT id,source,pmid,note,is_read,abstract FROM papers').all();
  assert.equal(saved.length,1);
  assert.deepEqual({...saved[0]},{id,source:'pubmed',pmid:'1234',note:'已读笔记',is_read:1,abstract:paper.abstract});
  assert.equal(listPapers(db,listSchema.parse({folder:'sub:topic-a',q:'1234'})).items[0].id,id);
  assert.deepEqual(importPaper(db,paper),{id,status:'existing'});
 }finally{db.close();}
});
