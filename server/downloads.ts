import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {DB} from './core.ts';
import {readingScope} from './reading-scope.ts';
const skill=path.join(homedir(),'.codex','skills','paper-download','scripts','download_paper.py');
const python=process.env.PAPER_DOWNLOAD_PYTHON||'/opt/homebrew/bin/python3';
export function downloadInfo(){return {available:existsSync(skill)&&existsSync(python),provider:'paper-download',institutional:'本机钥匙串 · 支持的出版社',note:'依次尝试 PubMed/PMC、Europe PMC、OpenAlex 开放版本、出版社公开 PDF 和支持的机构访问。'};}
export function downloadState(db:DB,paperId:string){const r:any=db.prepare('SELECT * FROM downloads WHERE paper_id=?').get(paperId);if(!r)return {status:'idle',file_url:null,attempts:[]};let attempts=[];try{attempts=JSON.parse(r.attempts||'[]');}catch{}const {file_name:_fileName,source_url:_sourceUrl,attempts:_attempts,index_error:_indexError,automatic:_automatic,...visible}=r;return {...visible,attempts,file_url:r.status==='ready'?'/api/papers/'+encodeURIComponent(paperId)+'/pdf':null};}
function runBridge(root:string,input:unknown):Promise<any>{return new Promise((resolve,reject)=>{
 const child=spawn(python,[path.join(root,'scripts','download_bridge.py')],{stdio:['pipe','pipe','pipe']});let output='';let expired=false;
 const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},240000);
 child.stdout.on('data',data=>{output+=data;if(output.length>128000)child.kill('SIGKILL');});child.stderr.on('data',()=>{});
 child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动本机全文下载器，请检查 Python 环境'));});
 child.on('close',code=>{clearTimeout(timer);if(expired)return reject(new Error('全文获取超过 4 分钟，请打开出版社页面继续'));if(code!==0)return reject(new Error('本机下载器执行失败，请检查 paper-download 技能依赖'));try{resolve(JSON.parse(output));}catch{reject(new Error('本机下载器没有返回有效结果'));}});
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
 if(working.has(db))return;
 working.add(db);
 try{for(;;){
  const paper=db.prepare(`SELECT p.id,p.title,p.doi,p.pmcid,t.pdf_url AS prepared_pdf FROM downloads d JOIN papers p ON p.id=d.paper_id LEFT JOIN fulltexts t ON t.paper_id=p.id
    WHERE d.status='pending' AND (d.automatic=0 OR (${readingScope(db)}))
      AND (d.automatic=0 OR t.status IS NULL OR t.status NOT IN ('pending','loading'))
    ORDER BY p.received_at DESC,p.published DESC,p.id DESC LIMIT 1`).get();
  if(!paper)break;
  const id=String(paper.id);
  if(!downloadInfo().available){
   db.prepare("UPDATE downloads SET status='unavailable',error='本机自动下载器不可用，请上传原文 PDF',completed_at=? WHERE paper_id=?").run(new Date().toISOString(),id);
   continue;
  }
  db.prepare("UPDATE downloads SET status='running' WHERE paper_id=?").run(id);
  try{
   const dir=path.join(root,'data','downloads',id.replace('pmid:',''));mkdirSync(dir,{recursive:true});
   const note=path.join(dir,'manual-handoff.json');if(existsSync(note))unlinkSync(note);
   const result=await runBridge(root,{pmid:id.replace('pmid:',''),title:paper.title,doi:paper.doi,pmcid:paper.pmcid,prepared_pdf:paper.prepared_pdf,skill,output_dir:dir});
   if(!['ready','needs_browser','unavailable','error'].includes(result.status))throw new Error('全文下载状态无效');
   if(result.status==='ready'){const file=path.resolve(dir,result.file_name);if(path.dirname(file)!==dir||!existsSync(file)||readFileSync(file).subarray(0,5).toString()!=='%PDF-')throw new Error('下载文件未通过 PDF 校验');}
   db.prepare('UPDATE downloads SET status=?,source=?,source_url=?,file_name=?,error=?,handoff_url=?,attempts=?,completed_at=? WHERE paper_id=?').run(result.status,result.source||null,result.source_url||null,result.status==='ready'?result.file_name:null,result.error||null,result.handoff_url||null,JSON.stringify(result.attempts||[]),new Date().toISOString(),id);
   if(result.status==='ready')onReady?.();
  }catch(e:any){db.prepare("UPDATE downloads SET status='error',error=?,completed_at=? WHERE paper_id=?").run(e.message,new Date().toISOString(),id);}
 }}finally{working.delete(db);}
}
export function downloadedPath(db:DB,root:string,id:string){const row:any=db.prepare("SELECT file_name FROM downloads WHERE paper_id=? AND status='ready'").get(id);if(!row?.file_name)return null;const dir=path.join(root,'data','downloads',id.replace('pmid:',''));const file=path.resolve(dir,row.file_name);return path.dirname(file)===dir&&existsSync(file)?file:null;}
