import { Play, Pause, Square, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { DapSessionStatus } from '../lib/dap';

interface Props {
  status: DapSessionStatus;
  onContinue: () => void;
  onStepOver: () => void;
  onStepIn: () => void;
  onStepOut: () => void;
  onPause: () => void;
  onStop: () => void;
}

function ToolBtn({
  onClick, disabled, title, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 5,
        background: 'none', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? 'var(--origin-fg-subtle)' : 'var(--origin-fg-default)',
        transition: 'background 0.1s',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-active)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'none';
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <div style={{
      width: 1, height: 14, margin: '0 2px',
      backgroundColor: 'var(--origin-border-default)',
      flexShrink: 0,
    }} />
  );
}

export default function DebugToolbar({ status, onContinue, onStepOver, onStepIn, onStepOut, onPause, onStop }: Props) {
  const paused  = status === 'paused';
  const running = status === 'running' || status === 'starting' || status === 'configuring';

  return (
    <div
      style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '3px 6px',
        backgroundColor: 'var(--origin-bg-base)',
        border: '1px solid var(--origin-border-default)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        userSelect: 'none',
      }}
    >
      <ToolBtn onClick={onContinue} disabled={running} title="Continue (F5)">
        <Play size={13} />
      </ToolBtn>

      <Divider />

      <ToolBtn onClick={onStepOver} disabled={running} title="Step Over (F10)">
        <ChevronRight size={14} />
      </ToolBtn>
      <ToolBtn onClick={onStepIn} disabled={running} title="Step Into (F11)">
        <ChevronDown size={14} />
      </ToolBtn>
      <ToolBtn onClick={onStepOut} disabled={running} title="Step Out (Shift+F11)">
        <ChevronUp size={14} />
      </ToolBtn>

      <Divider />

      <ToolBtn onClick={onPause} disabled={paused} title="Pause">
        <Pause size={13} />
      </ToolBtn>
      <ToolBtn onClick={onStop} title="Stop (Shift+F5)">
        <Square size={11} style={{ color: 'var(--origin-semantic-error)' }} />
      </ToolBtn>
    </div>
  );
}
