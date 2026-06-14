import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, ArrowUp, SlidersHorizontal, ChevronDown, Bot, MessageCircle, Map, FileCode, X } from "lucide-react";
import PreferencesDropdown from "./PreferencesDropdown";
import MentionDropdown from "./MentionDropdown";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from "./providers";
import type { EditorContext } from "../editor/Editor";
import { useWorkspace } from "../../context/WorkspaceContext";

// ── Mode selector ─────────────────────────────────────────────────────────────

type Mode = "agent" | "ask" | "plan";

const MODES = [
  { id: "agent" as Mode, Icon: Bot,           label: "Agent", description: "Autonomously writes, edits, and runs code to complete your task." },
  { id: "ask"   as Mode, Icon: MessageCircle, label: "Ask",   description: "Ask questions about your codebase and get instant answers." },
  { id: "plan"  as Mode, Icon: Map,           label: "Plan",  description: "Explores your codebase and writes a structured plan before making any changes." },
];

function ModeDropdown({ anchorEl, selected, onSelect, onClose }: {
  anchorEl: HTMLElement | null; selected: Mode; onSelect: (m: Mode) => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [hovered, setHovered] = useState<Mode | null>(null);
  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setPos({ left: r.left, top: r.top - 6 });
  }, [anchorEl]);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  if (!anchorEl) return null;
  return createPortal(
    <div ref={menuRef} style={{ position:"fixed", top:pos.top, left:pos.left, minWidth:"200px", maxWidth:"220px",
      transform:"translateY(-100%)",
      background:"color-mix(in srgb, var(--origin-bg-base) 90%, transparent)", backdropFilter:"blur(16px)",
      WebkitBackdropFilter:"blur(16px)", border:"1px solid var(--origin-border-default)", borderRadius:"10px",
      boxShadow:"0 8px 32px rgba(0,0,0,0.35)", padding:"4px", zIndex:9999 }}>
      {MODES.map(({ id, Icon, label, description }) => {
        const isSelected = selected === id; const isHovered = hovered === id;
        return (
          <button key={id} onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)}
            onClick={() => { onSelect(id); onClose(); }}
            style={{ width:"100%", display:"flex", alignItems:"flex-start", gap:"10px", padding:"8px 10px",
              borderRadius:"7px", border:"none", cursor:"pointer",
              background: isHovered ? "var(--origin-bg-hover)" : "transparent", textAlign:"left", transition:"background 0.1s" }}>
            <div style={{ marginTop:"1px", color: isSelected ? "var(--origin-fg-default)" : "var(--origin-fg-muted)", flexShrink:0 }}><Icon size={15} /></div>
            <div>
              <div style={{ fontSize:"13px", fontWeight: isSelected ? 600 : 400, color:"var(--origin-fg-default)", marginBottom:"2px" }}>{label}</div>
              <div style={{ fontSize:"11px", color:"var(--origin-fg-muted)", lineHeight:"1.4" }}>{description}</div>
            </div>
          </button>
        );
      })}
    </div>, document.body
  );
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

function createBadgeElement(filepath: string, filename: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.contentEditable = 'false';
  badge.setAttribute('data-filepath', filepath);
  badge.textContent = filename;
  badge.style.cssText = [
    'display:inline-flex', 'align-items:center', 'padding:1px 6px',
    'border-radius:4px', 'font-size:11px', 'font-family:var(--font-mono)',
    'background:var(--origin-bg-active)',
    'border:1px solid var(--origin-border-default)',
    'color:var(--origin-fg-default)', 'cursor:default', 'user-select:none',
    'vertical-align:middle', 'margin:0 1px',
  ].join(';');
  return badge;
}

