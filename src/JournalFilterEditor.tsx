import {useState} from 'react';
import {LoaderCircle,Plus,Sparkles,X} from 'lucide-react';
import {api} from './api';
import {impactLabel,passesImpact,type ImpactThreshold} from '../shared/impact';
import type {JournalOption} from './types';

type JournalPlan = {
  journals:JournalOption[];
  impact:ImpactThreshold|null;
  unresolved:string[];
  catalog_missing_count:number;
  interpretation:string;
};

export function JournalFilterEditor({description,onDescription,selected,onSelection,onThreshold,threshold,disabled}:{
  description:string;
  onDescription:(value:string)=>void;
  selected:JournalOption[];
  onSelection:(value:JournalOption[])=>void;
  onThreshold:(value:ImpactThreshold)=>void;
  threshold:ImpactThreshold|null;
  disabled:boolean;
}){
  const [query,setQuery]=useState('');
  const [matches,setMatches]=useState<JournalOption[]|null>(null);
  const [plan,setPlan]=useState<JournalPlan|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const selectedIds=new Set(selected.map(j=>j.id));
  const eligible=selected.filter(j=>passesImpact(j,threshold));
  const excluded=selected.filter(j=>!passesImpact(j,threshold));

  async function generate(){
    setBusy('generate');setError('');setPlan(null);
    try{
      const result=await api<JournalPlan>('/journals/generate','POST',{description});
      setPlan(result);
      if(result.journals.length)onSelection(result.journals);
      if(result.impact)onThreshold(result.impact);
    }catch(error){setError((error as Error).message);}
    finally{setBusy('');}
  }
  async function search(){
    setBusy('search');setError('');
    try{
      const result=await api<{journals:JournalOption[]}>('/journals/search?q='+encodeURIComponent(query.trim()));
      setMatches(result.journals);
    }catch(error){setError((error as Error).message);}
    finally{setBusy('');}
  }
  function removeJournal(id:string){
    onSelection(selected.filter(journal=>journal.id!==id));
  }
  return <section className="journal-filter-editor" aria-labelledby="journal-filter-heading">
    <h4 id="journal-filter-heading">指定期刊</h4>
    <p className="journal-filter-help">可用自然语言生成清单，也可按刊名或 ISSN 添加。开启影响因子筛选时，期刊须同时满足两项条件。</p>
    <fieldset disabled={disabled||!!busy}>
      <label className="field">期刊筛选描述
        <textarea rows={2} maxLength={1500} value={description}
          onChange={event=>{onDescription(event.target.value);setPlan(null);}}
          placeholder="例如：CNS 系列、医学四大刊和胃肠领域顶刊，IF 大于 10"/>
      </label>
      <button className="button secondary" disabled={description.trim().length<2} onClick={()=>void generate()}>
        {busy==='generate'?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>}生成期刊清单
      </button>
      {plan&&<div className="journal-plan-feedback" role="status">
        <p>{plan.journals.length?plan.interpretation:'未生成可匹配的期刊清单。可以修改描述，或手工搜索期刊。'}</p>
        {!!plan.unresolved.length&&<p>待确认：{plan.unresolved.join('、')}</p>}
        {plan.catalog_missing_count>0&&<p>{plan.catalog_missing_count} 本系列期刊缺少可匹配的 JCR 记录。</p>}
      </div>}
      <form className="journal-lookup" onSubmit={event=>{event.preventDefault();if(query.trim())void search();}}>
        <label className="field">添加期刊
          <input value={query} onChange={event=>{setQuery(event.target.value);setMatches(null);}} placeholder="搜索刊名、NEJM 或 ISSN" maxLength={150}/>
        </label>
        <button className="button secondary" disabled={!query.trim()}>{busy==='search'?'搜索中…':'搜索'}</button>
      </form>
      {matches&&<ul className="journal-results" aria-label="期刊搜索结果">
        {matches.length===0&&<li>没有找到匹配的期刊</li>}
        {matches.map(j=><li key={j.id}><JournalName journal={j}/>
          <button type="button" className="icon-button" aria-label={'添加 '+j.name}
            disabled={selectedIds.has(j.id)||selected.length>=2500} onClick={()=>onSelection([...selected,j])}><Plus size={16}/></button>
        </li>)}
      </ul>}
      {selected.length>0?<div className="journal-selection">
        <details open>
          <summary>符合条件的期刊 · {eligible.length} 本{threshold&&` · ${impactLabel(threshold)}`}</summary>
          {eligible.length>0
            ? <SelectedJournals journals={eligible} label="符合条件的期刊" onRemove={removeJournal}/>
            : <p className="journal-filter-help">没有期刊符合当前影响因子条件。</p>}
        </details>
        {excluded.length>0&&<details>
          <summary>当前排除的期刊 · {excluded.length} 本</summary>
          <SelectedJournals journals={excluded} label="当前排除的期刊" onRemove={removeJournal}/>
        </details>}
        <button className="text-button" onClick={()=>{onSelection([]);onDescription('');setPlan(null);}}>清空期刊清单</button>
      </div>:<p className="journal-filter-help">当前不限期刊。</p>}
    </fieldset>
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}

function JournalName({journal}:{journal:JournalOption}){
  const factor=journal.impact_factor?.toFixed(1)||journal.jif_label;
  const metric=factor?`IF ${factor}`:journal.jif_status==='suppressed'?'JIF 暂停公布':'暂无 2025 JIF';
  return <span><strong>{journal.name}</strong><small>{journal.issns.join(' / ')} · {metric}</small></span>;
}

function SelectedJournals({journals,label,onRemove}:{journals:JournalOption[];label:string;onRemove:(id:string)=>void}){
  return <ul aria-label={label} className="journal-results">{journals.map(journal=><li key={journal.id}>
    <JournalName journal={journal}/>
    <button className="icon-button" aria-label={'移除 '+journal.name} onClick={()=>onRemove(journal.id)}><X size={16}/></button>
  </li>)}</ul>;
}
