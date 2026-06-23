import { useState, useEffect, useRef } from "react";
import { RotateCcw, Search, Download, Check, AlertCircle } from "lucide-react";
import {
  COMMANDS,
  loadKeybindings,
  setKeybinding,
  resetKeybindings,
  getEffectiveKey,
  detectInstalledEditors,
  applyKeybindingsFromEditor,
} from "../../lib/keybindings";
import { useToast } from "../ui/Toast";

// ── Key recorder ─────────────────────────────────────────────────────────────

function formatEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  // Ignore bare modifiers
  if (["control", "shift", "alt", "meta", "os"].includes(k)) return "";
  parts.push(k);
  return parts.join("+");
}

// ── Import row ────────────────────────────────────────────────────────────────

interface ImportEditorRowProps {
  detected: string[];
  onImported: () => void;
}

const EDITOR_LABELS: Record<string, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

function ImportEditorRow({ detected, onImported }: ImportEditorRowProps) {
  const { showToast } = useToast();
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function doImport(id: string) {
    setImporting(id);
    try {
      const count = await applyKeybindingsFromEditor(id);
      setDone(id);
      setTimeout(() => setDone(null), 2000);
      showToast(`Imported ${count} keybinding${count !== 1 ? "s" : ""} from ${EDITOR_LABELS[id]}`, "success");
      onImported();
    } catch (err) {
      showToast(`Could not import from ${EDITOR_LABELS[id]}: ${err}`, "error");
    } finally {
      setImporting(null);
    }
  }

  const candidates = Object.keys(EDITOR_LABELS);

  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {candidates.map(id => {
        const available = detected.includes(id);
        const isImporting = importing === id;
        const isDone = done === id;
        return (
          <button
            key={id}
            onClick={() => available && doImport(id)}
            disabled={!available || isImporting !== false}
            title={available ? `Import keybindings from ${EDITOR_LABELS[id]}` : `${EDITOR_LABELS[id]} not detected`}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "5px 12px",
              borderRadius: "6px",
              border: "1px solid var(--origin-border-default)",
              background: isDone
                ? "color-mix(in srgb, var(--origin-semantic-success) 12%, transparent)"
                : "transparent",
              color: isDone
                ? "var(--origin-semantic-success)"
                : available
                ? "var(--origin-fg-default)"
                : "var(--origin-fg-subtle)",
              fontSize: "12px",
              cursor: available ? "pointer" : "not-allowed",
              opacity: available ? 1 : 0.45,
              transition: "all 0.15s",
              fontFamily: "inherit",
            }}
          >
            {isDone ? <Check size={12} /> : isImporting ? <Download size={12} style={{ opacity: 0.6 }} /> : <Download size={12} />}
            {isImporting ? "Importing…" : EDITOR_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}

// ── Conflict badge ────────────────────────────────────────────────────────────

function conflictFor(commandId: string, key: string): string | null {
  const user = loadKeybindings();
  for (const cmd of COMMANDS) {
    if (cmd.id === commandId) continue;
    const effective = user.find(b => b.command === cmd.id)?.key ?? cmd.defaultKey;
    if (effective.toLowerCase() === key.toLowerCase()) return cmd.label;
  }
  return null;
}

// ── Keybinding row ────────────────────────────────────────────────────────────

interface RowProps {
  commandId: string;
  label: string;
  category: string;
  defaultKey: string;
  onChange: () => void;
}

function KeybindingRow({ commandId, label, defaultKey, onChange }: RowProps) {
  const effectiveKey = getEffectiveKey(commandId) ?? defaultKey;
  const isCustom = loadKeybindings().some(b => b.command === commandId);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); setConflict(null); return; }
      const combo = formatEvent(e);
      if (!combo) return;
      const c = conflictFor(commandId, combo);
      setConflict(c);
      setKeybinding(commandId, combo);
      setRecording(false);
      onChange();
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [recording, commandId, onChange]);

  function resetThis() {
    setKeybinding(commandId, null);
    setConflict(null);
    onChange();
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--origin-border-default)",
        gap: "8px",
      }}
    >
      <span style={{ fontSize: "13px", color: "var(--origin-fg-default)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {conflict && (
          <span title={`Conflicts with: ${conflict}`} style={{ color: "var(--origin-semantic-warning, #f59e0b)", display: "flex" }}>
            <AlertCircle size={12} />
          </span>
        )}
        <button
          ref={btnRef}
          onClick={() => setRecording(r => !r)}
          title={recording ? "Press a key combination (Escape to cancel)" : "Click to rebind"}
          style={{
            padding: "3px 10px",
            borderRadius: "5px",
            border: `1px solid ${recording ? "var(--origin-accent-blue)" : "var(--origin-border-default)"}`,
            background: recording
              ? "color-mix(in srgb, var(--origin-accent-blue) 10%, transparent)"
              : "var(--origin-bg-base)",
            color: recording ? "var(--origin-accent-blue)" : "var(--origin-fg-default)",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            minWidth: "80px",
            textAlign: "center",
            transition: "all 0.12s",
            whiteSpace: "nowrap",
          }}
        >
          {recording ? "Press key…" : effectiveKey}
        </button>
        {isCustom && (
          <button
            onClick={resetThis}
            title="Reset to default"
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "2px",
              color: "var(--origin-fg-subtle)", display: "flex", alignItems: "center",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-muted)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-subtle)"; }}
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main section ─────────────────────────────────────────────────────────────

