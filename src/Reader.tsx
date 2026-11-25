import {useEffect,useState} from 'react';
import {ArrowUpRight,ArrowLeft,Archive,Star,Mail,Check,ChevronLeft,ChevronRight,BookOpen,Images,FileText,NotebookPen,RefreshCw,AlertCircle,LoaderCircle,ZoomIn,ZoomOut,X,Copy,ExternalLink,Info,CheckCircle2} from 'lucide-react';
import type {Paper,FigureState,Figure} from './types';
import {api,paperPath} from './api';
import {JournalBadge} from './JournalBadge';
import {DownloadPaper} from './DownloadPaper';
import {formatDate} from './dates';
import {DigestProvenance} from './DigestProvenance';
export function Reader({paper,aiConfigured,currentModel,onPatch,onBack,onStep,canPrev,canNext,notify,onSettings}:{paper:Paper|null;aiConfigured:boolean;currentModel:string;onPatch:(id:string,data:unknown)=>Promise<boolean>;onBack:()=>void;onStep:(d:number)=>void;canPrev:boolean;canNext:boolean;notify:(s:string)=>void;onSettings:()=>void}){
 const [tab,setTab]=useState('digest'),[note,setNote]=useState(''),[saving,setSaving]=useState(false),[authors,setAuthors]=useState(false);
 useEffect(()=>{setTab('digest');setAuthors(false);setNote(paper?.note||'');},[paper?.id]);
 useEffect(()=>{setNote(paper?.note||'');},[paper?.note]);
 async function copy(){if(!paper)return;try{await navigator.clipboard.writeText(`${paper.authors.join(', ')}. ${paper.title} ${paper.journal}. ${paper.publication_date}. ${paper.url}`);notify('引用信息已复制');}catch{notify('复制失败，请在原始记录中复制引用');}}
 return <section className="reader-panel" aria-label="论文阅读区">
  <div className="reader-toolbar"><button className="icon-button mobile-back" aria-label="返回论文列表" onClick={onBack}><ArrowLeft size={19}/></button>{paper?<><button className={'read-state '+(!paper.is_read?'unread':'')} onClick={()=>void onPatch(paper.id,{is_read:!paper.is_read})} aria-label={paper.is_read?'标为未读':'标为已读'}>{paper.is_read?<CheckCircle2 size={15}/>:<Mail size={15}/>}<span>{paper.is_read?'已读':'未读'}</span></button><div className="toolbar-rule"/><button className={'icon-button '+(paper.starred?'is-starred':'')} aria-label={paper.starred?'取消收藏':'收藏论文'} title="收藏" onClick={()=>void onPatch(paper.id,{starred:!paper.starred})}><Star size={18} fill={paper.starred?'currentColor':'none'}/></button><button className="icon-button" aria-label={paper.archived?'移回收件箱':'归档论文'} title={paper.archived?'移回收件箱':'归档'} onClick={()=>void onPatch(paper.id,{archived:!paper.archived})}><Archive size={18}/></button><button className="icon-button" aria-label="复制论文引用" title="复制引用" onClick={copy}><Copy size={17}/></button></>:<span className="toolbar-caption">论文阅读</span>}<div className="reader-step"><button className="icon-button" aria-label="上一篇论文" disabled={!canPrev} onClick={()=>onStep(-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="下一篇论文" disabled={!canNext} onClick={()=>onStep(1)}><ChevronRight size={18}/></button></div></div>
  {paper?<div className="reader-scroll" key={paper.id}>
   <header className="paper-heading"><div className="paper-kicker"><span className="journal-name">{paper.journal||'预印本'}</span><JournalBadge paper={paper}/></div><h1>{paper.title_zh||paper.title}</h1>{paper.title_zh?<p className="original-title">{paper.title}</p>:aiConfigured&&paper.title_status==='error'&&<div className="title-translation-error"><span>{paper.title_error||'中文题名生成失败'}</span><button className="text-button" onClick={async()=>{try{await api(paperPath(paper.id)+'/title/retry','POST');notify('已重新安排中文题名翻译');}catch(e:any){notify(e.message);}}}>重新翻译</button></div>}<div className="authors-line"><span>{(authors?paper.authors:paper.authors.slice(0,3)).join(', ')}</span>{paper.authors.length>3&&<button onClick={()=>setAuthors(!authors)}>{authors?'收起':`等 ${paper.authors.length} 位作者`}</button>}</div><div className="metadata-line"><span>发表 {formatDate(paper.publication_date||paper.published)}</span><span>{paper.id.replace('pmid:','PMID ')}</span>{paper.doi&&<a href={'https://doi.org/'+paper.doi} target="_blank" rel="noreferrer">DOI<ArrowUpRight size={12}/></a>}</div><div className="heading-tags">{paper.subscriptions.map(s=><span className="topic-tag" key={s.id} style={{'--tag-color':s.color} as React.CSSProperties}>{s.name}</span>)}</div><div className="paper-links">{paper.source==='pubmed'&&<DownloadPaper key={paper.id} paper={paper} currentModel={currentModel}/>}<a className="button ghost" href={paper.url} target="_blank" rel="noreferrer">PubMed<ArrowUpRight size={15}/></a><a className="text-button" href={paper.full_text_url||paper.url} target="_blank" rel="noreferrer">出版社全文<ArrowUpRight size={13}/></a></div></header>
   <div className="reading-tabs" role="tablist" aria-label="阅读内容">{[{id:'digest',label:'中文导读',icon:BookOpen},{id:'figures',label:'图文解读',icon:Images},{id:'abstract',label:'原文摘要',icon:FileText},{id:'notes',label:'笔记',icon:NotebookPen}].map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>setTab(t.id)}><t.icon size={16}/>{t.label}{t.id==='notes'&&paper.note&&<i/>}</button>)}</div>
   <div className="reader-content" role="tabpanel">
    {tab==='digest'?(paper.digest?<><DigestProvenance paper={paper} currentModel={currentModel} notify={notify}/><div className="summary-box"><div className="section-eyebrow"><BookOpen size={16}/>摘要导读<span>基于作者摘要</span></div><p>{paper.digest.summary}</p></div><div className="explain-section"><span className="section-number">01</span><div><h2>研究解决什么问题</h2><p>{paper.digest.problem}</p></div></div><div className="explain-section"><span className="section-number">02</span><div><h2>研究设计与核心方法</h2><p>{paper.digest.method}</p></div></div><div className="explain-section"><span className="section-number">03</span><div><h2>主要发现</h2><ul className="findings">{paper.digest.findings.map((f,i)=><li key={i}><span>{i+1}</span><p>{f}</p></li>)}</ul></div></div><div className="evidence-box"><h2><Info size={16}/>证据边界与核查要点</h2><ul>{paper.digest.limitations.map((f,i)=><li key={i}>{f}</li>)}</ul></div><div className="advice"><BookOpen size={19}/><div><strong>阅读建议</strong><p>{paper.digest.reading_advice}</p></div></div></>:paper.digest_status!=='unavailable'&&!aiConfigured?<div className="empty-state"><BookOpen size={30}/><h2>配置模型后生成中文导读</h2><p>你可以先阅读作者的原文摘要。</p><button className="button primary" onClick={onSettings}>配置模型</button></div>:<div className="empty-state">{paper.digest_status==='error'?<AlertCircle size={32}/>:<LoaderCircle className="spin" size={30}/>}<h2>{paper.digest_status==='error'?'导读生成失败':paper.digest_status==='unavailable'?'暂无作者摘要':'中文导读准备中'}</h2><p>{paper.digest_error||'你可以先查看原文摘要或阅读全文。'}</p>{paper.digest_status==='error'&&<button className="button primary" onClick={async()=>{try{await api(paperPath(paper.id)+'/digest','POST');notify('已重新加入生成队列');}catch(e:any){notify(e.message);onSettings();}}}>重新生成</button>}</div>):tab==='figures'?<Figures key={paper.id} paper={paper} notify={notify}/>:tab==='abstract'?<div className="abstract-content"><div className="section-eyebrow">ABSTRACT<span>作者原文</span></div><p>{paper.abstract||'PubMed 未提供作者摘要，请打开全文阅读。'}</p><div className="citation"><h3>引用信息</h3><p>{paper.authors.join(', ')}. {paper.title} {paper.journal}. {paper.publication_date}.</p><button className="text-button" onClick={copy}><Copy size={14}/>复制引用</button></div></div>:<div className="notes-content"><label className="sr-only" htmlFor="paper-note">论文笔记</label><textarea id="paper-note" maxLength={20000} value={note} onChange={e=>setNote(e.target.value)} placeholder="写下你的笔记…"/><div className="note-actions"><span>{note.length} / 20000 字</span><button className="button primary" disabled={saving||note===paper.note} onClick={async()=>{setSaving(true);if(await onPatch(paper.id,{note}))notify('笔记已保存');setSaving(false);}}>{saving?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}保存笔记</button></div></div>}
   </div>
  </div>:<div className="reader-empty"><div className="reader-empty-icon"><BookOpen size={37} strokeWidth={1.5}/></div><h2>选择一篇文献</h2><p>在这里阅读导读、摘要与全文。</p></div>}
 </section>;
}
function Figures({paper,notify}:{paper:Paper;notify:(s:string)=>void}){
 const [state,setState]=useState<FigureState|null>(null);
 const [error,setError]=useState('');
 const [zoom,setZoom]=useState<Figure|null>(null);
 const [scale,setScale]=useState(1);

 useEffect(()=>{
  let alive=true;
  const read=async()=>{
   try{
    const data=await api<FigureState>(paperPath(paper.id)+'/figures');
    if(alive){setState(data);setError('');}
   }catch(e:any){if(alive)setError(e.message);}
  };
  void read();
  const timer=setInterval(()=>void read(),3500);
  return()=>{alive=false;clearInterval(timer);};
 },[paper.id]);

 useEffect(()=>{
  if(!zoom)return;
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setZoom(null);};
  window.addEventListener('keydown',close);
  return()=>window.removeEventListener('keydown',close);
 },[zoom]);

 const waiting=['idle','pending','loading','pdf_pending','pdf_processing','publisher_processing'].includes(state?.status||'');
 const waitingText=state?.status==='loading'
  ?'正在获取 PMC 正文中的主图'
  :state?.status==='pdf_processing'
   ?'正在从本机 PDF 提取主图和图注'
   :state?.status==='publisher_processing'
    ?'正在从出版社全文页获取主图'
   :state?.status==='pdf_pending'
    ?'PDF 已就绪，正在提取主图和图注'
    :state?.status==='pending'
     ?'已获取 PMC 正文，正在提取主图'
     :state?.status==='idle'
      ?'等待后台准备全文'
      :'正在准备主图解读';
 const source=state?.figures.some(figure=>figure.origin==='pmc')
  ?state.source_url||paper.full_text_url||paper.url
  :paperPath(paper.id)+'/pdf';

 return <div className="figures-module">
  {error&&<p className="inline-error">{error}</p>}
  {!state
   ?<div className="loading-line"><LoaderCircle className="spin" size={18}/>正在读取图文状态</div>
   :waiting
    ?<div className="empty-state"><LoaderCircle className="spin" size={30}/><h2>{waitingText}</h2></div>
    :state.status==='no_pmc'
     ?<div className="empty-state"><Images size={33}/><h2>{state.pdf_available?'全文主图正在准备':'尚未取得可解析的全文 PDF'}</h2><p>PDF 下载完成后会自动提取编号主图和作者图注。</p></div>
     :state.status==='no_figures'
      ?<div className="empty-state"><Images size={33}/><h2>全文没有可识别的编号主图</h2><p>可以继续查看中文导读或原文摘要。</p></div>
      :['unavailable','error','pdf_error','publisher_error'].includes(state.status)
       ?<div className="empty-state"><Images size={33}/><h2>{state.status==='publisher_error'?'出版社图文解析没有完成':'全文图表读取没有完成'}</h2><p>{state.error||state.pdf_index?.error||state.publisher_index?.error||'请确认全文已取得并完成解析。'}</p>{state.status==='publisher_error'&&<button className="button secondary" disabled={!state.ai_configured} onClick={async()=>{try{await api(paperPath(paper.id)+'/figures/retry','POST');notify('已重新安排出版社图表解析');}catch(e:any){notify(e.message);}}}>重新尝试</button>}<a className="text-button" href={paper.full_text_url||paper.url} target="_blank" rel="noreferrer">打开原始全文<ArrowUpRight size={14}/></a></div>
       :<div>
        <div className="figure-module-heading"><div><h2>{state.figures.length} 张论文主图</h2><p>图像与作者图注已从论文全文提取</p></div><a href={source} target="_blank" rel="noreferrer" className="text-button">打开原文<ArrowUpRight size={14}/></a></div>
        {state.publisher_index?.status==='partial'&&<p className="figure-source-note">出版社页面只提供了部分主图，系统会用已取得的 PDF 核对并补齐其余图表。</p>}
        {state.figures.map(figure=><article className="figure-card" key={figure.id}>
         <header><span className="figure-label">{figure.label}</span><h3>{figure.analysis?.title_zh||'正文主图'}</h3></header>
         {figure.image_src&&<button className="figure-image" aria-label={'查看'+figure.label+'原图'} onClick={()=>{setZoom(figure);setScale(1);}}><img src={figure.image_src} alt={figure.alt||figure.caption} loading="lazy"/><span><ZoomIn size={14}/>点击放大</span></button>}
         <details className="original-caption"><summary>{figure.origin==='pdf'?'作者图注 · PDF 第 '+figure.source_page+' 页':figure.origin==='publisher'?'作者图注 · 出版社全文页':'作者图注'}</summary><p>{figure.caption}</p>{figure.origin!=='pdf'&&<a href={figure.source_url} target="_blank" rel="noreferrer">打开图表原文<ArrowUpRight size={12}/></a>}</details>
         {figure.analysis
          ?<div className="figure-analysis"><h4>这张图怎么读</h4><p>{figure.analysis.overview}</p>{figure.analysis.panels.length>0&&<div className="panel-explanations">{figure.analysis.panels.map((panel,index)=><div key={index}><strong>{panel.label}</strong><p>{panel.explanation}</p></div>)}</div>}<div className="figure-takeaway"><strong>核心信息</strong><p>{figure.analysis.takeaway}</p></div><ul className="figure-caveats">{figure.analysis.caveats.map((caveat,index)=><li key={index}>{caveat}</li>)}</ul><span className="figure-model">视觉解读 · {figure.model}</span></div>
          :<div className={'figure-generation '+(figure.status==='error'?'has-error':'')}>{figure.status==='error'?<><AlertCircle size={17}/><p>{figure.error}</p><button className="text-button" onClick={async()=>{try{await api('/figures/'+encodeURIComponent(figure.id)+'/retry','POST');notify('已重新安排此图解读');}catch(e:any){notify(e.message);}}}>重新解读</button></>:<><LoaderCircle size={17} className="spin"/><p>{figure.status==='generating'?'正在解读主图':state.ai_configured?'等待图文模型处理':'配置图文模型后将自动解读'}</p></>}</div>}
        </article>)}
       </div>}
  {zoom&&<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={zoom.label+'原图'} onKeyDown={event=>{if(event.key==='Escape')setZoom(null);}}>
   <header><strong>{zoom.label}</strong><span>{zoom.analysis?.title_zh}</span><button className="icon-button" aria-label="缩小图片" onClick={()=>setScale(Math.max(.5,scale-.25))}><ZoomOut size={19}/></button><span>{Math.round(scale*100)}%</span><button className="icon-button" aria-label="放大图片" onClick={()=>setScale(Math.min(3,scale+.25))}><ZoomIn size={19}/></button><a className="icon-button" aria-label="打开原图" href={zoom.image_src||undefined} target="_blank" rel="noreferrer"><ExternalLink size={18}/></a><button className="icon-button" aria-label="关闭原图" onClick={()=>setZoom(null)} autoFocus><X size={21}/></button></header>
   <div className="lightbox-scroll"><img src={zoom.image_src||undefined} alt={zoom.alt||zoom.caption} style={{width:scale*100+'%',maxWidth:'none'}}/></div>
  </div>}
 </div>;
}
