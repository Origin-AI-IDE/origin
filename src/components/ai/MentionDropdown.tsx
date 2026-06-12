import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { FileCode, File, Check } from "lucide-react";
import { useWorkspace } from "../../context/WorkspaceContext";

interface WorkspaceFile {
  name: string;
  path: string;
  ext: string;
}

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'cpp', 'c',
  'cs', 'rb', 'php', 'swift', 'kt', 'css', 'scss', 'html', 'vue', 'svelte',
]);

function FileIcon({ ext }: { ext: string }) {
  const Icon = CODE_EXTS.has(ext.toLowerCase()) ? FileCode : File;
  return <Icon size={12} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />;
}

interface Props {
  anchorEl: HTMLElement | null;
  query: string;
  onSelect: (filepath: string, filename: string) => void;
  onClose: () => void;
  keepOpen?: boolean;       // don't close after selection (multi-attach mode)
  attachedPaths?: string[]; // already-attached files get a checkmark
}

export default function MentionDropdown({ anchorEl, query, onSelect, onClose, keepOpen = false, attachedPaths = [] }: Props) {
  const { folderPath } = useWorkspace();
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [search, setSearch] = useState(query);
  const [activeIdx, setActiveIdx] = useState(0);

  // Position above the anchor
  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setPos({ top: r.top - 8, left: r.left, width: r.width });
  }, [anchorEl]);

  // Sync external query into the search box
  useEffect(() => {
    setSearch(query);
    setActiveIdx(0);
  }, [query]);

  // Load workspace files once
  useEffect(() => {
    if (!folderPath) return;
    invoke<WorkspaceFile[]>('list_workspace_files', { folder: folderPath })
      .then(setFiles)
      .catch(() => {});
  }, [folderPath]);

  // Focus search input
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const filtered = search.trim()
    ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;
  const visible = filtered.slice(0, 12);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const f = visible[activeIdx];
      if (f && !attachedPaths.includes(f.path)) {
        onSelect(f.path, f.name);
        if (!keepOpen) onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        bottom: window.innerHeight - pos.top,
        left: pos.left,
        width: Math.max(pos.width, 260),
        background: "color-mix(in srgb, var(--origin-bg-base) 85%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--origin-border-default)",
        borderRadius: "10px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        zIndex: 9999,
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div style={{ padding: "8px 8px 4px", borderBottom: "1px solid var(--origin-border-default)" }}>
        <input
          ref={searchRef}
          value={search}
          onChange={e => { setSearch(e.target.value); setActiveIdx(0); }}
          onKeyDown={handleKey}
          placeholder="Search files…"
          style={{
            width: "100%",
            background: "none",
            border: "none",
            outline: "none",
            fontSize: "12px",
            color: "var(--origin-fg-default)",
            padding: "2px 4px",
          }}
        />
      </div>

      {/* File list */}
      <div style={{ maxHeight: "220px", overflowY: "auto", padding: "4px" }}>
        {visible.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--origin-fg-subtle)", padding: "8px 8px" }}>
            No files found
          </div>
        ) : (
          visible.map((f, i) => {
            const isAttached = attachedPaths.includes(f.path);
            return (
              <button
                key={f.path}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  if (!isAttached) onSelect(f.path, f.name);
                  if (!keepOpen) onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: isAttached ? "default" : "pointer",
                  background: i === activeIdx && !isAttached ? "var(--origin-bg-hover)" : "transparent",
                  textAlign: "left",
                  opacity: isAttached ? 0.5 : 1,
                }}
              >
                <FileIcon ext={f.ext} />
                <span style={{
                  fontSize: "12px",
                  color: "var(--origin-fg-default)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}>
                  {f.name}
                </span>
                {isAttached ? (
                  <Check size={11} style={{ color: "var(--origin-fg-muted)", flexShrink: 0 }} />
                ) : (
                  <span style={{
                    fontSize: "10px",
                    color: "var(--origin-fg-subtle)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100px",
                    flexShrink: 0,
                  }}>
                    {f.path.replace(folderPath ?? '', '').replace(/^[/\\]/, '')}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
