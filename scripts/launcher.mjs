import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureAudioTools} from './audio-tools-bootstrap.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dataRoot=process.env.AI_AUDIO_DATA_ROOT || path.join(os.homedir(),'Library','Application Support','AI Audio Notes');
const runDir=path.join(dataRoot,'run'),pidPath=path.join(runDir,'server.json');
const port=Number(process.env.PORT || 8787),base=`http://127.0.0.1:${port}`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exists=filename=>fs.access(filename).then(()=>true,()=>false);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function health(atPort=port){try{const r=await fetch(`http://127.0.0.1:${atPort}/api/health`,{signal:AbortSignal.timeout(1200)});return r.ok?await r.json():null;}catch{return null;}}
async function owned(info){if(!info||!Number.isSafeInteger(info.port)||info.port<1024||info.port>65535)return false;const h=await health(info.port);return alive(info.pid)&&h?.appId==='ai-audio-notes'&&h.instanceId===info.instanceId;}
async function openPage(atPort=port){if(process.env.AI_AUDIO_NO_OPEN!=='1'){const p=spawn('/usr/bin/open',[`http://127.0.0.1:${atPort}`],{stdio:'ignore',detached:true});p.unref();}}

async function start(){
  const existing=await fs.readFile(pidPath,'utf8').then(JSON.parse).catch(()=>null);
  if(await owned(existing)){console.log(`AI 录音纪要已运行：http://127.0.0.1:${existing.port}`);await openPage(existing.port);return;}
  await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error(`端口 ${port} 已被占用，请先关闭使用该端口的程序，再启动本软件。`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
  if(!await exists(path.join(root,'dist/index.html')))throw new Error('缺少构建页面。源码用户请先执行 npm ci、npm run setup:models 和 npm run build；普通用户请下载完整 Mac ZIP。');
  for(const file of ['encoder.int8.onnx','decoder.int8.onnx','tokens.txt'])if(!await exists(path.join(process.env.PARAFORMER_MODEL_DIR || path.join(root,'models/paraformer-streaming'),file)))throw new Error('快速语音模型缺失。请下载完整 Mac ZIP，或执行 npm run setup:models。');
  const bundled=await exists(path.join(root,'BUNDLED_SERVER.json'));
  if((!bundled && !await exists(path.join(root,'node_modules/express/package.json'))) || !await exists(path.join(root,'node_modules/sherpa-onnx-darwin-arm64/package.json'))){
    throw new Error('运行依赖不完整。普通用户请下载完整 Mac ZIP；源码用户请先执行 npm ci。');
  }
  if(process.env.SPEAKER_DIARIZATION !== 'false'){
    const python=process.env.SPEAKER_PYTHON || path.join(root,'runtime/python/bin/python3');
    const models=process.env.SPEAKER_MODEL_ROOT || path.join(root,'models/speakers');
    if(!await exists(python))throw new Error('分人运行环境缺失。请下载完整 Mac ZIP；源码用户请按 README 配置 SPEAKER_PYTHON。');
    for(const file of ['speech_fsmn_vad_zh-cn-16k-common-pytorch/model.pt','speech_campplus_sv_zh-cn_16k-common/campplus_cn_common.bin']){
      if(!await exists(path.join(models,file)))throw new Error('分人模型缺失。请下载完整 Mac ZIP，或执行 npm run setup:speakers。');
    }
  }
  await ensureAudioTools(root);
  await fs.mkdir(runDir,{recursive:true,mode:0o700});
  const instanceId=crypto.randomUUID();
  const log=await fs.open(path.join(runDir,'backend.log'),'a',0o600);
  const child=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),AI_AUDIO_DATA_ROOT:dataRoot,AI_AUDIO_INSTANCE_ID:instanceId},stdio:['ignore',log.fd,log.fd],detached:true});
  child.unref();await log.close();
  await fs.writeFile(pidPath,JSON.stringify({pid:child.pid,instanceId,port,appRoot:root}),{mode:0o600});
  for(let i=0;i<150;i++){
    const h=await health();
    if(h?.instanceId===instanceId){
      const response=await fetch(base+'/api/asr/health',{signal:AbortSignal.timeout(30_000)});
      const asr=await response.json();if(!response.ok||asr.status!=='ready')throw new Error('语音引擎未就绪，请检查本机日志。');
      console.log(`AI 录音纪要已启动：${base}\n首次使用请点首页右上角“AI 设置”，填写自己的 API 密钥。`);
      await openPage();return;
    }
    if(!alive(child.pid))break;
    await delay(200);
  }
  throw new Error(`启动未完成。请查看本机日志：${path.join(runDir,'backend.log')}`);
}

async function stop(){
  const info=await fs.readFile(pidPath,'utf8').then(JSON.parse).catch(()=>null);
  if(await owned(info)){
    process.kill(info.pid,'SIGTERM');
    for(let i=0;i<50&&alive(info.pid);i++)await delay(100);
    await fs.unlink(pidPath).catch(()=>{});console.log('AI 录音纪要已关闭。');
  }else console.log('未发现本软件的有效运行实例，未停止其他程序。');
}

try{
  if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('此分发包仅支持苹果芯片 Mac（M 系列）。');
  if(Number(os.release().split('.')[0])<23)throw new Error('此分发包需要 macOS 14 Sonoma 或更新版本。');
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('PORT 必须是1024到65535之间的端口号。');
  if(process.argv[2]==='stop')await stop();else await start();
}catch(error){console.error(error.message);process.exitCode=1;}
