import {load} from 'cheerio';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {DB} from './core.ts';
import {getPaper} from './library.ts';
import {aiConfigured,activeAI,generateFigureAnalysis} from './ai.ts';
import {readingScope} from './reading-scope.ts';
import {fetchPMC,PMCUnavailable} from './pmc.ts';
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
 const paper=db.prepare('SELECT pmcid FROM papers WHERE id=?').get(paperId);
 const fulltext=db.prepare('SELECT status,error,source_url,license,pdf_url,fetched_at FROM fulltexts WHERE paper_id=?').get(paperId);
 const status=fulltext?.status==='ready'?'ready':paper?.pmcid?fulltext?.status||'idle':'no_pmc';
 const pdf_available=!!db.prepare("SELECT 1 FROM downloads WHERE paper_id=? AND status='ready'").get(paperId);
 const figures=db.prepare(`SELECT id,position,label,caption,alt,image_url,source_url,status,analysis,error,model,generated_at,image_path
  FROM figures WHERE paper_id=? ORDER BY position`).all(paperId).map(row=>{
   const {image_path,status,model,...figure}=row;
   return {...figure,status,model,analysis:figure.analysis?JSON.parse(String(figure.analysis)):null,
    image_src:image_path?'/api/figures/'+encodeURIComponent(String(figure.id))+'/image':null};
  });
 return {...fulltext,status,pdf_available,ai_configured:aiConfigured(),figures};
}
const figureWorkers=new WeakSet<DB>();
const fulltextWorkers=new WeakSet<DB>();
export function imageMimeType(data:Buffer){
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(data.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii')))return 'image/gif';
 if(data.subarray(0,4).toString('ascii')==='RIFF'&&data.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
 throw new Error('主图文件不是受支持的 JPEG、PNG、GIF 或 WebP 图像');
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
   db.prepare('DELETE FROM figures WHERE paper_id=?').run(paperId);
   for(const f of parsed.figures){const id=createHash('sha256').update(paperId+':'+f.id).digest('hex').slice(0,32);db.prepare('INSERT INTO figures(id,paper_id,position,label,caption,context,alt,image_url,source_url) VALUES(?,?,?,?,?,?,?,?,?)').run(id,paperId,f.position,f.label,f.caption,f.context,f.alt,f.image_url,f.source_url);}
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
  const row:any=db.prepare(`SELECT f.* FROM figures f JOIN fulltexts t ON t.paper_id=f.paper_id JOIN papers p ON p.id=f.paper_id
    WHERE f.status='pending' AND (? OR f.image_path='') AND (t.automatic=0 OR (${readingScope(db)}))
    ORDER BY p.received_at DESC,p.published DESC,p.id DESC,f.position LIMIT 1`).get(Number(aiConfigured()));
  if(!row)break;
  db.prepare("UPDATE figures SET status='generating',error=NULL WHERE id=?").run(row.id);
  try{
   let data:Buffer,type:string;
   if(row.image_path){data=readFileSync(path.join(root,'data','figures',row.image_path));type=row.image_type;}
   else{const url=new URL(row.image_url);if(url.protocol!=='https:'||url.username||url.password||url.port||!['cdn.ncbi.nlm.nih.gov','pmc.ncbi.nlm.nih.gov','pmc-oa-opendata.s3.amazonaws.com'].includes(url.hostname))throw new Error('主图地址不属于 PMC 图像服务');
    const res=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:'error'});if(!res.ok)throw new Error(`主图获取失败（HTTP ${res.status}）`);
    data=Buffer.from(await res.arrayBuffer());if(data.length>20000000)throw new Error('单张图像超过 20MB，无法提交模型');
    type=imageMimeType(data);
    const md5=url.searchParams.get('md5');
    if(md5&&createHash('md5').update(data).digest('hex')!==md5)throw new Error('主图内容校验失败');
    mkdirSync(path.join(root,'data','figures'),{recursive:true});writeFileSync(path.join(root,'data','figures',row.id),data);db.prepare('UPDATE figures SET image_path=?,image_type=? WHERE id=?').run(row.id,type,row.id);
   }
   if(!aiConfigured()){
    db.prepare("UPDATE figures SET status='pending' WHERE id=?").run(row.id);
    continue;
   }
   const paper=getPaper(db,row.paper_id)!;const model=activeAI().figure_model;const analysis=await generateFigureAnalysis(row,paper,{data,type});
   db.prepare("UPDATE figures SET status='ready',analysis=?,error=NULL,model=?,generated_at=? WHERE id=?").run(JSON.stringify(analysis),model,new Date().toISOString(),row.id);
  }catch(e:any){db.prepare("UPDATE figures SET status='error',error=? WHERE id=?").run(e.message,row.id);}
 }}finally{figureWorkers.delete(db);}
}