function appendFileBadge(el: HTMLDivElement, filepath: string, filename: string) {
  // Don't duplicate
  if (el.querySelector(`[data-filepath="${CSS.escape(filepath)}"]`)) return;

  const badge = createBadgeElement(filepath, filename);
  // Ensure a space before the badge if content exists
  const last = el.lastChild;
  if (last && !(last.nodeType === Node.TEXT_NODE && (last.textContent ?? '').endsWith(' '))) {
    el.appendChild(document.createTextNode(' '));
  }
  el.appendChild(badge);
  el.appendChild(document.createTextNode(' '));

  // Move cursor to end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = document.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

// ── Mention helpers ───────────────────────────────────────────────────────────

function getMentionQuery(el: HTMLDivElement): string | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const textBefore = (node.textContent ?? '').slice(0, range.startOffset);
  const match = textBefore.match(/@(\S*)$/);
  return match ? match[1] : null;
}

function insertMentionBadge(el: HTMLDivElement, savedRange: Range, filepath: string, filename: string) {
  // Restore focus and cursor position (lost when user clicked the dropdown)
  el.focus();
  const sel = document.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(savedRange.cloneRange());

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const textContent = node.textContent ?? '';
  const beforeCursor = textContent.slice(0, range.startOffset);
  const afterCursor = textContent.slice(range.startOffset);

  const match = beforeCursor.match(/@(\S*)$/);
  if (!match) return;
  const atIndex = beforeCursor.length - match[0].length;

  const badge = createBadgeElement(filepath, filename);

  const parent = node.parentNode!;
  const beforeNode = document.createTextNode(beforeCursor.slice(0, atIndex));
  const afterNode = document.createTextNode(' ' + afterCursor);

  parent.insertBefore(beforeNode, node);
  parent.insertBefore(badge, node);
  parent.insertBefore(afterNode, node);
  parent.removeChild(node);

  // Move cursor after the inserted space
  const newRange = document.createRange();
  newRange.setStart(afterNode, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function parseContent(el: HTMLDivElement): { displayText: string; fileMentions: string[] } {
  const fileMentions: string[] = [];
  let displayText = '';

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      displayText += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      const fp = elem.getAttribute('data-filepath');
      if (fp) {
        fileMentions.push(fp);
        displayText += `@${elem.textContent}`;
      } else if (elem.tagName === 'BR') {
        displayText += '\n';
      } else {
        elem.childNodes.forEach(walk);
      }
    }
  }

  el.childNodes.forEach(walk);
  return { displayText: displayText.trim(), fileMentions };
}

