import { useRef, useCallback, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare, History, Plus, Pin, PinOff,
  ChevronRight, ChevronDown, ArrowUpRight, FileCode, Trash2,
  ShieldAlert, Check, Terminal, FileEdit, FileOutput,
} from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import ChatBox from "./ChatBox";
import MarkdownMessage from "./MarkdownMessage";
import { PROVIDERS } from "./providers";
import { DEFAULT_SYSTEM_PROMPT, type UsageData } from "../../lib/ai";
import { ensurePricing, computeCost } from "../../lib/pricing";
import { recordUsage } from "../../lib/usage";
import { loadApiKey } from "../../lib/secrets";
import { readFile } from "../../lib/fs";
import { buildLanguageModel } from "../../lib/agent/providers";
import { createTools, createReadOnlyTools, type PendingAction } from "../../lib/agent/tools";
import { runAgent, type AgentEvent } from "../../lib/agent/run";
import { parsePlan, type ParsedPlan } from "../../lib/agent/planTypes";
import PlanCard from "./PlanCard";
import type { ModelMessage } from "ai";
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

// ── Sub-components ─────────────────────────────────────────────────────────────

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
  title, message, confirmLabel = "Delete", onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel?: string;
  onConfirm: () => void; onCancel: () => void;
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
        backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 340, borderRadius: "10px",
          border: "1px solid var(--origin-border-default)",
          backgroundColor: "var(--origin-bg-sidebar)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
        }}
      >
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--origin-fg-default)", marginBottom: "6px" }}>
            {title}
          </div>
          <div style={{ fontSize: "13px", color: "var(--origin-fg-muted)", lineHeight: 1.55 }}>
            {message}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "18px 20px" }}>
          <button
            onClick={onCancel} autoFocus
            style={{
              padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
              background: "var(--origin-bg-active)", border: "1px solid var(--origin-border-default)",
              color: "var(--origin-fg-default)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--origin-bg-active)"; }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            style={{
              padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
              background: "#dc2626", border: "1px solid transparent", color: "#fff",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#b91c1c"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#dc2626"; }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecentSessions({ sessions, onSelect, onShowAll }: {
  sessions: DbSession[]; onSelect: (id: string) => void; onShowAll?: () => void;
}) {
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

// ── ToolCallCard ───────────────────────────────────────────────────────────────

interface ToolCallDisplay {
  id: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete" | "approval-required";
  action?: PendingAction;
  approve?: () => void;
  reject?: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read file",
  list_directory: "List directory",
  grep: "Search",
  glob: "List files",
  write_file: "Write file",
  edit: "Edit file",
  bash_run: "Run command",
};

function toolLabel(name: string) { return TOOL_LABELS[name] ?? name; }

function toolIcon(name: string) {
  if (name === "bash_run") return <Terminal size={11} style={{ flexShrink: 0 }} />;
  if (name === "edit") return <FileEdit size={11} style={{ flexShrink: 0 }} />;
  if (name === "write_file") return <FileOutput size={11} style={{ flexShrink: 0 }} />;
  return null;
}

function argsPreview(toolName: string, args: unknown): string {
  const a = args as Record<string, unknown>;
  if (!a) return "";
  if (toolName === "read_file" || toolName === "list_directory" || toolName === "write_file" || toolName === "edit") {
    const p = String(a.path ?? "");
    return p.split(/[/\\]/).pop() ?? p;
  }
  if (toolName === "grep") return `"${a.query}"`;
  if (toolName === "bash_run") return String(a.command ?? "").slice(0, 60);
  if (toolName === "glob") return String(a.folder ?? "workspace");
  return "";
}

function resultSummary(result: unknown): string {
  if (result === undefined || result === null) return "Done";
  if (typeof result === "string") return result.slice(0, 300);
  const obj = result as Record<string, unknown>;
  if (obj.error) return `Error: ${obj.error}`;
  if (obj.cancelled) return "Cancelled";
  if (obj.success) return `Written: ${obj.path}`;
  if (obj.content && typeof obj.content === "string") return obj.content.slice(0, 300);
  if (obj.results && Array.isArray(obj.results)) return `${obj.results.length} result(s)`;
  if (obj.entries && Array.isArray(obj.entries)) return `${obj.entries.length} item(s)`;
  if (obj.files && Array.isArray(obj.files)) return `${obj.files.length} file(s)`;
  if (obj.stdout !== undefined) {
    const out = String(obj.stdout).trim();
    const err = String(obj.stderr ?? "").trim();
    return out || err || `exit ${obj.exit_code}`;
  }
  return JSON.stringify(result).slice(0, 200);
}

function ToolCallCard({ tc }: {
  tc: ToolCallDisplay;
}) {
  const [expanded, setExpanded] = useState(false);

  const baseStyle: React.CSSProperties = {
    margin: "3px 0",
    borderRadius: "6px",
    border: "1px solid var(--origin-border-default)",
    backgroundColor: "var(--origin-bg-editor)",
    fontSize: "12px",
    overflow: "hidden",
  };

  if (tc.status === "running") {
    return (
      <div style={baseStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", color: "var(--origin-fg-muted)" }}>
          <div style={{
            width: 11, height: 11, flexShrink: 0,
            border: "1.5px solid var(--origin-fg-subtle)",
            borderTopColor: "var(--origin-accent-blue)",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--origin-fg-muted)" }}>
            {toolLabel(tc.toolName)}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--origin-fg-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {argsPreview(tc.toolName, tc.args)}
          </span>
        </div>
      </div>
    );
  }

  if (tc.status === "approval-required" && tc.action) {
    const action = tc.action;
    return (
      <div style={{ ...baseStyle, border: "1px solid rgba(245,158,11,0.5)", backgroundColor: "rgba(245,158,11,0.04)" }}>
        <div style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px" }}>
            <ShieldAlert size={11} style={{ color: "#f59e0b", flexShrink: 0 }} />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#f59e0b" }}>Approval required</span>
            <span style={{ fontSize: "11px", color: "var(--origin-fg-muted)", fontFamily: "var(--font-mono)", marginLeft: 4 }}>
              {toolLabel(tc.toolName)}
            </span>
          </div>

          <div style={{
            backgroundColor: "var(--origin-bg-base)",
            borderRadius: "4px",
            padding: "6px 8px",
            marginBottom: "8px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--origin-fg-muted)",
            maxHeight: "100px",
            overflowY: "auto",
          }}>
            {action.type === "bash_run" && (
              <span style={{ color: "var(--origin-fg-default)" }}>
                $ {action.command}
                {action.cwd && (
                  <span style={{ color: "var(--origin-fg-subtle)", marginLeft: 8 }}>
                    ({action.cwd.split(/[/\\]/).pop()})
                  </span>
                )}
              </span>
            )}
            {action.type === "write_file" && (
              <>
                <div style={{ color: "var(--origin-fg-subtle)", marginBottom: 4 }}>
                  {action.path.split(/[/\\]/).pop()}
                </div>
                <div style={{ color: "var(--origin-fg-muted)" }}>
                  {action.content.slice(0, 180)}
                  {action.content.length > 180 ? "…" : ""}
                </div>
              </>
            )}
            {action.type === "edit" && (
              <>
                <div style={{ color: "var(--origin-fg-subtle)", marginBottom: 4 }}>
                  {action.path.split(/[/\\]/).pop()}
                </div>
                <div style={{ color: "rgba(46,160,67,0.9)" }}>
                  + {action.updated.slice(0, 120)}
                  {action.updated.length > 120 ? "…" : ""}
                </div>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <span style={{ fontSize: "11px", color: "var(--origin-fg-subtle)", fontStyle: "italic" }}>
              Review in the diff tab →
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (tc.status === "complete") {
    const summary = resultSummary(tc.result);
    const isCancelled = (tc.result as Record<string, unknown> | undefined)?.cancelled;
    const isError = (tc.result as Record<string, unknown> | undefined)?.error;
    return (
      <div style={baseStyle}>
        <div
          onClick={() => setExpanded(e => !e)}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", cursor: "pointer" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-bg-hover)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
        >
          {isCancelled ? (
            <span style={{ fontSize: "9px", color: "var(--origin-fg-subtle)", flexShrink: 0 }}>✕</span>
          ) : isError ? (
            <span style={{ fontSize: "9px", color: "#ef4444", flexShrink: 0 }}>✕</span>
          ) : (
            <Check size={11} style={{ color: "#22c55e", flexShrink: 0 }} />
          )}
          {toolIcon(tc.toolName)}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--origin-fg-muted)" }}>
            {toolLabel(tc.toolName)}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--origin-fg-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {argsPreview(tc.toolName, tc.args)}
          </span>
          <ChevronDown
            size={10}
            style={{ flexShrink: 0, color: "var(--origin-fg-subtle)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.12s" }}
          />
        </div>
        {expanded && (
          <div style={{
            padding: "6px 10px",
            borderTop: "1px solid var(--origin-border-default)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--origin-fg-muted)",
            maxHeight: "160px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {summary}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── Target-file resolver ───────────────────────────────────────────────────────

function resolveTargetPath(
  llmFilePath: string | undefined,
  messageMentions: string[] | undefined,
  sourceFilePath: string | undefined,
  folderPath: string,
  openTabPaths: string[],
): string | undefined {
  void folderPath;
  const normLlm = llmFilePath ? llmFilePath.replace(/\\/g, "/").toLowerCase() : undefined;

  if (normLlm && messageMentions && messageMentions.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    const byLongestSuffix = messageMentions
      .map(p => ({ p, norm: p.replace(/\\/g, "/").toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (byLongestSuffix.length > 0) return byLongestSuffix[0].p;

    const byBasename = messageMentions.filter(p =>
      (p.split(/[/\\]/).pop() ?? "").toLowerCase() === name
    );
    if (byBasename.length === 1) return byBasename[0];
    if (byBasename.length > 1) {
      return byBasename.find(p => p === sourceFilePath) ?? byBasename[0];
    }
  }

  if (!normLlm && messageMentions?.length === 1) return messageMentions[0];
  if (messageMentions?.length === 1) return messageMentions[0];

  if (normLlm && openTabPaths.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    const bySuffix = openTabPaths
      .map(p => ({ p, norm: p.replace(/\\/g, "/").toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (bySuffix.length > 0) return bySuffix[0].p;

    const byBasename = openTabPaths.filter(p =>
      (p.split(/[/\\]/).pop() ?? "").toLowerCase() === name
    );
    if (byBasename.length >= 1) {
      return byBasename.find(p => p === sourceFilePath) ?? byBasename[0];
    }
  }

  if (sourceFilePath) return sourceFilePath;
  return undefined;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);
  if (minutes < 1)  return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24)   return `${hours}h ago`;
  if (days < 7)     return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function contextLabel(ctx: EditorContext): string {
  if (ctx.startLine === ctx.endLine) return `L${ctx.startLine}`;
  return `L${ctx.startLine}–${ctx.endLine}`;
}

function buildContextPrefix(ctx: EditorContext): string {
  const ext = ctx.filename.split(".").pop()?.toLowerCase() ?? "";
  const fenceMap: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", rs: "rs",
    py: "python", css: "css", html: "html", json: "json", md: "markdown",
  };
  const fence = fenceMap[ext] ?? ext;
  const label = ctx.type === "selection" ? "Selected code" : "Visible code";
  return `[${label} in ${ctx.filename}]\n\`\`\`${fence}\n${ctx.code}\n\`\`\`\n\n`;
}

// ── Session helpers ────────────────────────────────────────────────────────────

function activeSessionKey(folderPath: string): string {
  return `origin-active-session:${folderPath}`;
}

const LS_SESSIONS_KEY = "origin-sessions-v1";

interface SessionMeta {
  id: string;
  title: string;
  workspace_path: string;
  updated_at: number;
}

function lsRead(): SessionMeta[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS_KEY) ?? "[]"); }
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
  localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(lsRead().filter(s => s.id !== id)));
}
function lsForPath(workspacePath: string): DbSession[] {
  return lsRead()
    .filter(s => s.workspace_path === workspacePath)
    .map(s => ({
      id: s.id, title: s.title, workspace_path: s.workspace_path,
      active_model: "", active_provider: "",
      created_at: s.updated_at, updated_at: s.updated_at,
    }));
}

function dbMsgsToDisplay(msgs: DbMessage[]): DisplayMessage[] {
  const filtered = msgs.filter(m => m.message_type === "user" || m.message_type === "assistant");
  let lastUserSingleMention: string | undefined;
  return filtered.map(m => {
    const interrupted = m.status === "interrupted";
    let content = interrupted
      ? m.content ? m.content + "\n\n[Response interrupted]" : "[Response interrupted]"
      : m.content;
    const fileMentions = m.attachments_json
      ? (JSON.parse(m.attachments_json) as string[])
      : undefined;
    if (m.message_type === "user") {
      lastUserSingleMention = fileMentions?.length === 1 ? fileMentions[0] : undefined;
    }
    // Restore interleaved parts from DB. Two formats are handled:
    // - New: array of MessagePart ({ type: "text"|"tool-call", ... })
    // - Old: array of ToolCallDisplay (no type field) — converted to tool-call parts
    let restoredParts: MessagePart[] | undefined;
    if (m.tool_calls_json) {
      try {
        const raw = JSON.parse(m.tool_calls_json) as Record<string, unknown>[];
        if (raw.length > 0) {
          if ("type" in raw[0]) {
            // New parts format
            restoredParts = raw.map(p =>
              (p.type === "tool-call" && p.tc)
                ? { type: "tool-call" as const, tc: { ...(p.tc as ToolCallDisplay), status: "complete" as const, approve: undefined, reject: undefined } }
                : { type: "text" as const, content: String((p as { content?: unknown }).content ?? "") }
            );
          } else {
            // Old flat ToolCallDisplay[] — wrap each as a tool-call part
            restoredParts = raw.map(tc => ({
              type: "tool-call" as const,
              tc: { ...(tc as unknown as ToolCallDisplay), status: "complete" as const, approve: undefined, reject: undefined },
            }));
          }
        }
      } catch { /* malformed JSON — ignore */ }
    }

    // Re-derive plan-card from DB content (the raw XML is stored in content,
    // but was stripped from the in-memory display during the live session).
    // Also strip the XML from restoredParts text chunks — when parts exist,
    // MessageBubble renders from parts not content, so both must be cleaned.
    let planPart: MessagePart | undefined;
    if (m.message_type === "assistant" && !interrupted) {
      const plan = parsePlan(content);
      if (plan) {
        content = content.replace(plan.rawXml, "").trimEnd();
        planPart = { type: "plan-card", plan, status: "rejected" };
        if (restoredParts) {
          restoredParts = restoredParts
            .map(p => p.type === "text"
              ? { ...p, content: p.content.replace(plan.rawXml, "").trimEnd() }
              : p)
            .filter(p => p.type !== "text" || p.content.trim() !== "");
        }
      }
    }

    const finalParts = planPart
      ? [...(restoredParts ?? []), planPart]
      : restoredParts;

    return {
      role: m.message_type as "user" | "assistant",
      content,
      parts: finalParts && finalParts.length > 0 ? finalParts : undefined,
      sourceFilePath: m.message_type === "assistant" ? lastUserSingleMention : undefined,
      fileMentions,
      editorContext: m.editor_context_json
        ? { ...(JSON.parse(m.editor_context_json) as object), code: "", language: "" } as EditorContext
        : undefined,
    };
  });
}

// ── Pinboard helpers ───────────────────────────────────────────────────────────

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
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`[^`]+`/g, s => s.slice(1, -1))
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 72);
}

const PINBOARD_KEY = (fp: string) => `origin-pinboard:${fp || "global"}`;
const NOTES_KEY    = (fp: string) => `origin-pinboard-notes:${fp || "global"}`;

function pbRead(fp: string): PinnedMessage[] {
  try { return JSON.parse(localStorage.getItem(PINBOARD_KEY(fp)) ?? "[]"); }
  catch { return []; }
}
function pbWrite(fp: string, pins: PinnedMessage[]) {
  localStorage.setItem(PINBOARD_KEY(fp), JSON.stringify(pins));
}

function PinLabelPopover({ onConfirm, onCancel }: {
  onConfirm: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 320, borderRadius: "10px", border: "1px solid var(--origin-border-default)", backgroundColor: "var(--origin-bg-sidebar)", boxShadow: "0 20px 60px rgba(0,0,0,0.4)", padding: "20px" }}
      >
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--origin-fg-default)", marginBottom: "4px" }}>Pin message</div>
        <div style={{ fontSize: "12px", color: "var(--origin-fg-muted)", marginBottom: "14px" }}>
          Add a label to find it quickly. Leave blank to use a content preview.
        </div>
        <input
          ref={inputRef}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onConfirm(label.trim()); } }}
          placeholder="e.g. auth fix, regex approach…"
          style={{
            width: "100%", boxSizing: "border-box",
            background: "var(--origin-bg-base)", border: "1px solid var(--origin-border-default)",
            borderRadius: "6px", padding: "7px 10px", fontSize: "13px",
            color: "var(--origin-fg-default)", outline: "none", fontFamily: "var(--font-sans)",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
          <button
            onClick={onCancel}
            style={{ padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer", background: "var(--origin-bg-active)", border: "1px solid var(--origin-border-default)", color: "var(--origin-fg-default)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--origin-bg-active)"; }}
          >Cancel</button>
          <button
            onClick={() => onConfirm(label.trim())}
            style={{ padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer", background: "var(--origin-fg-default)", border: "1px solid transparent", color: "var(--origin-bg-base)" }}
          >Pin</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── DisplayMessage + MessageBubble ─────────────────────────────────────────────

// A message is a sequence of interleaved text and tool-call parts so badges
// appear exactly where in the response they were spawned, not all at the top.
type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool-call"; tc: ToolCallDisplay }
  | { type: "plan-card"; plan: ParsedPlan; status: "pending" | "approved" | "rejected" };

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;          // full text — kept for DB flush during streaming
  parts?: MessagePart[];    // interleaved rendering parts (assistant only)
  streaming?: boolean;
  sourceFilePath?: string;
  fileMentions?: string[];
  editorContext?: EditorContext | null;
}

function appendText(parts: MessagePart[], delta: string): MessagePart[] {
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { type: "text", content: last.content + delta }];
  }
  return [...parts, { type: "text", content: delta }];
}

function updateTcInParts(parts: MessagePart[], id: string, update: Partial<ToolCallDisplay>): MessagePart[] {
  return parts.map(p =>
    p.type === "tool-call" && p.tc.id === id ? { ...p, tc: { ...p.tc, ...update } } : p
  );
}

function MessageBubble({
  message,
  folderPath,
  onApplyCode,
  getOpenTabPaths,
  onResolveFail,
  onPin,
  onPlanApprove,
  onPlanReject,
}: {
  message: DisplayMessage;
  folderPath?: string | null;
  onApplyCode?: (code: string, filePath?: string, ctx?: EditorContext) => void;
  getOpenTabPaths?: () => string[];
  onResolveFail?: () => void;
  onPin?: (content: string) => void;
  onPlanApprove?: () => void;
  onPlanReject?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const parts = message.parts;
  const hasVisibleContent = isUser
    ? !!message.content
    : parts
      ? parts.some(p => p.type === "tool-call" || p.type === "plan-card" || (p.type === "text" && p.content.trim()))
      : !!message.content;
  const isEmpty = !hasVisibleContent;
  const hasAttachments = isUser && (
    (message.fileMentions && message.fileMentions.length > 0) || message.editorContext
  );

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "2px 6px", borderRadius: "4px", fontSize: "11px",
    fontFamily: "var(--font-mono)",
    background: "var(--origin-bg-active)", border: "1px solid var(--origin-border-default)",
    color: "var(--origin-fg-default)", whiteSpace: "nowrap",
  };

  return (
    <div
      style={{ marginBottom: "20px" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {isUser ? "You" : "Assistant"}
        </span>
        {!isUser && onPin && hovered && message.content && !message.streaming && (
          <button
            onClick={() => onPin(message.content)}
            title="Pin to Pinboard"
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "3px", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: "4px", color: "var(--origin-fg-subtle)", fontSize: "10px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Pin size={11} />
          </button>
        )}
      </div>

      {/* Interleaved parts: text segments and tool-call badges in order */}
      {isEmpty && message.streaming ? (
        <span style={{ display: "inline-block", width: "2px", height: "13px", backgroundColor: "var(--origin-fg-muted)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
      ) : isUser ? (
        <div style={{ fontSize: "13px", color: "var(--origin-fg-default)", lineHeight: "1.65", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {message.content}
        </div>
      ) : parts && parts.length > 0 ? (
        <>
          {parts.map((part, i) => {
            if (part.type === "plan-card") {
              return (
                <PlanCard
                  key={i}
                  plan={part.plan}
                  status={part.status}
                  onApprove={part.status === "pending" ? (onPlanApprove ?? (() => {})) : undefined}
                  onReject={part.status === "pending" ? (onPlanReject ?? (() => {})) : undefined}
                />
              );
            }
            if (part.type === "tool-call") {
              const tc = part.tc;
              return (
                <ToolCallCard
                  key={tc.id}
                  tc={tc}
                />
              );
            }
            // text part — only render if non-empty (avoids blank MarkdownMessage between tool calls)
            if (!part.content) return null;
            const isLastPart = i === parts.length - 1;
            return (
              <MarkdownMessage
                key={i}
                content={part.content}
                isStreaming={isLastPart && message.streaming}
                onApplyCode={onApplyCode
                  ? (code, _lang, filePath) => {
                      const resolved = resolveTargetPath(
                        filePath, message.fileMentions, message.sourceFilePath,
                        folderPath ?? "", getOpenTabPaths?.() ?? [],
                      );
                      if (!resolved) { onResolveFail?.(); return; }
                      onApplyCode(code, resolved, message.editorContext ?? undefined);
                    }
                  : undefined}
              />
            );
          })}
        </>
      ) : message.content ? (
        // Fallback for messages loaded from old DB format (no parts array)
        <MarkdownMessage
          content={message.content}
          isStreaming={message.streaming}
          onApplyCode={onApplyCode
            ? (code, _lang, filePath) => {
                const resolved = resolveTargetPath(
                  filePath, message.fileMentions, message.sourceFilePath,
                  folderPath ?? "", getOpenTabPaths?.() ?? [],
                );
                if (!resolved) { onResolveFail?.(); return; }
                onApplyCode(code, resolved, message.editorContext ?? undefined);
              }
            : undefined}
        />
      ) : null}

      {hasAttachments && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
          {message.editorContext && (
            <span style={badgeStyle}>
              <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
              <span>{message.editorContext.filename}</span>
              <span style={{ padding: "0 4px", borderRadius: "3px", fontSize: "10px", background: "var(--origin-bg-hover)", color: "var(--origin-fg-muted)" }}>
                {contextLabel(message.editorContext)}
              </span>
            </span>
          )}
          {message.fileMentions?.map(fp => {
            const fname = fp.split(/[\/\\]/).pop() ?? fp;
            return (
              <span key={fp} style={badgeStyle}>
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

// ── Plan mode system prompt ────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are Origin AI in PLAN mode. Your job is to analyze the codebase and produce a structured implementation plan — without writing any code yet.

PHASE 1 — EXPLORATION & PLANNING:
- Use read_file, list_directory, grep, and glob tools to explore the relevant files
- Understand the structure, patterns, and what needs to change
- DO NOT use write_file, edit, or bash_run — exploration only in this phase

After exploring, write a brief analysis of what needs to change, then output your plan in EXACTLY this format:

<origin-plan>
<title>Brief task title (under 60 chars)</title>
<steps>
<step file="src/relative/path/to/file.ts" action="edit">Description of what will be changed and why</step>
<step file="src/relative/path/to/newfile.ts" action="create">Description of what this new file will contain</step>
</steps>
</origin-plan>

Rules:
- Valid actions: edit, create, delete
- Use workspace-relative paths (e.g. src/components/App.tsx)
- Be specific in step descriptions — the user reads them before approving
- Include ALL files that need changes
- Stop after the closing </origin-plan> tag — do not execute any changes`;

// ── Panel constants ────────────────────────────────────────────────────────────

const MIN_WIDTH    = 240;
const MAX_WIDTH    = 600;
const DEFAULT_WIDTH = 320;
const CTX_MIN     = 160;
const CTX_MAX     = 480;
const CTX_DEFAULT = 200;
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "vllm"]);

// ── AiPanel ────────────────────────────────────────────────────────────────────

export interface AiDiffTabInput {
  approvalId: string;
  filePath: string;
  proposedContent: string;
  originalContent: string;
  approve: () => void;
  reject: () => void;
}

interface AiPanelProps {
  getEditorContext?: () => EditorContext | null;
  getActiveFilePath?: () => string | null;
  forcedContext?: EditorContext | null;
  onForcedContextConsumed?: () => void;
  onApplyCode?: (code: string, filePath?: string, ctx?: EditorContext) => void;
  getOpenTabPaths?: () => string[];
  onOpenDiffTab?: (data: AiDiffTabInput) => void;
}

export default function AiPanel({
  getEditorContext, getActiveFilePath, forcedContext, onForcedContextConsumed,
  onApplyCode, getOpenTabPaths, onOpenDiffTab,
}: AiPanelProps) {
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

  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>(() => pbRead(folderPath ?? ""));
  const [notesValue, setNotesValue] = useState(() => localStorage.getItem(NOTES_KEY(folderPath ?? "")) ?? "");
  const [pendingScrollContent, setPendingScrollContent] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<{ content: string; sessionId?: string } | null>(null);
  const [expandedPins, setExpandedPins] = useState<Set<string>>(new Set());
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  const messagesRef        = useRef<DisplayMessage[]>([]);
  const streamCleanupRef   = useRef<(() => void) | null>(null);
  const messagesEndRef     = useRef<HTMLDivElement>(null);

  const folderPathRef              = useRef<string | null | undefined>(folderPath);
  const activeSessionIdRef         = useRef<string | null>(null);
  const pendingAssistantDbIdRef    = useRef<string | null>(null);
  const pendingContentRef          = useRef<string>("");
  const pendingPartsRef            = useRef<MessagePart[]>([]);
  const flushTimerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getActiveFilePathRef       = useRef(getActiveFilePath);
  const onApplyCodeRef             = useRef(onApplyCode);
  const onOpenDiffTabRef           = useRef(onOpenDiffTab);
  const currentModeRef             = useRef<"agent" | "plan">("agent");
  const phase1ContentRef           = useRef<string>("");
  const startPlanExecutionRef      = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => { ensurePricing().catch(() => {}); }, []);
  useEffect(() => { folderPathRef.current = folderPath; }, [folderPath]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { getActiveFilePathRef.current = getActiveFilePath; }, [getActiveFilePath]);
  useEffect(() => { onApplyCodeRef.current = onApplyCode; }, [onApplyCode]);
  useEffect(() => { onOpenDiffTabRef.current = onOpenDiffTab; }, [onOpenDiffTab]);

  useEffect(() => {
    const fp = folderPath ?? "";
    setPinnedMessages(pbRead(fp));
    setNotesValue(localStorage.getItem(NOTES_KEY(fp)) ?? "");
  }, [folderPath]);

  useEffect(() => {
    if (!pendingScrollContent || chatView !== "chat" || messages.length === 0) return;
    const idx = messages.findIndex(m => m.content === pendingScrollContent);
    if (idx === -1) return;
    const timer = setTimeout(() => {
      messageRefsMap.current.get(idx)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingScrollContent(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [messages, pendingScrollContent, chatView]);

  useEffect(() => {
    if (chatView === "chat") { messagesEndRef.current?.scrollIntoView(); }
  }, [messages, chatView]);

  useEffect(() => {
    const fp = folderPath ?? "";
    setSessions(lsForPath(fp));
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
            setChatView("chat");
            localStorage.setItem("origin-ai-chat-view", "chat");
          }
        } catch (err) {
          console.error("[AiPanel] DB session restore failed:", err);
        }
      })();
    } else {
      initDb().catch(err => console.error("[AiPanel] DB init failed:", err));
    }
    return () => { cancelled = true; };
  }, [folderPath]);

  const handleSessionSelect = useCallback(async (sessionId: string) => {
    streamCleanupRef.current?.();
    streamCleanupRef.current = null;

    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, "interrupted").catch(() => {});
    }

    activeSessionIdRef.current = sessionId;
    const fp = folderPathRef.current ?? "";
    localStorage.setItem(activeSessionKey(fp), sessionId);
    setMessages([]);
    setChatView("chat");
    localStorage.setItem("origin-ai-chat-view", "chat");

    try {
      const msgs = await loadMessages(sessionId);
      setMessages(dbMsgsToDisplay(msgs));
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
    mode: "agent" | "ask" | "plan" = "agent",
  ) => {
    streamCleanupRef.current?.();

    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, "interrupted").catch(() => {});
    }
    pendingContentRef.current = "";
    pendingPartsRef.current = [];

    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) return;

    const fp = folderPathRef.current ?? "";
    const sourceFilePath = fileMentions.length === 1
      ? fileMentions[0]
      : (getActiveFilePathRef.current?.() ?? undefined);

    const apiKey = await loadApiKey(provider.id);
    if (!apiKey && !LOCAL_PROVIDERS.has(provider.id)) {
      setMessages(prev => [
        ...prev,
        { role: "user" as const, content: text, sourceFilePath, fileMentions: fileMentions.length > 0 ? fileMentions : undefined, editorContext: editorContext ?? undefined },
        { role: "assistant" as const, content: "No API key found for this provider. Please add your API key in Settings → Connect AI.", streaming: false },
      ]);
      setChatView("chat");
      localStorage.setItem("origin-ai-chat-view", "chat");
      return;
    }

    // ── Session bookkeeping ──────────────────────────────────────────────────
    let sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      activeSessionIdRef.current = sessionId;
      localStorage.setItem(activeSessionKey(fp), sessionId);
      lsPush({ id: sessionId, title: text, workspace_path: fp, updated_at: Date.now() });
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
          messageType: "user",
          content: text,
          attachmentsJson: fileMentions.length > 0 ? JSON.stringify(fileMentions) : null,
          editorContextJson: editorContext
            ? JSON.stringify({ filename: editorContext.filename, startLine: editorContext.startLine, endLine: editorContext.endLine, type: editorContext.type })
            : null,
        });
      } catch (err) {
        console.error("[AiPanel] Failed to persist user message:", err);
      }
      try {
        const assistantDbId = await insertMessage({ sessionId, messageType: "assistant", content: "", status: "streaming", model: modelId });
        pendingAssistantDbIdRef.current = assistantDbId;
      } catch (err) {
        console.error("[AiPanel] Failed to persist assistant placeholder:", err);
      }
    }

    // ── Build enriched message for the API ──────────────────────────────────
    let apiText = text;
    if (editorContext && editorContext.code.trim()) {
      apiText = buildContextPrefix(editorContext) + apiText;
    }
    for (const filepath of fileMentions) {
      try {
        const content = await readFile(filepath);
        const fname = filepath.split(/[\\/]/).pop() ?? filepath;
        const ext = fname.split(".").pop()?.toLowerCase() ?? "";
        const fenceMap: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", rs: "rs", py: "python", css: "css", html: "html", json: "json", md: "markdown" };
        // Include full path so the agent can use it directly with edit/write_file tools
        apiText += `\n\n[File: ${filepath}]\n\`\`\`${fenceMap[ext] ?? ext}\n${content}\n\`\`\``;
      } catch { /* skip unreadable files */ }
    }

    const userMsg: DisplayMessage = {
      role: "user", content: text, sourceFilePath,
      fileMentions: fileMentions.length > 0 ? fileMentions : undefined,
      editorContext: editorContext ?? undefined,
    };

    // Convert history + new message to ModelMessage[]
    const modelMessages: ModelMessage[] = [
      ...messagesRef.current
        .filter(m => m.content.trim() !== "" && !m.streaming)
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: apiText },
    ] as ModelMessage[];

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: "assistant", content: "", streaming: true, parts: [] },
    ]);
    setChatView("chat");
    localStorage.setItem("origin-ai-chat-view", "chat");

    const systemPrompt = localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT;

    // ── Build tools and event handler ────────────────────────────────────────
    const handleEvent = (event: AgentEvent) => {
      switch (event.type) {

        case "token": {
          const delta = event.delta;
          pendingPartsRef.current = appendText(pendingPartsRef.current, delta);
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: last.content + delta,
                parts: appendText(last.parts ?? [], delta),
              };
            }
            return next;
          });
          pendingContentRef.current += delta;
          if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => {
              flushTimerRef.current = null;
              const dbId = pendingAssistantDbIdRef.current;
              if (dbId) updateMessageContent(dbId, pendingContentRef.current, "streaming").catch(() => {});
            }, 500);
          }
          break;
        }

        case "tool-call": {
          const newTc: ToolCallDisplay = { id: event.id, toolName: event.toolName, args: event.args, status: "running" };
          const newPart: MessagePart = { type: "tool-call", tc: newTc };
          pendingPartsRef.current = [...pendingPartsRef.current, newPart];
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, parts: [...(last.parts ?? []), newPart] };
            }
            return next;
          });
          break;
        }

        case "tool-result": {
          const tcUpdate = { status: "complete" as const, result: event.result, approve: undefined, reject: undefined };
          pendingPartsRef.current = updateTcInParts(pendingPartsRef.current, event.id, tcUpdate);
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.parts) {
              next[next.length - 1] = { ...last, parts: updateTcInParts(last.parts, event.id, tcUpdate) };
            }
            return next;
          });
          break;
        }

        case "approval-required": {
          // Open a dedicated read-only diff tab so the user can review changes before approving.
          const _action = event.action;
          if (_action.type === "edit" || _action.type === "write_file") {
            const proposed = _action.type === "edit" ? _action.mergedContent : _action.content;
            onOpenDiffTabRef.current?.({
              approvalId: event.id,
              filePath: _action.path,
              proposedContent: proposed,
              originalContent: _action.originalContent,
              approve: event.approve,
              reject: event.reject,
            });
          }
          const approvalUpdate = { status: "approval-required" as const, action: event.action, approve: event.approve, reject: event.reject };
          const hasInParts = pendingPartsRef.current.some(p => p.type === "tool-call" && p.tc.id === event.id);
          if (hasInParts) {
            pendingPartsRef.current = updateTcInParts(pendingPartsRef.current, event.id, approvalUpdate);
          } else {
            const tc: ToolCallDisplay = { id: event.id, toolName: event.action.type, args: event.action, ...approvalUpdate };
            pendingPartsRef.current = [...pendingPartsRef.current, { type: "tool-call", tc }];
          }
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return next;
            const existingParts = last.parts ?? [];
            const hasMatch = existingParts.some(p => p.type === "tool-call" && p.tc.id === event.id);
            if (hasMatch) {
              next[next.length - 1] = { ...last, parts: updateTcInParts(existingParts, event.id, approvalUpdate) };
            } else {
              const insertedTc: ToolCallDisplay = { id: event.id, toolName: event.action.type, args: event.action, ...approvalUpdate };
              next[next.length - 1] = { ...last, parts: [...existingParts, { type: "tool-call", tc: insertedTc }] };
            }
            return next;
          });
          break;
        }

        case "step-finish":
          break;

        case "finish": {
          if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
          const dbId = pendingAssistantDbIdRef.current;
          const finalContent = pendingContentRef.current;
          const finalParts = pendingPartsRef.current;
          pendingAssistantDbIdRef.current = null;
          pendingPartsRef.current = [];
          const partsJson = finalParts.length > 0
            ? JSON.stringify(finalParts.map(p => {
                if (p.type !== "tool-call") return p;
                const { approve: _a, reject: _r, ...tcRest } = p.tc;
                return { type: "tool-call", tc: tcRest };
              }))
            : null;
          if (dbId) updateMessageContent(dbId, finalContent, "complete", partsJson).catch(() => {});

          const sid = activeSessionIdRef.current;
          const fPath = folderPathRef.current ?? "";
          if (sid) {
            lsTouch(sid);
            touchSession(sid, modelId, providerId).catch(() => {});
          }
          setSessions(lsForPath(fPath));
          streamCleanupRef.current = null;

          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, streaming: false };
            }
            return next;
          });

          const { usage } = event as { usage: UsageData };
          if (usage && !LOCAL_PROVIDERS.has(providerId)) {
            const prov = PROVIDERS.find(p => p.id === providerId);
            const modelName = prov?.models.find(m => m.id === modelId)?.name ?? modelId;
            const color = (prov as { color?: string })?.color ?? "#6366f1";
            const cost = computeCost(modelId, usage.inputTokens, usage.outputTokens);
            recordUsage(modelId, modelName, providerId, usage.inputTokens, usage.outputTokens, cost, color);
          }

          // Plan mode: parse the plan XML and embed a plan-card part in the message
          if (currentModeRef.current === "plan") {
            currentModeRef.current = "agent";
            const plan = parsePlan(finalContent);
            if (plan) {
              phase1ContentRef.current = finalContent;
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  const cleanContent = last.content.replace(plan.rawXml, "").trimEnd();
                  const cleanParts = (last.parts ?? [])
                    .map(p => p.type === "text"
                      ? { ...p, content: p.content.replace(plan.rawXml, "").trimEnd() }
                      : p
                    )
                    .filter(p => p.type !== "text" || (p as { type: "text"; content: string }).content.trim() !== "");
                  const planPart: MessagePart = { type: "plan-card", plan, status: "pending" };
                  next[next.length - 1] = { ...last, content: cleanContent, parts: [...cleanParts, planPart], streaming: false };
                }
                return next;
              });
            } else {
              showToast("Plan mode: no structured plan was generated. Try rephrasing your request.", "error");
            }
          }
          break;
        }

        case "error": {
          if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
          const dbId = pendingAssistantDbIdRef.current;
          const partialContent = pendingContentRef.current;
          pendingAssistantDbIdRef.current = null;
          if (dbId) updateMessageContent(dbId, partialContent || `Error: ${event.message}`, "error").catch(() => {});
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: `Error: ${event.message}`, streaming: false };
            }
            return next;
          });
          streamCleanupRef.current = null;
          break;
        }
      }
    };

    let model;
    try {
      model = buildLanguageModel(providerId, modelId, apiKey ?? "");
    } catch (e) {
      showToast(`Provider error: ${e instanceof Error ? e.message : String(e)}`, "error");
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content: `Error: failed to build model.`, streaming: false };
        return next;
      });
      return;
    }

    const makeFullTools = () => createTools({
      folderPath: fp || ".",
      onApproval: (evt) => handleEvent({
        type: "approval-required",
        id: evt.id,
        action: evt.action,
        approve: evt.approve,
        reject: evt.reject,
      }),
    });

    if (mode === "plan") {
      currentModeRef.current = "plan";
      const capturedModelMessages = modelMessages;

      // Phase 2 launcher — closed over this scope so model/provider/messages are correct
      startPlanExecutionRef.current = async () => {
        const phase1Content = phase1ContentRef.current;
        const phase2Messages: ModelMessage[] = [
          ...capturedModelMessages,
          { role: "assistant" as const, content: phase1Content },
          { role: "user" as const, content: "The plan has been approved. Proceed with the implementation now." },
        ];

        if (activeSessionIdRef.current) {
          try {
            const aid = await insertMessage({ sessionId: activeSessionIdRef.current, messageType: "assistant", content: "", status: "streaming", model: modelId });
            pendingAssistantDbIdRef.current = aid;
          } catch { /* ignore */ }
        }
        pendingContentRef.current = "";
        pendingPartsRef.current = [];

        setMessages(prev => [
          ...prev,
          { role: "assistant", content: "", streaming: true, parts: [] },
        ]);

        const phase2SystemPrompt = localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT;
        const { cancel } = runAgent({ model, messages: phase2Messages, tools: makeFullTools(), systemPrompt: phase2SystemPrompt, onEvent: handleEvent });
        streamCleanupRef.current = cancel;
      };

      const readOnlyTools = createReadOnlyTools({ folderPath: fp || "." });
      const { cancel } = runAgent({ model, messages: modelMessages, tools: readOnlyTools, systemPrompt: PLAN_SYSTEM_PROMPT, onEvent: handleEvent });
      streamCleanupRef.current = cancel;
    } else {
      const { cancel } = runAgent({ model, messages: modelMessages, tools: makeFullTools(), systemPrompt, onEvent: handleEvent });
      streamCleanupRef.current = cancel;
    }
  }, [showToast]);

  const handleNewChat = useCallback(() => {
    streamCleanupRef.current?.();
    streamCleanupRef.current = null;

    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    const prevDbId = pendingAssistantDbIdRef.current;
    if (prevDbId) {
      pendingAssistantDbIdRef.current = null;
      updateMessageContent(prevDbId, pendingContentRef.current, "interrupted").catch(() => {});
    }

    setMessages([]);
    activeSessionIdRef.current = null;
    const fp = folderPathRef.current ?? "";
    localStorage.removeItem(activeSessionKey(fp));
    setChatView("new");
    localStorage.removeItem("origin-ai-chat-view");
    setSessions(lsForPath(fp));
  }, []);

  const handlePlanApprove = useCallback(async () => {
    setMessages(prev => {
      const next = [...prev];
      outer: for (let i = next.length - 1; i >= 0; i--) {
        const msg = next[i];
        if (!msg.parts) continue;
        for (let j = msg.parts.length - 1; j >= 0; j--) {
          const p = msg.parts[j];
          if (p.type === "plan-card" && p.status === "pending") {
            const newParts = [...msg.parts];
            newParts[j] = { ...p, status: "approved" };
            next[i] = { ...msg, parts: newParts };
            break outer;
          }
        }
      }
      return next;
    });
    await startPlanExecutionRef.current?.();
  }, []);

  const handlePlanReject = useCallback(() => {
    setMessages(prev => {
      const next = [...prev];
      outer: for (let i = next.length - 1; i >= 0; i--) {
        const msg = next[i];
        if (!msg.parts) continue;
        for (let j = msg.parts.length - 1; j >= 0; j--) {
          const p = msg.parts[j];
          if (p.type === "plan-card" && p.status === "pending") {
            const newParts = [...msg.parts];
            newParts[j] = { ...p, status: "rejected" };
            next[i] = { ...msg, parts: newParts };
            break outer;
          }
        }
      }
      return next;
    });
    startPlanExecutionRef.current = null;
    currentModeRef.current = "agent";
  }, []);

  const handleStartPin = useCallback((content: string) => {
    setPendingPin({ content, sessionId: activeSessionIdRef.current ?? undefined });
  }, []);

  const handleConfirmPin = useCallback((label: string) => {
    if (!pendingPin) return;
    const fp = folderPathRef.current ?? "";
    const pin: PinnedMessage = { id: crypto.randomUUID(), content: pendingPin.content, pinnedAt: Date.now(), sessionId: pendingPin.sessionId, label: label || undefined };
    const next = [pin, ...pbRead(fp)];
    pbWrite(fp, next);
    setPinnedMessages(next);
    setPendingPin(null);
    showToast("Pinned to Pinboard", "success");
  }, [pendingPin, showToast]);

  const handleNavigateToPin = useCallback(async (pin: PinnedMessage) => {
    if (!pin.sessionId) return;
    setPendingScrollContent(pin.content);
    await handleSessionSelect(pin.sessionId);
  }, [handleSessionSelect]);

  const handleUnpin = useCallback((id: string) => {
    const fp = folderPathRef.current ?? "";
    const next = pbRead(fp).filter(p => p.id !== id);
    pbWrite(fp, next);
    setPinnedMessages(next);
  }, []);

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotesValue(val);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      localStorage.setItem(NOTES_KEY(folderPathRef.current ?? ""), val);
    }, 500);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    lsDelete(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    const fp = folderPathRef.current ?? "";
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
    dragging.current = true; startX.current = e.clientX; startW.current = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + (startX.current - ev.clientX)));
      setWidth(next);
      localStorage.setItem("origin-ai-panel-width", String(next));
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  const onCtxMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true; startX.current = e.clientX; startW.current = contextWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(CTX_MAX, Math.max(CTX_MIN, startW.current + (startX.current - ev.clientX)));
      setContextWidth(next);
      localStorage.setItem("origin-ai-ctx-width", String(next));
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [contextWidth]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
    <div className="flex shrink-0 h-full">

      {/* ── Chat section ── */}
      <div
        className="relative flex flex-col shrink-0"
        style={{ width, borderLeft: "1px solid var(--origin-border-default)", backgroundColor: "var(--origin-bg-sidebar)" }}
      >
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10"
          style={{ backgroundColor: "transparent" }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-border-default)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
        />

        {/* Header */}
        <div className="flex items-center px-3 shrink-0" style={{ height: "36px", borderBottom: "1px solid var(--origin-border-default)" }}>
          <MessageSquare size={14} style={{ color: "var(--origin-fg-muted)" }} />
          <div className="flex items-center gap-0.5 ml-auto">
            <HeaderBtn
              label="History"
              active={chatView === "history"}
              onClick={() => {
                if (chatView === "history") {
                  setChatView(messages.length > 0 ? "chat" : "new");
                } else {
                  setSessions(lsForPath(folderPath ?? ""));
                  setChatView("history");
                }
              }}
            ><History size={14} /></HeaderBtn>
            <HeaderBtn label="New Chat" onClick={handleNewChat}><Plus size={14} /></HeaderBtn>
            <Tooltip content="Toggle Pinboard" side="left">
              <HeaderBtn label="Toggle Pinboard" active={contextOpen} onClick={() => setContextOpen(v => !v)}>
                <Pin size={14} />
              </HeaderBtn>
            </Tooltip>
          </div>
        </div>

        {/* New chat view */}
        {chatView === "new" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ padding: "0 14px 16px" }}>
              <div style={{ fontSize: "22px", fontWeight: 600, color: "var(--origin-fg-default)", marginBottom: "4px" }}>Write with AI</div>
              <div style={{ fontSize: "13px", color: "var(--origin-fg-muted)", lineHeight: "1.5" }}>
                Ask questions, write code, and fix bugs with AI.
              </div>
            </div>
            <ChatBox onSend={handleSend} getEditorContext={getEditorContext} forcedContext={forcedContext} onForcedContextConsumed={onForcedContextConsumed} />
            <RecentSessions
              sessions={sessions}
              onSelect={handleSessionSelect}
              onShowAll={() => { setSessions(lsForPath(folderPath ?? "")); setChatView("history"); }}
            />
          </div>
        )}

        {/* Active chat view */}
        {chatView === "chat" && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 8px", display: "flex", flexDirection: "column" }}>
              {messages.map((msg, i) => (
                <div key={i} ref={el => { if (el) messageRefsMap.current.set(i, el); else messageRefsMap.current.delete(i); }}>
                  <MessageBubble
                    message={msg}
                    folderPath={folderPath}
                    onApplyCode={onApplyCode}
                    getOpenTabPaths={getOpenTabPaths}
                    onResolveFail={() => showToast("Could not determine target file for this code block.", "error")}
                    onPin={handleStartPin}
                    onPlanApprove={handlePlanApprove}
                    onPlanReject={handlePlanReject}
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
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--origin-fg-default)" }}>Chat History</div>
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
                        border: "none", cursor: "pointer", gap: "8px", textAlign: "left", minWidth: 0,
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
                        marginRight: "4px", transition: "opacity 0.1s",
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
          style={{ width: contextWidth, borderLeft: "1px solid var(--origin-border-default)", backgroundColor: "var(--origin-bg-sidebar)" }}
        >
          <div
            onMouseDown={onCtxMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10"
            style={{ backgroundColor: "transparent" }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-border-default)"; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
          />
          <div className="flex items-center px-3 shrink-0" style={{ height: "36px", borderBottom: "1px solid var(--origin-border-default)", gap: "6px" }}>
            <Pin size={13} style={{ color: "var(--origin-fg-muted)" }} />
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--origin-fg-default)" }}>Pinboard</span>
          </div>

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
                    <div key={pin.id} style={{ borderRadius: "7px", border: "1px solid var(--origin-border-default)", backgroundColor: "var(--origin-bg-base)", overflow: "hidden" }}>
                      <div
                        onClick={() => setExpandedPins(prev => { const next = new Set(prev); if (next.has(pin.id)) next.delete(pin.id); else next.add(pin.id); return next; })}
                        style={{ display: "flex", alignItems: "flex-start", gap: "6px", padding: "8px 8px 6px", cursor: "pointer" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--origin-bg-hover)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent"; }}
                      >
                        <span style={{ flexShrink: 0, marginTop: "1px", color: "var(--origin-fg-subtle)" }}>
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: pin.label ? 600 : 400, color: "var(--origin-fg-default)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {preview}
                          </div>
                          <div style={{ fontSize: "10px", color: "var(--origin-fg-subtle)", marginTop: "2px" }}>
                            {formatRelativeTime(pin.pinnedAt)}
                          </div>
                        </div>
                        {pin.sessionId && (
                          <button onClick={e => { e.stopPropagation(); handleNavigateToPin(pin); }} title="Go to message" style={{ flexShrink: 0, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", borderRadius: "3px", color: "var(--origin-fg-subtle)" }} onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }} onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}>
                            <ArrowUpRight size={12} />
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); handleUnpin(pin.id); }} title="Unpin" style={{ flexShrink: 0, display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", borderRadius: "3px", color: "var(--origin-fg-subtle)" }} onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }} onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}>
                          <PinOff size={11} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 10px 10px", borderTop: "1px solid var(--origin-border-default)", fontSize: "12px", lineHeight: 1.55, overflowY: "auto", maxHeight: "320px" }}>
                          <MarkdownMessage content={pin.content} isStreaming={false} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ flex: 3, minHeight: 0, borderTop: "1px solid var(--origin-border-default)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "6px 12px 4px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--origin-fg-subtle)", flexShrink: 0 }}>
              Notes
            </div>
            <textarea
              value={notesValue}
              onChange={handleNotesChange}
              placeholder="Write anything…"
              style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", padding: "4px 12px 10px", fontSize: "12px", lineHeight: 1.6, color: "var(--origin-fg-default)", fontFamily: "var(--font-sans)", overflowY: "auto" }}
            />
          </div>
        </div>
      )}
    </div>

    {pendingPin && (
      <PinLabelPopover onConfirm={handleConfirmPin} onCancel={() => setPendingPin(null)} />
    )}
    {confirmDelete && (
      <ConfirmDialog
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => { handleDeleteSession(confirmDelete.id); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
    )}
    </>
  );
}
