import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export const canonical=name=>name.toLowerCase().replace(/[-_.]+/g,'-');
export function missingPackages(required,installed={}){
  const normalized=Object.fromEntries(Object.entries(installed).map(([n,v])=>[canonical(n),v]));
  return Object.keys(required).filter(n=>normalized[canonical(n)]!==required[n]);
}
export function choosePython(required,reports){
  return reports.filter(r=>r && r.version?.[0]===3 && r.version[1]===11 && r.arch==='arm64')
    .map(r=>({...r,missing:missingPackages(required,r.packages)}))
    .sort((a,b)=>a.missing.length-b.missing.length)[0] || null;
}
export async function run(executable,args,{env=process.env,cwd,timeout=600000,inherit=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{env,cwd,stdio:inherit?'inherit':['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout?.on('data',d=>stdout+=d);child.stderr?.on('data',d=>stderr=(stderr+d).slice(-12000));
    const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),2000).unref();},timeout);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(`${path.basename(executable)} 执行失败（${code}）：${stderr.trim()}`));});
  });
}
export async function checksum(file,algorithm='sha256',encoding='hex'){
  const hash=crypto.createHash(algorithm);for await(const data of createReadStream(file))hash.update(data);return hash.digest(encoding);
}
export async function matches(file,info){
  try{return info.sha256 ? await checksum(file)===info.sha256 : info.integrity===`sha512-${await checksum(file,'sha512','base64')}`;}catch{return false;}
}
export async function ensureFile(target,info,{allowLocalHttp=false}={}){
  if(await matches(target,info))return 'reused';
  const url=new URL(info.url);
  const local=allowLocalHttp && url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname);
  if(url.protocol!=='https:'&&!local)throw new Error('下载地址必须使用 HTTPS。');
  if(!info.sha256&&!info.integrity)throw new Error('下载缺少校验值。');
  await fs.mkdir(path.dirname(target),{recursive:true});
  const partial=target+'.partial';
  const args=['--disable','--fail','--location','--silent','--show-error','--retry','2','--connect-timeout','20','--max-time','600','--proto',local?'=http,https':'=https','--proto-redir',local?'=http,https':'=https'];
  const resume=await fs.stat(partial).then(s=>s.size>0,()=>false);
  try{await run('/usr/bin/curl',[...args,...(resume?['--continue-at','-']:[]),info.url,'--output',partial],{timeout:620000});}
  catch(error){
    if(!resume)throw error;
    // Some servers cannot resume. Restart only the incomplete download once.
    await fs.rm(partial,{force:true});await run('/usr/bin/curl',[...args,info.url,'--output',partial],{timeout:620000});
  }
  if(!await matches(partial,info)){await fs.rm(partial,{force:true});throw new Error(`文件校验失败：${path.basename(target)}；原文件未替换。`);}
  await fs.rename(partial,target);return 'downloaded';
}
export async function acquireLock(cache){
  await fs.mkdir(cache,{recursive:true,mode:0o700});
  const file=path.join(cache,'install.lock'),token=crypto.randomUUID();
  for(let attempt=0;attempt<2;attempt++){
    try{const h=await fs.open(file,'wx',0o600);await h.writeFile(JSON.stringify({pid:process.pid,token}));await h.close();return async()=>{const current=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);if(current?.token===token)await fs.rm(file,{force:true});};}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const previous=await fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);
      if(!previous)throw new Error('另一个安装程序正在初始化，请稍后重试。');
      let alive=true;try{process.kill(previous.pid,0);}catch(error){alive=error.code!=='ESRCH';}
      if(alive)throw new Error('另一个安装程序正在运行，请等待它完成。');
      await fs.rm(file,{force:true});
    }
  }
  throw new Error('无法取得安装锁。');
}
export async function extractTar(archive,destination,{strip=0}={}){
  const listing=await run('/usr/bin/tar',['-tzf',archive]);
  if(listing.split('\n').filter(Boolean).some(n=>n.startsWith('/')||n.split('/').includes('..')))throw new Error('压缩包路径无效。');
  const temporary=destination+'.unpacking-'+crypto.randomUUID();await fs.mkdir(temporary,{recursive:true});
  try{await run('/usr/bin/tar',['-xzf',archive,'-C',temporary,...(strip?['--strip-components='+strip]:[])]);await fs.rm(destination,{recursive:true,force:true});await fs.rename(temporary,destination);}
  finally{await fs.rm(temporary,{recursive:true,force:true});}
}
