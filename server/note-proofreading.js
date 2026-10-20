import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROOFREAD_POLICY } from './proofreading.js';

export const transcriptHash = transcript => crypto.createHash('sha256').update(JSON.stringify(transcript)).digest('hex');

async function saveJson(filename, payload) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(payload, null, 2));
  await fs.rename(temp, filename);
}

export async function proofreadNote(note, { rawTranscript, engine, directory, updateNote, termFixes = [] }) {
  if (!rawTranscript && note.transcriptEditedAt) return note;
  if (!rawTranscript && note.proofreading?.status === 'done' && note.proofreading.policy === PROOFREAD_POLICY && note.proofreading.model === engine.model && note.proofreading.configurationId === engine.configurationId && note.proofreading.outputHash === transcriptHash(note.transcript)) return note;
  if (!rawTranscript && note.rawTranscriptPath) rawTranscript = JSON.parse(await fs.readFile(note.rawTranscriptPath, 'utf8')).transcript;
  // An explicit regeneration of a legacy note starts from its saved current text,
  // with an immutable snapshot; it never reruns ASR or batch-edits other history.
  if (!rawTranscript && Array.isArray(note.transcript)) rawTranscript = note.transcript;
  if (!rawTranscript) return note;
  if (!Array.isArray(rawTranscript) || !rawTranscript.length) throw new Error('没有可校对的完整转写。');
  const rawHash = transcriptHash(rawTranscript);
  const rawPath = path.join(directory, `${note.id}.${rawHash}.raw.json`);
  try { await fs.access(rawPath); } catch { await saveJson(rawPath, { transcript: rawTranscript, hash: rawHash }); }
  note = await updateNote(note.id, { rawTranscriptPath: rawPath, status: 'proofreading', failedStage: '', error: '', summaryLead: '正在结合上下文校对并轻度整理全文。', proofreading: { status: 'running', model: engine.model, completed: 0, total: 0 } });
  const input = rawTranscript.map(line => ({ ...line, text: termFixes.reduce((text, fix) => text.replaceAll(fix.from, fix.to), line.text) }));
  let progress = Promise.resolve();
  const result = await engine.proofread(input, { title: note.title, termFixes, onProgress: info => {
    progress = progress.then(() => updateNote(note.id, { proofreading: { status: 'running', model: engine.model, ...info } }));
    return progress;
  }});
  const outputHash = transcriptHash(result.transcript);
  const resultPath = path.join(directory, `${note.id}.${result.inputHash}.corrected.json`);
  await saveJson(resultPath, { ...result, outputHash, rawTranscriptPath: rawPath, createdAt: new Date().toISOString() });
  return updateNote(note.id, {
    transcript: result.transcript, proofreadingPath: resultPath, status: 'summarizing', failedStage: '',
    summaryLead: '全文已校对整理，正在生成总结。',
    proofreading: { status: 'done', model: result.model, version: result.version, policy: result.policy, configurationId:result.configurationId, inputHash: result.inputHash, outputHash,
      elapsedSeconds: result.elapsedSeconds, appliedCount: result.applied.length, rejectedCount: result.rejected.length,
      uncertain: result.uncertain.slice(0, 100), completed: result.chunks.length, total: result.chunks.length, completedAt: new Date().toISOString(), chunks: result.chunks },
    modelInfo: { ...note.modelInfo, proofreading: result.model }
  });
}
