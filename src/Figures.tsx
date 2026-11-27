import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,ArrowUpRight,ChevronLeft,ChevronRight,ExternalLink,Images,LoaderCircle,Maximize2,Minimize2,RefreshCw,X,ZoomIn,ZoomOut} from 'lucide-react';
import {api,paperPath} from './api';
import type {Figure,FigureState,Paper} from './types';
import './figures.css';

type FigureActions={aiConfigured:boolean;onRegenerate:(figure:Figure)=>void;onRetry:(figure:Figure)=>void;onSettings:()=>void};
const isProcessing=(figure:Figure)=>['pending','fetching','generating'].includes(figure.status);

function FigureCaption({figure}:{figure:Figure}){
 return <details className="original-caption">
  <summary>作者图注{figure.origin==='pdf'&&figure.source_page?' · 第 '+figure.source_page+' 页':''}</summary>
  <p lang="en">{figure.caption}</p>
  {figure.origin!=='pdf'&&<a href={figure.source_url} target="_blank" rel="noreferrer">查看图表原文<ArrowUpRight size={14}/></a>}
 </details>;
}

function FigureExplanation({figure,aiConfigured,onRegenerate,onRetry,onSettings}:FigureActions&{figure:Figure}){
 const analysis=figure.analysis,busy=isProcessing(figure);
 return <>
  {analysis?<div className="figure-analysis">
   <section className="figure-takeaway" aria-label="核心结论"><h4>核心结论</h4><p>{analysis.takeaway}</p></section>
   <section className="figure-reading-guide"><h4>读图要点</h4><p>{analysis.overview}</p></section>
   {analysis.panels.length>0&&<section className="figure-panels"><h4>子图解读</h4><div className="panel-explanations">
    {analysis.panels.map((panel,index)=><div key={index}><strong>{panel.label}</strong><p>{panel.explanation}</p></div>)}
   </div></section>}
  </div>:<div className={'figure-generation '+(figure.status==='error'?'has-error':'')} role="status">
   {figure.status==='unconfigured'
    ?<><p>配置图文模型后自动解读</p><button className="text-button" onClick={onSettings}>配置模型</button></>
    :figure.status==='error'
     ?<><AlertCircle size={18}/><p>{figure.image_src?'图文解读失败':'原图获取失败'}</p><button className="text-button" disabled={!!figure.image_src&&!aiConfigured} onClick={()=>onRetry(figure)}>重试</button></>
     :<><LoaderCircle size={18} className="spin"/><p>{figure.status==='generating'?'正在解读这张图':!figure.image_src?(figure.status==='fetching'?'正在下载原图':'原图下载已排队'):'图文解读已排队'}</p></>}
  </div>}
  <FigureCaption figure={figure}/>
  {analysis&&<footer className="figure-analysis-footer">
   <span className="figure-model" title={figure.model}>AI 解读 · {figure.model}</span>
   <button className="text-button" disabled={!aiConfigured||!figure.image_src||busy} onClick={()=>onRegenerate(figure)}>
    {busy?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>}<span>{busy?'正在重新解读':'重新解读'}</span>
   </button>
   {figure.status==='error'&&<p className="figure-analysis-error" role="alert">重新解读失败：{figure.error}</p>}
  </footer>}
 </>;
}

