import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect,upsertPaper} from '../server/core.ts';
import {downloadState,downloadedPath} from '../server/downloads.ts';
test('only completed local PDFs can be served and private filenames never enter state responses',()=>{
 const db=connect(':memory:');const root=mkdtempSync(path.join(tmpdir(),'paper-download-test-'));
 try{
  upsertPaper(db,{id:'pmid:123',title:'Clinical paper',abstract:'Abstract',authors:[],categories:[],published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/123/',pdf_url:'',source:'pubmed'},'medical-ai');
  assert.equal(downloadState(db,'pmid:123').status,'idle');
  db.prepare("INSERT INTO downloads(paper_id,status,file_name,created_at) VALUES('pmid:123','running','paper.pdf','now')").run();
  assert.equal(downloadedPath(db,root,'pmid:123'),null);
  const dir=path.join(root,'data','downloads','123');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'paper.pdf'),'%PDF-1.4\n');
  db.prepare("UPDATE downloads SET status='ready'").run();
  assert.equal(downloadedPath(db,root,'pmid:123'),path.join(dir,'paper.pdf'));
  assert.equal(JSON.stringify(downloadState(db,'pmid:123')).includes('file_name'),false);
  db.prepare("UPDATE downloads SET file_name='../../../secret.env'").run();
  assert.equal(downloadedPath(db,root,'pmid:123'),null);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('逐来源下载诊断写入状态且不泄露本地文件名',()=>{
 const db=connect(':memory:');
 const attempts=[{source:'Europe PMC 开放全文',status:'not_available',detail:'该记录未标记开放获取'}];
 try{
  upsertPaper(db,{id:'pmid:124',title:'Open paper',abstract:'Abstract',authors:[],categories:[],published:'2026-11-18',updated:'2026-11-18',url:'https://pubmed.ncbi.nlm.nih.gov/124/',pdf_url:'',source:'pubmed'},'medical-ai');
  db.prepare("INSERT INTO downloads(paper_id,status,source_url,attempts,created_at) VALUES(?,'unavailable','https://publisher.example/pdf?token=private',?,'now')").run('pmid:124',JSON.stringify(attempts));
  assert.deepEqual(downloadState(db,'pmid:124').attempts,attempts);
  assert.equal(JSON.stringify(downloadState(db,'pmid:124')).includes('file_name'),false);
  assert.equal(JSON.stringify(downloadState(db,'pmid:124')).includes('private'),false);
 }finally{db.close();}
});
