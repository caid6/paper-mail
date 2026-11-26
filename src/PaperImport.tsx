import {useEffect,useRef,useState,type FormEvent} from 'react';
import {LoaderCircle,Plus,Search} from 'lucide-react';
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
export type ImportResult={id:string;status:'added'|'restored'|'existing'};

export function PaperImport({onClose,onImported}:{onClose:()=>void;onImported:(result:ImportResult)=>void}){
 const [query,setQuery]=useState('');
 const [results,setResults]=useState<Candidate[]|null>(null);
 const [searching,setSearching]=useState(false);
 const [adding,setAdding]=useState('');
 const [error,setError]=useState('');
 const active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);

 async function search(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!query.trim()||searching||adding)return;
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

 return <Modal title="检索添加" subtitle="用题目、PMID 或 DOI 找到想读的论文。" onClose={onClose}>
  <div className="paper-import">
   <form className="paper-import-search" onSubmit={search}>
    <input data-initial-focus aria-label="题目、PMID 或 DOI" type="search" placeholder="输入题目、PMID 或 DOI" value={query} maxLength={500}
      onChange={event=>{setQuery(event.target.value);setResults(null);setError('');}} disabled={searching||!!adding}/>
    <button className="button primary" disabled={!query.trim()||searching||!!adding}>
     {searching?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>}
     {searching?'检索中':'检索'}
    </button>
   </form>
   {error&&<p className="paper-import-error" role="alert">{error}</p>}
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
  </div>
 </Modal>;
}
