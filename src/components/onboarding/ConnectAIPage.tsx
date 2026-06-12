import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowLeft, Eye, EyeOff, ChevronDown, Check } from 'lucide-react';
import { PROVIDERS, CDN, type Provider } from './data';

interface Props { onBack: () => void; onNext: () => void; onSkip: () => void; }

const input: React.CSSProperties = { background: '#141414', border: '1px solid #282828', borderRadius: '7px', color: 'var(--origin-fg-default)', fontSize: '13px', padding: '9px 12px', width: '100%', outline: 'none', fontFamily: 'inherit' };
const fieldLabel: React.CSSProperties = { fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.9px', fontWeight: 600 };

function navBtn(secondary?: boolean): React.CSSProperties {
  return { background: secondary ? 'transparent' : 'var(--origin-tooltip-bg)', border: secondary ? '1px solid #1e1e1e' : 'none', borderRadius: '7px', color: secondary ? '#555' : 'var(--origin-tooltip-fg)', fontSize: '13px', fontWeight: 600, padding: '8px 22px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: secondary ? 'none' : '0 1px 4px rgba(0,0,0,0.25)', transition: 'opacity 0.15s' };
}

interface SelectProps {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  extraOption?: string;
}

function ModelSelect({ options, value, onChange, extraOption }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });

  const allOptions = extraOption ? [...options, extraOption] : options;

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });

    function onDown(e: MouseEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        style={{
          ...input,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', textAlign: 'left',
          border: open ? '1px solid #444' : '1px solid #282828',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {value || allOptions[0]}
        </span>
        <ChevronDown
          size={14}
          style={{ flexShrink: 0, marginLeft: '8px', color: '#555', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            background: '#1a1a1a',
            border: '1px solid #2e2e2e',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 9999,
            padding: '4px',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {allOptions.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              onMouseEnter={() => setHovered(opt)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer',
                background: hovered === opt ? '#262626' : 'transparent',
                color: value === opt ? 'var(--origin-fg-default)' : '#aaa',
                fontSize: '13px', fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.1s',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              {value === opt && <Check size={13} style={{ flexShrink: 0, marginLeft: '8px', color: 'var(--origin-fg-default)' }} />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function ProviderCard({ p, selected, onClick }: { p: Provider; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '16px 8px 14px', width: '90px', flexShrink: 0, background: selected ? '#161616' : '#111111', border: `1px solid ${selected ? '#ffffff' : '#1e1e1e'}`, borderRadius: '10px', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s, background 0.15s', fontFamily: 'inherit' }}
      onMouseEnter={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = '#333'; (e.currentTarget as HTMLElement).style.background = '#161616'; } }}
      onMouseLeave={e => { if (!selected) { (e.currentTarget as HTMLElement).style.borderColor = '#1e1e1e'; (e.currentTarget as HTMLElement).style.background = '#111111'; } }}
    >
      <div style={{ width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {p.icon
          ? <img src={CDN + p.icon} alt={p.label} style={{ width: '32px', height: '32px', objectFit: 'contain', filter: p.invert ? 'brightness(0) invert(1)' : 'none' }} />
          : <div style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222', borderRadius: '7px', fontSize: '13px', fontWeight: 700, color: '#888' }}>{p.label.slice(0, 2)}</div>
        }
      </div>
      <span style={{ fontSize: '11px', fontWeight: 500, color: selected ? 'var(--origin-fg-default)' : '#888', lineHeight: 1.2 }}>{p.label}</span>
    </button>
  );
}

function Skeleton() {
  const sk: React.CSSProperties = { background: 'linear-gradient(90deg, #181818 25%, #222 50%, #181818 75%)', backgroundSize: '400% 100%', animation: 'shimmer 2s infinite linear', borderRadius: '5px' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {[0, 1].map(i => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ ...sk, height: '9px', width: '52px' }} />
          <div style={{ ...sk, height: '36px', width: '100%', borderRadius: '7px' }} />
          {i === 0 && <div style={{ ...sk, height: '8px', width: '80px' }} />}
        </div>
      ))}
    </div>
  );
}

export default function ConnectAIPage({ onBack, onNext, onSkip }: Props) {
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState<Provider | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [showKey, setShowKey]       = useState(false);
  const [canScrollLeft, setCanScrollLeft]   = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = search ? PROVIDERS.filter(p => p.label.toLowerCase().includes(search.toLowerCase())) : PROVIDERS;

  useEffect(() => {
    if (selected) setSelectedModel(selected.models[0] ?? '');
  }, [selected]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => { setCanScrollLeft(el.scrollLeft > 2); setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2); };
    update();
    el.addEventListener('scroll', update);
    return () => el.removeEventListener('scroll', update);
  }, [filtered]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px 24px' }}>
        <div style={{ width: '100%', maxWidth: '580px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--origin-fg-default)' }}>Let's connect a provider</div>
            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>Pick one below and you're ready to go.</div>
          </div>

          {/* Search */}
          <input type="text" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} style={input} />

          {/* Provider grid */}
          <div style={{ position: 'relative' }}>
            {canScrollLeft  && <div style={{ position: 'absolute', left:  0, top: 0, bottom: 0, width: '60px', pointerEvents: 'none', zIndex: 2, background: 'linear-gradient(to right, #0a0a0a, transparent)' }} />}
            {canScrollRight && <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '60px', pointerEvents: 'none', zIndex: 2, background: 'linear-gradient(to left, #0a0a0a, transparent)' }} />}
            <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap' }}>
                {filtered.length === 0
                  ? <div style={{ color: '#888', fontSize: '13px', padding: '12px 4px', whiteSpace: 'nowrap' }}>No provider found.</div>
                  : filtered.map(p => <ProviderCard key={p.id} p={p} selected={selected?.id === p.id} onClick={() => { setSelected(p); setShowKey(false); }} />)
                }
              </div>
            </div>
          </div>

          {/* Form */}
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '24px' }}>
            {!selected ? <Skeleton /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Key / URL */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={fieldLabel}>{selected.keyLabel}</div>
                  <div style={{ position: 'relative' }}>
                    <input type={showKey || selected.group === 'local' ? 'text' : 'password'} placeholder={selected.keyPlaceholder} style={{ ...input, paddingRight: selected.group !== 'local' ? '36px' : '12px' }} />
                    {selected.group !== 'local' && (
                      <button onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>
                  {selected.docs && <a href={selected.docs} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#888', textDecoration: 'none' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888'; }}>Get API key ↗</a>}
                </div>
                {/* Model */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={fieldLabel}>Model</div>
                  {selected.models.length > 0
                    ? <ModelSelect
                        options={selected.models}
                        value={selectedModel}
                        onChange={setSelectedModel}
                        extraOption={selected.customModels ? 'Custom model…' : undefined}
                      />
                    : <input type="text" placeholder={selected.group === 'local' ? 'llama3.2, mistral, gemma3…' : 'Model name'} style={input} />
                  }
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 40px', maxWidth: '580px', width: '100%', alignSelf: 'center' }}>
        <button onClick={onSkip} style={{ background: 'none', border: 'none', color: '#555', fontSize: '12px', cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#888'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555'; }}>Skip for now</button>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onBack} style={navBtn(true)} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; (e.currentTarget as HTMLElement).style.borderColor = '#555'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555'; (e.currentTarget as HTMLElement).style.borderColor = '#1e1e1e'; }}><ArrowLeft size={16} />Back</button>
          <button onClick={onNext} style={navBtn()} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>Next<ArrowRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
