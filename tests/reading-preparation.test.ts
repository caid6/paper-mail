import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect,setSetting,upsertPaper,type DB} from '../server/core.ts';
import {queueReadingPreparation,prepareReading,readingPreparationStats} from '../server/reading-preparation.ts';
import {documentState,pumpDocumentIndexes} from '../server/documents.ts';
import {figureState,indexPDFFigures,pumpPublisherFigures,pumpFigures,pumpFulltexts,imageMimeType} from '../server/figures.ts';
import {cloudURL,parsePMCXML,fetchPMC} from '../server/pmc.ts';
import {pumpDownloads} from '../server/downloads.ts';

const paper={id:'pmid:777',source:'pubmed',title:'Clinical foundation models',doi:'10.1234/testing',pmcid:'PMC777',abstract:'Study abstract',authors:[],categories:[],published:'2026-11-20',updated:'2026-11-20',url:'https://pubmed.ncbi.nlm.nih.gov/777/',pdf_url:''};
const figureXML=`<article><front><article-meta><article-id pub-id-type="pmid">777</article-id><article-id pub-id-type="pmcid">PMC777</article-id><article-id pub-id-type="pmcid-ver">PMC777.2</article-id><permissions>CC BY 4.0</permissions></article-meta></front><body><p>External validation in <xref ref-type="fig" rid="F1 F2">Figures 1 and 2</xref>.</p><fig id="F1"><label>Figure 1</label><caption><p>External validation results.</p></caption><graphic xlink:href="figure.webp"/></fig><supplementary-material><fig id="S1"/></supplementary-material></body></article>`;
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAOElEQVR4nO3PsQkAAAzDsPz/dHpFliLwbFCaTBvvu94DAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAQcOkv4asq/aw0AAAAASUVORK5CYII=','base64');
const md5=createHash('md5').update(image).digest('hex');
const imageURL='https://pmc-oa-opendata.s3.amazonaws.com/PMC777.2/figure.webp?md5='+md5;
const xmlURL='https://pmc-oa-opendata.s3.amazonaws.com/PMC777.2/PMC777.2.xml';
const pdfURL='https://pmc-oa-opendata.s3.amazonaws.com/PMC777.2/PMC777.2.pdf';
const manifest={pmcid:'PMC777',pmid:777,version:2,xml_url:xmlURL,pdf_url:pdfURL,media_urls:[imageURL]};
function fixture(){
 const db=connect(':memory:');setSetting(db,'min_impact_factor','10');setSetting(db,'quality_enabled','false');
 upsertPaper(db,paper,'medical-ai');db.prepare('UPDATE papers SET impact_factor=15').run();
 return db;
}
async function until(check:()=>boolean){
 const end=Date.now()+8000;
 while(!check()){if(Date.now()>end)assert.fail('后台任务未在测试时限内完成');await new Promise(resolve=>setTimeout(resolve,10));}
}
test('后台准备按邮箱、影响因子和质控状态派发，跨方向去重且保留终态',()=>{
 const db=fixture();const oldKey=process.env.AI_API_KEY;const oldModel=process.env.AI_MODEL;
 process.env.AI_API_KEY='test';process.env.AI_MODEL='test-text';
 try{
  for(const [id,fields] of [['778',{archived:1}],['779',{in_library:0}],['780',{impact_factor:9}],['781',{}]] as const){
   upsertPaper(db,{...paper,id:'pmid:'+id},'medical-ai');
   db.prepare('UPDATE papers SET impact_factor=15 WHERE id=?').run('pmid:'+id);
   for(const [key,value] of Object.entries(fields))db.prepare('UPDATE papers SET '+key+'=? WHERE id=?').run(value,'pmid:'+id);
  }
  upsertPaper(db,paper,'medical-foundation');
  db.prepare('UPDATE papers SET impact_factor=15 WHERE id=?').run(paper.id);
  setSetting(db,'quality_enabled','true');queueReadingPreparation(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM downloads').get()!.n,0);
  db.prepare("UPDATE relevance_reviews SET status='complete',verdict='relevant' WHERE paper_id=?").run(paper.id);
  queueReadingPreparation(db);queueReadingPreparation(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM downloads').get()!.n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fulltexts').get()!.n,1);
  db.prepare("UPDATE downloads SET status='needs_browser',error='requires access'").run();
  db.prepare("UPDATE fulltexts SET status='unavailable',error='not distributed'").run();
  setSetting(db,'quality_enabled','false');queueReadingPreparation(db);
  assert.deepEqual(db.prepare("SELECT status,error FROM downloads WHERE paper_id=?").get(paper.id),Object.assign(Object.create(null),{status:'needs_browser',error:'requires access'}));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM downloads').get()!.n,2);
  assert.equal(db.prepare('SELECT status FROM fulltexts WHERE paper_id=?').get(paper.id)!.status,'unavailable');
 }finally{
  db.close();
  if(oldKey===undefined)delete process.env.AI_API_KEY;else process.env.AI_API_KEY=oldKey;
  if(oldModel===undefined)delete process.env.AI_MODEL;else process.env.AI_MODEL=oldModel;
 }
});
test('Nature DOI 图表队列核对文章和图像并自动完成所选视觉模型的解读',async()=>{
 const db=fixture(),root=mkdtempSync(path.join(tmpdir(),'paper-nature-publisher-'));
 const originalFetch=globalThis.fetch;
 const envKeys=['AI_API_KEY','AI_PROVIDER','AI_BASE_URL','AI_MODEL','AI_FIGURE_MODEL'] as const;
 const originalEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{AI_API_KEY:'test',AI_PROVIDER:'compatible',AI_BASE_URL:'https://model.example/v1',AI_MODEL:'test-text',AI_FIGURE_MODEL:'test-vision'});
 upsertPaper(db,{...paper,id:'pmid:880',doi:'10.1038/test-2026-1',pmcid:'',journal:'Nature Medicine'},'medical-ai');
 db.prepare('UPDATE papers SET impact_factor=15 WHERE id=?').run('pmid:880');
 const html='<html><head><meta name="citation_doi" content="10.1038/test-2026-1"><link rel="canonical" href="https://www.nature.com/articles/test-2026-1"></head><body><article><p>The external validation results are shown in <a href="#Fig1">Fig. 1</a>.</p><figure><figcaption><b id="Fig1" data-test="figure-caption-text">Fig. 1: External validation results.</b></figcaption><img src="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig1.png"></figure></article></body></html>';
 const requests:string[]=[];
 try{
  globalThis.fetch=async(input,options)=>{
   const url=String(input);requests.push(url);
   if(url==='https://www.nature.com/articles/test-2026-1'){const response=new Response(html);Object.defineProperty(response,'url',{value:url});return response;}
   if(url.includes('media.springernature.com/full/'))return new Response(image,{headers:{'content-type':'image/png'}});
   if(url==='https://model.example/v1/chat/completions'){
    const body=JSON.parse(String(options?.body));assert.equal(body.model,'test-vision');assert.equal(body.messages[1].content[1].type,'image_url');
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title_zh:'外部验证图',overview:'模型与对照组的表现对比。',panels:[{label:'a',explanation:'外部验证结果'}],takeaway:'展示外部验证表现。',caveats:['图中结果不等同于临床获益。']})}}]});
   }
   throw new Error('Unexpected URL '+url);
  };
  void pumpPublisherFigures(db,root);
  await until(()=>figureState(db,'pmid:880').figures[0]?.status==='ready');
  const result=figureState(db,'pmid:880');
  assert.equal(result.figures[0].origin,'publisher');assert.equal(result.figures[0].analysis.title_zh,'外部验证图');
  assert.equal(result.figures[0].caption,'Fig. 1: External validation results.');
  assert.ok(requests.includes('https://www.nature.com/articles/test-2026-1'));
  assert.ok(requests.includes('https://model.example/v1/chat/completions'));
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of envKeys){const value=originalEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  db.close();rmSync(root,{recursive:true,force:true});
 }
});

