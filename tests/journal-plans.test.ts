import test from 'node:test';
import assert from 'node:assert/strict';
import {expandJournalPlan} from '../server/journal-plans.ts';
import {resolveJournal} from '../server/journals.ts';
import {upsertPaper} from '../server/core.ts';
import {connectTestLibrary as connect} from './helpers/library.ts';
import {figureState} from '../server/figures.ts';

test('journal plan expands publisher groups and subject quartiles, then applies exclusions by ISSN',()=>{
 const result=expandJournalPlan({
  include:{groups:['medical_four','cns'],categories:[{name:'GASTROENTEROLOGY & HEPATOLOGY',quartile:'q1'}],names:['Gut','unknown journal']},
  exclude:{groups:[],categories:[],names:['Nature Biotechnology']},
  impact:{operator:'gt',value:10},unresolved:[],interpretation:'CNS、四大刊和胃肠病学与肝病学 Q1',
 });
 const ids=result.journals.map(j=>j.id);
 for(const name of ['NEJM','JAMA','The BMJ','The Lancet','Nature','Science','Cell','Neuron','Gut','Gastroenterology']){
  assert.ok(ids.includes(resolveJournal(name)!),name);
 }
 assert.ok(!ids.includes(resolveJournal('Nature Biotechnology')!));
 assert.equal(ids.length,new Set(ids).size);
 assert.deepEqual(result.unresolved,['unknown journal']);
 assert.deepEqual(result.impact,{operator:'gt',value:10});
 assert.equal(result.catalog_missing_count,0);
});

test('a downloaded publisher PDF without PMCID has a distinct figure status',()=>{
 const db=connect(':memory:');
 try{
  upsertPaper(db,{id:'pmid:1',title:'Clinical study',journal:'Nature Medicine',abstract:'Evidence',authors:[],categories:[],source:'pubmed',published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/1/',pdf_url:''},'topic-a');
  db.prepare("INSERT INTO downloads(paper_id,status,source,created_at) VALUES('pmid:1','ready','publisher-article-pdf','now')").run();
  const state=figureState(db,'pmid:1');
  assert.equal(state.status,'pdf_pending');
  assert.equal(state.pdf_available,true);
  assert.deepEqual(state.figures,[]);
 }finally{db.close();}
});
