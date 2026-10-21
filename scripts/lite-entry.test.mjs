import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('lightweight CLI still executes when launched through an aliased directory',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lite-entry-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const alias=path.join(dir,'app-alias');
  await fs.symlink(fileURLToPath(new URL('../',import.meta.url)),alias,process.platform==='win32'?'junction':undefined);
  const result=spawnSync(process.execPath,[path.join(alias,'scripts/lite-setup.mjs'),'stop'],{
    env:{...process.env,AI_AUDIO_DATA_ROOT:path.join(dir,'empty-data')},encoding:'utf8',timeout:15000
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/未发现本软件的有效运行实例/);
});
