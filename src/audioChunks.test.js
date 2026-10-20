import test from "node:test";
import assert from "node:assert/strict";
import { RollingSpeechChunker } from "./audioChunks.js";

function samples(count, level) {
  return new Float32Array(count).fill(level);
}

test("emits provisional text every second and finalizes after silence", () => {
  const chunks = [];
  const chunker = new RollingSpeechChunker({ sampleRate: 100, onChunk: (chunk) => chunks.push(chunk) });
  for (let index = 0; index < 12; index += 1) chunker.push(samples(10, 0.1));
  for (let index = 0; index < 8; index += 1) chunker.push(samples(10, 0));

  assert.equal(chunks[0].utteranceId, 0);
  assert.equal(chunks[0].final, false);
  assert.equal(chunks.at(-1).utteranceId, 0);
  assert.equal(chunks.at(-1).final, true);
  assert.equal(String.fromCharCode(...new Uint8Array(chunks[0].wav, 0, 4)), "RIFF");
});

test("flush finalizes only the active utterance", () => {
  const chunks = [];
  const chunker = new RollingSpeechChunker({ sampleRate: 100, onChunk: (chunk) => chunks.push(chunk) });
  chunker.push(samples(50, 0));
  chunker.flush();
  assert.equal(chunks.length, 0);

  const spokenChunks = [];
  const spoken = new RollingSpeechChunker({ sampleRate: 100, onChunk: (chunk) => spokenChunks.push(chunk) });
  spoken.push(samples(30, 0.1));
  spoken.flush();
  spoken.flush();
  assert.equal(spokenChunks.length, 1);
  assert.equal(spokenChunks[0].final, true);
});
