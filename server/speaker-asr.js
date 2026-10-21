import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {FastAsr} from './fast-asr.js';
import {SpeakerDiarizer} from './speaker-diarizer.js';
import {ffmpegPath} from './audio-tools.js';

export class SpeakerAsr {
  constructor({fastAsr}={}){this.fastAsr=fastAsr || new FastAsr();this.ownsAsr=!fastAsr;this.diarizer=new SpeakerDiarizer();this.queue=Promise.resolve();}
  transcribeFile(audioPath,options={}){
    const result=this.queue.catch(()=>{}).then(()=>this.run(audioPath,options));this.queue=result;return result;
  }
  async run(audioPath,options){
    const started=performance.now();const folder=await fs.mkdtemp(path.join(os.tmpdir(),'audio-speakers-'));const wav=path.join(folder,'audio.wav');
    try{
      await new Promise((resolve,reject)=>{
        const child=spawn(ffmpegPath,['-v','error','-nostdin','-i',audioPath,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],{windowsHide:true});
        child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('分人音频解码失败，请检查音频文件。')));
      });
      options.onProgress?.({stage:'diarizing'});
      const analysis=await this.diarizer.diarize(wav,options);
      options.onProgress?.({stage:'transcribing'});
      const result=await this.fastAsr.transcribeTurns(wav,analysis.turns);
      return {...result,model:'Paraformer streaming int8 + FSMN-VAD + CAM++',speakerStatus:'done',speakerCount:analysis.speakerCount,
        diarization:{status:'done',models:analysis.models || ['FSMN-VAD','CAM++'],speakerCount:analysis.speakerCount,embeddingDevice:analysis.embeddingDevice,elapsedSeconds:analysis.elapsedSeconds},elapsed_s:(performance.now()-started)/1000};
    }finally{await fs.rm(folder,{recursive:true,force:true});}
  }
  async close(){await this.diarizer.close();if(this.ownsAsr)await this.fastAsr.close();}
}
