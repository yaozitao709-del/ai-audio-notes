import test from "node:test";
import assert from "node:assert/strict";

import { applySpeakerAssignments } from "./liveSpeaker.js";


test("applies speaker corrections by utterance id", () => {
  const transcript = [
    { lineId: "live-0", utteranceId: 0, speaker: "讲话人1", text: "第一句" },
    { lineId: "live-1", utteranceId: 1, speaker: "讲话人1", text: "第二句" }
  ];

  const result = applySpeakerAssignments(transcript, [
    { utteranceId: 0, speaker: "讲话人1" },
    { utteranceId: 1, speaker: "讲话人2" }
  ]);

  assert.equal(result[0].speaker, "讲话人1");
  assert.equal(result[1].speaker, "讲话人2");
  assert.equal(result[1].text, "第二句");
});

test("ignores malformed or unrelated corrections", () => {
  const transcript = [{ lineId: "live-0", utteranceId: 0, speaker: "讲话人1", text: "内容" }];
  const result = applySpeakerAssignments(transcript, [
    { utteranceId: 9, speaker: "讲话人2" },
    { utteranceId: 0, speaker: "" }
  ]);

  assert.deepEqual(result, transcript);
});
