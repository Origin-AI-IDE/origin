import { useState } from 'react';
import { ChevronRight, ChevronDown, X } from 'lucide-react';
import { useDebugContext } from '../context/DebugContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { dapRequest } from '../lib/dap';
import type { DapVariable } from '../lib/dap';
import DebugLaunchForm from './DebugLaunchForm';

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        width: '100%', padding: '4px 8px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
        color: 'var(--origin-fg-subtle)',
        textTransform: 'uppercase',
        userSelect: 'none',
        borderTop: '1px solid var(--origin-border-default)',
      }}
    >
      {open
        ? <ChevronDown size={11} style={{ flexShrink: 0 }} />
        : <ChevronRight size={11} style={{ flexShrink: 0 }} />}
      {label}
    </button>
  );
}

// ── VariableTree ───────────────────────────────────────────────────────────────

interface VariableTreeProps {
  variables: DapVariable[];
  sessionId: string;
  depth?: number;
}

function VariableTree({ variables, sessionId, depth = 0 }: VariableTreeProps) {
  const [expanded, setExpanded] = useState<Map<number, DapVariable[]>>(new Map);
  const [loading, setLoading] = useState<Set<number>>(new Set);

  async function toggle(ref: number) {
    if (expanded.has(ref)) {
      setExpanded(prev => { const n = new Map(prev); n.delete(ref); return n; });
      return;
    }
    setLoading(prev => new Set(prev).add(ref));
    try {
      const res = await dapRequest(sessionId, 'variables', { variablesReference: ref });
      const children: DapVariable[] = res?.variables ?? [];
      setExpanded(prev => new Map(prev).set(ref, children));
    } finally {
      setLoading(prev => { const n = new Set(prev); n.delete(ref); return n; });
    }
  }

  return (
    <>
      {variables.map((v, i) => {
        const expandable = v.variablesReference > 0;
        const isOpen = expanded.has(v.variablesReference);
        const isLoading = loading.has(v.variablesReference);
        return (
          <div key={`${v.name}-${i}`}>
            <div
              onClick={() => expandable && toggle(v.variablesReference)}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 4,
                padding: `2px 8px 2px ${8 + depth * 12}px`,
                cursor: expandable ? 'pointer' : 'default',
                fontSize: '11px', lineHeight: '1.5',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ flexShrink: 0, width: 12, color: 'var(--origin-fg-subtle)' }}>
                {expandable && (isLoading ? '…' : isOpen ? '▾' : '▸')}
              </span>
              <span style={{ color: 'var(--origin-syntax-variable)', flexShrink: 0 }}>{v.name}</span>
              <span style={{ color: 'var(--origin-fg-subtle)', flexShrink: 0 }}>:</span>
              <span style={{ color: 'var(--origin-syntax-string)', wordBreak: 'break-all' }}>{v.value}</span>
              {v.type && (
                <span style={{ color: 'var(--origin-fg-subtle)', fontSize: '10px', marginLeft: 'auto', flexShrink: 0 }}>
                  {v.type}
                </span>
              )}
            </div>
            {isOpen && expanded.get(v.variablesReference) && (
              <VariableTree
                variables={expanded.get(v.variablesReference)!}
                sessionId={sessionId}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// ── DebugPanel ─────────────────────────────────────────────────────────────────

interface Props {
  onFileOpenAtLine: (path: string, line: number, col: number) => void;
}

export default function DebugPanel({ onFileOpenAtLine }: Props) {
  const { folderPath } = useWorkspace();
  const { session, toggleBreakpoint } = useDebugContext();
  const { sessionId, status, threads, stackFrames, scopes, breakpoints, outputLines } = session;

  const [callStackOpen, setCallStackOpen] = useState(true);
  const [variablesOpen, setVariablesOpen] = useState(true);
  const [breakpointsOpen, setBreakpointsOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(false);

  if (!folderPath) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)', textAlign: 'center' }}>
          Open a folder to use the debugger.
        </p>
      </div>
    );
  }

  if (status === 'idle' || status === 'terminated') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {status === 'terminated' && (
          <div style={{ padding: '6px 10px', fontSize: '11px', color: 'var(--origin-fg-subtle)', borderBottom: '1px solid var(--origin-border-default)' }}>
            Session ended.
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <DebugLaunchForm />
        </div>
      </div>
    );
  }

  const fileGroups = new Map<string, { line: number; verified: boolean }[]>();
  for (const [fp, entries] of breakpoints) {
    if (entries.length > 0) fileGroups.set(fp, entries);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Call Stack */}
        <SectionHeader label="Call Stack" open={callStackOpen} onToggle={() => setCallStackOpen(v => !v)} />
        {callStackOpen && (
          <div>
            {threads.length === 0 && status !== 'paused' && (
              <p style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)', padding: '6px 12px' }}>Running…</p>
            )}
            {threads.map(thread => (
              <div key={thread.id}>
                <div style={{
                  padding: '3px 8px', fontSize: '11px',
                  color: 'var(--origin-fg-muted)', fontStyle: 'italic',
                }}>
                  Thread #{thread.id} — {thread.name}
                </div>
                {stackFrames.map((frame, idx) => (
                  <div
                    key={frame.id}
                    onClick={() => frame.source?.path && onFileOpenAtLine(frame.source.path, frame.line, frame.column)}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 6,
                      padding: '2px 8px 2px 20px',
                      cursor: frame.source?.path ? 'pointer' : 'default',
                      fontSize: '11px',
                      backgroundColor: idx === 0 ? 'var(--origin-bg-active)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (idx !== 0) (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
                    onMouseLeave={e => { if (idx !== 0) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ color: 'var(--origin-fg-default)', flexShrink: 0 }}>{frame.name}</span>
                    {frame.source?.path && (
                      <span style={{ color: 'var(--origin-fg-subtle)', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {frame.source.path.split(/[\\/]/).pop()}:{frame.line}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Variables */}
        <SectionHeader label="Variables" open={variablesOpen} onToggle={() => setVariablesOpen(v => !v)} />
        {variablesOpen && sessionId && (
          <div>
            {scopes.length === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)', padding: '6px 12px' }}>
                {status === 'paused' ? 'No scopes.' : 'Paused to inspect variables.'}
              </p>
            )}
            {scopes.map(scope => (
              <ScopeSection key={scope.name} scope={scope} sessionId={sessionId} />
            ))}
          </div>
        )}

        {/* Breakpoints */}
        <SectionHeader label="Breakpoints" open={breakpointsOpen} onToggle={() => setBreakpointsOpen(v => !v)} />
        {breakpointsOpen && (
          <div>
            {fileGroups.size === 0 && (
              <p style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)', padding: '6px 12px' }}>
                No breakpoints set. Click the gutter to add one.
              </p>
            )}
            {[...fileGroups.entries()].map(([fp, entries]) => (
              <div key={fp}>
                <div style={{
                  padding: '3px 8px', fontSize: '10px', fontWeight: 600,
                  color: 'var(--origin-fg-subtle)', letterSpacing: '0.04em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={fp}>
                  {fp.split(/[\\/]/).pop()}
                </div>
                {entries.map(entry => (
                  <div
                    key={entry.line}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '2px 8px 2px 16px', fontSize: '11px',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      border: entry.verified ? 'none' : '1.5px solid var(--origin-semantic-error)',
                      backgroundColor: entry.verified ? 'var(--origin-semantic-error)' : 'transparent',
                    }} />
                    <span
                      style={{ flex: 1, cursor: 'pointer', color: 'var(--origin-fg-default)' }}
                      onClick={() => onFileOpenAtLine(fp, entry.line, 1)}
                    >
                      Ln {entry.line}
                    </span>
                    <button
                      onClick={() => toggleBreakpoint(fp, entry.line)}
                      style={{
                        background: 'none', border: 'none', padding: 2,
                        cursor: 'pointer', color: 'var(--origin-fg-subtle)',
                        display: 'flex', alignItems: 'center',
                      }}
                      title="Remove breakpoint"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Output */}
        <SectionHeader label="Output" open={outputOpen} onToggle={() => setOutputOpen(v => !v)} />
        {outputOpen && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.5,
            padding: '4px 8px', maxHeight: 200, overflowY: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {outputLines.length === 0
              ? <span style={{ color: 'var(--origin-fg-subtle)' }}>No output.</span>
              : outputLines.map((l, i) => (
                <div key={i} style={{
                  color: l.category === 'stderr' ? 'var(--origin-semantic-error)'
                    : l.category === 'important' ? 'var(--origin-accent-yellow)'
                    : 'var(--origin-fg-muted)',
                }}>
                  {l.text}
                </div>
              ))
            }
          </div>
        )}

      </div>
    </div>
  );
}

// ── ScopeSection — lazy-loads variables on first render ───────────────────────

function ScopeSection({ scope, sessionId }: { scope: { name: string; variablesReference: number; expensive: boolean }; sessionId: string }) {
  const [open, setOpen] = useState(!scope.expensive);
  const [vars, setVars] = useState<DapVariable[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && vars === null) {
      setLoading(true);
      try {
        const res = await dapRequest(sessionId, 'variables', { variablesReference: scope.variablesReference });
        setVars(res?.variables ?? []);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div>
      <div
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px 3px 12px', cursor: 'pointer', fontSize: '11px',
          color: 'var(--origin-fg-muted)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ fontWeight: 600 }}>{scope.name}</span>
        {loading && <span style={{ color: 'var(--origin-fg-subtle)', marginLeft: 4 }}>…</span>}
      </div>
      {open && vars !== null && (
        <VariableTree variables={vars} sessionId={sessionId} depth={0} />
      )}
    </div>
  );
}
