import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SpeakerAsr } from "./speaker-asr.js";
import { ffmpegPath } from "./audio-tools.js";

const toolRoot = process.env.AI_TOOL_ROOT || path.join(os.homedir(), "AI本地工具");
const examples = path.join(process.env.SPEAKER_MODEL_ROOT || path.resolve('models/speakers'), 'speech_campplus_sv_zh-cn_16k-common/examples');
const sample = name => path.join(examples, `${name}_cn_16k.wav`);

test("hybrid recognizes A/B/A voices with Paraformer and reuses only VAD/CAM++", { timeout: 120_000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hybrid-asr-test-"));
  const engine = new SpeakerAsr();
  t.after(async () => { await engine.close(); await fs.rm(dir, { force: true, recursive: true }); });
  const audio = path.join(dir, "a-b-a.wav");
  const concat = spawnSync(ffmpegPath, ["-v", "error", "-y", "-i", sample("speaker1_a"), "-i", sample("speaker2_a"), "-i", sample("speaker1_b"),
    "-filter_complex", "[0:a]apad=pad_dur=0.4[a0];[1:a]apad=pad_dur=0.4[a1];[a0][a1][2:a]concat=n=3:v=0:a=1[out]", "-map", "[out]", "-ac", "1", "-ar", "16000", audio]);
  assert.equal(concat.status, 0, concat.stderr.toString());
  const result = await engine.transcribeFile(audio);
  assert.match(result.model, /Paraformer.*CAM/);
  assert.equal(result.time_unit, "seconds");
  assert.ok(result.text.trim());
  assert.equal(new Set(result.sentence_info.map(s => s.spk)).size, 2);
  const nearest = time => result.sentence_info.reduce((a, b) => Math.abs((a.start + a.end) / 2 - time) < Math.abs((b.start + b.end) / 2 - time) ? a : b).spk;
  assert.equal(nearest(1.8), nearest(12));
  assert.notEqual(nearest(1.8), nearest(6.7));
  assert.ok(result.sentence_info.every(s => s.end >= s.start && s.end <= result.duration_s + 0.02 && s.clean_text));
  for (let i = 1; i < result.sentence_info.length; i++) assert.ok(result.sentence_info[i].start >= result.sentence_info[i - 1].end - 0.001);
  const health = await engine.diarizer.health();
  assert.deepEqual(health.models, ["FSMN-VAD", "CAM++"]);
  const pid = engine.diarizer.child.pid;
  const again = await engine.transcribeFile(sample("speaker1_a"));
  assert.equal(new Set(again.sentence_info.map(s => s.spk)).size, 1);
  assert.equal(engine.diarizer.child.pid, pid);
  await assert.rejects(engine.fastAsr.transcribeTurns(audio, [{ start: 3, end: 1, spk: 0 }]), /片段/);
  await assert.rejects(engine.fastAsr.transcribeTurns(audio, [{ start: 0, end: 1000, spk: 0 }]), /超出|时长/);
  await assert.rejects(engine.transcribeFile("/does/not/exist.wav"), /解码|音频/);
  const silent = path.join(dir, "silent.wav");
  const silence = spawnSync(ffmpegPath, ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2", silent]);
  assert.equal(silence.status, 0);
  const empty = await engine.transcribeFile(silent);
  assert.equal(empty.text, "");
  assert.deepEqual(empty.sentence_info, []);
});
