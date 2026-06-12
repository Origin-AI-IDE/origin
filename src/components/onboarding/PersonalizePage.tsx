import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { THEMES, KEYMAPS, IMPORTS, type ThemeOption, type KeymapOption, type ImportOption } from './data';
import { useTheme } from '../../themes/ThemeContext';

interface Props { onBack: () => void; onComplete: () => void; onSkip: () => void; }

function navBtn(secondary?: boolean): React.CSSProperties {
  return {
    background: secondary ? 'transparent' : 'var(--origin-tooltip-bg)',
    border: secondary ? '1px solid var(--origin-border-default)' : 'none',
    borderRadius: '7px',
    color: secondary ? 'var(--origin-fg-muted)' : 'var(--origin-tooltip-fg)',
    fontSize: '13px', fontWeight: 600, padding: '8px 22px', cursor: 'pointer',
    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px',
    boxShadow: secondary ? 'none' : '0 1px 4px rgba(0,0,0,0.25)', transition: 'opacity 0.15s',
  };
}

function SelectCard({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 0', minWidth: 0,
        background: selected ? 'var(--origin-bg-base)' : 'var(--origin-bg-editor)',
        border: selected ? 'none' : '1px solid var(--origin-border-default)',
        outline: selected ? '2px solid var(--origin-fg-default)' : 'none',
        borderRadius: '10px', padding: '10px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left',
        transition: 'border-color 0.15s, background 0.15s', fontFamily: 'inherit',
        color: selected ? 'var(--origin-fg-default)' : 'var(--origin-fg-muted)',
        fontSize: '13px', fontWeight: selected ? 600 : 400,
      }}
      onMouseEnter={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--origin-fg-muted)';
          (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-base)';
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--origin-border-default)';
          (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-editor)';
        }
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function ThemePreview({ t }: { t: ThemeOption }) {
  return (
    <div style={{ width: '100%', height: '72px', borderRadius: '6px', background: t.previewBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '65%' }}>
        {t.lines.map((l, i) => <div key={i} style={{ height: '5px', borderRadius: '2px', background: l.color, width: l.width }} />)}
      </div>
    </div>
  );
}

function KeymapPreview({ k }: { k: KeymapOption }) {
  return (
    <div style={{ width: '100%', height: '72px', borderRadius: '6px', background: 'var(--origin-bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={k.icon} alt={k.label} style={{ width: '38px', height: '38px', objectFit: 'contain', filter: k.invert ? 'brightness(0) invert(1)' : 'none' }} />
    </div>
  );
}

function ImportPreview({ imp }: { imp: ImportOption }) {
  return (
    <div style={{ width: '100%', height: '72px', borderRadius: '6px', background: imp.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <img src={imp.icon} alt={imp.label} style={imp.wordmark ? { width: '82%', height: 'auto', maxHeight: '28px', objectFit: 'contain' } : { width: imp.size, height: imp.size, objectFit: 'contain', filter: imp.invert ? 'brightness(0) invert(1)' : 'none' }} />
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: '11px', color: 'var(--origin-fg-muted)', textTransform: 'uppercase',
  letterSpacing: '0.9px', fontWeight: 600, marginBottom: '8px',
};

export default function PersonalizePage({ onBack, onComplete, onSkip }: Props) {
  const { setTheme, themes } = useTheme();
  const [selectedTheme,  setSelectedTheme]  = useState<string>('dark');
  const [selectedKeymap, setSelectedKeymap] = useState<string>('vscode');
  const [selectedImport, setSelectedImport] = useState<string | null>(null);

  function handleThemeSelect(id: 'dark' | 'light') {
    setSelectedTheme(id);
    const name = id === 'dark' ? 'Origin Dark' : 'Origin Light';
    const t = themes.find(t => t.name === name);
    if (t) setTheme(t);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 24px 16px' }}>
        <div style={{ width: '100%', maxWidth: '660px', display: 'flex', flexDirection: 'column', gap: '22px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--origin-fg-default)' }}>Personalize</div>
            <div style={{ fontSize: '13px', color: 'var(--origin-fg-muted)', lineHeight: 1.5 }}>Set your theme, keymap, and import your existing settings.</div>
          </div>

          {/* Theme */}
          <div>
            <div style={sectionLabel}>Theme</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {THEMES.map(t => <SelectCard key={t.id} label={t.label} selected={selectedTheme === t.id} onClick={() => handleThemeSelect(t.id as 'dark' | 'light')}><ThemePreview t={t} /></SelectCard>)}
            </div>
          </div>

          {/* Keymap */}
          <div>
            <div style={sectionLabel}>Keymap</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {KEYMAPS.map(k => <SelectCard key={k.id} label={k.label} selected={selectedKeymap === k.id} onClick={() => setSelectedKeymap(k.id)}><KeymapPreview k={k} /></SelectCard>)}
            </div>
          </div>

          {/* Import */}
          <div>
            <div style={sectionLabel}>Import settings from</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {IMPORTS.map(imp => <SelectCard key={imp.id} label={imp.label} selected={selectedImport === imp.id} onClick={() => setSelectedImport(selectedImport === imp.id ? null : imp.id)}><ImportPreview imp={imp} /></SelectCard>)}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              onClick={onSkip}
              style={{ background: 'none', border: 'none', color: 'var(--origin-fg-muted)', fontSize: '12px', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-muted)'; }}
            >
              Skip for now
            </button>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={onBack}
                style={navBtn(true)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--origin-fg-muted)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--origin-border-default)'; }}
              >
                <ArrowLeft size={16} />Back
              </button>
              <button
                onClick={onComplete}
                style={navBtn()}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              >
                Enter Origin<ArrowRight size={16} />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
