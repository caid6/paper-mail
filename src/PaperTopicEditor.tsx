import {useCallback,useRef,useState,type FormEvent} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import {Modal} from './Modals';
import type {Paper,Subscription} from './types';

type Props={
 paper:Paper;
 topics:Subscription[];
 onClose:()=>void;
 onManage:()=>void;
 onPatch:(id:string,data:unknown)=>Promise<boolean>;
 notify:(text:string)=>void;
};

export function PaperTopicEditor({paper,topics,onClose,onManage,onPatch,notify}:Props){
 const [original]=useState(()=>new Set(paper.subscriptions.map(topic=>topic.id)));
 const [selected,setSelected]=useState(()=>new Set(original));
 const [saving,setSaving]=useState(false);
 const submitting=useRef(false);
 const changes=topics
  .filter(topic=>selected.has(topic.id)!==original.has(topic.id))
  .map(topic=>({subscription_id:topic.id,included:selected.has(topic.id)}));
 const close=useCallback(()=>{if(!submitting.current)onClose();},[onClose]);

 function toggle(id:string,included:boolean){
  setSelected(current=>{
   const next=new Set(current);
   if(included)next.add(id);
   else next.delete(id);
   return next;
  });
 }

 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(submitting.current||!changes.length)return;
  submitting.current=true;
  setSaving(true);
  try{
   if(await onPatch(paper.id,{topic_changes:changes})){
    onClose();
    notify('研究方向标签已更新');
   }
  }finally{
   submitting.current=false;
   setSaving(false);
  }
 }

 return <Modal title="编辑研究方向标签" subtitle="可勾选多个方向，取消勾选即可移除标签。" onClose={close}>
  {topics.length>0?<form className="paper-topic-editor" onSubmit={save}>
   <div className="paper-topic-options">
    {topics.map((topic,index)=><label key={topic.id}>
     <input type="checkbox" data-initial-focus={index===0?true:undefined} checked={selected.has(topic.id)}
       disabled={saving} onChange={event=>toggle(topic.id,event.target.checked)}/>
     <span className="paper-topic-dot" style={{background:topic.color}} aria-hidden="true"/>
     <span>{topic.name}</span>
    </label>)}
   </div>
   <div className="paper-topic-actions">
    <button type="button" className="button ghost" onClick={close} disabled={saving}>取消</button>
    <button type="submit" className="button primary" disabled={saving||!changes.length}>
     {saving?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>}保存标签
    </button>
   </div>
  </form>:<div className="paper-topic-editor paper-topic-empty">
   <p>先添加一个研究方向，即可把论文归到该方向。</p>
   <button className="button primary" onClick={onManage}>管理研究方向</button>
  </div>}
 </Modal>;
}