test('出版社只开放部分主图时，用 PDF 按图注补齐缺失编号并完成解读',async()=>{
 const db=fixture(),root=mkdtempSync(path.join(tmpdir(),'paper-figure-source-merge-'));
 const originalFetch=globalThis.fetch;
 const envKeys=['AI_API_KEY','AI_PROVIDER','AI_BASE_URL','AI_MODEL','AI_FIGURE_MODEL'] as const;
 const originalEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
 const doi='10.1038/test-partial-2026',id='pmid:881';
 const html=`<html><head><meta name="citation_doi" content="${doi}"><link rel="canonical" href="https://www.nature.com/articles/test-partial-2026"></head><body><article>
  <figure><figcaption><b id="Fig1" data-test="figure-caption-text">Fig. 1: Study design.</b></figcaption><img src="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig1.png"></figure>
  <figure><figcaption><b id="Fig2" data-test="figure-caption-text">Fig. 2: Main results.</b></figcaption><img src="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig2.png"></figure>
 </article></body></html>`;
 Object.assign(process.env,{AI_API_KEY:'test',AI_PROVIDER:'compatible',AI_BASE_URL:'https://model.example/v1',AI_MODEL:'test-text',AI_FIGURE_MODEL:'test-vision'});
 try{
  upsertPaper(db,{...paper,id,doi,pmcid:''},'medical-ai');
  db.prepare('UPDATE papers SET impact_factor=15 WHERE id=?').run(id);
  mkdirSync(path.join(root,'scripts'));
  symlinkSync(path.resolve('scripts/extract_pdf_figures.py'),path.join(root,'scripts','extract_pdf_figures.py'));
  globalThis.fetch=async(input,options)=>{
   const url=String(input);
   if(url==='https://www.nature.com/articles/test-partial-2026'){
    const response=new Response(html);Object.defineProperty(response,'url',{value:url});return response;
   }
   if(url.includes('Fig1.png'))return new Response(image,{headers:{'content-type':'image/png'}});
   if(url.includes('Fig2.png'))return new Response('<html>not available</html>',{headers:{'content-type':'text/html'}});
   if(url==='https://model.example/v1/chat/completions'){
    const body=JSON.parse(String(options?.body));assert.equal(body.model,'test-vision');
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title_zh:'论文图',overview:'图像显示研究数据。',panels:[],takeaway:'呈现主要结果。',caveats:['不能仅凭图像判断临床获益。']})}}]});
   }
   throw new Error('Unexpected URL '+url);
  };
  await import('../server/figures.ts').then(module=>module.indexPublisherFigures(db,root,id));
  assert.equal(db.prepare('SELECT status FROM publisher_figure_indexes WHERE paper_id=?').get(id)!.status,'partial');
  mkdirSync(path.join(root,'data','downloads',id.replace('pmid:','')),{recursive:true});
  const pdf=path.join(root,'data','downloads',id.replace('pmid:',''),'paper.pdf');
  execFileSync('/opt/homebrew/bin/python3',['-c',`import fitz
d=fitz.open();p=d.new_page(width=600,height=800);p.draw_rect(fitz.Rect(60,80,540,360));p.insert_text((60,440),'Figure 1: Study design.',fontsize=12);p.draw_rect(fitz.Rect(60,490,540,650));p.insert_text((60,720),'Figure 2 - Main results.',fontsize=12);d.save(r'${pdf}');d.close()`]);
  await indexPDFFigures(db,root,id,pdf);
  assert.deepEqual((db.prepare('SELECT origin,label FROM figures WHERE paper_id=? ORDER BY position,label').all(id) as any[]).map(row=>[row.origin,row.label]),[['publisher','Figure 1'],['pdf','Figure 2']]);
  void pumpFigures(db,root);
  await until(()=>figureState(db,id).figures.length===2&&figureState(db,id).figures.every(figure=>figure.status==='ready'));
  assert.ok(figureState(db,id).figures.every(figure=>figure.analysis?.title_zh==='论文图'));
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of envKeys){const value=originalEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  db.close();rmSync(root,{recursive:true,force:true});
 }
});

