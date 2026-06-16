import { useRef, useCallback, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare, History, Plus, Pin, PinOff,
  ChevronRight, ChevronDown, ArrowUpRight, Trash2,
} from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useToast } from "../ui/Toast";
import ChatBox from "./ChatBox";
import MessageBubble from "./MessageBubble";
import MarkdownMessage from "./MarkdownMessage";
import { PROVIDERS } from "./providers";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_ASK_PROMPT, DEFAULT_PLAN_PROMPT, type UsageData } from "../../lib/ai";
import { ensurePricing, computeCost } from "../../lib/pricing";
import { recordUsage } from "../../lib/usage";
import { loadApiKey } from "../../lib/secrets";
import { readFile } from "../../lib/fs";
import { buildLanguageModel } from "../../lib/agent/providers";
import { createTools, createReadOnlyTools, createAskTools } from "../../lib/agent/tools";
import { runAgent, type AgentEvent } from "../../lib/agent/run";
import { parsePlan } from "../../lib/agent/planTypes";
import type { ModelMessage } from "ai";
import {
  createSession,
  touchSession,
  insertMessage,
  updateMessageContent,
  deleteSession,
  type DbSession,
} from "../../lib/db";
import type { EditorContext } from "../editor/Editor";
import { useWorkspace } from "../../context/WorkspaceContext";
import {
  type DisplayMessage, type MessagePart, type PinnedMessage,
  appendText, updateTcInParts,
} from "../../lib/aiTypes";
import {
  activeSessionKey, lsForPath, lsPush, lsTouch, lsDelete,
  restoreSession,
} from "../../lib/sessionStore";
import { pbRead, pbWrite, pinPreview, NOTES_KEY } from "../../lib/pinboardStore";

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
              background: "var(--origin-semantic-error)", border: "1px solid transparent", color: "#fff",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
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

function buildContextPrefix(ctx: EditorContext, displayPath?: string): string {
  const ext = ctx.filename.split(".").pop()?.toLowerCase() ?? "";
  const fenceMap: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", rs: "rs",
    py: "python", css: "css", html: "html", json: "json", md: "markdown",
  };
  const fence = fenceMap[ext] ?? ext;
  const label = ctx.type === "selection" ? "Selected code" : "Visible code";
  return `[${label} in ${displayPath ?? ctx.filename}]\n\`\`\`${fence}\n${ctx.code}\n\`\`\`\n\n`;
}

function toWorkspaceRelPath(fullPath: string, folderPath: string): string {
  const fpNorm = folderPath.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const spNorm = fullPath.replace(/\\/g, "/");
  return spNorm.startsWith(fpNorm) ? spNorm.slice(fpNorm.length) : spNorm.split("/").pop() ?? fullPath;
}


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
  getFileContents?: () => Record<string, string>;
  onOpenDiffTab?: (data: AiDiffTabInput) => void;
}

function buildModelHistory(messages: DisplayMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.content.trim()) result.push({ role: "user", content: m.content });
      continue;
    }
    // assistant
    if (!m.parts || m.parts.length === 0) {
      if (m.content.trim()) result.push({ role: "assistant", content: m.content });
      continue;
    }
    const assistantContent: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }> = [];
    const toolResults: Array<{ type: "tool-result"; toolCallId: string; toolName: string; output: { type: "text"; value: string } }> = [];
    for (const part of m.parts) {
      if (part.type === "text") {
        if (part.content.trim()) assistantContent.push({ type: "text", text: part.content });
      } else if (part.type === "tool-call") {
        assistantContent.push({ type: "tool-call", toolCallId: part.tc.id, toolName: part.tc.toolName, input: part.tc.args ?? {} });
        if (part.tc.result !== undefined) {
          const value = typeof part.tc.result === "string" ? part.tc.result : JSON.stringify(part.tc.result);
          toolResults.push({ type: "tool-result", toolCallId: part.tc.id, toolName: part.tc.toolName, output: { type: "text", value } });
        }
      }
      // plan-card parts are UI-only — no model representation
    }
    if (assistantContent.length > 0) {
      result.push({ role: "assistant", content: assistantContent } as ModelMessage);
    } else if (m.content.trim()) {
      result.push({ role: "assistant", content: m.content });
    }
    if (toolResults.length > 0) {
      result.push({ role: "tool", content: toolResults } as ModelMessage);
    }
  }
  return result;
}

