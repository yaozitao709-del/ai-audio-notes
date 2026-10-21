import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {run} from './lite-runtime.mjs';import {packageSources} from './package-files.mjs';
test('package source enumeration preserves Chinese names and excludes local dependencies',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'package 中文 '));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await run('git',['init'],{cwd:dir});await fs.writeFile(path.join(dir,'中文说明.txt'),'usage');await fs.writeFile(path.join(dir,'node_modules'),'machine-specific');await fs.writeFile(path.join(dir,'关闭.command'),'Mac launcher');await run('git',['add','.'],{cwd:dir});
 assert.deepEqual(await packageSources(dir),['中文说明.txt']);
});
