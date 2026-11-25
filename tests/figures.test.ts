import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {upsertPaper} from '../server/core.ts';
import {connectTestLibrary as connect} from './helpers/library.ts';
import {figureState,indexPublisherFigures,parseNatureFigures,parsePMC} from '../server/figures.ts';
const html=`<html><head><meta name="citation_pmid" content="123"><link rel="canonical" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC123/"><meta name="citation_pdf_url" content="https://pmc.ncbi.nlm.nih.gov/articles/PMC123/pdf/paper.pdf"></head><body><article><section class="main-article-body"><p>The external validation is shown in <a href="#F1">Figure 1</a>.</p><figure id="F1"><h3 class="obj_head">Figure 1.</h3><img class="graphic" src="https://cdn.ncbi.nlm.nih.gov/pmc/figure.webp" alt="ROC curves"><figcaption>External cohort ROC curves.</figcaption></figure><figure id="F2"><h3 class="obj_head">Figure 2.</h3><img class="graphic" src="https://cdn.ncbi.nlm.nih.gov/pmc/figure2.webp"><figcaption>Study design.</figcaption></figure><section class="supplementary-material"><figure id="S1"><img class="graphic" src="supp.webp"></figure></section></section><a href="https://creativecommons.org/licenses/by/4.0/">CC BY</a></article></body></html>`;
test('提取全部正文主图，排除补充图，保留图注与正文引用段落',()=>{const r=parsePMC(html,'PMC123','123');assert.equal(r.figures.length,2);assert.equal(r.figures[0].label,'Figure 1.');assert.equal(r.figures[0].caption,'External cohort ROC curves.');assert.equal(r.figures[0].context,'The external validation is shown in Figure 1.');assert.equal(r.figures[1].context,'');assert.equal(r.pdf_url,'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/pdf/paper.pdf');assert.match(r.license,/CC BY/);});
test('Nature portfolio page matches DOI and resolves full-size numbered figures',()=>{
 const html='<html><head><meta name="citation_doi" content="10.1038/test-2026-1"><link rel="canonical" href="https://www.nature.com/articles/test-2026-1"></head><body><article><p>As shown in <a href="#Fig1">Fig. 1</a>, these findings agree.</p><figure><figcaption><b id="Fig1" data-test="figure-caption-text">Fig. 1: External validation performance.</b></figcaption><picture><source srcset="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig1.png?as=webp"><img src="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig1.png"></picture></figure><figure><figcaption><b id="FigS1" data-test="figure-caption-text">Supplementary Fig. 1: Ablation details.</b></figcaption></figure></article></body></html>';
 const result=parseNatureFigures(html,'10.1038/test-2026-1');
 assert.equal(result.figures.length,1);assert.equal(result.figures[0].label,'Figure 1');
 assert.match(result.figures[0].image_url,/media\.springernature\.com\/full\//);
 assert.match(result.figures[0].context,/findings agree/);
 assert.throws(()=>parseNatureFigures(html,'10.1038/another-paper'),/DOI/);
});
test('Nature publisher figure is DOI-verified, cached locally, and stored as a source figure',async()=>{
 const db=connect(':memory:'),root=mkdtempSync(path.join(tmpdir(),'paper-nature-figure-'));
 const previousFetch=globalThis.fetch;
 const paper={id:'pmid:777',doi:'10.1038/test-2026-1',title:'Clinical foundation models',abstract:'Study abstract',authors:[],categories:[],published:'2026-11-20',updated:'2026-11-20',url:'https://pubmed.ncbi.nlm.nih.gov/777/',pdf_url:'',source:'pubmed'};
 const html='<html><head><meta name="citation_doi" content="10.1038/test-2026-1"><link rel="canonical" href="https://www.nature.com/articles/test-2026-1"></head><body><article><p>The results appear in <a href="#Fig1">Fig. 1</a>.</p><figure><figcaption><b id="Fig1" data-test="figure-caption-text">Fig. 1: Validation results.</b></figcaption><img src="//media.springernature.com/m312/springer-static/image/art%3A10.1038%2Ftest%2FFig1.png"></figure></article></body></html>';
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAOElEQVR4nO3PsQkAAAzDsPz/dHpFliLwbFCaTBvvu94DAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAQcOkv4asq/aw0AAAAASUVORK5CYII=','base64');
 try{
  upsertPaper(db,paper,'topic-a');
  globalThis.fetch=async(url)=>{
   if(String(url)==='https://www.nature.com/articles/test-2026-1'){
    const response=new Response(html);Object.defineProperty(response,'url',{value:'https://www.nature.com/articles/test-2026-1'});return response;
   }
   if(String(url).includes('media.springernature.com/full/'))return new Response(png,{headers:{'content-type':'image/png'}});
   throw new Error('Unexpected URL '+url);
  };
  await indexPublisherFigures(db,root,paper.id);
  const state=figureState(db,paper.id);
  assert.equal(state.status,'ready');assert.equal(state.figures.length,1);
  assert.equal(state.figures[0].origin,'publisher');assert.equal(state.figures[0].caption,'Fig. 1: Validation results.');
  assert.match(state.figures[0].image_src,/\/api\/figures\//);
  const imagePath=String(db.prepare('select image_path from figures').get()!.image_path);
  assert.equal(readFileSync(path.join(root,'data','figures',imagePath)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 }finally{globalThis.fetch=previousFetch;db.close();rmSync(root,{recursive:true,force:true});}
});
test('全文标识必须匹配，访问限制页面不被当成全文',()=>{assert.throws(()=>parsePMC(html,'PMC124','123'),/PMCID/);assert.throws(()=>parsePMC(html,'PMC123','124'),/PMID/);assert.throws(()=>parsePMC('<html>Access denied</html>','PMC123','123'),/没有可访问的全文/);});
