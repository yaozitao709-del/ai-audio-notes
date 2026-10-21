import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeakerDiarizer} from './speaker-diarizer.js';

// Optional private regression recording; never check user audio into source control.
// These interior anchors are far from the opening interview's turn boundaries:
// interviewer question (8s), answer (35s), follow-up (46s), answer (70s).
// Reverting to average-linkage forced to two clusters merges all four anchors.
test('real interview keeps recurring question and answer voices distinct despite outliers',
  {skip:!process.env.SPEAKER_REGRESSION_WAV,timeout:180000},async t=>{
    const engine=new SpeakerDiarizer();t.after(()=>engine.close());
    const result=await engine.diarize(process.env.SPEAKER_REGRESSION_WAV,{speakerCount:2});
    const at=seconds=>{const turn=result.turns.find(r=>r.start<=seconds&&r.end>seconds);assert.ok(turn,`missing speech at ${seconds}s`);return turn.spk;};
    assert.equal(at(8),at(46),'the interviewer must keep one identity');
    assert.equal(at(35),at(70),'the respondent must keep one identity');
    assert.notEqual(at(8),at(35),'two normal voices must not be merged while an outlier takes speaker 2');
    assert.equal(result.speakerCount,2);
  });
