import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProofreadingChunks, applyProofreadingEdits, Proofreader } from './proofreading.js';

const sentence = '这份财务制度需要越挣规越好，股东确认后我们再继续讨论后续交付安排。';
const line = (text, i = 0) => ({ lineId: `saved-${i}`, startTime: `00:00:${String(i).padStart(2, '0')}`, speaker: '讲话人1', text });
const responseFor = (chunk, edits = []) => ({ reviewed_ids: chunk.body.map(p => p.id), edits, uncertain: [] });
const edit = (id, before, after, kind = 'typo') => ({ id, before, after, kind, reason: '根据上下文修正' });

test('local edits preserve every paragraph and metadata; original input stays unchanged', async () => {
  const input = [line(sentence), line('下一步我们继续执行已经确定的安排，后续内容完整保留。', 1)];
  const original = structuredClone(input);
  const engine = new Proofreader({ model: 'test-model', request: async ({ messages }) => {
    const chunk = JSON.parse(messages.at(-1).content);
    return { payload: responseFor(chunk, [edit(chunk.body[0].id, '越挣规', '越正规')]), elapsedSeconds: 0.1 };
  }});
  const result = await engine.proofread(input, { title: '测试录音' });
  assert.equal(result.transcript[0].text, sentence.replace('越挣规', '越正规'));
  assert.deepEqual(result.transcript[1], input[1]);
  assert.deepEqual(result.transcript.map(({ text, ...meta }) => meta), input.map(({ text, ...meta }) => meta));
  assert.deepEqual(input, original);
  assert.equal(result.applied.length, 1);
});

test('review coverage cannot be missing, duplicated or include context paragraphs', () => {
  const [chunk] = createProofreadingChunks([line(sentence), line(sentence+'后续内容。',1)]);
  for (const ids of [[], [chunk.body[0].id], [chunk.body[0].id, chunk.body[0].id], [...chunk.body.map(x=>x.id),'unknown']]) {
    assert.throws(() => applyProofreadingEdits(chunk, { reviewed_ids: ids, edits: [], uncertain: [] }), /覆盖|审阅|ID/);
  }
  assert.equal(applyProofreadingEdits(chunk, responseFor(chunk)).applied.length, 0);
});

test('numbers, negations, invented names, ambiguous anchors and whole-paragraph rewrites are rejected', () => {
  const text = '今天不想修改29.9元价格，也没有调整2026年安排。张老师确认以后再讨论，这个这个需要保留。';
  const [chunk] = createProofreadingChunks([line(text)]);
  const id = chunk.body[0].id;
  const candidates = [edit(id,'29.9','299'), edit(id,'不想','想'), edit(id,'没有','有'), edit(id,'2026','2027'),
    edit(id,'张老师','李老师','name'), edit(id,'这个','那个'), edit(id,text,'精简后的句子'), edit('context','文字','内容')];
  const result = applyProofreadingEdits(chunk, responseFor(chunk,candidates));
  assert.equal(result.segments[0].text,text);
  assert.equal(result.applied.length,0);
  assert.equal(result.rejected.length,candidates.length);
});

test('overlapping replacements are rejected; short segments only accept punctuation changes', () => {
  const [chunk] = createProofreadingChunks([line(sentence),line('你好世界',1)]);
  const a=chunk.body[0].id,b=chunk.body[1].id;
  const result=applyProofreadingEdits(chunk,responseFor(chunk,[edit(a,'越挣规','越正规'),edit(a,'挣规','正规'),edit(b,'世界','大家'),edit(b,'界','界。','punctuation')]));
  assert.equal(result.segments[0].text,sentence);
  assert.equal(result.segments[1].text,'你好世界。');
  assert.equal(result.applied.length,1);
});

test('punctuation and partial-word edits cannot change protected facts across anchor boundaries', () => {
  const text='当前价格29.9元，只有确认以后才可以执行，否则不可以变更安排。';
  const [chunk]=createProofreadingChunks([line(text)]);const id=chunk.body[0].id;
  const result=applyProofreadingEdits(chunk,responseFor(chunk,[edit(id,'.','，','punctuation'),edit(id,'有','需')]));
  assert.equal(result.segments[0].text,text);assert.equal(result.applied.length,0);
});

