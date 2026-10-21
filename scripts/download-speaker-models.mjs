import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.join(root,'SPEAKER_MODEL_MANIFEST.json'),'utf8'));
const folder=process.env.SPEAKER_MODEL_ROOT || path.join(root,'models/speakers');
async function sha(filename){const hash=crypto.createHash('sha256');for await(const bytes of createReadStream(filename))hash.update(bytes);return hash.digest('hex');}
for(const info of manifest){
  if(info.testOnly && !process.argv.includes('--test'))continue;
  const target=path.join(folder,info.directory,info.file);await fs.mkdir(path.dirname(target),{recursive:true});
  if(await sha(target).then(value=>value===info.sha256,()=>false)){console.log(`${info.directory}/${info.file} 已校验`);continue;}
  console.log(`下载 ${info.directory}/${info.file}`);const temp=target+`.${process.pid}.partial`;
  try{
    const response=await fetch(info.url,{signal:AbortSignal.timeout(600000)});
    if(!response.ok||!response.body)throw new Error(`模型下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));
    if(await sha(temp)!==info.sha256)throw new Error(`${info.file} 的 SHA256 不匹配，未替换原文件。`);
    await fs.rename(temp,target);
  }catch(error){await fs.unlink(temp).catch(()=>{});throw error;}
}
console.log('VAD 与 CAM++ 已准备好；未下载 SenseVoice。');
