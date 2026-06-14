import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  danger?: boolean;
}
export interface MenuSeparator { separator: true; }
export type MenuEntry = MenuItem | MenuSeparator;

export default function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MenuEntry[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 212);
  const top  = Math.min(y, window.innerHeight - 280);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed', left, top, zIndex: 9999, width: 200,
        backgroundColor: 'var(--origin-bg-panel)',
        border: '1px solid var(--origin-border-default)',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        padding: '4px 0',
        fontSize: '12px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} style={{ height: 1, margin: '3px 0', backgroundColor: 'var(--origin-border-default)' }} />
        ) : (
          <button
            key={i}
            onClick={() => { onClose(); item.action(); }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--origin-bg-active)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '5px 12px',
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: item.danger ? '#ef4444' : 'var(--origin-fg-default)',
              textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit',
            }}
          >
            {item.icon && (
              <span style={{ display: 'flex', width: 14, flexShrink: 0, opacity: 0.65 }}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
