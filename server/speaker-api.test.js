import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {ffmpegPath} from './audio-tools.js';

test('speaker API runs real audio clustering for imports/live/reprocessing and exports actual labels', {timeout:180000},async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'speaker-api-'));
  const examples=path.join(process.env.SPEAKER_MODEL_ROOT || path.resolve('models/speakers'),'speech_campplus_sv_zh-cn_16k-common/examples');
  const audio=path.join(folder,'aba.wav');
  const concat=spawnSync(ffmpegPath,['-v','error','-y','-i',path.join(examples,'speaker1_a_cn_16k.wav'),'-i',path.join(examples,'speaker2_a_cn_16k.wav'),'-i',path.join(examples,'speaker1_b_cn_16k.wav'),'-filter_complex','[0:a]apad=pad_len=6400[a];[1:a]apad=pad_len=6400[b];[a][b][2:a]concat=n=3:v=0:a=1[out]','-map','[out]','-ar','16000','-ac','1',audio]);
  assert.equal(concat.status,0,concat.stderr.toString());
  let summaries=0;
  const ai=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);let payload;
    if(body.messages[0].content.includes('context-edits-')){
      const input=JSON.parse(body.messages.at(-1).content);payload={reviewed_ids:input.body.map(r=>r.id),edits:[],uncertain:[]};
    }else{summaries++;payload={keywords:['公开测试'],summaryLead:'公开音频测试',summaryItems:[{title:'验证',content:'使用本机音频验证'}],chapters:[{startTime:'00:00:00',title:'验证',summary:'音频测试'}]};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]}));
  });
  ai.listen(0,'127.0.0.1');await once(ai,'listening');
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const server=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),AI_AUDIO_DATA_ROOT:path.join(folder,'data'),SPEAKER_DIARIZATION:'true',DEEPSEEK_API_KEY:'speaker-fixture',DEEPSEEK_BASE_URL:`http://127.0.0.1:${ai.address().port}`},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  t.after(async()=>{server.kill();await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);server.kill('SIGKILL');await new Promise(resolve=>ai.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const request=async(route,options)=>{const r=await fetch(base+route,options);assert.ok(r.ok,await r.clone().text());return r.json();};
  for(let i=0;i<100;i++){try{await request('/api/health');break;}catch{await delay(100);}}
  const wav=await fs.readFile(audio);
  const form=()=>{const data=new FormData();data.append('audio',new Blob([wav],{type:'audio/wav'}),'public-aba.wav');return data;};
  const done=async id=>{for(let i=0;i<1000;i++){const {note}=await request('/api/notes/'+id);if(note.status==='failed')assert.fail(note.error+'\n'+logs);if(note.status==='done')return note;await delay(100);}assert.fail('Timed out');};
  const imported=await request('/api/notes/import',{method:'POST',body:form()});
  const first=await done(imported.note.id);
  assert.equal(first.speakerRecognition.status,'done');assert.equal(first.speakerCount,2);
  assert.equal(new Set(first.transcript.map(r=>r.speaker)).size,2);
  assert.ok(first.transcript.every(r=>Number.isFinite(r.startSeconds)&&Number.isFinite(r.endSeconds)));
  const live=form();live.append('transcript',JSON.stringify([{speaker:'讲话人1',startTime:'00:00:00',text:'这是不会被用作真实分人结果的占位文字。'}]));
  const finalized=await request('/api/notes/live-finalize',{method:'POST',body:live});const second=await done(finalized.note.id);
  assert.equal(second.speakerCount,2);assert.ok(!second.transcript.some(r=>r.text.includes('占位文字')));
  const filename=path.join(folder,'data/notes',first.id+'.json');const saved=JSON.parse(await fs.readFile(filename,'utf8'));saved.summaryRequested=false;await fs.writeFile(filename,JSON.stringify(saved));
  const summariesBefore=summaries;
  await request('/api/notes/'+first.id+'/speakers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({speakerCount:2})});
  const reviewed=await done(first.id);assert.equal(reviewed.speakerCount,2);assert.equal(summaries,summariesBefore,'no summary requested');assert.equal(reviewed.speakerBackupPath,undefined);
  assert.equal(reviewed.summaryLead,first.summaryLead);assert.equal(reviewed.summaryIsStale,true);
  const backups=await fs.readdir(path.join(folder,'data/backups'));assert.ok(backups.some(name=>name.startsWith(first.id)));
  const exported=await fetch(base+'/api/notes/'+first.id+'/export/txt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:{showSpeaker:true,showTimestamp:true}})});
  const text=await exported.text();assert.ok(text.includes('讲话人1'));assert.ok(text.includes('讲话人2'));assert.match(text,/\d+:\d\d/);
  assert.ok(reviewed.transcript.every(row=>text.includes(row.text)));
});
