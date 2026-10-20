const API_BASE = import.meta.env?.VITE_API_BASE_URL || (import.meta.env?.DEV || !globalThis.location ? "http://127.0.0.1:8787" : globalThis.location.origin);
const ASR_BASE_URL = `${API_BASE}/api/asr`;

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function checkAsrHealth() {
  try {
    const response = await fetch(`${ASR_BASE_URL}/health`);
    const payload = await readJson(response);
    return response.ok && payload.status === "ready";
  } catch {
    return false;
  }
}

export async function transcribeChunk({ sessionId, sequence, utteranceId, startSeconds, wav, final }) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${ASR_BASE_URL}/transcribe`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "audio/wav",
        "X-Session-Id": sessionId,
        "X-Sequence": String(sequence),
        "X-Utterance-Id": String(utteranceId),
        "X-Start-Seconds": String(startSeconds),
        "X-Final": String(final)
      },
      body: wav
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload.error || "本地实时转录失败");
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function clearAsrSession(sessionId) {
  if (!sessionId) return false;
  try {
    const response = await fetch(`${ASR_BASE_URL}/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
    return response.ok;
  } catch {
    return false;
  }
}
