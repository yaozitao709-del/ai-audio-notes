import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {run} from './lite-runtime.mjs';import {packageSources} from './package-files.mjs';
test('package source enumeration preserves Chinese names and excludes local dependencies',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'package 中文 '));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await run('git',['init'],{cwd:dir});await fs.writeFile(path.join(dir,'中文说明.txt'),'usage');await fs.writeFile(path.join(dir,'node_modules'),'machine-specific');await fs.writeFile(path.join(dir,'关闭.command'),'Mac launcher');await run('git',['add','.'],{cwd:dir});
 assert.deepEqual(await packageSources(dir),['中文说明.txt']);
});

test('distribution copies exclude upstream developer credentials while keeping licenses',async t=>{
 const {copyablePackagePath}=await import('./package-files.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'package-clean-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source'),output=path.join(dir,'output');await fs.mkdir(source);
 for(const name of ['.env','.env.local','.npmrc','.pypirc'])await fs.writeFile(path.join(source,name),'fixture-only');
 await fs.writeFile(path.join(source,'LICENSE'),'license must remain');await fs.writeFile(path.join(source,'index.js'),'export {};');
 await fs.cp(source,output,{recursive:true,filter:copyablePackagePath});
 assert.deepEqual((await fs.readdir(output)).sort(),['LICENSE','index.js']);
});
