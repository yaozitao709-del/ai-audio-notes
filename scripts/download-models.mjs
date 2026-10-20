import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.join(root,'MODEL_MANIFEST.json'),'utf8'));
const folder=process.env.PARAFORMER_MODEL_DIR || path.join(root,'models/paraformer-streaming');
async function sha(filename){const hash=crypto.createHash('sha256');for await(const bytes of createReadStream(filename))hash.update(bytes);return hash.digest('hex');}
const rows={...manifest.files,...(process.argv.includes('--test')?manifest.testFixtures:{})};
for(const [name,info] of Object.entries(rows)){
  const target=path.join(folder,name);await fs.mkdir(path.dirname(target),{recursive:true});
  if(await sha(target).then(value=>value===info.sha256,()=>false)){console.log(`${name} 已校验`);continue;}
  console.log(`下载 ${name}`);
  const temp=target+`.${process.pid}.partial`;
  try{
    const response=await fetch(info.url,{signal:AbortSignal.timeout(600_000)});
    if(!response.ok||!response.body)throw new Error(`模型下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temp));
    if(await sha(temp)!==info.sha256)throw new Error(`${name} 的 SHA256 不匹配，未替换原文件。`);
    await fs.rename(temp,target);
  }catch(error){await fs.unlink(temp).catch(()=>{});throw error;}
}
console.log('Paraformer 模型已准备好。');
