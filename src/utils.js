export function timeToSeconds(time) {
  if (!time) return 0;
  const parts = time.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(time) || 0;
}

export function secondsToTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function stripAudioExtension(title) {
  return title.replace(/\.(mp3|m4a|wav|webm|ogg|mp4|aac|flac)$/i, "");
}

export function createExportTranscriptLines(note, settings) {
  if (!settings.segmentedText) {
    return [
      note.transcript
        .map((line) => line.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    ].filter(Boolean);
  }

  return note.transcript.map((line) => {
    const metaParts = [];
    if (settings.showSpeaker) metaParts.push(line.speaker);
    if (settings.showTimestamp) metaParts.push(line.startTime);
    if (metaParts.length === 0) return line.text;
    return `${metaParts.join(" - ")}\n${line.text}`;
  });
}

export function createPlainText(note, settings) {
  const summaryItems = note.summaryItems.map((item) => `- ${item.title}：${item.content}`).join("\n");
  const chapters = note.chapters.map((chapter) => `- ${chapter.startTime} ${chapter.title}\n  ${chapter.summary}`).join("\n");
  const transcript = createExportTranscriptLines(note, settings).join(settings.segmentedText ? "\n\n" : "\n");

  return `${note.title}

关键词：${note.keywords.join("、")}

总结概要
${note.summaryLead}

${summaryItems}

章节速览
${chapters}

原文
${transcript}
`;
}

export function createExportHtml(note, settings, extension) {
  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const transcriptLines = createExportTranscriptLines(note, settings)
    .map((line) => `<p class="transcript-line">${escapeHtml(line).replace(/\n/g, "<br />")}</p>`)
    .join("");
  const summaryItems = note.summaryItems
    .map((item) => `<li><strong>${escapeHtml(item.title)}：</strong>${escapeHtml(item.content)}</li>`)
    .join("");
  const chapters = note.chapters
    .map(
      (chapter) =>
        `<li><strong>${escapeHtml(chapter.startTime)} ${escapeHtml(chapter.title)}</strong><br />${escapeHtml(chapter.summary)}</li>`
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(stripAudioExtension(note.title))}.${extension}</title>
  <style>
    body { font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif; color: #12182f; margin: 40px; line-height: 1.75; }
    h1 { font-size: 26px; margin: 0 0 28px; }
    h2 { font-size: 18px; margin: 30px 0 12px; }
    .muted, .transcript-line { color: #60687a; }
    .transcript-line { margin: 0 0 18px; white-space: pre-wrap; }
    li { margin-bottom: 10px; }
    @media print { body { margin: 28mm 24mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(stripAudioExtension(note.title))}.${extension}</h1>
  <p class="muted">关键词：${escapeHtml(note.keywords.join("、"))}</p>
  <h2>总结概要</h2>
  <p>${escapeHtml(note.summaryLead)}</p>
  <ul>${summaryItems}</ul>
  <h2>章节速览</h2>
  <ul>${chapters}</ul>
  <h2>原文</h2>
  ${transcriptLines}
</body>
</html>`;
}

export function createMarkdown(note) {
  const summaryItems = note.summaryItems
    .map((item) => `- **${item.title}**：${item.content}`)
    .join("\n");
  const chapters = note.chapters
    .map((chapter) => `- ${chapter.startTime} ${chapter.title}\n  ${chapter.summary}`)
    .join("\n");
  const transcript = note.transcript
    .map((line) => `- ${line.startTime} ${line.speaker}：${line.text}`)
    .join("\n");

  return `# ${note.title}

## 关键词
${note.keywords.join("、")}

## 总结概要
${note.summaryLead}

${summaryItems}

## 章节速览
${chapters}

## 原文
${transcript}
`;
}
