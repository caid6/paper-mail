import {z} from 'zod';
import {jsonCompletion} from './ai.ts';
import {findStoredPaper,type DB,type PaperInput} from './core.ts';
import {getPaper} from './library.ts';
import {DocumentError,type ParsedPdf} from './documents.ts';

const metadataSchema=z.object({
 title:z.string().trim().min(1).max(2000),
 authors:z.array(z.string().trim().min(1)).max(500),
 abstract:z.string().max(30000),
 journal:z.string().max(500),
 publication_date:z.string().regex(/^(?:|\d{4}|\d{4}-(?:0[1-9]|1[0-2])|\d{4}-\d{2}-\d{2})$/)
  .refine(value=>value.length!==10||z.iso.date().safeParse(value).success),
 doi:z.string().regex(/^(?:|10\.\d{4,9}\/[^\s]+)$/i),
 pmid:z.string().regex(/^(?:|[1-9]\d{0,11})$/),
});

const instruction=`从给出的论文 PDF 元数据及逐页文本中提取这篇论文自己的书目信息。元数据可能为空或包含文件生成器文字，必须以正文题名页、页眉及论文出版信息为依据。
title：完整原文题名，不翻译、不改写，保留原始标点；跨行标题可以用空格连接。
authors：论文作者原名，按原文顺序分开；不要把机构当作者。
abstract：原文作者摘要，保留原文文字和数字，不概括，不用正文开头替代；没有摘要则留空。
journal：刊名，无法确认则留空。
publication_date：论文正式发表或在线发表日期，只填写原文明示的年/月/日精度，格式 YYYY、YYYY-MM 或 YYYY-MM-DD；禁止用 PDF 创建日期、下载日期、收稿日期、参考文献日期或当前日期。无法确认则留空。
doi、pmid：只填写属于本篇论文的标识，原文没有则留空。不得提取参考文献、相关论文或研究背景中的标识，也不能从题名猜测。DOI 只含标识本身，不含链接前缀和句末标点。
不补写任何原文没有的信息。`;

const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const compact=(value:string)=>normalized(value).replace(/\s/g,'');

export async function paperFromUploadedPdf(parsed:ParsedPdf):Promise<PaperInput>{
 if(parsed.pages.every(page=>!page.text.trim()))throw new DocumentError('PDF 没有可提取的文字，暂不支持自动导入扫描件',422);
 const metadata=await jsonCompletion(metadataSchema,instruction,{pdf_metadata:parsed.metadata,pages:parsed.pages},{maxOutputTokens:16000});
 const identity=[parsed.metadata.title,parsed.metadata.subject,...parsed.pages.map(page=>page.text)].join('\n');
 if(!normalized(identity).includes(normalized(metadata.title)))throw new DocumentError('无法在 PDF 中核对完整题名，请重新上传包含题名页的论文',422);
 if(metadata.doi&&!compact(identity).includes(compact(metadata.doi)))throw new DocumentError('PDF 中未能核对本篇 DOI，请重新上传论文正文',422);
 if(metadata.pmid&&!new RegExp('\\bPMID\\s*:?\\s*'+metadata.pmid+'\\b','i').test(identity))throw new DocumentError('PDF 中未能核对本篇 PMID，请重新上传论文正文',422);
 if(metadata.abstract&&!normalized(identity).includes(normalized(metadata.abstract)))throw new DocumentError('提取的作者摘要无法与 PDF 原文核对，请重新上传',422);
 const doi=metadata.doi.toLowerCase();
 const url=doi?'https://doi.org/'+doi.split('/').map(encodeURIComponent).join('/'):
  metadata.pmid?'https://pubmed.ncbi.nlm.nih.gov/'+metadata.pmid+'/':'';
 return {
  id:metadata.pmid?'pmid:'+metadata.pmid:'pdf-'+parsed.sha256,
  source:'manual-pdf',title:metadata.title,abstract:metadata.abstract,authors:metadata.authors,
  journal:metadata.journal,publication_date:metadata.publication_date,published:metadata.publication_date,
  updated:new Date().toISOString(),categories:[],url,pdf_url:'',doi,full_text_url:url,
 };
}

export function uploadedPaperRecord(db:DB,paper:PaperInput,sha256:string):PaperInput{
 const duplicate=db.prepare('SELECT paper_id FROM pdf_documents WHERE sha256=? LIMIT 1').get(sha256);
 const existing=duplicate?getPaper(db,String(duplicate.paper_id)):findStoredPaper(db,paper);
 return existing?getPaper(db,String(existing.id))!:paper;
}
