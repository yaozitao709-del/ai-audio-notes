import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export const ffmpegPath = process.env.FFMPEG_PATH || require("@ffmpeg-installer/ffmpeg").path;
export const ffprobePath = process.env.FFPROBE_PATH || require("@ffprobe-installer/ffprobe").path;

export async function probeAudioDuration(audioPath, { decodeIfUnknown = true } = {}) {
  const duration = await new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],{windowsHide:true});
    let out = "", error = "";
    child.stdout.on("data", data => { out += data; });
    child.stderr.on("data", data => { error = (error + data).slice(-3000); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(Math.max(0, Number.parseFloat(out) || 0)) : reject(new Error(`音频时长读取失败：${error}`)));
  });
  // Browser MediaRecorder WebM often has no duration in its container header.
  return duration > 0 || !decodeIfUnknown ? duration : streamAudio(audioPath, () => {});
}

// Stream decoded PCM; backpressure from synchronous recognition keeps memory bounded.
export async function streamAudio(audioPath, onSamples) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-v", "error", "-nostdin", "-i", audioPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],{windowsHide:true});
    let remaining = Buffer.alloc(0), error = "", sampleCount = 0, failed = false;
    child.stderr.on("data", data => { error = (error + data).slice(-3000); });
    child.stdout.on("data", data => {
      if (failed) return;
      try {
        const combined = Buffer.concat([remaining, data]);
        const length = combined.length - combined.length % 4;
        const samples = new Float32Array(length / 4);
        for (let i = 0; i < samples.length; i++) samples[i] = combined.readFloatLE(i * 4);
        remaining = Buffer.from(combined.subarray(length));
        sampleCount += samples.length;
        onSamples(samples);
      } catch (err) {
        failed = true;
        child.kill("SIGTERM");
        reject(err);
      }
    });
    child.on("error", reject);
    child.on("close", code => {
      if (failed) return;
      if (code !== 0 || remaining.length) return reject(new Error(`音频解码失败：${error || `exit ${code}`}`));
      resolve(sampleCount / 16000);
    });
  });
}

export async function decodeAudio(audioPath) {
  const chunks = [];
  let length = 0;
  await streamAudio(audioPath, samples => { chunks.push(samples); length += samples.length; });
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function decodeLiveWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("实时音频必须是有效的 16kHz 单声道 PCM WAV。");
  }
  let format, data;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error("WAV 音频内容不完整。");
    if (id === "fmt " && size >= 16) format = buffer.subarray(start, start + size);
    if (id === "data") data = buffer.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (!format || !data || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== 16000 || format.readUInt16LE(14) !== 16 || data.length % 2) {
    throw new Error("实时音频仅支持 16kHz、16 位、单声道 PCM WAV。");
  }
  if (!data.length || data.length > 16000 * 2 * 35) throw new Error("实时音频长度须在 0 到 35 秒之间。");
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return samples;
}
