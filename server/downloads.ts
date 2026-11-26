import {checkPython,pythonExecutable} from '../scripts/python-runtime.mjs';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {DB} from './core.ts';
import {readingScope} from './reading-scope.ts';
import {fetchPMCManifest} from './pmc.ts';
const legacySkill=path.join(homedir(),'.codex','skills','paper-download','scripts','download_paper.py');
function installedSkill(){
 const filename=process.env.PAPER_DOWNLOAD_SKILL||legacySkill;
 return existsSync(filename)?filename:null;
}
let checkedPython:string|undefined;
let pdfReady=false;
export function downloadInfo(){
 const python=pythonExecutable();
 if(python!==checkedPython){
  try{checkPython(python,true);pdfReady=true;}catch{pdfReady=false;}
  checkedPython=python;
 }
 return {
  available:pdfReady,
  provider:'Paper-mail',
  institutional:installedSkill()?'已发现本机机构下载器':null,
  note:pdfReady?'已启用公开 PDF 下载。遇到需要登录的原文时，可在浏览器打开或上传 PDF。':'PDF 环境未就绪。请在项目目录运行 npm run setup:python，再重启 Paper-mail。'
 };
}
export function downloadState(db:DB,paperId:string){
 const row=db.prepare('SELECT * FROM downloads WHERE paper_id=?').get(paperId);
 const available=downloadInfo().available;
 if(!row)return {status:available?'idle':'environment_required',file_url:null,attempts:[]};
 let attempts=[];try{attempts=JSON.parse(String(row.attempts||'[]'));}catch{}
 const {file_name,source_url,index_error,automatic, status, ...visible}=row;
 return {...visible,status:status==='pending'&&!available?'environment_required':String(status),attempts,
  file_url:status==='ready'?'/api/papers/'+encodeURIComponent(paperId)+'/pdf':null};
}
function runBridge(root:string,input:unknown):Promise<any>{return new Promise((resolve,reject)=>{
 const child=spawn(pythonExecutable(),[path.join(root,'scripts','download_bridge.py')],{stdio:['pipe','pipe','pipe']});let output='';let expired=false;
 const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},240000);
 child.stdout.on('data',data=>{output+=data;if(output.length>128000)child.kill('SIGKILL');});child.stderr.on('data',()=>{});
 child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动本机全文下载器，请检查 Python 环境'));});
 child.on('close',code=>{clearTimeout(timer);if(expired)return reject(new Error('全文获取超过 4 分钟，请打开出版社页面继续'));if(code!==0)return reject(new Error('本机下载器执行失败，请检查 PDF 环境并运行 npm run setup:python'));try{resolve(JSON.parse(output));}catch{reject(new Error('本机下载器没有返回有效结果'));}});
 child.stdin.end(JSON.stringify(input));
});}
const working=new WeakSet<DB>();
export function requestDownload(db:DB,id:string){
 const p=db.prepare('SELECT source FROM papers WHERE id=?').get(id);if(!p||p.source!=='pubmed')throw new Error('原文下载目前支持 PubMed 文献');
 const current=downloadState(db,id);if(['ready','running'].includes(current.status))return current;
 db.prepare("INSERT INTO downloads(paper_id,status,created_at,attempts) VALUES(?,'pending',?,'[]') ON CONFLICT(paper_id) DO UPDATE SET status='pending',automatic=0,error=NULL,index_error=NULL,handoff_url=NULL,created_at=excluded.created_at,completed_at=NULL,attempts='[]'").run(id,new Date().toISOString());
 return downloadState(db,id);
}
export async function pumpDownloads(db:DB,root:string,onReady?:()=>void){
 if(working.has(db)||!downloadInfo().available)return;
 working.add(db);
 try{for(;;){
  const paper=db.prepare(`SELECT p.id,p.title,p.doi,p.pmcid,t.pdf_url AS prepared_pdf FROM downloads d JOIN papers p ON p.id=d.paper_id LEFT JOIN fulltexts t ON t.paper_id=p.id
    WHERE d.status='pending' AND (d.automatic=0 OR (${readingScope(db)}))
    ORDER BY p.received_at DESC,p.published DESC,p.id DESC LIMIT 1`).get();
  if(!paper)break;
  const id=String(paper.id);
  db.prepare("UPDATE downloads SET status='running' WHERE paper_id=?").run(id);
  try{
   const dir=path.join(root,'data','downloads',id.replace('pmid:',''));mkdirSync(dir,{recursive:true});
   const note=path.join(dir,'manual-handoff.json');if(existsSync(note))unlinkSync(note);
   const pmid=id.replace('pmid:','');
   const pmcid=String(paper.pmcid||'');
   let prepared=String(paper.prepared_pdf||'');
   if(pmcid&&!prepared){
    const manifest=await fetchPMCManifest(pmcid,pmid).catch(()=>null);
    prepared=manifest?.pdf_url||'';
   }
   const result=await runBridge(root,{pmid,title:paper.title,doi:paper.doi,pmcid,prepared_pdf:prepared,skill:installedSkill(),output_dir:dir});
   if(!['ready','needs_browser','unavailable','error'].includes(result.status))throw new Error('全文下载状态无效');
   if(result.status==='ready'){const file=path.resolve(dir,result.file_name);if(path.dirname(file)!==dir||!existsSync(file)||readFileSync(file).subarray(0,5).toString()!=='%PDF-')throw new Error('下载文件未通过 PDF 校验');}
   db.prepare('UPDATE downloads SET status=?,source=?,source_url=?,file_name=?,error=?,handoff_url=?,attempts=?,completed_at=? WHERE paper_id=?').run(result.status,result.source||null,result.source_url||null,result.status==='ready'?result.file_name:null,result.error||null,result.handoff_url||null,JSON.stringify(result.attempts||[]),new Date().toISOString(),id);
   if(result.status==='ready')onReady?.();
  }catch(e:any){db.prepare("UPDATE downloads SET status='error',error=?,completed_at=? WHERE paper_id=?").run(e.message,new Date().toISOString(),id);}
 }}finally{working.delete(db);}
}
export function downloadedPath(db:DB,root:string,id:string){const row:any=db.prepare("SELECT file_name FROM downloads WHERE paper_id=? AND status='ready'").get(id);if(!row?.file_name)return null;const dir=path.join(root,'data','downloads',id.replace('pmid:',''));const file=path.resolve(dir,row.file_name);return path.dirname(file)===dir&&existsSync(file)?file:null;}
