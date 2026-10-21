import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  BookOpenText,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  FileAudio,
  FolderUp,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Users,
  X
} from "lucide-react";
import {
  applyTermFixes,
  deleteNotes,
  exportNoteFile,
  fetchNotes,
  fetchTermFixes,
  finalizeLiveRecording,
  importAudioFile,
  renameNote,
  resummarizeNote,
  retryNote,
  recognizeSpeakers,
  saveTermFixes,
  saveTranscript
} from "./api.js";
import { RollingSpeechChunker } from "./audioChunks.js";
import { checkAsrHealth, clearAsrSession, transcribeChunk } from "./asrClient.js";
import { applySpeakerAssignments } from "./liveSpeaker.js";
import AISettingsPage from './AISettingsPage.jsx';
import {fetchAISettings} from './api.js';
import {createSettingsReceiver} from './aiSettingsState.js';
import {
  createExportTranscriptLines,
  nowStamp,
  secondsToTime,
  stripAudioExtension,
  timeToSeconds
} from "./utils.js";

const acceptedAudioExtensions = [".mp3", ".m4a", ".wav", ".webm", ".ogg"];
const processingStatuses = new Set(["importing", "diarizing", "transcribing", "proofreading", "summarizing"]);
const exportTypeMeta = {
  word: { label: "Word", extension: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { label: "PDF", extension: "pdf", mime: "application/pdf" },
  txt: { label: "txt", extension: "txt", mime: "text/plain;charset=utf-8" }
};

const defaultExportSettings = {
  segmentedText: true,
  showSpeaker: true,
  showTimestamp: true
};
const playbackRateOptions = [0.75, 1, 1.25, 1.5, 2];

function speakerBadgeText(speaker) {
  const text = String(speaker || "1").trim();
  const numeric = text.match(/讲话人(\d+)/)?.[1];
  if (numeric) return numeric;
  return text.slice(0, 1) || "1";
}

function speakerToneClass(speaker) {
  const text = String(speaker || "").trim();
  const numeric = text.match(/讲话人(\d+)/)?.[1] || text.match(/\d+/)?.[0];
  if (numeric) return `speaker-tone-${(Number(numeric) - 1) % 6}`;
  const hash = Array.from(text || "speaker").reduce((total, char) => total + char.charCodeAt(0), 0);
  return `speaker-tone-${hash % 6}`;
}

function createSpeakerNameDrafts(transcript) {
  const seen = new Set();
  return (Array.isArray(transcript) ? transcript : []).reduce((drafts, line) => {
    const originalName = String(line.speaker || "讲话人").trim() || "讲话人";
    if (seen.has(originalName)) return drafts;
    seen.add(originalName);
    drafts.push({
      id: `speaker-${drafts.length}-${originalName}`,
      originalName,
      draftName: originalName
    });
    return drafts;
  }, []);
}

function applySpeakerNameDrafts(transcript, speakerNameDrafts) {
  const renameMap = new Map(
    speakerNameDrafts.map(({ originalName, draftName }) => [originalName, String(draftName || "").trim() || originalName])
  );
  return transcript.map((line) => {
    const speaker = String(line.speaker || "讲话人").trim() || "讲话人";
    return renameMap.has(speaker) ? { ...line, speaker: renameMap.get(speaker) } : line;
  });
}

function buildTimelineSegments(note, durationSeconds) {
  const chapters = Array.isArray(note.chapters) ? note.chapters : [];
  if (durationSeconds <= 0 || chapters.length === 0) return [];

  const rawSegments = chapters
    .map((chapter, index) => {
      const start = Math.min(Math.max(0, timeToSeconds(chapter.startTime)), durationSeconds);
      return {
        start,
        startTime: chapter.startTime || secondsToTime(start),
        title: chapter.title || `章节 ${index + 1}`,
        summary: chapter.summary || chapter.title || `章节 ${index + 1}`
      };
    })
    .sort((a, b) => a.start - b.start)
    .filter((segment, index, segments) => index === 0 || segment.start !== segments[index - 1].start);

  if (rawSegments.length === 0) return [];
  if (rawSegments[0].start > 0) {
    rawSegments.unshift({
      start: 0,
      startTime: "00:00:00",
      title: rawSegments[0].title,
      summary: rawSegments[0].summary
    });
  }

  return rawSegments.map((segment, index) => {
    const nextStart = rawSegments[index + 1]?.start ?? durationSeconds;
    return {
      ...segment,
      left: (segment.start / durationSeconds) * 100,
      width: Math.max(0.7, ((nextStart - segment.start) / durationSeconds) * 100)
    };
  });
}

function StatusPill({ status, failedStage }) {
  const labelMap = {
    done: "已完成",
    recording: "录音中",
    finalizing: "补全中",
    importing: "导入中",
    transcribing: "转写中",
    diarizing: "分人中",
    proofreading: "校对中",
    summarizing: "总结中",
    failed: "失败"
  };
  return <span className={`status-pill ${status}`}>{status === "failed" && failedStage === "proofreading" ? "校对未完成" : labelMap[status] || status}</span>;
}

function KeywordList({ keywords, compact = false, limit = 0 }) {
  const safeKeywords = Array.isArray(keywords) ? keywords : [];
  const visibleCount = compact ? 5 : limit > 0 ? limit : safeKeywords.length;
  const visibleKeywords = safeKeywords.slice(0, visibleCount);
  return (
    <div className={`keyword-list ${limit > 0 ? "is-collapsed" : ""}`}>
      {visibleKeywords.map((keyword) => (
        <span className="keyword" key={keyword}>
          {keyword}
        </span>
      ))}
      {(compact || limit > 0) && safeKeywords.length > visibleKeywords.length ? (
        <span className="keyword muted">+{safeKeywords.length - visibleKeywords.length}</span>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <FileAudio size={36} />
      <p>还没有本地纪要。拖入一段音频，或点击上方入口开始。</p>
    </div>
  );
}

function NoteCard({ note, isSelected, onDelete, onOpen, onRename, onRetry, onToggleSelect }) {
  const canOpen = note.status !== "failed";
  const canDelete = !processingStatuses.has(note.status);

  return (
    <article
      className={`note-card ${note.status} ${canOpen ? "clickable" : ""} ${isSelected ? "selected" : ""}`}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={() => {
        if (canOpen) onOpen(note.id);
      }}
      onKeyDown={(event) => {
        if (!canOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(note.id);
        }
      }}
    >
      <div className="card-header">
        <div className="note-title-row">
          <button
            className={`note-checkbox ${isSelected ? "checked" : ""}`}
            type="button"
            title={isSelected ? "取消选择" : "选择"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect(note.id);
            }}
          >
            {isSelected ? <Check size={13} /> : null}
          </button>
          <h3 title={note.title}>{note.title}</h3>
        </div>
        <StatusPill status={note.status} failedStage={note.failedStage} />
      </div>
      <KeywordList keywords={note.keywords} compact />
      <p className="note-summary">
        <strong>总结概要：</strong>
        {note.status === "failed" ? note.error : note.summaryLead}
      </p>
      <div className="note-meta">
        <span>
          <FileAudio size={15} />
          {note.duration}
        </span>
        <span>{note.createdAt}</span>
        {note.asrMode ? <span>{note.asrMode === "fast" ? "快速转写" : "历史转写"}{Number.isFinite(note.asrElapsedSeconds) ? ` · ${note.asrElapsedSeconds.toFixed(1)} 秒` : ""}</span> : null}
      </div>
      <div className="card-actions" onKeyDown={(event) => event.stopPropagation()}>
        {["done", "failed"].includes(note.status) ? (
          <button className="card-action-button" type="button" onClick={(event) => onRetry(event, note.id)} title={note.status === "failed" && ["proofreading", "summarizing"].includes(note.failedStage) ? "继续完成处理" : "快速重新转写"} aria-label={`重新转写 ${note.title}`}>
            <RefreshCw size={17} />
          </button>
        ) : null}
        <button
          className="card-action-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRename(note);
          }}
          title="重命名"
        >
          <Edit3 size={17} />
        </button>
        <button
          className="card-action-button danger"
          type="button"
          disabled={!canDelete}
          onClick={(event) => {
            event.stopPropagation();
            onDelete([note.id]);
          }}
          title={canDelete ? "删除" : "处理中，完成后可删除"}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}

function HomePage({
  apiError,
  isLoadingNotes,
  notes,
  selectedIds,
  isDragging,
  isRecording,
  recordingSeconds,
  onDeleteNotes,
  onDeleteSelected,
  onDragEnter,
  onDragLeave,
  onDrop,
  onFileInput,
  onOpenTermFixes,
  onOpenAISettings,
  aiConfigured,
  onOpen,
  onRefresh,
  onRename,
  onRetry,
  onSelectAll,
  onToggleSelect,
  onToggleRecording
}) {
  const fileInputRef = useRef(null);
  const isAllSelected = notes.length > 0 && selectedIds.length === notes.length;

  return (
    <main
      className={`home-page ${isDragging ? "dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button className="ai-settings-trigger" type="button" onClick={onOpenAISettings}><img src="/assets/ai-settings-128.png" alt="" width="20" height="20"/>AI 设置</button>
      <section className="hero">
        <div className="hero-title">
          <AudioLines size={30} />
          <h1>AI 录音纪要</h1>
        </div>
        <p>快速转写、全文校对与会议复盘</p>
      </section>

      {aiConfigured===false?<div className="ai-setup-notice"><span>配置 AI 后可自动校对和总结</span><button type="button" onClick={onOpenAISettings}>前往设置 →</button></div>:null}

      <section className="asr-mode-bar" aria-label="转写设置">
        <strong>快速转写</strong>
        <span>自动区分讲话人，校对全文后再生成总结</span>
      </section>

      <section className="action-grid" aria-label="主要操作">
        <button className="action-card" type="button" onClick={() => fileInputRef.current?.click()}>
          <span className="action-icon">
            <FolderUp size={34} />
          </span>
          <span className="action-text">
            <strong>本地导入</strong>
            <small>支持 mp3、m4a、wav，拖拽导入</small>
          </span>
          <ChevronRight size={18} />
        </button>

        <button className={`action-card ${isRecording ? "recording" : ""}`} type="button" onClick={onToggleRecording}>
          <span className="action-icon">
            {isRecording ? <Square size={30} fill="currentColor" /> : <Mic size={34} />}
          </span>
          <span className="action-text">
            <strong>{isRecording ? "停止录音" : "开始录音"}</strong>
            <small>{isRecording ? `正在录制 ${secondsToTime(recordingSeconds)}` : "边录边准备生成纪要"}</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".mp3,.m4a,.wav,.webm,.ogg,audio/*"
          multiple
          onChange={onFileInput}
        />
      </section>

      <section className="history-section">
        <div className="section-title-row">
          <div className="history-heading">
            <h2>全部笔记</h2>
            {notes.length > 0 ? (
              <button className={`select-all-button ${isAllSelected ? "active" : ""}`} type="button" onClick={onSelectAll}>
                {isAllSelected ? <CheckSquare size={17} /> : <span className="tiny-checkbox" />}
                全选
              </button>
            ) : null}
            {selectedIds.length > 0 ? <span className="selected-count">已选中 {selectedIds.length} 项</span> : null}
          </div>
          <div className="history-actions">
            {selectedIds.length > 0 ? (
              <button className="batch-delete-button" type="button" onClick={onDeleteSelected}>
              <Trash2 size={16} />
              删除
              </button>
            ) : null}
            <button className="ghost-button text-ghost-button" type="button" onClick={onOpenTermFixes}>
              <BookOpenText size={18} />
              词表
            </button>
            <button className="ghost-button" type="button" title="刷新" onClick={onRefresh}>
              <RefreshCw className={isLoadingNotes ? "spin-icon" : ""} size={19} />
            </button>
          </div>
        </div>
        {apiError ? <div className="server-warning">{apiError}</div> : null}
        {notes.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="notes-grid">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                isSelected={selectedIds.includes(note.id)}
                onDelete={onDeleteNotes}
                onOpen={onOpen}
                onRename={onRename}
                onRetry={onRetry}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        )}
      </section>
      {isDragging ? <div className="drop-hint">松开后导入音频</div> : null}
    </main>
  );
}

function TranscriptPanel({
  note,
  searchTerm,
  activeLineIndex,
  draftTranscript,
  hasDraftChanges,
  isEditing,
  isSavingTranscript,
  speakerNameDrafts,
  onCancelEdit,
  onDraftLineChange,
  onRenameDraftSpeaker,
  onSaveEdit,
  onSearch,
  onSeek,
  onStartEdit
}) {
  const [keywordsExpanded, setKeywordsExpanded] = useState(false);
  const proofreadingPending = note.status === "proofreading" || (note.status === "failed" && note.failedStage === "proofreading");
  const sourceTranscript = isEditing ? draftTranscript : proofreadingPending ? [] : note.transcript;
  const speakerNameByOriginal = useMemo(
    () => new Map(speakerNameDrafts.map(({ originalName, draftName }) => [originalName, String(draftName || "").trim() || originalName])),
    [speakerNameDrafts]
  );
  const filteredTranscript = useMemo(() => {
    const rows = sourceTranscript.map((line, index) => ({ line, index }));
    if (!searchTerm.trim()) return rows;
    const term = searchTerm.trim();
    return rows.filter(({ line }) => {
      const speaker = speakerNameByOriginal.get(line.speaker) || line.speaker || "";
      return line.text.includes(term) || speaker.includes(term);
    });
  }, [sourceTranscript, searchTerm, speakerNameByOriginal]);
  const keywordLimit = 10;
  const hasMoreKeywords = note.keywords.length > keywordLimit;

  return (
    <section className={`transcript-panel ${isEditing ? "editing" : ""}`}>
      <div className="panel-header">
        <div className="panel-title-row">
          <div className="transcript-title">
            <p className="eyebrow">全文</p>
            {note.speakerRecognition?.status === 'done' ? <span className="proofread-badge">已区分 {note.speakerRecognition.speakerCount} 位讲话人</span> : null}
            {note.proofreading?.status === "done" ? <span className="proofread-badge">{note.proofreading.policy?.startsWith("context-edits-v3-clean:") ? "AI 已校对整理" : "AI 已校对"}</span> : note.proofreading?.status === "manual" ? <span className="proofread-badge">已编辑</span> : null}
          </div>
          <div className="transcript-tools">
            <label className="search-box">
              <Search size={18} />
              <input value={searchTerm} onChange={(event) => onSearch(event.target.value)} placeholder="输入文本查找" />
            </label>
            <button
              className={`edit-transcript-button ${isEditing ? "active" : ""}`}
              type="button"
              onClick={isEditing ? onCancelEdit : onStartEdit}
              disabled={processingStatuses.has(note.status) || ["recording", "finalizing"].includes(note.status)}
              title={isEditing ? "退出编辑" : "编辑全文"}
            >
              {isEditing ? <X size={18} /> : <Edit3 size={18} />}
            </button>
          </div>
        </div>
        <div className="keyword-section">
          <div className="keyword-title-row">
            <span>关键词</span>
            {hasMoreKeywords ? (
              <button className="keyword-toggle" type="button" onClick={() => setKeywordsExpanded((value) => !value)}>
                {keywordsExpanded ? "收起" : "展开"}
              </button>
            ) : null}
          </div>
          <KeywordList keywords={note.keywords} limit={keywordsExpanded ? 0 : keywordLimit} />
        </div>
        {isEditing ? (
          <div className="transcript-edit-panel">
            <div className="speaker-editor-grid">
              {speakerNameDrafts.map((speakerDraft) => (
                <label className="speaker-name-field" key={speakerDraft.id}>
                  <span>{speakerDraft.originalName}</span>
                  <input
                    value={speakerDraft.draftName}
                    onChange={(event) => onRenameDraftSpeaker(speakerDraft.id, event.target.value)}
                    placeholder="说话人名称"
                  />
                </label>
              ))}
            </div>
            <div className="transcript-edit-actions">
              <span className="edit-hint">{note.summaryIsStale ? "文稿已改动，建议重生成总结。" : "修改全文后可保存，也可以直接保存并重生成总结。"}</span>
              <button className="cancel-button small" type="button" onClick={onCancelEdit} disabled={isSavingTranscript || processingStatuses.has(note.status)}>
                取消
              </button>
              <button className="cancel-button small" type="button" onClick={() => onSaveEdit(false)} disabled={!hasDraftChanges || isSavingTranscript}>
                保存
              </button>
              <button className="confirm-export-button small" type="button" onClick={() => onSaveEdit(true)} disabled={!hasDraftChanges || isSavingTranscript}>
                {isSavingTranscript ? "保存中" : "保存并重生成"}
              </button>
            </div>
          </div>
        ) : note.summaryIsStale ? (
          <div className="stale-summary-banner">文稿已修改，当前总结可能不是最新。可以点击“重新生成总结”刷新。</div>
        ) : null}
      </div>

      <div className="transcript-list">
        {filteredTranscript.map(({ line, index: originalIndex }) => {
          const lineKey = line.lineId || `${line.startTime}-${originalIndex}`;
          const displaySpeaker = isEditing ? speakerNameByOriginal.get(line.speaker) || line.speaker : line.speaker;
          return isEditing ? (
            <div className="transcript-line edit-mode" key={lineKey}>
              <span className={`speaker-badge ${speakerToneClass(displaySpeaker)}`}>{speakerBadgeText(displaySpeaker)}</span>
              <span className="line-body">
                <span className="line-meta">
                  <strong>{displaySpeaker}</strong>
                  <time>{line.startTime}</time>
                </span>
                <textarea
                  className="line-textarea"
                  value={line.text}
                  rows={Math.max(2, Math.min(6, Math.ceil(line.text.length / 42)))}
                  onChange={(event) => onDraftLineChange(originalIndex, { text: event.target.value })}
                />
              </span>
            </div>
          ) : (
            <button
              className={`transcript-line ${originalIndex === activeLineIndex ? "active" : ""} ${line.isInterim ? "interim" : ""}`}
              key={lineKey}
              type="button"
              onClick={() => onSeek(timeToSeconds(line.startTime))}
            >
              <span className={`speaker-badge ${speakerToneClass(line.speaker)}`}>{speakerBadgeText(line.speaker)}</span>
              <span className="line-body">
                <span className="line-meta">
                  <strong>{line.speaker}</strong>
                  <time>{line.startTime}</time>
                </span>
                <span className="line-text">{line.text}</span>
              </span>
            </button>
          );
        })}
        {filteredTranscript.length === 0 ? (
          <div className="no-search-result">
            {proofreadingPending ? (note.status === "failed" ? note.error : "正在结合上下文校对整理全文，完成后自动显示") : note.status === "recording" || note.status === "finalizing"
              ? "正在录音，第一段内容转录完成后会显示在这里"
              : "没有匹配到文本"}
          </div>
        ) : null}
        {note.status === "recording" && note.transcript.length > 0 ? (
          <div className="transcript-pending">
            <Loader2 size={16} />
            最近内容转录中
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SummaryPanel({ note, activeChapterIndex, activeTab, onTabChange, onSeek }) {
  return (
    <aside className="summary-panel">
      <div className="tabs" role="tablist">
        <button className={activeTab === "summary" ? "active" : ""} type="button" onClick={() => onTabChange("summary")}>
          总结概要
        </button>
        <button className={activeTab === "chapters" ? "active" : ""} type="button" onClick={() => onTabChange("chapters")}>
          章节速览
        </button>
      </div>

      <div className="summary-scroll">
        {["recording", "finalizing", "diarizing", "summarizing", "proofreading", "transcribing"].includes(note.status) ? (
          <div className="summary-loading">
            <Loader2 size={22} />
            <span>
              {note.status === "recording"
                ? "录音结束后生成总结"
                : note.status === "diarizing" ? "正在根据声音区分讲话人" : note.status === "proofreading" ? "全文校对中" : note.status === "finalizing" || note.status === "transcribing"
                  ? "转写生成中"
                  : "总结生成中"}
            </span>
          </div>
        ) : null}

        {activeTab === "summary" ? (
          <div className="summary-content">
            <p className="lead-summary">{note.summaryLead}</p>
            <ul className="summary-list">
              {note.summaryItems.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}：</strong>
                  <span>{item.content}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="chapter-list">
            {note.chapters.map((chapter, index) => (
              <button
                className={`chapter-card ${index === activeChapterIndex ? "active" : ""}`}
                key={`${chapter.startTime}-${chapter.title}`}
                type="button"
                onClick={() => onSeek(timeToSeconds(chapter.startTime))}
              >
                <span className="chapter-heading">
                  {index === activeChapterIndex ? (
                    <span className="chapter-current-icon" aria-hidden="true">
                      <AudioLines size={17} />
                    </span>
                  ) : null}
                  <span className="chapter-time">{chapter.startTime}</span>
                  <span className="chapter-separator">-</span>
                  <span className="chapter-title">{chapter.title}</span>
                </span>
                <span className="chapter-summary">{chapter.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ExportMenu({ note, onChooseType, onExportAudio }) {
  return (
    <div className="export-menu" role="menu" onClick={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" onClick={(event) => {
        event.stopPropagation();
        onChooseType("word");
      }}>
        <span>导出为 Word</span>
      </button>
      <button type="button" role="menuitem" onClick={(event) => {
        event.stopPropagation();
        onChooseType("pdf");
      }}>
        <span>导出为 PDF</span>
      </button>
      <button type="button" role="menuitem" onClick={(event) => {
        event.stopPropagation();
        onChooseType("txt");
      }}>
        <span>导出为 txt</span>
      </button>
      <button className="audio-export-item" type="button" role="menuitem" onClick={(event) => {
        event.stopPropagation();
        onExportAudio(note);
      }}>
        <span>导出音频</span>
      </button>
    </div>
  );
}

function ExportDialog({ note, type, onClose, onConfirm }) {
  const [settings, setSettings] = useState(defaultExportSettings);
  const meta = exportTypeMeta[type];
  const previewLines = createExportTranscriptLines(note, settings).slice(0, 3);
  const fileName = `${stripAudioExtension(note.title)}.${meta.extension}`;

  const toggleSetting = (key) => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <div className="export-dialog-header">
          <div className="export-dialog-title" id="export-dialog-title">
            <Download size={34} />
            <h2>导出为 {meta.label}</h2>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} title="关闭">
            <X size={28} />
          </button>
        </div>

        <div className="export-preview">
          <h3>{fileName}</h3>
          <div className="preview-lines">
            {previewLines.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </div>

        <div className="export-options">
          <label className="check-row primary">
            <input
              type="checkbox"
              checked={settings.segmentedText}
              onChange={() => toggleSetting("segmentedText")}
            />
            <span className="checkmark">
              <Check size={18} />
            </span>
            文本分段显示
          </label>
          <div className="nested-options">
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showSpeaker}
                disabled={!settings.segmentedText}
                onChange={() => toggleSetting("showSpeaker")}
              />
              <span className="checkmark">
                <Check size={18} />
              </span>
              展示说话人
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showTimestamp}
                disabled={!settings.segmentedText}
                onChange={() => toggleSetting("showTimestamp")}
              />
              <span className="checkmark">
                <Check size={18} />
              </span>
              展示时间码
            </label>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="cancel-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="confirm-export-button" type="button" onClick={() => onConfirm(note, type, settings)}>
            导出
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel = "确认", danger = false, onClose, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="compact-dialog" role="dialog" aria-modal="true">
        <button className="dialog-close compact" type="button" onClick={onClose} title="关闭">
          <X size={24} />
        </button>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="compact-actions">
          <button className="cancel-button small" type="button" onClick={onClose}>
            取消
          </button>
          <button className={`confirm-export-button small ${danger ? "danger" : ""}`} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function RenameDialog({ note, onClose, onConfirm }) {
  const [title, setTitle] = useState(note?.title || "");

  useEffect(() => {
    setTitle(note?.title || "");
  }, [note]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="compact-dialog" role="dialog" aria-modal="true">
        <button className="dialog-close compact" type="button" onClick={onClose} title="关闭">
          <X size={24} />
        </button>
        <h2>重命名</h2>
        <label className="rename-field">
          <span>记录名称</span>
          <input value={title} autoFocus onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") onConfirm(title.trim());
          }} />
        </label>
        <div className="compact-actions">
          <button className="cancel-button small" type="button" onClick={onClose}>
            取消
          </button>
          <button className="confirm-export-button small" type="button" disabled={!title.trim()} onClick={() => onConfirm(title.trim())}>
            保存
          </button>
        </div>
      </section>
    </div>
  );
}

function TermFixDialog({ onClose, onSaved }) {
  const [rows, setRows] = useState([{ from: "", to: "" }]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    fetchTermFixes()
      .then((termFixes) => {
        if (!isMounted) return;
        setRows(termFixes.length > 0 ? termFixes : [{ from: "", to: "" }]);
        setError("");
      })
      .catch((loadError) => {
        if (!isMounted) return;
        setError(loadError?.message || "词表读取失败");
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const updateRow = (index, key, value) => {
    setRows((currentRows) => currentRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  const addRow = () => {
    setRows((currentRows) => [...currentRows, { from: "", to: "" }]);
  };

  const removeRow = (index) => {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((_, rowIndex) => rowIndex !== index);
      return nextRows.length > 0 ? nextRows : [{ from: "", to: "" }];
    });
  };

  const saveRows = async () => {
    const nextRows = rows
      .map((row) => ({ from: row.from.trim(), to: row.to.trim() }))
      .filter((row) => row.from && row.to);
    setIsSaving(true);
    try {
      await saveTermFixes(nextRows);
      await applyTermFixes();
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError?.message || "词表保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-dialog-title">
        <div className="term-dialog-header">
          <div>
            <h2 id="term-dialog-title">专名词表</h2>
            <p>把常见错词改成固定写法，保存后会应用到已有笔记和后续总结。</p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} title="关闭">
            <X size={24} />
          </button>
        </div>

        <div className="term-table">
          {isLoading ? (
            <div className="term-loading">
              <Loader2 size={20} />
              读取词表中
            </div>
          ) : (
            rows.map((row, index) => (
              <div className="term-row" key={`term-${index}`}>
                <input
                  value={row.from}
                  placeholder="错误词，如：货叮东"
                  onChange={(event) => updateRow(index, "from", event.target.value)}
                />
                <span className="term-arrow">改为</span>
                <input
                  value={row.to}
                  placeholder="正确词，如：货叮咚"
                  onChange={(event) => updateRow(index, "to", event.target.value)}
                />
                <button className="term-delete-button" type="button" onClick={() => removeRow(index)} title="删除这条">
                  <Trash2 size={17} />
                </button>
              </div>
            ))
          )}
        </div>

        {error ? <div className="server-warning compact-warning">{error}</div> : null}

        <div className="term-dialog-footer">
          <button className="cancel-button small" type="button" onClick={addRow} disabled={isLoading || isSaving}>
            添加一条
          </button>
          <div className="term-footer-actions">
            <button className="cancel-button small" type="button" onClick={onClose}>
              取消
            </button>
            <button className="confirm-export-button small" type="button" disabled={isLoading || isSaving} onClick={saveRows}>
              {isSaving ? "保存中" : "保存并应用"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PlayerBar({
  audioRef,
  currentTime,
  durationSeconds,
  isPlaying,
  note,
  onDurationKnown,
  playbackRate,
  onRateChange,
  onSeek,
  onTogglePlay
}) {
  const percent = durationSeconds > 0 ? (currentTime / durationSeconds) * 100 : 0;
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const [isRateMenuOpen, setIsRateMenuOpen] = useState(false);
  const rateMenuRef = useRef(null);
  const timelineSegments = useMemo(() => buildTimelineSegments(note, durationSeconds), [durationSeconds, note]);
  const rateButtonLabel = playbackRate === 1 ? "倍速" : `${playbackRate}x`;
  const tooltipCenter = hoveredSegment ? hoveredSegment.left + hoveredSegment.width / 2 : 0;
  const tooltipAlign = tooltipCenter < 24 ? "start" : tooltipCenter > 76 ? "end" : "center";

  useEffect(() => {
    if (!isRateMenuOpen) return undefined;
    const closeMenu = (event) => {
      if (!rateMenuRef.current?.contains(event.target)) setIsRateMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsRateMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isRateMenuOpen]);

  return (
    <footer className="player-bar">
      {note.audioUrl ? (
        <audio
          ref={audioRef}
          src={note.audioUrl}
          preload="metadata"
          onEnded={() => onSeek(0, false)}
          onLoadedMetadata={(event) => {
            const mediaDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            if (mediaDuration > 0) onDurationKnown(mediaDuration);
            onSeek(Math.min(currentTime, mediaDuration || durationSeconds));
          }}
        />
      ) : null}
      <div className="progress-wrap">
        <div
          className="timeline-track"
          onMouseLeave={() => setHoveredSegment(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const hoverPercent = ((event.clientX - rect.left) / rect.width) * 100;
            const segment = timelineSegments.find(
              (item) => hoverPercent >= item.left && hoverPercent <= item.left + item.width
            );
            setHoveredSegment(segment || null);
          }}
          style={{ "--progress": `${percent}%` }}
        >
          {timelineSegments.map((segment, index) => (
            <span
              className="segment-block"
              key={`${segment.startTime}-${segment.title}-${index}`}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            />
          ))}
          <span className="timeline-fill" />
          <span className="timeline-playhead" />
          {hoveredSegment ? (
            <span className={`timeline-tooltip align-${tooltipAlign}`} style={{ "--tooltip-left": `${tooltipCenter}%` }}>
              <strong>{hoveredSegment.startTime}</strong>
              <span>{hoveredSegment.summary}</span>
            </span>
          ) : null}
          <input
            className="timeline-range"
            type="range"
            min="0"
            max={durationSeconds || 1}
            step="1"
            value={Math.min(currentTime, durationSeconds || 1)}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="播放进度"
          />
        </div>
      </div>
      <div className="player-controls-row">
        <button className="player-icon" type="button" onClick={() => onSeek(Math.max(0, currentTime - 5))} title="后退5秒">
          <SkipBack size={20} />
        </button>
        <button className="play-button" type="button" onClick={onTogglePlay} title={isPlaying ? "暂停" : "播放"}>
          {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
        </button>
        <button className="player-icon" type="button" onClick={() => onSeek(Math.min(durationSeconds, currentTime + 5))} title="前进5秒">
          <SkipForward size={20} />
        </button>
        <span className="time-label">
          {secondsToTime(currentTime)} / {secondsToTime(durationSeconds)}
        </span>
        <span className="player-spacer" />
        <div className="rate-control" ref={rateMenuRef}>
          <button
            className="player-outline-button rate-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={isRateMenuOpen}
            onClick={() => setIsRateMenuOpen((value) => !value)}
          >
            {rateButtonLabel}
            <ChevronDown size={18} />
          </button>
          {isRateMenuOpen ? (
            <div className="rate-menu" role="menu">
              {playbackRateOptions.map((rate) => (
                <button
                  className={rate === playbackRate ? "active" : ""}
                  type="button"
                  role="menuitemradio"
                  aria-checked={rate === playbackRate}
                  key={rate}
                  onClick={() => {
                    onRateChange(rate);
                    setIsRateMenuOpen(false);
                  }}
                >
                  {rate === playbackRate ? <Check size={16} /> : <span />}
                  {rate}x
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function DetailPage({
  note,
  isActiveRecording,
  recordingSeconds,
  onBack,
  onExport,
  onExportAudio,
  onRegenerateQuality,
  onRecognizeSpeakers,
  onSaveTranscript,
  onStopRecording
}) {
  const [activeTab, setActiveTab] = useState("summary");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportDialogType, setExportDialogType] = useState(null);
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState(0);
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState(note.transcript);
  const [speakerNameDrafts, setSpeakerNameDrafts] = useState(() => createSpeakerNameDrafts(note.transcript));
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const audioRef = useRef(null);
  const durationSeconds = Math.max(timeToSeconds(note.duration), mediaDurationSeconds);
  const transcriptToSave = useMemo(
    () => applySpeakerNameDrafts(draftTranscript, speakerNameDrafts),
    [draftTranscript, speakerNameDrafts]
  );
  const hasTranscriptContentDraftChanges = useMemo(
    () => JSON.stringify(draftTranscript) !== JSON.stringify(note.transcript),
    [draftTranscript, note.transcript]
  );
  const hasTranscriptDraftChanges = useMemo(
    () => JSON.stringify(transcriptToSave) !== JSON.stringify(note.transcript),
    [note.transcript, transcriptToSave]
  );

  const activeLineIndex = useMemo(() => {
    let index = 0;
    note.transcript.forEach((line, lineIndex) => {
      if (timeToSeconds(line.startTime) <= currentTime) index = lineIndex;
    });
    return index;
  }, [currentTime, note.transcript]);

  const activeChapterIndex = useMemo(() => {
    let index = note.chapters.length > 0 ? 0 : -1;
    note.chapters.forEach((chapter, chapterIndex) => {
      if (timeToSeconds(chapter.startTime) <= currentTime) index = chapterIndex;
    });
    return index;
  }, [currentTime, note.chapters]);

  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
    setSearchTerm("");
    setActiveTab("summary");
    setIsExportMenuOpen(false);
    setExportDialogType(null);
    setMediaDurationSeconds(0);
    setIsTranscriptEditing(false);
    setDraftTranscript(note.transcript);
    setSpeakerNameDrafts(createSpeakerNameDrafts(note.transcript));
    window.scrollTo({ top: 0, left: 0 });
  }, [note.id]);

  useEffect(() => {
    if (!isTranscriptEditing) {
      setDraftTranscript(note.transcript);
      setSpeakerNameDrafts(createSpeakerNameDrafts(note.transcript));
    }
  }, [isTranscriptEditing, note.transcript]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, note.audioUrl]);

  useEffect(() => {
    if (!audioRef.current || !note.audioUrl) return;
    const audio = audioRef.current;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
    };
  }, [note.audioUrl]);

  useEffect(() => {
    if (note.audioUrl || !isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => {
        const nextValue = value + playbackRate;
        if (nextValue >= durationSeconds) {
          setIsPlaying(false);
          return durationSeconds;
        }
        return nextValue;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [durationSeconds, isPlaying, note.audioUrl, playbackRate]);

  const seek = (seconds, keepPlaying = isPlaying) => {
    const safeTime = Math.min(Math.max(0, seconds), durationSeconds || seconds);
    setCurrentTime(safeTime);
    if (audioRef.current) {
      audioRef.current.currentTime = safeTime;
      if (keepPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }
  };

  const togglePlay = () => {
    if (note.audioUrl && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
        audioRef.current.pause();
      }
      return;
    }
    setIsPlaying((value) => !value);
  };

  const updateDraftLine = (lineIndex, patch) => {
    setDraftTranscript((currentTranscript) =>
      currentTranscript.map((line, index) => (index === lineIndex ? { ...line, ...patch } : line))
    );
  };

  const renameDraftSpeaker = (speakerId, newName) => {
    setSpeakerNameDrafts((currentDrafts) =>
      currentDrafts.map((speakerDraft) =>
        speakerDraft.id === speakerId ? { ...speakerDraft, draftName: newName } : speakerDraft
      )
    );
  };

  const startTranscriptEdit = () => {
    setDraftTranscript(note.transcript);
    setSpeakerNameDrafts(createSpeakerNameDrafts(note.transcript));
    setIsTranscriptEditing(true);
  };

  const cancelTranscriptEdit = () => {
    setDraftTranscript(note.transcript);
    setSpeakerNameDrafts(createSpeakerNameDrafts(note.transcript));
    setIsTranscriptEditing(false);
  };

  const saveTranscriptEdit = async (shouldRegenerate = false) => {
    setIsSavingTranscript(true);
    try {
      const savedNote = await onSaveTranscript(note.id, transcriptToSave, shouldRegenerate, {
        markSummaryStale: shouldRegenerate || hasTranscriptContentDraftChanges
      });
      setDraftTranscript(savedNote.transcript || draftTranscript);
      setSpeakerNameDrafts(createSpeakerNameDrafts(savedNote.transcript || draftTranscript));
      setIsTranscriptEditing(false);
    } catch (error) {
      window.alert(error?.message || "保存全文失败");
    } finally {
      setIsSavingTranscript(false);
    }
  };

  return (
    <main className="detail-page">
      <header className="detail-topbar">
        <button className="breadcrumb-button" type="button" onClick={onBack}>
          <ChevronLeft size={20} />
          <span>录音纪要 / {note.title}</span>
        </button>
        <div className="export-controls">
          <button className="quality-button" type="button"
            disabled={processingStatuses.has(note.status) || ["recording","finalizing"].includes(note.status)}
            onClick={()=>onRecognizeSpeakers(note.id)}>
            <Users size={17}/>{note.speakerRecognition?.status==='done'?'重新区分讲话人':'区分讲话人'}
          </button>
          <button
            className="quality-button"
            type="button"
            disabled={processingStatuses.has(note.status) || ["recording", "finalizing"].includes(note.status)}
            onClick={() => onRegenerateQuality(note.id)}
          >
            <RefreshCw size={17} />
            重新生成总结
          </button>
          <button className="export-button" disabled={processingStatuses.has(note.status)} type="button" onClick={() => setIsExportMenuOpen((value) => !value)}>
            <Download size={18} />
            导出
          </button>
          {isExportMenuOpen ? (
            <ExportMenu
              note={note}
              onChooseType={(type) => {
                setIsExportMenuOpen(false);
                setExportDialogType(type);
              }}
              onExportAudio={(currentNote) => {
                setIsExportMenuOpen(false);
                onExportAudio(currentNote);
              }}
            />
          ) : null}
        </div>
      </header>

      {isActiveRecording || note.status === "finalizing" ? (
        <section className="live-recording-bar" aria-live="polite">
          <span className="live-recording-dot" />
          <span className="live-recording-copy">
            <strong>{isActiveRecording ? `正在录音 ${secondsToTime(recordingSeconds)}` : "录音已保存"}</strong>
            <small>{note.recordingMessage || "正在进行秒级转录和句末纠错"}</small>
          </span>
          {isActiveRecording ? (
            <button className="live-stop-button" type="button" onClick={onStopRecording}>
              <Square size={16} fill="currentColor" />
              停止录音
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="detail-grid">
        <div className="transcript-column">
          <TranscriptPanel
            note={note}
            searchTerm={searchTerm}
            activeLineIndex={activeLineIndex}
            draftTranscript={draftTranscript}
            hasDraftChanges={hasTranscriptDraftChanges}
            isEditing={isTranscriptEditing}
            isSavingTranscript={isSavingTranscript}
            speakerNameDrafts={speakerNameDrafts}
            onCancelEdit={cancelTranscriptEdit}
            onDraftLineChange={updateDraftLine}
            onRenameDraftSpeaker={renameDraftSpeaker}
            onSaveEdit={saveTranscriptEdit}
            onSearch={setSearchTerm}
            onSeek={seek}
            onStartEdit={startTranscriptEdit}
          />
          <PlayerBar
            audioRef={audioRef}
            currentTime={currentTime}
            durationSeconds={durationSeconds}
            isPlaying={isPlaying}
            note={note}
            onDurationKnown={setMediaDurationSeconds}
            playbackRate={playbackRate}
            onRateChange={setPlaybackRate}
            onSeek={seek}
            onTogglePlay={togglePlay}
          />
        </div>
        <SummaryPanel note={note} activeChapterIndex={activeChapterIndex} activeTab={activeTab} onTabChange={setActiveTab} onSeek={seek} />
      </div>
      {exportDialogType ? (
        <ExportDialog
          note={note}
          type={exportDialogType}
          onClose={() => setExportDialogType(null)}
          onConfirm={(currentNote, type, settings) => {
            onExport(currentNote, type, settings);
            setExportDialogType(null);
          }}
        />
      ) : null}
    </main>
  );
}

function createFailedNote(fileName, error) {
  return {
    id: `failed-${Date.now()}`,
    title: fileName,
    duration: "00:00",
    createdAt: nowStamp(),
    status: "failed",
    error,
    keywords: ["导入失败"],
    summaryLead: error,
    summaryItems: [],
    chapters: [],
    transcript: [],
    audioUrl: ""
  };
}

function isAcceptedAudio(file) {
  const lowerName = file.name.toLowerCase();
  return file.type.startsWith("audio/") || acceptedAudioExtensions.some((extension) => lowerName.endsWith(extension));
}

function removeTranscriptOverlap(previousText, nextText) {
  const previous = String(previousText || "").trim();
  const next = String(nextText || "").trim();
  if (!previous || !next) return next;
  if (previous.endsWith(next)) return "";
  for (let length = Math.min(previous.length, next.length, 80); length >= 2; length -= 1) {
    if (previous.slice(-length) === next.slice(0, length)) return next.slice(length).trim();
  }
  return next;
}

function App() {
  const [isAISettingsOpen,setIsAISettingsOpen]=useState(()=>window.location.hash==='#/settings');
  const [aiSettings,setAISettings]=useState(null);
  const settingsReceiver=useRef(null);
  if(!settingsReceiver.current)settingsReceiver.current=createSettingsReceiver(setAISettings);
  const [notes, setNotes] = useState([]);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTargetIds, setDeleteTargetIds] = useState([]);
  const [isTermFixDialogOpen, setIsTermFixDialogOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioGainRef = useRef(null);
  const chunkerRef = useRef(null);
  const activeRecordingNoteIdRef = useRef(null);
  const transcriptionQueueRef = useRef(Promise.resolve());
  const liveTranscriptRef = useRef([]);
  const liveTranscriptionFailedRef = useRef(false);
  const isStoppingRef = useRef(false);

  const selectedNote = notes.find((note) => note.id === selectedNoteId) || null;

  useEffect(()=>{
    const sync=()=>setIsAISettingsOpen(window.location.hash==='#/settings');
    window.addEventListener('hashchange',sync);
    settingsReceiver.current.read(fetchAISettings).catch(()=>{});
    return()=>{window.removeEventListener('hashchange',sync);settingsReceiver.current.cancel();};
  },[]);

  useEffect(() => {
    setSelectedNoteIds((currentIds) => currentIds.filter((id) => notes.some((note) => note.id === id)));
  }, [notes]);

  const loadNotes = useCallback(async () => {
    setIsLoadingNotes(true);
    try {
      const nextNotes = await fetchNotes();
      setNotes(nextNotes);
      setApiError("");
    } catch (error) {
      setApiError(`本地后端未连接或处理异常：${error?.message || "请先运行 npm run server"}`);
    } finally {
      setIsLoadingNotes(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const hasActiveJob = notes.some((note) => processingStatuses.has(note.status));
    if (!hasActiveJob) return undefined;
    const timer = window.setInterval(() => {
      loadNotes();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadNotes, notes]);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (!isAcceptedAudio(file)) {
        setNotes((currentNotes) => [createFailedNote(file.name, "仅支持 mp3、m4a、wav 等音频文件。"), ...currentNotes]);
        continue;
      }
      try {
        const importedNote = await importAudioFile(file);
        setNotes((currentNotes) => [importedNote, ...currentNotes.filter((note) => note.id !== importedNote.id)]);
      } catch (error) {
        setNotes((currentNotes) => [
          createFailedNote(file.name, error?.message || "导入失败，请确认本地后端已启动。"),
          ...currentNotes
        ]);
      }
    }
    loadNotes();
  }, [loadNotes]);

  const handleFileInput = (event) => {
    handleFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragging(false);
  };

  const updateLocalNote = (noteId, updater) => {
    setNotes((currentNotes) => currentNotes.map((note) => (note.id === noteId ? updater(note) : note)));
  };

  const enqueueLiveChunk = (noteId, chunk) => {
    const run = async () => {
      try {
        const result = await transcribeChunk({ sessionId: noteId, ...chunk });
        const lineId = `live-${result.utteranceId}`;
        const currentTranscript = liveTranscriptRef.current;
        const existingIndex = currentTranscript.findIndex((line) => line.lineId === lineId);
        const existingLine = existingIndex >= 0 ? currentTranscript[existingIndex] : null;
        const previousText = existingIndex >= 0 ? "" : currentTranscript.at(-1)?.text;
        const text = removeTranscriptOverlap(previousText, result.text);
        const lineText = text || existingLine?.text || "";
        let transcript = currentTranscript;
        if (lineText) {
          const nextLine = {
            lineId,
            utteranceId: result.utteranceId,
            speaker: String(result.speaker || existingLine?.speaker || "讲话人1"),
            startTime: secondsToTime(result.startSeconds),
            text: lineText,
            isInterim: !result.final
          };
          transcript = existingIndex >= 0
            ? currentTranscript.map((line, index) => (index === existingIndex ? nextLine : line))
            : [...currentTranscript, nextLine];
        }
        transcript = applySpeakerAssignments(transcript, result.speakerAssignments);
        liveTranscriptRef.current = transcript;
        updateLocalNote(noteId, (note) => ({
          ...note,
          transcript,
          recordingMessage: result.speakerStatus === "disabled"
            ? result.final ? "上一句话已确认，录音结束后区分讲话人" : "正在快速转写，录音结束后区分讲话人"
            : result.speakerStatus === "unavailable"
            ? "实时转录正常，说话人区分暂不可用"
            : result.final
              ? "上一句话及说话人已纠错确认"
              : "正在秒级转录，最后一句和说话人可能自动纠错"
        }));
      } catch (error) {
        liveTranscriptionFailedRef.current = true;
        updateLocalNote(noteId, (note) => ({
          ...note,
          recordingMessage: "实时转录暂不可用，录音仍在保存",
          liveTranscriptionError: error?.message || "实时转录暂不可用"
        }));
      }
    };
    transcriptionQueueRef.current = transcriptionQueueRef.current.then(run, run);
  };

  const releaseLiveAudio = () => {
    if (audioProcessorRef.current) {
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current.disconnect();
    }
    audioSourceRef.current?.disconnect();
    audioGainRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioGainRef.current = null;
  };

  const stopRecording = () => {
    if (isStoppingRef.current || !recorderRef.current) return;
    isStoppingRef.current = true;
    const noteId = activeRecordingNoteIdRef.current;
    chunkerRef.current?.flush();
    releaseLiveAudio();
    if (noteId) {
      updateLocalNote(noteId, (note) => ({
        ...note,
        status: "finalizing",
        recordingMessage: "录音已保存，正在补全最后内容"
      }));
    }
    setIsRecording(false);
    recorderRef.current.stop();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const noteId = `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const fileName = `本地录音 ${nowStamp()}.webm`;
      const liveNote = {
        id: noteId,
        title: fileName,
        duration: "00:00",
        createdAt: nowStamp(),
        status: "recording",
        asrMode: "fast",
        error: "",
        keywords: ["正在录音"],
        summaryLead: "录音结束并完成转写后，将在这里生成总结概要。",
        summaryItems: [],
        chapters: [],
        transcript: [],
        audioUrl: "",
        recordingMessage: "正在秒级转录，停顿后自动纠错"
      };
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      activeRecordingNoteIdRef.current = noteId;
      transcriptionQueueRef.current = Promise.resolve();
      liveTranscriptRef.current = [];
      liveTranscriptionFailedRef.current = false;
      isStoppingRef.current = false;
      setRecordingSeconds(0);
      setNotes((currentNotes) => [liveNote, ...currentNotes]);
      setSelectedNoteId(noteId);

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      const chunker = new RollingSpeechChunker({
        sampleRate: audioContext.sampleRate,
        onChunk: (chunk) => enqueueLiveChunk(noteId, chunk)
      });
      processor.onaudioprocess = (event) => chunker.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioGainRef.current = silentGain;
      chunkerRef.current = chunker;

      checkAsrHealth().then((ready) => {
        if (!ready) {
          updateLocalNote(noteId, (note) => ({
            ...note,
            recordingMessage: "转录服务正在准备，录音已正常保存"
          }));
        }
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      });

      recorder.addEventListener("stop", async () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], fileName, { type: blob.type });
        const localAudioUrl = URL.createObjectURL(blob);
        stream.getTracks().forEach((track) => track.stop());
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        updateLocalNote(noteId, (note) => ({ ...note, audioUrl: localAudioUrl, status: "finalizing" }));
        await transcriptionQueueRef.current;
        await clearAsrSession(noteId);
        try {
          const confirmedTranscript = liveTranscriptRef.current.map(({ isInterim: _isInterim, ...line }) => line);
          const importedNote = await finalizeLiveRecording(file, confirmedTranscript, { forceTranscription: liveTranscriptionFailedRef.current });
          setNotes((currentNotes) => [
            importedNote,
            ...currentNotes.filter((note) => note.id !== noteId && note.id !== importedNote.id)
          ]);
          setSelectedNoteId(importedNote.id);
          setApiError("");
          loadNotes();
        } catch (error) {
          updateLocalNote(noteId, (note) => ({
            ...note,
            status: "failed",
            error: error?.message || "录音已保留，但提交正式转写失败。"
          }));
        } finally {
          activeRecordingNoteIdRef.current = null;
          recorderRef.current = null;
          chunkerRef.current = null;
          isStoppingRef.current = false;
        }
      });

      recorder.start();
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((value) => {
          const nextValue = value + 1;
          updateLocalNote(noteId, (note) => ({ ...note, duration: secondsToTime(nextValue) }));
          return nextValue;
        });
      }, 1000);
    } catch (error) {
      setNotes((currentNotes) => [
        createFailedNote("麦克风录音", error?.message || "无法获取麦克风权限，请检查浏览器授权。"),
        ...currentNotes
      ]);
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    startRecording();
  };

  const handleRetry = (event, noteId) => {
    event.stopPropagation();
    if (String(noteId).startsWith("failed-")) {
      setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
      return;
    }
    retryNote(noteId)
      .then((note) => {
        setNotes((currentNotes) => currentNotes.map((currentNote) => (currentNote.id === note.id ? note : currentNote)));
        loadNotes();
      })
      .catch((error) => {
        window.alert(error?.message || "重新处理失败");
      });
  };

  const toggleNoteSelection = (noteId) => {
    setSelectedNoteIds((currentIds) =>
      currentIds.includes(noteId) ? currentIds.filter((id) => id !== noteId) : [...currentIds, noteId]
    );
  };

  const toggleSelectAll = () => {
    setSelectedNoteIds((currentIds) => (currentIds.length === notes.length ? [] : notes.map((note) => note.id)));
  };

  const requestDeleteNotes = (ids) => {
    const deletableIds = ids.filter((id) => {
      const note = notes.find((item) => item.id === id);
      return note && !processingStatuses.has(note.status);
    });
    if (deletableIds.length === 0) {
      window.alert("正在处理的录音先不要直接删除，避免打断本地转写。完成或失败后即可删除。");
      return;
    }
    setDeleteTargetIds(deletableIds);
  };

  const confirmDeleteNotes = async () => {
    const ids = deleteTargetIds;
    if (ids.length === 0) return;
    try {
      const serverIds = ids.filter((id) => !String(id).startsWith("failed-"));
      if (serverIds.length > 0) await deleteNotes(serverIds);
      setNotes((currentNotes) => currentNotes.filter((note) => !ids.includes(note.id)));
      setSelectedNoteIds((currentIds) => currentIds.filter((id) => !ids.includes(id)));
      if (selectedNoteId && ids.includes(selectedNoteId)) setSelectedNoteId(null);
      setDeleteTargetIds([]);
      loadNotes();
    } catch (error) {
      window.alert(error?.message || "删除失败");
    }
  };

  const confirmRenameNote = async (title) => {
    if (!renameTarget || !title.trim()) return;
    try {
      const renamedNote = await renameNote(renameTarget.id, title.trim());
      setNotes((currentNotes) => currentNotes.map((note) => (note.id === renamedNote.id ? renamedNote : note)));
      setRenameTarget(null);
    } catch (error) {
      window.alert(error?.message || "重命名失败");
    }
  };

  const exportNote = async (note, type, settings) => {
    try {
      await exportNoteFile(note, type, settings);
    } catch (error) {
      window.alert(error?.message || "导出失败");
    }
  };

  const exportAudio = async (note) => {
    try {
      await exportNoteFile(note, "audio");
    } catch (error) {
      window.alert(error?.message || "导出音频失败");
    }
  };

  const saveNoteTranscript = async (noteId, transcript, shouldRegenerate = false, options = {}) => {
    const savedNote = await saveTranscript(noteId, transcript, {
      markSummaryStale: options.markSummaryStale !== false
    });
    setNotes((currentNotes) => currentNotes.map((currentNote) => (currentNote.id === savedNote.id ? savedNote : currentNote)));
    if (!shouldRegenerate) {
      loadNotes();
      return savedNote;
    }
    const summarizedNote = await resummarizeNote(noteId);
    setNotes((currentNotes) => currentNotes.map((currentNote) => (currentNote.id === summarizedNote.id ? summarizedNote : currentNote)));
    loadNotes();
    return summarizedNote;
  };

  const regenerateQuality = async (noteId) => {
    try {
      const note = await resummarizeNote(noteId);
      setNotes((currentNotes) => currentNotes.map((currentNote) => (currentNote.id === note.id ? note : currentNote)));
      loadNotes();
    } catch (error) {
      window.alert(error?.message || "重新生成总结失败");
      loadNotes();
    }
  };

  const runSpeakerRecognition = async(noteId)=>{
    try{
      const note=await recognizeSpeakers(noteId);
      setNotes(current=>current.map(row=>row.id===note.id?note:row));
      loadNotes();
    }catch(error){window.alert(error?.message || '讲话人区分启动失败');}
  };

  if(isAISettingsOpen)return <AISettingsPage onBack={()=>{window.location.hash='';}} onSaved={settingsReceiver.current.saved}/>;

  if (selectedNote) {
    return (
      <DetailPage
        note={selectedNote}
        isActiveRecording={isRecording && activeRecordingNoteIdRef.current === selectedNote.id}
        recordingSeconds={recordingSeconds}
        onBack={() => setSelectedNoteId(null)}
        onExport={exportNote}
        onExportAudio={exportAudio}
        onRegenerateQuality={regenerateQuality}
        onRecognizeSpeakers={runSpeakerRecognition}
        onSaveTranscript={saveNoteTranscript}
        onStopRecording={stopRecording}
      />
    );
  }

  return (
    <>
      <HomePage
        apiError={apiError}
        isLoadingNotes={isLoadingNotes}
        notes={notes}
        selectedIds={selectedNoteIds}
        isDragging={isDragging}
        isRecording={isRecording}
        recordingSeconds={recordingSeconds}
        onDeleteNotes={requestDeleteNotes}
        onDeleteSelected={() => requestDeleteNotes(selectedNoteIds)}
        onDragEnter={() => setIsDragging(true)}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileInput={handleFileInput}
        onOpenTermFixes={() => setIsTermFixDialogOpen(true)}
        onOpenAISettings={()=>{window.location.hash='/settings';}}
        aiConfigured={aiSettings?.hasApiKey}
        onOpen={setSelectedNoteId}
        onRefresh={loadNotes}
        onRename={setRenameTarget}
        onRetry={handleRetry}
        onSelectAll={toggleSelectAll}
        onToggleSelect={toggleNoteSelection}
        onToggleRecording={handleToggleRecording}
      />
      {renameTarget ? (
        <RenameDialog note={renameTarget} onClose={() => setRenameTarget(null)} onConfirm={confirmRenameNote} />
      ) : null}
      {deleteTargetIds.length > 0 ? (
        <ConfirmDialog
          title="删除记录"
          message={`确定删除选中的 ${deleteTargetIds.length} 条记录吗？音频、转写和总结都会从本地数据目录移除。`}
          confirmLabel="删除"
          danger
          onClose={() => setDeleteTargetIds([])}
          onConfirm={confirmDeleteNotes}
        />
      ) : null}
      {isTermFixDialogOpen ? (
        <TermFixDialog
          onClose={() => setIsTermFixDialogOpen(false)}
          onSaved={loadNotes}
        />
      ) : null}
    </>
  );
}

export default App;
