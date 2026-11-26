import {pythonExecutable} from '../scripts/python-runtime.mjs';
import {load} from 'cheerio';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {downloadedPath,downloadInfo} from './downloads.ts';
import {z} from 'zod';
import type {DB} from './core.ts';
import {getPaper} from './library.ts';
import {aiConfigured,activeAI,generateFigureAnalysis,modelJobStatus} from './ai.ts';
import {readingScope} from './reading-scope.ts';
import {fetchPMC,PMCUnavailable} from './pmc.ts';
export type FigureOrigin='pmc'|'publisher'|'pdf';
export type ParsedFigure={id:string;label:string;caption:string;context:string;alt:string;image_url:string;source_url:string;position:number};
export function parsePMC(html:string,pmcid:string,pmid:string){
 const $=load(html),body=$('article .main-article-body');
 if(!body.length)throw new Error('此 PMC 页面没有可访问的全文');
 if($('meta[name="citation_pmid"]').attr('content')!==pmid)throw new Error('全文页面与 PMID 不一致');
 const canonical=$('link[rel="canonical"]').attr('href');
 if(!canonical||new URL(canonical).pathname!==`/articles/${pmcid}/`)throw new Error('全文页面与 PMCID 不一致');
 const figures:ParsedFigure[]=[];
 body.find('figure').each((_i,el)=>{
  if($(el).parents('.supplementary-material,.app,.appendix').length)return;
  const id=$(el).attr('id');if(!id)throw new Error('全文主图缺少标识符');
  const img=$(el).find('img.graphic');if(img.length!==1)throw new Error(`主图 ${id} 的图像结构不被支持`);
  const src=img.attr('src');if(!src)throw new Error(`主图 ${id} 缺少图像地址`);
  const image_url=new URL(src,canonical).href;
  const label=$(el).find('.obj_head').first().text().replace(/\s+/g,' ').trim();
  const caption=$(el).find('figcaption').text().replace(/\s+/g,' ').trim();
  const refs:string[]=[];body.find('a').each((_j,a)=>{if($(a).attr('href')==='#'+id){const p=$(a).closest('p,.p');if(p.length&&!p.closest('figure').length){const t=p.text().replace(/\s+/g,' ').trim();if(t&&!refs.includes(t))refs.push(t);}}});
  figures.push({id,label:label||id,caption,context:refs.join('\n\n'),alt:img.attr('alt')||'',image_url,source_url:canonical+'#'+id,position:figures.length+1});
 });
 const license=$('a[href*="creativecommons.org/licenses/"]').first();
 return {figures,source_url:canonical,license:license.length?license.text().trim()+' · '+license.attr('href'):'以原始全文页面标注为准',pdf_url:$('meta[name="citation_pdf_url"]').attr('content')||''};
}
export function figureState(db:DB,paperId:string){
 const configured=aiConfigured();
 const paper=db.prepare('SELECT pmcid,doi FROM papers WHERE id=?').get(paperId);
 const fulltext=db.prepare('SELECT status,error,source_url,license,pdf_url,fetched_at FROM fulltexts WHERE paper_id=?').get(paperId);
 const download=db.prepare('SELECT status FROM downloads WHERE paper_id=?').get(paperId);
 const pdf_available=download?.status==='ready';
 const pdfIndex=db.prepare('SELECT status,error,extracted_at FROM pdf_figure_indexes WHERE paper_id=?').get(paperId);
 const publisherIndex=db.prepare('SELECT status,error,fetched_at FROM publisher_figure_indexes WHERE paper_id=?').get(paperId);
 const figures=db.prepare(`SELECT id,position,label,caption,alt,image_url,source_url,status,analysis,error,model,generated_at,image_path,origin,source_page
  FROM figures WHERE paper_id=? ORDER BY position`).all(paperId).map((row:any)=>{
   const {image_path,status,model,...figure}=row;
   return {...figure,status:image_path?modelJobStatus(status,configured):status,model,analysis:figure.analysis?JSON.parse(String(figure.analysis)):null,
    image_src:image_path?'/api/figures/'+encodeURIComponent(String(figure.id))+'/image':null};
  });
 const pmcFigures=figures.filter(figure=>figure.origin==='pmc');
 const publisherFigures=figures.filter(figure=>figure.origin==='publisher');
 let status=paper?.pmcid?fulltext?.status||'idle':'no_pmc';
 if(pmcFigures.length||publisherFigures.length||figures.some(figure=>figure.origin==='pdf'))status='ready';
 else if(fulltext?.status==='pending'||fulltext?.status==='loading')status=fulltext.status;
 else if(publisherIndex?.status==='processing')status='publisher_processing';
 else if(pdf_available)status=pdfIndex?.status==='processing'?'pdf_processing':pdfIndex?.status==='error'?'pdf_error':pdfIndex?.status==='no_figures'?'no_figures':'pdf_pending';
 else if(download?.status==='running')status='pdf_downloading';
 else if(download?.status==='pending')status=downloadInfo().available?'pdf_queued':'pdf_environment_required';
 else if(publisherIndex?.status==='error')status='publisher_error';
 else if(publisherIndex?.status==='no_figures'||fulltext?.status==='ready')status='no_figures';
 if(status==='pdf_pending'&&!downloadInfo().available)status='pdf_environment_required';
 return {...fulltext,status,pdf_available,pdf_index:pdfIndex||null,publisher_index:publisherIndex||null,ai_configured:configured,figures};
}
const figureWorkers=new WeakSet<DB>();
const fulltextWorkers=new WeakSet<DB>();
const pdfFigureWorkers=new WeakSet<DB>();
const pdfFigureJobs=new WeakMap<DB,Set<string>>();
const publisherFigureWorkers=new WeakSet<DB>();
const publisherFigureJobs=new WeakMap<DB,Set<string>>();
export function imageMimeType(data:Buffer){
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(data.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii')))return 'image/gif';
 if(data.subarray(0,4).toString('ascii')==='RIFF'&&data.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
 throw new Error('主图文件不是受支持的 JPEG、PNG、GIF 或 WebP 图像');
}
const natureCaption=/^(?:Fig(?:ure)?\.?\s*)(\d+[a-z]?)\s*[:|.\-–]\s*(\S.*)$/i;
export function parseNatureFigures(html:string,doi:string){
 const $=load(html),returnedDOI=$('meta[name="citation_doi"]').attr('content')||'';
 if(returnedDOI.toLowerCase()!==doi.toLowerCase())throw new Error('出版社全文页面与论文 DOI 不一致');
 const canonical=$('link[rel="canonical"]').attr('href')||'https://www.nature.com/articles/'+doi.split('/')[1];
 const canonicalURL=new URL(canonical);
 if(canonicalURL.protocol!=='https:'||canonicalURL.hostname!=='www.nature.com'||canonicalURL.pathname!=='/articles/'+doi.split('/')[1])throw new Error('出版社全文页面规范地址与论文 DOI 不一致');
 const figures:ParsedFigure[]=[];
 $('figure').each((_index,element)=>{
  const captionNode=$(element).find('figcaption [id^="Fig"],figcaption [data-test="figure-caption-text"]').first();
  const caption=captionNode.text().replace(/\s+/g,' ').trim();
  const label=captureNatureCaption(caption);
  if(!label)return;
  const img=$(element).find('img[src]').first(),src=img.attr('src');if(!src)return;
  const source=new URL(src.startsWith('//')?'https:'+src:src,canonical);
  if(source.protocol!=='https:'||source.hostname!=='media.springernature.com'||!/^\/m\d+\//.test(source.pathname))return;
  source.pathname=source.pathname.replace(/^\/m\d+\//,'/full/');
  const id=captionNode.attr('id')||label.replace(/\s+/g,'');
  const refs:string[]=[];
  $('a[href="#'+id+'"],a[href="#'+id.toLowerCase()+'"]').each((_refIndex,ref)=>{
   const text=$(ref).closest('p').text().replace(/\s+/g,' ').trim();if(text&&!refs.includes(text))refs.push(text);
  });
  figures.push({id,label,caption,context:refs.join('\n\n'),alt:img.attr('alt')||caption,image_url:source.href,source_url:canonical+'#'+id,position:figures.length+1});
 });
 return {figures,source_url:canonical,license:'出版社公开图像 · 原文许可适用',fingerprint:doi.toLowerCase()};
}
async function fetchNatureFigures(doi:string){
 const match=doi.match(/^10\.1038\/([a-z0-9.-]+)$/i);
 if(!match)throw new Error('当前出版社全文图表读取仅支持 Nature Portfolio 的公开文章页');
 const articleURL=new URL('/articles/'+match[1].toLowerCase(),'https://www.nature.com');
 let url=articleURL,response:Response|undefined;
 for(let redirects=0;redirects<4;redirects++){
  response=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'manual',headers:{'user-agent':'Paper-mail/2.14 (local biomedical literature reader)','accept':'text/html'}});
  if(response.status<300||response.status>=400)break;
  const location=response.headers.get('location');if(!location)throw new Error('出版社页面没有提供有效的跳转地址');
  const next=new URL(location,url);
  const sameArticle=next.protocol==='https:'&&next.hostname==='www.nature.com'&&next.pathname===articleURL.pathname&&!next.username&&!next.password&&!next.port;
  const cookieAuthorization=next.protocol==='https:'&&next.hostname==='idp.nature.com'&&next.pathname==='/authorize'&&!next.username&&!next.password&&!next.port&&next.searchParams.get('response_type')==='cookie'&&next.searchParams.get('client_id')==='grover'&&next.searchParams.get('redirect_uri')===articleURL.href;
  const cookieTransit=next.protocol==='https:'&&next.hostname==='idp.nature.com'&&next.pathname==='/transit'&&!next.username&&!next.password&&!next.port&&next.searchParams.get('redirect_uri')===articleURL.href&&Boolean(next.searchParams.get('code'));
  if(!sameArticle&&!cookieAuthorization&&!cookieTransit)throw new Error('出版社页面跳转离开了 DOI 对应的 Nature 文章页');
  url=next;
 }
 if(!response)throw new Error('出版社没有返回文章页');
 if(!response.ok)throw new Error(`出版社公开全文页不可用（HTTP ${response.status}）`);
 const data=Buffer.from(await response.arrayBuffer());if(data.length>30000000)throw new Error('出版社全文页面超过大小限制');
 return parseNatureFigures(data.toString('utf8'),doi);
}
function captureNatureCaption(caption:string){
 const match=caption.match(natureCaption);if(!match||/^supplementary\s+/i.test(caption)||/^extended\s+data\s+/i.test(caption))return '';
 return 'Figure '+match[1];
}
async function indexPublisherFiguresOnce(db:DB,root:string,paperId:string){
 const paper:any=db.prepare('SELECT doi FROM papers WHERE id=?').get(paperId);if(!paper?.doi)throw new Error('论文没有 DOI');
 const expectedFingerprint=String(paper.doi).toLowerCase();
 db.prepare("INSERT INTO publisher_figure_indexes(paper_id,fingerprint,status,error,fetched_at) VALUES(?,?,'processing',NULL,NULL) ON CONFLICT(paper_id) DO UPDATE SET fingerprint=excluded.fingerprint,status='processing',error=NULL").run(paperId,expectedFingerprint);
 try{
  const source=await fetchNatureFigures(String(paper.doi));
  if(source.fingerprint!==expectedFingerprint)throw new Error('出版社图表 DOI 指纹不一致');
  mkdirSync(path.join(root,'data','figures'),{recursive:true});
  const stored: any[]=[];const failures:string[]=[];
  for(const figure of source.figures){
   try{
    const response=await fetch(figure.image_url,{signal:AbortSignal.timeout(45000),redirect:'error'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());if(data.length>20000000)throw new Error('图像超过 20MB');
    const type=imageMimeType(data),id=createHash('sha256').update(`${paperId}:publisher:${source.fingerprint}:${figure.label}`).digest('hex').slice(0,32);
    const imagePath=id+'.'+type.split('/')[1];writeFileSync(path.join(root,'data','figures',imagePath),data);
    stored.push({id,figure,imagePath,type});
   }catch(error:any){failures.push(`${figure.label}：${error.message||'图像不可用'}`);}
  }
  if(!stored.length&&failures.length)throw new Error(failures.join('；'));
  db.exec('BEGIN IMMEDIATE');
  try{
   const hasPMC=Boolean(db.prepare("SELECT 1 FROM figures WHERE paper_id=? AND origin='pmc' LIMIT 1").get(paperId));
   if(hasPMC){
    db.prepare('UPDATE publisher_figure_indexes SET status=?,error=NULL,fetched_at=? WHERE paper_id=?').run('superseded',new Date().toISOString(),paperId);
    db.exec('COMMIT');
    for(const item of stored)rmSync(path.join(root,'data','figures',item.imagePath),{force:true});
    return;
   }
   db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='publisher'").run(paperId);
   for(const item of stored){
    db.prepare("INSERT INTO figures(id,paper_id,position,label,caption,context,alt,image_url,image_path,image_type,source_url,status,origin) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending','publisher')").run(item.id,paperId,item.figure.position,item.figure.label,item.figure.caption,item.figure.context,item.figure.alt,item.figure.image_url,item.imagePath,item.type,item.figure.source_url);
   }
   if(stored.length){
    db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='pdf' AND label IN (SELECT label FROM figures WHERE paper_id=? AND origin='publisher')").run(paperId,paperId);
    if(!failures.length){
     db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='pdf'").run(paperId);
     db.prepare("UPDATE pdf_figure_indexes SET status='superseded',error=NULL,extracted_at=? WHERE paper_id=?").run(new Date().toISOString(),paperId);
    }
   }
   const status=stored.length?(failures.length?'partial':'ready'):'no_figures';
   db.prepare('UPDATE publisher_figure_indexes SET status=?,error=?,fetched_at=? WHERE paper_id=?').run(status,failures.length?`未能读取 ${failures.join('；')}`:null,new Date().toISOString(),paperId);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }catch(error:any){
  const current:any=db.prepare('SELECT fingerprint FROM publisher_figure_indexes WHERE paper_id=?').get(paperId);
  db.prepare("INSERT INTO publisher_figure_indexes(paper_id,fingerprint,status,error,fetched_at) VALUES(?,?,'error',?,?) ON CONFLICT(paper_id) DO UPDATE SET status='error',error=excluded.error,fetched_at=excluded.fetched_at").run(paperId,current?.fingerprint||String(paper.doi),error.message||'出版社图表获取失败',new Date().toISOString());
  throw error;
 }
}
export async function indexPublisherFigures(db:DB,root:string,paperId:string){
 let active=publisherFigureJobs.get(db);if(!active){active=new Set();publisherFigureJobs.set(db,active);}
 if(active.has(paperId))return;active.add(paperId);
 try{await indexPublisherFiguresOnce(db,root,paperId);}finally{active.delete(paperId);}
}
export async function pumpPublisherFigures(db:DB,root:string){
 if(publisherFigureWorkers.has(db))return;
 publisherFigureWorkers.add(db);
 try{for(;;){
  const paper:any=db.prepare(`SELECT p.id,p.doi FROM papers p LEFT JOIN publisher_figure_indexes i ON i.paper_id=p.id
   WHERE p.doi LIKE '10.1038/%' AND (${readingScope(db)})
     AND (i.paper_id IS NULL OR i.fingerprint<>lower(p.doi) OR i.status='pending')
     AND NOT EXISTS(SELECT 1 FROM fulltexts t WHERE t.paper_id=p.id AND t.status IN ('pending','loading'))
     AND NOT EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.origin='pmc')
   ORDER BY p.received_at DESC,p.published DESC LIMIT 1`).get();
  if(!paper)break;
  try{await indexPublisherFigures(db,root,String(paper.id));void pumpFigures(db,root);}
  catch(error:any){console.error('Nature 正文图表获取失败',paper.id,error.message);}
 }}finally{
  publisherFigureWorkers.delete(db);
  void pumpPDFFigureIndexes(db,root).then(()=>pumpFigures(db,root)).catch(error=>console.error('出版社图片之后的 PDF 补图失败',error.message));
 }
}
export function retryPublisherFigures(db:DB,paperId:string){
 const paper:any=db.prepare('SELECT doi FROM papers WHERE id=?').get(paperId);if(!paper)throw new Error('论文不存在');
 const doi=String(paper.doi||'').toLowerCase();if(!doi.startsWith('10.1038/'))throw new Error('这篇论文没有可识别的 Nature Portfolio DOI');
 db.prepare("INSERT INTO publisher_figure_indexes(paper_id,fingerprint,status,error,fetched_at) VALUES(?,?,'pending',NULL,NULL) ON CONFLICT(paper_id) DO UPDATE SET fingerprint=excluded.fingerprint,status='pending',error=NULL").run(paperId,doi);
 db.prepare("UPDATE pdf_figure_indexes SET status='pending',error=NULL WHERE paper_id=?").run(paperId);
 db.prepare("UPDATE figures SET status='pending',error=NULL WHERE paper_id=? AND status='error'").run(paperId);
}
const pdfFigureSchema=z.object({
 label:z.string().min(1).max(80),caption:z.string().min(1).max(8000),context:z.string().max(16000),alt:z.string().max(8000),
 page:z.number().int().positive().max(1000),file:z.string().regex(/^page-\d{4}-figure-\d{3}\.png$/),
});
function extractPDFFigures(root:string,file:string):Promise<{figures:z.infer<typeof pdfFigureSchema>[];outputDir:string}>{
 return new Promise((resolve,reject)=>{
  const outputDir=mkdtempSync(path.join(tmpdir(),'paper-mail-figures-'));
  const child=spawn(pythonExecutable(),[path.join(root,'scripts','extract_pdf_figures.py')],{stdio:['pipe','pipe','pipe']});
  let output='';let expired=false;
  const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},120000);
  child.stdout.on('data',data=>{output+=data;if(output.length>2000000){expired=true;child.kill('SIGKILL');}});
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(timer);rmSync(outputDir,{recursive:true,force:true});reject(new Error('无法启动 PDF 主图解析器，请安装 requirements.txt 中的 PyMuPDF'));});
  child.on('close',code=>{
   clearTimeout(timer);
   try{
    if(expired)throw new Error('PDF 主图解析超出时间或大小限制');
    const jsonStart=output.indexOf('{');
    if(jsonStart<0)throw new Error('PDF 主图解析器没有返回 JSON');
    const data=JSON.parse(output.slice(jsonStart));
    if(code!==0||!data.ok)throw new Error(data.error||'PDF 主图解析失败');
    if(!Array.isArray(data.figures)||data.figures.length>1500)throw new Error('PDF 主图解析结果无效');
    resolve({figures:data.figures.map((figure:unknown)=>pdfFigureSchema.parse(figure)),outputDir});
   }catch(error){rmSync(outputDir,{recursive:true,force:true});reject(error);return;}
  });
  child.stdin.end(JSON.stringify({file,output_dir:outputDir}));
 });
}
async function indexPDFFiguresOnce(db:DB,root:string,paperId:string,file:string){
 const sha256=createHash('sha256').update(readFileSync(file)).digest('hex');
 const existing:any=db.prepare('SELECT sha256,status FROM pdf_figure_indexes WHERE paper_id=?').get(paperId);
 const hasPMC=()=>Number((db.prepare("SELECT COUNT(*) n FROM figures WHERE paper_id=? AND origin='pmc'").get(paperId) as {n:number}).n)>0;
 if(hasPMC()){
  db.prepare('DELETE FROM figures WHERE paper_id=? AND origin=\'pdf\'').run(paperId);
  db.prepare("INSERT INTO pdf_figure_indexes(paper_id,sha256,status,error,extracted_at) VALUES(?,?,'superseded',NULL,?) ON CONFLICT(paper_id) DO UPDATE SET sha256=excluded.sha256,status='superseded',error=NULL,extracted_at=excluded.extracted_at").run(paperId,sha256,new Date().toISOString());
  return;
 }
 if(existing?.sha256===sha256&&['ready','no_figures','superseded'].includes(existing.status))return;
 db.prepare(`INSERT INTO pdf_figure_indexes(paper_id,sha256,status,error,extracted_at) VALUES(?,?,'processing',NULL,NULL)
   ON CONFLICT(paper_id) DO UPDATE SET sha256=excluded.sha256,status='processing',error=NULL`).run(paperId,sha256);
 let outputDir='';
 try{
  const extracted=await extractPDFFigures(root,file);
  outputDir=extracted.outputDir;
  mkdirSync(path.join(root,'data','figures'),{recursive:true});
  const publisherLabels=new Set((db.prepare("SELECT label FROM figures WHERE paper_id=? AND origin='publisher'").all(paperId) as {label:string}[]).map(figure=>figure.label));
  const missingFigures=extracted.figures.map((figure,index)=>({figure,position:index+1})).filter(item=>!publisherLabels.has(item.figure.label));
  const stored=missingFigures.map(({figure,position})=>{
   const id=createHash('sha256').update(`${paperId}:pdf:${sha256}:${figure.page}:${figure.label}:${position}`).digest('hex').slice(0,32);
   const imagePath=id+'.png';
   writeFileSync(path.join(root,'data','figures',imagePath),readFileSync(path.join(extracted.outputDir,figure.file)));
   return {id,position,figure,image_path:imagePath};
  });
  const sourceUrl='/api/papers/'+encodeURIComponent(paperId)+'/pdf';
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='pdf'").run(paperId);
   if(hasPMC()){
    db.prepare("UPDATE pdf_figure_indexes SET status='superseded',error=NULL,extracted_at=? WHERE paper_id=? AND sha256=?").run(new Date().toISOString(),paperId,sha256);
   }else{
    for(const item of stored){
    db.prepare(`INSERT INTO figures(id,paper_id,position,label,caption,context,alt,image_url,image_path,image_type,source_url,status,origin,source_page)
      VALUES(?,?,?,?,?,?,?,?,?,'image/png',?,'pending','pdf',?)`).run(item.id,paperId,item.position,item.figure.label,item.figure.caption,item.figure.context,item.figure.alt,sourceUrl+'#page='+item.figure.page,item.image_path,sourceUrl+'#page='+item.figure.page,item.figure.page);
    }
    db.prepare('UPDATE pdf_figure_indexes SET status=?,error=NULL,extracted_at=? WHERE paper_id=? AND sha256=?').run(extracted.figures.length?'ready':'no_figures',new Date().toISOString(),paperId,sha256);
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }catch(error:any){
  db.prepare("UPDATE pdf_figure_indexes SET status='error',error=?,extracted_at=? WHERE paper_id=? AND sha256=?").run(error.message||'PDF 图注解析失败',new Date().toISOString(),paperId,sha256);
  throw error;
 }finally{
  if(outputDir)rmSync(outputDir,{recursive:true,force:true});
 }
}
export async function indexPDFFigures(db:DB,root:string,paperId:string,file:string){
 let active=pdfFigureJobs.get(db);
 if(!active){active=new Set();pdfFigureJobs.set(db,active);}
 if(active.has(paperId))return;
 active.add(paperId);
 try{await indexPDFFiguresOnce(db,root,paperId,file);}
 finally{active.delete(paperId);}
}
export const needsPDFFigureIndex=`(pf.paper_id IS NULL OR pf.sha256<>pd.sha256 OR pf.status='pending')
  AND NOT EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.origin='pmc')
  AND (NOT EXISTS(SELECT 1 FROM figures f WHERE f.paper_id=p.id AND f.origin='publisher') OR pi.status='partial')
  AND (p.doi NOT LIKE '10.1038/%' OR pi.status IN ('no_figures','error','partial'))
  AND NOT EXISTS(SELECT 1 FROM fulltexts t WHERE t.paper_id=p.id AND t.status IN ('pending','loading'))`;

export async function pumpPDFFigureIndexes(db:DB,root:string){
 if(pdfFigureWorkers.has(db)||!downloadInfo().available)return;
 pdfFigureWorkers.add(db);
 try{for(;;){
  const row:any=db.prepare(`SELECT p.id FROM papers p JOIN downloads d ON d.paper_id=p.id
    JOIN pdf_documents pd ON pd.paper_id=p.id LEFT JOIN pdf_figure_indexes pf ON pf.paper_id=p.id
    LEFT JOIN publisher_figure_indexes pi ON pi.paper_id=p.id
    WHERE d.status='ready' AND pd.file_name=d.file_name AND (${readingScope(db)})
      AND (${needsPDFFigureIndex})
    ORDER BY p.received_at DESC,p.published DESC,p.id DESC LIMIT 1`).get();
  if(!row)break;
  const id=String(row.id),file=downloadedPath(db,root,id);
  if(!file){db.prepare("UPDATE downloads SET status='interrupted',error='本地 PDF 文件已缺失，请重新上传本篇原文' WHERE paper_id=? AND status='ready'").run(id);continue;}
  try{await indexPDFFigures(db,root,id,file);void pumpFigures(db,root);}
  catch(error:any){console.error('PDF 图文解析失败',id,error.message);}
 }}finally{pdfFigureWorkers.delete(db);}
}
export async function pumpFulltexts(db:DB,root:string,onComplete?:()=>void){
 if(fulltextWorkers.has(db))return;
 fulltextWorkers.add(db);
 try{
  for(;;){
   const row=db.prepare(`SELECT p.id FROM fulltexts t JOIN papers p ON p.id=t.paper_id
     WHERE t.status='pending' AND (t.automatic=0 OR (${readingScope(db)}))
     ORDER BY p.received_at DESC,p.published DESC,p.id DESC LIMIT 1`).get();
   if(!row)break;
   await loadFulltext(db,String(row.id),root);
   onComplete?.();
  }
 }finally{fulltextWorkers.delete(db);}
}
export function queueFulltext(db:DB,paperId:string){
 db.prepare(`INSERT INTO fulltexts(paper_id,status) VALUES(?,'pending')
   ON CONFLICT(paper_id) DO UPDATE SET status='pending',automatic=0,error=NULL
   WHERE fulltexts.status NOT IN ('loading','ready')`).run(paperId);
}
async function loadFulltext(db:DB,paperId:string,root:string){
 const p=db.prepare('SELECT id,pmcid FROM papers WHERE id=?').get(paperId);if(!p)throw new Error('论文不存在');
 if(!p.pmcid){db.prepare("INSERT INTO fulltexts(paper_id,status,error) VALUES(?,'unavailable','没有可访问的 PMC 全文') ON CONFLICT(paper_id) DO UPDATE SET status=excluded.status,error=excluded.error").run(paperId);return;}
 db.prepare("UPDATE fulltexts SET status='loading',error=NULL WHERE paper_id=?").run(paperId);
 try{
  const parsed=await fetchPMC(String(p.pmcid),paperId.replace('pmid:',''));
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='pmc'").run(paperId);
   for(const f of parsed.figures){const id=createHash('sha256').update(paperId+':'+f.id).digest('hex').slice(0,32);db.prepare("INSERT INTO figures(id,paper_id,position,label,caption,context,alt,image_url,source_url,origin) VALUES(?,?,?,?,?,?,?,?,?,'pmc')").run(id,paperId,f.position,f.label,f.caption,f.context,f.alt,f.image_url,f.source_url);}
   if(parsed.figures.length){
    db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='pdf'").run(paperId);
    db.prepare("UPDATE pdf_figure_indexes SET status='superseded',error=NULL,extracted_at=? WHERE paper_id=?").run(new Date().toISOString(),paperId);
    db.prepare("DELETE FROM figures WHERE paper_id=? AND origin='publisher'").run(paperId);
    db.prepare("UPDATE publisher_figure_indexes SET status='superseded',error=NULL,fetched_at=? WHERE paper_id=?").run(new Date().toISOString(),paperId);
   }
   db.prepare("UPDATE fulltexts SET status='ready',error=NULL,source_url=?,license=?,pdf_url=?,fetched_at=? WHERE paper_id=?").run(parsed.source_url,parsed.license,parsed.pdf_url,new Date().toISOString(),paperId);
   if(parsed.pdf_url)db.prepare('UPDATE papers SET pdf_url=? WHERE id=?').run(parsed.pdf_url,paperId);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  void pumpFigures(db,root);
 }catch(e:any){db.prepare('UPDATE fulltexts SET status=?,error=? WHERE paper_id=?').run(e instanceof PMCUnavailable?'unavailable':'error',e.message,paperId);}
}
export async function pumpFigures(db:DB,root:string){
 if(figureWorkers.has(db))return;
 figureWorkers.add(db);
 try{for(;;){
  const row:any=db.prepare(`SELECT f.*,p.pmcid,p.title,p.abstract,p.authors,p.published,p.updated,p.categories,p.url,p.pdf_url,p.source,p.journal,p.publication_date,p.indexed_at,p.doi,p.pub_types,p.full_text_url
    FROM figures f JOIN papers p ON p.id=f.paper_id LEFT JOIN fulltexts t ON t.paper_id=f.paper_id
    WHERE f.status='pending' AND (? OR f.image_path='') AND ((${readingScope(db)}) OR (f.origin='pmc' AND t.paper_id IS NOT NULL AND t.automatic=0))
    ORDER BY p.received_at DESC,p.published DESC,p.id DESC,f.position LIMIT 1`).get(Number(aiConfigured()));
  if(!row)break;
  db.prepare('UPDATE figures SET status=?,error=NULL WHERE id=?').run(row.image_path?'generating':'fetching',row.id);
  try{
   let data:Buffer,type:string;
   if(row.image_path){data=readFileSync(path.join(root,'data','figures',row.image_path));type=row.image_type;}
   else{const url=new URL(row.image_url);if(url.protocol!=='https:'||url.username||url.password||url.port||!['cdn.ncbi.nlm.nih.gov','pmc.ncbi.nlm.nih.gov','pmc-oa-opendata.s3.amazonaws.com'].includes(url.hostname))throw new Error('主图地址不属于 PMC 图像服务');
    const res=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error'});if(!res.ok)throw new Error(`主图获取失败（HTTP ${res.status}）`);
    data=Buffer.from(await res.arrayBuffer());if(data.length>20000000)throw new Error('单张图像超过 20MB，无法提交模型');
    type=imageMimeType(data);
    const md5=url.searchParams.get('md5');
    if(md5&&createHash('md5').update(data).digest('hex')!==md5)throw new Error('主图内容校验失败');
    mkdirSync(path.join(root,'data','figures'),{recursive:true});writeFileSync(path.join(root,'data','figures',row.id),data);
    db.prepare("UPDATE figures SET image_path=?,image_type=?,status='pending' WHERE id=?").run(row.id,type,row.id);
    continue;
   }
   const paper=getPaper(db,row.paper_id)!;const model=activeAI().figure_model;
   const analysis=await generateFigureAnalysis({...row,source_page:row.source_page||null},paper,{data,type});
   db.prepare("UPDATE figures SET status='ready',analysis=?,error=NULL,model=?,generated_at=? WHERE id=?").run(JSON.stringify(analysis),model,new Date().toISOString(),row.id);
  }catch(e:any){db.prepare("UPDATE figures SET status='error',error=? WHERE id=?").run(e.message,row.id);}
 }}finally{figureWorkers.delete(db);}
}
