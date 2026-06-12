import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';

export type MenuEntry =
  | { type: 'separator' }
  | {
      type: 'item';
      label: string;
      shortcut?: string;
      disabled?: boolean;
      submenu?: boolean;
      onClick?: () => void;
    };

interface Props {
  entries: MenuEntry[];
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export default function DropdownMenu({ entries, anchorEl, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left });
  }, [anchorEl]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        minWidth: '280px',
        background: 'color-mix(in srgb, var(--origin-bg-base) 50%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid var(--origin-border-default)',
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        padding: '4px',
        zIndex: 9999,
      }}
    >
      {entries.map((entry, i) => {
        if (entry.type === 'separator') {
          return (
            <div
              key={i}
              style={{
                height: '1px',
                background: 'var(--origin-border-default)',
                margin: '3px 4px',
              }}
            />
          );
        }

        const isDisabled = entry.disabled;

        return (
          <button
            key={i}
            disabled={isDisabled}
            onMouseEnter={() => !isDisabled && setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              if (isDisabled) return;
              onClose();
              entry.onClick?.();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 10px',
              borderRadius: '5px',
              border: 'none',
              cursor: isDisabled ? 'default' : 'pointer',
              background: hovered === i ? 'var(--origin-bg-hover)' : 'transparent',
              color: isDisabled ? 'var(--origin-fg-subtle)' : 'var(--origin-fg-default)',
              fontFamily: 'inherit',
              fontSize: '13px',
              textAlign: 'left',
              transition: 'background 0.1s',
              gap: '24px',
            }}
          >
            <span>{entry.label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {entry.shortcut && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: isDisabled ? 'var(--origin-fg-subtle)' : 'var(--origin-fg-muted)',
                }}>
                  {entry.shortcut}
                </span>
              )}
              {entry.submenu && (
                <ChevronRight size={12} style={{ color: 'var(--origin-fg-muted)' }} />
              )}
            </span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
