import {profile} from './platform.js';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export class SpeakerDiarizer {
  constructor() { this.pending=new Map();this.sequence=0; }
  async start() {
    if(this.ready)return this.ready;
    const python=process.env.SPEAKER_PYTHON || fileURLToPath(new URL('../runtime/python/'+profile().python,import.meta.url));
    const child=this.child=spawn(python,['-X','utf8','-u',fileURLToPath(new URL('./speaker_worker.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.ready=new Promise((resolve,reject)=>{
      const fail=()=>{
        if(this.child!==child)return;
        clearTimeout(startup);
        const error=new Error('讲话人模型服务不可用，请检查轻量模型和本机 Python 环境。');
        reject(error);for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();this.child=null;this.ready=null;
      };
      child.on('error',fail);child.on('exit',fail);
      child.stderr.on('data',()=>{}); // Libraries can emit private paths; do not print their bodies.
      const startup=setTimeout(()=>{child.kill();fail();},60000);
      readline.createInterface({input:child.stdout}).on('line',line=>{
        let value;try{value=JSON.parse(line);}catch{return;}
        if(value.ready){clearTimeout(startup);resolve(value);return;}
        const request=this.pending.get(value.id);if(!request)return;
        if(value.progress){request.onProgress?.(value.progress);return;}
        clearTimeout(request.timer);this.pending.delete(value.id);
        value.error?request.reject(new Error(value.error)):request.resolve(value.result);
      });
      child.once('exit',()=>clearTimeout(startup));
    });
    return this.ready;
  }
  async request(method,payload,onProgress) {
    await this.start();
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>{this.child?.kill();reject(new Error('讲话人区分超时，原音已保留，请重试。'));},30*60000);
      this.pending.set(id,{resolve,reject,timer,onProgress});
      this.child.stdin.write(JSON.stringify({id,method,payload})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
    });
  }
  health(){return this.request('health');}
  diarize(audioPath,{speakerCount,onProgress}={}){return this.request('diarize',{audioPath,speakerCount},onProgress);}
  async close(){const child=this.child;if(!child)return;child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();});}
}
