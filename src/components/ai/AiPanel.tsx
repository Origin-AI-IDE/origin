import { useRef, useCallback, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, History, Plus, Pin, PinOff, ChevronRight, ChevronDown, ArrowUpRight, FileCode, Trash2 } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import ChatBox from "./ChatBox";
import MarkdownMessage from "./MarkdownMessage";
import { PROVIDERS } from "./providers";
import { streamChat, type ChatMessage, type UsageData, DEFAULT_SYSTEM_PROMPT, CODE_EDIT_PREFIX } from "../../lib/ai";
import { ensurePricing, computeCost } from "../../lib/pricing";
import { recordUsage } from "../../lib/usage";
import { loadApiKey } from "../../lib/secrets";
import { readFile } from "../../lib/fs";
import {
  initDb,
  createSession,
  touchSession,
  insertMessage,
  updateMessageContent,
  loadMessages,
  deleteSession,
  type DbSession,
  type DbMessage,
} from "../../lib/db";
import type { EditorContext } from "../editor/Editor";
import { useWorkspace } from "../../context/WorkspaceContext";

function HeaderBtn({ label, active, onClick, onMouseEnter, onMouseLeave, children }: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center rounded"
      style={{
        width: 26, height: 26, background: "none", border: "none", cursor: "pointer",
        color: active ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = "var(--origin-fg-default)";
        e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
        onMouseEnter?.(e);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = active ? "var(--origin-fg-default)" : "var(--origin-fg-muted)";
        e.currentTarget.style.backgroundColor = "transparent";
        onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 340,
          borderRadius: "10px",
          border: "1px solid var(--origin-border-default)",
          backgroundColor: "var(--origin-bg-sidebar)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--origin-fg-default)", marginBottom: "6px" }}>
            {title}
          </div>
          <div style={{ fontSize: "13px", color: "var(--origin-fg-muted)", lineHeight: 1.55 }}>
            {message}
          </div>
        </div>
        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "18px 20px" }}>
          <button
            onClick={onCancel}
            autoFocus
            style={{
              padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
              background: "var(--origin-bg-active)",
              border: "1px solid var(--origin-border-default)",
              color: "var(--origin-fg-default)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--origin-bg-active)"; }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
              background: "#dc2626",
              border: "1px solid transparent",
              color: "#fff",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#b91c1c"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#dc2626"; }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecentSessions({ sessions, onSelect, onShowAll }: { sessions: DbSession[]; onSelect: (id: string) => void; onShowAll?: () => void }) {
  return (
    <div style={{ padding: "20px 14px 0" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Recent
        </span>
        {sessions.length > 5 && (
          <button onClick={onShowAll} style={{ marginLeft: "auto", fontSize: "11px", color: "var(--origin-fg-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Show all
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div style={{ fontSize: "12px", color: "var(--origin-fg-subtle)", padding: "6px 0" }}>
          No sessions for this project yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          {sessions.slice(0, 5).map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{
                display: "flex", alignItems: "center", width: "100%",
                padding: "7px 8px", borderRadius: "6px",
                background: "none", border: "none", cursor: "pointer", gap: "8px",
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span style={{ flex: 1, fontSize: "12px", color: "var(--origin-fg-default)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.title}
              </span>
              <ChevronRight size={13} style={{ color: "var(--origin-fg-subtle)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Foolproof target-file resolver. Resolves the LLM's "// file: <x>" marker
// against ground-truth signals (the user's attached files, then open tabs,
// then the captured active file) so a diff always lands on the right file.
function resolveTargetPath(
  llmFilePath: string | undefined,       // from "// file: <x>" in LLM response
  messageMentions: string[] | undefined, // fileMentions stored on the assistant message
  sourceFilePath: string | undefined,    // captured active file at send time
  folderPath: string,                    // workspace root (reserved for future use)
  openTabPaths: string[],                // currently open tab paths
): string | undefined {
  void folderPath;
  const normLlm = llmFilePath ? llmFilePath.replace(/\\/g, '/').toLowerCase() : undefined;

  // ── Priority 1: match LLM marker against the message's own attached files ──
  // This is ground truth — the user explicitly attached these files.
  if (normLlm && messageMentions && messageMentions.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    // Try longest-suffix match first (e.g. "lib/funds.ts" beats bare "funds.ts")
    const byLongestSuffix = messageMentions
      .map(p => ({ p, norm: p.replace(/\\/g, '/').toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (byLongestSuffix.length > 0) return byLongestSuffix[0].p;

    // Basename-only match against attached files
    const byBasename = messageMentions.filter(p =>
      (p.split(/[/\\]/).pop() ?? '').toLowerCase() === name
    );
    if (byBasename.length === 1) return byBasename[0];
    if (byBasename.length > 1) {
      // Ambiguous among attached files — prefer sourceFilePath if it's one of them
      const preferred = byBasename.find(p => p === sourceFilePath);
      return preferred ?? byBasename[0]; // take first as tiebreak, never silently fail
    }
  }

  // ── Priority 2: single attached file, marker absent or non-matching ─────────
  // If only one file was attached the intent is unambiguous — use that file.
  if (!normLlm && messageMentions?.length === 1) return messageMentions[0];
  if (messageMentions?.length === 1) return messageMentions[0]; // marker didn't match but only one file

  // ── Priority 3: match LLM marker against ALL open tabs (suffix then basename) ─
  // Safety net when the file wasn't attached but the LLM named it.
  if (normLlm && openTabPaths.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    const bySuffix = openTabPaths
      .map(p => ({ p, norm: p.replace(/\\/g, '/').toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (bySuffix.length > 0) return bySuffix[0].p;

    const byBasename = openTabPaths.filter(p =>
      (p.split(/[/\\]/).pop() ?? '').toLowerCase() === name
    );
    if (byBasename.length >= 1) {
      const preferred = byBasename.find(p => p === sourceFilePath);
      return preferred ?? byBasename[0];
    }
  }

  // ── Priority 4: sourceFilePath (captured active tab at send time) ────────────
  if (sourceFilePath) return sourceFilePath;

  return undefined;
}

function extractFirstCompleteBlock(content: string): { code: string; language: string; filePath?: string } | null {
  // SEARCH/REPLACE block (new format) — complete when >>>>>>> UPDATED appears.
  const srMatch = /((?:(?:\/\/|#) file: ([^\n]+))\n)?<<<<<<< ORIGINAL\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> UPDATED/.exec(content);
  if (srMatch) {
    return {
      filePath: srMatch[2]?.trim(),
      language: 'diff',
      code: `<<<<<<< ORIGINAL\n${srMatch[3]}\n=======\n${srMatch[4]}\n>>>>>>> UPDATED`,
    };
  }
  // Legacy: fenced code block with file annotation
  const withFile = /(?:^|\n)(?:\/\/|#) file: ([^\n]+)\n```(\w*)\n([\s\S]*?)\n```/.exec(content);
  if (withFile) {
    return { filePath: withFile[1].trim(), language: withFile[2] || 'text', code: withFile[3] };
  }
  // Legacy: plain fenced block
  const plain = /^```(\w*)\n([\s\S]*?)\n```/m.exec(content);
  if (!plain) return null;
  return { language: plain[1] || 'text', code: plain[2] };
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MessageBubble({
  message,
  folderPath,
  onApplyCode,
  getOpenTabPaths,
  onResolveFail,
  onPin,
}: {
  message: DisplayMessage;
  folderPath?: string | null;
  onApplyCode?: (code: string, filePath?: string, ctx?: EditorContext) => void;
  getOpenTabPaths?: () => string[];
  onResolveFail?: () => void;
  onPin?: (content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const isEmpty = !message.content && !isUser;
  const hasAttachments = isUser && (
    (message.fileMentions && message.fileMentions.length > 0) || message.editorContext
  );

  const badgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    background: "var(--origin-bg-active)",
    border: "1px solid var(--origin-border-default)",
    color: "var(--origin-fg-default)",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{ marginBottom: "20px" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        marginBottom: "5px",
      }}>
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--origin-fg-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}>
          {isUser ? "You" : "Assistant"}
        </span>
        {!isUser && onPin && hovered && message.content && !message.streaming && (
          <button
            onClick={() => onPin(message.content)}
            title="Pin to Pinboard"
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "3px",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: "4px",
              color: "var(--origin-fg-subtle)",
              fontSize: "10px",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Pin size={11} />
          </button>
        )}
      </div>

      {isEmpty ? (
        <span style={{
          display: "inline-block",
          width: "2px",
          height: "13px",
          backgroundColor: "var(--origin-fg-muted)",
          verticalAlign: "text-bottom",
          animation: "blink 1s step-end infinite",
        }} />
      ) : isUser ? (
        <div style={{
          fontSize: "13px",
          color: "var(--origin-fg-default)",
          lineHeight: "1.65",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {message.content}
        </div>
      ) : (
        <MarkdownMessage
          content={message.content}
          isStreaming={message.streaming}
          onApplyCode={onApplyCode
            ? (code, _lang, filePath) => {
                // Resolve the LLM's "// file:" marker against ground-truth
                // signals (attached files → open tabs → captured active file).
                const resolved = resolveTargetPath(
                  filePath,
                  message.fileMentions,
                  message.sourceFilePath,
                  folderPath ?? '',
                  getOpenTabPaths?.() ?? [],
                );
                if (!resolved) {
                  console.warn('[AiPanel] Could not determine target file for this code block.');
                  onResolveFail?.();
                  return;
                }
                onApplyCode(code, resolved, message.editorContext ?? undefined);
              }
            : undefined}
        />
      )}

      {hasAttachments && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
          {message.editorContext && (
            <span style={badgeStyle as React.CSSProperties}>
              <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
              <span>{message.editorContext.filename}</span>
              <span style={{
                padding: "0 4px",
                borderRadius: "3px",
                fontSize: "10px",
                background: "var(--origin-bg-hover)",
                color: "var(--origin-fg-muted)",
              }}>
                {contextLabel(message.editorContext)}
              </span>
            </span>
          )}
          {message.fileMentions?.map(fp => {
            const fname = fp.split(/[\/\\]/).pop() ?? fp;
            return (
              <span key={fp} style={badgeStyle as React.CSSProperties}>
                <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
                {fname}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MIN_WIDTH    = 240;
const MAX_WIDTH    = 600;
const DEFAULT_WIDTH = 320;

const CTX_MIN     = 160;
const CTX_MAX     = 480;
const CTX_DEFAULT = 200;

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "vllm"]);

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  sourceFilePath?: string;
  fileMentions?: string[];
  editorContext?: EditorContext | null;
}

function contextLabel(ctx: EditorContext): string {
  if (ctx.startLine === ctx.endLine) return `L${ctx.startLine}`;
  return `L${ctx.startLine}–${ctx.endLine}`;
}

function buildContextPrefix(ctx: EditorContext): string {
  const ext = ctx.filename.split('.').pop()?.toLowerCase() ?? '';
  const fenceMap: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', rs: 'rs',
    py: 'python', css: 'css', html: 'html', json: 'json', md: 'markdown',
  };
  const fence = fenceMap[ext] ?? ext;
  const label = ctx.type === 'selection' ? 'Selected code' : 'Visible code';
  return `[${label} in ${ctx.filename}]\n\`\`\`${fence}\n${ctx.code}\n\`\`\`\n\n`;
}

function dbMsgsToDisplay(msgs: DbMessage[]): DisplayMessage[] {
  const filtered = msgs.filter(m => m.message_type === 'user' || m.message_type === 'assistant');
  // Track the most recent user message's single attachment so an assistant
  // reply can recover the sourceFilePath it was generated against. Without
  // this, restored sessions lose sourceFilePath and the Apply button falls
  // back to whatever tab is currently active (the wrong file).
  let lastUserSingleMention: string | undefined;
  return filtered.map(m => {
    const interrupted = m.status === 'interrupted';
    const content = interrupted
      ? m.content
        ? m.content + '\n\n[Response interrupted]'
        : '[Response interrupted]'
      : m.content;
    const fileMentions = m.attachments_json
      ? (JSON.parse(m.attachments_json) as string[])
      : undefined;
    if (m.message_type === 'user') {
      lastUserSingleMention = fileMentions?.length === 1 ? fileMentions[0] : undefined;
    }
    return {
      role: m.message_type as 'user' | 'assistant',
      content,
      sourceFilePath: m.message_type === 'assistant' ? lastUserSingleMention : undefined,
      fileMentions,
      editorContext: m.editor_context_json
        ? { ...(JSON.parse(m.editor_context_json) as object), code: '', language: '' } as EditorContext
        : undefined,
    };
  });
}

function activeSessionKey(folderPath: string): string {
  return `origin-active-session:${folderPath}`;
}

// ── localStorage session metadata (primary source for Recent list) ────────────

const LS_SESSIONS_KEY = 'origin-sessions-v1';

interface SessionMeta {
  id: string;
  title: string;
  workspace_path: string;
  updated_at: number;
}

function lsRead(): SessionMeta[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS_KEY) ?? '[]'); }
  catch { return []; }
}

function lsPush(meta: SessionMeta) {
  const all = lsRead().filter(s => s.id !== meta.id);
  all.unshift(meta);
  localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(all.slice(0, 100)));
}

function lsTouch(id: string) {
  const all = lsRead();
  const idx = all.findIndex(s => s.id === id);
  if (idx >= 0) {
    all[idx].updated_at = Date.now();
    all.unshift(...all.splice(idx, 1));
    localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(all.slice(0, 100)));
  }
}

function lsDelete(id: string) {
  const all = lsRead().filter(s => s.id !== id);
  localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(all));
}

function lsForPath(workspacePath: string): DbSession[] {
  return lsRead()
    .filter(s => s.workspace_path === workspacePath)
    .map(s => ({
      id: s.id,
      title: s.title,
      workspace_path: s.workspace_path,
      active_model: '',
      active_provider: '',
      created_at: s.updated_at,
      updated_at: s.updated_at,
    }));
}

// ── Pinboard ──────────────────────────────────────────────────────────────────

interface PinnedMessage {
  id: string;
  content: string;
  pinnedAt: number;
  sessionId?: string;
  label?: string;
}

function pinPreview(pin: PinnedMessage): string {
  if (pin.label) return pin.label;
  return pin.content
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/`[^`]+`/g, s => s.slice(1, -1))
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 72);
}

const PINBOARD_KEY = (fp: string) => `origin-pinboard:${fp || 'global'}`;
const NOTES_KEY    = (fp: string) => `origin-pinboard-notes:${fp || 'global'}`;

function pbRead(fp: string): PinnedMessage[] {
  try { return JSON.parse(localStorage.getItem(PINBOARD_KEY(fp)) ?? '[]'); }
  catch { return []; }
}
function pbWrite(fp: string, pins: PinnedMessage[]) {
  localStorage.setItem(PINBOARD_KEY(fp), JSON.stringify(pins));
}

function PinLabelPopover({ onConfirm, onCancel }: {
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 320, borderRadius: '10px', border: '1px solid var(--origin-border-default)', backgroundColor: 'var(--origin-bg-sidebar)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', padding: '20px' }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--origin-fg-default)', marginBottom: '4px' }}>
          Pin message
        </div>
        <div style={{ fontSize: '12px', color: 'var(--origin-fg-muted)', marginBottom: '14px' }}>
          Add a label to find it quickly. Leave blank to use a content preview.
        </div>
        <input
          ref={inputRef}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(label.trim()); } }}
          placeholder="e.g. auth fix, regex approach…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--origin-bg-base)', border: '1px solid var(--origin-border-default)',
            borderRadius: '6px', padding: '7px 10px', fontSize: '13px',
            color: 'var(--origin-fg-default)', outline: 'none', fontFamily: 'var(--font-sans)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button
            onClick={onCancel}
            style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', background: 'var(--origin-bg-active)', border: '1px solid var(--origin-border-default)', color: 'var(--origin-fg-default)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--origin-bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--origin-bg-active)'; }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(label.trim())}
            style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', background: 'var(--origin-fg-default)', border: '1px solid transparent', color: 'var(--origin-bg-base)' }}
          >
            Pin
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AiPanelProps {
  getEditorContext?: () => EditorContext | null;
  getActiveFilePath?: () => string | null;
  forcedContext?: EditorContext | null;
  onForcedContextConsumed?: () => void;
  onApplyCode?: (code: string, filePath?: string, ctx?: EditorContext) => void;
  getOpenTabPaths?: () => string[];
}

export default function AiPanel({ getEditorContext, getActiveFilePath, forcedContext, onForcedContextConsumed, onApplyCode, getOpenTabPaths }: AiPanelProps) {
  const { folderPath } = useWorkspace();
  const [width, setWidth] = useState(() => {
    const n = parseInt(localStorage.getItem("origin-ai-panel-width") ?? "", 10);
    return isNaN(n) ? DEFAULT_WIDTH : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  });
  const [contextOpen, setContextOpen] = useState(false);
  const [chatView, setChatView] = useState<"new" | "chat" | "history">(() => {
    const stored = localStorage.getItem("origin-ai-chat-view");
    return (stored === "new" || stored === "chat") ? stored : "new";
  });
  const [contextWidth, setContextWidth] = useState(() => {
    const n = parseInt(localStorage.getItem("origin-ai-ctx-width") ?? "", 10);
    return isNaN(n) ? CTX_DEFAULT : Math.min(CTX_MAX, Math.max(CTX_MIN, n));
  });

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const { showToast } = useToast();
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);

  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>(() => pbRead(folderPath ?? ''));
  const [notesValue, setNotesValue] = useState(() => localStorage.getItem(NOTES_KEY(folderPath ?? '')) ?? '');
  const [pendingScrollContent, setPendingScrollContent] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<{ content: string; sessionId?: string } | null>(null);
  const [expandedPins, setExpandedPins] = useState<Set<string>>(new Set());
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  const messagesRef = useRef<DisplayMessage[]>([]);
  // Always-current open-tab paths — called at apply time to get the latest tabs.
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoAppliedRef = useRef<string>('');

  // DB tracking refs — accessed from stable useCallback closures
  const folderPathRef = useRef<string | null | undefined>(folderPath);
  const activeSessionIdRef = useRef<string | null>(null);
  const pendingAssistantDbIdRef = useRef<string | null>(null);
  const pendingContentRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { ensurePricing().catch(() => {}); }, []);
  useEffect(() => { folderPathRef.current = folderPath; }, [folderPath]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const fp = folderPath ?? '';
    setPinnedMessages(pbRead(fp));
    setNotesValue(localStorage.getItem(NOTES_KEY(fp)) ?? '');
  }, [folderPath]);

  // After a pin-click navigation, scroll to the matching message once it renders
  useEffect(() => {
    if (!pendingScrollContent || chatView !== 'chat' || messages.length === 0) return;
    const idx = messages.findIndex(m => m.content === pendingScrollContent);
    if (idx === -1) return;
    const timer = setTimeout(() => {
      messageRefsMap.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPendingScrollContent(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [messages, pendingScrollContent, chatView]);

  useEffect(() => {
    if (chatView === "chat") {
      messagesEndRef.current?.scrollIntoView();
    }
  }, [messages, chatView]);

  useEffect(() => {
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      autoAppliedRef.current = '';
    }
  }, [messages]);

  // Restore session and load sessions list on mount / when folderPath changes
  useEffect(() => {
    const fp = folderPath ?? '';

    // Sessions list: localStorage is always the source of truth for display
    setSessions(lsForPath(fp));

    // Try to restore last active session's messages from DB
    let cancelled = false;
    const storedId = localStorage.getItem(activeSessionKey(fp));
    if (storedId) {
      (async () => {
        try {
          await initDb();
          if (cancelled) return;
          const msgs = await loadMessages(storedId);
          if (cancelled) return;
          const displayMsgs = dbMsgsToDisplay(msgs);
          if (displayMsgs.length > 0) {
            setMessages(displayMsgs);
            activeSessionIdRef.current = storedId;
            setChatView('chat');
            localStorage.setItem('origin-ai-chat-view', 'chat');
          }
        } catch (err) {
          console.error("[AiPanel] DB session restore failed:", err);
        }
      })();
    } else {
      // No active session — just make sure DB is initialized for later writes
      initDb().catch(err => console.error("[AiPanel] DB init failed:", err));
    }

    return () => { cancelled = true; };
  }, [folderPath]);

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    streamCleanupRef.current?.();
    streamCleanupRef.current = null;

    // Finalize any in-flight assistant message
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, 'interrupted').catch(() => {});
    }

    // Switch view immediately — don't block on the DB load
    activeSessionIdRef.current = sessionId;
    const fp = folderPathRef.current ?? '';
    localStorage.setItem(activeSessionKey(fp), sessionId);
    setMessages([]);
    setChatView('chat');
    localStorage.setItem('origin-ai-chat-view', 'chat');

    try {
      const msgs = await loadMessages(sessionId);
      const displayMsgs = dbMsgsToDisplay(msgs);
      setMessages(displayMsgs);
    } catch (err) {
      console.error("[AiPanel] Failed to load session messages:", err);
    }
  }, []);

  const handleSend = useCallback(async (
    text: string,
    modelId: string,
    providerId: string,
    fileMentions: string[] = [],
    editorContext: EditorContext | null = null,
  ) => {
    streamCleanupRef.current?.();

    // Finalize any in-flight assistant message from the previous stream
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, 'interrupted').catch(() => {});
    }
    pendingContentRef.current = '';

    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    // Prefer the single attached file; fall back to the active tab.
    // Mentions come from the workspace file index as absolute paths, but
    // guard against a relative path by resolving it against the workspace
    // root — otherwise App.openTab() would key a different tab than the one
    // already open and the diff would land on the wrong (active) file.
    const fp = folderPathRef.current ?? '';
    const sourceFilePath = fileMentions.length === 1
      ? fileMentions[0]
      : (getActiveFilePath?.() ?? undefined);

    const apiKey = await loadApiKey(provider.id);
    if (!apiKey && !LOCAL_PROVIDERS.has(provider.id)) {
      const userMsg: DisplayMessage = {
        role: "user", content: text,
        sourceFilePath,
        fileMentions: fileMentions.length > 0 ? fileMentions : undefined,
        editorContext: editorContext ?? undefined,
      };
      setMessages(prev => [
        ...prev,
        userMsg,
        { role: "assistant", content: "No API key found for this provider. Please add your API key in Settings → Connect AI.", streaming: false },
      ]);
      setChatView("chat");
      localStorage.setItem("origin-ai-chat-view", "chat");
      return;
    }

    // ── Session bookkeeping ──────────────────────────────────────────────────
    let sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      // Generate ID locally first — synchronous, never fails
      sessionId = crypto.randomUUID();
      activeSessionIdRef.current = sessionId;
      localStorage.setItem(activeSessionKey(fp), sessionId);
      lsPush({ id: sessionId, title: text, workspace_path: fp, updated_at: Date.now() });
      // Also persist to DB (fire-and-forget — display doesn't depend on this)
      createSession(fp, text, modelId, providerId, sessionId)
        .catch(err => console.error("[AiPanel] DB createSession failed:", err));
    } else {
      lsTouch(sessionId);
      touchSession(sessionId, modelId, providerId)
        .catch(err => console.error("[AiPanel] DB touchSession failed:", err));
    }

    // ── DB: persist user message ─────────────────────────────────────────────
    if (sessionId) {
      try {
        await insertMessage({
          sessionId,
          messageType: 'user',
          content: text,
          attachmentsJson: fileMentions.length > 0 ? JSON.stringify(fileMentions) : null,
          editorContextJson: editorContext
            ? JSON.stringify({
                filename: editorContext.filename,
                startLine: editorContext.startLine,
                endLine: editorContext.endLine,
                type: editorContext.type,
              })
            : null,
        });
      } catch (err) {
        console.error("[AiPanel] Failed to persist user message:", err);
      }

      // ── DB: persist empty assistant placeholder ────────────────────────────
      try {
        const assistantDbId = await insertMessage({
          sessionId,
          messageType: 'assistant',
          content: '',
          status: 'streaming',
          model: modelId,
        });
        pendingAssistantDbIdRef.current = assistantDbId;
      } catch (err) {
        console.error("[AiPanel] Failed to persist assistant placeholder:", err);
      }
    }

    // ── Build enriched API message ───────────────────────────────────────────
    let apiText = text;
    if (editorContext && editorContext.code.trim()) {
      apiText = buildContextPrefix(editorContext) + apiText;
    }
    for (const filepath of fileMentions) {
      try {
        const content = await readFile(filepath);
        const fname = filepath.split(/[\\/]/).pop() ?? filepath;
        const ext = fname.split('.').pop()?.toLowerCase() ?? '';
        const fenceMap: Record<string, string> = {
          ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', rs: 'rs',
          py: 'python', css: 'css', html: 'html', json: 'json', md: 'markdown',
        };
        apiText += `\n\n[File: ${fname}]\n\`\`\`${fenceMap[ext] ?? ext}\n${content}\n\`\`\``;
      } catch { /* skip unreadable files */ }
    }

    const userMsg: DisplayMessage = {
      role: "user", content: text,
      sourceFilePath,
      fileMentions: fileMentions.length > 0 ? fileMentions : undefined,
      editorContext: editorContext ?? undefined,
    };
    const apiUserMsg: ChatMessage = { role: "user", content: apiText };
    const apiMessages: ChatMessage[] = [
      ...messagesRef.current.filter(m => m.content !== "").map(m => ({ role: m.role, content: m.content })),
      apiUserMsg,
    ];

    setMessages(prev => [...prev, userMsg, {
      role: "assistant",
      content: "",
      streaming: true,
      sourceFilePath,
      editorContext: editorContext ?? undefined,
      fileMentions: fileMentions.length > 0 ? fileMentions : undefined,
    }]);
    setChatView("chat");
    localStorage.setItem("origin-ai-chat-view", "chat");

    // Prepend the non-overridable code-edit rule so it applies even when the
    // user has an older custom prompt saved in localStorage (which would
    // otherwise shadow any update to DEFAULT_SYSTEM_PROMPT).
    const userSystemPrompt = localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = `${CODE_EDIT_PREFIX}\n\n${userSystemPrompt}`;

    streamCleanupRef.current = streamChat(
      provider.id,
      modelId,
      apiKey ?? "",
      apiMessages,
      systemPrompt,
      (token) => {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + token };
          }
          return next;
        });
        pendingContentRef.current += token;
        // Auto-apply: fire as soon as the first complete SR block lands.
        if (pendingContentRef.current.includes('>>>>>>> UPDATED') && onApplyCode) {
          const block = extractFirstCompleteBlock(pendingContentRef.current);
          if (block && autoAppliedRef.current !== block.code) {
            const targetPath = resolveTargetPath(
              block.filePath,
              fileMentions.length > 0 ? fileMentions : undefined,
              sourceFilePath,
              fp,
              getOpenTabPaths?.() ?? [],
            );
            if (targetPath) {
              autoAppliedRef.current = block.code;
              onApplyCode(block.code, targetPath, editorContext ?? undefined);
            }
          }
        }
        // Batch-write to DB every 500ms while streaming
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(async () => {
            flushTimerRef.current = null;
            const dbId = pendingAssistantDbIdRef.current;
            if (dbId) {
              const snap = pendingContentRef.current;
              updateMessageContent(dbId, snap, 'streaming').catch(() => {});
            }
          }, 500);
        }
      },
      async (usage?: UsageData) => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        const dbId = pendingAssistantDbIdRef.current;
        const finalContent = pendingContentRef.current;
        pendingAssistantDbIdRef.current = null;
        if (dbId) {
          updateMessageContent(dbId, finalContent, 'complete').catch(() => {});
        }
        const sid = activeSessionIdRef.current;
        const fPath = folderPathRef.current ?? '';
        if (sid) {
          lsTouch(sid);
          touchSession(sid, modelId, providerId)
            .catch(err => console.error("[AiPanel] DB touchSession on done failed:", err));
        }
        setSessions(lsForPath(fPath));
        streamCleanupRef.current = null;
        // Clear streaming flag on the last assistant message
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, streaming: false };
          }
          return next;
        });
        // Record token usage (skip local/free providers)
        if (usage && !LOCAL_PROVIDERS.has(providerId)) {
          const prov = PROVIDERS.find(p => p.id === providerId);
          const modelName = prov?.models.find(m => m.id === modelId)?.name ?? modelId;
          const color = prov?.color ?? '#6366f1';
          const cost = computeCost(modelId, usage.inputTokens, usage.outputTokens);
          recordUsage(modelId, modelName, providerId, usage.inputTokens, usage.outputTokens, cost, color);
        }
      },
      (error) => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        const dbId = pendingAssistantDbIdRef.current;
        const partialContent = pendingContentRef.current;
        pendingAssistantDbIdRef.current = null;
        if (dbId) {
          updateMessageContent(dbId, partialContent || `Error: ${error}`, 'error').catch(() => {});
        }
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: `Error: ${error}`, streaming: false };
          }
          return next;
        });
        streamCleanupRef.current = null;
      },
    );
  }, []);

  const handleNewChat = useCallback(() => {
    streamCleanupRef.current?.();
    streamCleanupRef.current = null;

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, 'interrupted').catch(() => {});
    }

    setMessages([]);
    activeSessionIdRef.current = null;
    const fp = folderPathRef.current ?? '';
    localStorage.removeItem(activeSessionKey(fp));
    setChatView("new");
    localStorage.removeItem("origin-ai-chat-view");
    setSessions(lsForPath(fp));
  }, []);

  const handleStartPin = useCallback((content: string) => {
    setPendingPin({ content, sessionId: activeSessionIdRef.current ?? undefined });
  }, []);

  const handleConfirmPin = useCallback((label: string) => {
    if (!pendingPin) return;
    const fp = folderPathRef.current ?? '';
    const pin: PinnedMessage = {
      id: crypto.randomUUID(),
      content: pendingPin.content,
      pinnedAt: Date.now(),
      sessionId: pendingPin.sessionId,
      label: label || undefined,
    };
    const next = [pin, ...pbRead(fp)];
    pbWrite(fp, next);
    setPinnedMessages(next);
    setPendingPin(null);
    showToast('Pinned to Pinboard', 'success');
  }, [pendingPin, showToast]);

  const handleNavigateToPin = useCallback(async (pin: PinnedMessage) => {
    if (!pin.sessionId) return;
    setPendingScrollContent(pin.content);
    await handleSessionSelect(pin.sessionId);
  }, [handleSessionSelect]);

  const handleUnpin = useCallback((id: string) => {
    const fp = folderPathRef.current ?? '';
    const next = pbRead(fp).filter(p => p.id !== id);
    pbWrite(fp, next);
    setPinnedMessages(next);
  }, []);

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotesValue(val);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      localStorage.setItem(NOTES_KEY(folderPathRef.current ?? ''), val);
    }, 500);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    lsDelete(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    const fp = folderPathRef.current ?? '';
    if (activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current = null;
      localStorage.removeItem(activeSessionKey(fp));
    }
    deleteSession(sessionId).catch(err => console.error("[AiPanel] Failed to delete session:", err));
  }, []);

  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = width;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + (startX.current - ev.clientX)));
      setWidth(next);
      localStorage.setItem("origin-ai-panel-width", String(next));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  const onCtxMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = contextWidth;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(CTX_MAX, Math.max(CTX_MIN, startW.current + (startX.current - ev.clientX)));
      setContextWidth(next);
      localStorage.setItem("origin-ai-ctx-width", String(next));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [contextWidth]);

  return (
    <>
    <div className="flex shrink-0 h-full">

      {/* ── Chat section ── */}
      <div
        className="relative flex flex-col shrink-0"
        style={{
          width,
          borderLeft: "1px solid var(--origin-border-default)",
          backgroundColor: "var(--origin-bg-sidebar)",
        }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10"
          style={{ backgroundColor: "transparent" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-border-default)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
        />

        {/* Header */}
        <div
          className="flex items-center px-3 shrink-0"
          style={{ height: "36px", borderBottom: "1px solid var(--origin-border-default)" }}
        >
          <MessageSquare size={14} style={{ color: "var(--origin-fg-muted)" }} />
          <div className="flex items-center gap-0.5 ml-auto">
            <HeaderBtn
              label="History"
              active={chatView === "history"}
              onClick={() => {
                if (chatView === "history") {
                  setChatView(messages.length > 0 ? "chat" : "new");
                } else {
                  setSessions(lsForPath(folderPath ?? ''));
                  setChatView("history");
                }
              }}
            ><History size={14} /></HeaderBtn>
            <HeaderBtn label="New Chat" onClick={handleNewChat}><Plus size={14} /></HeaderBtn>
            <Tooltip content="Toggle Pinboard" side="left">
              <HeaderBtn
                label="Toggle Pinboard"
                active={contextOpen}
                onClick={() => setContextOpen(v => !v)}
              >
                <Pin size={14} />
              </HeaderBtn>
            </Tooltip>
          </div>
        </div>

        {/* New chat view */}
        {chatView === "new" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ padding: "0 14px 16px" }}>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--origin-fg-default)", marginBottom: "4px" }}>
                Write with AI
              </div>
              <div style={{ fontSize: "13px", color: "var(--origin-fg-muted)", lineHeight: "1.5" }}>
                Ask questions, write code, and fix bugs with AI.
              </div>
            </div>
            <ChatBox onSend={handleSend} getEditorContext={getEditorContext} forcedContext={forcedContext} onForcedContextConsumed={onForcedContextConsumed} />
            <RecentSessions
              sessions={sessions}
              onSelect={handleSessionSelect}
              onShowAll={() => {
                setSessions(lsForPath(folderPath ?? ''));
                setChatView("history");
              }}
            />
          </div>
        )}

        {/* Active chat view */}
        {chatView === "chat" && (
          <>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 14px 8px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {messages.map((msg, i) => (
                <div key={i} ref={el => { if (el) messageRefsMap.current.set(i, el); else messageRefsMap.current.delete(i); }}>
                  <MessageBubble
                    message={msg}
                    folderPath={folderPath}
                    onApplyCode={onApplyCode}
                    getOpenTabPaths={getOpenTabPaths}
                    onResolveFail={() => showToast('Could not determine target file for this code block.', 'error')}
                    onPin={handleStartPin}
                  />
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <ChatBox onSend={handleSend} getEditorContext={getEditorContext} forcedContext={forcedContext} onForcedContextConsumed={onForcedContextConsumed} />
          </>
        )}

        {/* History view */}
        {chatView === "history" && (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--origin-border-default)" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--origin-fg-default)" }}>
                Chat History
              </div>
              {folderPath && (
                <div style={{ fontSize: "11px", color: "var(--origin-fg-subtle)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {folderPath.split(/[/\\]/).pop()}
                </div>
              )}
            </div>

            {sessions.length === 0 ? (
              <div style={{ padding: "20px 14px", fontSize: "12px", color: "var(--origin-fg-subtle)" }}>
                No chat history for this project yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1px", padding: "6px" }}>
                {sessions.map(s => (
                  <div
                    key={s.id}
                    style={{ display: "flex", alignItems: "center", borderRadius: "6px", position: "relative" }}
                    onMouseEnter={() => setHoveredSessionId(s.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                  >
                    <button
                      onClick={() => handleSessionSelect(s.id)}
                      style={{
                        display: "flex", alignItems: "center", flex: 1,
                        padding: "8px 8px", borderRadius: "6px",
                        background: hoveredSessionId === s.id ? "var(--origin-bg-hover)" : "none",
                        border: "none", cursor: "pointer", gap: "8px",
                        textAlign: "left", minWidth: 0,
                      }}
                    >
                      <MessageSquare size={13} style={{ color: "var(--origin-fg-subtle)", flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: "12px", color: "var(--origin-fg-default)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.title}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--origin-fg-subtle)", flexShrink: 0, marginRight: "4px" }}>
                        {formatRelativeTime(s.updated_at)}
                      </span>
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDelete({ id: s.id, title: s.title }); }}
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        width: "26px", height: "26px", borderRadius: "5px",
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--origin-fg-subtle)",
                        opacity: hoveredSessionId === s.id ? 1 : 0,
                        pointerEvents: hoveredSessionId === s.id ? "auto" : "none",
                        marginRight: "4px",
                        transition: "opacity 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                      aria-label="Delete session"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pinboard panel ── */}
      {contextOpen && (
        <div
          className="relative flex flex-col shrink-0"
          style={{
            width: contextWidth,
            borderLeft: "1px solid var(--origin-border-default)",
            backgroundColor: "var(--origin-bg-sidebar)",
          }}
        >
          {/* Drag handle */}
          <div
            onMouseDown={onCtxMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10"
            style={{ backgroundColor: "transparent" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-border-default)"; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
          />

          {/* Header */}
          <div
            className="flex items-center px-3 shrink-0"
            style={{ height: "36px", borderBottom: "1px solid var(--origin-border-default)", gap: "6px" }}
          >
            <Pin size={13} style={{ color: "var(--origin-fg-muted)" }} />
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--origin-fg-default)" }}>
              Pinboard
            </span>
          </div>

          {/* Pinned messages — top 70% */}
          <div style={{ flex: 7, minHeight: 0, overflowY: "auto", padding: "8px 8px 4px" }}>
            {pinnedMessages.length === 0 ? (
              <div style={{ padding: "16px 6px", fontSize: "12px", color: "var(--origin-fg-subtle)", lineHeight: 1.55 }}>
                No pinned messages yet. Hover over an AI response and click the pin icon to save it here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {pinnedMessages.map(pin => {
                  const isExpanded = expandedPins.has(pin.id);
                  const preview = pinPreview(pin);
                  return (
                    <div
                      key={pin.id}
                      style={{
                        borderRadius: "7px",
                        border: "1px solid var(--origin-border-default)",
                        backgroundColor: "var(--origin-bg-base)",
                        overflow: "hidden",
                      }}
                    >
                      {/* Card header — always visible, click to expand/collapse */}
                      <div
                        onClick={() => setExpandedPins(prev => {
                          const next = new Set(prev);
                          if (next.has(pin.id)) next.delete(pin.id); else next.add(pin.id);
                          return next;
                        })}
                        style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "8px 8px 6px", cursor: "pointer" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--origin-bg-hover)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ flexShrink: 0, marginTop: "1px", color: "var(--origin-fg-subtle)" }}>
                          {isExpanded
                            ? <ChevronDown size={12} />
                            : <ChevronRight size={12} />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: "12px", fontWeight: pin.label ? 600 : 400,
                            color: "var(--origin-fg-default)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {preview}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--origin-fg-subtle)", marginTop: "2px" }}>
                            {formatRelativeTime(pin.pinnedAt)}
                          </div>
                        </div>
                        {/* Navigate button */}
                        {pin.sessionId && (
                          <button
                            onClick={e => { e.stopPropagation(); handleNavigateToPin(pin); }}
                            title="Go to message"
                            style={{ flexShrink: 0, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", borderRadius: "3px", color: "var(--origin-fg-subtle)" }}
                            onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }}
                            onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                          >
                            <ArrowUpRight size={12} />
                          </button>
                        )}
                        {/* Unpin button */}
                        <button
                          onClick={e => { e.stopPropagation(); handleUnpin(pin.id); }}
                          title="Unpin"
                          style={{ flexShrink: 0, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", borderRadius: "3px", color: "var(--origin-fg-subtle)" }}
                          onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                        >
                          <PinOff size={11} />
                        </button>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{
                          padding: "0 10px 10px",
                          borderTop: "1px solid var(--origin-border-default)",
                          fontSize: "12px",
                          lineHeight: 1.55,
                          overflowY: "auto",
                          maxHeight: "320px",
                        }}>
                          <MarkdownMessage content={pin.content} isStreaming={false} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes — bottom 30% */}
          <div style={{
            flex: 3,
            minHeight: 0,
            borderTop: "1px solid var(--origin-border-default)",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{
              padding: "6px 12px 4px",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--origin-fg-subtle)",
              flexShrink: 0,
            }}>
              Notes
            </div>
            <textarea
              value={notesValue}
              onChange={handleNotesChange}
              placeholder="Write anything…"
              style={{
                flex: 1,
                resize: "none",
                border: "none",
                outline: "none",
                background: "transparent",
                padding: "4px 12px 10px",
                fontSize: "12px",
                lineHeight: 1.6,
                color: "var(--origin-fg-default)",
                fontFamily: "var(--font-sans)",
                overflowY: "auto",
              }}
            />
          </div>
        </div>
      )}

    </div>

    {pendingPin && (
      <PinLabelPopover
        onConfirm={handleConfirmPin}
        onCancel={() => setPendingPin(null)}
      />
    )}

    {confirmDelete && (
      <ConfirmDialog
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          handleDeleteSession(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    )}
    </>
  );
}
