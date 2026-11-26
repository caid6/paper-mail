import { DOMParser, type Element } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import { EnvHttpProxyAgent } from 'undici';
import { setTimeout as delay } from 'node:timers/promises';
import type {PaperInput} from './core.ts';
import {eligibleJournalIssns} from './journals.ts';
import type {ImpactOperator} from '../shared/impact.ts';
const elements=(el:Element|undefined,name:string):Element[]=>el?Array.from(el.childNodes).filter((x):x is Element=>x.nodeType===1&&(x as Element).tagName===name):[];
const one=(el:Element|undefined,name:string)=>elements(el,name)[0];
const text=(el:Element|undefined)=>(el?.textContent||'').replace(/\s+/g,' ').trim();
function structuredDate(el:Element|undefined):string{
 if(!el)return '';
 const y=text(one(el,'Year')),rawMonth=text(one(el,'Month')),d=text(one(el,'Day'));
 const months:Record<string,string>={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
 const m=rawMonth?(months[rawMonth]||rawMonth.padStart(2,'0')):'';
 return y?[y,m,d?d.padStart(2,'0'):''].filter(Boolean).join('-'):text(one(el,'MedlineDate'));
}
export function parsePubmed(xml:string):PaperInput[]{
 if(XMLValidator.validate(xml)!==true)throw new Error('PubMed 返回的 XML 格式无效');
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 const root=doc.documentElement;
 if(!root||root.tagName!=='PubmedArticleSet')throw new Error('PubMed 返回的内容不是论文记录集');
 return elements(root,'PubmedArticle').map(record=>{
  const citation=one(record,'MedlineCitation'),article=one(citation,'Article'),metadata=one(record,'PubmedData');
  const pmid=text(one(citation,'PMID')),title=text(one(article,'ArticleTitle'));
  if(!/^\d+$/.test(pmid)||!title)throw new Error('PubMed 记录缺少 PMID 或标题');
  const idList=elements(one(metadata,'ArticleIdList'),'ArticleId');
  const identifier=(type:string)=>text(idList.find(x=>x.getAttribute('IdType')===type));
  const doi=identifier('doi'),pmcid=identifier('pmc');
  const journal=one(article,'Journal');
  const journalTitle=text(one(journal,'Title'));
  const published=structuredDate(elements(article,'ArticleDate').find(x=>x.getAttribute('DateType')==='Electronic'))||structuredDate(one(one(journal,'JournalIssue'),'PubDate'));
  const pubmedDate=elements(one(metadata,'History'),'PubMedPubDate').find(x=>x.getAttribute('PubStatus')==='pubmed');
  const indexed=structuredDate(pubmedDate);
  if(!indexed)throw new Error(`PMID ${pmid} 缺少 PubMed 收录日期`);
  const abstract=elements(one(article,'Abstract'),'AbstractText').map(x=>{const label=x.getAttribute('Label');return (label?label+'\n':'')+text(x);}).join('\n\n');
  const authors=elements(one(article,'AuthorList'),'Author').map(a=>text(one(a,'CollectiveName'))||[text(one(a,'ForeName')),text(one(a,'LastName'))].filter(Boolean).join(' ')).filter(Boolean);
  const revised=structuredDate(one(citation,'DateRevised'));
  const types=elements(one(article,'PublicationTypeList'),'PublicationType').map(text);
  const fullText=pmcid?`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`:doi?`https://doi.org/${doi}`:'';
  return {id:'pmid:'+pmid,source:'pubmed',title,abstract,authors,published:indexed,updated:revised||indexed,categories:types,journal:journalTitle,journal_issns:[...new Set([...elements(journal,'ISSN').map(text),text(one(one(citation,'MedlineJournalInfo'),'ISSNLinking'))].filter(Boolean))],publication_date:published,indexed_at:indexed,doi,pmcid,pub_types:types,url:`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,pdf_url:'',full_text_url:fullText};
 });
}
let lastRequest=0;
let ncbiSlots=Promise.resolve();
const ncbiConnection=new EnvHttpProxyAgent({connectTimeout:40000,autoSelectFamily:true});
const retryableStatus=new Set([429,500,502,503,504]);
const retryableNetwork=new Set(['EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','ECONNREFUSED','ECONNRESET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','TimeoutError']);
async function ncbiSlot(){
 const slot=ncbiSlots.then(async()=>{await delay(Math.max(0,400-(Date.now()-lastRequest)));lastRequest=Date.now();});
 ncbiSlots=slot.catch(()=>{});
 await slot;
}
export async function ncbi(endpoint:string,params:Record<string,string>){
 const url=new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'+endpoint);
 const encoded=new URLSearchParams({...params,tool:'PaperMorning'}).toString();
 const options:RequestInit & {dispatcher:typeof ncbiConnection}={dispatcher:ncbiConnection,headers:{'User-Agent':'PaperMorning/2.0 (local personal PubMed reader)'}};
 if(endpoint==='esearch.fcgi'){options.method='POST';options.body=encoded;options.headers={...options.headers,'Content-Type':'application/x-www-form-urlencoded'};}else url.search=encoded;
 for(let attempt=0;;attempt++){
  await ncbiSlot();
  let response:Response;
  try{response=await fetch(url,{...options,signal:AbortSignal.timeout(55000)});}
  catch(error){
   const failure=error as Error & {cause?:{code?:string}};
   const code=failure.cause?.code||failure.name;
   if(attempt===0&&retryableNetwork.has(code)){await delay(750);continue;}
   const hint=code==='EAI_AGAIN'||code==='ENOTFOUND'?'DNS 无法解析 NCBI 域名':
    code==='UND_ERR_CONNECT_TIMEOUT'||code==='ETIMEDOUT'||code==='TimeoutError'?'连接或等待 NCBI 响应超时，请检查网络和代理':
    '访问 NCBI 出现网络错误，请检查网络和代理';
   throw new Error(`PubMed：${hint}（${code}）`);
  }
  if(response.ok)return response;
  await response.body?.cancel();
  if(attempt===0&&retryableStatus.has(response.status)){
   const after=response.headers.get('retry-after');
   const wait=after===null?750:/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-Date.now();
   if(Number.isFinite(wait)&&wait<=15000){await delay(Math.max(750,wait));continue;}
  }
  throw new Error(`PubMed 请求失败（HTTP ${response.status}）${response.status===429?'，NCBI 请求过多，请稍后重试':''}`);
 }
}
export async function fetchPubmedRecords(ids:string[]){return parsePubmed(await (await ncbi('efetch.fcgi',{db:'pubmed',id:ids.join(','),retmode:'xml'})).text());}
export function validateSearchErrors(data:any,allowedMissingJournalIssns:string[]=[]){
 if(data.error)throw new Error('PubMed 检索失败');
 const errors=data.esearchresult?.errorlist||{};
 const outputMessages=(data.esearchresult?.warninglist?.outputmessages||[]).map(String);
 if(outputMessages.some((message:string)=>/wrong subquery/i.test(message)))throw new Error('PubMed 历史检索集合无效，请重试');
 if((errors.fieldsnotfound||[]).length||(errors.phrasesnotfound||[]).some((term:string)=>!allowedMissingJournalIssns.includes(term)))throw new Error('PubMed 未识别检索词或字段，请检查研究方向');
 for(const [name,value] of Object.entries(errors))if(!['fieldsnotfound','phrasesnotfound'].includes(name)&&Array.isArray(value)&&value.length)throw new Error('PubMed 检索返回错误：'+name);
}
export function pubmedDateClause(start:string,end:string,field:'crdt'|'pdat'|'edat'='crdt'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error('PubMed 日期范围无效');
 return `${start.replaceAll('-','/')}:${end.replaceAll('-','/')}[${field}]`;
}
export async function fetchPubmed(query:string,count:number,allowedMissingJournalIssns:string[]=[],webEnv='',dateClause='',allowEmptyLookup=false){
 const term=dateClause?`(${query}) AND (${dateClause})`:query;
 // NCBI 只有在同一 WebEnv 的后续检索显式携带 usehistory=y 时，才会解析
 // `#1`、`#2` 这类历史检索集合引用。缺少该参数时，PubMed 会返回
 // “Wrong subquery”，表现为影响因子筛选结果为 0。
 const response:any=await (await ncbi('esearch.fcgi',{db:'pubmed',term,retmode:'json',retmax:String(count),sort:'most recent',...(webEnv?{WebEnv:webEnv,usehistory:'y'}:{})})).json();
 const result=response.esearchresult;
 const unrecognized=allowEmptyLookup&&result?.count==='0'&&Array.isArray(result?.errorlist?.phrasesnotfound)
  ?result.errorlist.phrasesnotfound:[];
 validateSearchErrors(response,[...allowedMissingJournalIssns,...unrecognized]);
 const ids=result?.idlist;
 if(!Array.isArray(ids)||!/^\d+$/.test(String(result?.count))||ids.length!==Math.min(count,Number(result.count))||new Set(ids).size!==ids.length||!ids.every(id=>/^\d+$/.test(id)))throw new Error('PubMed 没有返回完整有效的检索结果');
 const papers:PaperInput[]=[];
 for(let start=0;start<ids.length;start+=100){
  const batch=ids.slice(start,start+100);
  const records=await fetchPubmedRecords(batch);
  const byId=new Map(records.map(p=>[p.id,p]));
  if(records.length!==batch.length||!batch.every(id=>byId.has('pmid:'+id)))throw new Error('PubMed 返回的记录与检索结果不一致，本次更新未完成');
  papers.push(...batch.map(id=>byId.get('pmid:'+id)!));
 }
 return papers;
}
export async function previewPubmed(query:string){
 const response:any=await (await ncbi('esearch.fcgi',{db:'pubmed',term:query,retmode:'json',retmax:'0'})).json();
 if(response.error||!response.esearchresult)throw new Error('PubMed 检索验证失败');
 const r=response.esearchresult;
 const issues=[...Object.values(r.errorlist||{}),...Object.values(r.warninglist||{})].flat().map(String);
 return {count:Number(r.count),translation:r.querytranslation||query,warnings:issues};
}
export async function matchPubmedIds(query:string,ids:string[]){
 const matched:string[]=[];
 for(let start=0;start<ids.length;start+=100){
  const batch=ids.slice(start,start+100);const pmids=batch.map(id=>id.replace(/^pmid:/,''));
  const exact='('+query+') AND ('+pmids.map(id=>id+'[PMID]').join(' OR ')+')';
  const data:any=await (await ncbi('esearch.fcgi',{db:'pubmed',term:exact,retmode:'json',retmax:'100'})).json();
  if(data.error||!Array.isArray(data.esearchresult?.idlist))throw new Error('PubMed 标签核对失败，研究方向未保存');
  if(data.esearchresult.errorlist)throw new Error('PubMed 检索式无效，研究方向未保存');
  for(const id of data.esearchresult.idlist)matched.push('pmid:'+id);
 }
 return matched;
}

export async function fetchPubmedMetadata(ids:string[]){
 const result:PaperInput[]=[];
 for(let offset=0;offset<ids.length;offset+=100){const batch=ids.slice(offset,offset+100);const xml=await (await ncbi('efetch.fcgi',{db:'pubmed',id:batch.map(id=>id.replace('pmid:','')).join(','),retmode:'xml'})).text();result.push(...parsePubmed(xml));}
 return result;
}
export async function prepareJournalSearch(min:number|null,selected:string[]=[],operator:ImpactOperator='gte'){
 if(min===null&&!selected.length)return {webEnv:'',restriction:'',empty:false};
 const ids=eligibleJournalIssns(min,selected,operator);
 if(!ids.length)return {webEnv:'',restriction:'',empty:true};
 let webEnv='';const keys:string[]=[];const missingJournalIssns:string[]=[];
 // NCBI History combines exact journal sets without sending an unbounded query.
 for(let start=0;start<ids.length;start+=400){
  const batch=ids.slice(start,start+400);
  const data:any=await (await ncbi('esearch.fcgi',{db:'pubmed',term:batch.map(id=>id+'[Journal]').join(' OR '),retmode:'json',retmax:'0',usehistory:'y',...(webEnv?{WebEnv:webEnv}:{})})).json();
  validateSearchErrors(data,batch);const r=data.esearchresult;
  for(const id of (r.errorlist?.phrasesnotfound||[]))if(!missingJournalIssns.includes(String(id)))missingJournalIssns.push(String(id));
  if(!r?.webenv||!/^\d+$/.test(String(r.querykey)))throw new Error('PubMed 未建立有效的期刊检索集合');
  webEnv=r.webenv;keys.push('#'+r.querykey);
 }
 return {webEnv,restriction:'('+keys.join(' OR ')+')',allowedMissingJournalIssns:missingJournalIssns};
}