function FigureCanvas({figure}:{figure:Figure}){
 const [viewport,setViewport]=useState<HTMLDivElement|null>(null);
 const [size,setSize]=useState({width:0,height:0}),[natural,setNatural]=useState({width:0,height:0});
 const [zoom,setZoom]=useState(1),[error,setError]=useState(false);
 useEffect(()=>{
  if(!viewport)return;
  const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
  observer.observe(viewport);return()=>observer.disconnect();
 },[viewport]);
 useEffect(()=>{if(viewport){viewport.scrollTop=0;viewport.scrollLeft=0;}},[viewport,figure.id]);
 const fit=natural.width&&size.width?Math.min(Math.max(1,size.width-48)/natural.width,Math.max(1,size.height-48)/natural.height,1):0;
 const width=natural.width*fit*zoom,height=natural.height*fit*zoom;
 return <section className="figure-reader-visual" aria-label={figure.label+'原图'}>
  <div className="figure-reader-image-toolbar">
   <span>{figure.label}</span><div className="figure-zoom-controls">
    <button className="icon-button" title="缩小图片" aria-label="缩小图片" disabled={zoom<=.5} onClick={()=>setZoom(value=>Math.max(.5,value-.25))}><ZoomOut size={18}/></button>
    <button className="figure-fit-button" title="恢复适合窗口" onClick={()=>setZoom(1)}>{zoom===1?'适合窗口':Math.round(zoom*100)+'%'}</button>
    <button className="icon-button" title="放大图片" aria-label="放大图片" disabled={zoom>=4} onClick={()=>setZoom(value=>Math.min(4,value+.25))}><ZoomIn size={18}/></button>
    {figure.image_src&&<a className="icon-button" title="单独打开原图" aria-label="单独打开原图" href={figure.image_src} target="_blank" rel="noreferrer"><ExternalLink size={17}/></a>}
   </div>
  </div>
  <div className="figure-reader-image-scroll" ref={setViewport} tabIndex={0} aria-label="原图，可滚动查看放大后的细节">
   {figure.image_src&&!error?<div className="figure-reader-image-stage" style={{width:Math.max(size.width,width+48),height:Math.max(size.height,height+48)}}>
    <img src={figure.image_src} alt={figure.alt||figure.label+'原图'} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError(true)} style={fit?{width,height}:{visibility:'hidden'}}/>
    {!natural.width&&<span className="figure-image-loading" role="status"><LoaderCircle size={20} className="spin"/>正在载入原图</span>}
   </div>:<div className="figure-image-loading" role="status">{error?<><AlertCircle size={20}/>原图未能载入</>:<><LoaderCircle size={20} className="spin"/>原图下载中</>}</div>}
  </div>
 </section>;
}

