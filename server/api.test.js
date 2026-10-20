import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { defaultModelDir } from "./fast-asr.js";

const fixture = path.join(process.env.PARAFORMER_MODEL_DIR || defaultModelDir, "test_wavs/0.wav");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("single fast engine handles imports, live, legacy retries and exports without Python", { timeout: 180_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-notes-api-"));
  let aiMode = "ok", releaseHold;
  const aiRequests = [];
  const aiServer = http.createServer(async (req, res) => {
    if(req.method==="GET" && req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'deepseek-flash',name:'Flash fixture'},{id:'custom-after-save'}]}));}
    let text = ""; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    const isProofread = body.messages[0].content.includes("context-edits-");
    const isConnection = body.messages[0].content.includes("JSON capability test");
    aiRequests.push({ kind: isConnection ? "connection" : isProofread ? "proofreading" : "summary", body });
    if (aiMode === "proofreading-wait" && isProofread) await new Promise(resolve => { releaseHold = resolve; });
    if ((aiMode === "proofreading-fail" && isProofread) || (aiMode === "summary-fail" && !isProofread)) {
      res.writeHead(503); return res.end("{}");
    }
    let payload;
    if (isProofread) {
      const input = JSON.parse(body.messages.at(-1).content);
      const edits = input.body.flatMap(row => {
        if (row.text.includes("我我我建议")) return [{ id: row.id, before: "我我我建议", after: "我建议", kind: "cleanup", cleanup_type: "stutter", reason: "清理无意义口吃" }];
        if (row.text.includes("越请晰")) return [{ id: row.id, before: "越请晰", after: "越清晰", kind: "typo", reason: "明确同音错词" }];
        if (row.text.includes("monday")) return [{ id: row.id, before: "monday", after: "Monday", kind: "typo", reason: "英文大小写" }];
        return [];
      });
      payload = { reviewed_ids: input.body.map(row => row.id), edits, uncertain: [] };
    } else payload = { keywords: ["本地测试"], summaryLead: "校对后的全文总结", summaryItems: [{ title: "测试", content: "根据校对全文生成" }], chapters: [{ startTime: "00:00:00", title: "测试", summary: "本地测试" }] };
    if(isConnection)payload={connection:"ok"};
    if (aiMode === "invalid-summary" && !isProofread) payload = {};
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: body.model, usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] }));
  });
  aiServer.listen(0, "127.0.0.1"); await once(aiServer, "listening");
  t.after(() => new Promise(resolve => aiServer.close(resolve)));

  const listener = net.createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), AI_AUDIO_DATA_ROOT: dir, DEEPSEEK_API_KEY: "local-test-key", DEEPSEEK_BASE_URL: `http://127.0.0.1:${aiServer.address().port}`, DEEPSEEK_PROOFREAD_MODEL: "test-proofreader", SENSEVOICE_PYTHON: "/not-installed/python", SENSEVOICE_SCRIPT: "/not-installed/asr.py" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  server.stdout.on("data", d => { logs += d; });
  server.stderr.on("data", d => { logs += d; });
  t.after(async () => {
    const exited = once(server, "exit"); server.kill("SIGTERM");
    await Promise.race([exited, delay(3000).then(() => server.kill("SIGKILL"))]);
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (url, options) => {
    const response = await fetch(`${base}${url}`, options);
    assert.ok(response.ok,`${url}: HTTP ${response.status}`);
    const payload = await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload;
  };
  let started = false;
  for (let i = 0; i < 600; i++) {
    try { await request("/api/health"); started = true; break; } catch { await delay(100); }
  }
  assert.ok(started, logs);
  assert.equal((await request("/api/asr/health")).status, "ready");
  const settings=(await request("/api/ai-settings")).settings;
  const malformed=await fetch(`${base}/api/ai-settings`,{method:"PUT",headers:{"Content-Type":"application/json"},body:'{"apiKey":"malformed-fixture-key", broken}'});
  assert.equal(malformed.status,400);
  assert.ok(!(await malformed.text()).includes('malformed-fixture-key'));
  assert.ok(!logs.includes('malformed-fixture-key'),'request bodies must never be logged');
  assert.equal(settings.hasApiKey,true);assert.equal(settings.apiKey,undefined);
  const discovered=await request('/api/ai-settings/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,model:'',apiKey:''})});
  assert.deepEqual(discovered.models.map(m=>m.id),['deepseek-flash','custom-after-save']);
  assert.deepEqual((await request('/api/ai-settings')).settings,settings,'fetching models must not save settings');
  const invalidSettings=await fetch(`${base}/api/ai-settings`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...settings,model:"",apiKey:""})});
  assert.equal(invalidSettings.status,400);
  assert.deepEqual((await request("/api/ai-settings")).settings,settings);
  const connection=await request("/api/ai-settings/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...settings,apiKey:""})});
  assert.equal(connection.ok,true);
  const forbidden=await fetch(`${base}/api/ai-settings`,{method:"PUT",headers:{"Content-Type":"application/json",Origin:"https://unrelated.example"},body:JSON.stringify({...settings,model:"unwanted-model",apiKey:""})});
  assert.equal(forbidden.status,403);
  assert.deepEqual((await request("/api/ai-settings")).settings,settings);
  const wav = await fs.readFile(fixture);
  const form = mode => {
    const data = new FormData(); data.append("audio", new Blob([wav], { type: "audio/wav" }), "测试录音.wav");
    if (mode) data.append("asrMode", mode);
    return data;
  };
  const waitForDone = async id => {
    for (let i = 0; i < 1000; i++) {
      const { note } = await request(`/api/notes/${id}`);
      if (note.status === "failed") assert.fail(`${note.error}\n${logs}`);
      if (note.status === "done") return note;
      await delay(100);
    }
    assert.fail(`transcription timed out\n${logs}`);
  };
  // Omitting the mode must use the fast default.
  const imported = await request("/api/notes/import", { method: "POST", body: form() });
  let note = await waitForDone(imported.note.id);
  assert.equal(note.asrMode, "fast");
  assert.equal(note.duration, "00:00:10");
  assert.match(note.transcript.map(s => s.text).join(""), /星期三/);
  assert.match(note.modelInfo.asr, /Paraformer/);
  assert.ok(note.asrElapsedSeconds > 0);
  assert.equal(note.proofreading.status, "done");
  assert.match(note.transcript.map(s => s.text).join(""), /Monday/);
  assert.equal(note.rawTranscriptPath, undefined);
  assert.match(aiRequests.find(r => r.kind === "summary").body.messages.at(-1).content, /Monday/);

  for (const type of ["txt", "json", "word"]) {
    const response = await fetch(`${base}/api/notes/${note.id}/export/${type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    const data = Buffer.from(await response.arrayBuffer());
    if (type === "word") assert.equal(data.subarray(0, 2).toString(), "PK");
    else assert.match(data.toString(), /星期三/);
  }
  const headers = { "Content-Type": "audio/wav", "X-Session-Id": "api-live", "X-Sequence": "0", "X-Utterance-Id": "0", "X-Start-Seconds": "0", "X-Final": "true" };
  const live = await request("/api/asr/transcribe", { method: "POST", headers, body: wav });
  assert.match(live.text, /星期三/);
  assert.equal(live.speakerStatus, "disabled");
  assert.equal((await request("/api/asr/sessions/api-live", { method: "DELETE" })).ok, true);
  const invalid = await fetch(`${base}/api/asr/transcribe`, { method: "POST", headers, body: "bad WAV" });
  assert.equal(invalid.status, 400);
  const preflight = await fetch(`${base}/api/asr/transcribe`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173", "Access-Control-Request-Headers": "X-Session-Id,X-Final" } });
  assert.match(preflight.headers.get("access-control-allow-headers"), /X-Session-Id/);
  // Empty live text still saves the actual recording and recovers using file ASR.
  const finalize = form("fast"); finalize.append("transcript", "[]");
  const saved = await request("/api/notes/live-finalize", { method: "POST", body: finalize });
  assert.equal((await waitForDone(saved.note.id)).asrMode, "fast");
  const partial = form("fast");
  partial.append("transcript", JSON.stringify([{ speaker: "讲话人1", startTime: "00:00:00", text: "部分识别内容" }]));
  partial.append("forceTranscription", "true");
  const recovered = await request("/api/notes/live-finalize", { method: "POST", body: partial });
  assert.match((await waitForDone(recovered.note.id)).transcript.map(s => s.text).join(""), /星期三/);
  // Cached clients may still send the removed mode. They must use the new engine.
  const original = await request("/api/notes/import", { method: "POST", body: form("sensevoice") });
  note = await waitForDone(original.note.id);
  assert.equal(note.asrMode, "fast");
  assert.match(note.modelInfo.asr, /Paraformer/);
  assert.match(note.transcript.map(s => s.text).join(""), /星期三/);

  // Actual old records retain their fields until the user explicitly retries.
  const legacyPath = path.join(dir, "notes", `${note.id}.json`);
  const legacy = JSON.parse(await fs.readFile(legacyPath, "utf8"));
  await fs.writeFile(legacyPath, JSON.stringify({ ...legacy, asrMode: "sensevoice", modelInfo: { ...legacy.modelInfo, asr: "SenseVoiceSmall + CAM++" } }));
  await request(`/api/notes/${note.id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal((await waitForDone(note.id)).asrMode, "fast");

  // Successful live text goes straight to summary, even from a cached old-mode page.
  const liveText = "已实时识别的内容，无需重复转写";
  const complete = form("sensevoice");
  complete.append("transcript", JSON.stringify([{ speaker: "讲话人1", startTime: "00:00:00", text: liveText }]));
  const finalized = await request("/api/notes/live-finalize", { method: "POST", body: complete });
  const reused = await waitForDone(finalized.note.id);
  assert.equal(reused.asrMode, "fast");
  assert.equal(reused.transcript[0].text, liveText);
  const storedLive = JSON.parse(await fs.readFile(path.join(dir, "notes", `${reused.id}.json`), "utf8"));
  assert.equal(storedLive.transcriptPath, undefined);
  await assert.rejects(fs.access(path.join(dir, "transcripts", `${reused.id}.paraformer.json`)), { code: "ENOENT" });
  assert.equal(reused.proofreading.status, "done");

  // Summary and all export formats must consume the cleaned full transcript.
  const cleanupText="我我我建议先试一下这个方案，可能不太适合一次完成，预算五千，不，三千，后续继续安排。";
  const cleanupForm=form();
  cleanupForm.append("transcript",JSON.stringify([{lineId:"cleanup-original",speaker:"讲话人1",startTime:"00:00:02",text:cleanupText}]));
  const cleanupNote=await request("/api/notes/live-finalize",{method:"POST",body:cleanupForm});
  const cleaned=await waitForDone(cleanupNote.note.id);
  assert.equal(cleaned.transcript[0].text,cleanupText.replace("我我我","我"));
  assert.equal(cleaned.transcript[0].startTime,"00:00:02");
  const summarySource=aiRequests.filter(r=>r.kind==="summary").at(-1).body.messages.at(-1).content;
  assert.ok(summarySource.includes(cleaned.transcript[0].text));
  assert.ok(!summarySource.includes("我我我"));
  const storedClean=JSON.parse(await fs.readFile(path.join(dir,"notes",`${cleaned.id}.json`),"utf8"));
  assert.equal(JSON.parse(await fs.readFile(storedClean.rawTranscriptPath,"utf8")).transcript[0].text,cleanupText);
  assert.ok(storedClean.proofreading.policy);
  for (const type of ["txt","json"]) {
    const response=await fetch(`${base}/api/notes/${cleaned.id}/export/${type}`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    assert.equal(response.status,200);const exported=await response.text();
    assert.ok(exported.includes(cleaned.transcript[0].text));assert.ok(!exported.includes("我我我"));
  }

  const failureForm = (extra = "") => {
    const data = form();
    data.append("transcript", JSON.stringify([{ speaker: "讲话人1", startTime: "00:00:00", text: "这份设备说明需要越请晰越好，后续保持29.9元价格，不改变任何安排。" + extra }]));
    return data;
  };
  const waitForFailure = async id => {
    for (let i=0; i<200; i++) {
      const { note } = await request(`/api/notes/${id}`);
      if (note.status === "failed") return note;
      if (note.status === "done") assert.fail("expected stage failure but incorrectly marked done");
      await delay(100);
    }
    assert.fail("expected stage failure");
  };
  aiMode = "proofreading-fail";
  const failedProof = await request("/api/notes/live-finalize", { method: "POST", body: failureForm() });
  let failed = await waitForFailure(failedProof.note.id);
  assert.equal(failed.failedStage, "proofreading");
  const beforeRetry = JSON.parse(await fs.readFile(path.join(dir,"notes",`${failed.id}.json`),"utf8"));
  assert.ok(beforeRetry.rawTranscriptPath);
  assert.equal(beforeRetry.transcriptPath, undefined);
  aiMode = "ok";
  await request(`/api/notes/${failed.id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const corrected = await waitForDone(failed.id);
  assert.match(corrected.transcript[0].text,/越清晰/);
  assert.match(aiRequests.filter(r=>r.kind==="summary").at(-1).body.messages.at(-1).content,/越清晰/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,"notes",`${failed.id}.json`),"utf8")).transcriptPath,undefined);

  aiMode = "summary-fail";
  const failedSummary = await request("/api/notes/live-finalize", { method: "POST", body: failureForm() });
  failed = await waitForFailure(failedSummary.note.id);
  assert.equal(failed.failedStage,"summarizing");
  assert.equal(failed.proofreading.status,"done");
  const proofCalls = aiRequests.filter(r=>r.kind==="proofreading").length;
  aiMode="ok";
  await request(`/api/notes/${failed.id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await waitForDone(failed.id);
  assert.equal(aiRequests.filter(r=>r.kind==="proofreading").length,proofCalls);
  // A manual edit is authoritative; regeneration must not run AI proofreading again.
  const manualText = "这是用户亲自保存的全文，保留29.9元价格，不允许自动改写。";
  await request(`/api/notes/${failed.id}/transcript`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: [{ speaker: "讲话人1", startTime: "00:00:00", text: manualText }] }) });
  const manual = await request(`/api/notes/${failed.id}/resummarize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(manual.note.transcript[0].text,manualText);
  assert.equal(manual.note.proofreading.status,"manual");
  assert.equal(aiRequests.filter(r=>r.kind==="proofreading").length,proofCalls);

  aiMode="proofreading-wait";
  const waiting = await request("/api/notes/live-finalize", { method: "POST", body: failureForm("这是并发编辑保护检查。") });
  for(let i=0;i<100&&!releaseHold;i++)await delay(20);
  assert.ok(releaseHold);
  try {
    const conflict=await fetch(`${base}/api/notes/${waiting.note.id}/transcript`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: [{ speaker:"讲话人1",startTime:"00:00:00",text:manualText }] }) });
    assert.equal(conflict.status,409);
    const changed=await request("/api/ai-settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...settings,provider:"openai-compatible",model:"custom-after-save",apiKey:"updated-local-test-key"})});
    assert.equal(changed.settings.model,"custom-after-save");
    assert.ok(!JSON.stringify(changed).includes("updated-local-test-key"));
  } finally { aiMode="ok";releaseHold(); }
  const completedWithSnapshot=await waitForDone(waiting.note.id);
  assert.equal(completedWithSnapshot.modelInfo.summary,"deepseek-flash");
  assert.equal(completedWithSnapshot.proofreading.model,"test-proofreader");
  const afterSave=await request("/api/notes/live-finalize",{method:"POST",body:failureForm()});
  const completedAfterSave=await waitForDone(afterSave.note.id);
  assert.equal(completedAfterSave.modelInfo.summary,"custom-after-save");
  assert.equal(completedAfterSave.proofreading.model,"custom-after-save");
  assert.equal(aiRequests.filter(r=>r.kind==="summary").at(-1).body.thinking,undefined);
  assert.equal(completedAfterSave.aiConfiguration.revision,(await request("/api/ai-settings")).settings.revision);
  assert.ok(!JSON.stringify(completedAfterSave).includes("updated-local-test-key"));


  const legacyOnlyId = "legacy-correction";
  const legacyOnly = { ...beforeRetry, id: legacyOnlyId, status: "done", title: "旧历史稿.wav", asrMode: undefined,
    transcript: [{ speaker:"讲话人1",startTime:"00:00:00",text:"这份旧历史稿需要越请晰越好，保持全部原有段落和文字顺序。" }],
    rawTranscriptPath: undefined, proofreadingPath: undefined, proofreading: undefined, transcriptEditedAt: undefined };
  await fs.writeFile(path.join(dir,"notes",`${legacyOnlyId}.json`),JSON.stringify(legacyOnly));
  const regeneratedLegacy=await request(`/api/notes/${legacyOnlyId}/resummarize`, { method:"POST",headers:{"Content-Type":"application/json"},body:"{}" });
  assert.equal(regeneratedLegacy.note.proofreading.status,"done");
  assert.match(regeneratedLegacy.note.transcript[0].text,/越清晰/);

  aiMode="invalid-summary";
  const invalidSummary=await request("/api/notes/live-finalize", { method:"POST",body:failureForm("这是总结字段完整性检查。") });
  assert.equal((await waitForFailure(invalidSummary.note.id)).failedStage,"summarizing");


});
