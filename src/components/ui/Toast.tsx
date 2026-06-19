/* eslint-disable react-refresh/only-export-components -- exports the useToast hook alongside the provider component */
import { createContext, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ToastType = 'info' | 'success' | 'error';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  text: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastCtx {
  showToast: (text: string, type?: ToastType, action?: ToastAction) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Provider + UI ─────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 3000;

function textColor(type: ToastType): string {
  if (type === 'error')   return 'var(--origin-semantic-error)';
  if (type === 'success') return 'var(--origin-semantic-success)';
  return 'var(--origin-fg-default)';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(text: string, type: ToastType = 'info', action?: ToastAction) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, type, action });
    // Action toasts stay until the user clicks the action or dismisses manually
    if (!action) {
      timer.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    }
  }

  function dismiss() {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: 280,
            maxWidth: 480,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '8px 10px 8px 14px',
            borderRadius: 7,
            backgroundColor: 'var(--origin-bg-base)',
            border: '1px solid var(--origin-border-default)',
            color: textColor(toast.type),
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            whiteSpace: 'normal',
          }}
        >
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => { toast.action!.onClick(); dismiss(); }}
              style={{
                flexShrink: 0, background: 'var(--origin-bg-hover)',
                border: '1px solid var(--origin-border-default)',
                borderRadius: 5, cursor: 'pointer', padding: '3px 10px',
                color: 'var(--origin-fg-default)', fontSize: 11,
                fontFamily: 'var(--font-sans)', fontWeight: 500,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-active)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={dismiss}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, background: 'transparent', border: 'none',
              cursor: 'pointer', padding: 2, borderRadius: '50%',
              color: 'var(--origin-fg-muted)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-muted)'; }}
          >
            <XCircle size={15} />
          </button>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
