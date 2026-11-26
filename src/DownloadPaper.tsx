import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Upload,LoaderCircle,FileText,ExternalLink} from 'lucide-react';
import {api,paperPath} from './api';
import type {Paper} from './types';
import type {DocumentState} from './PaperReading';
const PaperReading=lazy(()=>import('./PaperReading'));
const failures=['needs_browser','unavailable','error','interrupted'];
export function DownloadPaper({paper,currentModel,aiConfigured}:{paper:Paper;currentModel:string;aiConfigured:boolean}){
 const [state,setState]=useState<DocumentState|null>(null),[error,setError]=useState(''),[uploading,setUploading]=useState(false),[open,setOpen]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  let active=true;
  let timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{
    const next=await api<DocumentState>(paperPath(paper.id)+'/document');
    if(active)setState(next);
   }catch(e:any){if(active)setError(e.message);}
   finally{if(active)timer=setTimeout(refresh,2500);}
  }
  void refresh();
  return()=>{active=false;clearTimeout(timer);};
 },[paper.id]);
 async function upload(file:File|undefined){
  if(!file)return;setUploading(true);setError('');
  try{
   if(file.size>50*1024*1024)throw new Error('请选择 50 MB 以内的 PDF 文件');
   const response=await fetch('/api'+paperPath(paper.id)+'/document/upload',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'上传失败');
   setState(data);setOpen(true);
  }catch(e:any){setError(e.message);}finally{setUploading(false);if(input.current)input.current.value='';}
 }
 const ready=state?.download.status==='ready';
 const failed=state&&failures.includes(state.download.status);
 const environmentRequired=state?.download.status==='environment_required'||(failed&&!state?.pdf_environment_ready);
 const failureAdvice=state?.download.status==='needs_browser'||state?.download.status==='unavailable'
  ?'暂未找到可下载的开放 PDF。可打开出版社全文，或上传已有 PDF。'
  :state?.download.status==='interrupted'?'可打开出版社全文，或重新上传本篇 PDF。'
  :'自动下载未完成，可打开出版社全文或上传已有 PDF。';
 return <div className="download-paper">
  {ready?<><button className="button primary" onClick={()=>setOpen(true)}><FileText size={16}/>阅读文献</button><a className="text-button" href={state.download.file_url+'?download=1'} download>下载 PDF</a><small>{state.document.status==='ready'?(aiConfigured?'可在站内阅读与提问':'可在站内阅读') :state.document.status==='error'?'PDF 可阅读，文本解析失败':state.document.status==='environment_required'?'PDF 可阅读，文本解析需安装 PDF 依赖':paper.archived?'PDF 可阅读':'PDF 已就绪，文本在后台解析'}</small></>:
   environmentRequired?<small>安装 PDF 依赖后即可在站内获取或上传全文。也可从出版社阅读。</small>:
   failed?<><button className="button secondary" disabled={uploading} onClick={()=>input.current?.click()}>{uploading?<LoaderCircle size={16} className="spin"/>:<Upload size={16}/>} {uploading?'正在核对并解析…':'上传 PDF'}</button><small>{failureAdvice}</small><input ref={input} className="sr-only" type="file" accept=".pdf,application/pdf" aria-label="上传论文 PDF" disabled={uploading} onChange={e=>void upload(e.target.files?.[0])}/></>:
   <span className="document-pending" role="status">
    {state?.download.status==='running'&&<LoaderCircle size={15} className="spin"/>}
    {!state?'正在读取全文状态':state.download.status==='running'?'后台下载全文中…':paper.archived?'暂无全文 PDF':state.download.status==='pending'?'全文下载已排队':'等待后台准备全文'}
   </span>}
  {error&&<p className="download-error" role="alert">{error}</p>}
  {failed&&<details className="download-attempts"><summary>下载诊断</summary><p>{state.download.error}</p>{state.download.attempts?.map((a,i)=><p key={i}><strong>{a.source}</strong> · {a.detail||a.status}</p>)}{state.download.handoff_url&&<a href={state.download.handoff_url} target="_blank" rel="noreferrer">出版社入口<ExternalLink size={12}/></a>}</details>}
  {state?.document.error&&<details className="download-attempts"><summary>文本解析诊断</summary><p>{state.document.error}</p></details>}
  {open&&state&&<Suspense fallback={<div role="status">正在打开阅读器…</div>}><PaperReading paper={paper} state={state} currentModel={currentModel} aiConfigured={aiConfigured} onClose={()=>setOpen(false)}/></Suspense>}
 </div>;
}
