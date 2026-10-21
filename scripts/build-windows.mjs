import {packageSources} from './package-files.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run,checksum} from './lite-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [mode,output,cache]=process.argv.slice(2);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Build Windows packages on Windows x64.');
const parent=path.resolve(output),app=path.join(parent,mode==='lite'?'AI-Audio-Notes-Lite':'AI-Audio-Notes');
await fs.mkdir(app,{recursive:true});
const copy=async(src,dest)=>{await fs.mkdir(path.dirname(dest),{recursive:true});await fs.cp(src,dest,{recursive:true,dereference:true,filter:p=>!/(?:^|[\\/])(?:__pycache__|\.git)(?:[\\/]|$)|\.pyc$/.test(p)});};
if(mode==='lite'){
 const files=await packageSources(root);
 for(const name of files){
  if(/^(?:\.github\/|src\/|docs\/)|\.test\.(?:js|mjs)$|^\./.test(name)||name.endsWith('.command'))continue;
  await copy(path.join(root,name),path.join(app,name));
 }
 await copy(path.join(root,'build/server'),path.join(app,'server'));
 await copy(path.join(root,'dist'),path.join(app,'dist'));
 for(const name of ['@ffmpeg-installer/ffmpeg','@ffprobe-installer/ffprobe','sherpa-onnx-node'])await copy(path.join(root,'node_modules',name),path.join(app,'node_modules',name));
 if(!process.env.VC_REDIST_DIR)throw Error('VC_REDIST_DIR must identify the official Visual Studio x64 CRT redistribution directory.');
 await copy(process.env.VC_REDIST_DIR,path.join(app,'support-vc'));
 const hashes={};for(const f of await fs.readdir(path.join(app,'support-vc')))if(f.endsWith('.dll'))hashes[f]=await checksum(path.join(app,'support-vc',f));
 if(!hashes['msvcp140.dll']||!hashes['vcruntime140.dll'])throw Error('Incomplete app-local VC runtime.');
 await fs.writeFile(path.join(app,'support-vc','MANIFEST.json'),JSON.stringify({source:'Microsoft Visual Studio 2022 VC Redistributable (x64), app-local deployment',files:hashes},null,2));
 await fs.writeFile(path.join(app,'support-vc','NOTICE.txt'),'Microsoft Visual C++ runtime DLLs, distributed for use with this application. Copyright Microsoft Corporation.\nhttps://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files\n');
}else if(mode==='full'){
 const prepared=JSON.parse(await fs.readFile(path.join(cache,'environment.json'),'utf8'));
 await copy(path.join(parent,'AI-Audio-Notes-Lite'),app);
 await fs.rm(path.join(app,'node_modules', 'sherpa-onnx-win-x64'),{recursive:true,force:true});
 await copy(path.join(cache,'native/sherpa-onnx-win-x64-1.13.3'),path.join(app,'node_modules/sherpa-onnx-win-x64'));
 await copy(path.join(cache,'python-standalone/python'),path.join(app,'runtime/python'));
 await copy(path.join(cache,'speech-env/Lib/site-packages'),path.join(app,'runtime/python/Lib/site-packages'));
 await fs.rm(path.join(app,'runtime/python/Lib/site-packages/audio-notes-existing-env.pth'),{force:true});
 await copy(path.join(cache,'node-v26.11.1-win-x64/node.exe'),path.join(app,'runtime/node.exe'));
 await copy(prepared.models.PARAFORMER_MODEL_DIR,path.join(app,'models/paraformer-streaming'));
 await copy(prepared.models.SPEAKER_MODEL_ROOT,path.join(app,'models/speakers'));
 // Fixtures are test data, not application requirements.
 await fs.rm(path.join(app,'models/paraformer-streaming/test_wavs'),{recursive:true,force:true});
 await fs.rm(path.join(app,'models/speakers/speech_campplus_sv_zh-cn_16k-common/examples'),{recursive:true,force:true});
 for(const name of ['ffmpeg','ffprobe'])await copy(path.join(cache,'audio',`@${name}-installer/win32-x64`),path.join(app,'node_modules',`@${name}-installer/win32-x64`));
 for(const f of await fs.readdir(path.join(app,'support-vc')))if(f.endsWith('.dll'))for(const dest of ['runtime','runtime/python','node_modules/sherpa-onnx-win-x64'])await copy(path.join(app,'support-vc',f),path.join(app,dest,f));
 // Installer caches and external environment metadata must never ship.
 for(const folder of [path.join(app,'runtime/python/Lib/site-packages')]){
  for(const entry of await fs.readdir(folder))if(entry.endsWith('.dist-info'))await fs.rm(path.join(folder,entry,'direct_url.json'),{force:true});
 }
}else throw Error('Expected lite or full.');
await fs.writeFile(path.join(app,'BUNDLED_SERVER.json'),JSON.stringify({version:'0.4.0',distribution:mode,bundled:true,entries:['server/index.js','server/asr-worker.js']},null,2));
console.log(app);
