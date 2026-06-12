import { useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import WelcomePage from './WelcomePage';
import ConnectAIPage from './ConnectAIPage';
import PersonalizePage from './PersonalizePage';

interface Props { onComplete: () => void; }

const win = getCurrentWindow();

const winBtn: React.CSSProperties = {
  width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '6px',
  color: 'var(--origin-fg-muted)', transition: 'background 0.15s, color 0.15s',
};

export default function Onboarding({ onComplete }: Props) {
  const [page, setPage] = useState(0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--origin-bg-editor)', position: 'relative' }}>

      {/* Window controls */}
      <div style={{ position: 'absolute', top: '10px', right: '8px', display: 'flex', alignItems: 'center', gap: '2px', zIndex: 50 }}>
        <button
          style={winBtn}
          onClick={() => win.minimize()}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-base)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <Minus size={13} />
        </button>
        <button
          style={winBtn}
          onClick={() => win.toggleMaximize()}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-base)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <Square size={11} />
        </button>
        <button
          style={winBtn}
          onClick={() => win.close()}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#c0392b'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-muted)'; }}
        >
          <X size={13} />
        </button>
      </div>

      {page === 0 && <WelcomePage onStart={() => setPage(1)} onSkip={onComplete} />}
      {page === 1 && <ConnectAIPage onBack={() => setPage(0)} onNext={() => setPage(2)} onSkip={onComplete} />}
      {page === 2 && <PersonalizePage onBack={() => setPage(1)} onComplete={onComplete} onSkip={onComplete} />}
    </div>
  );
}
