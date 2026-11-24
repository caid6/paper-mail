import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,readdirSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect,upsertPaper} from '../server/core.ts';
import {uploadDocument,documentState,ensureDocument,chatHistory,askDocument} from '../server/documents.ts';

const paper={id:'pmid:777',source:'pubmed',title:'Clinical foundation models',doi:'10.1234/testing',abstract:'Abstract only',authors:[],categories:[],published:'2026-11-20',updated:'2026-11-20',url:'https://pubmed.ncbi.nlm.nih.gov/777/',pdf_url:''};
function fixture(){
 const db=connect(':memory:');upsertPaper(db,paper,'medical-ai');
 db.prepare("INSERT INTO downloads(paper_id,status,created_at) VALUES(?,'needs_browser','now')").run(paper.id);
 const root=mkdtempSync(path.join(tmpdir(),'paper-document-'));symlinkSync(path.resolve('scripts'),path.join(root,'scripts'));
 const bytes=execFileSync('/opt/homebrew/bin/python3',['-c',[
  'import sys, io','from pypdf import PdfWriter',
  'from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject',
  'writer=PdfWriter()','page=writer.add_blank_page(width=600,height=800)',
  "font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})",
  "page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})",
  'stream=DecodedStreamObject()',
  "stream.set_data(b'BT /F1 12 Tf 20 740 Td (Clinical foundation models. DOI: 10.1234/testing) Tj 0 -20 Td (Methods included 100 patients.) Tj ET')",
  "page[NameObject('/Contents')]=stream",
  "writer.add_metadata({'/Title':'Clinical foundation models'})",'writer.add_blank_page(width=600,height=800)','buffer=io.BytesIO()','writer.write(buffer)','sys.stdout.buffer.write(buffer.getvalue())',
 ].join('\n')]);
 return {db,root,bytes,close(){db.close();rmSync(root,{force:true,recursive:true});}};
}
test('自动下载失败后的手工 PDF 与自动 PDF 进入同一全文状态，重复打开保留问答',async()=>{
 const f=fixture();
 try{
  const state:any=await uploadDocument(f.db,f.root,paper.id,f.bytes);
  assert.equal(state.download.source,'manual-upload');assert.equal(state.document.status,'ready');assert.equal(state.document.page_count,2);assert.deepEqual(state.document.unreadable_pages,[2]);
  const doc:any=f.db.prepare('SELECT * FROM pdf_documents').get();assert.match(JSON.parse(doc.pages)[0].text,/100 patients/);
  f.db.prepare("INSERT INTO paper_chats(paper_id,sha256,question,answer,model,created_at) VALUES(?,?,?,?,?,'now')").run(paper.id,doc.sha256,'方法？',JSON.stringify({paragraphs:[],missing:''}),'test-model');
  await ensureDocument(f.db,f.root,paper.id);
  assert.equal(chatHistory(f.db,paper.id).length,1);
  await assert.rejects(uploadDocument(f.db,f.root,paper.id,f.bytes),/自动获取未成功/);
 }finally{f.close();}
});
test('重复打开保留自动下载失败状态，文件缺失时允许手工上传恢复',async()=>{
 const f=fixture();
 try{
  await ensureDocument(f.db,f.root,paper.id);
  await ensureDocument(f.db,f.root,paper.id);
  assert.equal(documentState(f.db,f.root,paper.id).download.status,'needs_browser');
  await uploadDocument(f.db,f.root,paper.id,f.bytes);
  const file:any=f.db.prepare('SELECT file_name FROM downloads WHERE paper_id=?').get(paper.id);
  unlinkSync(path.join(f.root,'data','downloads','777',file.file_name));
  const missing=await ensureDocument(f.db,f.root,paper.id);
  assert.equal(missing.download.status,'interrupted');assert.equal(missing.document.status,'missing');
  assert.equal((await uploadDocument(f.db,f.root,paper.id,f.bytes)).document.status,'ready');
 }finally{f.close();}
});
test('错误格式和不属于本篇的 PDF 上传不能覆盖文献或写入全文',async()=>{
 const f=fixture();
 try{
  await assert.rejects(uploadDocument(f.db,f.root,paper.id,Buffer.from('html')),/PDF/);
  f.db.prepare("UPDATE papers SET title='Other article',doi='10.9999/other' WHERE id=?").run(paper.id);
  await assert.rejects(uploadDocument(f.db,f.root,paper.id,f.bytes),(error:any)=>error.status===422&&/DOI/.test(error.message));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pdf_documents').get()!.n,0);
  assert.equal(documentState(f.db,f.root,paper.id).download.status,'needs_browser');
  assert.equal(readdirSync(path.join(f.root,'data','downloads','777')).length,0);
 }finally{f.close();}
});
test('旧版结构化回答转为普通文字，保留原有对话内容',async()=>{
 const f=fixture();
 try{
  await uploadDocument(f.db,f.root,paper.id,f.bytes);
  const doc:any=f.db.prepare('SELECT sha256 FROM pdf_documents').get();
  f.db.prepare("INSERT INTO paper_chats(paper_id,sha256,question,answer,model,created_at) VALUES(?,?,?,?,?,'now')").run(paper.id,doc.sha256,'方法？',JSON.stringify({paragraphs:[{text:'原回答',citations:[{page:1,quote:'原文'}]}],missing:'未报告的信息'}),'old-model');
  assert.equal(chatHistory(f.db,paper.id)[0].answer,'原回答\n\n未报告的信息');
 }finally{f.close();}
});
test('全文问答直接使用普通 API 对话，完整发送长正文和历史，不要求引用格式',async()=>{
 const f=fixture();const original=globalThis.fetch;
 try{
  await uploadDocument(f.db,f.root,paper.id,f.bytes);
  const longText='Start of full document.\n'+'Full text content. '.repeat(15000)+'\nEND OF DOCUMENT';
  f.db.prepare('UPDATE pdf_documents SET pages=? WHERE paper_id=?').run(JSON.stringify([{page:1,text:longText},{page:2,text:''}]),paper.id);
  const config={provider:'compatible' as const,base_url:'https://models.example/v1',model:'selected-model',figure_model:'vision',key:'test'};
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
   calls++;const body=JSON.parse(String(options?.body));
   assert.equal(body.model,'selected-model');assert.equal(body.max_tokens,20000);
   assert.equal(body.response_format,undefined);assert.equal(body.messages[1].role,'user');
   assert.ok(body.messages[1].content.includes(longText));assert.match(body.messages[1].content,/PDF 第 2 页/);
   assert.equal(body.messages.length,calls===1?3:5);
   if(calls>1){assert.equal(body.messages[2].content,'研究纳入了多少人？');assert.equal(body.messages[3].content,'## 研究方法\n\n按你的问题直接分析。');}
   if(calls===2)return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'incomplete'}}]}));
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'## 研究方法\n\n按你的问题直接分析。'}}]}));
  };
  const chat=await askDocument(f.db,paper.id,'研究纳入了多少人？',config);
  assert.equal(chat.length,1);assert.equal(chat[0].model,'selected-model');assert.equal(chat[0].answer,'## 研究方法\n\n按你的问题直接分析。');
  await assert.rejects(askDocument(f.db,paper.id,'请继续分析。',config),/长度上限/);
  assert.equal(chatHistory(f.db,paper.id).length,1);
  assert.equal((await askDocument(f.db,paper.id,'请继续分析。',config)).length,2);
 }finally{globalThis.fetch=original;f.close();}
});
