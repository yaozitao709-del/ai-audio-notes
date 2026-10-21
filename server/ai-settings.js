import {protectPrivateFile} from './private-files.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAIClient, requestModelList } from './ai-client.js';

const invalid = message => Object.assign(new Error(message), {status:400});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const providers = new Set(['deepseek','openai-compatible']);
const validModel = model=>typeof model==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,127}$/.test(model);

function normalize(value, {allowEmptyKey=false,requireModel=true}={}) {
  if (!value || !providers.has(value.provider)) throw invalid('请选择 DeepSeek 或自定义兼容服务。');
  let url;
  try { url=new URL(String(value.baseUrl || '').trim()); } catch { throw invalid('请输入有效的 API 地址。'); }
  if ((url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw invalid('API 地址须使用 HTTPS（本机可用 HTTP），且不能包含账号、密钥参数或片段。');
  }
  const baseUrl=url.href.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  const model=String(value.model || '').trim();
  if (requireModel && !validModel(model)) throw invalid('请输入有效模型名，最多128个字符，不含空格。');
  const apiKey=String(value.apiKey || '').trim();
  if ((!apiKey&&!allowEmptyKey) || apiKey.length>4096 || /[\r\n\x00-\x1f\x7f]/.test(apiKey)) throw invalid('请输入有效 API 密钥。');
  return {provider:value.provider,baseUrl,model,apiKey};
}

export class AISettings {
  constructor({filename,defaults}) {
    this.filename=filename;this.defaults=defaults;this.saving=Promise.resolve();
  }

  async init() {
    let saved;
    try {await fs.access(this.filename);await protectPrivateFile(this.filename);saved=JSON.parse(await fs.readFile(this.filename,'utf8'));}
    catch(error) {if(error.code!=='ENOENT')throw new Error('本机 AI 配置文件读取失败，请检查配置文件。');}
    const values=normalize(saved || this.defaults,{allowEmptyKey:true});
    this.value=Object.freeze({...values,
      proofreadingModel:saved?values.model:(this.defaults.proofreadingModel || values.model),
      revision:saved?.revision || `env-${digest(values).slice(0,24)}`,
      updatedAt:saved?.updatedAt || null,source:saved?'file':'env'});
    return this.public();
  }

  snapshot() {return Object.freeze({...this.value});}

  public() {
    const {provider,baseUrl,model,revision,updatedAt}=this.value;
    return {provider,baseUrl,model,revision,updatedAt,hasApiKey:Boolean(this.value.apiKey)};
  }

  resolveDraft(draft,{requireModel=true}={}) {
    if(!draft || typeof draft!=='object' || Array.isArray(draft))throw invalid('AI 配置格式无效。');
    const current=this.snapshot();
    const entered=typeof draft.apiKey==='string'?draft.apiKey.trim():'';
    const candidate=normalize({...current,...draft,apiKey:entered || current.apiKey},{requireModel});
    if(!entered && (candidate.provider!==current.provider || candidate.baseUrl!==current.baseUrl))throw invalid('更换服务或 API 地址时，请重新输入对应的密钥。');
    return candidate;
  }

  save(draft) {
    const operation=this.saving.then(async()=>{
      const candidate=this.resolveDraft(draft);
      const current=this.snapshot();
      const unchanged=['provider','baseUrl','model','apiKey'].every(key=>candidate[key]===current[key]) && current.proofreadingModel===candidate.model;
      if(unchanged && current.source==='file')return this.public();
      const saved={schemaVersion:1,...candidate,revision:unchanged?current.revision:crypto.randomUUID(),updatedAt:new Date().toISOString()};
      await fs.mkdir(path.dirname(this.filename),{recursive:true,mode:0o700});
      const temp=`${this.filename}.${crypto.randomUUID()}.tmp`;
      try {
        const handle=await fs.open(temp,'wx',0o600);
        try{await protectPrivateFile(temp);await handle.writeFile(JSON.stringify(saved,null,2));}finally{await handle.close();}
        await fs.rename(temp,this.filename);
      } catch(error) {await fs.unlink(temp).catch(()=>{});throw new Error('AI 设置保存失败，原配置保持不变。');}
      this.value=Object.freeze({...saved,proofreadingModel:saved.model,source:'file'});
      return this.public();
    });
    this.saving=operation.catch(()=>{});
    return operation;
  }

  async test(draft) {
    const config=this.resolveDraft(draft);
    const request=createAIClient({...config,timeoutMs:20_000,attempts:1});
    const result=await request({model:config.model,maxTokens:256,messages:[
      {role:'system',content:'This is an API connection and JSON capability test. Return only the JSON object requested by the user.'},
      {role:'user',content:'Return exactly this JSON object: {"connection":"ok"}'}
    ]});
    if(result.payload?.connection!=='ok')throw invalid('连接已响应，但 JSON 结构测试未通过，请检查模型是否支持 JSON 输出。');
    return {ok:true,model:config.model,responseModel:result.responseModel,elapsedSeconds:result.elapsedSeconds};
  }

  async models(draft) {
    const config=this.resolveDraft(draft,{requireModel:false});
    const {records,elapsedSeconds}=await requestModelList(config);
    const seen=new Set(),models=[];
    for(const row of records){
      if(!validModel(row?.id) || seen.has(row.id))continue;
      seen.add(row.id);models.push({id:row.id,name:typeof row.name==='string'&&row.name.trim()?row.name.trim().slice(0,160):row.id});
      if(models.length>=2000)break;
    }
    if(!models.length)throw invalid('该服务未返回可用模型，可手动填写模型名。');
    return {models,elapsedSeconds};
  }
}
