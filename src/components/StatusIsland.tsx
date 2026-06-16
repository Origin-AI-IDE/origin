import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft, ChevronRight,
  ClipboardList, GitBranch, GitCommit, Cpu, DollarSign,
} from "lucide-react";
import { getGitChanges, type GitChanges } from "../lib/git";
import { getMemory, type MemoryInfo } from "../lib/system";
import { readUsage, resetUsage, type UsageStore } from "../lib/usage";
import { PROVIDERS } from "./ai/providers";
import { useWorkspace } from "../context/WorkspaceContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type CardId = "task" | "changed" | "memory" | "cost";
type BadgeMap = Partial<Record<CardId, number>>;

export interface StatusIslandProps {
  gitBranch:   string | null;
  dirtyCount:  number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CARDS: CardId[] = ["task", "changed", "memory", "cost"];
const CARD_HEIGHT      = 150;
const CARD_HEIGHT_COST = 180;
const TASK_KEY = "island.task";
const CARD_KEY = "island.activeCard";

// ─── Pill content ─────────────────────────────────────────────────────────────

interface PillProps {
  id:         CardId;
  badges:     BadgeMap;
  notifying:  boolean;
  task:       string | null;
  gitData:    GitChanges | null;
  gitBranch:  string | null;
  project:    string;
  memory:     MemoryInfo | null;
  usageData:  UsageStore;
}

function modelChartColor(modelId: string): string {
  const model = PROVIDERS.flatMap(p => p.models).find(m => m.id === modelId);
  if (model) return model.color;
  // Hash fallback for unknown models (e.g. OpenRouter pass-through)
  const palette = ['#f97316','#ef4444','#22c55e','#3b82f6','#a855f7','#ec4899','#eab308','#06b6d4','#84cc16','#f43f5e'];
  let h = 0;
  for (let i = 0; i < modelId.length; i++) h = Math.imul(31, h) + modelId.charCodeAt(i) | 0;
  return palette[Math.abs(h) % palette.length];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.0001) return `$${n.toFixed(6)}`;
  if (n < 0.01)   return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function PillContent({ id, badges, notifying, task, gitData, gitBranch, project, memory, usageData }: PillProps) {
  const hasBadge = (badges[id] ?? 0) > 0;
  const notifyFg = "var(--origin-bg-base)";
  let icon: React.ReactNode;
  let text: string;
  let iconColor = notifying ? notifyFg : "var(--origin-fg-subtle)";

  switch (id) {
    case "task":
      icon = task ? <ClipboardList size={9} /> : <GitBranch size={9} />;
      text = task ?? (gitBranch ? `${gitBranch}  ·  ${project}` : project || "No workspace");
      if (task && !notifying) iconColor = "var(--origin-accent-blue)";
      else if (task && notifying) iconColor = notifyFg;
      break;
    case "changed":
      icon = <GitCommit size={9} />;
      if (gitData) {
        text = gitData.commits_ahead > 0
          ? `${gitData.commits_ahead} commits ahead  ·  ${gitData.files} changed`
          : `${gitData.files} changed`;
      } else {
        text = gitBranch ? "Loading…" : "No workspace";
      }
      break;
    case "memory":
      icon = <Cpu size={9} />;
      text = memory ? `${memory.used_gb} / ${memory.total_gb} GB` : "Loading…";
      break;
    case "cost": {
      const total = Object.values(usageData).reduce((s, m) => s + m.cost, 0);
      icon = <DollarSign size={9} />;
      text = total === 0 ? "No API spend" : `${fmtCost(total)} total`;
      if (!notifying) iconColor = "var(--origin-semantic-success, #22c55e)";
      break;
    }
  }

  return (
    <div
      className="flex-1 min-w-0 flex items-center justify-center gap-1.5"
      style={{ padding: "0 58px" }}
    >
      <span className="shrink-0 flex items-center" style={{ color: iconColor }}>{icon}</span>
      <span
        className="text-[10px] tracking-[0.03em] whitespace-nowrap"
        style={{ color: notifying ? notifyFg : "var(--origin-fg-default)" }}
      >
        {text}
      </span>
      {hasBadge && (
        <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: notifying ? notifyFg : "var(--origin-accent-blue)" }} />
      )}
    </div>
  );
}

// ─── Card header ──────────────────────────────────────────────────────────────

