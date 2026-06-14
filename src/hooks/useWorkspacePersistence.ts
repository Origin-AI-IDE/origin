import { useState, useEffect } from "react";
import { getSetting, setSetting } from "../lib/settings";
import { useWorkspace } from "../context/WorkspaceContext";

const ls = {
  get: (k: string) => localStorage.getItem(k),
  set: (k: string, v: string) => localStorage.setItem(k, v),
};

export function useWorkspacePersistence() {
  const { setFolderPath } = useWorkspace();

  const [sidebarOpen,    setSidebarOpen]    = useState(() => ls.get('origin-sidebar-open') !== 'false');
  const [aiPanelOpen,    setAiPanelOpen]    = useState(() => ls.get('origin-ai-panel-open') === 'true');
  const [terminalOpen,   setTerminalOpen]   = useState(() => ls.get('origin-terminal-open') === 'true');
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const n = parseInt(ls.get('origin-terminal-height') ?? '', 10);
    return isNaN(n) ? 240 : n;
  });

  // Hydrate from Tauri store on mount (overwrites localStorage defaults if store has values)
  useEffect(() => {
    Promise.all([
      getSetting('workspace.folder'),
      getSetting('sidebar.open'),
      getSetting('terminal.open'),
      getSetting('terminal.height'),
    ]).then(([folder, sidebar, termOpen, termHeight]) => {
      setFolderPath(folder || null);

      setSidebarOpen(sidebar);
      ls.set('origin-sidebar-open', String(sidebar));

      setTerminalOpen(termOpen);
      ls.set('origin-terminal-open', String(termOpen));

      if (termHeight > 0) {
        setTerminalHeight(termHeight);
        ls.set('origin-terminal-height', String(termHeight));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ls.set('origin-sidebar-open', String(sidebarOpen));
    setSetting('sidebar.open', sidebarOpen);
  }, [sidebarOpen]);

  useEffect(() => {
    ls.set('origin-terminal-open', String(terminalOpen));
    setSetting('terminal.open', terminalOpen);
  }, [terminalOpen]);

  useEffect(() => {
    ls.set('origin-terminal-height', String(terminalHeight));
    setSetting('terminal.height', terminalHeight);
  }, [terminalHeight]);

  useEffect(() => {
    ls.set('origin-ai-panel-open', String(aiPanelOpen));
  }, [aiPanelOpen]);

  return {
    sidebarOpen,    setSidebarOpen,
    aiPanelOpen,    setAiPanelOpen,
    terminalOpen,   setTerminalOpen,
    terminalHeight, setTerminalHeight,
  };
}