export default function KeybindingsSection() {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [detected, setDetected] = useState<string[]>([]);
  const [tick, setTick] = useState(0); // bump to re-render after changes

  useEffect(() => {
    detectInstalledEditors().then(setDetected).catch(() => setDetected([]));
  }, []);

  function refresh() { setTick(t => t + 1); }

  const userCount = loadKeybindings().length;

  const filtered = COMMANDS.filter(cmd => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q) ||
      (getEffectiveKey(cmd.id) ?? "").includes(q)
    );
  });

  // Group by category
  const categories = [...new Set(filtered.map(c => c.category))];

  function handleResetAll() {
    resetKeybindings();
    refresh();
    showToast("All keybindings reset to defaults", "info");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} key={tick}>

      {/* Import row */}
      <div>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--origin-fg-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>
          Import from
        </div>
        {detected.length === 0 ? (
          <p style={{ fontSize: "12px", color: "var(--origin-fg-subtle)", margin: 0 }}>
            No VS Code, Cursor, or Windsurf installation detected on this machine.
          </p>
        ) : (
          <ImportEditorRow detected={detected} onImported={refresh} />
        )}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--origin-border-default)" }} />

      {/* Search + reset */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={12} style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", color: "var(--origin-fg-subtle)", pointerEvents: "none" }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search commands or keys…"
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "6px 10px 6px 28px",
              borderRadius: "6px",
              border: "1px solid var(--origin-border-default)",
              background: "var(--origin-bg-base)",
              color: "var(--origin-fg-default)",
              fontSize: "12px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>
        {userCount > 0 && (
          <button
            onClick={handleResetAll}
            title="Reset all keybindings to defaults"
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "5px 10px", borderRadius: "6px", fontSize: "12px",
              border: "1px solid var(--origin-border-default)",
              background: "transparent",
              color: "var(--origin-fg-muted)",
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            <RotateCcw size={12} /> Reset all
          </button>
        )}
      </div>

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: "0 0 4px", borderBottom: "1px solid var(--origin-border-default)" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Command</span>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Keybinding</span>
      </div>

      {/* Command list grouped by category */}
      {categories.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--origin-fg-subtle)", margin: 0 }}>No commands match "{query}".</p>
      ) : (
        categories.map(cat => (
          <div key={cat}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.07em", padding: "4px 0 2px" }}>
              {cat}
            </div>
            {filtered.filter(c => c.category === cat).map(cmd => (
              <KeybindingRow
                key={cmd.id}
                commandId={cmd.id}
                label={cmd.label}
                category={cmd.category}
                defaultKey={cmd.defaultKey}
                onChange={refresh}
              />
            ))}
          </div>
        ))
      )}

      <div style={{ fontSize: "11px", color: "var(--origin-fg-subtle)", marginTop: "4px" }}>
        {userCount > 0 ? `${userCount} custom binding${userCount !== 1 ? "s" : ""}` : "Using all defaults"}
        {" · "}Click a keybinding to rebind · Esc to cancel
      </div>
    </div>
  );
}