function FigureReader({paper,figures,selectedId,onSelect,onClose,notify,...actions}:FigureActions&{paper:Paper;figures:Figure[];selectedId:string;onSelect:(id:string)=>void;onClose:()=>void;notify:(message:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),fullscreenRoot=useRef<HTMLDivElement>(null),activeTab=useRef<HTMLButtonElement>(null),explanation=useRef<HTMLDivElement>(null);
 const [fullscreen,setFullscreen]=useState(false);
 const index=figures.findIndex(figure=>figure.id===selectedId),figure=figures[index];
 useEffect(()=>{
  const element=dialog.current!,previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';element.showModal();
  const screen=fullscreenRoot.current;
  const changed=()=>setFullscreen(document.fullscreenElement===screen);
  document.addEventListener('fullscreenchange',changed);
  return()=>{
   document.removeEventListener('fullscreenchange',changed);
   if(document.fullscreenElement===screen)void document.exitFullscreen();
   element.close();document.body.style.overflow=overflow;
   if(previous?.isConnected)previous.focus({preventScroll:true});
  };
 },[]);
 useEffect(()=>{
  activeTab.current?.scrollIntoView({block:'nearest',inline:'nearest'});
  explanation.current?.scrollTo({top:0});
 },[selectedId]);
 async function toggleFullscreen(){
  try{
   if(document.fullscreenElement===fullscreenRoot.current)await document.exitFullscreen();
   else await fullscreenRoot.current?.requestFullscreen();
  }catch{notify('未能切换全屏显示，请重试');}
 }
 return createPortal(<dialog ref={dialog} className="figure-reader" aria-labelledby="figure-reader-title" onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='ArrowLeft'&&index>0){event.preventDefault();onSelect(figures[index-1].id);}
  if(event.key==='ArrowRight'&&index<figures.length-1){event.preventDefault();onSelect(figures[index+1].id);}
 }}>
  <div className="figure-reader-content" ref={fullscreenRoot}>
  <header className="figure-reader-header">
   <Images size={21}/><div className="figure-reader-heading"><span>图文对照</span><h2 id="figure-reader-title" title={paper.title_zh||paper.title}>{paper.title_zh||paper.title}</h2></div>
   {document.fullscreenEnabled&&<button className="icon-button" title={fullscreen?'窗口显示':'全屏显示'} aria-label={fullscreen?'窗口显示':'全屏显示'} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize2 size={20}/>:<Maximize2 size={20}/>}</button>}
   <button className="figure-reader-close" autoFocus title="退出全屏阅读（Esc）" aria-label="退出全屏阅读" onClick={onClose}><X size={19}/><span>退出</span></button>
  </header>
  <div className="figure-reader-navigation">
   <nav aria-label="切换论文主图">{figures.map(item=><button key={item.id} ref={item.id===selectedId?activeTab:undefined} aria-current={item.id===selectedId?'true':undefined} title={item.analysis?.title_zh||item.label} onClick={()=>onSelect(item.id)}>{item.label}</button>)}</nav>
   <div className="figure-reader-paging"><span aria-live="polite">{index+1} / {figures.length}</span><button className="icon-button" aria-label="上一张图" title="上一张图（←）" disabled={index<=0} onClick={()=>onSelect(figures[index-1].id)}><ChevronLeft size={19}/></button><button className="icon-button" aria-label="下一张图" title="下一张图（→）" disabled={index===figures.length-1} onClick={()=>onSelect(figures[index+1].id)}><ChevronRight size={19}/></button></div>
  </div>
  {figure&&<div className="figure-reader-layout">
   <FigureCanvas key={figure.id} figure={figure}/>
   <section className="figure-reader-explanation" ref={explanation} aria-label={figure.label+'中文解读'} tabIndex={0}>
    <div className="figure-reader-explanation-heading"><span className="figure-label">{figure.label}</span><h3>{figure.analysis?.title_zh||'图文解读'}</h3></div>
    <FigureExplanation figure={figure} {...actions}/>
   </section>
  </div>}
  </div>
 </dialog>,document.body);
}

