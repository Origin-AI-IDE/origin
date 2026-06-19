import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Plus, Terminal, X } from "lucide-react";
import { getSetting, setSetting, type SavedTermTab } from "../../lib/settings";
import TerminalInstance from "./Terminal";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const LS_TABS = "origin-terminal-tabs";
const LS_ACTIVE = "origin-terminal-active-index";

interface TermTab {
  id: number;
  name: string;
  cwd: string;
}

interface TabShellInfo {
  state: 'idle' | 'running';
  exitCode?: number;
}

export interface TerminalPanelHandle {
  addTab: () => void;
  clearActive: () => void;
  killActive: () => void;
  runInNewTab: (command: string) => void;
}

interface Props {
  cwd: string;
  height: number;
  onResize: (h: number) => void;
  onClose: () => void;
  hidden?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initCounter(tabs: TermTab[]): number {
  return tabs.length + 1;
}

function nextTabName(currentTabs: TermTab[]): string {
  const used = new Set(
    currentTabs.map(t => parseInt(t.name, 10)).filter(n => Number.isInteger(n) && n > 0)
  );
  let n = 1;
  while (used.has(n)) n++;
  return String(n);
}

function loadSavedTabs(defaultCwd: string): TermTab[] {
  try {
    const raw = localStorage.getItem(LS_TABS);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedTermTab[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((t, i) => ({ id: i + 1, name: t.name, cwd: defaultCwd }));
      }
    }
  } catch { /* stored tab state is missing or malformed — start fresh */ }
  return [{ id: 1, name: "1", cwd: defaultCwd }];
}

function loadSavedActiveIndex(tabCount: number): number {
  const n = parseInt(localStorage.getItem(LS_ACTIVE) ?? "0", 10);
  return isNaN(n) ? 0 : Math.min(n, tabCount - 1);
}

function saveTabs(tabs: TermTab[]) {
  const data = tabs.map((t) => ({ name: t.name, cwd: t.cwd }));
  localStorage.setItem(LS_TABS, JSON.stringify(data));
  setSetting("terminal.tabs", data);
}

function saveActiveIndex(tabs: TermTab[], activeId: number) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  localStorage.setItem(LS_ACTIVE, String(idx));
  setSetting("terminal.activeIndex", idx);
}

// ── Small reusable button ─────────────────────────────────────────────────────

function PanelBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        flexShrink: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--origin-fg-muted)",
        borderRadius: 3,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-bg-hover)";
        (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-default)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-muted)";
      }}
    >
      {children}
    </button>
  );
}

function ShellDot({ info }: { info: TabShellInfo | undefined }) {
  if (!info) return null;
  if (info.state === 'running') {
    return (
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        backgroundColor: 'var(--origin-accent-blue)',
        animation: 'pulse 1.2s ease-in-out infinite',
        display: 'inline-block',
      }} />
    );
  }
  if (info.exitCode !== undefined) {
    return (
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        backgroundColor: info.exitCode === 0 ? 'var(--origin-semantic-success)' : 'var(--origin-semantic-error)',
        display: 'inline-block',
      }} />
    );
  }
  return null;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

