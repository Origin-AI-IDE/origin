import { useState, useEffect, useRef } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import Onboarding from "./components/onboarding/Onboarding";
import EditorEmptyState from "./components/editor/EditorEmptyState";
import TabBar, { type Tab } from "./components/editor/TabBar";
import Editor, { type EditorHandle, type EditorContext, type DiffHunk } from "./components/editor/Editor";
import StatusBar from "./components/StatusBar";
import TerminalPanel from "./components/terminal/TerminalPanel";
import CommandPalette from "./components/palette/CommandPalette";
import AiPanel from "./components/ai/AiPanel";
import SettingsPanel from "./components/settings/SettingsPanel";
import { getSetting, setSetting, pushRecentProject } from "./lib/settings";
import { readFile, writeFile } from "./lib/fs";
import { getBranch } from "./lib/git";
import { languageLabel } from "./components/editor/languageSupport";
import { useWorkspace } from "./context/WorkspaceContext";
import { useToast } from "./components/ui/Toast";
import { patchApplySnippet, patchReplaceRegion, type PatchResult } from "./lib/patch";

// Feature flag: route applies through the Rust patch-engine. Set to false to fall
// back to the legacy TypeScript merge path (one-line rollback during migration).
const USE_PATCH_ENGINE = false;

// Matches a complete SEARCH/REPLACE block as produced by the LLM and passed
// through extractFirstCompleteBlock / SearchReplaceBlock.onApply.
const SR_BLOCK_RE = /^<<<<<<< ORIGINAL\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> UPDATED$/;

/**
 * Merges an LLM snippet back into the original file.
 *
 * Two strategies, chosen by the shape of the snippet:
 *
 *  1. Prefix + suffix anchoring — match shared lines at BOTH the start and the
 *     end of the snippet relative to the original; the region in between is the
 *     change. This is correct for full-file rewrites/redesigns (where the LLM
 *     ignores "snippet only" and returns the whole file), top/bottom additions,
 *     and brand-new files. When neither end matches, the snippet IS the new file.
 *
 *  2. Interior anchor — find the longest consecutive run of snippet lines that
 *     appears somewhere inside the original, and splice the snippet in there.
 *     This is correct for small targeted edits that quote a few context lines
 *     from the MIDDLE of the file.
 *
 * The previous implementation used only a greedy prefix-anchored run, which on a
 * full-file rewrite could match the whole snippet against the file's head and
 * then `slice()` away the original body — destroying everything that wasn't in
 * the snippet and leaving only the snippet in the editor. The hybrid below never
 * discards original content unless that content was genuinely replaced by the
 * snippet's own context.
 *
 * Invariant: never destroy content that the snippet did not account for. When in
 * doubt, prefer inserting (interior anchor) or whole-file replacement over a
 * lossy slice.
 */
