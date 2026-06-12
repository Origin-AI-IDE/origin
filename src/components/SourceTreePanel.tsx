import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTheme } from '../themes/ThemeContext';
import { useToast } from './ui/Toast';
import {
  getStatusFiles, getGitLogFull, gitCommit, gitCommitPush,
  type StatusFile, type FullCommitEntry,
} from '../lib/git';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(raw: string): string {
  const s = raw.replace(/\s/g, '');
  if (s === '??' || s === 'U') return 'var(--origin-git-untracked)';
  if (s[0] === 'A') return 'var(--origin-git-added)';
  if (s[0] === 'M' || s[1] === 'M') return 'var(--origin-git-modified)';
  if (s[0] === 'D' || s[1] === 'D') return 'var(--origin-git-deleted)';
  if (s[0] === 'R') return 'var(--origin-accent-blue)';
  return 'var(--origin-fg-muted)';
}

function statusLabel(raw: string): string {
  if (raw === '??') return 'U';
  const s = raw.replace(/\s/g, '');
  return s[0] ?? '?';
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : p;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

// Timeline geometry — all three values must be consistent:
//   padding-left of each row = ROW_PL
//   dot width = DOT_W
//   rail left  = ROW_PL + DOT_W / 2
const ROW_PL  = 10;
const DOT_W   = 8;
const RAIL_L  = ROW_PL + DOT_W / 2; // = 14

export default function SourceTreePanel() {
  const { folderPath } = useWorkspace();
  const { theme } = useTheme();
  const [files, setFiles]       = useState<StatusFile[]>([]);
  const [history, setHistory]   = useState<FullCommitEntry[]>([]);
  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [busy, setBusy]         = useState(false);
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const historyScrollRef        = useRef<HTMLDivElement>(null);
  const [fadeTop, setFadeTop]   = useState(false);
  const [fadeBot, setFadeBot]   = useState(false);

  function updateFades() {
    const el = historyScrollRef.current;
    if (!el) return;
    setFadeTop(el.scrollTop > 2);
    setFadeBot(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }

  useEffect(() => {
    // Recheck fades after history renders into the DOM
    const id = requestAnimationFrame(updateFades);
    return () => cancelAnimationFrame(id);
  }, [history]);

  const load = useCallback(async () => {
    if (!folderPath) return;
    const [f, h] = await Promise.all([
      getStatusFiles(folderPath),
      getGitLogFull(folderPath),
    ]);
    setFiles(f);
    setHistory(h);
    return { files: f, history: h };
  }, [folderPath]);

  useEffect(() => { load(); }, [load]);

  async function refresh() {
    if (!folderPath || refreshing) return;
    setRefreshing(true);
    try {
      const result = await load();
      const f = result?.files ?? [];
      const h = result?.history ?? [];
      showToast(
        `${f.length} change${f.length !== 1 ? 's' : ''} · ${h.length} commit${h.length !== 1 ? 's' : ''}`,
        'info',
      );
    } catch {
      showToast('Failed to refresh.', 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function commit(andPush: boolean) {
    if (!folderPath || !title.trim() || busy) return;
    setBusy(true);
    try {
      if (andPush) {
        await gitCommitPush(folderPath, title.trim(), desc.trim());
      } else {
        await gitCommit(folderPath, title.trim(), desc.trim());
      }
      setTitle('');
      setDesc('');
      showToast(andPush ? 'Committed and pushed.' : 'Committed successfully.', 'success');
      await load();
    } catch (e: unknown) {
      showToast(String(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!folderPath) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <p style={{ fontSize: 12, color: 'var(--origin-fg-subtle)', textAlign: 'center', lineHeight: 1.5 }}>
          Open a folder to use source control
        </p>
      </div>
    );
  }

  const canCommit = title.trim().length > 0 && !busy;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>

      {/* ── Top half: commit form + changes ─────────────────────────────────── */}
      <div style={{ flex: '0 0 50%', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

      {/* ── Commit form ─────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, padding: '10px 8px 8px' }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && commit(false)}
          placeholder="Commit message"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--origin-bg-base)',
            border: '1px solid var(--origin-border-default)',
            borderRadius: 5, padding: '5px 8px', marginBottom: 5,
            fontSize: 12, color: 'var(--origin-fg-default)',
            fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            background: 'var(--origin-bg-base)',
            border: '1px solid var(--origin-border-default)',
            borderRadius: 5, padding: '5px 8px', marginBottom: 7,
            fontSize: 12, color: 'var(--origin-fg-default)',
            fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={() => commit(false)}
            disabled={!canCommit}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 5, border: 'none',
              cursor: canCommit ? 'pointer' : 'not-allowed',
              background: canCommit ? 'var(--origin-bg-active)' : 'var(--origin-bg-hover)',
              color: canCommit ? 'var(--origin-fg-default)' : 'var(--origin-fg-subtle)',
              fontSize: 12, fontFamily: 'var(--font-sans)',
              transition: 'opacity 0.15s',
            }}
          >
            {busy ? '…' : 'Commit'}
          </button>
          <button
            onClick={() => commit(true)}
            disabled={!canCommit}
            style={{
              flex: 1.5, padding: '5px 0', borderRadius: 5, border: 'none',
              cursor: canCommit ? 'pointer' : 'not-allowed',
              background: canCommit ? (theme.type === 'dark' ? '#166534' : '#22c55e') : 'var(--origin-bg-hover)',
              color: canCommit ? '#fff' : 'var(--origin-fg-subtle)',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
              transition: 'opacity 0.15s',
            }}
          >
            {busy ? '…' : 'Commit & Push'}
          </button>
        </div>
      </div>

      {/* ── Changed files ────────────────────────────────────────────────────── */}
      <div style={{
        borderTop: '1px solid var(--origin-border-default)',
        flex: 1, overflowY: 'auto', minHeight: 0,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 8px 4px', position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--origin-bg-sidebar)',
          borderBottom: '1px solid var(--origin-border-default)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--origin-fg-subtle)',
          }}>
            Changes{files.length > 0 ? ` (${files.length})` : ''}
          </span>
          <button
            onClick={refresh}
            title="Refresh"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--origin-fg-subtle)', display: 'flex' }}
          >
            <RefreshCw size={10} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }} />
          </button>
        </div>
        {files.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--origin-fg-subtle)' }}>
              No local changes
            </p>
          </div>
        ) : (
          files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px' }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                color: statusColor(f.status), flexShrink: 0, width: 12, textAlign: 'center',
              }}>
                {statusLabel(f.status)}
              </span>
              <span style={{
                fontSize: 11, color: 'var(--origin-fg-default)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortPath(f.path)}
              </span>
            </div>
          ))
        )}
      </div>
      </div>{/* end top-half */}

      {/* ── Git history timeline ─────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--origin-border-default)', flex: '0 0 50%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Title bar — static, never scrolls */}
        <div style={{
          flexShrink: 0, padding: '5px 8px 4px',
          background: 'var(--origin-bg-sidebar)',
          borderBottom: '1px solid var(--origin-border-default)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--origin-fg-subtle)',
          }}>
            History{history.length > 0 ? ` (${history.length})` : ''}
          </span>
        </div>

        {/* Scrollable content + fades */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {/* Top fade — only when scrolled down */}
          {fadeTop && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 24,
              background: 'linear-gradient(to bottom, var(--origin-bg-sidebar), transparent)',
              pointerEvents: 'none', zIndex: 2,
            }} />
          )}
          {/* Bottom fade — only when more content below */}
          {fadeBot && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 24,
              background: 'linear-gradient(to top, var(--origin-bg-sidebar), transparent)',
              pointerEvents: 'none', zIndex: 2,
            }} />
          )}

          {/* Scroll container */}
          <div ref={historyScrollRef} onScroll={updateFades} style={{ height: '100%', overflowY: 'auto' }}>
            {history.length === 0 ? (
              <p style={{ margin: 0, padding: '5px 10px 8px', fontSize: 11, color: 'var(--origin-fg-subtle)' }}>
                No commits yet
              </p>
            ) : (
              <div style={{ position: 'relative', padding: '4px 0' }}>
                {/* Vertical timeline rail — left = ROW_PL + DOT_W/2 = 14px */}
                <div style={{
                  position: 'absolute', left: RAIL_L, top: 10, bottom: 10, width: 1,
                  background: 'var(--origin-border-default)', pointerEvents: 'none',
                }} />
                {history.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: `5px 8px 5px ${ROW_PL}px`,
                  }}>
                    {/* Timeline dot — center aligns with rail at RAIL_L */}
                    <div style={{
                      flexShrink: 0, width: DOT_W, height: DOT_W,
                      borderRadius: '50%', marginTop: 3,
                      background: 'var(--origin-accent-blue)',
                      outline: '2px solid var(--origin-bg-sidebar)',
                      position: 'relative', zIndex: 1,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, color: 'var(--origin-fg-default)', lineHeight: 1.4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {c.subject}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--origin-fg-subtle)', lineHeight: 1.5, marginTop: 1 }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{c.hash}</span>
                        {' · '}{c.author}{' · '}{c.date}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