test('官方 JATS 按主图文件清单精确匹配，验证身份且不混入补图',()=>{
 const result=parsePMCXML(figureXML,'PMC777','777',[imageURL]);
 assert.equal(result.figures.length,1);assert.equal(result.figures[0].image_url,imageURL);
 assert.match(result.figures[0].context,/External validation/);
 assert.throws(()=>parsePMCXML(figureXML,'PMC777','778',[imageURL]),/PMID/);
 assert.throws(()=>parsePMCXML(figureXML,'PMC778','777',[imageURL]),/PMCID/);
 assert.throws(()=>parsePMCXML(figureXML,'PMC777','777',[]),/未提供主图/);
 assert.throws(()=>parsePMCXML(figureXML,'PMC777','777',[imageURL,imageURL]),/歧义/);
 assert.equal(cloudURL('s3://pmc-oa-opendata/PMC777.2/figure.webp','PMC777.2'),imageURL.split('?')[0]);
 assert.throws(()=>cloudURL('https://example.com/PMC777.2/figure.webp','PMC777.2'),/不属于/);
 assert.throws(()=>cloudURL('s3://pmc-oa-opendata/PMC778.2/figure.webp','PMC777.2'),/不属于/);
});
test('无需打开页面，后台自动完成 PDF 下载、全部页解析、主图缓存与所选模型解读',async()=>{
 const db=fixture(),root=mkdtempSync(path.join(tmpdir(),'paper-preparation-'));
 const originalFetch=globalThis.fetch;
 const envKeys=['AI_API_KEY','AI_PROVIDER','AI_BASE_URL','AI_MODEL','AI_FIGURE_MODEL'] as const;
 const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{AI_API_KEY:'test',AI_PROVIDER:'compatible',AI_BASE_URL:'https://model.example/v1',AI_MODEL:'test-text',AI_FIGURE_MODEL:'test-vision'});
 let modelCalls=0;const requests:string[]=[];
 try{
  mkdirSync(path.join(root,'scripts'));
  for(const name of ['read_document.py','pdf_identity.py','extract_pdf_figures.py'])symlinkSync(path.resolve('scripts',name),path.join(root,'scripts',name));
  execFileSync('/opt/homebrew/bin/python3',['-c',`import fitz
from pathlib import Path
d=fitz.open();p=d.new_page(width=600,height=800);p.insert_text((70,70),'Clinical foundation models',fontsize=16);p.draw_rect(fitz.Rect(80,150,520,410),color=(0.1,0.2,0.8),width=3);p.insert_text((80,455),'Figure 1. Study design and external validation.',fontsize=12);d.set_metadata({'title':'Clinical foundation models'});d.save(str(Path(r'${root}')/'source.pdf'));d.close()`]);
  writeFileSync(path.join(root,'scripts','download_bridge.py'),`import json,sys,shutil
from pathlib import Path
r=json.loads(sys.stdin.read())
out=Path(r['output_dir']);shutil.copyfile(Path(__file__).parent.parent/'source.pdf',out/'article.pdf')
with (Path(__file__).parent.parent/'requests.txt').open('a') as f:f.write('download\\n')
print(json.dumps({'status':'ready','source':'test-source','file_name':'article.pdf'}))
`);
  globalThis.fetch=async(input,options)=>{
   const url=String(input);requests.push(url);
   if(url.includes('efetch.fcgi'))return new Response('<pmc-articleset>'+figureXML+'</pmc-articleset>');
   if(url.endsWith('.json'))return Response.json(manifest);
   if(url===xmlURL)return new Response(figureXML);
   if(url===imageURL)return new Response(image,{headers:{'content-type':'application/octet-stream'}});
   if(url==='https://model.example/v1/chat/completions'){
    const body=JSON.parse(String(options?.body));assert.equal(body.model,'test-vision');assert.equal(body.max_tokens,20000);
    assert.equal(body.messages[1].content[1].type,'image_url');
    assert.match(body.messages[1].content[0].text,/External validation/);
    modelCalls++;
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title_zh:'验证',overview:'图示说明',panels:[],takeaway:'关键结果',caveats:['测试']})}}]});
   }
   throw new Error('Unexpected URL '+url);
  };
  prepareReading(db,root);
  await until(()=>documentState(db,root,paper.id).document.status==='ready'&&figureState(db,paper.id).figures[0]?.status==='ready');
  assert.equal(documentState(db,root,paper.id).document.page_count,1);
  assert.equal(modelCalls,1);assert.equal(readingPreparationStats(db)!.pending,0);
  assert.equal(readFileSync(path.join(root,'requests.txt'),'utf8'),'download\n');
  const first=figureState(db,paper.id).figures[0];assert.ok(first.image_src);assert.equal(first.model,'test-vision');
  const requestCount=requests.length;
  prepareReading(db,root);
  await Promise.all([pumpDownloads(db,root),pumpDocumentIndexes(db,root),pumpFulltexts(db,root),pumpFigures(db,root)]);
  assert.equal(modelCalls,1);assert.equal(requests.length,requestCount);
  assert.equal(readFileSync(path.join(root,'requests.txt'),'utf8'),'download\n');
  globalThis.fetch=async input=>String(input).includes('efetch.fcgi')?new Response(figureXML):Response.json({...manifest,pmid:999});
  await assert.rejects(fetchPMC('PMC777','777'),/文件清单与文献身份/);
 }finally{
  globalThis.fetch=originalFetch;
  for(const key of envKeys){const value=originalEnv[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
  db.close();rmSync(root,{recursive:true,force:true});
 }
});
test('服务重启恢复未完成任务，保留下载失败与持久化解析错误',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'paper-preparation-resume-')),file=path.join(root,'state.sqlite');
 let db:DB=connect(file);
 try{
  upsertPaper(db,paper,'medical-ai');
  db.prepare("INSERT INTO downloads(paper_id,status,automatic,index_error,created_at) VALUES(?,'running',1,'parse error','now')").run(paper.id);
  db.prepare("INSERT INTO fulltexts(paper_id,status,automatic) VALUES(?,'loading',1)").run(paper.id);
  db.close();db=connect(file);
  assert.equal(db.prepare('SELECT status FROM downloads').get()!.status,'pending');
  assert.equal(db.prepare('SELECT status FROM fulltexts').get()!.status,'pending');
  assert.equal(db.prepare('SELECT index_error FROM downloads').get()!.index_error,'parse error');
  db.prepare("UPDATE downloads SET status='unavailable',error='no permission'").run();
  db.close();db=connect(file);
  assert.equal(db.prepare('SELECT status FROM downloads').get()!.status,'unavailable');
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
test('按文件格式识别云端图像，不依赖对象存储的通用 Content-Type',()=>{
 assert.equal(imageMimeType(image),'image/png');
 assert.equal(imageMimeType(Buffer.from('RIFF0000WEBP')),'image/webp');
 assert.throws(()=>imageMimeType(Buffer.from('<html>access denied</html>')),/不是受支持/);
});
