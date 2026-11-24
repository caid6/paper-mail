import test from 'node:test';
import assert from 'node:assert/strict';
import {matchJournal,journalRestriction,eligibleJournalIssns,journalInfo,resolveJournal,categoryJournals,journalFilter,passesJournal} from '../server/journals.ts';
import {connect,upsertPaper,setSetting} from '../server/core.ts';
import {listPapers,listSchema,topicCounts} from '../server/library.ts';
import {validateSearchErrors,prepareJournalSearch,fetchPubmed} from '../server/pubmed.ts';
test('ISSN wins over title, corrections apply, missing/ambiguous journal remains unknown',()=>{
 assert.equal(matchJournal('unrelated title',['0028-4793']).metric_match,'issn');
 assert.equal(matchJournal('ACADEMIC MEDICINE',['1040-2446']).impact_factor,5);
 assert.equal(matchJournal('ACADEMIC MEDICINE',['1040-2446']).metric_source,'Clarivate 2026-10-14 修正');
 assert.equal(journalInfo.jif_year,2025);
 assert.equal(matchJournal('Nature Biotechnology',['1546-1696']).impact_factor,44.5);
 assert.equal(matchJournal('Nature Medicine').impact_factor,52.3);
 assert.equal(matchJournal('Annals of translational medicine').impact_factor,null);
 assert.equal(matchJournal('Nature').metric_match,'title');
 assert.equal(matchJournal('Journal of Computer Science and Technology').metric_match,'ambiguous');
 assert.equal(matchJournal('almost nature medicine journal').impact_factor,null);
});
test('large journal sets use NCBI History and preserve every journal and the research query',async()=>{
 const original=globalThis.fetch;const batches:string[]=[];let calls=0;
 try{
  globalThis.fetch=async(_url,options)=>{
   const body=new URLSearchParams(String(options?.body));calls++;
   if(body.get('usehistory')==='y'){
    if(body.get('term')!.includes('#1')){
     assert.equal(body.get('sort'),'most recent');
     assert.equal(body.get('WebEnv'),'journal-session');
     return new Response(JSON.stringify({esearchresult:{count:'0',idlist:[]}}));
    }
    if(calls>1)assert.equal(body.get('WebEnv'),'journal-session');
    const terms=body.get('term')!.split(' OR ');assert.ok(terms.length<=400);batches.push(...terms);
    return new Response(JSON.stringify({esearchresult:{webenv:'journal-session',querykey:String(calls),errorlist:{phrasesnotfound:[terms[0].replace('[Journal]','')],fieldsnotfound:[]}}}));
   }
   assert.equal(body.get('WebEnv'),'journal-session');assert.equal(body.get('usehistory'),'y');assert.match(body.get('term')!,/^\(clinical\[Title\/Abstract\]\) AND \(#1 OR /);
   return new Response(JSON.stringify({esearchresult:{count:'0',idlist:[]}}));
  };
  const context=await prepareJournalSearch(10);
  assert.equal(new Set(batches).size,eligibleJournalIssns(10).length);
  assert.deepEqual(await fetchPubmed(`(clinical[Title/Abstract]) AND ${context.restriction}`,8,[],context.webEnv),[]);
 }finally{globalThis.fetch=original;}
});
test('threshold is inclusive, hides unknown journals, applies before pagination and keeps private data',()=>{
 const db=connect(':memory:');for(const [id,journal] of [['1','Nature Medicine'],['2','Journal of medical Internet research'],['3','Unknown journal']])upsertPaper(db,{id:'pmid:'+id,title:'Clinical study',journal,abstract:'Evidence',authors:[],categories:[],source:'pubmed',published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/'+id,pdf_url:''},'medical-ai');
 db.prepare("UPDATE papers SET note='my note',starred=1,is_read=1 WHERE id='pmid:2'").run();
 setSetting(db,'min_impact_factor','10');assert.equal(listPapers(db,listSchema.parse({})).total,1);assert.equal(topicCounts(db).find((x:any)=>x.id==='medical-ai')!.total,1);
 setSetting(db,'min_impact_factor','52.3');assert.equal(listPapers(db,listSchema.parse({})).total,1);
 setSetting(db,'min_impact_factor','52.4');assert.equal(listPapers(db,listSchema.parse({})).total,0);
 setSetting(db,'min_impact_factor','');assert.equal(listPapers(db,listSchema.parse({})).total,3);assert.equal(db.prepare("SELECT note FROM papers WHERE id='pmid:2'").get()!.note,'my note');db.close();
});
test('retrieval uses only authority ISSNs and NCBI missing ISSN handling does not hide user errors',()=>{
 assert.equal(journalRestriction('clinical[Title/Abstract]',null),'clinical[Title/Abstract]');
 assert.match(journalRestriction('clinical[Title/Abstract]',50),/clinical\[Title\/Abstract\]\) AND \(/);
 assert.throws(()=>journalRestriction('clinical',1000),/没有达到/);
 assert.doesNotThrow(()=>validateSearchErrors({esearchresult:{errorlist:{phrasesnotfound:['1234-5678'],fieldsnotfound:[]}}},['1234-5678']));
 assert.throws(()=>validateSearchErrors({esearchresult:{errorlist:{phrasesnotfound:['not a keyword']}}},['1234-5678']),/未识别/);
 assert.throws(()=>validateSearchErrors({esearchresult:{errorlist:{fieldsnotfound:['wrongfield']}}}),/未识别/);
 assert.throws(()=>validateSearchErrors({esearchresult:{warninglist:{outputmessages:['Wrong subquery #1']}}}),/历史检索集合无效/);
});

test('confirmed journals intersect with the IF threshold in stored papers and PubMed ISSNs',async()=>{
 const db=connect(':memory:');
 try{
  for(const [id,journal] of [['1','Nature Medicine'],['2','Nature Biotechnology'],['3','LANCET']]){
   upsertPaper(db,{id:'pmid:'+id,title:'Clinical study',journal,abstract:'Evidence',authors:[],categories:[],source:'pubmed',published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/'+id,pdf_url:''},'medical-ai');
  }
  const ids=[resolveJournal('Nature Medicine')!,resolveJournal('Nature Biotechnology')!];
  setSetting(db,'journal_filter_ids',JSON.stringify(ids));
  setSetting(db,'min_impact_factor','50');
  assert.deepEqual(listPapers(db,listSchema.parse({})).items.map(p=>p.id),['pmid:1']);
  assert.equal(topicCounts(db).find(x=>x.id==='medical-ai')!.total,1);
  assert.deepEqual(eligibleJournalIssns(50,ids).sort(),['1078-8956','1546-170X']);
  assert.equal((await prepareJournalSearch(100,ids)).empty,true);
  setSetting(db,'min_impact_factor','');
  assert.equal(listPapers(db,listSchema.parse({})).total,2);
  assert.equal(resolveJournal('The BMJ'),'0959535X');
  assert.ok(categoryJournals('GASTROENTEROLOGY & HEPATOLOGY',true).includes(resolveJournal('Gut')!));
 }finally{db.close();}
});

test('strict minimum excludes a journal rated exactly 10 from the inbox and NCBI History query',async()=>{
 const db=connect(':memory:');
 const originals=globalThis.fetch;
 try{
  const ids=['Journal of Infection','Nature Medicine'].map(name=>resolveJournal(name)!);
  for(const [id,journal] of [['1','Journal of Infection'],['2','Nature Medicine']]){
   upsertPaper(db,{id:'pmid:'+id,title:'Clinical study',journal,abstract:'Evidence',authors:[],categories:[],source:'pubmed',published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/'+id,pdf_url:''},'medical-ai');
  }
  setSetting(db,'journal_filter_ids',JSON.stringify(ids));
  setSetting(db,'min_impact_factor','10');
  assert.equal(listPapers(db,listSchema.parse({})).total,2,'existing preferences include the limit');
  setSetting(db,'min_impact_operator','gt');
  assert.equal(listPapers(db,listSchema.parse({})).total,1);
  const active=journalFilter(db);
  assert.equal(passesJournal(matchJournal('Journal of Infection'),active),false);
  assert.equal(passesJournal(matchJournal('Nature Medicine'),active),true);
  let requested=false;
  globalThis.fetch=async(_input,request)=>{
   requested=true;
   const term=new URLSearchParams(String(request?.body)).get('term');
   assert.equal(term,'1078-8956[Journal] OR 1546-170X[Journal]');
   return Response.json({esearchresult:{webenv:'strict',querykey:'1'}});
  };
  assert.equal((await prepareJournalSearch(active.threshold!.value,active.ids,active.threshold!.operator)).webEnv,'strict');
  assert.equal(requested,true);
 }finally{globalThis.fetch=originals;db.close();}
});

test('suppressed JIF and verified supplemental journal identities carry no numeric substitute',()=>{
 assert.equal(journalInfo.nature_verified,104);
 assert.equal(journalInfo.suppressed_count,8);
 assert.equal(matchJournal('Action Learning').jif_status,'suppressed');
 const supplemental=matchJournal('', ['3004-9806']);
 assert.equal(supplemental.journal_id,'30049806');
 assert.equal(supplemental.metric_year,null);
 assert.equal(supplemental.impact_factor,null);
 assert.equal(supplemental.jif_status,'no_catalog_jif');
 assert.equal(passesJournal(supplemental,{threshold:{value:10,operator:'gt'},ids:['30049806']}),false);
 assert.equal(passesJournal(supplemental,{threshold:null,ids:['30049806']}),true);
});
