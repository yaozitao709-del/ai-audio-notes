import test from "node:test";
import assert from "node:assert/strict";

import { clearAsrSession, transcribeChunk } from "./asrClient.js";


test("transcribeChunk preserves live speaker fields", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.fetch = async () => new Response(JSON.stringify({
    text: "内容",
    utteranceId: 1,
    speaker: "讲话人2",
    speakerStatus: "ready",
    speakerAssignments: [{ utteranceId: 1, speaker: "讲话人2" }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const result = await transcribeChunk({
      sessionId: "note-1",
      sequence: 1,
      utteranceId: 1,
      startSeconds: 2,
      wav: new ArrayBuffer(64),
      final: true
    });
    assert.equal(result.speaker, "讲话人2");
    assert.deepEqual(result.speakerAssignments, [{ utteranceId: 1, speaker: "讲话人2" }]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("clearAsrSession deletes the encoded session", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(null, { status: 200 });
  };
  try {
    assert.equal(await clearAsrSession("live/a b"), true);
    assert.equal(captured.url, "http://127.0.0.1:8787/api/asr/sessions/live%2Fa%20b");
    assert.equal(captured.options.method, "DELETE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
