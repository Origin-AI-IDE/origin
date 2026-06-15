import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Onboarding from "./components/onboarding/Onboarding";
import EditorEmptyState from "./components/editor/EditorEmptyState";
import TabBar from "./components/editor/TabBar";
import Editor, { type EditorHandle, type EditorContext } from "./components/editor/Editor";
import AiDiffPane, { type AiDiffTabData } from "./components/editor/AiDiffPane";
import StatusBar from "./components/StatusBar";
import TerminalPanel, { type TerminalPanelHandle } from "./components/terminal/TerminalPanel";
import CommandPalette from "./components/palette/CommandPalette";
import AiPanel from "./components/ai/AiPanel";
import SettingsPanel from "./components/settings/SettingsPanel";
import { setSetting, pushRecentProject } from "./lib/settings";
import { useToast } from "./components/ui/Toast";
import { getBranch } from "./lib/git";
import { languageLabel } from "./components/editor/languageSupport";
import { useWorkspace } from "./context/WorkspaceContext";
import { CommandContext } from "./context/CommandContext";
import { useTabs } from "./hooks/useTabs";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import { useGlobalKeybindings } from "./hooks/useGlobalKeybindings";

function App() {
  const { folderPath, setFolderPath } = useWorkspace();
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem('origin-onboarding') === 'true'
  );

  const {
    tabs, setTabs: _setTabs,
    activeTab, setActiveTab,
    fileContents,
    fileErrors,
    jumpRequest,
    fileTreeVersion,
    activeTabRef,
    fileContentsRef,
    openTab, openTabAtLine, closeTab,
    handleNewFile, handleEditorChange, openAiDiffTab,
    handleSave, handleSaveAs, handleSaveAll,
  } = useTabs();

  const {
    sidebarOpen, setSidebarOpen,
    aiPanelOpen, setAiPanelOpen,
    terminalOpen, setTerminalOpen,
    terminalHeight, setTerminalHeight,
  } = useWorkspacePersistence();

  const { showToast } = useToast();
  const editorRef      = useRef<EditorHandle>(null);
  const terminalRef    = useRef<TerminalPanelHandle>(null);
  const pendingDiffRef = useRef<{ code: string; targetPath: string } | null>(null);
  const [pendingDiffTick, setPendingDiffTick] = useState(0);
  const [_zoom,          setZoom]          = useState(1.0);
  const [pinnedContext,  setPinnedContext]  = useState<EditorContext | null>(null);
  const [cursorPositions, setCursorPositions] = useState<Record<string, { line: number; col: number }>>({});
  const [gitBranch,      setGitBranch]     = useState<string | null>(null);
  const [paletteOpen,    setPaletteOpen]   = useState(false);
  const [settingsOpen,   setSettingsOpen]  = useState(false);
  const [aboutOpen,      setAboutOpen]     = useState(false);

  // Persist folderPath to Tauri store (WorkspaceContext handles localStorage)
  useEffect(() => { setSetting('workspace.folder', folderPath ?? ''); }, [folderPath]);

  // Refresh git branch on folder change
  useEffect(() => {
    if (!folderPath) { setGitBranch(null); return; }
    getBranch(folderPath).then(setGitBranch).catch(() => setGitBranch(null));
  }, [folderPath]);

  // Poke CodeMirror + xterm to re-measure after window geometry changes
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let raf = 0;
    const notify = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      });
    };
    const win = getCurrentWindow();
    win.onResized(notify).then(fn => unlisteners.push(fn));
    win.listen('tauri://resize', notify).then(fn => unlisteners.push(fn));
    window.visualViewport?.addEventListener('resize', notify);
    return () => {
      cancelAnimationFrame(raf);
      window.visualViewport?.removeEventListener('resize', notify);
      unlisteners.forEach(fn => fn());
    };
  }, []);

  // Apply a queued diff once the target tab is active and its content is loaded.
  // pendingDiffTick is incremented whenever a new pending diff is enqueued so the
  // effect fires even when activeTab and fileContents haven't changed (already-active
  // tab edge case where editorRef.current was transiently null at enqueue time).
  useEffect(() => {
    const pending = pendingDiffRef.current;
    if (!pending) return;
    if (activeTab !== pending.targetPath) return;
    if (fileContents[pending.targetPath] === undefined) return;
    if (!editorRef.current) return;
    pendingDiffRef.current = null;
    editorRef.current.showDiff(pending.code, fileContents[pending.targetPath]);
  }, [activeTab, fileContents, pendingDiffTick]);

  const { isFullscreen, toggleFullscreen } = useGlobalKeybindings({
    saveActive:     () => { if (activeTab) handleSave(activeTab); },
    toggleTerminal: () => setTerminalOpen(v => !v),
    togglePalette:  () => setPaletteOpen(v => !v),
    toggleSettings: () => setSettingsOpen(v => !v),
  });

  async function completeOnboarding() {
    localStorage.setItem('origin-onboarding', 'true');
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

  function handleApplyCode(code: string, filePath?: string, _ctx?: EditorContext) {
    const currentActiveTab    = activeTabRef.current;
    const currentFileContents = fileContentsRef.current;
    const targetPath = filePath ?? currentActiveTab;
    if (!targetPath) return;

    if (
      targetPath === currentActiveTab &&
      editorRef.current &&
      currentFileContents[targetPath] !== undefined
    ) {
      editorRef.current.showDiff(code, currentFileContents[targetPath]);
    } else {
      pendingDiffRef.current = { code, targetPath };
      openTab(targetPath);
      setPendingDiffTick(v => v + 1);
    }
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
    if (!terminalOpen) setTerminalOpen(true);
    else terminalRef.current?.addTab();
  }

  function handleMissingServer(language: string, installCmd: string) {
    const names: Record<string, string> = { typescript: 'TypeScript', rust: 'Rust', python: 'Python' };
    const langName = names[language] ?? language;
    // Open terminal now so TerminalPanel is mounted by the time the user clicks Install
    setTerminalOpen(true);
    showToast(
      `${langName} language server not found`,
      'info',
      {
        label: 'Install',
        onClick: () => { terminalRef.current?.runInNewTab(installCmd); },
      },
    );
  }

  function handleAbout() { setAboutOpen(true); }

  const commands = {
    sidebarOpen, onToggleSidebar: () => setSidebarOpen(v => !v),
    terminalOpen, onToggleTerminal: () => setTerminalOpen(v => !v),
    aiPanelOpen, onToggleAiPanel: () => setAiPanelOpen(v => !v),
    isFullscreen, onToggleFullscreen: toggleFullscreen,
    onOpenFolder: handleOpenFolder,
    onOpenFile: handleOpenFile,
    onNewFile: handleNewFile,
    onNewWindow: handleNewWindow,
    onOpenPalette: () => setPaletteOpen(true),
    gitBranch,
    dirtyCount: tabs.filter(t => t.isDirty).length,
    hasActiveTab: !!activeTab && !activeTab.startsWith('__diff__'),
    hasFolderOpen: !!folderPath,
    onSave: () => { if (activeTab) handleSave(activeTab); },
    onSaveAs: handleSaveAs,
    onSaveAll: handleSaveAll,
    onCloseEditor: () => { if (activeTab) closeTab(activeTab); },
    onCloseFolder: () => setFolderPath(null),
    onEditorUndo: () => editorRef.current?.undo(),
    onEditorRedo: () => editorRef.current?.redo(),
    onEditorCut: () => editorRef.current?.cut(),
    onEditorCopy: () => editorRef.current?.copy(),
    onEditorPaste: () => editorRef.current?.paste(),
    onEditorSelectAll: () => editorRef.current?.selectAll(),
    onEditorFind: () => editorRef.current?.openFind(),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
    onNewTerminalTab: handleNewTerminalTab,
    onClearTerminal: () => terminalRef.current?.clearActive(),
    onKillTerminal: () => terminalRef.current?.killActive(),
    onAbout: handleAbout,
  };

  return (
    <CommandContext.Provider value={commands}>
    <div
      className="h-full w-full flex flex-col"
      style={{ backgroundColor: "var(--origin-bg-base)", color: "var(--origin-fg-default)" }}
    >
      {onboardingDone && <TitleBar />}
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
                      return <AiDiffPane tab={diffTab} onClose={() => closeTab(activeTab)} />;
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
                      onAddToAiContext={ctx => { setPinnedContext(ctx); setAiPanelOpen(true); }}
                      onAcceptDiff={() => handleSave(activeTab)}
                      rootPath={folderPath}
                      onDefinitionJump={(fp, line, col) => openTabAtLine(fp, line, col)}
                      onMissingServer={handleMissingServer}
                    />
                  ) : activeTab && fileErrors[activeTab] ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                      <p className="text-xs" style={{ color: "var(--origin-semantic-error)" }}>
                        Failed to read {activeTab.split(/[\\/]/).pop()}
                      </p>
                      <p className="text-xs" style={{ color: "var(--origin-fg-subtle)" }}>
                        {fileErrors[activeTab]}
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <span className="text-xs" style={{ color: "var(--origin-fg-subtle)", opacity: 0.6, letterSpacing: "0.12em" }}>
                        Loading
                        <span style={{ animation: "origin-ellipsis 1.2s steps(4, end) infinite" }}>…</span>
                      </span>
                    </div>
                  )}
                  {terminalOpen && (
                    <div
                      style={{
                        position: "absolute", bottom: 0, left: 0, right: 0, height: 20,
                        background: "linear-gradient(to bottom, transparent, var(--origin-bg-panel))",
                        pointerEvents: "none", zIndex: 10,
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
                  getFileContents={() => fileContentsRef.current}
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
          onToggleSidebar={() => { setPaletteOpen(false); setSidebarOpen(v => !v); }}
          onToggleTerminal={() => { setPaletteOpen(false); setTerminalOpen(v => !v); }}
          onOpenSettings={() => { setPaletteOpen(false); setSettingsOpen(true); }}
          terminalOpen={terminalOpen}
          sidebarOpen={sidebarOpen}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setAboutOpen(false)}
        >
          <div
            style={{
              background: 'var(--origin-bg-surface)',
              border: '1px solid var(--origin-border-default)',
              borderRadius: '10px',
              padding: '28px 32px',
              minWidth: '280px',
              display: 'flex', flexDirection: 'column', gap: '8px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--origin-fg-default)', margin: 0 }}>Origin IDE</p>
            <p style={{ fontSize: '12px', color: 'var(--origin-fg-muted)', margin: 0 }}>Version 0.1.0</p>
            <p style={{ fontSize: '12px', color: 'var(--origin-fg-subtle)', margin: '8px 0 0', lineHeight: 1.6 }}>
              Built with Tauri 2.x + React + CodeMirror 6.
            </p>
            <button
              onClick={() => setAboutOpen(false)}
              style={{
                marginTop: '16px', padding: '6px 16px', alignSelf: 'flex-end',
                background: 'var(--origin-bg-hover)', color: 'var(--origin-fg-default)',
                border: '1px solid var(--origin-border-default)', borderRadius: '6px',
                cursor: 'pointer', fontSize: '12px',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
    </CommandContext.Provider>
  );
}

export default App;
