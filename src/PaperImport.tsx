import {useEffect,useRef,useState,type ChangeEvent, type FormEvent} from 'react';
import {FileText,LoaderCircle,Plus,Search,Upload,X} from 'lucide-react';
import {api} from './api';
import {formatDate} from './dates';
import {Modal} from './Modals';

type Candidate={
 identifier:string;
 title:string;
 authors:string[];
 journal:string;
 publication_date:string;
 doi:string;
 pmid:string;
 existing:{id:string;inInbox:boolean}|null;
};
export type ImportResult={id:string;status:'added'|'restored'|'existing';uploaded?:boolean};

async function uploadPdf(file:File){
 const response=await fetch('/api/papers/upload',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'上传失败，请重试');
 return data as ImportResult;
}

export function PaperImport({onClose,onImported}:{onClose:()=>void;onImported:(result:ImportResult)=>void}){
 const [mode,setMode]=useState<'search'|'upload'>('search');
 const [query,setQuery]=useState('');
 const [results,setResults]=useState<Candidate[]|null>(null);
 const [file,setFile]=useState<File|null>(null);
 const [searching,setSearching]=useState(false);
 const [adding,setAdding]=useState('');
 const [uploading,setUploading]=useState(false);
 const [error,setError]=useState('');
 const active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);

 function changeMode(next:'search'|'upload'){
  setMode(next);setError('');setResults(null);
 }
 async function search(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!query.trim()||searching||adding||uploading)return;
  setError('');setResults(null);setSearching(true);
  try{
   const {items}=await api<{items:Candidate[]}>('/papers/lookup','POST',{query});
   setResults(items);
  }catch(error){setError(error instanceof Error?error.message:'检索失败，请重试');}
  finally{setSearching(false);}
 }
 async function add(paper:Candidate){
  setAdding(paper.identifier);setError('');
  try{
   if(paper.existing?.inInbox){
    onImported({id:paper.existing.id,status:'existing'});
   }else{
    const result=await api<ImportResult>('/papers/import','POST',{identifier:paper.identifier});
    if(active.current)onImported(result);
   }
  }catch(error){setError(error instanceof Error?error.message:'添加失败，请重试');}
  finally{setAdding('');}
 }
 function chooseFile(event:ChangeEvent<HTMLInputElement>){
  const next=event.target.files?.[0]||null;
  event.target.value='';
  if(!next)return;
  if(!next.name.toLowerCase().endsWith('.pdf')){
   setFile(null);setError('请选择 PDF 文件');return;
  }
  if(next.size>50*1024*1024){setFile(null);setError('PDF 不能超过 50 MB');return;}
  setError('');setFile(next);
 }
 async function upload(){
  if(!file||uploading||searching||adding)return;
  setUploading(true);setError('');
  try{
   const result=await uploadPdf(file);
   if(active.current)onImported({...result,uploaded:true});
  }catch(error){setError(error instanceof Error?error.message:'上传失败，请重试');}
  finally{setUploading(false);}
 }

 return <Modal title="手工添加" subtitle="检索论文或上传 PDF，自动建立本地索引和文献解读。" onClose={onClose} closeable={!uploading&&!adding}>
  <div className="paper-import">
   <div className="paper-import-modes" role="tablist" aria-label="手工添加方式">
    <button type="button" role="tab" aria-selected={mode==='search'} className={mode==='search'?'active':''} onClick={()=>changeMode('search')} disabled={searching||!!adding||uploading}><Search size={15}/>检索论文</button>
    <button type="button" role="tab" aria-selected={mode==='upload'} className={mode==='upload'?'active':''} onClick={()=>changeMode('upload')} disabled={searching||!!adding||uploading}><Upload size={15}/>上传 PDF</button>
   </div>
   {mode==='search'?<>
    <form className="paper-import-search" onSubmit={search}>
     <input data-initial-focus aria-label="题目、PMID 或 DOI" type="search" placeholder="输入题目、PMID 或 DOI" value={query} maxLength={500}
       onChange={event=>{setQuery(event.target.value);setResults(null);setError('');}} disabled={searching||!!adding}/>
     <button className="button primary" disabled={!query.trim()||searching||!!adding}>
      {searching?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>}
      {searching?'检索中':'检索'}
     </button>
    </form>
    {results?.length===0&&<p className="paper-import-empty" role="status">没有找到匹配论文。可以试试完整题目、PMID 或 DOI。</p>}
    {results&&results.length>0&&<ul className="paper-import-results" aria-label="检索结果">
     {results.map(paper=><li key={paper.identifier}>
      <div>
       <strong>{paper.title}</strong>
       <p>{[paper.authors.join(', '),paper.journal,paper.publication_date&&formatDate(paper.publication_date)].filter(Boolean).join(' · ')}</p>
       <p>{[paper.pmid?'PMID '+paper.pmid:'',paper.doi].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" className="button secondary" disabled={!!adding} onClick={()=>void add(paper)}>
       {adding===paper.identifier?<LoaderCircle className="spin" size={14}/>:!paper.existing&&<Plus size={14}/>}
       {paper.existing?.inInbox?'查看':paper.existing?'移回收件箱':'添加'}
      </button>
     </li>)}
    </ul>}
   </>:<div className="paper-import-upload">
    <div className="paper-import-upload-copy"><FileText size={25}/><div><strong>{file?file.name:'选择一篇论文 PDF'}</strong><p>{file?`${(file.size/1024/1024).toFixed(1)} MB · 将自动解析全文`:'上传后会提取全文、建立索引并生成中文导读和图文解读'}</p></div>{file&&<button type="button" className="icon-button" aria-label="移除已选 PDF" onClick={()=>setFile(null)} disabled={uploading}><X size={16}/></button>}</div>
    <div className="paper-import-upload-actions"><label className="button secondary"><Upload size={15}/>{file?'更换 PDF':'选择 PDF'}<input type="file" accept="application/pdf,.pdf" onChange={chooseFile} disabled={uploading}/></label><button type="button" className="button primary" disabled={!file||uploading} onClick={()=>void upload()}>{uploading?<LoaderCircle className="spin" size={15}/>:<Upload size={15}/>} {uploading?'解析中…':'上传并解析'}</button></div>
   </div>}
   {error&&<p className="paper-import-error" role="alert">{error}</p>}
  </div>
 </Modal>;
}