test('oversized or dense changes do not rewrite the source', () => {
  const text='甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸';
  const [chunk]=createProofreadingChunks([line(text)]);
  const result=applyProofreadingEdits(chunk,responseFor(chunk,[edit(chunk.body[0].id,'甲乙丙丁戊己庚辛壬癸','新的内容完全不同而且不符合原稿')]));
  assert.equal(result.segments[0].text,text);
  assert.equal(result.applied.length,0);
});

test('proofreading cannot erase repetitions or guess personal names through a typo label', () => {
  const text='原来的语气和前后顺序都需要保留。'.repeat(4)+'这个新新客户已经表示想想想要来学，我们需要保留他的完整说法，后面甲某就不来。';
  const [chunk]=createProofreadingChunks([line(text)]);const id=chunk.body[0].id;
  const result=applyProofreadingEdits(chunk,responseFor(chunk,[edit(id,'新新客户','新客户'),edit(id,'想想想要来学','想要来学'),{...edit(id,'后面甲某就不来','后面乙某就不来'),reason:'根据上下文统一人名'}]));
  assert.equal(result.segments[0].text,text);assert.equal(result.applied.length,0);
});

test('chunking owns every character once, supplies read-only context and reassembles oversized paragraphs', async () => {
  const input=[line(sentence.repeat(6)),line('这是结尾。',1)];
  const chunks=createProofreadingChunks(input,{maxChars:70,contextChars:35});
  assert.ok(chunks.length>2);
  assert.equal(chunks.flatMap(c=>c.body).map(p=>p.text).join(''),input.map(p=>p.text).join(''));
  assert.ok(chunks[1].contextBefore.length);
  assert.ok(chunks[0].contextAfter.length);
  assert.equal(new Set(chunks.flatMap(c=>c.body.map(p=>p.id))).size,chunks.flatMap(c=>c.body).length);
  const engine=new Proofreader({model:'test',maxChars:70,contextChars:35,request:async({messages})=>({payload:responseFor(JSON.parse(messages.at(-1).content))})});
  assert.deepEqual((await engine.proofread(input)).transcript,input);
});

test('checkpoints survive a failed chunk and only matching input/model versions are reused', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'proofread-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const input=[line(sentence),line(sentence+'后续内容。',1)];
  let requests=0,fail=true;
  const request=async({messages})=>{
    requests++;const c=JSON.parse(messages.at(-1).content);
    if(c.index===1&&fail)throw new Error('temporary failure');
    return {payload:responseFor(c),usage:{prompt_tokens:10,completion_tokens:5}};
  };
  const engine=new Proofreader({model:'one',cacheDir:dir,maxChars:50,concurrency:1,request});
  await assert.rejects(engine.proofread(input),/temporary failure/);
  assert.equal(requests,2);fail=false;
  const recovered=await engine.proofread(input);assert.deepEqual(recovered.transcript,input);assert.equal(requests,3);
  await engine.proofread(input);assert.equal(requests,3);
  await new Proofreader({model:'two',cacheDir:dir,maxChars:50,concurrency:1,request}).proofread(input);assert.equal(requests,5);
  await engine.proofread([line(sentence+'变更。'),input[1]]);assert.equal(requests,7);
});

test('request concurrency is bounded across recordings and truncated responses are split without dropping text', async () => {
  let active=0, peak=0;
  const request=async({messages})=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));
    const c=JSON.parse(messages.at(-1).content);active--;
    if(c.body.some(p=>p.text.length>80)){const e=new Error('truncated');e.code='OUTPUT_TRUNCATED';throw e;}
    return {payload:responseFor(c)};
  };
  const engine=new Proofreader({model:'test',request,maxChars:150,concurrency:2});
  const a=[line(sentence.repeat(5))],b=[line(sentence.repeat(4),1)];
  const results=await Promise.all([engine.proofread(a),engine.proofread(b)]);
  assert.deepEqual(results[0].transcript,a);assert.deepEqual(results[1].transcript,b);assert.ok(peak<=2,`peak requests: ${peak}`);
});

test('an incomplete review retries rather than being labelled fully proofread', async () => {
  let calls=0;
  const engine=new Proofreader({model:'test',request:async({messages})=>{
    calls++;const c=JSON.parse(messages.at(-1).content);
    return {payload:calls===1?{reviewed_ids:[],edits:[],uncertain:[]}:responseFor(c)};
  }});
  assert.deepEqual((await engine.proofread([line(sentence)])).transcript,[line(sentence)]);assert.equal(calls,2);
});

