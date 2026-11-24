import {memo,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,ZoomIn,ZoomOut,Send,MessageSquare,FileText,LoaderCircle,Trash2} from 'lucide-react';
import {getDocument,GlobalWorkerOptions,TextLayer,type PDFPageProxy,type RenderTask} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {Paper} from './types';
import {api,paperPath} from './api';
import './paper-reading.css';
GlobalWorkerOptions.workerSrc=workerUrl;
export type DocumentState={
 download:{status:string;source?:string;file_url?:string;error?:string;handoff_url?:string;attempts?:{source:string;status:string;detail?:string}[]};
 document:{status:string;sha256?:string;page_count?:number;unreadable_pages?:number[];file_url?:string;error?:string};
 asking:boolean;
};
type Chat={id:number;question:string;answer:string;model:string;created_at:string};
// Keep every page's actual dimensions in the document flow; render pixels near the viewport.
const PdfPage=memo(function PdfPage({page,width,zoom,root}:{page:PDFPageProxy;width:number;zoom:number;root:HTMLDivElement}){
 const sheet=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),layer=useRef<HTMLDivElement>(null);
 const [near,setNear]=useState(false),[rendering,setRendering]=useState(true),[error,setError]=useState('');
 const base=page.getViewport({scale:1}),scale=Math.max(.15,(width-32)/base.width)*zoom,view=page.getViewport({scale});
 useEffect(()=>{
  const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root,rootMargin:'100% 0px'});
  observer.observe(sheet.current!);return()=>observer.disconnect();
 },[root]);
 useEffect(()=>{
  if(!near||!canvas.current||!layer.current)return;
  let active=true,render:RenderTask|undefined,textLayer:TextLayer|undefined;
  const target=canvas.current,textContainer=layer.current;setRendering(true);setError('');
  const run=async()=>{
   const viewport=page.getViewport({scale}),ratio=window.devicePixelRatio||1;
   target.width=Math.floor(viewport.width*ratio);target.height=Math.floor(viewport.height*ratio);
   render=page.render({canvas:target,canvasContext:target.getContext('2d')!,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined});
   await render.promise;if(!active)return;
   const textContent=await page.getTextContent();if(!active)return;
   textLayer=new TextLayer({textContentSource:textContent,container:textContainer,viewport});
   await textLayer.render();if(active)setRendering(false);
  };
  void run().catch(e=>{if(active){setError('第 '+page.pageNumber+' 页载入失败：'+e.message);setRendering(false);}});
  return()=>{active=false;render?.cancel();textLayer?.cancel();textContainer.replaceChildren();target.width=0;target.height=0;};
 },[page,near,scale]);
 return <div className="pdf-sheet" ref={sheet} data-page-number={page.pageNumber} role="region" aria-label={'PDF 第 '+page.pageNumber+' 页'} style={{width:view.width,height:view.height,'--total-scale-factor':scale} as React.CSSProperties}>
  {near&&<><canvas ref={canvas} style={{width:view.width,height:view.height}}/><div className="textLayer" ref={layer}/>{rendering&&<span className="pdf-loading" role="status"><LoaderCircle size={16} className="spin"/>正在载入第 {page.pageNumber} 页</span>}{error&&<p className="study-error" role="alert">{error}</p>}</>}
 </div>;
});
export default function PaperReading({paper,state,currentModel,onClose}:{paper:Paper;state:DocumentState;currentModel:string;onClose:()=>void}){
 const [pages,setPages]=useState<PDFPageProxy[]>([]),[zoom,setZoom]=useState(1),[pdfError,setPdfError]=useState(''),[busy,setBusy]=useState(false),[pendingQuestion,setPendingQuestion]=useState(''),[error,setError]=useState(''),[question,setQuestion]=useState(''),[messages,setMessages]=useState<Chat[]>([]),[mobileTab,setMobileTab]=useState('pdf'),[selection,setSelection]=useState<{text:string;page:number}|null>(null);
 const [viewport,setViewport]=useState<HTMLDivElement|null>(null),[width,setWidth]=useState(700);
 const dialog=useRef<HTMLDivElement>(null),transcript=useRef<HTMLDivElement>(null),submitting=useRef(false),composing=useRef(false),composer=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.focus();
  return()=>{document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 useEffect(()=>{
  if(!viewport)return;
  const observer=new ResizeObserver(entries=>{const w=entries[0]?.contentRect.width;if(w>0)setWidth(w);});observer.observe(viewport);
  return()=>observer.disconnect();
 },[viewport]);
 useEffect(()=>{
  const task=getDocument({url:state.download.file_url!,isEvalSupported:false,enableXfa:false});
  let active=true;setPdfError('');setPages([]);
  void task.promise.then(async doc=>{
   const all=await Promise.all(Array.from({length:doc.numPages},(_,i)=>doc.getPage(i+1)));
   if(active)setPages(all);
  }).catch(e=>{if(active)setPdfError('PDF 载入失败：'+e.message);});
  return()=>{active=false;void task.destroy();};
 },[paper.id,state.download.file_url]);
 useEffect(()=>{
  let active=true;const refresh=async()=>{try{
   const [history,status]=await Promise.all([api<{messages:Chat[]}>(paperPath(paper.id)+'/chat'),api<DocumentState>(paperPath(paper.id)+'/document')]);
   if(active){setMessages(history.messages);if(!submitting.current)setBusy(status.asking);}
  }catch(e:any){if(active)setError(e.message);}};
  void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{active=false;clearInterval(timer);};
 },[paper.id]);
 useEffect(()=>{transcript.current?.scrollTo({top:transcript.current.scrollHeight});},[messages.length,busy]);
 async function ask(text=question){
  if(!text.trim()||busy||submitting.current||state.document.status!=='ready')return;
  submitting.current=true;setBusy(true);setPendingQuestion(text);setError('');setQuestion('');setSelection(null);
  try{const result=await api<{messages:Chat[]}>(paperPath(paper.id)+'/chat','POST',{question:text});setMessages(result.messages);}catch(e:any){setError(e.message);setQuestion(draft=>draft||text);}finally{submitting.current=false;setBusy(false);setPendingQuestion('');composer.current?.focus();}
 }
 return createPortal(<div className={'paper-study mobile-'+mobileTab} role="dialog" aria-modal="true" aria-labelledby="study-title" ref={dialog} tabIndex={-1}
  onKeyDown={e=>{
   if(e.key==='Escape'){e.stopPropagation();onClose();}
   if(e.key==='Tab'){
    const nodes=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,a')].filter(x=>x.getClientRects().length);
    if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===dialog.current)){e.preventDefault();nodes.at(-1)?.focus();}
    else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
   }
  }}>
  <header className="study-header"><FileText size={20}/><div><span>全文阅读</span><h2 id="study-title">{paper.digest?.title_zh||paper.title}</h2></div><button className="icon-button" aria-label="关闭全文阅读" onClick={onClose}><X size={22}/></button></header>
  <nav className="study-mobile-tabs"><button className={mobileTab==='pdf'?'active':''} onClick={()=>setMobileTab('pdf')}>PDF 原文</button><button className={mobileTab==='chat'?'active':''} onClick={()=>setMobileTab('chat')}>AI 问答</button></nav>
  <div className="study-layout">
   <section className="study-pdf" aria-label="PDF 原文">
    <div className="pdf-controls"><span>{pages.length||state.document.page_count||'—'} 页</span><span className="pdf-control-spacer"/><button className="icon-button" aria-label="缩小 PDF" disabled={zoom<=.5} onClick={()=>setZoom(Math.max(.5,zoom-.25))}><ZoomOut size={17}/></button><button className="text-button" onClick={()=>setZoom(1)} title="适合宽度">{Math.round(zoom*100)}%</button><button className="icon-button" aria-label="放大 PDF" disabled={zoom>=3} onClick={()=>setZoom(Math.min(3,zoom+.25))}><ZoomIn size={17}/></button></div>
    <div className="pdf-viewport" ref={setViewport} aria-label="连续滚动阅读 PDF" tabIndex={0} onMouseUp={()=>{
     const selected=window.getSelection(),element=selected?.anchorNode?.parentElement,sheet=element?.closest<HTMLElement>('[data-page-number]');
     if(sheet&&viewport?.contains(sheet)){const text=selected!.toString().trim().slice(0,2500);setSelection(text?{text,page:Number(sheet.dataset.pageNumber)}:null);}
    }}>
     {pdfError&&<p role="alert" className="study-error">{pdfError}</p>}{!pages.length&&!pdfError&&<span className="pdf-document-loading" role="status"><LoaderCircle className="spin" size={16}/>正在打开 PDF</span>}
     {viewport&&pages.map(page=><PdfPage key={page.pageNumber} page={page} width={width} zoom={zoom} root={viewport}/>)}
    </div>
   </section>
   <aside className="study-chat" aria-label="文献 AI 问答">
    <div className="chat-heading"><div><MessageSquare size={17}/><strong>和 AI 一起读</strong></div><button className="icon-button" aria-label="清空本篇对话" disabled={busy||!messages.length} onClick={async()=>{if(!window.confirm('清空本篇 PDF 的对话记录？'))return;try{await api(paperPath(paper.id)+'/chat/reset','POST');setMessages([]);}catch(e:any){setError(e.message);}}}><Trash2 size={15}/></button></div>
    <div className="chat-provenance">{currentModel}</div>
    <div className="chat-transcript" role="log" aria-label="问答记录" ref={transcript}>
     {!messages.length&&!busy&&<div className="chat-welcome"><h3>想了解这篇论文的什么？</h3><p>可以问方法、结论，也可以聊聊你的研究想法。</p>{['这篇论文的核心问题和主要发现是什么？','请梳理研究设计、数据来源和验证方法。','这篇研究对我的课题有什么启发？'].map(q=><button key={q} disabled={state.document.status!=='ready'} onClick={()=>void ask(q)}>{q}</button>)}</div>}
     {messages.map(message=><article className="chat-turn" key={message.id}><div className="chat-question">{message.question}</div><div className="chat-answer"><Markdown remarkPlugins={[remarkGfm]} components={{a:({children,...props})=><a {...props} target="_blank" rel="noreferrer">{children}</a>,img:({alt})=><span>{alt}</span>}}>{message.answer}</Markdown><small>{message.model}</small></div></article>)}
     {busy&&<div className="chat-pending">{pendingQuestion&&<div className="chat-question">{pendingQuestion}</div>}<p className="chat-waiting" role="status"><LoaderCircle size={16} className="spin"/>正在思考…</p></div>}
    </div>
    {error&&<p className="study-error" role="alert">{error}</p>}
    {state.document.status!=='ready'&&<p className="study-error">{state.document.error||'正在解析全文文本，完成后可提问。'}</p>}
    <form className="chat-composer" onSubmit={e=>{e.preventDefault();void ask();}}>
     {selection&&<button className="selection-question" type="button" onClick={()=>{setQuestion('请解释 PDF 第 '+selection.page+' 页这段原文：\n'+selection.text);setMobileTab('chat');composer.current?.focus();}}>解释选中文字</button>}
     <textarea ref={composer} aria-label="向 AI 提问" maxLength={3000} value={question} onChange={e=>setQuestion(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} placeholder="向这篇论文提问…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void ask();}}}/>
     <div><small>Enter 发送 · Shift+Enter 换行</small><button className="button primary" disabled={busy||!question.trim()||state.document.status!=='ready'} type="submit" aria-label="发送文献问题"><Send size={16}/>发送</button></div>
    </form>
   </aside>
  </div>
 </div>,document.body);
}
