import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { streamAudio, probeAudioDuration } from "./audio-tools.js";

const require = createRequire(import.meta.url);
const sampleRate = 16000;
const frameSize = 1600;

export class ParaformerCore {
  constructor(modelDir) {
    for (const name of ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"]) {
      if (!fs.existsSync(path.join(modelDir, name))) throw new Error(`快速转写模型文件不存在：${path.join(modelDir, name)}`);
    }
    const { OnlineRecognizer } = require("sherpa-onnx-node");
    const started = performance.now();
    this.recognizer = new OnlineRecognizer({
      featConfig: { sampleRate, featureDim: 80 },
      modelConfig: {
        paraformer: { encoder: path.join(modelDir, "encoder.int8.onnx"), decoder: path.join(modelDir, "decoder.int8.onnx") },
        tokens: path.join(modelDir, "tokens.txt"), numThreads: 2, provider: "cpu", debug: false
      },
      decodingMethod: "greedy_search", maxActivePaths: 4,
      enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20
    });
    this.loadSeconds = (performance.now() - started) / 1000;
    this.sessions = new Map();
  }

  decode(stream, readResult = true) {
    while (this.recognizer.isReady(stream)) this.recognizer.decode(stream);
    return readResult ? (this.recognizer.getResult(stream).text || "").trim() : "";
  }

  finish(stream) {
    // The online encoder needs right context. inputFinished alone truncates the tail.
    stream.acceptWaveform({ samples: new Float32Array(sampleRate), sampleRate });
    stream.inputFinished();
    return this.decode(stream);
  }

  async transcribeFile(audioPath) {
    const started = performance.now();
    const stream = this.recognizer.createStream();
    const sentences = [];
    let seen = 0, segmentStart = 0, emittedCharacters = 0, nextSnapshot = sampleRate * 20;
    const append = (fullText, end, final = false) => {
      // Defer a trailing English token: its final BPE piece may arrive in the next chunk.
      let stableText = fullText;
      if (!final && /[a-z0-9]$/i.test(stableText)) {
        const wordStart = stableText.lastIndexOf(" ");
        stableText = wordStart < 0 ? "" : stableText.slice(0, wordStart);
      }
      const text = stableText.slice(emittedCharacters).trim();
      if (text) {
        const previous = sentences.at(-1);
        if (final && previous && end <= segmentStart + 0.001) {
          // EOF may fall exactly on a snapshot; keep its tail seekable.
          previous.text += ` ${text}`;
          previous.clean_text = previous.text;
          previous.end = end;
        } else {
          sentences.push({ start: segmentStart, end, text, clean_text: text });
        }
        emittedCharacters = stableText.length;
        segmentStart = end;
      }
    };
    const duration = await streamAudio(audioPath, samples => {
      for (let offset = 0; offset < samples.length; offset += frameSize) {
        const frame = samples.subarray(offset, offset + frameSize);
        stream.acceptWaveform({ samples: frame, sampleRate });
        seen += frame.length;
        this.decode(stream, false);
        if (seen >= nextSnapshot) {
          append((this.recognizer.getResult(stream).text || "").trim(), seen / sampleRate);
          nextSnapshot = seen + sampleRate * 20;
        }
      }
    });
    // Never reset a file stream at an endpoint: that discards pending predictor
    // state and right context (e.g. "monday" becomes "mon"). Snapshot paragraphs
    // instead, then flush once at EOF. These are audio-block, not word timestamps.
    append(this.finish(stream), duration, true);
    return {
      model: "Paraformer streaming int8 (sherpa-onnx)",
      time_unit: "seconds", timestamp_granularity: "audio-block", device: "cpu", duration_s: duration,
      elapsed_s: (performance.now() - started) / 1000,
      text: sentences.map(s => s.text).join("\n"), sentence_info: sentences
    };
  }

