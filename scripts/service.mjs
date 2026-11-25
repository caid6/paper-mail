import {mkdirSync,writeFileSync,existsSync,readFileSync,unlinkSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='local.paper-morning';const uid=process.getuid();
const agent=path.join(homedir(),'Library','LaunchAgents',label+'.plist');
function launchctl(...args){return execFileSync('/bin/launchctl',args,{stdio:'pipe'});}
const target=`gui/${uid}`;
const mode=process.argv[2]||'install';
if(process.platform!=='darwin')throw new Error('后台服务安装器适用于 macOS；其他系统请使用 npm start。');
const installedRoot=existsSync(agent)
  ? execFileSync('/usr/bin/plutil',['-extract','WorkingDirectory','raw',agent],{encoding:'utf8'}).trim()
  : null;
const sameInstall=installedRoot===root;
function checkLocation(){
  if(installedRoot&&!sameInstall)throw new Error('已有另一处 Paper-mail 后台安装。请从原安装目录运行“停止后台服务.command”。');
  const directory=realpathSync(root);
  const protectedRoots=['Desktop','Documents','Downloads','Library/Mobile Documents'].map(name=>path.join(homedir(),name));
  if(!sameInstall&&protectedRoots.some(folder=>directory===folder||directory.startsWith(folder+path.sep))){
    console.error('请将 Paper-mail 文件夹移到 ~/Applications/paper-mail，再双击“启动Paper-mail.command”。macOS 可能限制登录后台服务访问当前目录。');
    process.exit(1);
  }
}
function running(){
  try{launchctl('print',`${target}/${label}`);return true;}catch{return false;}
}
if(mode==='check-location'){checkLocation();process.exit(0);}
if(mode==='stop'){
  if(installedRoot&&!sameInstall)throw new Error('请从原安装目录停止 Paper-mail 后台服务。');
  if(running())launchctl('bootout',`${target}/${label}`);
  if(existsSync(agent))unlinkSync(agent);
  console.log('后台服务已停止并取消登录启动，阅读数据仍保留。');
  process.exit(0);
}
if(mode==='status'){
  execFileSync('/bin/launchctl',['print',`${target}/${label}`],{stdio:'inherit'});
  process.exit(0);
}
if(mode!=='install')throw new Error('未知的后台服务操作');
checkLocation();
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
mkdirSync(path.dirname(agent),{recursive:true});mkdirSync(path.join(root,'data'),{recursive:true});
const node=process.execPath;
const args=[node,'--import','tsx',path.join(root,'server','index.ts')];
const plist=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(x=>`<string>${escape(x)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${escape(path.join(root,'data','service.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(root,'data','service-error.log'))}</string>
</dict></plist>`;
if(running()){
  if(!sameInstall)throw new Error('系统中已有 Paper-mail 后台服务，请先停止该服务。');
  if(readFileSync(agent,'utf8')===plist)launchctl('kickstart','-k',`${target}/${label}`);
  else launchctl('bootout',`${target}/${label}`);
}
writeFileSync(agent,plist,{mode:0o600});
if(!running())launchctl('bootstrap',target,agent);

const {config}=await import('dotenv');
const port=process.env.PORT||config({path:path.join(root,'.env'),quiet:true}).parsed?.PORT||4317;
const url=`http://127.0.0.1:${port}`;
for(let attempt=0;attempt<20;attempt++){
  try{
    const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});
    if(response.ok && (await response.json()).app==='paper-mail'){
      console.log('Paper-mail 已启动。');
      execFileSync('/usr/bin/open',[url]);
      process.exit(0);
    }
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
}
throw new Error('后台服务没有响应。请运行 node scripts/service.mjs status，查看 data/service-error.log。');
