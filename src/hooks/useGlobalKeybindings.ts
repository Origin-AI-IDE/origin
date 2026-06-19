import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Handlers {
  saveActive:     () => void;
  toggleTerminal: () => void;
  togglePalette:  () => void;
  toggleSettings: () => void;
}

export function useGlobalKeybindings(handlers: Handlers) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Keep handlers ref current so the single listener always sees the latest callbacks
  const h = useRef(handlers);
  // eslint-disable-next-line react-hooks/refs -- stable ref pattern: keep latest handlers visible to the single listener
  h.current = handlers;

  // Refs so the single useEffect closure always reads current values
  const isFullscreenRef = useRef(false);
  const wasMaximizedRef = useRef(false);

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    if (!isFullscreenRef.current) {
      // Unmaximize before entering fullscreen — frameless + WebView2 bug: going
      // fullscreen from a maximized state leaves a black bar (tauri-apps/tauri#11788)
      const maximized = await win.isMaximized();
      wasMaximizedRef.current = maximized;
      if (maximized) {
        await win.unmaximize();
        // Win32 processes window state via the message queue — the promise resolves
        // before the OS has finished the restore, so setFullscreen fires into a
        // mid-transition window and silently fails without this delay.
        await new Promise(r => setTimeout(r, 150));
      }
      await win.setFullscreen(true);
      isFullscreenRef.current = true;
      setIsFullscreen(true);
    } else {
      await win.setFullscreen(false);
      if (wasMaximizedRef.current) await win.maximize();
      isFullscreenRef.current = false;
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 's')               { e.preventDefault(); h.current.saveActive();     return; }
      if (e.key === 'F11')                     { e.preventDefault(); toggleFullscreen();          return; }
      if (ctrl && e.key === '`')               { e.preventDefault(); h.current.toggleTerminal();  return; }
      if (ctrl && !e.shiftKey && e.key === 'p'){ e.preventDefault(); h.current.togglePalette();   return; }
      if (ctrl && e.key === ',')               { e.preventDefault(); h.current.toggleSettings();  return; }
    }
    window.addEventListener('keydown', onKeyDown);

    let unlistenResized: (() => void) | undefined;
    let unlistenScale:   (() => void) | undefined;

    getCurrentWindow().onResized(() => {
      window.dispatchEvent(new Event('resize'));
    }).then(fn => { unlistenResized = fn; });

    getCurrentWindow().onScaleChanged(({ payload: scaleFactor }) => {
      document.documentElement.style.setProperty('--scale-factor', String(scaleFactor));
      window.dispatchEvent(new Event('resize'));
    }).then(fn => { unlistenScale = fn; });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unlistenResized?.();
      unlistenScale?.();
    };
  }, []);

  return { isFullscreen, toggleFullscreen };
}
