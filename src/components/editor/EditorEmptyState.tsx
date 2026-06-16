import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FileText, FilePlus, ChevronDown } from 'lucide-react';
import { useTheme } from '../../themes/ThemeContext';
import { getSetting, pushRecentProject, type RecentProject } from '../../lib/settings';
import wordmarkWhite from '../../assets/origin_wordmark_white_color.svg';
import wordmarkBlack from '../../assets/origin_wordmark_black_color.svg';

interface Props {
  onFolderOpen: (path: string) => void;
  onFileOpen: (path: string) => void;
  onNewFile: () => void;
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '9px 20px', borderRadius: '8px', cursor: 'pointer',
        border: '1px solid var(--origin-border-default)',
        background: hovered ? 'var(--origin-bg-base)' : 'transparent',
        color: hovered ? 'var(--origin-fg-default)' : 'var(--origin-fg-muted)',
        fontSize: '13px', fontWeight: 500, fontFamily: 'inherit',
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
        borderColor: hovered ? 'var(--origin-border-subtle)' : 'var(--origin-border-default)',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

const INITIAL_LIMIT = 5;
const ITEM_HEIGHT = 34; // px per item including gap

export default function EditorEmptyState({ onFolderOpen, onFileOpen, onNewFile }: Props) {
  const { theme } = useTheme();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showMoreHovered, setShowMoreHovered] = useState(false);

  useEffect(() => {
    getSetting('recent.projects').then(projects => {
      setRecents(projects);
      setExpanded(false);
    });
  }, []);

  async function handleOpenFolder() {
    const result = await open({ directory: true, multiple: false });
    if (!result) return;
    const path = result as string;
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    await pushRecentProject({ path, name });
    setRecents(prev => [{ path, name }, ...prev.filter(p => p.path !== path)].slice(0, 10));
    onFolderOpen(path);
  }

  async function handleOpenFile() {
    const result = await open({ multiple: false });
    if (!result) return;
    onFileOpen(result as string);
  }

  async function handleRecentClick(project: RecentProject) {
    await pushRecentProject(project);
    setRecents(prev => [project, ...prev.filter(p => p.path !== project.path)].slice(0, 10));
    onFolderOpen(project.path);
  }

  function truncatePath(path: string, max = 42): string {
    if (path.length <= max) return path;
    return '…' + path.slice(-(max - 1));
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px', width: '100%', maxWidth: '460px', padding: '0 24px' }}>

        {/* Logo */}
        <img
          src={theme.type === 'dark' ? wordmarkWhite : wordmarkBlack}
          alt="Origin"
          style={{ height: '32px' }}
        />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <ActionButton icon={<FolderOpen size={15} />} label="Open Folder" onClick={handleOpenFolder} />
          <ActionButton icon={<FileText size={15} />} label="Open File" onClick={handleOpenFile} />
          <ActionButton icon={<FilePlus size={15} />} label="New File" onClick={onNewFile} />
        </div>

        {/* Recent projects */}
        <div style={{ width: '100%' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--origin-fg-muted)', marginBottom: '8px' }}>
            Recent Projects
          </div>
          {recents.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--origin-fg-subtle)', padding: '6px 0' }}>
              No recent projects
            </div>
          ) : (
            <>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '2px',
                ...(expanded ? {
                  maxHeight: `${INITIAL_LIMIT * ITEM_HEIGHT}px`,
                  overflowY: 'auto',
                } : {}),
              }}>
                {(expanded ? recents : recents.slice(0, INITIAL_LIMIT)).map(p => (
                  <button
                    key={p.path}
                    onClick={() => handleRecentClick(p)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '16px', padding: '6px 8px', borderRadius: '6px', border: 'none',
                      background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                      width: '100%', textAlign: 'left', transition: 'background 0.12s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-base)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--origin-fg-default)', flexShrink: 0 }}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--origin-fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'right' }}>
                      {truncatePath(p.path)}
                    </span>
                  </button>
                ))}
              </div>

              {!expanded && recents.length > INITIAL_LIMIT && (
                <button
                  onClick={() => setExpanded(true)}
                  onMouseEnter={() => setShowMoreHovered(true)}
                  onMouseLeave={() => setShowMoreHovered(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    width: '100%', marginTop: '6px', padding: '4px 0',
                    background: 'none', border: 'none', cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, height: '1px', background: 'var(--origin-border-default)' }} />
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${showMoreHovered ? 'var(--origin-fg-muted)' : 'var(--origin-border-default)'}`,
                    color: showMoreHovered ? 'var(--origin-fg-default)' : 'var(--origin-fg-muted)',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}>
                    <ChevronDown size={11} strokeWidth={2.5} />
                  </div>
                  <div style={{ flex: 1, height: '1px', background: 'var(--origin-border-default)' }} />
                </button>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