  async transcribeTurns(audioPath, turns) {
    const started=performance.now();
    const duration=await probeAudioDuration(audioPath);
    if(!Array.isArray(turns))throw new Error('讲话人片段格式无效。');
    let previous=0;
    const parts=[];
    for(const turn of turns){
      if(!Number.isFinite(turn.start)||!Number.isFinite(turn.end)||turn.start<previous-.001||turn.start<0||turn.end<=turn.start||!Number.isSafeInteger(turn.spk)||turn.spk<0)throw new Error('讲话人片段时间或编号无效。');
      if(turn.end>duration+.03)throw new Error('讲话人片段超出音频时长。');
      // Bound recognizer state and paragraph length while preserving real audio positions.
      for(let start=turn.start;start<turn.end-.001;start+=20)parts.push({...turn,start,end:Math.min(turn.end,start+20)});
      previous=turn.end;
    }
    const sentences=[];let index=0,seen=0,stream;
    const finish=()=>{
      const part=parts[index],text=this.finish(stream);
      if(text)sentences.push({start:part.start,end:part.end,spk:part.spk,text,clean_text:text});
      stream=null;index++;
    };
    if(parts.length)await streamAudio(audioPath,samples=>{
      const left=seen,right=seen+samples.length;
      while(index<parts.length){
        const part=parts[index],start=Math.round(part.start*sampleRate),end=Math.round(part.end*sampleRate);
        if(start>=right)break;
        if(end<=left){if(stream)finish();else index++;continue;}
        stream ||= this.recognizer.createStream();
        const selected=samples.subarray(Math.max(0,start-left),Math.min(samples.length,end-left));
        for(let offset=0;offset<selected.length;offset+=frameSize){stream.acceptWaveform({samples:selected.subarray(offset,offset+frameSize),sampleRate});this.decode(stream,false);}
        if(end<=right)finish();else break;
      }
      seen=right;
    });
    if(stream)finish();
    return {model:'Paraformer streaming int8',time_unit:'seconds',timestamp_granularity:'speaker-turn',device:'cpu',duration_s:duration,elapsed_s:(performance.now()-started)/1000,text:sentences.map(s=>s.text).join('\n'),sentence_info:sentences};
  }

  transcribeLive({ sessionId, utteranceId, sequence, startSeconds, samples, final, sampleRate: rate = 16000 }) {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 160 || !Number.isSafeInteger(utteranceId) || utteranceId < 0 || !Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(startSeconds) || startSeconds < 0 || typeof final !== "boolean") {
      throw new Error("实时转写请求参数无效。");
    }
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > sampleRate * 35 || rate !== sampleRate || samples.some(x => !Number.isFinite(x))) throw new Error("实时音频必须是 16kHz、最多 35 秒的有效采样。");
    const now = Date.now();
    for (const [id, session] of this.sessions) if (now - session.touched > 300_000) this.sessions.delete(id);
    let session = this.sessions.get(sessionId);
    if (!session) {
      if (this.sessions.size >= 32) throw new Error("同时录音会话过多，请结束旧录音后重试。");
      session = { utterances: new Map(), touched: now };
      this.sessions.set(sessionId, session);
    }
    session.touched = now;
    let state = session.utterances.get(utteranceId);
    if (!state) {
      if (session.utterances.size >= 256) session.utterances.delete(session.utterances.keys().next().value);
      state = { stream: this.recognizer.createStream(), seen: 0, sequence: -1, final: false, startSeconds };
      session.utterances.set(utteranceId, state);
    }
    if (sequence === state.sequence) return state.result;
    if (state.final) throw new Error("这句话已结束，请开始新的一句话。");
    if (sequence < state.sequence || samples.length < state.seen || startSeconds !== state.startSeconds) throw new Error("实时请求已过期或音频被缩短。");
    const delta = samples.subarray(state.seen);
    for (let offset = 0; offset < delta.length; offset += frameSize) {
      state.stream.acceptWaveform({ samples: delta.subarray(offset, offset + frameSize), sampleRate });
      this.decode(state.stream);
    }
    state.seen = samples.length;
    const text = final ? this.finish(state.stream) : this.decode(state.stream);
    state.sequence = sequence;
    state.final = final;
    state.result = { sessionId, sequence, utteranceId, startSeconds, text, final, speaker: "讲话人1", speakerStatus: "disabled", speakerAssignments: [] };
    if (final) state.stream = null;
    return state.result;
  }

  clearSession(sessionId) { this.sessions.delete(sessionId); return { ok: true }; }
}
