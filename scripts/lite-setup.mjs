import {profile,defaultDataRoot,systemTool} from '../server/platform.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {choosePython,missingPackages,ensureFile,matches,extractTar,run,acquireLock,pythonPathFile} from './lite-runtime.mjs';

const unique=items=>[...new Set(items.filter(Boolean))];
const exists=p=>fs.access(p).then(()=>true,()=>false);
const readJson=p=>fs.readFile(p,'utf8').then(JSON.parse);
const platform=profile();
const which=async(command,env)=>run(systemTool(platform.windows?'where':'which'),[...(platform.windows?[]:['-a']),command],{env,timeout:5000}).catch(()=>'');
const root=fileURLToPath(new URL('../',import.meta.url));
export function reuseRoots(app=root,env=process.env,home=os.homedir()){
  return unique([app,...(env.AI_AUDIO_REUSE_DIRS||'').split(path.delimiter),
    path.join(path.dirname(app),'AI-Audio-Notes'),path.join(home,'Applications/AI-Audio-Notes'),
    path.join(home,'Downloads/AI-Audio-Notes'),path.join(home,'AI本地工具/Apps/ai-audio-notes')]);
}
export async function pythonCandidates(app,cache,roots,env=process.env,home=os.homedir()){
  if(env.AI_AUDIO_ISOLATED_PYTHON==='1')return [];
  const previous=await readJson(path.join(cache,'environment.json')).catch(()=>({}));
  const candidates=[env.SPEAKER_PYTHON,previous.python,path.join(cache,'speech-env',platform.venvPython),
    env.VIRTUAL_ENV&&path.join(env.VIRTUAL_ENV,platform.venvPython),env.CONDA_PREFIX&&path.join(env.CONDA_PREFIX,platform.python),
    ...roots.flatMap(r=>[path.join(r,'runtime/python',platform.python),path.join(r,'.venv',platform.venvPython)]),
    path.join(home,'AI本地工具/Tools/asr/.venv/bin/python'),'/opt/homebrew/bin/python3.11','/usr/local/bin/python3.11'];
  for(const command of platform.windows?['python.exe','python3.11.exe']:['python3.11','python3']){
    const found=await which(command,env);candidates.push(...found.trim().split('\n'));
  }
  for(const base of [path.join(home,'.pyenv/versions'),path.join(home,'miniconda3/envs'),path.join(home,'anaconda3/envs')]){
    const entries=await fs.readdir(base,{withFileTypes:true}).catch(()=>[]);
    candidates.push(...entries.filter(e=>e.isDirectory()).slice(0,12).map(e=>path.join(base,e.name,platform.python)));
  }
  if(platform.windows){
    const py=await run(systemTool('where'),['py.exe'],{env,timeout:5000}).catch(()=>'');
    if(py.trim()){const selected=await run(py.trim().split(/\r?\n/)[0],['-3.11','-c','import sys;print(sys.executable)'],{env,timeout:10000}).catch(()=>'');candidates.push(selected.trim());}
    candidates.push(...[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs/Python/Python311/python.exe'),path.join(home,'miniconda3/python.exe'),path.join(home,'anaconda3/python.exe')]);
  }
  return unique(candidates.map(p=>p?.trim())).filter(p=>p!=='/usr/bin/python3'&&!/WindowsApps/i.test(p));
}
function pythonEnv(env,cache){
  const result={...env,PYTHONPATH:'',PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PIP_CONFIG_FILE:platform.windows?'nul':'/dev/null',PIP_REQUIRE_VIRTUALENV:'true',PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_INDEX_URL:'https://pypi.org/simple',PIP_EXTRA_INDEX_URL:'',NUMBA_CACHE_DIR:path.join(cache,'numba'),HF_HOME:path.join(cache,'huggingface'),MODELSCOPE_CACHE:path.join(cache,'modelscope')};
  delete result.PYTHONHOME;delete result.PIP_TARGET;delete result.PIP_PREFIX;delete result.PIP_USER;return result;
}
export async function probePython(executable,app=root,env=process.env){
  try{return JSON.parse(await run(executable,['-B','-P',path.join(app,'scripts/python-probe.py')],{env,timeout:60000}));}catch{return null;}
}
async function smokePython(python,env){
  await run(python,['-B','-P','-c','import torch, torchaudio.compliance.kaldi, numpy, scipy, sklearn, soundfile; from funasr import AutoModel; print("runtime-ready")'],{env,timeout:90000});
}
async function link(target,source){
  if(path.resolve(target)===path.resolve(source))return;
  if(await fs.realpath(target).catch(()=>null)===await fs.realpath(source).catch(()=>null))return;
  await fs.mkdir(path.dirname(target),{recursive:true});
  if(await fs.lstat(target).then(()=>true,()=>false))await fs.rename(target,target+'.before-lite-'+Date.now());
  if(platform.windows){if((await fs.stat(source)).isDirectory())await fs.symlink(source,target,'junction');else{try{await fs.link(source,target);}catch(e){if(!['EXDEV','EPERM','ENOTSUP'].includes(e.code))throw e;await fs.copyFile(source,target);}}}
  else await fs.symlink(source,target);
}
async function prepareModels(app,cache,roots,env,report,log){
  const para=await readJson(path.join(app,'MODEL_MANIFEST.json'));
  const speaker=await readJson(path.join(app,'SPEAKER_MODEL_MANIFEST.json'));
  const paraDir=path.join(cache,'models/paraformer-streaming'),spkDir=path.join(cache,'models/speakers');
  const rows=[...Object.entries(para.files).map(([name,info])=>({name,info,target:path.join(paraDir,name),sources:unique([env.PARAFORMER_MODEL_DIR,...roots.map(r=>path.join(r,'models/paraformer-streaming'))]).map(r=>path.join(r,name))})),
    ...speaker.filter(i=>!i.testOnly).map(info=>({name:info.directory+'/'+info.file,info,target:path.join(spkDir,info.directory,info.file),sources:unique([env.SPEAKER_MODEL_ROOT,...roots.map(r=>path.join(r,'models/speakers')),...roots.map(r=>path.resolve(r,'../../Models/modelscope/iic'))]).map(r=>path.join(r,info.directory,info.file))}))];
  for(const row of rows){
    if(await matches(row.target,row.info)){report.reused.push(row.name);continue;}
    let source;for(const candidate of row.sources)if(await matches(candidate,row.info)){source=candidate;break;}
    if(source){await link(row.target,source);report.reused.push(row.name);}
    else{log('下载缺少的模型：'+row.name);await ensureFile(row.target,row.info);report.downloaded.push(row.name);}
  }
  return {PARAFORMER_MODEL_DIR:paraDir,SPEAKER_MODEL_ROOT:spkDir};
}
async function packageMatches(folder,info){
  for(const [file,sha256] of Object.entries(info.files))if(!await matches(path.join(folder,file),{sha256}))return false;return true;
}
async function copyVc(app,destination){
  if(!platform.windows)return;
  const source=path.join(app,'support-vc');
  const manifest=await readJson(path.join(source,'MANIFEST.json'));
  await fs.mkdir(destination,{recursive:true});
  for(const [file,sha256] of Object.entries(manifest.files)){if(!await matches(path.join(source,file),{sha256}))throw new Error('VC 运行库校验失败。');if(!await matches(path.join(destination,file),{sha256}))await fs.copyFile(path.join(source,file),path.join(destination,file));}
}
async function prepareNative(app,cache,roots,info,report,log){
  const destination=path.join(app,'node_modules',info.name),cached=path.join(cache,'native',info.name+'-'+info.version);
  for(const candidate of unique([destination,cached,...roots.map(r=>path.join(r,'node_modules',info.name))])){
    if(await packageMatches(candidate,info)){
      let selected=candidate;
      if(platform.windows){if(await fs.realpath(candidate).catch(()=>null)!==await fs.realpath(cached).catch(()=>null))await fs.cp(candidate,cached,{recursive:true,dereference:true});await copyVc(app,cached);selected=cached;}
      await link(destination,selected);report.reused.push(info.name);return;
    }
  }
  log('下载缺少的语音引擎组件。');const archive=path.join(cache,'downloads',info.name+'-'+info.version+'.tgz');
  await ensureFile(archive,info);await extractTar(archive,cached,{strip:1});
  if(!await packageMatches(cached,info))throw new Error('语音引擎组件校验失败。');
  await copyVc(app,cached);await link(destination,cached);report.downloaded.push(info.name);
}
async function audioUsable(executable,binary){
  await run(executable,['-version'],{timeout:10000});
  if(binary==='ffmpeg'){
    const decoders=await run(executable,['-hide_banner','-decoders'],{timeout:10000});
    const formats=await run(executable,['-hide_banner','-formats'],{timeout:10000});
    if(!['pcm_s16le','aac','opus'].every(n=>decoders.includes(n)) || !/mp3/.test(decoders) || !formats.includes('webm') || !formats.includes('m4a'))throw new Error('音频工具缺少常用格式支持。');
  }
}
async function prepareAudio(app,cache,roots,env,report,log){
  const manifest=await readJson(path.join(app,'AUDIO_TOOLS_MANIFEST'+platform.manifestSuffix+'.json'));const result={};
  for(const [name,info] of Object.entries(manifest)){
    const variable=info.binary==='ffmpeg'?'FFMPEG_PATH':'FFPROBE_PATH';
    const inPath=await which(info.binary,env);
    const executable=info.binary+platform.suffix;
    const cached=path.join(cache,'audio',name),candidates=unique([env[variable],...roots.map(r=>path.join(r,'node_modules',name,executable)),path.join(cached,executable),...inPath.trim().split('\n')]);
    for(const candidate of candidates){try{await audioUsable(candidate,info.binary);result[variable]=candidate;break;}catch{}}
    if(result[variable]){report.reused.push(info.binary);continue;}
    log('下载缺少的音频工具：'+info.binary);const archive=path.join(cache,'downloads',info.binary+'.tgz');
    await ensureFile(archive,info);await extractTar(archive,cached,{strip:1});await fs.chmod(path.join(cached,executable),0o755);
    await audioUsable(path.join(cached,executable),info.binary);result[variable]=path.join(cached,executable);report.downloaded.push(info.binary);
  }
  return result;
}
export async function preparePython(app,cache,manifest,{env=process.env,candidates,report={reused:[],downloaded:[]},log=console.log}={}){
  const isolated=env.AI_AUDIO_ISOLATED_PYTHON==='1';
  if(isolated)candidates=[];
  const required=Object.fromEntries((await fs.readFile(path.join(app,platform.requirements),'utf8')).split('\n').filter(s=>s.trim()&&!s.startsWith('#')).map(s=>s.trim().split('==')));
  const penv=pythonEnv(env,cache),reports=[];
  for(const candidate of candidates){
    const value=await probePython(candidate,app,penv),compatible=choosePython(required,[value]);
    if(!compatible)continue;
    if(!compatible.missing.length){
      try{await smokePython(compatible.executable,penv);report.reused.push('Python 和全部语音依赖');return {python:compatible.executable,env:penv,missing:[]};}
      catch{continue;}
    }
    reports.push(value);
  }
  let best=choosePython(required,reports);
  if(!best){
    log('未找到兼容的 Python 3.11，准备应用专用 Python。');
    const archive=path.join(cache,'downloads','python-'+manifest.python.version+'.tar.gz'),base=path.join(cache,'python-standalone');
    const python=path.join(base,'python',platform.python);
    if(!await probePython(python,app,penv)){await ensureFile(archive,manifest.python);await extractTar(archive,base);report.downloaded.push('Python '+manifest.python.version);}
    await copyVc(app,path.dirname(python));
    best=choosePython(required,[await probePython(python,app,penv)]);if(!best)throw new Error('下载的 Python 未通过验证。');
  }
  const owned=path.join(cache,'speech-env'),python=path.join(owned,platform.venvPython);
  const ownedProbe=await probePython(python,app,penv);
  const wrongBase=isolated && ownedProbe && await fs.realpath(ownedProbe.basePrefix)!==await fs.realpath(best.prefix);
  if(!ownedProbe || wrongBase){
    // All package installation happens in this app-owned venv, never in best.executable.
    if(await exists(owned))await fs.rename(owned,owned+'.incomplete-'+Date.now());
    await run(best.executable,['-B','-m','venv',owned],{env:penv,timeout:120000});
    const sitePackages=(await probePython(python,app,penv)).sitePackages;
    const paths=best.sitePaths.filter(p=>!p.includes('\n')&&!p.startsWith(owned));
    if(!isolated)await fs.writeFile(path.join(sitePackages,'audio-notes-existing-env.pth'),pythonPathFile(paths));
  }
  if(isolated){const own=await probePython(python,app,penv);await fs.rm(path.join(own.sitePackages,'audio-notes-existing-env.pth'),{force:true});}
  await copyVc(app,path.dirname(python));
  let current=await probePython(python,app,penv);if(!current || await fs.realpath(current.prefix)!==await fs.realpath(owned))throw new Error('拒绝向非应用目录安装 Python 依赖。');
  const missing=missingPackages(required,current.packages);
  if(missing.length){
    log(`Python 可复用；仅补装 ${missing.length} 个缺少或版本不符的依赖（应用独立目录）。`);
    const wheels=path.join(cache,'wheels');await fs.mkdir(wheels,{recursive:true});
    for(const info of manifest.portableWheels)if(missing.includes(info.name)){
      const bundled=path.join(app,'support-wheels',info.filename),target=path.join(wheels,info.filename);
      if(await matches(bundled,info)){await fs.copyFile(bundled,target);report.reused.push('内置依赖 '+info.name);}
      else{const state=await ensureFile(target,info);report[state==='downloaded'?'downloaded':'reused'].push(info.filename);}
    }
    await run(python,['-B','-m','pip','install','--no-input','--disable-pip-version-check','--cache-dir',path.join(cache,'pip'),'--find-links',wheels,'-r',path.join(app,platform.requirements)],{env:penv,timeout:1800000,inherit:true});
    report.downloaded.push(...missing.map(n=>'Python:'+n));
  }
  current=await probePython(python,app,penv);
  const remaining=missingPackages(required,current?.packages);
  if(remaining.length)throw new Error('语音依赖版本校验未通过：'+remaining.join(', ')+'。请重新启动重试；已完成的部分会复用。');
  await smokePython(python,penv);return {python,env:penv,missing};
}
export async function prepare({app=root,cache,roots,candidates,env=process.env,log=console.log}={}){
  profile();
  const data=defaultDataRoot({env});
  cache ||= env.AI_AUDIO_CACHE_DIR||path.join(data,'runtime-cache');cache=path.resolve(cache);
  const previous=await readJson(path.join(cache,'environment.json')).catch(()=>({}));
  roots ||= reuseRoots(app,env);
  roots=unique([...roots,...(Array.isArray(previous.roots)?previous.roots.filter(r=>typeof r==='string'):[])]).map(r=>path.resolve(r));
  env={...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',FFMPEG_PATH:env.FFMPEG_PATH||previous.audio?.FFMPEG_PATH,FFPROBE_PATH:env.FFPROBE_PATH||previous.audio?.FFPROBE_PATH};
  const release=await acquireLock(cache),report={version:'0.4.0',reused:[],downloaded:[]};
  try{
    const manifest=await readJson(path.join(app,'LITE_RUNTIME_MANIFEST'+platform.manifestSuffix+'.json'));log('检测已有环境和模型，已校验的组件不会重复下载。');
    const models=await prepareModels(app,cache,roots,env,report,log);
    await prepareNative(app,cache,roots,manifest.native,report,log);
    const audio=await prepareAudio(app,cache,roots,env,report,log);
    candidates ||= await pythonCandidates(app,cache,roots,env);
    const python=await preparePython(app,cache,manifest,{env,candidates,report,log});
    const configured={...python.env,...models,...audio,SPEAKER_PYTHON:python.python};
    await fs.writeFile(path.join(cache,'environment.json'),JSON.stringify({python:python.python,models,audio,roots,report},null,2),{mode:0o600});
    log(`准备完成：复用 ${report.reused.length} 项，补充 ${report.downloaded.length} 项。`);
    return {env:configured,report,cache};
  }finally{await release();}
}
const invokedScript=process.argv[1] ? await fs.realpath(process.argv[1]).catch(()=>null) : null;
if(invokedScript && (platform.windows?invokedScript.toLowerCase():invokedScript)===(platform.windows?(await fs.realpath(fileURLToPath(import.meta.url))).toLowerCase():await fs.realpath(fileURLToPath(import.meta.url)))){
  try{
    if(process.argv[2]==='stop')await run(process.execPath,[path.join(root,'scripts/launcher.mjs'),'stop'],{inherit:true});
    else{const ready=await prepare();if(process.argv[2]!=='--prepare-only')await run(process.execPath,[path.join(root,'scripts/launcher.mjs'),'start'],{env:ready.env,inherit:true});}
  }catch(error){console.error('准备未完成：'+error.message+'\n请检查网络后重新启动；已下载的部分会保留。');process.exitCode=1;}
}
