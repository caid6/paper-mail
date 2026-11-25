import 'dotenv/config';
import Database from 'node:sqlite';
import fs from 'node:fs/promises';
const db=new Database.DatabaseSync('data/papers.sqlite');
const rows=db.prepare(`select p.id,p.title,p.abstract,s.id as topic_id,s.name as topic_name,s.description,s.query
 from papers p join paper_subscriptions ps on ps.paper_id=p.id join subscriptions s on s.id=ps.subscription_id
 where p.source='pubmed' and p.impact_factor>=10 order by p.id,s.id`).all();
db.close();
const groups=[];for(let i=0;i<rows.length;i+=2)groups.push(rows.slice(i,i+2));
const schema={type:'object',additionalProperties:false,properties:{reviews:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},topic_id:{type:'string'},verdict:{type:'string',enum:['relevant','borderline','irrelevant']},reason:{type:'string'},evidence:{type:'string'}},required:['id','topic_id','verdict','reason','evidence']}}},required:['reviews']};
const instruction='你是医学人工智能文献质控员。判断每篇论文是否真正属于给定研究方向，而不是仅在背景、讨论、展望、致谢或参考文献中顺带提及相关词。relevant：该方向是论文的核心研究对象、方法、系统或主要综述主题；borderline：相关技术只占重要的一部分，或摘要不足以确认核心性；irrelevant：研究核心明显是普通医学、药物、生物学或其他主题，方向词只是偶然出现。只依据标题和作者摘要，不推测全文。reason 用中文说明判断依据；evidence 摘录标题或摘要中的关键短语，不能编造。';
const base=(process.env.AI_BASE_URL||'').replace(/\/+$/,'');const model=process.env.AI_MODEL;const key=process.env.AI_API_KEY;
async function classify(batch,attempt=0){
 const input=batch.map(r=>({id:r.id,topic_id:r.topic_id,topic_name:r.topic_name,topic_description:r.description||'',title:r.title,abstract:(r.abstract||'').slice(0,7000)}));
 const body={model,messages:[{role:'system',content:instruction+' 只返回符合 JSON Schema 的对象。'+JSON.stringify(schema)},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_schema',json_schema:{name:'quality_reviews',strict:true,schema}},temperature:0.1,max_tokens:5500};
 try{const res=await fetch(base+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});const raw=await res.text();if(!res.ok){if(res.status===400&&/response_format.*unavailable/i.test(raw)){throw new Error('temporary response format unavailable');}if(res.status===400&&batch.length>1){const middle=Math.ceil(batch.length/2);return [...await classify(batch.slice(0,middle)),...await classify(batch.slice(middle))];}throw new Error('HTTP '+res.status+' '+raw.slice(0,300));}const j=JSON.parse(raw);const content=j.choices?.[0]?.message?.content;if(!content)throw new Error('empty response');const parsed=JSON.parse(content);if(!Array.isArray(parsed.reviews))throw new Error('invalid reviews');const expected=new Set(batch.map(r=>r.id+'|'+r.topic_id));const actual=parsed.reviews.map(r=>String(r.id)+'|'+String(r.topic_id));if(parsed.reviews.length!==batch.length||new Set(actual).size!==batch.length||actual.some(k=>!expected.has(k))){if(batch.length>1){const middle=Math.ceil(batch.length/2);return [...await classify(batch.slice(0,middle)),...await classify(batch.slice(middle))];}throw new Error('model returned mismatched paper ids');}return parsed.reviews;}catch(e){if(attempt<4){await new Promise(r=>setTimeout(r,3000*(attempt+1)));return classify(batch,attempt+1);}throw e;}
}
const out=[];let done=0;let next=0;const workers=Array.from({length:2},async()=>{while(true){const i=next++;if(i>=groups.length)return;const result=await classify(groups[i]);out.push(...result);done++;if(done%5===0)console.error('completed',done,'/',groups.length);}});await Promise.all(workers);await fs.writeFile('/tmp/paper_quality_audit.json',JSON.stringify({generated_at:new Date().toISOString(),model,rows:out},null,2));const counts={};for(const r of out)counts[r.verdict]=(counts[r.verdict]||0)+1;
if(process.argv.includes('--apply')){
 const applyDb=new Database.DatabaseSync('data/papers.sqlite');const now=new Date().toISOString();applyDb.exec('BEGIN IMMEDIATE');try{
  const save=applyDb.prepare("INSERT INTO relevance_reviews(paper_id,subscription_id,status,verdict,reason,evidence,model,reviewed_at,error) VALUES(?,?, 'complete',?,?,?,?,?,NULL) ON CONFLICT(paper_id,subscription_id) DO UPDATE SET status='complete',verdict=excluded.verdict,reason=excluded.reason,evidence=excluded.evidence,model=excluded.model,reviewed_at=excluded.reviewed_at,error=NULL");
  const remove=applyDb.prepare('DELETE FROM paper_subscriptions WHERE paper_id=? AND subscription_id=?');const affected=new Set();
  for(const review of out){save.run(review.id,review.topic_id,review.verdict,review.reason,review.evidence,model,now);if(review.verdict==='irrelevant'){remove.run(review.id,review.topic_id);affected.add(review.id);}}
  const archive=applyDb.prepare(`UPDATE papers SET archived=1, archive_origin='quality' WHERE id=?
    AND archive_origin IS NOT 'manual'
    AND NOT EXISTS (SELECT 1 FROM paper_subscriptions WHERE paper_id=papers.id)`);
  for(const id of affected)archive.run(id);
  applyDb.exec('COMMIT');
 }catch(e){applyDb.exec('ROLLBACK');throw e;}finally{applyDb.close();}
}
console.log(JSON.stringify({input:rows.length,output:out.length,counts,groups:groups.length,applied:process.argv.includes('--apply')}));
