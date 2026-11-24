import {useState} from 'react';
import {RefreshCw, LoaderCircle} from 'lucide-react';
import type {Paper} from './types';
import {api, paperPath} from './api';
import {formatDate} from './dates';

export function DigestProvenance({paper,currentModel,notify}:{paper:Paper;currentModel:string;notify:(message:string)=>void}) {
  const [requesting,setRequesting]=useState(false);
  const historical=!!currentModel&&paper.digest_model!==currentModel;
  const busy=requesting||['pending','generating'].includes(paper.digest_status);
  async function regenerate() {
    setRequesting(true);
    try {
      await api(paperPath(paper.id)+'/digest','POST');
      notify('已安排重新生成，完成后会自动更新导读和模型署名');
    } catch(e:any) {notify(e.message);}
    finally {setRequesting(false);}
  }
  return <div className={'digest-provenance '+(historical?'history':'')}>
    <div className="digest-generated"><span>AI 导读</span><strong>{paper.digest_model||'未记录'}</strong>{paper.digest_at&&<time className="sr-only" dateTime={paper.digest_at}>生成于 {formatDate(paper.digest_at)}</time>}</div>
    {historical&&<p className="digest-current">这是之前保存的导读。当前配置：<strong>{currentModel}</strong>；重新解读后将更新本篇内容。</p>}
    <button className="regenerate-digest" title={historical?'用当前模型重新解读':'重新解读'} aria-label={historical?'用当前模型重新解读':'重新解读'} onClick={()=>void regenerate()} disabled={busy}>{busy?<LoaderCircle size={13} className="spin"/>:<RefreshCw size={13}/>}{(busy||historical)&&<span>{busy?'正在重新生成…':'用当前模型重新解读'}</span>}</button>
    {paper.digest_status==='error'&&<p className="digest-error" role="alert">重新生成失败：{paper.digest_error}。下方保留上次生成的导读，可再次尝试。</p>}
  </div>;
}
