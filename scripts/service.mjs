import {mkdirSync,writeFileSync,existsSync,readFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const label='local.paper-morning';const uid=process.getuid();
const agent=path.join(homedir(),'Library','LaunchAgents',label+'.plist');
const target=`gui/${uid}`;
const mode=process.argv[2]||'install';
if(process.platform!=='darwin')throw new Error('后台服务安装器适用于 macOS；其他系统请使用 npm start。');
if(mode==='stop'){
 execFileSync('/bin/launchctl',['bootout',`${target}/${label}`],{stdio:'inherit'});
 if(existsSync(agent))unlinkSync(agent);
 console.log('后台服务已停止并取消登录启动，阅读数据仍保留。');process.exit(0);
}
if(mode==='status'){
 execFileSync('/bin/launchctl',['print',`${target}/${label}`],{stdio:'inherit'});process.exit(0);
}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
mkdirSync(path.dirname(agent),{recursive:true});mkdirSync(path.join(root,'data'),{recursive:true});
const node=execFileSync('/usr/bin/which',['node'],{encoding:'utf8'}).trim();
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
if(existsSync(agent)&&readFileSync(agent,'utf8')!==plist)throw new Error('已存在其他位置的Paper-mail 服务。请先运行原目录的停止后台服务.command，再从本目录启动。');
writeFileSync(agent,plist,{mode:0o600});
try{execFileSync('/bin/launchctl',['print',`${target}/${label}`],{stdio:'pipe'});console.log('后台服务已经运行。');}
catch{execFileSync('/bin/launchctl',['bootstrap',target,agent],{stdio:'inherit'});console.log('后台服务已安装，下次登录会自动启动。');}
