import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePubmed,pubmedDateClause,ncbi} from '../server/pubmed.ts';
const xml=`<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345678</PMID><DateRevised><Year>2026</Year><Month>11</Month><Day>18</Day></DateRevised><Article><Journal><Title>Medical AI Journal</Title><JournalIssue><PubDate><Year>2027</Year><Month>Jan</Month></PubDate></JournalIssue></Journal><ArticleTitle>A <i>clinical</i> foundation model</ArticleTitle><Abstract><AbstractText Label="METHODS">We tested <b>100</b> patients.</AbstractText><AbstractText Label="RESULTS">AUC was 0.90.</AbstractText></Abstract><AuthorList><Author><ForeName>Ada</ForeName><LastName>Li</LastName></Author><Author><CollectiveName>Clinical Study Group</CollectiveName></Author></AuthorList><PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList><ArticleDate DateType="Electronic"><Year>2026</Year><Month>11</Month><Day>12</Day></ArticleDate></Article></MedlineCitation><PubmedData><History><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>11</Month><Day>18</Day></PubMedPubDate></History><ArticleIdList><ArticleId IdType="doi">10.1234/abc</ArticleId><ArticleId IdType="pmc">PMC12345678</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
test('PubMed 保留混合标签顺序、结构摘要、期刊与正式标识符',()=>{const p=parsePubmed(xml)[0];assert.equal(p.id,'pmid:12345678');assert.equal(p.source,'pubmed');assert.equal(p.title,'A clinical foundation model');assert.equal(p.abstract,'METHODS\nWe tested 100 patients.\n\nRESULTS\nAUC was 0.90.');assert.deepEqual(p.authors,['Ada Li','Clinical Study Group']);assert.equal(p.journal,'Medical AI Journal');assert.equal(p.publication_date,'2026-11-12');assert.equal(p.indexed_at,'2026-11-18');assert.equal(p.full_text_url,'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345678/');assert.equal(p.doi,'10.1234/abc');});
test('没有 PMC 时提供出版社链接，不猜造 PDF 地址',()=>{const p=parsePubmed(xml.replace('<ArticleId IdType="pmc">PMC12345678</ArticleId>',''))[0];assert.equal(p.pdf_url,'');assert.equal(p.full_text_url,'https://doi.org/10.1234/abc');});
test('发表日期保留原始精度，不伪造日期；收录日期用于排序',()=>{const p=parsePubmed(xml.replace('<ArticleDate DateType="Electronic"><Year>2026</Year><Month>11</Month><Day>12</Day></ArticleDate>',''))[0];assert.equal(p.publication_date,'2027-01');assert.equal(p.published,'2026-11-18');});
test('PubMed 损坏数据与缺失标识符明确报错',()=>{assert.throws(()=>parsePubmed('<html>error</html>'));assert.throws(()=>parsePubmed(xml.replace('<PMID>12345678</PMID>','')));assert.deepEqual(parsePubmed('<PubmedArticleSet/>'),[]);});
test('历史补收日期范围使用明确的 PubMed 日期字段',()=>{assert.equal(pubmedDateClause('2026-10-19','2026-11-19','crdt'),'2026/10/19:2026/11/19[crdt]');assert.equal(pubmedDateClause('2026-10-19','2026-11-19','pdat'),'2026/10/19:2026/11/19[pdat]');assert.throws(()=>pubmedDateClause('2026-11-20','2026-11-19','crdt'),/日期范围无效/);});


test('NCBI 暂时性 DNS 错误可以重试，非暂时 HTTP 错误直接报告',async()=>{
 const original=globalThis.fetch;
 try{
  let calls=0;
  globalThis.fetch=async()=>{
   calls++;
   if(calls===1)throw new TypeError('fetch failed',{cause:{code:'EAI_AGAIN'}});
   return Response.json({count:2});
  };
  const response=await ncbi('esearch.fcgi',{db:'pubmed',term:'medicine'});
  assert.deepEqual(await response.json(),{count:2});
  assert.equal(calls,2);
  globalThis.fetch=async()=>{calls++;return new Response('{}',{status:400});};
  await assert.rejects(ncbi('esearch.fcgi',{db:'pubmed',term:'medicine'}),/HTTP 400/);
  assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
