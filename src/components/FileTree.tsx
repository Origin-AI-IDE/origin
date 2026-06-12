import { useState, useEffect, createContext, useContext } from "react";
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from "lucide-react";
import { readDir, type FsEntry } from "../lib/fs";
import { fileColor } from "../lib/fileColors";
import { useWorkspace } from "../context/WorkspaceContext";

interface Props {
  onFileOpen: (path: string) => void;
}

const FileOpenContext = createContext<(path: string) => void>(() => {});

function TreeNode({ entry, depth }: { entry: FsEntry; depth: number }) {
  const onFileOpen = useContext(FileOpenContext);
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);

  async function handleClick() {
    if (entry.is_dir) {
      if (!loaded) {
        try { setChildren(await readDir(entry.path)); } catch { setChildren([]); }
        setLoaded(true);
      }
      setExpanded(v => !v);
    } else {
      onFileOpen(entry.path);
    }
  }

  const indent = depth * 12 + 6;

  return (
    <>
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: '4px', padding: `3px 8px 3px ${indent}px`,
          border: 'none', background: hovered ? 'var(--origin-bg-hover)' : 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          transition: 'background 0.1s',
        }}
      >
        <span style={{ width: '14px', flexShrink: 0, color: 'var(--origin-fg-muted)', display: 'flex', alignItems: 'center' }}>
          {entry.is_dir ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>

        {entry.is_dir
          ? expanded
            ? <FolderOpen size={14} style={{ flexShrink: 0, color: '#eab308' }} />
            : <Folder size={14} style={{ flexShrink: 0, color: '#eab308' }} />
          : <File size={14} style={{ flexShrink: 0, color: fileColor(entry.name) }} />
        }

        <span style={{
          fontSize: '13px', color: 'var(--origin-fg-default)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          opacity: entry.name.startsWith('.') ? 0.5 : 1,
        }}>
          {entry.name}
        </span>
      </button>

      {entry.is_dir && expanded && children.map(child => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function FileTree({ onFileOpen }: Props) {
  const { folderPath } = useWorkspace();
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([]);
  const rootName = folderPath?.split(/[\\/]/).filter(Boolean).pop() ?? '';

  useEffect(() => {
    if (!folderPath) { setRootEntries([]); return; }
    readDir(folderPath).then(setRootEntries).catch(() => setRootEntries([]));
  }, [folderPath]);

  if (!folderPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs" style={{ color: 'var(--origin-fg-subtle)' }}>No folder open</p>
      </div>
    );
  }

  return (
    <FileOpenContext.Provider value={onFileOpen}>
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div style={{
          padding: '10px 12px 6px',
          fontSize: '11px', fontWeight: 600,
          letterSpacing: '0.8px', textTransform: 'uppercase',
          color: 'var(--origin-fg-muted)',
        }}>
          {rootName}
        </div>
        <div style={{ flex: 1 }}>
          {rootEntries.map(entry => (
            <TreeNode key={entry.path} entry={entry} depth={0} />
          ))}
        </div>
      </div>
    </FileOpenContext.Provider>
  );
}