function applySnippetToFile(original: string, snippet: string): string {
  const origLines    = original.split('\n');
  const snippetLines = snippet.split('\n');

  // ── Strategy 1: prefix + suffix (handles full rewrites & top/bottom edits) ──
  let prefixLen = 0;
  while (
    prefixLen < origLines.length &&
    prefixLen < snippetLines.length &&
    origLines[prefixLen].trimEnd() === snippetLines[prefixLen].trimEnd()
  ) prefixLen++;

  let suffixLen = 0;
  while (
    suffixLen < origLines.length - prefixLen &&
    suffixLen < snippetLines.length - prefixLen &&
    origLines[origLines.length - 1 - suffixLen].trimEnd() ===
      snippetLines[snippetLines.length - 1 - suffixLen].trimEnd()
  ) suffixLen++;

  // ── Strategy 2: greedy interior anchor (handles small targeted edits) ───────
  let bestStart    = -1;
  let bestMatchLen = 0;
  for (let i = 0; i < origLines.length; i++) {
    let k = 0;
    while (
      k < snippetLines.length &&
      i + k < origLines.length &&
      origLines[i + k].trimEnd() === snippetLines[k].trimEnd()
    ) k++;
    if (k > bestMatchLen) {
      bestMatchLen = k;
      bestStart    = i;
    }
  }

  // ── Choose strategy ─────────────────────────────────────────────────────────
  const origIsEmpty = original.trim() === '';

  // Anchor coverage: what fraction of the snippet's lines are context (matched
  // in the original). High coverage means this is a targeted edit regardless of
  // whether the snippet is large relative to the file — the interior anchor wins.
  const anchorCoverage     = snippetLines.length > 0 ? bestMatchLen / snippetLines.length : 0;
  const anchorLine         = bestStart >= 0 ? snippetLines[0].trim() : '';
  const anchorIsTrivial    = anchorLine.length <= 1;
  const goodInteriorAnchor = bestMatchLen >= 2 || (bestMatchLen === 1 && !anchorIsTrivial);
  // ≥50% of snippet is context → this is definitely a targeted edit, not a rewrite
  const strongAnchor       = anchorCoverage >= 0.5;
  // When the entire snippet matches a prefix of the original (anchor covers 100%
  // and starts at 0), the interior splice would re-append the deleted tail.
  // Let prefix+suffix handle it — it correctly drops the lines after the snippet.
  const snippetIsPurePrefix = bestStart === 0 && bestMatchLen === snippetLines.length;

  if (!origIsEmpty && bestStart >= 0 && goodInteriorAnchor && strongAnchor && !snippetIsPurePrefix) {
    // Splice the snippet over its matched context, preserving everything outside.
    return [
      ...origLines.slice(0, bestStart),
      ...snippetLines,
      ...origLines.slice(bestStart + bestMatchLen),
    ].join('\n');
  }

  // Prefix+suffix path — handles full rewrites and top/bottom additions.
  // No shared context at either end → snippet IS the new file (only when the
  // original is empty or the snippet has no anchor at all).
  if (prefixLen === 0 && suffixLen === 0) {
    if (origIsEmpty || bestStart < 0) {
      // Empty file or zero anchor: treat snippet as full replacement.
      const trimmed = original.trimEnd();
      return origIsEmpty
        ? snippet
        : trimmed + (trimmed ? '\n' : '') + snippet; // append as last resort
    }
    // Has a weak (trivial) anchor — splice there rather than wipe the file.
    return [
      ...origLines.slice(0, bestStart),
      ...snippetLines,
      ...origLines.slice(bestStart + bestMatchLen),
    ].join('\n');
  }

  return [
    ...origLines.slice(0, prefixLen),
    ...snippetLines.slice(prefixLen, snippetLines.length - suffixLen),
    ...origLines.slice(origLines.length - suffixLen),
  ].join('\n');
}