function CardHeader({ id }: { id: CardId }) {
  const icons: Record<CardId, React.ReactNode> = {
    task:    <ClipboardList size={11} />,
    changed: <GitCommit size={11} />,
    memory:  <Cpu size={11} />,
    cost:    <DollarSign size={11} />,
  };
  const iconColors: Record<CardId, string> = {
    task:    "var(--origin-accent-blue)",
    changed: "var(--origin-fg-subtle)",
    memory:  "var(--origin-fg-subtle)",
    cost:    "var(--origin-semantic-success, #22c55e)",
  };
  const labels: Record<CardId, string> = {
    task: "Current Task", changed: "What Changed", memory: "Memory", cost: "AI Spend",
  };
  return (
    <div className="flex items-center gap-2 shrink-0" style={{ padding: "10px 16px 8px" }}>
      <span style={{ color: iconColors[id] }}>{icons[id]}</span>
      <span className="text-[11px] font-medium" style={{ color: "var(--origin-fg-default)" }}>
        {labels[id]}
      </span>
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({ label, variant = "default", onClick }: {
  label: string;
  variant?: "default" | "danger";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="font-mono text-[10px] rounded-md border-none cursor-pointer"
      style={{
        padding:         "3px 10px",
        backgroundColor: "var(--origin-bg-hover)",
        color:           variant === "danger" ? "var(--origin-semantic-error)" : "var(--origin-fg-muted)",
      }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-active)"; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
    >
      {label}
    </button>
  );
}

// ─── Pie chart ────────────────────────────────────────────────────────────────

function PieChart({ slices, size = 68 }: {
  slices: Array<{ color: string; pct: number }>;
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const r  = size * 0.44;
  const ir = size * 0.24;
  const hole = "var(--origin-island-bg-open)";

  if (slices.length === 0 || slices.every(s => s.pct <= 0)) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="var(--origin-bg-hover)" />
        <circle cx={cx} cy={cy} r={ir} fill={hole} />
      </svg>
    );
  }
  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
        <circle cx={cx} cy={cy} r={ir} fill={hole} />
      </svg>
    );
  }
  let angle = -Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((sl, i) => {
        const sweep = (sl.pct / 100) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
        const large = sweep > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
            fill={sl.color}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={ir} fill={hole} />
    </svg>
  );
}

// ─── Card body ────────────────────────────────────────────────────────────────

interface CardBodyProps {
  id:            CardId;
  task:          string | null;
  onClearTask:   () => void;
  onSetTask:     (name: string) => void;
  gitData:       GitChanges | null;
  gitBranch:     string | null;
  project:       string;
  memory:        MemoryInfo | null;
  usageData:     UsageStore;
  onResetUsage:  () => void;
}

