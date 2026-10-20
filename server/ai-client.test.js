import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createAIClient } from './ai-client.js';

test('JSON AI requests use non-thinking mode, expose usage and detect truncation', async t => {
  let mode='ok', calls=0, captured;
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const data of req)text+=data;
    captured=JSON.parse(text);calls++;
    if(mode==='retry'&&calls<3){res.writeHead(503);return res.end('{}');}
    if(mode==='denied'){res.writeHead(401);return res.end('untrusted echoed secret');}
    if(mode==='malformed'){res.setHeader('Content-Type','application/json');return res.end('fixture-secret-response is not JSON');}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'test-version',usage:{prompt_tokens:2,completion_tokens:3},choices:[{finish_reason:mode==='length'?'length':'stop',message:{content:JSON.stringify({ok:true})}}]}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const client=createAIClient({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test',retryDelayMs:1});
  const result=await client({model:'test',messages:[]});
  assert.deepEqual(result.payload,{ok:true});assert.equal(result.responseModel,'test-version');assert.equal(result.usage.prompt_tokens,2);assert.deepEqual(captured.thinking,{type:'disabled'});
  mode='length';await assert.rejects(client({model:'test',messages:[]}),e=>e.code==='OUTPUT_TRUNCATED');
  mode='retry';calls=0;await client({model:'test',messages:[]});assert.equal(calls,3);
  mode='ok';await createAIClient({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test',provider:'openai-compatible'})({model:'custom',messages:[]});
  assert.equal(captured.thinking,undefined);
  mode='denied';calls=0;await assert.rejects(client({model:'test',messages:[]}),e=>e.status===401&&!e.message.includes('secret'));
  assert.equal(calls,1);
  mode='malformed';calls=0;await assert.rejects(client({model:'test',messages:[]}),e=>/JSON|响应/.test(e.message)&&!e.message.includes('fixture-sec'));
  assert.equal(calls,1);
  await assert.rejects(createAIClient({apiKey:''})({model:'test',messages:[]}),/密钥|API/);
});