// Applies a SEARCH/REPLACE block (exact string match with whitespace-trim
// fallback). Returns the patched file content, or null when ORIGINAL is not
// found — leaving the file untouched is the correct failure mode.
function applySearchReplace(fileContent: string, original: string, updated: string): string | null {
  // Exact match (fast path)
  const idx = fileContent.indexOf(original);
  if (idx !== -1) {
    return fileContent.slice(0, idx) + updated + fileContent.slice(idx + original.length);
  }
  // Whitespace-trimmed fallback: strip trailing spaces per line, then retry.
  const trimLines = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n');
  const normFile = trimLines(fileContent);
  const normOrig = trimLines(original);
  const normIdx = normFile.indexOf(normOrig);
  if (normIdx === -1) return null;
  // Map the normalised index back to the original file's line range.
  const linesBefore = normFile.slice(0, normIdx).split('\n').length - 1;
  const origFileLines = fileContent.split('\n');
  const matchLineCount = original.split('\n').length;
  return [
    ...origFileLines.slice(0, linesBefore),
    ...updated.split('\n'),
    ...origFileLines.slice(linesBefore + matchLineCount),
  ].join('\n');
}

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
  const { showToast } = useToast();
  const [onboardingDone, setOnboardingDone] = useState(
    () => cOnboarding.get() === 'true'
  );
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const untitledCount = useRef(0);
  const handleSaveRef = useRef<(path: string) => Promise<void>>(() => Promise.resolve());
  const editorRef = useRef<EditorHandle>(null);
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
  const [pendingDiff, setPendingDiff] = useState<{ code: string; targetPath: string; hunk?: DiffHunk } | null>(null);

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


  // Routes a PatchResult into the editor (Applied) or surfaces a notice otherwise.
  function handlePatchResult(result: PatchResult) {
    if (result.outcome === 'Applied') {
      editorRef.current?.showResolvedDiff(result);
      return;
    }
    if (result.outcome === 'NoOp') {
      showToast('Already applied — no changes to make.', 'info');
      return;
    }
    showToast(result.message || `Could not apply snippet (${result.outcome}).`, 'error');
  }

  // Apply pending diff once the target file is active and its content is loaded
  useEffect(() => {
    if (!pendingDiff) return;
    if (activeTab !== pendingDiff.targetPath) return;
    if (fileContents[activeTab] === undefined) return;
    if (!editorRef.current) return;
    const { code, hunk } = pendingDiff;
    const original = fileContents[activeTab];
    setPendingDiff(null);

    // SEARCH/REPLACE path
    const srMatch = SR_BLOCK_RE.exec(code);
    if (srMatch) {
      const result = applySearchReplace(original, srMatch[1], srMatch[2]);
      if (result === null) {
        showToast('Original text not found in file — no changes made.', 'error');
        return;
      }
      editorRef.current.showDiff(result);
      return;
    }

    // Legacy paths
    if (USE_PATCH_ENGINE) {
      const language = languageLabel(activeTab);
      const promise = hunk
        ? patchReplaceRegion(original, code, hunk.fromLine, hunk.toLine)
        : patchApplySnippet(original, code, activeTab, language);
      promise.then(handlePatchResult).catch(err => showToast(String(err), 'error'));
      return;
    }

    const merged = hunk ? code : applySnippetToFile(original, code);
    editorRef.current.showDiff(merged, hunk);
  }, [pendingDiff, activeTab, fileContents]);

  // Read git branch whenever the workspace folder changes
  useEffect(() => {
    if (!folderPath) { setGitBranch(null); return; }
    getBranch(folderPath).then(setGitBranch).catch(() => setGitBranch(null));
  }, [folderPath]);

  // Load file content when switching to a tab that hasn't been loaded yet
  useEffect(() => {
    if (!activeTab || fileContents[activeTab] !== undefined) return;
    if (activeTab.startsWith('__untitled__')) return;
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

  async function handleApplyCode(code: string, filePath?: string, ctx?: EditorContext) {
    // Read live editor state through refs — auto-apply calls this from the AI
    // stream callback while App has not re-rendered, so the render-closure
    // values would be stale (see activeTabRef / fileContentsRef above).
    const currentActiveTab = activeTabRef.current;
    const currentFileContents = fileContentsRef.current;
    const targetPath = filePath ?? currentActiveTab;
    if (!targetPath) return;

    // ── SEARCH/REPLACE path (new format) ────────────────────────────────────
    const srMatch = SR_BLOCK_RE.exec(code);
    if (srMatch) {
      const [, origText, updatedText] = srMatch;
      if (targetPath === currentActiveTab && currentFileContents[targetPath] !== undefined && editorRef.current) {
        const result = applySearchReplace(currentFileContents[targetPath], origText, updatedText);
        if (result === null) {
          showToast('Original text not found in file — no changes made.', 'error');
          return;
        }
        editorRef.current.showDiff(result);
        return;
      }
      openTab(targetPath);
      setPendingDiff({ code, targetPath });
      return;
    }

    // ── Legacy snippet path ──────────────────────────────────────────────────
    const hunk: DiffHunk | undefined = ctx?.type === 'selection'
      ? { fromLine: ctx.startLine, toLine: ctx.endLine }
      : undefined;
    if (targetPath === currentActiveTab && currentFileContents[targetPath] !== undefined && editorRef.current) {
      const original = currentFileContents[targetPath];
      if (USE_PATCH_ENGINE) {
        try {
          const language = languageLabel(targetPath);
          const result = hunk
            ? await patchReplaceRegion(original, code, hunk.fromLine, hunk.toLine)
            : await patchApplySnippet(original, code, targetPath, language);
          handlePatchResult(result);
        } catch (err) {
          showToast(String(err), 'error');
        }
        return;
      }
      const merged = hunk ? code : applySnippetToFile(original, code);
      editorRef.current.showDiff(merged, hunk);
      return;
    }
    openTab(targetPath);
    setPendingDiff({ code, targetPath, hunk });
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
        />
      )}
      {!onboardingDone ? (
        <Onboarding onComplete={completeOnboarding} />
      ) : (
        <>
          <div className="flex flex-1 overflow-hidden">
            {sidebarOpen && <Sidebar onFileOpen={openTab} onFileOpenAtLine={openTabAtLine} />}
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
