import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

async function setup(t, overrides={}) {
  const {AISettings}=await import('./ai-settings.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof AISettings,'function','AI settings store must be implemented');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-settings-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'config','ai-settings.json');
  const defaults={provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'fixture-secret',...overrides};
  const store=new AISettings({filename,defaults});await store.init();
  return {store,filename,defaults,AISettings};
}

test('settings persist privately, reload without exposing keys and keep blank key on same endpoint',async t=>{
  const {store,filename,defaults,AISettings}=await setup(t);
  assert.equal(store.public().hasApiKey,true);assert.equal(store.public().apiKey,undefined);
  assert.ok(!JSON.stringify(store.public()).includes('fixture-secret'));
  const original=store.snapshot();
  await store.save({...store.public(),apiKey:''});
  assert.equal(JSON.parse(await fs.readFile(filename,'utf8')).model,'deepseek-flash','explicit first save persists legacy env settings');
  const saved=await store.save({provider:'deepseek',baseUrl:'https://api.deepseek.com/',model:'another-model',apiKey:''});
  assert.equal(saved.model,'another-model');assert.equal(store.snapshot().apiKey,'fixture-secret');
  assert.equal(original.model,'deepseek-flash');assert.notEqual(saved.revision,original.revision);
  assert.equal((await fs.stat(filename)).mode&0o777,0o600);
  const other=new AISettings({filename,defaults});await other.init();
  assert.equal(other.public().model,'another-model');assert.equal(other.snapshot().apiKey,'fixture-secret');
  assert.equal(other.public().revision,saved.revision);
  await store.save({provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'another-model',apiKey:''});
  assert.equal(store.public().revision,saved.revision,'unchanged save does not invalidate cache');
});

test('invalid settings never overwrite valid config and endpoint changes require a new key',async t=>{
  const {store}=await setup(t);const before=store.snapshot();
  for(const patch of [
    {baseUrl:'javascript:alert(1)'},{baseUrl:'http://example.com'},
    {baseUrl:'https://name:password@example.com/v1'},{baseUrl:'https://example.com/v1?key=hidden'},
    {model:'bad\nmodel'},{model:''},{provider:'unknown'},
    {baseUrl:'https://different.example/v1',apiKey:''},
    {provider:'openai-compatible',apiKey:''}
  ]) {
    await assert.rejects(store.save({...store.public(),apiKey:'',...patch}));
    assert.deepEqual(store.snapshot(),before);
  }
  await store.save({provider:'openai-compatible',baseUrl:'https://different.example/v1/chat/completions',model:'vendor/model:free',apiKey:'new-secret'});
  assert.equal(store.public().baseUrl,'https://different.example/v1');
  assert.equal(store.snapshot().apiKey,'new-secret');
});

test('connection test validates actual JSON capability without saving its draft',async t=>{
  let mode='ok',requestBody;
  const server=http.createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;requestBody=JSON.parse(data);
    if(mode==='denied'){res.writeHead(401);return res.end('provider echoes secret-do-not-return');}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({model:'fixture-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(mode==='ok'?{connection:'ok'}:{})}}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const {store}=await setup(t);const before=store.snapshot();
  const draft={provider:'openai-compatible',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-model',apiKey:'draft-secret'};
  const result=await store.test(draft);
  assert.equal(result.ok,true);assert.ok(result.elapsedSeconds>=0);
  assert.equal(requestBody.thinking,undefined);assert.deepEqual(requestBody.response_format,{type:'json_object'});
  assert.deepEqual(store.snapshot(),before);
  mode='invalid';await assert.rejects(store.test(draft),/JSON|结构|测试/);
  mode='denied';await assert.rejects(store.test(draft),e=>/401|密钥/.test(e.message)&&!e.message.includes('secret-do-not-return'));
  assert.deepEqual(store.snapshot(),before);
});

test('missing credentials are represented as unconfigured until explicitly saved',async t=>{
  const {store}=await setup(t,{apiKey:''});
  assert.equal(store.public().hasApiKey,false);
  await assert.rejects(store.save({...store.public(),apiKey:''}),/密钥/);
  await assert.rejects(store.test({...store.public(),apiKey:''}),/密钥/);
});

test('model discovery uses draft credentials without a model name or saving, and rejects unsafe responses',async t=>{
  let mode='ok',authorization,requestedPath;
  const server=http.createServer((req,res)=>{
    authorization=req.headers.authorization;requestedPath=req.url;
    if(mode==='denied'){res.writeHead(401);return res.end('fixture-secret');}
    if(mode==='malformed')return res.end('fixture-secret is not JSON');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(mode==='ok'?{data:[{id:'model-z',name:'Model Z'},{id:'model-a'},{id:'model-z'},{id:'bad\nmodel'},{id:42}]}:{data:[]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const {store}=await setup(t);const before=store.snapshot();
  assert.equal(typeof store.models,'function');
  const draft={provider:'openai-compatible',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'',apiKey:'discovery-secret'};
  const result=await store.models(draft);
  assert.equal(authorization,'Bearer discovery-secret');assert.equal(requestedPath,'/v1/models');
  assert.deepEqual(result.models,[{id:'model-z',name:'Model Z'},{id:'model-a',name:'model-a'}]);
  assert.deepEqual(store.snapshot(),before);
  mode='empty';await assert.rejects(store.models(draft),/模型|列表/);
  mode='denied';await assert.rejects(store.models(draft),e=>/401|密钥/.test(e.message)&&!e.message.includes('fixture-secret'));
  mode='malformed';await assert.rejects(store.models(draft),e=>/JSON|响应/.test(e.message)&&!e.message.includes('fixture-sec'));
  assert.deepEqual(store.snapshot(),before);
});