function CardBody({ id, task, onClearTask, onSetTask, gitData, gitBranch, project, memory, usageData, onResetUsage }: CardBodyProps) {
  const [settingTask, setSettingTask] = useState(false);
  const [taskInput,   setTaskInput]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settingTask) inputRef.current?.focus();
  }, [settingTask]);

  const confirmTask = () => {
    const v = taskInput.trim();
    if (v) onSetTask(v);
    setSettingTask(false);
    setTaskInput("");
  };

  switch (id) {
    case "task":
      if (task) {
        return (
          <>
            <p className="text-[12px] font-medium" style={{ marginBottom: "10px", color: "var(--origin-fg-default)" }}>
              {task}
            </p>
            <div className="flex gap-2">
              <ActionBtn label="Mark Complete" onClick={onClearTask} />
              <ActionBtn label="Clear" variant="danger" onClick={onClearTask} />
            </div>
          </>
        );
      }
      if (settingTask) {
        return (
          <div className="flex flex-col gap-2">
            <input
              ref={inputRef}
              value={taskInput}
              onChange={e => setTaskInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") confirmTask();
                if (e.key === "Escape") { setSettingTask(false); setTaskInput(""); }
                e.stopPropagation();
              }}
              placeholder="What are you working on?"
              className="font-mono text-[11px] rounded-md border-none outline-none w-full"
              style={{
                padding:         "4px 8px",
                backgroundColor: "var(--origin-bg-hover)",
                color:           "var(--origin-fg-default)",
              }}
            />
            <div className="flex gap-2">
              <ActionBtn label="Set" onClick={confirmTask} />
              <ActionBtn label="Cancel" onClick={() => { setSettingTask(false); setTaskInput(""); }} />
            </div>
          </div>
        );
      }
      return (
        <>
          {gitBranch && (
            <>
              <div className="flex items-center gap-1.5" style={{ marginBottom: "3px" }}>
                <span style={{ color: "var(--origin-fg-subtle)" }}><GitBranch size={9} /></span>
                <span className="font-mono text-[10px]" style={{ color: "var(--origin-fg-muted)" }}>{gitBranch}</span>
              </div>
              <p className="font-mono text-[10px]" style={{ marginBottom: "10px", color: "var(--origin-fg-subtle)" }}>
                {project}
              </p>
            </>
          )}
          {!gitBranch && (
            <p className="font-mono text-[10px]" style={{ marginBottom: "10px", color: "var(--origin-fg-subtle)" }}>
              {project || "No workspace open"}
            </p>
          )}
          <ActionBtn label="+ Set Task" onClick={() => setSettingTask(true)} />
        </>
      );

    case "changed":
      if (!gitData) {
        return (
          <p className="font-mono text-[10px]" style={{ color: "var(--origin-fg-subtle)" }}>
            {gitBranch ? "Loading…" : "No git repository"}
          </p>
        );
      }
      return (
        <>
          <p className="font-mono text-[10px]" style={{ marginBottom: "8px", color: "var(--origin-fg-subtle)" }}>
            {gitData.commits_ahead} commits ahead  ·  {gitData.files} files changed
          </p>
          <div className="flex flex-col" style={{ gap: "6px" }}>
            {gitData.log.length > 0 ? gitData.log.map(e => (
              <div key={e.hash} className="flex items-baseline" style={{ gap: "8px" }}>
                <span className="font-mono text-[9px] shrink-0" style={{ color: "var(--origin-fg-subtle)" }}>{e.hash}</span>
                <span className="font-mono text-[10px] truncate" style={{ color: "var(--origin-fg-muted)" }}>{e.msg}</span>
              </div>
            )) : (
              <p className="font-mono text-[10px]" style={{ color: "var(--origin-fg-subtle)" }}>No commits yet</p>
            )}
          </div>
        </>
      );

    case "memory": {
      if (!memory) {
        return <p className="font-mono text-[10px]" style={{ color: "var(--origin-fg-subtle)" }}>Loading…</p>;
      }
      const pct = ((memory.used_gb / memory.total_gb) * 100).toFixed(1);
      return (
        <>
          <div className="flex items-baseline justify-between" style={{ marginBottom: "6px" }}>
            <span className="font-mono text-[13px] font-medium" style={{ color: "var(--origin-fg-default)" }}>
              {memory.used_gb} GB
            </span>
            <span className="font-mono text-[10px]" style={{ color: "var(--origin-fg-subtle)" }}>of {memory.total_gb} GB</span>
          </div>
          <div
            className="rounded-full overflow-hidden"
            style={{ height: "3px", marginBottom: "4px", backgroundColor: "var(--origin-bg-hover)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: "var(--origin-accent-blue)", transition: "width 0.5s ease" }}
            />
          </div>
          <p className="font-mono text-[10px]" style={{ marginBottom: "2px", color: "var(--origin-fg-subtle)" }}>{pct}% used</p>
        </>
      );
    }

    case "cost": {
      const models = Object.values(usageData).filter(m => m.cost > 0).sort((a, b) => b.cost - a.cost);
      const total  = models.reduce((s, m) => s + m.cost, 0);
      if (models.length === 0) {
        return (
          <p className="font-mono text-[10px]" style={{ color: "var(--origin-fg-subtle)" }}>
            No API spend recorded yet.
          </p>
        );
      }
      const slices = models.map(m => ({ color: modelChartColor(m.modelId), pct: (m.cost / total) * 100 }));
      return (
        <div style={{ display: "flex", gap: "10px" }}>
          {/* Left: pie chart + total */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
            <PieChart slices={slices} size={66} />
            <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--origin-fg-default)" }}>
              {fmtCost(total)}
            </span>
          </div>
          {/* Divider */}
          <div style={{ width: "1px", alignSelf: "stretch", backgroundColor: "var(--origin-border-default)", flexShrink: 0 }} />
          {/* Right: model list + reset */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ overflowY: "auto", maxHeight: "100px" }}>
              {models.map(m => (
                <div key={m.modelId} style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: modelChartColor(m.modelId), flexShrink: 0, marginTop: "1px", alignSelf: "flex-start" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="font-mono text-[10px] truncate" style={{ color: "var(--origin-fg-muted)" }}>
                      {m.modelName}
                    </div>
                    <div className="font-mono text-[9px]" style={{ color: "var(--origin-fg-subtle)" }}>
                      {fmtTokens(m.inputTokens)} in · {fmtTokens(m.outputTokens)} out
                      {(m.cacheReadTokens ?? 0) > 0 && <> · {fmtTokens(m.cacheReadTokens!)} cached</>}
                    </div>
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: "var(--origin-fg-default)", flexShrink: 0, alignSelf: "flex-start" }}>
                    {fmtCost(m.cost)}
                  </span>
                </div>
              ))}
            </div>
            <ActionBtn label="Reset" variant="danger" onClick={onResetUsage} />
          </div>
        </div>
      );
    }

  }
}

