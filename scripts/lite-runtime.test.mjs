import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {choosePython,missingPackages,ensureFile,acquireLock} from './lite-runtime.mjs';

test('reuse complete compatible environments and report only missing or incompatible packages',()=>{
  const required={torch:'2.12.1',funasr:'1.3.14'};
  const partial={executable:'/partial/python',version:[3,11,17],arch:'arm64',packages:{torch:'2.12.1'}};
  const full={...partial,executable:'/existing/python',packages:required};
  assert.equal(choosePython(required,[{...full,version:[3,12,1]},partial,full],'arm64').executable,'/existing/python');
  assert.deepEqual(missingPackages(required,partial.packages),['funasr']);
  assert.deepEqual(missingPackages(required,{torch:'2.11.0',funasr:'1.3.14'}),['torch']);
  assert.equal(choosePython(required,[{...full,arch:'x86_64'}],'arm64'),null);
});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lite installer 中文 '));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const data=Buffer.from('verified-download-content'),requests=[];
  const server=http.createServer((req,res)=>{
    requests.push(req.headers.range||'full');
    const start=req.headers.range?Number(req.headers.range.match(/bytes=(\d+)-/)[1]):0;
    if(start){res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${data.length-1}/${data.length}`);}
    res.end(data.subarray(start));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(r=>server.close(r)));
  return {dir,data,requests,info:{url:`http://127.0.0.1:${server.address().port}/asset`,sha256:crypto.createHash('sha256').update(data).digest('hex')}};
}
test('reuse matching files and download only a missing file',async t=>{
  const f=await fixture(t),a=path.join(f.dir,'existing'),b=path.join(f.dir,'missing');
  await fs.writeFile(a,f.data);
  assert.equal(await ensureFile(a,f.info,{allowLocalHttp:true}),'reused');
  assert.equal(await ensureFile(b,f.info,{allowLocalHttp:true}),'downloaded');
  assert.deepEqual(f.requests,['full']);assert.deepEqual(await fs.readFile(b),f.data);
});
test('resume partial downloads and reuse the completed cache',async t=>{
  const f=await fixture(t),p=path.join(f.dir,'resumed');await fs.writeFile(p+'.partial',f.data.subarray(0,8));
  await ensureFile(p,f.info,{allowLocalHttp:true});assert.deepEqual(f.requests,['bytes=8-']);
  await ensureFile(p,f.info,{allowLocalHttp:true});assert.equal(f.requests.length,1);
});
test('bad checksum preserves existing data and removes the untrusted partial',async t=>{
  const f=await fixture(t),p=path.join(f.dir,'existing');await fs.writeFile(p,'old-safe-data');
  await assert.rejects(ensureFile(p,{...f.info,sha256:'0'.repeat(64)},{allowLocalHttp:true}),/校验|checksum/);
  assert.equal(await fs.readFile(p,'utf8'),'old-safe-data');await assert.rejects(fs.access(p+'.partial'));
});
test('two installers cannot modify the same cache concurrently',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lite-lock-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const release=await acquireLock(dir);await assert.rejects(acquireLock(dir),/正在|running/);
  await release();const release2=await acquireLock(dir);await release2();
});
