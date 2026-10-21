import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {preparePython,probePython} from './lite-setup.mjs';import {run,missingPackages,pythonPathFile} from './lite-runtime.mjs';
const [work,app]=process.argv.slice(2),cached=JSON.parse(await fs.readFile(path.join(work,'cold-cache/environment.json'),'utf8'));
const python=cached.python,manifest=JSON.parse(await fs.readFile(path.join(app,'LITE_RUNTIME_MANIFEST.windows-x64.json'),'utf8'));
const env={...process.env,PYTHONPATH:'',PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'};
const required=Object.fromEntries((await fs.readFile(path.join(app,'requirements-speech-windows.txt'),'utf8')).split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split('==')));
const full=await probePython(python,app,env);assert.ok(full.sitePackages?.endsWith('site-packages'),'Probe must identify the writable site-packages, not the Windows prefix directory.');
const warmReport={reused:[],downloaded:[]};const warm=await preparePython(app,path.join(work,'warm-python'),manifest,{env,candidates:[python],report:warmReport});assert.equal(warm.python,python);assert.deepEqual(warmReport.downloaded,[]);
const partial=path.join(work,'partial-original'),shared=path.join(work,'partial-shared');await fs.mkdir(shared,{recursive:true});await run(python,['-B','-m','venv',partial],{env});
for(const e of await fs.readdir(full.sitePackages,{withFileTypes:true})){if(e.name.toLowerCase().startsWith('idna')||e.name==='__pycache__')continue;const a=path.join(full.sitePackages,e.name),b=path.join(shared,e.name);if(e.isDirectory())await fs.symlink(a,b,'junction');else await fs.link(a,b);}
const original=path.join(partial,'Scripts/python.exe'),reportBefore=await probePython(original,app,env);await fs.writeFile(path.join(reportBefore.sitePackages,'shared.pth'),pythonPathFile([shared]));
const partialMissing=missingPackages(required,(await probePython(original,app,env)).packages);assert.ok(partialMissing.includes('idna'));assert.ok(partialMissing.length<=3,JSON.stringify(partialMissing));
async function snapshot(dir){const out={};for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name==='__pycache__')continue;const p=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,await snapshot(p));else if(e.isFile())out[p]=crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');}return out;}
const before=await snapshot(partial),report={reused:[],downloaded:[]};
const fixed=await preparePython(app,path.join(work,'partial-owned'),manifest,{env,candidates:[original],report});
assert.ok(fixed.python.startsWith(path.join(work,'partial-owned')));assert.ok(report.downloaded.includes('Python:idna'));assert.ok(report.downloaded.filter(x=>x.startsWith('Python:')).length<=3,JSON.stringify(report));assert.deepEqual(await snapshot(partial),before);assert.deepEqual(missingPackages(required,(await probePython(fixed.python,app,env)).packages),[]);
const isolatedReport={reused:[],downloaded:[]};
const isolated=await preparePython(app,path.join(work,'partial-owned'),manifest,{env:{...env,AI_AUDIO_ISOLATED_PYTHON:'1'},candidates:[original],report:isolatedReport});
const isolatedProbe=await probePython(isolated.python,app,env);
assert.equal(await fs.realpath(isolatedProbe.basePrefix),await fs.realpath(path.join(work,'partial-owned/python-standalone/python')));
await assert.rejects(fs.access(path.join(isolatedProbe.sitePackages,'audio-notes-existing-env.pth')));
assert.deepEqual(await snapshot(partial),before);
assert.deepEqual(missingPackages(required,isolatedProbe.packages),[]);
await fs.writeFile(path.join(work,'python-reuse.json'),JSON.stringify({existingZeroDownloads:true,partialOnlyMissing:report.downloaded,originalUnmodified:true,switchToIsolatedPython:true},null,2));console.log('Existing Python reuse and isolated partial repair passed.');