export default function AiPanel({
  getEditorContext, getActiveFilePath, forcedContext, onForcedContextConsumed,
  onApplyCode, getOpenTabPaths, getFileContents, onOpenDiffTab,
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
  const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null);
  const pendingScrollContentRef = useRef<string | null>(null);
  const [pendingPin, setPendingPin] = useState<{ content: string; sessionId?: string } | null>(null);
  const [expandedPins, setExpandedPins] = useState<Set<string>>(new Set());
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  const messagesRef        = useRef<DisplayMessage[]>([]);
  const streamCleanupRef   = useRef<(() => void) | null>(null);
  const messagesEndRef     = useRef<HTMLDivElement>(null);

  const folderPathRef              = useRef<string | null | undefined>(folderPath);
  const originMdRef                = useRef<string>("");
  const isFirstFolderEffect        = useRef(true);
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
    if (!folderPath) { originMdRef.current = ""; return; }
    const sep = folderPath.includes("\\") ? "\\" : "/";
    readFile(`${folderPath}${sep}ORIGIN.md`)
      .then(content => { originMdRef.current = content.trim(); })
      .catch(() => { originMdRef.current = ""; });
  }, [folderPath]);

  useEffect(() => {
    if (pendingScrollIndex === null || chatView !== "chat") return;
    const timer = setTimeout(() => {
      messageRefsMap.current.get(pendingScrollIndex)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingScrollIndex(null);
    }, 80);
    return () => clearTimeout(timer);
  }, [pendingScrollIndex, chatView]);

  useEffect(() => {
    if (chatView === "chat") { messagesEndRef.current?.scrollIntoView(); }
  }, [messages, chatView]);

  useEffect(() => {
    const fp = folderPath ?? "";
    setSessions(lsForPath(fp));

    if (!isFirstFolderEffect.current) {
      // Project switched — cancel any in-flight stream and reset to new chat
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
      setChatView("new");
      localStorage.setItem("origin-ai-chat-view", "new");
    }
    isFirstFolderEffect.current = false;

    let cancelled = false;
    const storedId = localStorage.getItem(activeSessionKey(fp));
    if (storedId) {
      (async () => {
        try {
          if (cancelled) return;
          const displayMsgs = await restoreSession(storedId);
          if (cancelled) return;
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
      const displayMsgs = await restoreSession(sessionId);
      setMessages(displayMsgs);
      const scrollContent = pendingScrollContentRef.current;
      if (scrollContent) {
        pendingScrollContentRef.current = null;
        const idx = displayMsgs.findIndex(m => m.content === scrollContent);
        if (idx !== -1) setPendingScrollIndex(idx);
      }
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
      const relPath = sourceFilePath ? toWorkspaceRelPath(sourceFilePath, fp) : undefined;
      apiText = buildContextPrefix(editorContext, relPath) + apiText;
    }
    for (const filepath of fileMentions) {
      try {
        const content = await readFile(filepath);
        const fname = filepath.split(/[\\/]/).pop() ?? filepath;
        const ext = fname.split(".").pop()?.toLowerCase() ?? "";
        const fenceMap: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", rs: "rs", py: "python", css: "css", html: "html", json: "json", md: "markdown" };
        apiText += `\n\n[File: ${filepath}]\n\`\`\`${fenceMap[ext] ?? ext}\n${content}\n\`\`\``;
      } catch { /* skip unreadable files */ }
    }

    const userMsg: DisplayMessage = {
      role: "user", content: text, sourceFilePath,
      fileMentions: fileMentions.length > 0 ? fileMentions : undefined,
      editorContext: editorContext ?? undefined,
    };

    const modelMessages: ModelMessage[] = [
      ...buildModelHistory(messagesRef.current.filter(m => !m.streaming)),
      { role: "user" as const, content: apiText },
    ];

    setMessages(prev => [
      ...prev,
      userMsg,
      { role: "assistant", content: "", streaming: true, parts: [], sourceFilePath: userMsg.sourceFilePath },
    ]);
    setChatView("chat");
    localStorage.setItem("origin-ai-chat-view", "chat");

    const originMd = originMdRef.current;
    const withOriginMd = (base: string) =>
      originMd ? `${base}\n\n---\n\n${originMd}` : base;

    const systemPrompt     = withOriginMd(localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT);
    const askSystemPrompt  = withOriginMd(localStorage.getItem("origin-ai-ask-prompt")    ?? DEFAULT_ASK_PROMPT);
    const planSystemPrompt = withOriginMd(localStorage.getItem("origin-ai-plan-prompt")   ?? DEFAULT_PLAN_PROMPT);

    // ── Event handler ────────────────────────────────────────────────────────
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
          const newPart: MessagePart = { type: "tool-call", tc: { id: event.id, toolName: event.toolName, args: event.args, status: "running" } };
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
            const tc = { id: event.id, toolName: event.action.type, args: event.action, ...approvalUpdate };
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
              const insertedTc = { id: event.id, toolName: event.action.type, args: event.action, ...approvalUpdate };
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
            recordUsage(modelId, modelName, providerId, usage.inputTokens, usage.outputTokens, cost, color, usage.cacheReadTokens);
          }

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

        const phase2SystemPrompt = withOriginMd(localStorage.getItem("origin-ai-system-prompt") ?? DEFAULT_SYSTEM_PROMPT);
        const { cancel } = runAgent({ model, messages: phase2Messages, tools: makeFullTools(), systemPrompt: phase2SystemPrompt, cacheSystem: providerId === "anthropic", onEvent: handleEvent });
        streamCleanupRef.current = cancel;
      };

      const readOnlyTools = createReadOnlyTools({ folderPath: fp || "." });
      const { cancel } = runAgent({ model, messages: modelMessages, tools: readOnlyTools, systemPrompt: planSystemPrompt, cacheSystem: providerId === "anthropic", onEvent: handleEvent });
      streamCleanupRef.current = cancel;
    } else if (mode === "ask") {
      const askTools = createAskTools({
        folderPath: fp || ".",
        getFileContents: getFileContents ?? (() => ({})),
        onShowDiff: (path, _original, patched) => {
          onApplyCodeRef.current?.(patched, path, undefined);
        },
      });
      const { cancel } = runAgent({ model, messages: modelMessages, tools: askTools, systemPrompt: askSystemPrompt, cacheSystem: providerId === "anthropic", onEvent: handleEvent });
      streamCleanupRef.current = cancel;
    } else {
      const { cancel } = runAgent({ model, messages: modelMessages, tools: makeFullTools(), systemPrompt, cacheSystem: providerId === "anthropic", onEvent: handleEvent });
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
    pendingScrollContentRef.current = pin.content;
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
