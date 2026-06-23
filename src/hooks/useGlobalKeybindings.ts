import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCommandKeyMap, matchesEvent } from "../lib/keybindings";

export interface GlobalHandlers {
  // Always provided
  saveActive:     () => void;
  toggleTerminal: () => void;
  togglePalette:  () => void;
  toggleSettings: () => void;
  // Optional — wired when available in App.tsx
  newFile?:          () => void;
  openFile?:         () => void;
  closeTab?:         () => void;
  toggleSidebar?:    () => void;
  zoomIn?:           () => void;
  zoomOut?:          () => void;
  zoomReset?:        () => void;
  startDebug?:       () => void;
  stopDebug?:        () => void;
  stepOver?:         () => void;
  stepInto?:         () => void;
  stepOut?:          () => void;
  toggleBreakpoint?: () => void;
}

export function useGlobalKeybindings(handlers: GlobalHandlers) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const h = useRef(handlers);
  h.current = handlers;

  const isFullscreenRef = useRef(false);
  const wasMaximizedRef = useRef(false);

  async function toggleFullscreen() {
    const win = getCurrentWindow();
    if (!isFullscreenRef.current) {
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
      // Read the live keymap on every event so custom bindings apply immediately
      // without a page reload (localStorage is synchronous).
      const km = getCommandKeyMap();

      // Build the handler dispatch table — maps command ID → action fn
      const dispatch: Record<string, (() => void) | undefined> = {
        "origin.save":             () => h.current.saveActive(),
        "origin.toggleTerminal":   () => h.current.toggleTerminal(),
        "origin.togglePalette":    () => h.current.togglePalette(),
        "origin.toggleSettings":   () => h.current.toggleSettings(),
        "origin.toggleFullscreen": () => toggleFullscreen(),
        "origin.newFile":          () => h.current.newFile?.(),
        "origin.openFile":         () => h.current.openFile?.(),
        "origin.closeTab":         () => h.current.closeTab?.(),
        "origin.toggleSidebar":    () => h.current.toggleSidebar?.(),
        "origin.zoomIn":           () => h.current.zoomIn?.(),
        "origin.zoomOut":          () => h.current.zoomOut?.(),
        "origin.zoomReset":        () => h.current.zoomReset?.(),
        "origin.startDebug":       () => h.current.startDebug?.(),
        "origin.stopDebug":        () => h.current.stopDebug?.(),
        "origin.stepOver":         () => h.current.stepOver?.(),
        "origin.stepInto":         () => h.current.stepInto?.(),
        "origin.stepOut":          () => h.current.stepOut?.(),
        "origin.toggleBreakpoint": () => h.current.toggleBreakpoint?.(),
      };

      for (const [cmdId, keyStr] of Object.entries(km)) {
        if (!keyStr) continue;
        const handler = dispatch[cmdId];
        if (!handler) continue;
        if (matchesEvent(e, keyStr)) {
          e.preventDefault();
          handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    let unlistenResized: (() => void) | undefined;
    let unlistenScale:   (() => void) | undefined;

    getCurrentWindow().onResized(() => {
      window.dispatchEvent(new Event("resize"));
    }).then(fn => { unlistenResized = fn; });

    getCurrentWindow().onScaleChanged(({ payload: scaleFactor }) => {
      document.documentElement.style.setProperty("--scale-factor", String(scaleFactor));
      window.dispatchEvent(new Event("resize"));
    }).then(fn => { unlistenScale = fn; });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlistenResized?.();
      unlistenScale?.();
    };
  }, []);

  return { isFullscreen, toggleFullscreen };
}