function contextLabel(ctx: EditorContext): string {
  if (ctx.startLine === ctx.endLine) return `L${ctx.startLine}`;
  return `L${ctx.startLine}–${ctx.endLine}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ChatBoxProps {
  onSend?: (text: string, modelId: string, providerId: string, fileMentions: string[], editorContext: EditorContext | null, mode: Mode) => void;
  getEditorContext?: () => EditorContext | null;
  forcedContext?: EditorContext | null;
  onForcedContextConsumed?: () => void;
}

export default function ChatBox({ onSend, getEditorContext, forcedContext, onForcedContextConsumed }: ChatBoxProps) {
  const { folderPath } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);
  const modeAnchorRef = useRef<HTMLDivElement>(null);
  const prefsAnchorRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const mentionRangeRef = useRef<Range | null>(null);

  const [isEmpty, setIsEmpty] = useState(true);
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<Mode>("agent");
  const [modeOpen, setModeOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [contextSnap, setContextSnap] = useState<EditorContext | null>(null);
  const [contextDismissed, setContextDismissed] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(
    () => localStorage.getItem("origin-ai-model") ?? DEFAULT_MODEL_ID
  );
  const [selectedProviderId, setSelectedProviderId] = useState(
    () => localStorage.getItem("origin-ai-provider") ?? DEFAULT_PROVIDER_ID
  );

  const refreshContext = useCallback(() => {
    if (!getEditorContext || contextDismissed) return;
    const ctx = getEditorContext();
    setContextSnap(ctx);
  }, [getEditorContext, contextDismissed]);

  useEffect(() => {
    if (!forcedContext) return;
    setContextSnap(forcedContext);
    setContextDismissed(false);
    onForcedContextConsumed?.();
  }, [forcedContext]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = () => {
    const el = editableRef.current;
    if (!el) return;
    setIsEmpty(el.textContent?.trim() === "" && !el.querySelector('[data-filepath]'));

    if (folderPath) {
      const query = getMentionQuery(el);
      if (query !== null) {
        // Save range on every keystroke while mention is active
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          mentionRangeRef.current = sel.getRangeAt(0).cloneRange();
        }
        setMentionQuery(query);
        setMentionActive(true);
      } else {
        setMentionActive(false);
        setMentionQuery('');
        mentionRangeRef.current = null;
      }
    }
  };

  const handleSend = () => {
    const el = editableRef.current;
    if (!el) return;
    const { displayText, fileMentions } = parseContent(el);
    if (!displayText && fileMentions.length === 0) return;
    const editorContext = contextDismissed ? null : contextSnap;
    onSend?.(displayText, selectedModelId, selectedProviderId, fileMentions, editorContext, mode);
    el.innerHTML = "";
    setIsEmpty(true);
    setMentionActive(false);
    setMentionQuery('');
    mentionRangeRef.current = null;
    // Reset context for next message
    setContextDismissed(false);
    setContextSnap(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && mentionActive) {
      e.stopPropagation();
      setMentionActive(false);
      setMentionQuery('');
      mentionRangeRef.current = null;
      return;
    }

    if (e.key === "Backspace") {
      const el = editableRef.current;
      if (el) {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (range.collapsed) {
            // Find the node immediately before the cursor
            let prevNode: Node | null = null;
            if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
              prevNode = range.startContainer.previousSibling;
            } else if (range.startContainer === el) {
              prevNode = el.childNodes[range.startOffset - 1] ?? null;
            }
            if (prevNode instanceof Element && prevNode.hasAttribute('data-filepath')) {
              e.preventDefault();
              prevNode.remove();
              handleInput();
              return;
            }
          }
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !mentionActive) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMentionSelect = (filepath: string, filename: string) => {
    const el = editableRef.current;
    const savedRange = mentionRangeRef.current;
    if (el && savedRange) {
      insertMentionBadge(el, savedRange, filepath, filename);
      handleInput();
    }
    setMentionActive(false);
    setMentionQuery('');
    mentionRangeRef.current = null;
  };

  const currentMode = MODES.find(m => m.id === mode)!;
  const showContextBadge = contextSnap && !contextDismissed;

  return (
    <div
      ref={containerRef}
      onFocus={refreshContext}
      style={{
        margin: "10px",
        borderRadius: "8px",
        border: "1px solid var(--origin-border-default)",
        backgroundColor: "var(--origin-bg-base)",
        outline: focused
          ? "1px solid color-mix(in srgb, var(--origin-fg-muted) 50%, transparent)"
          : "1px solid transparent",
        outlineOffset: "2px",
        transition: "outline-color 0.15s ease",
        position: "relative",
      }}
    >
      {/* @ mention dropdown */}
      {mentionActive && folderPath && (
        <MentionDropdown
          anchorEl={containerRef.current}
          query={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => { setMentionActive(false); setMentionQuery(''); mentionRangeRef.current = null; }}
        />
      )}

      {/* + attach dropdown (multi-select) */}
      {attachOpen && folderPath && (
        <MentionDropdown
          anchorEl={containerRef.current}
          query=""
          keepOpen
          attachedPaths={
            Array.from(editableRef.current?.querySelectorAll('[data-filepath]') ?? [])
              .map(el => (el as HTMLElement).getAttribute('data-filepath')!)
          }
          onSelect={(filepath, filename) => {
            const el = editableRef.current;
            if (el) { appendFileBadge(el, filepath, filename); handleInput(); }
          }}
          onClose={() => setAttachOpen(false)}
        />
      )}

      {/* Auto context badge */}
      {showContextBadge && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px 4px",
          flexWrap: "wrap",
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "2px 6px 2px 5px",
            borderRadius: "5px",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            background: "var(--origin-bg-active)",
            border: "1px solid var(--origin-border-default)",
            color: "var(--origin-fg-default)",
            maxWidth: "100%",
          }}>
            <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {contextSnap!.filename}
            </span>
            <span style={{
              padding: "0 4px",
              borderRadius: "3px",
              fontSize: "10px",
              background: "var(--origin-bg-hover)",
              color: "var(--origin-fg-muted)",
            }}>
              {contextLabel(contextSnap!)}
            </span>
            <button
              onMouseDown={e => {
                e.preventDefault(); // don't steal focus from editable
                setContextDismissed(true);
                setContextSnap(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0",
                color: "var(--origin-fg-subtle)",
                lineHeight: 1,
              }}
            >
              <X size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Editable area */}
      <div style={{ position: "relative" }}>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            minHeight: "70px",
            maxHeight: "200px",
            padding: "8px 10px",
            outline: "none",
            fontSize: "13px",
            color: "var(--origin-fg-default)",
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowY: "auto",
            cursor: "text",
          }}
        />
        {isEmpty && (
          <div
            style={{
              position: "absolute",
              top: "8px",
              left: "10px",
              pointerEvents: "none",
              fontSize: "13px",
              color: "var(--origin-fg-subtle)",
              lineHeight: "1.5",
              userSelect: "none",
            }}
          >
            Ask anything…
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          gap: "6px",
        }}
      >
        <button
          ref={plusBtnRef}
          onClick={() => { if (folderPath) setAttachOpen(v => !v); }}
          title="Attach files"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: attachOpen ? "var(--origin-bg-hover)" : "none",
            border: "none",
            cursor: folderPath ? "pointer" : "default",
            padding: "2px",
            borderRadius: "4px",
            color: attachOpen ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
          }}
        >
          <Plus size={14} />
        </button>

        <div
          ref={modeAnchorRef}
          onClick={() => setModeOpen(v => !v)}
          style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:"12px", fontWeight:500,
            padding:"2px 7px 2px 8px", borderRadius:"9999px", border:"1px solid var(--origin-border-default)",
            backgroundColor: mode !== "agent" ? "var(--origin-bg-active)" : "transparent",
            color: mode !== "agent" ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
            userSelect:"none", cursor:"pointer", transition:"background 0.1s, color 0.1s" }}>
          {currentMode.label}
          <ChevronDown size={10} />
        </div>
        {modeOpen && (
          <ModeDropdown anchorEl={modeAnchorRef.current} selected={mode} onSelect={setMode} onClose={() => setModeOpen(false)} />
        )}

        <div style={{ flex: 1 }} />

        <button
          ref={prefsAnchorRef}
          onClick={() => setPrefsOpen(v => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            borderRadius: "4px",
            color: "var(--origin-fg-muted)",
          }}
        >
          <SlidersHorizontal size={14} />
        </button>

        {prefsOpen && (
          <PreferencesDropdown
            anchorEl={prefsAnchorRef.current}
            selectedModelId={selectedModelId}
            onSelect={(providerId, modelId) => {
              setSelectedModelId(modelId);
              setSelectedProviderId(providerId);
              localStorage.setItem("origin-ai-model", modelId);
              localStorage.setItem("origin-ai-provider", providerId);
            }}
            onClose={() => setPrefsOpen(false)}
          />
        )}

        <button
          onClick={handleSend}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "24px",
            height: "24px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            backgroundColor: "var(--origin-fg-default)",
            color: "var(--origin-bg-base)",
          }}
        >
          <ArrowUp size={14} />
        </button>
      </div>
    </div>
  );
}
