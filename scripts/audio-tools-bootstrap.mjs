import {profile,systemTool} from '../server/platform.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export async function ensureAudioTools(root){
  const manifest=JSON.parse(await fs.readFile(path.join(root,'AUDIO_TOOLS_MANIFEST'+profile().manifestSuffix+'.json'),'utf8'));
  for(const [name,info] of Object.entries(manifest)){
    if(process.env[info.binary==='ffmpeg'?'FFMPEG_PATH':'FFPROBE_PATH'])continue;
    const target=path.join(root,'node_modules',name);
    if(await fs.access(path.join(target,info.binary+profile().suffix)).then(()=>true,()=>false))continue;
    console.log(`首次启动：正在准备 ${info.binary} 音频工具，请保持联网。`);
    const url=new URL(info.url);
    if(url.protocol!=='https:' || url.hostname!=='registry.npmjs.org')throw new Error('音频工具下载地址未通过校验。');
    const temporary=path.join(root,'node_modules',`.audio-tools-${crypto.randomUUID()}`);
    await fs.mkdir(temporary,{recursive:true});
    const archive=path.join(temporary,'package.tgz'),unpacked=path.join(temporary,'unpacked');
    try{
      const downloaded=spawnSync(systemTool('curl'),['--disable','--fail','--location','--retry','2','--connect-timeout','15','--max-time','180','--proto','=https','--proto-redir','=https',info.url,'--output',archive],{windowsHide:true,stdio:'inherit'});
      if(downloaded.status!==0)throw new Error('音频工具下载失败，请检查网络后重新启动。');
      const hash=crypto.createHash('sha512').update(await fs.readFile(archive)).digest('base64');
      if(`sha512-${hash}`!==info.integrity)throw new Error('音频工具完整性校验失败，未安装。');
      const listing=spawnSync(systemTool('tar'),['-tzf',archive],{encoding:'utf8'});
      if(listing.status!==0 || listing.stdout.split('\n').filter(Boolean).some(p=>!p.startsWith('package/') || p.split('/').includes('..')))throw new Error('音频工具压缩包路径无效。');
      await fs.mkdir(unpacked);
      const extracted=spawnSync(systemTool('tar'),['-xzf',archive,'-C',unpacked,'--strip-components=1'],{windowsHide:true,stdio:'inherit'});
      if(extracted.status!==0)throw new Error('音频工具解压失败。');
      await fs.access(path.join(unpacked,info.binary+profile().suffix));
      await fs.chmod(path.join(unpacked,info.binary+profile().suffix),0o755);
      await fs.mkdir(path.dirname(target),{recursive:true});
      await fs.rm(target,{recursive:true,force:true});
      await fs.rename(unpacked,target);
    }finally{await fs.rm(temporary,{recursive:true,force:true});}
  }
}
