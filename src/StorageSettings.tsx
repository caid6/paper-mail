import {useState} from 'react';
import {AlertCircle,FolderOpen,HardDrive,LoaderCircle,Move} from 'lucide-react';
import type {State} from './types';
import './desktop';

export function StorageSettings({storage,notify}:{storage:State['storage'];notify:(message:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function openPdfFolder(){
  setError('');
  try{await window.paperMailDesktop?.openPdfFolder();}
  catch(e){setError(e instanceof Error?e.message:'无法打开 PDF 文件夹');}
 }
 async function changeLocation(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const result=await window.paperMailDesktop?.changeStorageLocation();
   if(result?.restarting)notify('正在迁移本机数据并重启 Paper-mail');
  }catch(e){setError(e instanceof Error?e.message:'无法更改存储位置');}
  finally{setBusy(false);}
 }
 return <section className="storage-settings" aria-labelledby="storage-settings-title">
  <div className="storage-settings-heading"><HardDrive size={19}/><h3 id="storage-settings-title">本机存储</h3></div>
  <div className="storage-location-row"><span>文献库与配置</span><code>{storage.root}</code></div>
  <div className="storage-location-row"><span>PDF 文件</span><code>{storage.pdfFolder}</code></div>
  <p className="storage-location-note">数据按显示路径保存在本机目录；若选择同步盘目录，第三方同步软件也可能同步文件。使用 AI 阅读功能时，提取的文本会发送到你配置的模型服务。</p>
  {window.paperMailDesktop&&<p className="storage-location-note">选择空文件夹可复制到新位置；选择已有研邮数据目录可切换过去。完成后应用会重启，旧位置的数据会保留。</p>}
  {window.paperMailDesktop&&<div className="storage-location-actions">
   <button type="button" className="button secondary" onClick={()=>void openPdfFolder()}><FolderOpen size={16}/>打开 PDF 文件夹</button>
   <button type="button" className="button ghost" onClick={()=>void changeLocation()} disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<Move size={16}/>}更改存储位置</button>
  </div>}
  {busy&&<p className="storage-location-note" role="status">正在复制本机数据，完成后应用会重启。</p>}
  {error&&<p className="storage-location-error" role="alert"><AlertCircle size={15}/>{error}</p>}
 </section>;
}
