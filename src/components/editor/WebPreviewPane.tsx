import { useState } from 'react';
import { RefreshCw, ExternalLink, ArrowLeft, ArrowRight, Globe, PictureInPicture2, X, Smartphone, Tablet, Monitor } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Tooltip } from '../ui/Tooltip';

const COMMON_PORTS = [
  { port: 5173, label: 'Vite' },
  { port: 3000, label: 'Next / CRA' },
  { port: 4173, label: 'Vite preview' },
  { port: 8080, label: 'Generic' },
];

function normalize(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return `http://localhost:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `http://${trimmed}`;
}

// ── Empty state shown before user picks a URL ──────────────────────────────

function UrlPicker({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [input, setInput] = useState('');

  function go(raw: string) {
    const url = normalize(raw);
    if (url) onNavigate(url);
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '20px',
    }}>
      <Globe size={36} style={{ color: 'var(--origin-fg-muted)', opacity: 0.35 }} />

      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--origin-fg-default)', marginBottom: '4px' }}>
          Live Preview
        </p>
        <p style={{ fontSize: '12px', color: 'var(--origin-fg-muted)' }}>
          Enter a URL or port to preview your dev server
        </p>
      </div>

      {/* URL / port input */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          backgroundColor: 'var(--origin-bg-hover)',
          border: '1px solid var(--origin-border-default)',
          borderRadius: '6px', padding: '6px 10px',
          width: '260px',
        }}>
          <Globe size={12} style={{ color: 'var(--origin-fg-subtle)', flexShrink: 0 }} />
          <input
            autoFocus
            placeholder="localhost:3000 or https://..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') go(input); }}
            spellCheck={false}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: '12px', color: 'var(--origin-fg-default)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
        </div>
        <button
          onClick={() => go(input)}
          style={{
            padding: '0 16px',
            background: 'var(--origin-accent-blue)',
            color: '#fff',
            border: 'none', borderRadius: '6px',
            fontSize: '12px', cursor: 'pointer', fontWeight: 500,
          }}
        >
          Go
        </button>
      </div>

      {/* Common port shortcuts */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {COMMON_PORTS.map(({ port, label }) => (
          <button
            key={port}
            onClick={() => onNavigate(`http://localhost:${port}`)}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--origin-border-default)',
              borderRadius: '5px', cursor: 'pointer',
              fontSize: '11px', color: 'var(--origin-fg-muted)',
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--origin-bg-hover)';
              e.currentTarget.style.color = 'var(--origin-fg-default)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--origin-fg-muted)';
            }}
          >
            :{port}{' '}
            <span style={{ opacity: 0.55 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Nav button helper ──────────────────────────────────────────────────────

const navBtnBaseStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '28px', height: '28px', flexShrink: 0,
  border: 'none', borderRadius: '4px', padding: 0,
  background: 'transparent', cursor: 'pointer',
  color: 'var(--origin-fg-muted)',
  transition: 'background 0.1s, color 0.1s',
};

function NavBtn({
  onClick, title, disabled = false, children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = {
    ...navBtnBaseStyle,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.35 : 1,
  };
  return (
    <Tooltip content={title} side="bottom">
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={style}
        onMouseEnter={e => {
          if (disabled) return;
          e.currentTarget.style.background = 'var(--origin-bg-hover)';
          e.currentTarget.style.color = 'var(--origin-fg-default)';
        }}
        onMouseLeave={e => {
          if (disabled) return;
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--origin-fg-muted)';
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const LS_PREVIEW_URL = 'origin-preview-url';

type PresetKey = 'mobile' | 'tablet' | 'desktop';

const PRESETS: Record<PresetKey, { w: number | null; h: number | null; label: string }> = {
  mobile:  { w: 375,  h: 812,  label: 'Mobile'  },
  tablet:  { w: 768,  h: 1024, label: 'Tablet'  },
  desktop: { w: null, h: null, label: 'Desktop' },
};

function detectPreset(w: number | null, h: number | null): PresetKey | null {
  for (const [key, p] of Object.entries(PRESETS)) {
    if (p.w === w && p.h === h) return key as PresetKey;
  }
  return null;
}

// ── Inline editable dimension value ───────────────────────────────────────

function DimInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) onChange(n);
    else if (draft === '' || draft.toLowerCase() === 'auto') onChange(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        onBlur={commit}
        style={{
          width: `${Math.max(3, draft.length)}ch`,
          background: 'var(--origin-bg-active)',
          border: '1px solid var(--origin-accent-blue)',
          borderRadius: '3px',
          color: 'var(--origin-fg-default)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono, monospace)',
          outline: 'none',
          padding: '1px 3px',
          textAlign: 'center',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setEditing(true); setDraft(value !== null ? String(value) : ''); }}
      style={{
        fontSize: '11px',
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--origin-fg-muted)',
        cursor: 'text',
        minWidth: '28px',
        display: 'inline-block',
        textAlign: 'center',
        padding: '1px 3px',
        borderRadius: '3px',
        transition: 'color 0.1s, background 0.1s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = 'var(--origin-fg-default)';
        e.currentTarget.style.background = 'var(--origin-bg-hover)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--origin-fg-muted)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {value !== null ? value : 'Auto'}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function WebPreviewPane() {
  const savedUrl = localStorage.getItem(LS_PREVIEW_URL);

  // Our own navigation stack. `contentWindow.history` is cross-origin
  // blocked, so we cannot rely on it — we track history ourselves and
  // remount the iframe (via the `key`) to perform back/forward.
  const [history, setHistory] = useState<string[]>(savedUrl ? [savedUrl] : []);
  const [index, setIndex]     = useState(savedUrl ? 0 : -1);
  const [inputUrl, setInputUrl] = useState(savedUrl ?? '');
  const [reloadKey, setReloadKey] = useState(0);
  const [viewW, setViewW] = useState<number | null>(null);
  const [viewH, setViewH] = useState<number | null>(null);

  const activePreset = detectPreset(viewW, viewH);

  const url = index >= 0 ? history[index] : null;
  const canGoBack = index > 0;
  const canGoForward = index < history.length - 1;

  // Push a new entry, truncating any forward history (standard browser behaviour).
  function pushEntry(to: string) {
    setHistory(prev => [...prev.slice(0, index + 1), to]);
    setIndex(index + 1);
    setInputUrl(to);
    localStorage.setItem(LS_PREVIEW_URL, to);
  }

  // Open a fresh URL from the empty-state picker — resets the stack.
  function navigateFresh(to: string) {
    setHistory([to]);
    setIndex(0);
    setInputUrl(to);
    localStorage.setItem(LS_PREVIEW_URL, to);
  }

  function moveTo(nextIndex: number) {
    setIndex(nextIndex);
    const to = history[nextIndex];
    setInputUrl(to);
    localStorage.setItem(LS_PREVIEW_URL, to);
  }

  function handleUrlBarNavigate(raw: string) {
    const next = normalize(raw);
    if (!next) return;
    // Same URL as current → treat Enter as a reload rather than pushing
    // a duplicate history entry.
    if (next === url) {
      setReloadKey(k => k + 1);
      setInputUrl(next);
      return;
    }
    pushEntry(next);
  }

  function handleBack() {
    if (canGoBack) moveTo(index - 1);
  }

  function handleForward() {
    if (canGoForward) moveTo(index + 1);
  }

  function handleReset() {
    setHistory([]);
    setIndex(-1);
    setInputUrl('');
    localStorage.removeItem(LS_PREVIEW_URL);
  }

  function handlePopout() {
    if (!url) return;
    new WebviewWindow(`preview-${Date.now()}`, {
      url,
      title: 'Live Preview',
      width: 1280,
      height: 800,
      decorations: true,
    });
  }

  // No URL yet — show picker
  if (url === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
        backgroundColor: 'var(--origin-bg-editor)' }}>
        <UrlPicker onNavigate={navigateFresh} />
      </div>
    );
  }

  // URL set — show browser bar + iframe
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* URL bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '5px 8px',
        borderBottom: '1px solid var(--origin-border-default)',
        backgroundColor: 'var(--origin-bg-base)',
        flexShrink: 0,
      }}>
        <NavBtn onClick={handleReset} title="Back to URL picker">
          <X size={14} />
        </NavBtn>
        <div style={{ width: 1, height: 16, background: 'var(--origin-border-default)', flexShrink: 0 }} />
        <NavBtn onClick={handleBack} title="Back" disabled={!canGoBack}><ArrowLeft size={14} /></NavBtn>
        <NavBtn onClick={handleForward} title="Forward" disabled={!canGoForward}><ArrowRight size={14} /></NavBtn>
        <NavBtn onClick={() => setReloadKey(k => k + 1)} title="Refresh">
          <RefreshCw size={14} />
        </NavBtn>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', flex: 1,
          backgroundColor: 'var(--origin-bg-hover)',
          border: '1px solid var(--origin-border-default)',
          borderRadius: '6px', padding: '3px 8px',
        }}>
          <Globe size={12} style={{ color: 'var(--origin-fg-subtle)', flexShrink: 0 }} />
          <input
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleUrlBarNavigate(inputUrl);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                setInputUrl(url);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onFocus={e => e.currentTarget.select()}
            onBlur={() => setInputUrl(url)}
            spellCheck={false}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: '12px', color: 'var(--origin-fg-default)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          />
        </div>

        <div style={{ width: 1, height: 16, background: 'var(--origin-border-default)', flexShrink: 0, margin: '0 2px' }} />

        {/* Viewport preset toggles */}
        {([
          { key: 'mobile'  as PresetKey, icon: <Smartphone size={14} /> },
          { key: 'tablet'  as PresetKey, icon: <Tablet size={14} /> },
          { key: 'desktop' as PresetKey, icon: <Monitor size={14} /> },
        ]).map(({ key, icon }) => {
          const active = activePreset === key;
          return (
            <Tooltip key={key} content={PRESETS[key].label} side="bottom">
              <button
                onClick={() => { setViewW(PRESETS[key].w); setViewH(PRESETS[key].h); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '28px', height: '28px', flexShrink: 0,
                  border: 'none', borderRadius: '4px', padding: 0,
                  background: active ? 'var(--origin-bg-active)' : 'transparent',
                  cursor: 'pointer',
                  color: active ? 'var(--origin-fg-default)' : 'var(--origin-fg-muted)',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--origin-bg-hover)';
                    e.currentTarget.style.color = 'var(--origin-fg-default)';
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--origin-fg-muted)';
                  }
                }}
              >
                {icon}
              </button>
            </Tooltip>
          );
        })}

        {/* Editable W × H */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', paddingLeft: '4px' }}>
          <DimInput value={viewW} onChange={setViewW} />
          <span style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)', userSelect: 'none' }}>×</span>
          <DimInput value={viewH} onChange={setViewH} />
        </div>

        <div style={{ width: 1, height: 16, background: 'var(--origin-border-default)', flexShrink: 0, margin: '0 2px' }} />

        <NavBtn onClick={handlePopout} title="Pop out to new window">
          <PictureInPicture2 size={14} />
        </NavBtn>
        <NavBtn onClick={() => openUrl(url)} title="Open in browser">
          <ExternalLink size={14} />
        </NavBtn>
      </div>

      {/* Iframe wrapper */}
      <div style={{
        flex: 1, overflow: 'auto',
        display: 'flex', justifyContent: 'center',
        alignItems: viewH !== null ? 'flex-start' : 'stretch',
        backgroundColor: viewW !== null ? 'var(--origin-bg-base)' : 'transparent',
        padding: viewH !== null ? '16px' : 0,
      }}>
        <iframe
          key={`${url}-${reloadKey}`}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          style={{
            border: viewW !== null ? '1px solid var(--origin-border-default)' : 'none',
            width: viewW !== null ? `${viewW}px` : '100%',
            height: viewH !== null ? `${viewH}px` : '100%',
            display: 'block',
            flexShrink: 0,
            borderRadius: viewW !== null ? '4px' : 0,
          }}
          title="Live Preview"
        />
      </div>
    </div>
  );
}
