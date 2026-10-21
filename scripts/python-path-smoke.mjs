import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {run,pythonPathFile} from './lite-runtime.mjs';import {probePython} from './lite-setup.mjs';import {profile} from '../server/platform.js';
const [python]=process.argv.slice(2),p=profile(),root=await fs.mkdtemp(path.join(os.tmpdir(),'复用 路径 '));
try{
 const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPATH:'',PYTHONDONTWRITEBYTECODE:'1'};
 const venv=path.join(root,'venv'),shared=path.join(root,'共享 packages');await fs.mkdir(shared);await fs.mkdir(path.join(shared,'demo_reuse'));await fs.writeFile(path.join(shared,'demo_reuse/__init__.py'),'value = 42\n');
 await fs.mkdir(path.join(shared,'demo_reuse-1.0.dist-info'));await fs.writeFile(path.join(shared,'demo_reuse-1.0.dist-info/METADATA'),'Metadata-Version: 2.1\nName: demo-reuse\nVersion: 1.0\n');
 await run(python,['-m','venv',venv],{env});const exe=path.join(venv,p.venvPython),probe=await probePython(exe,undefined,env);
 await fs.writeFile(path.join(probe.sitePackages,'shared.pth'),pythonPathFile([shared]));
 console.log('Python path fixture:',JSON.stringify({python:exe,probe,shared}));
 const result=await run(exe,['-P','-c','import demo_reuse, importlib.metadata; print(demo_reuse.value); print(importlib.metadata.version("demo-reuse"))'],{env});assert.match(result,/42\r?\n1.0/);
 console.log('Python .pth Unicode module and metadata reuse passed.');
}finally{await fs.rm(root,{recursive:true,force:true});}
