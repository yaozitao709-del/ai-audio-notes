import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
await fs.mkdir(path.join(root,'build/server'),{recursive:true});
await build({absWorkingDir:root,entryPoints:['server/index.js','server/asr-worker.js'],outdir:'build/server',bundle:true,platform:'node',format:'esm',target:'node26',minify:true,legalComments:'external',sourcemap:false,
  external:['@ffmpeg-installer/*','@ffprobe-installer/*','sherpa-onnx-darwin-arm64','sherpa-onnx-darwin-x64','sherpa-onnx-linux-x64','sherpa-onnx-linux-arm64','sherpa-onnx-win-x64','sherpa-onnx-win-ia32'],
  banner:{js:'import {createRequire as __makeRequire} from "node:module"; import {fileURLToPath as __filePath} from "node:url"; import {dirname as __dirPath} from "node:path"; const require=__makeRequire(import.meta.url); const __filename=__filePath(import.meta.url); const __dirname=__dirPath(__filename);'},logLevel:'info'});