// ─── Status Island ────────────────────────────────────────────────────────────

export default function StatusIsland({ gitBranch, dirtyCount: _dirtyCount }: StatusIslandProps) {
  const { folderPath } = useWorkspace();
  const project = folderPath ? (folderPath.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";

  // ── Persistent state ────────────────────────────────────────────────────────
  const [activeIdx, setActiveIdx] = useState(() => {
    const idx = CARDS.indexOf(localStorage.getItem(CARD_KEY) as CardId);
    return idx >= 0 ? idx : 0;
  });
  const [task, setTaskState] = useState<string | null>(
    () => localStorage.getItem(TASK_KEY) || null
  );

  // ── UI state ────────────────────────────────────────────────────────────────
  const [isOpen,    setIsOpen]    = useState(false);
  const [shown,     setShown]     = useState(false);
  const [badges,    setBadges]    = useState<BadgeMap>({});
  const [notifying, setNotifying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Live data ───────────────────────────────────────────────────────────────
  const [gitData,    setGitData]    = useState<GitChanges | null>(null);
  const [memory,     setMemory]     = useState<MemoryInfo | null>(null);
  const [usageData,  setUsageData]  = useState<UsageStore>(() => readUsage());
  const prevGitFiles = useRef<number | null>(null);

  const activeId = CARDS[activeIdx];

  // Persist active card
  useEffect(() => { localStorage.setItem(CARD_KEY, activeId); }, [activeId]);

  // Persist task
  const setTask = (t: string | null) => {
    setTaskState(t);
    if (t) localStorage.setItem(TASK_KEY, t);
    else   localStorage.removeItem(TASK_KEY);
  };

  // Poll git changes whenever folderPath changes
  useEffect(() => {
    if (!folderPath) { setGitData(null); prevGitFiles.current = null; return; }
    getGitChanges(folderPath).then(data => {
      setGitData(data);
      if (data) prevGitFiles.current = data.files;
    });
    const id = setInterval(() => {
      getGitChanges(folderPath).then(data => {
        if (!data) return;
        setGitData(data);
        // Flash island when new changes appear
        if (prevGitFiles.current !== null && data.files > prevGitFiles.current) {
          setBadges(prev => ({ ...prev, changed: (prev.changed ?? 0) + 1 }));
          triggerNotifying();
        }
        prevGitFiles.current = data.files;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [folderPath]);

  // Poll memory every 10 s
  useEffect(() => {
    getMemory().then(setMemory);
    const id = setInterval(() => getMemory().then(setMemory), 10_000);
    return () => clearInterval(id);
  }, []);

  // Poll usage store every 5 s so the card refreshes after each chat
  useEffect(() => {
    const id = setInterval(() => setUsageData(readUsage()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Click-outside + Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const onMouse = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        closeIsland();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeIsland(); };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const triggerNotifying = () => {
    setNotifying(false);
    requestAnimationFrame(() => {
      setNotifying(true);
      setTimeout(() => setNotifying(false), 500);
    });
  };

  const openIsland = () => {
    if (isOpen) return;
    if (badges[activeId]) setBadges(prev => ({ ...prev, [activeId]: 0 }));
    setIsOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };

  const closeIsland = () => {
    if (!isOpen) return;
    setShown(false);
    setTimeout(() => setIsOpen(false), 150);
  };

  const step = (dir: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextIdx = (activeIdx + dir + CARDS.length) % CARDS.length;
    const nextId  = CARDS[nextIdx];
    if (isOpen) {
      setShown(false);
      setTimeout(() => {
        setActiveIdx(nextIdx);
        if (badges[nextId]) setBadges(prev => ({ ...prev, [nextId]: 0 }));
        setShown(true);
      }, 150);
    } else {
      setActiveIdx(nextIdx);
      if (badges[nextId]) setBadges(prev => ({ ...prev, [nextId]: 0 }));
    }
  };

  // ── Computed island styles ──────────────────────────────────────────────────

  const notifyBg     = "var(--origin-fg-default)";
  const notifyBorder = "color-mix(in srgb, var(--origin-bg-base) 12%, transparent)";
  const notifyFg     = "var(--origin-bg-base)";

  const bgColor = notifying ? notifyBg
               : isOpen    ? "var(--origin-island-bg-open)"
               :             "var(--origin-island-bg-closed)";

  const borderColor = notifying ? notifyBorder
                    : isOpen    ? "var(--origin-island-border-open)"
                    :             "var(--origin-island-border-closed)";

  const colorTransDuration = notifying ? "0s" : "0.9s ease";
  const navColor = notifying ? notifyFg : isOpen ? "var(--origin-fg-muted)" : "var(--origin-fg-subtle)";

  const handleResetUsage = () => {
    resetUsage();
    setUsageData({});
  };

  const cardHeight = activeId === 'cost' ? CARD_HEIGHT_COST : CARD_HEIGHT;

  // Shared data props passed to Pill and CardBody
  const dataProps     = { task, gitData, gitBranch, project, memory, usageData };
  const pillDataProps = { ...dataProps };

  return (
    <div
      ref={containerRef}
      onClick={!isOpen ? openIsland : undefined}
      className="relative overflow-hidden"
      style={{
        width:           "380px",
        height:          `${isOpen ? cardHeight : 22}px`,
        borderRadius:    isOpen ? "11px 11px 14px 14px" : "9999px",
        backgroundColor: bgColor,
        border:          `1px solid ${borderColor}`,
        cursor:          isOpen ? "default" : "pointer",
        transition: [
          "height 0.32s cubic-bezier(0.16,1,0.3,1)",
          `border-color ${colorTransDuration}`,
          `background-color ${colorTransDuration}`,
        ].join(", "),
      }}
    >

      {/* ── Pill layer ── */}
      <div
        className="absolute inset-0 flex items-center"
        style={{
          opacity:       isOpen ? 0 : 1,
          transition:    "opacity 0.1s ease",
          pointerEvents: isOpen ? "none" : "auto",
        }}
      >
        <PillContent id={activeId} badges={badges} notifying={notifying} {...pillDataProps} />
      </div>

      {/* ── Card layer ── */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          opacity:       shown ? 1 : 0,
          transition:    "opacity 0.15s ease",
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        <CardHeader id={activeId} />
        <div className="mx-4 shrink-0" style={{ height: "1px", backgroundColor: "var(--origin-border-default)" }} />
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          style={{
            padding:        "10px 16px 16px",
            scrollbarWidth: "thin",
            scrollbarColor: "var(--origin-fg-subtle) transparent",
          } as React.CSSProperties}
        >
          <CardBody
            id={activeId}
            onClearTask={() => setTask(null)}
            onSetTask={name => setTask(name)}
            onResetUsage={handleResetUsage}
            {...dataProps}
          />
        </div>
      </div>

      {/* ── Nav — single, always at right:0 top:0 ── */}
      <div
        className="absolute flex items-center overflow-hidden"
        style={{ right: 0, top: 0, height: "20px", borderRadius: "9999px", zIndex: 5 }}
      >
        <button
          onClick={e => step(-1, e)}
          className="flex items-center justify-center border-none cursor-pointer"
          style={{ width: "26px", height: "20px", background: "none", color: navColor }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <ChevronLeft size={9} strokeWidth={2.5} />
        </button>
        <button
          onClick={e => step(1, e)}
          className="flex items-center justify-center border-none cursor-pointer"
          style={{ width: "26px", height: "20px", background: "none", color: navColor }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <ChevronRight size={9} strokeWidth={2.5} />
        </button>
      </div>

    </div>
  );
}
