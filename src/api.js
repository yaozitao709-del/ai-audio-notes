const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787" : window.location.origin);

const exportExtensions = {
  word: "docx",
  pdf: "pdf",
  txt: "txt",
  json: "json"
};

function stripAudioExtension(title) {
  return String(title || "未命名音频").replace(/\.(mp3|m4a|wav|webm|ogg|mp4|aac|flac)$/i, "");
}

function fallbackExportFileName(note, type) {
  if (type === "audio") return note.title || "audio";
  const extension = exportExtensions[type] || type;
  return `${stripAudioExtension(note.title)}.${extension}`;
}

function normalizeNote(note) {
  if (!note) return note;
  return {
    ...note,
    keywords: Array.isArray(note.keywords) ? note.keywords : [],
    summaryItems: Array.isArray(note.summaryItems) ? note.summaryItems : [],
    chapters: Array.isArray(note.chapters) ? note.chapters : [],
    transcript: Array.isArray(note.transcript) ? note.transcript : [],
    audioUrl: note.audioUrl?.startsWith("http") ? note.audioUrl : `${API_BASE}${note.audioUrl || ""}`
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `本地服务请求失败：${response.status}`);
  }
  return response.json();
}

function fileNameFromDisposition(disposition, fallback) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const plain = disposition?.match(/filename="?([^"]+)"?/)?.[1];
  return plain || fallback;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function fetchNotes() {
  const payload = await requestJson("/api/notes");
  return (payload.notes || []).map(normalizeNote);
}

export async function fetchAISettings() {
  return (await requestJson('/api/ai-settings')).settings;
}

export async function saveAISettings(draft) {
  return (await requestJson('/api/ai-settings',{method:'PUT',body:JSON.stringify({provider:draft.provider,baseUrl:draft.baseUrl,model:draft.model,apiKey:draft.apiKey})})).settings;
}

export async function testAISettings(draft) {
  return requestJson('/api/ai-settings/test',{method:'POST',body:JSON.stringify({provider:draft.provider,baseUrl:draft.baseUrl,model:draft.model,apiKey:draft.apiKey})});
}

export async function fetchAIModels(draft) {
  return requestJson('/api/ai-settings/models',{method:'POST',body:JSON.stringify({provider:draft.provider,baseUrl:draft.baseUrl,model:draft.model,apiKey:draft.apiKey})});
}

export async function fetchTermFixes() {
  const payload = await requestJson("/api/term-fixes");
  return Array.isArray(payload.termFixes) ? payload.termFixes : [];
}

export async function saveTermFixes(termFixes) {
  const payload = await requestJson("/api/term-fixes", {
    method: "PUT",
    body: JSON.stringify({ termFixes })
  });
  return Array.isArray(payload.termFixes) ? payload.termFixes : [];
}

export async function applyTermFixes(noteIds = []) {
  const payload = await requestJson("/api/term-fixes/apply", {
    method: "POST",
    body: JSON.stringify({ noteIds })
  });
  return {
    updatedCount: payload.updatedCount || 0,
    notes: (payload.notes || []).map(normalizeNote)
  };
}

export async function importAudioFile(file) {
  const formData = new FormData();
  formData.append("audio", file);
  formData.append("asrMode", "fast");
  const payload = await requestJson("/api/notes/import", {
    method: "POST",
    body: formData
  });
  return normalizeNote(payload.note);
}

export async function finalizeLiveRecording(file, transcript, { forceTranscription = false } = {}) {
  const formData = new FormData();
  formData.append("audio", file);
  formData.append("transcript", JSON.stringify(transcript));
  formData.append("forceTranscription", String(forceTranscription));
  formData.append("asrMode", "fast");
  const payload = await requestJson("/api/notes/live-finalize", {
    method: "POST",
    body: formData
  });
  return normalizeNote(payload.note);
}

export async function retryNote(id, options = {}) {
  const payload = await requestJson(`/api/notes/${id}/retry`, {
    method: "POST",
    body: JSON.stringify(options)
  });
  return normalizeNote(payload.note);
}

export async function renameNote(id, title) {
  const payload = await requestJson(`/api/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
  return normalizeNote(payload.note);
}

export async function saveTranscript(id, transcript, options = {}) {
  const payload = await requestJson(`/api/notes/${id}/transcript`, {
    method: "PATCH",
    body: JSON.stringify({ transcript, ...options })
  });
  return normalizeNote(payload.note);
}

export async function deleteNote(id) {
  return requestJson(`/api/notes/${id}`, {
    method: "DELETE"
  });
}

export async function deleteNotes(ids) {
  return requestJson("/api/notes/delete", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export async function resummarizeNote(id, model) {
  const payload = await requestJson(`/api/notes/${id}/resummarize`, {
    method: "POST",
    body: JSON.stringify({ model })
  });
  return normalizeNote(payload.note);
}

export async function exportNoteFile(note, type, settings = {}) {
  const response = await fetch(`${API_BASE}/api/notes/${note.id}/export/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `导出失败：${response.status}`);
  }
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackExportFileName(note, type));
  downloadBlob(blob, fileName);
}
