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
  h.current = handlers;

  function toggleFullscreen() {
    setIsFullscreen(v => {
      const next = !v;
      getCurrentWindow().setFullscreen(next);
      return next;
    });
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
