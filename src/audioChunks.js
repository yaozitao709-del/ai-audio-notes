export const LIVE_UPDATE_SECONDS = 1;
export const LIVE_SILENCE_SECONDS = 0.75;
const OUTPUT_SAMPLE_RATE = 16000;

function downsample(input, inputRate) {
  if (inputRate === OUTPUT_SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputRate / OUTPUT_SAMPLE_RATE;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) total += input[cursor];
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, OUTPUT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  });
  return buffer;
}

function concat(left, right) {
  const result = new Float32Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function rms(samples) {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) total += samples[index] ** 2;
  return Math.sqrt(total / Math.max(1, samples.length));
}

export class RollingSpeechChunker {
  constructor({
    sampleRate,
    onChunk,
    updateSeconds = LIVE_UPDATE_SECONDS,
    silenceSeconds = LIVE_SILENCE_SECONDS,
    speechThreshold = 0.006,
    maxUtteranceSeconds = 20
  }) {
    this.sampleRate = sampleRate;
    this.onChunk = onChunk;
    this.updateFrames = Math.round(updateSeconds * sampleRate);
    this.silenceFramesRequired = Math.round(silenceSeconds * sampleRate);
    this.speechThreshold = speechThreshold;
    this.maxUtteranceFrames = Math.round(maxUtteranceSeconds * sampleRate);
    this.buffer = new Float32Array(0);
    this.totalFrames = 0;
    this.utteranceStartFrame = 0;
    this.utteranceId = 0;
    this.sequence = 0;
    this.framesSinceEmit = 0;
    this.silenceFrames = 0;
    this.speechActive = false;
    this.flushed = false;
  }

  push(samples) {
    if (this.flushed || !samples.length) return;
    const level = rms(samples);
    if (!this.speechActive) {
      if (level < this.speechThreshold) {
        this.totalFrames += samples.length;
        return;
      }
      this.speechActive = true;
      this.utteranceStartFrame = this.totalFrames;
      this.buffer = new Float32Array(0);
      this.framesSinceEmit = 0;
      this.silenceFrames = 0;
    }

    this.buffer = concat(this.buffer, samples);
    this.framesSinceEmit += samples.length;
    this.silenceFrames = level < this.speechThreshold ? this.silenceFrames + samples.length : 0;
    this.totalFrames += samples.length;

    if (this.silenceFrames >= this.silenceFramesRequired || this.buffer.length >= this.maxUtteranceFrames) {
      this.emit(true);
      this.resetUtterance();
      return;
    }
    if (this.framesSinceEmit >= this.updateFrames) {
      this.emit(false);
      this.framesSinceEmit = 0;
    }
  }

  flush() {
    if (this.flushed) return;
    this.flushed = true;
    if (this.speechActive && this.buffer.length) this.emit(true);
    this.resetUtterance();
  }

  emit(final) {
    this.onChunk({
      sequence: this.sequence,
      utteranceId: this.utteranceId,
      startSeconds: this.utteranceStartFrame / this.sampleRate,
      wav: encodeWav(downsample(this.buffer, this.sampleRate)),
      final
    });
    this.sequence += 1;
  }

  resetUtterance() {
    this.buffer = new Float32Array(0);
    this.framesSinceEmit = 0;
    this.silenceFrames = 0;
    this.speechActive = false;
    this.utteranceId += 1;
  }
}
