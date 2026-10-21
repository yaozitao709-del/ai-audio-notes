import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { FastAsr, defaultModelDir } from "./fast-asr.js";
import { decodeAudio, ffmpegPath, probeAudioDuration } from "./audio-tools.js";
import { spawnSync } from "node:child_process";

const modelDir = process.env.PARAFORMER_MODEL_DIR || defaultModelDir;
const fixture = path.join(modelDir, "test_wavs/0.wav");

test("real Paraformer handles files, cumulative live snapshots and final tails", { timeout: 30_000 }, async (t) => {
  const engine = new FastAsr({ modelDir });
  t.after(() => engine.close());
  const payload = await engine.transcribeFile(fixture);
  assert.match(payload.text, /昨天/);
  assert.match(payload.text, /monday/);
  assert.match(payload.text, /星期三/);
  assert.ok(payload.sentence_info.length);
  assert.ok(payload.sentence_info.every(s => s.start >= 0 && s.end <= payload.duration_s && s.end >= s.start));
  assert.equal(payload.time_unit, "seconds");
  const samples = await decodeAudio(fixture);
  const base = { sessionId: "integration", utteranceId: 0, startSeconds: 3, sampleRate: 16000 };
  await engine.transcribeLive({ ...base, samples: samples.slice(0, 64000), sequence: 0, final: false });
  const result = await engine.transcribeLive({ ...base, samples, sequence: 1, final: true });
  assert.match(result.text, /昨天/);
  assert.match(result.text, /星期三/);
  assert.equal(result.startSeconds, 3);
  assert.equal(result.speakerStatus, "disabled");
  assert.equal(result.final, true);
  assert.deepEqual(await engine.transcribeLive({ ...base, samples, sequence: 1, final: true }), result);
  await assert.rejects(engine.transcribeLive({ ...base, samples: samples.slice(0, 32000), sequence: 2, final: false }), /已结束|过期|缩短/);
  await engine.clearSession(base.sessionId);
  const silent = await engine.transcribeLive({ ...base, samples: new Float32Array(16000), sequence: 3, final: true });
  assert.equal(silent.text, "");
  await assert.rejects(engine.transcribeFile("/does/not/exist.wav"), /音频|不存在|No such/);
  // A bad file must not poison the reusable worker.
  assert.equal((await engine.health()).status, "ready");
  // File paragraph boundaries must preserve the same words as a continuous live stream.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paraformer-boundary-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const longFile = path.join(dir, "three-utterances.wav");
  const converted = spawnSync(ffmpegPath, ["-v", "error", "-y", "-stream_loop", "2", "-i", fixture, "-t", "30", longFile]);
  assert.equal(converted.status, 0, converted.stderr.toString());
  const fileResult = await engine.transcribeFile(longFile);
  const liveResult = await engine.transcribeLive({ ...base, sessionId: "boundary-reference", samples: await decodeAudio(longFile), sequence: 0, final: true });
  assert.ok(fileResult.sentence_info.length >= 2);
  assert.equal(fileResult.text.replace(/\s/g, ""), liveResult.text.replace(/\s/g, ""));
  // EOF on a paragraph boundary must not put the flushed tail at an unplayable EOF timestamp.
  const exactFile = path.join(dir, "exact-20s.wav");
  const exact = spawnSync(ffmpegPath, ["-v", "error", "-y", "-stream_loop", "1", "-i", fixture, "-t", "20", exactFile]);
  assert.equal(exact.status, 0, exact.stderr.toString());
  const exactResult = await engine.transcribeFile(exactFile);
  assert.ok(exactResult.sentence_info.every(s => s.end > s.start), "EOF tail must remain in a playable paragraph");


});

test("FFmpeg decodes imported m4a and webm and reports their durations", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-notes-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const extension of ["m4a", "webm"]) {
    const dest = path.join(dir, `sample.${extension}`);
    const run = spawnSync(ffmpegPath, ["-v", "error", "-y", "-i", fixture, dest]);
    assert.equal(run.status, 0, run.stderr?.toString() || run.error?.message || "FFmpeg failed");
    assert.ok((await decodeAudio(dest)).length > 150000);
    const duration = await probeAudioDuration(dest);
    assert.ok(duration > 9.9 && duration < 10.3, `${extension}: ${duration}`);
  }
  const unseekable = spawnSync(ffmpegPath, ["-v", "error", "-i", fixture, "-f", "webm", "pipe:1"]);
  assert.equal(unseekable.status, 0, unseekable.stderr.toString());
  const recording = path.join(dir, "browser-recording.webm");
  await fs.writeFile(recording, unseekable.stdout);
  assert.equal(await probeAudioDuration(recording, { decodeIfUnknown: false }), 0);
  assert.ok(await probeAudioDuration(recording) > 9.9);
});


test("process transport preserves live typed arrays, relative audio paths and the parent working directory", {timeout:120000}, async t=>{
  const cwd=process.cwd(),engine=new FastAsr({modelDir,transport:'process'});
  t.after(()=>engine.close());
  const health=await engine.health();assert.equal(health.status,'ready');
  const result=await engine.transcribeFile(path.relative(cwd,fixture));assert.ok(result.text.trim());
  assert.equal(process.cwd(),cwd);
  const live=await engine.transcribeLive({sessionId:'process-ipc',utteranceId:0,startSeconds:0,sequence:0,samples:await decodeAudio(fixture),sampleRate:16000,final:true});
  assert.match(live.text,/昨天/);
  await engine.clearSession('process-ipc');
});
