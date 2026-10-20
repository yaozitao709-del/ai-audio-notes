import { performance } from 'node:perf_hooks';

export async function requestModelList({baseUrl,apiKey}) {
  const started=performance.now();
  let response;
  try {
    response=await fetch(`${baseUrl.replace(/\/+$/,'')}/models`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(15_000)});
  }catch{throw new Error('获取模型列表失败，请检查网络与 API 地址，或手动填写模型名。');}
  if(!response.ok){
    await response.body?.cancel();
    const hint=response.status===401||response.status===403?'请检查密钥和权限。':response.status===404?'该服务未提供此模型列表接口，可手动填写模型名。':'请检查服务状态，或手动填写模型名。';
    throw Object.assign(new Error(`获取模型列表失败（HTTP ${response.status}）。${hint}`),{status:response.status});
  }
  let payload;
  try{payload=await response.json();}catch{throw new Error('模型列表响应不是合法 JSON，可手动填写模型名。');}
  if(!Array.isArray(payload?.data))throw new Error('服务返回的模型列表格式不兼容，可手动填写模型名。');
  return {records:payload.data,elapsedSeconds:(performance.now()-started)/1000};
}

export function createAIClient({ baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', apiKey = process.env.DEEPSEEK_API_KEY,
  provider = 'deepseek', timeoutMs = 120_000, attempts = 3, retryDelayMs = 800 } = {}) {
  return async function requestJson({ model, messages, maxTokens = 8192 }) {
    if (!apiKey) throw new Error('尚未配置 AI API 密钥，请打开首页右上角的 AI 设置。');
    const started = performance.now();
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST', signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, ...(provider === 'deepseek' ? {thinking: { type: 'disabled' }} : {}), temperature: 0.2, max_tokens: maxTokens })
        });
        if (!response.ok) {
          // Do not echo provider bodies, which may contain submitted private text.
          await response.body?.cancel();
          const hint = response.status===401 ? '请检查 API 密钥。' : response.status===403 ? '请检查密钥权限。' : response.status===404 ? '请检查 API 地址和模型名。' : response.status===429 ? '请求过于频繁或额度不足，请稍后重试。' : '请检查服务状态和模型设置。';
          const error = new Error(`AI服务请求失败（HTTP ${response.status}）。${hint}`);
          error.status = response.status;
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        let raw;
        try {raw=await response.json();}
        catch {const error=new Error('AI服务响应不是合法 JSON，请检查 API 地址和服务兼容性。');error.retryable=false;throw error;}
        const choice = raw?.choices?.[0];
        if (choice?.finish_reason === 'length') {
          const error = new Error('AI校对返回被截断，正在缩小分块重试。'); error.code = 'OUTPUT_TRUNCATED'; error.retryable = false; throw error;
        }
        const content = choice?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('AI返回了空内容。');
        let payload;
        try { payload = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); }
        catch { throw new Error('AI返回的校对结果不是完整JSON。'); }
        return { payload, content, responseModel: raw.model || model, usage: raw.usage || {}, elapsedSeconds: (performance.now() - started) / 1000, attempts: attempt + 1 };
      } catch (error) {
        if (error.name==='TimeoutError' || error.name==='AbortError') { error=new Error('AI 请求超时，请检查网络或稍后重试。'); }
        if (error.retryable === false || attempt + 1 >= attempts) throw error;
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * 2 ** attempt));
      }
    }
  };
}
