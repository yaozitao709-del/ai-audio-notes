import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { proofreadNote, transcriptHash } from './note-proofreading.js';
import { Proofreader } from './proofreading.js';

test('old proofreading policy refreshes from immutable raw; current result and manual edits are reused',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'note-policy-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const raw=[{lineId:'original',startTime:'00:00:01',speaker:'讲话人1',text:'我我我建议先试一下这个方案，后续再根据实际反馈继续调整。'}];
  const rawPath=path.join(directory,'saved-raw.json');await fs.writeFile(rawPath,JSON.stringify({transcript:raw}));
  let current={id:'test',title:'测试',rawTranscriptPath:rawPath,transcript:raw,proofreading:{status:'done',version:'context-edits-v2',outputHash:transcriptHash(raw)}};
  let calls=0;
  const engine=new Proofreader({model:'deepseek-flash',request:async({messages})=>{
    calls++;const c=JSON.parse(messages.at(-1).content);
    assert.equal(c.body[0].text,raw[0].text);
    return {payload:{reviewed_ids:c.body.map(p=>p.id),edits:[{id:c.body[0].id,before:'我我我建议',after:'我建议',kind:'cleanup',cleanup_type:'stutter',reason:'删除无意义口吃'}],uncertain:[]}};
  }});
  const updateNote=async(id,patch)=>(current={...current,...patch});
  const options={engine,directory,updateNote};
  const updated=await proofreadNote(current,options);
  assert.equal(calls,1);assert.ok(updated.proofreading.policy);
  assert.equal(updated.transcript[0].text,raw[0].text.replace('我我我','我'));
  await proofreadNote(updated,options);assert.equal(calls,1);
  engine.configurationId='new-endpoint-same-model';
  const refreshed=await proofreadNote(updated,options);assert.equal(calls,2);
  assert.equal(refreshed.proofreading.configurationId,'new-endpoint-same-model');
  const manual={...updated,transcriptEditedAt:new Date().toISOString(),transcript:[{...raw[0],text:'我的人工修改'}]};
  assert.deepEqual(await proofreadNote(manual,options),manual);assert.equal(calls,2);
  assert.deepEqual(JSON.parse(await fs.readFile(rawPath,'utf8')).transcript,raw);
});