const TerminalPanel = forwardRef<TerminalPanelHandle, Props>(function TerminalPanel({ cwd, height, onResize, onClose, hidden }, ref) {
  const [tabs, setTabs] = useState<TermTab[]>(() => loadSavedTabs(cwd));
  const [activeId, setActiveId] = useState<number>(() => {
    const idx = loadSavedActiveIndex(tabs.length);
    return tabs[idx]?.id ?? tabs[0].id;
  });
  const nextId = useRef(initCounter(tabs));
  const prevCwdRef = useRef(cwd);
  const [clearKeys, setClearKeys] = useState<Record<number, number>>({});
  const [pendingInputs, setPendingInputs] = useState<Record<number, string>>({});
  const [shellInfos, setShellInfos] = useState<Record<number, TabShellInfo>>({});
  const exitClearTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Rename state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useImperativeHandle(ref, () => ({
    addTab,
    clearActive() {
      setClearKeys(prev => ({ ...prev, [activeId]: (prev[activeId] ?? 0) + 1 }));
    },
    killActive() {
      closeTab(activeId);
    },
    runInNewTab(command: string) {
      const id = nextId.current++;
      const name = nextTabName(tabs);
      setTabs((prev) => [...prev, { id, name, cwd }]);
      setActiveId(id);
      setPendingInputs(prev => ({ ...prev, [id]: command }));
    },
  }));

  // ── Restore from durable store on first mount ────────────────────────────
  useEffect(() => {
    Promise.all([getSetting("terminal.tabs"), getSetting("terminal.activeIndex")]).then(
      ([savedTabs, savedIdx]) => {
        if (savedTabs.length > 0) {
          const restored = savedTabs.map((t, i) => ({ id: i + 1, name: t.name, cwd }));
          setTabs(restored);
          nextId.current = initCounter(restored);
          setActiveId(restored[savedIdx]?.id ?? restored[0].id);
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount; cwd is intentionally the initial value
  }, []);

  // ── Persist tab list whenever it changes ────────────────────────────────
  useEffect(() => {
    saveTabs(tabs);
  }, [tabs]);

  useEffect(() => {
    saveActiveIndex(tabs, activeId);
  }, [activeId, tabs]);

  // ── Resize drag ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startH: height };

      function onMove(ev: MouseEvent) {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        onResize(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta)));
      }

      function onUp() {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height, onResize],
  );

  // ── Reset tabs when project folder changes ───────────────────────────────
  useEffect(() => {
    if (cwd === prevCwdRef.current) return;
    prevCwdRef.current = cwd;
    const newId = nextId.current++;
    const fresh: TermTab[] = [{ id: newId, name: "1", cwd }];
    setTabs(fresh);
    setActiveId(newId);
  }, [cwd]);

  // ── Tab management ───────────────────────────────────────────────────────
  function addTab() {
    const id = nextId.current++;
    const name = nextTabName(tabs);
    setTabs((prev) => [...prev, { id, name, cwd }]);
    setActiveId(id);
  }

  function closeTab(id: number) {
    if (exitClearTimers.current[id]) {
      clearTimeout(exitClearTimers.current[id]);
      delete exitClearTimers.current[id];
    }
    setShellInfos(prev => { const c = { ...prev }; delete c[id]; return c; });
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        onClose();
        return prev;
      }
      if (activeId === id) {
        const idx = prev.findIndex((t) => t.id === id);
        const fallback = next[idx] ?? next[idx - 1];
        setActiveId(fallback.id);
      }
      return next;
    });
  }

  // ── Rename ───────────────────────────────────────────────────────────────
  function startEdit(tab: TermTab) {
    setEditingId(tab.id);
    setEditValue(tab.name);
    // Input auto-focuses via autoFocus prop
  }

  function commitEdit() {
    if (editingId === null) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      setTabs((prev) => prev.map((t) => (t.id === editingId ? { ...t, name: trimmed } : t)));
    }
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function handleCwdChange(tabId: number, cwd: string) {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, cwd } : t));
  }

  function handleShellState(tabId: number, state: 'idle' | 'running', exitCode?: number) {
    if (exitClearTimers.current[tabId]) {
      clearTimeout(exitClearTimers.current[tabId]);
      delete exitClearTimers.current[tabId];
    }
    setShellInfos(prev => ({
      ...prev,
      [tabId]: { state, exitCode: state === 'idle' ? exitCode : undefined },
    }));
    if (state === 'idle' && exitCode === 0) {
      exitClearTimers.current[tabId] = setTimeout(() => {
        delete exitClearTimers.current[tabId];
        setShellInfos(prev => {
          const info = prev[tabId];
          if (!info || info.exitCode !== 0) return prev;
          return { ...prev, [tabId]: { ...info, exitCode: undefined } };
        });
      }, 2000);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height,
        flexShrink: 0,
        display: hidden ? "none" : "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--origin-border-default)",
        backgroundColor: "var(--origin-bg-panel)",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{ height: 4, flexShrink: 0, cursor: "row-resize" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-border-default)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
        }}
      />

      {/* Header */}
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 10,
          paddingRight: 6,
          borderBottom: "1px solid var(--origin-border-subtle)",
          userSelect: "none",
        }}
      >
        {/* Panel icon */}
        <Terminal
          size={14}
          style={{ color: "var(--origin-fg-muted)", flexShrink: 0, marginRight: 4 }}
        />

        {/* Tab strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, overflow: "hidden" }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            const isEditing = tab.id === editingId;

            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  paddingLeft: 8,
                  paddingRight: tabs.length > 1 ? 4 : 8,
                  height: 22,
                  borderRadius: 4,
                  cursor: "pointer",
                  flexShrink: 0,
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: isActive ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
                  backgroundColor: isActive ? "var(--origin-bg-active)" : "transparent",
                  transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.backgroundColor =
                      "var(--origin-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                <ShellDot info={shellInfos[tab.id]} />
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: Math.max(40, editValue.length * 7 + 8),
                      background: "transparent",
                      border: "none",
                      outline: "1px solid var(--origin-accent-blue)",
                      borderRadius: 2,
                      color: "var(--origin-fg-default)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      padding: "0 2px",
                    }}
                  />
                ) : (
                  <span onDoubleClick={(e) => { e.stopPropagation(); startEdit(tab); }}>
                    {tab.name}
                  </span>
                )}

                {tabs.length > 1 && !isEditing && (
                  <span
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 14,
                      height: 14,
                      borderRadius: 2,
                      color: "var(--origin-fg-subtle)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-default)";
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        "var(--origin-bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-subtle)";
                      (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    }}
                  >
                    <X size={10} />
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* New terminal */}
        <PanelBtn onClick={addTab} title="New Terminal">
          <Plus size={13} />
        </PanelBtn>

        {/* Close panel */}
        <PanelBtn onClick={onClose} title="Close Terminal (Ctrl+`)">
          <X size={12} />
        </PanelBtn>
      </div>

      {/* Terminal instances — all mounted, only active is visible */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: "absolute",
              inset: 0,
              opacity: tab.id === activeId ? 1 : 0,
              pointerEvents: tab.id === activeId ? "auto" : "none",
            }}
          >
            <TerminalInstance
              cwd={tab.cwd}
              active={tab.id === activeId}
              clearKey={clearKeys[tab.id] ?? 0}
              pendingInput={pendingInputs[tab.id]}
              onCwdChange={(cwd) => handleCwdChange(tab.id, cwd)}
              onShellState={(state, exitCode) => handleShellState(tab.id, state, exitCode)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

export default TerminalPanel;