test('dedicated cleanup removes empty stutters and fillers while preserving source coverage and times', async () => {
  const text='我我我建议，呃，先试一下这个方案，然后再根据实际反馈安排后续工作。';
  const input=[line(text)]; const original=structuredClone(input);
  const engine=new Proofreader({model:'deepseek-flash',maxChars:40,request:async({messages})=>{
    const c=JSON.parse(messages.at(-1).content),id=c.body[0].id;
    return {payload:responseFor(c,[
      {...edit(id,'我我我建议','我建议','cleanup'),cleanup_type:'stutter'},
      {...edit(id,'，呃，先试一下','，先试一下','cleanup'),cleanup_type:'filler'}
    ])};
  }});
  const result=await engine.proofread(input);
  assert.equal(result.transcript[0].text,'我建议，先试一下这个方案，然后再根据实际反馈安排后续工作。');
  assert.equal(result.applied.length,2);
  assert.deepEqual(input,original);
  assert.deepEqual(result.transcript.map(({text,...meta})=>meta),input.map(({text,...meta})=>meta));
});

test('cleanup preserves emphasis, answers, uncertainty, negation, figures and self-correction', () => {
  const cases=[
    ['这次一定一定要做好，我们已经安排了后续的执行工作。','一定一定','一定','stutter'],
    ['我们非常非常重视这次工作，后续需要继续关注具体结果。','非常非常','非常','stutter'],
    ['可以可以，我们就按这个安排来做，后续事项继续推进。','可以可以','可以','stutter'],
    ['你同意吗？嗯，我们接下来讨论具体执行方式和后续安排。','嗯，','','filler'],
    ['这个方案先这样处理啊，后面再根据实际反馈考虑其他安排。','啊，','，','filler'],
    ['你做了什么东西措施但是无果啊然后我就问后续有没有其他安排','措施但是无果啊','措施但是无果','filler'],
    ['我可能不太愿意这样安排，后续还需要重新讨论具体做法。','可能不太','愿意','cleanup'],
    ['预算先安排五千，不，三千，确认以后再执行后面的工作。','五千，不，三千','三千','stutter'],
    ['这是我们下一步的工作安排，已经确认的主要信息需要保留。','主要信息','','filler'],
    ['嗯','嗯','','filler']
  ];
  for(const [text,before,after,type] of cases){
    const [c]=createProofreadingChunks([line(text)]);
    const result=applyProofreadingEdits(c,responseFor(c,[{...edit(c.body[0].id,before,after,'cleanup'),cleanup_type:type}]));
    assert.equal(result.segments[0].text,text,`${before} must remain`);
    assert.equal(result.applied.length,0);
  }
});

test('proofreading cannot change who an action refers to or apply a simultaneously disputed correction',()=>{
  const text='我本来想把这个舞蹈你跟起来了，后续的具体安排需要继续讨论，没有实质次的进展。'+'后续的执行安排仍然需要根据实际反馈继续讨论。'.repeat(3);
  const [c]=createProofreadingChunks([line(text)]),id=c.body[0].id;
  const payload=responseFor(c,[edit(id,'这个舞蹈你跟起来了','这个舞蹈给它跟起来了'),edit(id,'实质次','实质性')]);
  payload.uncertain=[{id,text:'实质次',reason:'原音有其他解释，无法确定'}];
  const result=applyProofreadingEdits(c,payload);
  assert.equal(result.segments[0].text,text);assert.equal(result.applied.length,0);
});

test('same model on a different configuration cannot reuse another endpoint checkpoint',async t=>{
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'proof-config-'));t.after(()=>fs.rm(cacheDir,{recursive:true,force:true}));
  let calls=0;
  const make=configurationId=>new Proofreader({model:'shared-model-name',configurationId,cacheDir,request:async({messages})=>{
    calls++;return {payload:responseFor(JSON.parse(messages.at(-1).content))};
  }});
  const input=[line(sentence)];
  await make('first').proofread(input);
  const other=await make('second').proofread(input);
  assert.equal(calls,2);assert.equal(other.configurationId,'second');assert.equal(other.chunks[0].cached,false);
  await make('first').proofread(input);assert.equal(calls,2);
});
