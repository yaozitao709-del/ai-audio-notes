import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {choosePython,missingPackages,ensureFile,matches,extractTar,run,acquireLock} from './lite-runtime.mjs';

const unique=items=>[...new Set(items.filter(Boolean))];
const exists=p=>fs.access(p).then(()=>true,()=>false);
const readJson=p=>fs.readFile(p,'utf8').then(JSON.parse);
const root=fileURLToPath(new URL('../',import.meta.url));
export function reuseRoots(app=root,env=process.env,home=os.homedir()){
  return unique([app,...(env.AI_AUDIO_REUSE_DIRS||'').split(path.delimiter),
    path.join(path.dirname(app),'AI-Audio-Notes'),path.join(home,'Applications/AI-Audio-Notes'),
    path.join(home,'Downloads/AI-Audio-Notes'),path.join(home,'AI本地工具/Apps/ai-audio-notes')]);
}
export async function pythonCandidates(app,cache,roots,env=process.env,home=os.homedir()){
  const previous=await readJson(path.join(cache,'environment.json')).catch(()=>({}));
  const candidates=[env.SPEAKER_PYTHON,previous.python,path.join(cache,'speech-env/bin/python3'),
    env.VIRTUAL_ENV&&path.join(env.VIRTUAL_ENV,'bin/python3'),env.CONDA_PREFIX&&path.join(env.CONDA_PREFIX,'bin/python3'),
    ...roots.flatMap(r=>[path.join(r,'runtime/python/bin/python3'),path.join(r,'.venv/bin/python3')]),
    path.join(home,'AI本地工具/Tools/asr/.venv/bin/python'),'/opt/homebrew/bin/python3.11','/usr/local/bin/python3.11'];
  for(const command of ['python3.11','python3']){
    const found=await run('/usr/bin/which',['-a',command],{env,timeout:5000}).catch(()=>'');candidates.push(...found.trim().split('\n'));
  }
  for(const base of [path.join(home,'.pyenv/versions'),path.join(home,'miniconda3/envs'),path.join(home,'anaconda3/envs')]){
    const entries=await fs.readdir(base,{withFileTypes:true}).catch(()=>[]);
    candidates.push(...entries.filter(e=>e.isDirectory()).slice(0,12).map(e=>path.join(base,e.name,'bin/python3')));
  }
  return unique(candidates).filter(p=>p!=='/usr/bin/python3');
}
function pythonEnv(env,cache){
  const result={...env,PYTHONPATH:'',PYTHONDONTWRITEBYTECODE:'1',PIP_CONFIG_FILE:'/dev/null',PIP_REQUIRE_VIRTUALENV:'true',PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_INDEX_URL:'https://pypi.org/simple',PIP_EXTRA_INDEX_URL:'',NUMBA_CACHE_DIR:path.join(cache,'numba'),HF_HOME:path.join(cache,'huggingface'),MODELSCOPE_CACHE:path.join(cache,'modelscope')};
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
  await fs.symlink(source,target);
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
async function prepareNative(app,cache,roots,info,report,log){
  const destination=path.join(app,'node_modules',info.name),cached=path.join(cache,'native',info.name+'-'+info.version);
  for(const candidate of unique([destination,cached,...roots.map(r=>path.join(r,'node_modules',info.name))])){
    if(await packageMatches(candidate,info)){await link(destination,candidate);report.reused.push(info.name);return;}
  }
  log('下载缺少的语音引擎组件。');const archive=path.join(cache,'downloads',info.name+'-'+info.version+'.tgz');
  await ensureFile(archive,info);await extractTar(archive,cached,{strip:1});
  if(!await packageMatches(cached,info))throw new Error('语音引擎组件校验失败。');
  await link(destination,cached);report.downloaded.push(info.name);
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
  const manifest=await readJson(path.join(app,'AUDIO_TOOLS_MANIFEST.json'));const result={};
  for(const [name,info] of Object.entries(manifest)){
    const variable=info.binary==='ffmpeg'?'FFMPEG_PATH':'FFPROBE_PATH';
    const inPath=await run('/usr/bin/which',['-a',info.binary],{env,timeout:5000}).catch(()=>'');
    const cached=path.join(cache,'audio',name),candidates=unique([env[variable],...roots.map(r=>path.join(r,'node_modules',name,info.binary)),path.join(cached,info.binary),...inPath.trim().split('\n')]);
    for(const candidate of candidates){try{await audioUsable(candidate,info.binary);result[variable]=candidate;break;}catch{}}
    if(result[variable]){report.reused.push(info.binary);continue;}
    log('下载缺少的音频工具：'+info.binary);const archive=path.join(cache,'downloads',info.binary+'.tgz');
    await ensureFile(archive,info);await extractTar(archive,cached,{strip:1});await fs.chmod(path.join(cached,info.binary),0o755);
    await audioUsable(path.join(cached,info.binary),info.binary);result[variable]=path.join(cached,info.binary);report.downloaded.push(info.binary);
  }
  return result;
}
export async function preparePython(app,cache,manifest,{env=process.env,candidates,report={reused:[],downloaded:[]},log=console.log}={}){
  const required=Object.fromEntries((await fs.readFile(path.join(app,'requirements-speech.txt'),'utf8')).split('\n').filter(s=>s.trim()&&!s.startsWith('#')).map(s=>s.trim().split('==')));
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
    const python=path.join(base,'python/bin/python3');
    if(!await probePython(python,app,penv)){await ensureFile(archive,manifest.python);await extractTar(archive,base);report.downloaded.push('Python '+manifest.python.version);}
    best=choosePython(required,[await probePython(python,app,penv)]);if(!best)throw new Error('下载的 Python 未通过验证。');
  }
  const owned=path.join(cache,'speech-env'),python=path.join(owned,'bin/python3');
  if(!await probePython(python,app,penv)){
    // All package installation happens in this app-owned venv, never in best.executable.
    if(await exists(owned))await fs.rename(owned,owned+'.incomplete-'+Date.now());
    await run(best.executable,['-B','-m','venv',owned],{env:penv,timeout:120000});
    const sites=(await probePython(python,app,penv)).sitePaths;
    const paths=best.sitePaths.filter(p=>!p.includes('\n')&&!p.startsWith(owned));
    await fs.writeFile(path.join(sites[0],'audio-notes-existing-env.pth'),paths.join('\n')+'\n');
  }
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
    await run(python,['-B','-m','pip','install','--no-input','--disable-pip-version-check','--cache-dir',path.join(cache,'pip'),'--find-links',wheels,'-r',path.join(app,'requirements-speech.txt')],{env:penv,timeout:1800000,inherit:true});
    report.downloaded.push(...missing.map(n=>'Python:'+n));
  }
  current=await probePython(python,app,penv);
  if(missingPackages(required,current?.packages).length)throw new Error('语音依赖安装不完整，请联网后重新启动；已完成的部分会复用。');
  await smokePython(python,penv);return {python,env:penv,missing};
}
export async function prepare({app=root,cache,roots,candidates,env=process.env,log=console.log}={}){
  if(process.platform!=='darwin'||process.arch!=='arm64'||Number(os.release().split('.')[0])<23)throw new Error('轻量版需要苹果芯片 Mac 和 macOS 14 或更新版本。');
  const data=env.AI_AUDIO_DATA_ROOT||path.join(os.homedir(),'Library/Application Support/AI Audio Notes');
  cache ||= env.AI_AUDIO_CACHE_DIR||path.join(data,'runtime-cache');cache=path.resolve(cache);
  const previous=await readJson(path.join(cache,'environment.json')).catch(()=>({}));
  roots ||= reuseRoots(app,env);
  roots=unique([...roots,...(Array.isArray(previous.roots)?previous.roots.filter(r=>typeof r==='string'):[])]).map(r=>path.resolve(r));
  env={...env,FFMPEG_PATH:env.FFMPEG_PATH||previous.audio?.FFMPEG_PATH,FFPROBE_PATH:env.FFPROBE_PATH||previous.audio?.FFPROBE_PATH};
  const release=await acquireLock(cache),report={version:'0.3.0',reused:[],downloaded:[]};
  try{
    const manifest=await readJson(path.join(app,'LITE_RUNTIME_MANIFEST.json'));log('检测已有环境和模型，已校验的组件不会重复下载。');
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
if(invokedScript===await fs.realpath(fileURLToPath(import.meta.url))){
  try{
    if(process.argv[2]==='stop')await run(process.execPath,[path.join(root,'scripts/launcher.mjs'),'stop'],{inherit:true});
    else{const ready=await prepare();if(process.argv[2]!=='--prepare-only')await run(process.execPath,[path.join(root,'scripts/launcher.mjs'),'start'],{env:ready.env,inherit:true});}
  }catch(error){console.error('准备未完成：'+error.message+'\n请检查网络后重新启动；已下载的部分会保留。');process.exitCode=1;}
}
