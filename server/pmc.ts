import {load} from 'cheerio';
import {XMLValidator} from 'fast-xml-parser';
import {z} from 'zod';
import {ncbi} from './pubmed.ts';

const bucket='https://pmc-oa-opendata.s3.amazonaws.com';
const manifestSchema=z.object({
 pmcid:z.string(),pmid:z.union([z.string(),z.number()]),version:z.number().int().positive(),
 xml_url:z.string(),pdf_url:z.string().nullable().optional(),media_urls:z.array(z.string()).optional(),
});
export class PMCUnavailable extends Error{}
export function cloudURL(value:string,version:string){
 const url=new URL(value);
 if(url.protocol==='s3:'&&url.hostname==='pmc-oa-opendata'){
  return cloudURL(bucket+url.pathname+url.search,version);
 }
 if(url.protocol!=='https:'||url.hostname!=='pmc-oa-opendata.s3.amazonaws.com'||url.username||url.password||url.port||!url.pathname.startsWith('/'+version+'/'))throw new Error('PMC 文件不属于本篇官方版本');
 return url.href;
}
function xmlLoad(xml:string){
 if(XMLValidator.validate(xml)!==true)throw new Error('PMC 返回的 XML 不完整');
 return load(xml,{xml:true});
}
function articleIdentity(xml:string,pmcid:string,pmid:string){
 const $=xmlLoad(xml);
 if($('article').length!==1)throw new Error('PMC 未返回唯一全文记录');
 const meta=$('article > front > article-meta');
 if(meta.find('article-id[pub-id-type="pmid"]').first().text().trim()!==pmid)throw new Error('PMC 全文 PMID 不一致');
 const pmc=meta.find('article-id[pub-id-type="pmcid"],article-id[pub-id-type="pmc"]').first().text().trim();
 if(pmc!==pmcid&&'PMC'+pmc!==pmcid)throw new Error('PMC 全文 PMCID 不一致');
 return $;
}
export function parsePMCXML(xml:string,pmcid:string,pmid:string,media:string[]){
 const $=articleIdentity(xml,pmcid,pmid),body=$('article > body');
 if(body.length!==1)throw new PMCUnavailable('PMC 未提供可解析的正文');
 const source_url='https://pmc.ncbi.nlm.nih.gov/articles/'+pmcid+'/';
 const files=new Map<string,string>();
 for(const value of media){
  const url=new URL(value);const file=decodeURIComponent(url.pathname.split('/').at(-1)||'');
  if(files.has(file))throw new Error('PMC 主图文件名存在歧义');
  files.set(file,value);
 }
 const figures:{id:string;label:string;caption:string;context:string;alt:string;image_url:string;source_url:string;position:number}[]=[];
 const seen=new Set<string>();
 body.find('fig').each((_i,element)=>{
  if($(element).parents('supplementary-material,app,app-group').length)return;
  const fig=$(element),id=fig.attr('id');
  if(!id||seen.has(id))throw new Error('PMC 主图标识缺失或重复');
  seen.add(id);
  const graphics=fig.children('graphic');
  if(graphics.length!==1)throw new Error('主图 '+id+' 不含唯一图像');
  const file=graphics.attr('xlink:href');
  const image_url=file&&files.get(file);
  if(!image_url)throw new PMCUnavailable('官方文件清单未提供主图 '+id+'，暂不能逐图解读');
  const refs:string[]=[];
  body.find('xref[ref-type="fig"]').each((_j,ref)=>{
   if(!($(ref).attr('rid')||'').split(/\s+/).includes(id))return;
   const p=$(ref).closest('p');
   if(p.length&&!p.closest('fig').length){const text=p.text().replace(/\s+/g,' ').trim();if(text&&!refs.includes(text))refs.push(text);}
  });
  figures.push({id,label:fig.children('label').text().trim()||id,caption:fig.children('caption').text().replace(/\s+/g,' ').trim(),context:refs.join('\n\n'),alt:fig.find('alt-text').text().trim(),image_url,source_url:source_url+'#'+encodeURIComponent(id),position:figures.length+1});
 });
 return {figures,source_url,license:$('article > front > article-meta > permissions').text().replace(/\s+/g,' ').trim()};
}
export async function fetchPMC(pmcid:string,pmid:string){
 if(!/^PMC\d+$/.test(pmcid)||!/^\d+$/.test(pmid))throw new Error('PMC 文献标识无效');
 const xml=await (await ncbi('efetch.fcgi',{db:'pmc',id:pmcid.slice(3)})).text();
 const $=articleIdentity(xml,pmcid,pmid);
 const version=$('article > front > article-meta > article-id[pub-id-type="pmcid-ver"]').text().trim();
 if(!new RegExp('^'+pmcid+'\\.\\d+$').test(version))throw new Error('PMC 未给出明确版本号');
 const metadata=await fetch(bucket+'/'+version+'/'+version+'.json',{signal:AbortSignal.timeout(45000),redirect:'error'});
 if([403,404,451].includes(metadata.status))throw new PMCUnavailable('PMC 云端暂未提供可自动获取的全文文件');
 if(!metadata.ok)throw new Error('PMC 文件清单请求失败（HTTP '+metadata.status+'）');
 const manifest=manifestSchema.parse(await metadata.json());
 if(manifest.pmcid!==pmcid||String(manifest.pmid)!==pmid||version!==pmcid+'.'+manifest.version)throw new Error('PMC 文件清单与文献身份不一致');
 const fulltext=await fetch(cloudURL(manifest.xml_url,version),{signal:AbortSignal.timeout(45000),redirect:'error'});
 if(!fulltext.ok)throw new Error('PMC 正文请求失败（HTTP '+fulltext.status+'）');
 const parsed=parsePMCXML(await fulltext.text(),pmcid,pmid,(manifest.media_urls||[]).map(value=>cloudURL(value,version)));
 return {...parsed,pdf_url:manifest.pdf_url?cloudURL(manifest.pdf_url,version):''};
}
