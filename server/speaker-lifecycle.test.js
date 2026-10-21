import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeakerDiarizer} from './speaker-diarizer.js';

test('missing speaker runtime fails explicitly without pretending a single-speaker result',async t=>{
  const original=process.env.SPEAKER_PYTHON;
  process.env.SPEAKER_PYTHON='/not-installed/speaker-python';
  t.after(()=>{if(original===undefined)delete process.env.SPEAKER_PYTHON;else process.env.SPEAKER_PYTHON=original;});
  const engine=new SpeakerDiarizer();
  await assert.rejects(engine.diarize('/not-needed.wav'),/讲话人模型服务不可用/);
  assert.equal(engine.child,null);assert.equal(engine.pending.size,0);
});
