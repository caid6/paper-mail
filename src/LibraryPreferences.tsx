import {useState} from 'react';
import {Check,Clock,Filter,LoaderCircle,RefreshCw,Database} from 'lucide-react';
import {api} from './api';
import type {ImpactOperator} from '../shared/impact';
import type {JournalOption,State} from './types';
import {JournalFilterEditor} from './JournalFilterEditor';

function localDate(date=new Date()){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function shiftDate(value:string,days:number){const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()-days);return localDate(d);}

export function LibraryPreferences({state,onSaved,notify}:{state:State;onSaved:()=>Promise<void>;notify:(s:string)=>void}){
 const settings=state.settings;
 const [enabled,setEnabled]=useState(settings.min_impact_factor!==''),[min,setMin]=useState(Number(settings.min_impact_factor||10));
 const [operator,setOperator]=useState<ImpactOperator>(settings.min_impact_operator==='gt'?'gt':'gte');
 const [range,setRange]=useState(settings.backfill_range||'30'),[end,setEnd]=useState(settings.backfill_end||localDate()),[start,setStart]=useState(settings.backfill_start||shiftDate(settings.backfill_end||localDate(),30));
 const [dateField,setDateField]=useState<'crdt'|'pdat'>((settings.backfill_date_field as 'crdt'|'pdat')||'crdt'),[limit,setLimit]=useState(Number(settings.backfill_limit||200));
 const [qualityEnabled,setQualityEnabled]=useState(settings.quality_enabled!=='false');
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const [selected,setSelected]=useState<JournalOption[]>(state.selectedJournals||[]);
 const [description,setDescription]=useState(settings.journal_filter_description||'');
 const threshold=enabled?{value:min,operator}:null;
 const invalidThreshold=enabled&&(!Number.isFinite(min)||min<0||min>1000);
 const impactPreferences={min_impact_factor:threshold?.value??null,min_impact_operator:operator,journal_filter_ids:selected.map(j=>j.id),journal_filter_description:description};
 function initializationPreferences(){
  return {
   backfill_range:range,
   backfill_limit:limit,
   backfill_date_field:dateField,
   quality_enabled:qualityEnabled,
   ...(range==='custom'?{backfill_start:start,backfill_end:end}:{backfill_days:Number(range)}),
  };
 }
 async function save(){setBusy('save');setError('');try{await api('/preferences','PUT',impactPreferences);await onSaved();notify('已保存文献筛选条件');}catch(e:any){setError(e.message);}finally{setBusy('');}}
 async function saveInitialization(){setBusy('init-save');setError('');try{await api('/preferences','PUT',initializationPreferences());await onSaved();notify('初始化与质控设置已保存');}catch(e:any){setError(e.message);}finally{setBusy('');}}
 async function initializeLibrary(){setBusy('initialize');setError('');try{const actualEnd=range==='custom'?end:localDate();const actualStart=range==='custom'?start:shiftDate(actualEnd,Number(range));if(!actualStart||!actualEnd||actualStart>actualEnd)throw new Error('请选择有效的开始和结束日期');const confirmed=window.confirm(`将按 ${actualStart} 至 ${actualEnd} 重新建立订阅文献库。本次未纳入的订阅论文可在“移出记录”查看，笔记、已读和星标保留。检索完整成功后才会应用。继续吗？`);if(!confirmed)return;await api('/initialize','POST',{start:actualStart,end:actualEnd,date_field:dateField,range,limit,...impactPreferences,quality_enabled:qualityEnabled});await onSaved();notify(`已开始按 ${actualStart} 至 ${actualEnd} 初始化文献库`);}catch(e:any){setError(e.message);}finally{setBusy('');}}
 const status=settings.initialize_status||'not_started';
 const hasEnabledTopics=state.subscriptions.some(topic=>topic.enabled);
 const initializedRange=settings.initialize_start&&settings.initialize_end?`${settings.initialize_start} 至 ${settings.initialize_end}`:'';
 return <div className="library-preferences">
  <div className="settings-section-title"><div><h3>影响因子与文献筛选</h3><p>筛选同时应用到收件箱、方向标签和后续收取。</p></div><Filter size={19}/></div>
  <label className="toggle-row"><span><strong>按影响因子筛选</strong><small>开启后，仅显示并收取达到阈值的文献。</small></span><input aria-label="启用影响因子筛选" type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/></label>
  <div className="model-fields">
    <label className="field">比较方式<select disabled={!enabled} value={operator} onChange={e=>setOperator(e.target.value as ImpactOperator)}>
      <option value="gte">大于等于（≥）</option><option value="gt">大于（&gt;）</option>
    </select></label>
    <label className="field">最低影响因子<input type="number" min={0} max={1000} step="any" disabled={!enabled}
      value={Number.isNaN(min)?'':min} onChange={e=>setMin(e.target.valueAsNumber)}/></label>
  </div>
  <div className="impact-presets">{[3,5,10,20,30].map(v=><button key={v} className={enabled&&operator==='gte'&&min===v?'active':''} onClick={()=>{setEnabled(true);setMin(v);setOperator('gte');}}>IF ≥ {v}</button>)}<button className={!enabled?'active':''} onClick={()=>setEnabled(false)}>不限 IF</button></div>
  <div className="form-hint"><p>{state.journals.jif_year} JIF · {state.journals.edition} 年 JCR 总表及 {state.journals.reload_date} 修正。影响因子按期刊 ISSN 匹配。</p></div>
  <JournalFilterEditor description={description} onDescription={setDescription} selected={selected} onSelection={setSelected}
    threshold={threshold} onThreshold={value=>{setMin(value.value);setOperator(value.operator);setEnabled(true);}} disabled={!!busy||settings.initialize_status==='running'}/>
  <div className="settings-footer library-save"><span>保存后立即应用，已收取论文不删除。</span><button className="button primary" onClick={save} disabled={!!busy||settings.initialize_status==='running'||invalidThreshold}>{busy==='save'?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>}保存筛选条件</button></div>
  <section className="quality-section" aria-labelledby="quality-title">
   <div className="settings-section-title"><div><h3 id="quality-title">相关性质量控制</h3><p>按标题、摘要和研究方向复核。明确无关且没有其他方向标签的论文会从收件箱移出。</p></div></div>
   <div className="quality-summary">
    <span><strong>{state.quality.relevant}</strong> 核心相关</span>
    <span><strong>{state.quality.borderline}</strong> 边界相关</span>
    {state.quality.status==='enabled'&&<span><strong>{state.quality.pending}</strong> 待质控</span>}
    {state.quality.failed>0&&<span><strong>{state.quality.failed}</strong> 复核失败</span>}
   </div>
   <small className="quality-note">{state.quality.status==='unconfigured'?'在「API 与模型」配置文字模型后开始质控。':state.quality.status==='paused'?'自动质控已暂停。':'统计按论文与研究方向的命中关系计算。'}</small>
  </section>
  <section className="backfill-section" aria-labelledby="backfill-title"><div className="settings-section-title"><div><h3 id="backfill-title">初始化文献库</h3><p>按选定时间窗重新确定当前收件箱；之后由每日任务继续收取新记录。</p></div><Database size={19}/></div>
   <div className="model-fields"><label className="field">建库时间范围<select aria-label="文献库时间范围" value={range} onChange={e=>setRange(e.target.value)}><option value="7">最近 7 天</option><option value="30">最近 1 个月</option><option value="90">最近 3 个月</option><option value="180">最近 6 个月</option><option value="365">最近 1 年</option><option value="custom">自定义日期</option></select></label><label className="field">每个方向最多纳入<input aria-label="初始化每方向文献上限" type="number" min="1" max="5000" value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label></div>
   {range==='custom'&&<div className="model-fields"><label className="field">开始日期<input aria-label="建库开始日期" type="date" value={start} max={end} onChange={e=>setStart(e.target.value)}/></label><label className="field">结束日期<input aria-label="建库结束日期" type="date" value={end} min={start} onChange={e=>setEnd(e.target.value)}/></label></div>}
   <label className="field">日期口径<select aria-label="建库日期口径" value={dateField} onChange={e=>setDateField(e.target.value as 'crdt'|'pdat')}><option value="crdt">PubMed 建档日期（推荐，适合追踪新记录）</option><option value="pdat">论文发表日期</option></select><small>建档日期适合查找 PubMed 最近建立的记录。发表日期适合按论文的发表时间回溯。</small></label>
   <label className="toggle-row quality-toggle"><span><strong>自动进行相关性质控</strong><small>适用于历史补收、每日推送和手动收取。明确无关且无其他方向标签的论文会从收件箱移出。</small></span><input aria-label="启用相关性质控" type="checkbox" checked={qualityEnabled} onChange={e=>setQualityEnabled(e.target.checked)}/></label>
   <div className="form-hint"><p>初始化更新订阅范围，手动添加的论文仍可在收件箱查看。本次未纳入的订阅文献可在“移出记录”查看，阅读记录和笔记会保留。</p></div>
   <div className="backfill-actions"><button className="button secondary" onClick={saveInitialization} disabled={!!busy||status==='running'||!Number.isFinite(limit)||limit<1||limit>5000}>{busy==='init-save'?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>}保存初始化设置</button><button className="button primary" onClick={initializeLibrary} disabled={!hasEnabledTopics||!!busy||invalidThreshold||status==='running'||!Number.isFinite(limit)||limit<1||limit>5000}>{busy==='initialize'||status==='running'?<LoaderCircle size={15} className="spin"/>:<RefreshCw size={15}/>}按此范围初始化文献库</button><span className={'backfill-status '+status}>{!hasEnabledTopics?'请先添加或启用研究方向':status==='running'?'正在检索并重建邮箱…':status==='complete'?`已建库 · ${initializedRange} · ${settings.initialize_inbox||0} 篇`:status==='error'?settings.initialize_error||'上次初始化失败':'尚未初始化'}</span></div>
  </section>{error&&<div className="error-message" role="alert">{error}</div>}
 </div>;
}
