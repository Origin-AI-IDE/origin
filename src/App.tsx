import { useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Onboarding from "./components/onboarding/Onboarding";
import EditorEmptyState from "./components/editor/EditorEmptyState";
import TabBar, { type Tab } from "./components/editor/TabBar";
import Editor, { type EditorHandle, type EditorContext } from "./components/editor/Editor";
import AiDiffPane, { type AiDiffTabData } from "./components/editor/AiDiffPane";
import StatusBar from "./components/StatusBar";
import TerminalPanel, { type TerminalPanelHandle } from "./components/terminal/TerminalPanel";
import CommandPalette from "./components/palette/CommandPalette";
import AiPanel from "./components/ai/AiPanel";
import SettingsPanel from "./components/settings/SettingsPanel";
import { getSetting, setSetting, pushRecentProject } from "./lib/settings";
import { readFile, writeFile } from "./lib/fs";
import { getBranch } from "./lib/git";
import { languageLabel } from "./components/editor/languageSupport";
import { useWorkspace } from "./context/WorkspaceContext";

function cache(key: string) {
  return {
    get: () => localStorage.getItem(key),
    set: (v: string) => localStorage.setItem(key, v),
    del: () => localStorage.removeItem(key),
  };
}

const cOnboarding = cache('origin-onboarding');
const cSidebar    = cache('origin-sidebar-open');

function App() {
  const { folderPath, setFolderPath } = useWorkspace();
  const [onboardingDone, setOnboardingDone] = useState(
    () => cOnboarding.get() === 'true'
  );
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const untitledCount = useRef(0);
  const handleSaveRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
  const editorRef = useRef<EditorHandle>(null);
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const [zoom, setZoom] = useState(1.0);
  // Always-current snapshots of editor state. handleApplyCode is invoked from
  // the AI stream's token callback (auto-apply) — at which point App has NOT
  // re-rendered, so reading these from the render closure would see a stale
  // activeTab / fileContents captured before the message was even sent. Reading
  // through refs guarantees the apply sees the live editor state.
  const activeTabRef = useRef<string | null>(activeTab);
  const fileContentsRef = useRef<Record<string, string>>(fileContents);
  activeTabRef.current = activeTab;
  fileContentsRef.current = fileContents;
  const [pinnedContext, setPinnedContext] = useState<EditorContext | null>(null);
  const [cursorPositions, setCursorPositions] = useState<Record<string, { line: number; col: number }>>({});
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => cSidebar.get() !== 'false'
  );
  const [paletteOpen,   setPaletteOpen]   = useState(false);
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [aiPanelOpen,   setAiPanelOpen]   = useState(
    () => localStorage.getItem("origin-ai-panel-open") === "true"
  );

  const [jumpRequest, setJumpRequest] = useState<{ path: string; line: number; col: number; key: number } | null>(null);
  const [fileTreeVersion, setFileTreeVersion] = useState(0);

  const [terminalOpen, setTerminalOpen] = useState(
    () => localStorage.getItem('origin-terminal-open') === 'true'
  );
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const n = parseInt(localStorage.getItem('origin-terminal-height') ?? '', 10);
    return isNaN(n) ? 240 : n;
  });

  // Restore workspace state from persistent store on mount
  useEffect(() => {
    Promise.all([
      getSetting('workspace.folder'),
      getSetting('sidebar.open'),
      getSetting('terminal.open'),
      getSetting('terminal.height'),
    ]).then(([folder, sidebar, termOpen, termHeight]) => {
      const fp = folder || null;
      setFolderPath(fp);

      setSidebarOpen(sidebar);
      cSidebar.set(String(sidebar));

      setTerminalOpen(termOpen);
      localStorage.setItem('origin-terminal-open', String(termOpen));

      if (termHeight > 0) {
        setTerminalHeight(termHeight);
        localStorage.setItem('origin-terminal-height', String(termHeight));
      }
    });
  }, []);

  // Persist folderPath changes to the Tauri store (localStorage handled by context)
  useEffect(() => {
    setSetting('workspace.folder', folderPath ?? '');
  }, [folderPath]);

  // Persist sidebarOpen changes
  useEffect(() => {
    cSidebar.set(String(sidebarOpen));
    setSetting('sidebar.open', sidebarOpen);
  }, [sidebarOpen]);

  // Persist terminal open/height
  useEffect(() => {
    localStorage.setItem('origin-terminal-open', String(terminalOpen));
    setSetting('terminal.open', terminalOpen);
  }, [terminalOpen]);

  useEffect(() => {
    localStorage.setItem('origin-terminal-height', String(terminalHeight));
    setSetting('terminal.height', terminalHeight);
  }, [terminalHeight]);

  useEffect(() => {
    localStorage.setItem("origin-ai-panel-open", String(aiPanelOpen));
  }, [aiPanelOpen]);


  // Read git branch whenever the workspace folder changes
  useEffect(() => {
    if (!folderPath) { setGitBranch(null); return; }
    getBranch(folderPath).then(setGitBranch).catch(() => setGitBranch(null));
  }, [folderPath]);

  // Load file content when switching to a tab that hasn't been loaded yet
  useEffect(() => {
    if (!activeTab || fileContents[activeTab] !== undefined) return;
    if (activeTab.startsWith('__untitled__')) return;
    if (activeTab.startsWith('__diff__')) return; // ai-diff tab — content is in the tab object
    readFile(activeTab)
      .then(content => setFileContents(prev => ({ ...prev, [activeTab]: content })))
      .catch(() => setFileContents(prev => ({ ...prev, [activeTab]: '' })));
  }, [activeTab, fileContents]);

  // Keep handleSaveRef current so the keydown closure never goes stale
  handleSaveRef.current = async function handleSave(path: string) {
    const content = fileContents[path];
    if (content === undefined) return;
    const tab = tabs.find(t => t.path === path);

    if (tab?.isUntitled) {
      const dest = await save({ defaultPath: tab.name });
      if (!dest) return;
      await writeFile(dest, content);
      const newName = dest.split(/[\\/]/).filter(Boolean).pop() ?? dest;
      setTabs(prev => prev.map(t =>
        t.path === path ? { ...t, path: dest, name: newName, isDirty: false, isUntitled: false } : t
      ));
      setActiveTab(dest);
      setFileContents(prev => {
        const next = { ...prev, [dest]: content };
        delete next[path];
        return next;
      });
    } else {
      await writeFile(path, content);
      setTabs(prev => prev.map(t => t.path === path ? { ...t, isDirty: false } : t));
    }
  };

  // Ctrl+S / Cmd+S — calls through ref so it always sees latest state
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && activeTab) {
        e.preventDefault();
        handleSaveRef.current(activeTab);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab]);

  // Notify browser on any native window resize (fullscreen, maximize, etc.)
  // so CodeMirror and xterm FitAddon re-measure themselves.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let raf = 0;

    // The actual viewport fill is handled in CSS via `position: fixed; inset: 0`
    // on html/body/#root, so we no longer set pixel heights here (that math was
    // fragile: Tauri's PhysicalSize / devicePixelRatio doesn't match WebView2's
    // internal CSS-pixel rounding on fractional-DPR Windows displays, and the
    // event doesn't reliably fire on programmatic setFullscreen). All this hook
    // does now is poke child widgets (CodeMirror, xterm FitAddon) to re-measure
    // after the window geometry settles.
    const notify = () => {
      cancelAnimationFrame(raf);
      // Two frames: let WebView2 commit the new layout before widgets measure.
      raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    };

    const win = getCurrentWindow();
    // Tauri's high-level helper.
    win.onResized(notify).then(fn => unlisteners.push(fn));
    // Raw event as a fallback — fires for programmatic fullscreen cases where
    // the helper above can stay quiet on WebView2.
    win.listen('tauri://resize', notify).then(fn => unlisteners.push(fn));

    // visualViewport is the most reliable in-page signal that the CSS viewport
    // actually changed (it updates even when the Tauri events don't).
    window.visualViewport?.addEventListener('resize', notify);

    return () => {
      cancelAnimationFrame(raf);
      window.visualViewport?.removeEventListener('resize', notify);
      unlisteners.forEach(fn => fn());
    };
  }, []);

  // F11 — toggle fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  const handleToggleFullscreen = () => {
    const next = !isFullscreen;
    getCurrentWindow().setFullscreen(next);
    setIsFullscreen(next);
  };
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'F11') {
        e.preventDefault();
        setIsFullscreen(v => {
          const next = !v;
          getCurrentWindow().setFullscreen(next);
          return next;
        });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ctrl+` — toggle terminal panel
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setTerminalOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ctrl+P — command palette
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Ctrl+, — settings
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function completeOnboarding() {
    cOnboarding.set('true');
    setOnboardingDone(true);
    await setSetting('onboarding.done', true);
  }

  async function handleOpenFolder() {
    const result = await open({ directory: true, multiple: false });
    if (!result) return;
    const path = result as string;
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    await pushRecentProject({ path, name });
    setFolderPath(path);
  }

  async function handleOpenFile() {
    const result = await open({ multiple: false });
    if (!result) return;
    openTab(result as string);
  }

  function handleNewFile() {
    untitledCount.current += 1;
    const id = `__untitled__${untitledCount.current}`;
    const name = `Untitled-${untitledCount.current}`;
    setTabs(prev => [...prev, { path: id, name, isDirty: true, isUntitled: true }]);
    setFileContents(prev => ({ ...prev, [id]: '' }));
    setActiveTab(id);
  }

  function openTabAtLine(path: string, line: number, col: number) {
    openTab(path);
    setJumpRequest({ path, line, col, key: Date.now() });
  }

  function openTab(path: string) {
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    setTabs(prev => {
      if (prev.find(t => t.path === path)) return prev;
      return [...prev, { path, name, isDirty: false }];
    });
    setActiveTab(path);
  }

  function handleEditorChange(path: string, value: string) {
    setFileContents(prev => ({ ...prev, [path]: value }));
    setTabs(prev => prev.map(t => t.path === path ? { ...t, isDirty: true } : t));
  }

  function closeTab(path: string) {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.path === path);
      const next = prev.filter(t => t.path !== path);
      if (activeTab === path) {
        const nextActive = next[idx] ?? next[idx - 1] ?? null;
        setActiveTab(nextActive?.path ?? null);
      }
      return next;
    });
  }

  function handleApplyCode(code: string, filePath?: string, _ctx?: EditorContext) {
    const currentActiveTab = activeTabRef.current;
    const currentFileContents = fileContentsRef.current;
    const targetPath = filePath ?? currentActiveTab;
    if (!targetPath) return;

    openTab(targetPath);
    // Show diff inline only when the file is already the active tab
    if (editorRef.current && targetPath === currentActiveTab) {
      editorRef.current.showDiff(code, currentFileContents[targetPath]);
    }
  }

  function openAiDiffTab(data: {
    approvalId: string;
    filePath: string;
    proposedContent: string;
    originalContent: string;
    approve: () => void;
    reject: () => void;
  }) {
    const tabPath = `__diff__${data.approvalId}`;
    const fileName = data.filePath.split(/[\\/]/).filter(Boolean).pop() ?? data.filePath;
    // Wrap approve so file tree refreshes after AI creates/modifies a file
    const approveAndRefresh = () => {
      data.approve();
      setFileTreeVersion(v => v + 1);
    };
    setTabs(prev => {
      if (prev.find(t => t.path === tabPath)) return prev;
      return [...prev, {
        path: tabPath,
        name: `${fileName} (diff)`,
        isDirty: false,
        kind: 'ai-diff' as const,
        filePath: data.filePath,
        originalContent: data.originalContent,
        proposedContent: data.proposedContent,
        approve: approveAndRefresh,
        reject: data.reject,
      }];
    });
    setActiveTab(tabPath);
  }

  function handleNewWindow() {
    new WebviewWindow(`origin-${Date.now()}`, {
      url: '/',
      title: 'Origin IDE',
      width: 1280,
      height: 800,
      decorations: false,
      backgroundColor: '#0a0a0a',
    });
  }

  function handleToggleSidebar() {
    setSidebarOpen(v => !v);
  }

  async function handleSaveAs() {
    if (!activeTab) return;
    const content = fileContents[activeTab];
    if (content === undefined) return;
    const tab = tabs.find(t => t.path === activeTab);
    const dest = await save({ defaultPath: tab?.name });
    if (!dest) return;
    const newName = dest.split(/[\\/]/).filter(Boolean).pop() ?? dest;
    await writeFile(dest, content);
    setTabs(prev => prev.map(t =>
      t.path === activeTab ? { ...t, path: dest, name: newName, isDirty: false, isUntitled: false } : t
    ));
    setActiveTab(dest);
    setFileContents(prev => {
      const next = { ...prev, [dest]: content };
      if (dest !== activeTab) delete next[activeTab];
      return next;
    });
  }

  async function handleSaveAll() {
    const dirty = tabs.filter(t => t.isDirty && !t.isUntitled);
    for (const tab of dirty) {
      await handleSaveRef.current(tab.path);
    }
  }

  function handleCloseFolder() {
    setFolderPath(null);
  }

  function handleZoomIn() {
    setZoom(prev => {
      const next = Math.min(+(prev + 0.1).toFixed(1), 2.0);
      document.documentElement.style.zoom = String(next);
      return next;
    });
  }

  function handleZoomOut() {
    setZoom(prev => {
      const next = Math.max(+(prev - 0.1).toFixed(1), 0.5);
      document.documentElement.style.zoom = String(next);
      return next;
    });
  }

  function handleZoomReset() {
    setZoom(1.0);
    document.documentElement.style.zoom = '1';
  }

  function handleNewTerminalTab() {
    if (!terminalOpen) {
      setTerminalOpen(true);
    } else {
      terminalRef.current?.addTab();
    }
  }

  function handleAbout() {
    window.alert('Origin IDE\nVersion 0.1.0\n\nBuilt with Tauri 2.x + React + CodeMirror 6.');
  }

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ backgroundColor: "var(--origin-bg-base)", color: "var(--origin-fg-default)" }}
    >
      {onboardingDone && (
        <TitleBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen(v => !v)}
          aiPanelOpen={aiPanelOpen}
          onToggleAiPanel={() => setAiPanelOpen(v => !v)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenFolder={handleOpenFolder}
          onOpenFile={handleOpenFile}
          onNewFile={handleNewFile}
          onNewWindow={handleNewWindow}
          gitBranch={gitBranch}
          dirtyCount={tabs.filter(t => t.isDirty).length}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          hasActiveTab={!!activeTab && !activeTab.startsWith('__diff__')}
          hasFolderOpen={!!folderPath}
          onSave={() => activeTab && handleSaveRef.current(activeTab)}
          onSaveAs={handleSaveAs}
          onSaveAll={handleSaveAll}
          onCloseEditor={() => activeTab && closeTab(activeTab)}
          onCloseFolder={handleCloseFolder}
          onEditorUndo={() => editorRef.current?.undo()}
          onEditorRedo={() => editorRef.current?.redo()}
          onEditorCut={() => editorRef.current?.cut()}
          onEditorCopy={() => editorRef.current?.copy()}
          onEditorPaste={() => editorRef.current?.paste()}
          onEditorSelectAll={() => editorRef.current?.selectAll()}
          onEditorFind={() => editorRef.current?.openFind()}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onNewTerminalTab={handleNewTerminalTab}
          onClearTerminal={() => terminalRef.current?.clearActive()}
          onKillTerminal={() => terminalRef.current?.killActive()}
          onAbout={handleAbout}
        />
      )}
      {!onboardingDone ? (
        <Onboarding onComplete={completeOnboarding} />
      ) : (
        <>
          <div className="flex flex-1 overflow-hidden">
            {sidebarOpen && <Sidebar onFileOpen={openTab} onFileOpenAtLine={openTabAtLine} fileTreeKey={fileTreeVersion} />}
            <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <TabBar
                tabs={tabs}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onClose={closeTab}
              />
              <main className="flex-1 flex overflow-hidden" style={{ backgroundColor: "var(--origin-bg-editor)", position: "relative" }}>
                {tabs.length === 0 ? (
                  <EditorEmptyState
                    onFolderOpen={setFolderPath}
                    onFileOpen={handleOpenFile}
                    onNewFile={handleNewFile}
                  />
                ) : activeTab?.startsWith('__diff__') ? (
                  (() => {
                    const diffTab = tabs.find(t => t.path === activeTab) as AiDiffTabData | undefined;
                    if (!diffTab) return null;
                    return (
                      <AiDiffPane
                        tab={diffTab}
                        onClose={() => closeTab(activeTab)}
                      />
                    );
                  })()
                ) : activeTab && fileContents[activeTab] !== undefined ? (
                  <Editor
                    ref={editorRef}
                    path={activeTab}
                    content={fileContents[activeTab]}
                    onChange={v => handleEditorChange(activeTab, v)}
                    onCursorChange={(line, col) =>
                      setCursorPositions(prev => ({ ...prev, [activeTab]: { line, col } }))
                    }
                    initialCursor={cursorPositions[activeTab]}
                    jumpTo={jumpRequest?.path === activeTab ? jumpRequest : undefined}
                    onAddToAiContext={ctx => {
                      setPinnedContext(ctx);
                      setAiPanelOpen(true);
                    }}
                    onAcceptDiff={() => handleSaveRef.current(activeTab)}
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-xs" style={{ color: "var(--origin-fg-subtle)" }}>Loading…</p>
                  </div>
                )}
                {terminalOpen && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 20,
                      background: "linear-gradient(to bottom, transparent, var(--origin-bg-panel))",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  />
                )}
              </main>
              {terminalOpen && (
                <TerminalPanel
                  ref={terminalRef}
                  cwd={folderPath ?? "."}
                  height={terminalHeight}
                  onResize={setTerminalHeight}
                  onClose={() => setTerminalOpen(false)}
                />
              )}
            </div>
            {aiPanelOpen && (
              <AiPanel
                getEditorContext={() => editorRef.current?.getEditorContext() ?? null}
                getActiveFilePath={() => activeTab}
                forcedContext={pinnedContext}
                onForcedContextConsumed={() => setPinnedContext(null)}
                onApplyCode={handleApplyCode}
                getOpenTabPaths={() => tabs.map(t => t.path)}
                onOpenDiffTab={openAiDiffTab}
              />
            )}
            </div>
          </div>
          <StatusBar
            language={languageLabel(activeTab)}
            line={cursorPositions[activeTab ?? '']?.line ?? 1}
            col={cursorPositions[activeTab ?? '']?.col ?? 1}
            branch={gitBranch}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </>
      )}
      {paletteOpen && (
        <CommandPalette
          tabs={tabs}
          onFileOpen={openTab}
          onFileOpenAtLine={(path, line) => { setPaletteOpen(false); openTabAtLine(path, line, 0); }}
          onClose={() => setPaletteOpen(false)}
          onNewFile={() => { setPaletteOpen(false); handleNewFile(); }}
          onOpenFolder={() => { setPaletteOpen(false); handleOpenFolder(); }}
          onOpenFile={() => { setPaletteOpen(false); handleOpenFile(); }}
          onToggleSidebar={() => { setPaletteOpen(false); handleToggleSidebar(); }}
          onToggleTerminal={() => { setPaletteOpen(false); setTerminalOpen(v => !v); }}
          onOpenSettings={() => { setPaletteOpen(false); setSettingsOpen(true); }}
          terminalOpen={terminalOpen}
          sidebarOpen={sidebarOpen}
        />
      )}
      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

export default App;
