import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {EnvHttpProxyAgent,fetch} from 'undici';
import {z} from 'zod';
import {findStoredPaper,upsertPaperRecord,type DB,type PaperInput} from './core.ts';
import {fetchPubmed} from './pubmed.ts';
import {mailboxJournalWhere} from './journals.ts';

const resultLimit=8;
export class InvalidLookupInput extends Error{}
const doiPattern=/^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/i;
const proxy=new EnvHttpProxyAgent();
const articleTypes=new Set(['journal-article','proceedings-article','posted-content']);
const crossrefWork=z.object({
 DOI:z.string().regex(doiPattern),
 title:z.array(z.string()).min(1),
 type:z.string(),
 abstract:z.string().optional(),
 author:z.array(z.object({given:z.string().optional(),family:z.string().optional(),name:z.string().optional()})).optional(),
 'container-title':z.array(z.string()).optional(),
 ISSN:z.array(z.string()).optional(),
 published:z.object({'date-parts':z.array(z.array(z.number().int()).min(1).max(3)).min(1)}).optional(),
 deposited:z.object({'date-time':z.iso.datetime({offset:true})}).optional(),
 link:z.array(z.object({URL:z.string(), 'content-type':z.string().optional()})).optional(),
});

export function parseLookup(input:string){
 const value=input.trim();
 const pmid=/^(?:PMID\s*:?\s*)?([1-9]\d{0,11})$/i.exec(value)?.[1];
 if(pmid)return {kind:'pmid' as const,value:pmid};
 const resolver=/^https?:\/\/(?:dx\.)?doi\.org\//i;
 const explicitDoi=resolver.test(value)||/^DOI\s*:/i.test(value)||/^10\.\d+\//.test(value);
 if(explicitDoi){
  const doi=value.replace(resolver,'').replace(/^DOI\s*:\s*/i,'');
  let decoded:string;
  try{decoded=resolver.test(value)?decodeURIComponent(doi):doi;}catch{throw new InvalidLookupInput('DOI 链接格式有误');}
  if(!doiPattern.test(decoded))throw new InvalidLookupInput('请输入完整的 DOI');
  return {kind:'doi' as const,value:decoded.toLowerCase()};
 }
 if(/^PMID\b/i.test(value))throw new InvalidLookupInput('PMID 应为一串数字');
 return {kind:'title' as const,value};
}

function cleanMarkup(value:string){
 const $=load(value,{},false);
 $('jats\\:title,script,style').remove();
 $('jats\\:p,p').append('\n\n');
 return $.root().text().replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();
}

export function crossrefPaper(record:unknown):PaperInput|null{
 const parsed=crossrefWork.safeParse(record);
 if(!parsed.success)return null;
 const work=parsed.data;
 if(!articleTypes.has(work.type))return null;
 const doi=work.DOI.toLowerCase();
 const title=cleanMarkup(work.title[0]).replace(/\s+/g,' ');
 if(!title)return null;
 const date=work.published?.['date-parts'][0].map((value,i)=>String(value).padStart(i===0?4:2,'0')).join('-')||'';
 const url='https://doi.org/'+doi.split('/').map(encodeURIComponent).join('/');
 return {
  id:'doi-'+createHash('sha256').update(doi).digest('hex'),
  source:'crossref',title,abstract:cleanMarkup(work.abstract||''),
  authors:(work.author||[]).map(a=>a.name||[a.given,a.family].filter(Boolean).join(' ')).filter(Boolean),
  journal:work['container-title']?.[0]||'',journal_issns:work.ISSN||[],
  publication_date:date,published:date,updated:work.deposited?.['date-time']||date,
  doi,categories:[],url,full_text_url:url,
  pdf_url:work.link?.find(link=>link['content-type']==='application/pdf'&&link.URL.startsWith('https://'))?.URL||'',
 };
}

async function crossref(path:string,params?:Record<string,string>):Promise<unknown>{
 const url=new URL('https://api.crossref.org/works'+path);
 url.search=new URLSearchParams(params).toString();
 const res=await fetch(url,{dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}}).catch(()=>{
  throw new Error('暂时连不上 Crossref，请稍后重试');
 });
 if(res.status===404)return null;
 if(!res.ok)throw new Error('Crossref 暂时无法检索，请稍后重试');
 const payload=z.object({message:z.unknown()}).parse(await res.json());
 return payload.message;
}

const normalizedTitle=(title:string)=>title.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim().replace(/\.$/,'');
export async function lookupPapers(input:string):Promise<PaperInput[]>{
 const {kind,value}=parseLookup(input);
 if(kind==='pmid'){
  return (await fetchPubmed(value+'[PMID]',1,[], '', '',true)).filter(p=>p.id==='pmid:'+value);
 }
 if(kind==='doi'){
  const valid=(await fetchPubmed('"'+value.replace(/["[\]]/g,' ')+'"[AID]',resultLimit,[], '', '',true))
   .filter(p=>p.doi?.toLowerCase()===value);
  if(valid.length)return valid;
  const record=crossrefPaper(await crossref('/'+encodeURIComponent(value)));
  return record?.doi===value?[record]:[];
 }
 const title=value.replace(/["[\]]/g,' ').replace(/\s+/g,' ').trim();
 if(!title)return [];
 const [indexed,registered]=await Promise.all([
  fetchPubmed('"'+title+'"[Title]',resultLimit,[], '', '',true),
  crossref('',{'query.title':title,rows:String(resultLimit)}),
 ]);
 const items=z.object({items:z.array(z.unknown())}).parse(registered).items;
 const found=[...indexed,...items.map(crossrefPaper).filter(p=>p!==null)];
 const unique=new Map<string,PaperInput>();
 for(const paper of found){
  const key=paper.doi?.toLowerCase()||paper.id;
  if(!unique.has(key))unique.set(key,paper);
 }
 const results=[...unique.values()];
 const exact=results.filter(p=>normalizedTitle(p.title)===normalizedTitle(value));
 return (exact.length?exact:results).slice(0,resultLimit);
}

function inInbox(db:DB,id:string){
 return Boolean(db.prepare("SELECT 1 FROM papers p WHERE p.id=? AND p.archived=0 AND p.in_library=1 AND "+mailboxJournalWhere(db)).get(id));
}

export function describeCandidate(db:DB,p:PaperInput){
 const local=findStoredPaper(db,p);
 return {
  identifier:p.id.startsWith('pmid:')?p.id.slice(5):p.doi!,
  title:p.title,authors:p.authors.slice(0,3),journal:p.journal||'',
  publication_date:p.publication_date||'',doi:p.doi||'',pmid:p.id.startsWith('pmid:')?p.id.slice(5):'',
  existing:local?{id:String(local.id),inInbox:inInbox(db,String(local.id))}:null,
 };
}

export function importPaper(db:DB,p:PaperInput,now=new Date().toISOString()){
 db.exec('BEGIN IMMEDIATE');
 try{
  const existing=findStoredPaper(db,p);
  const wasVisible=existing&&inInbox(db,String(existing.id));
  const {id}=upsertPaperRecord(db,p,now);
  const status=existing&&(existing.archived||!existing.in_library)?'restored':wasVisible?'existing':'added';
  db.prepare("UPDATE papers SET manual_added=1,in_library=1,archived=0,archive_origin=NULL,received_at=CASE WHEN ? THEN ? ELSE received_at END WHERE id=?").run(Number(status!=='existing'),now,id);
  db.exec('COMMIT');
  return {id,status};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
