import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {aiConfig,aiInputSchema,aiServiceSchema,resolveAI,listModels,textCompletion,jsonCompletion,translateTitle,testAI} from '../server/ai.ts';

test('OpenAI 兼容服务使用 JSON Object，应用端按 schema 校验完整结果',async()=>{
 const original=globalThis.fetch;
 const config={provider:'compatible' as const,base_url:'https://models.example/v1',key:'test',model:'text',figure_model:'vision'};
 try{
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://models.example/v1/chat/completions');
   const body=JSON.parse(String(options?.body));
   assert.deepEqual(body.response_format,{type:'json_object'});
   assert.match(body.messages[0].content,/符合以下 JSON Schema/);
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"title":"研究题目"}'}}]});
  };
  assert.deepEqual(await jsonCompletion(z.object({title:z.string().min(1)}),'中文提示',{title:'test'},{config}),{title:'研究题目'});
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"title":""}'}}]});
  await assert.rejects(jsonCompletion(z.object({title:z.string().min(1)}),'中文提示',{title:'test'},{config}),/结构不完整/);
 }finally{globalThis.fetch=original;}
});

test('单独翻译没有作者摘要的 PubMed 题名并保留医学缩写',async()=>{
 const original=globalThis.fetch;
 try{
  const config={provider:'compatible' as const,base_url:'https://models.example/v1',key:'test',model:'text',figure_model:'vision'};
  let body:any;
  globalThis.fetch=async(_url,options)=>{
   body=JSON.parse(String(options?.body));
   return Response.json({choices:[{finish_reason:'stop',message:{content:'{"title_zh":"用于 ECG 分析的医学基础模型"}'}}]});
  };
  assert.deepEqual(await translateTitle('A medical foundation model for ECG analysis',config),{title_zh:'用于 ECG 分析的医学基础模型'});
  assert.equal(body.max_tokens,1200);
  assert.equal(body.response_format.type,'json_object');
  assert.match(body.messages[1].content,/foundation model/i);
 }finally{globalThis.fetch=original;}
});

test('发布版没有预填模型，未完成本机配置时不向模型服务发请求',async()=>{
 const keys=['AI_PROVIDER','AI_BASE_URL','AI_MODEL','AI_FIGURE_MODEL','AI_API_KEY','GEMINI_API_KEY','GEMINI_MODEL'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const originalFetch=globalThis.fetch;
 try{
  for(const key of keys)delete process.env[key];
  assert.equal(aiConfig().configured,false);
  assert.equal(aiConfig().model,'');
  assert.equal(aiConfig().figure_model,'');
  process.env.AI_PROVIDER='compatible';
  process.env.AI_API_KEY='local-test-key';
  assert.equal(aiConfig().base_url,'');
  globalThis.fetch=async()=>assert.fail('Incomplete settings must not call a model service');
  await assert.rejects(textCompletion('阅读论文',[]),/配置服务地址、API Key 和模型/);
  Object.assign(process.env,{AI_BASE_URL:'https://models.example/v1',AI_MODEL:'selected-text',AI_FIGURE_MODEL:'selected-vision'});
  assert.deepEqual(aiConfig(),{
   provider:'compatible',base_url:'https://models.example/v1',model:'selected-text',figure_model:'selected-vision',configured:true,
  });
 }finally{
  globalThis.fetch=originalFetch;
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});

test('OpenAI compatible service root normalizes to v1 and requires credentials on provider change',()=>{
 const service=aiServiceSchema.parse({provider:'compatible',base_url:'https://models.example.com/',key:'secret'});
 const resolved=resolveAI({...service,model:'text-model',figure_model:'vision-model'});
 assert.equal(resolved.base_url,'https://models.example.com/v1');
 assert.equal(resolved.key,'secret');
 assert.throws(()=>resolveAI(aiInputSchema.parse({provider:'compatible',base_url:'https://different.example.com',model:'text',figure_model:'vision'})),/请填写/);
});

test('Gemini service root normalizes to v1beta',()=>{
 const service=aiServiceSchema.parse({provider:'gemini',base_url:'https://models.example.com',key:'secret'});
 const resolved=resolveAI({...service,model:'text-model',figure_model:'vision-model'});
 assert.equal(resolved.base_url,'https://models.example.com/v1beta');
});

test('model discovery rejects protocol-shape mismatch and empty catalogs',async()=>{
 const original=globalThis.fetch;
 try{
  const config={provider:'compatible' as const,base_url:'https://models.example.com/v1',key:'secret',model:'text',figure_model:'vision'};
  globalThis.fetch=async()=>new Response(JSON.stringify({models:[]}),{status:200});
  await assert.rejects(listModels(config),/格式不符合/);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[]}),{status:200});
  await assert.rejects(listModels(config),/没有返回可用模型/);
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{id:'vision'},{id:'text'},{id:'text'}]}),{status:200});
  assert.deepEqual(await listModels(config),['text','vision']);
 }finally{globalThis.fetch=original;}
});

test('Gemini 文本问答保持完整多轮消息，不附带输出 Schema，空回答明确报错',async()=>{
 const original=globalThis.fetch;
 try{
  const config={provider:'gemini' as const,base_url:'https://models.example/v1beta',key:'test',model:'selected',figure_model:'vision'};
  const messages=[{role:'user' as const,content:'Full PDF'},{role:'assistant' as const,content:'上一轮回答'},{role:'user' as const,content:'继续分析'}];
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://models.example/v1beta/models/selected:generateContent');
   const body=JSON.parse(String(options?.body));assert.deepEqual(body.contents,messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})));
   assert.equal(body.generationConfig.responseJsonSchema,undefined);
   return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:'直接分析的回答'}]}}]}));
  };
  assert.equal(await textCompletion('阅读论文',messages,config),'直接分析的回答');
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[]}}]}));
  await assert.rejects(textCompletion('阅读论文',messages,config),/有效回答/);
  globalThis.fetch=async()=>new Response('{}',{status:401});
  await assert.rejects(textCompletion('阅读论文',messages,config),/API Key/);
 }finally{globalThis.fetch=original;}
});


test('模型自检验证 JSON 与图像，区分失败阶段及额度错误',async()=>{
 const original=globalThis.fetch;
 const config={provider:'compatible' as const,base_url:'https://models.example/v1',key:'test',model:'text',figure_model:'vision'};
 try{
  const models:string[]=[];
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(String(options?.body));
   assert.equal(body.response_format.type,'json_object');
   models.push(body.model);
   if(body.model==='vision')assert.match(body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
   const content=body.model==='vision'?{left:'red',right:'blue'}:{status:'ok'};
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
  };
  assert.equal((await testAI(config)).image_input,true);
  assert.deepEqual(models,['text','vision']);
  globalThis.fetch=async(_url,options)=>JSON.parse(String(options?.body)).model==='vision'
   ? new Response('{}',{status:429})
   : Response.json({choices:[{finish_reason:'stop',message:{content:'{"status":"ok"}'}}]});
  await assert.rejects(testAI(config),/图文模型验证失败.*额度/);
 }finally{globalThis.fetch=original;}
});