export function Figures({paper,notify,onSettings}:{paper:Paper;notify:(message:string)=>void;onSettings:()=>void}){
 const [state,setState]=useState<FigureState|null>(null),[error,setError]=useState(''),[selectedId,setSelectedId]=useState<string|null>(null);
 const inFlight=useRef(new Set<string>()),mounted=useRef(false);
 const refresh=useCallback(async()=>{
  try{const data=await api<FigureState>(paperPath(paper.id)+'/figures');if(mounted.current){setState(data);setError('');}}
  catch(error){if(mounted.current)setError((error as Error).message);}
 },[paper.id]);
 useEffect(()=>{
  mounted.current=true;void refresh();const timer=setInterval(()=>void refresh(),3500);
  return()=>{mounted.current=false;clearInterval(timer);};
 },[refresh]);
 async function requestAnalysis(figure:Figure,action:'retry'|'regenerate'){
  if(inFlight.current.has(figure.id))return;
  inFlight.current.add(figure.id);
  try{
   await api('/figures/'+encodeURIComponent(figure.id)+'/'+action,'POST');
   if(mounted.current)setState(previous=>previous?{...previous,figures:previous.figures.map(item=>item.id===figure.id?{...item,status:'pending',error:null}:item)}:previous);
   notify(action==='regenerate'?'已安排重新解读，完成后自动更新':'已重新安排图文处理');void refresh();
  }catch(error){notify((error as Error).message);}
  finally{inFlight.current.delete(figure.id);}
 }
 const actions:FigureActions={aiConfigured:!!state?.ai_configured,onRegenerate:figure=>void requestAnalysis(figure,'regenerate'),onRetry:figure=>void requestAnalysis(figure,'retry'),onSettings:()=>{setSelectedId(null);onSettings();}};
 const waiting=['pending','loading','pdf_queued','pdf_downloading','pdf_pending','pdf_processing','publisher_processing'].includes(state?.status||'');
 const waitingText=state?.status==='loading'?'正在获取 PMC 正文中的主图'
  :state?.status==='pdf_processing'?'正在从本机 PDF 提取主图和图注'
   :state?.status==='publisher_processing'?'正在从出版社全文页获取主图'
    :state?.status==='pdf_pending'?'PDF 已就绪，主图提取已排队'
     :state?.status==='pending'?'等待获取 PMC 正文和主图'
      :state?.status==='pdf_downloading'?'正在下载全文 PDF':'全文 PDF 下载已排队';
 const source=state?.figures.every(figure=>figure.origin==='pdf')?'/api'+paperPath(paper.id)+'/pdf':state?.source_url||paper.full_text_url||paper.url;
 return <div className="figures-module">
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {!state?<div className="loading-line"><LoaderCircle className="spin" size={18}/>正在读取图文状态</div>
   :waiting?<div className="empty-state"><LoaderCircle className="spin" size={30}/><h2>{waitingText}</h2></div>
    :['no_pmc','idle'].includes(state.status)?<div className="empty-state"><Images size={33}/><h2>暂无可解析的全文 PDF</h2><p>可以从出版社查看原始图表。上传本篇 PDF 后会提取主图和图注。</p></div>
     :state.status==='no_figures'?<div className="empty-state"><Images size={33}/><h2>全文没有可识别的编号主图</h2><p>可以继续查看中文导读或原文摘要。</p></div>
      :state.status==='pdf_environment_required'?<div className="empty-state"><Images size={33}/><h2>PDF 处理组件未就绪</h2><p>重启 Paper-mail 后再提取主图和图注。</p></div>
       :['unavailable','error','pdf_error','publisher_error'].includes(state.status)?<div className="empty-state"><Images size={33}/><h2>{state.status==='publisher_error'?'出版社图文解析没有完成':'全文图表读取没有完成'}</h2><p>{state.error||state.pdf_index?.error||state.publisher_index?.error||'请确认全文已取得并完成解析。'}</p>{state.status==='publisher_error'&&<button className="button secondary" onClick={async()=>{try{await api(paperPath(paper.id)+'/figures/retry','POST');notify('已重新安排出版社图表解析');}catch(error){notify((error as Error).message);}}}>重新尝试</button>}<a className="text-button" href={paper.full_text_url||paper.url} target="_blank" rel="noreferrer">打开原始全文<ArrowUpRight size={14}/></a></div>
        :<>
         <div className="figure-module-heading"><h2>{state.figures.length} 张论文主图</h2><div className="figure-module-actions"><a href={source} target="_blank" rel="noreferrer" className="text-button">原文<ArrowUpRight size={14}/></a><button className="button secondary" disabled={!state.figures.length} onClick={()=>setSelectedId(state.figures[0].id)}><Maximize2 size={16}/>全屏阅读</button></div></div>
         {state.figures.map(figure=><article className="figure-card" key={figure.id}>
          <header><span className="figure-label">{figure.label}</span><h3>{figure.analysis?.title_zh||'正文主图'}</h3><button className="icon-button" title="全屏对照图文" aria-label={'全屏阅读'+figure.label} onClick={()=>setSelectedId(figure.id)}><Maximize2 size={17}/></button></header>
          {figure.image_src&&<button className="figure-image" aria-label={'对照阅读'+figure.label} onClick={()=>setSelectedId(figure.id)}><img src={figure.image_src} alt={figure.alt||figure.label+'原图'} loading="lazy"/><span><Maximize2 size={14}/>图文对照</span></button>}
          <FigureExplanation figure={figure} {...actions}/>
         </article>)}
        </>}
  {selectedId&&state?.figures.some(figure=>figure.id===selectedId)&&<FigureReader paper={paper} figures={state.figures} selectedId={selectedId} onSelect={setSelectedId} onClose={()=>setSelectedId(null)} notify={notify} {...actions}/>}
 </div>;
}
