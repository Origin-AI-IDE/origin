import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLineGutter, highlightActiveLine, drawSelection,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { undo as cmUndo, redo as cmRedo, selectAll as cmSelectAll, defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle,
  bracketMatching, indentOnInput,
} from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { unifiedMergeView } from '@codemirror/merge';
import { createHunkControls } from '../../lib/hunkControls';
import { getLanguageExtension, languageLabel } from './languageSupport';
import { createLspExtension } from '../../lib/lspCm6';
import { getLspLanguage } from '../../lib/lsp';
import { useToast } from '../ui/Toast';

// ── Syntax token colors — all via CSS variables ────────────────────────────────

export const originHighlight = HighlightStyle.define([
  { tag: t.comment,                                    color: 'var(--origin-syntax-comment)', fontStyle: 'italic' },
  { tag: t.lineComment,                                color: 'var(--origin-syntax-comment)', fontStyle: 'italic' },
  { tag: t.blockComment,                               color: 'var(--origin-syntax-comment)', fontStyle: 'italic' },
  { tag: t.keyword,                                    color: 'var(--origin-syntax-keyword)' },
  { tag: t.controlKeyword,                             color: 'var(--origin-syntax-keyword)' },
  { tag: t.definitionKeyword,                          color: 'var(--origin-syntax-keyword)' },
  { tag: t.moduleKeyword,                              color: 'var(--origin-syntax-keyword)' },
  { tag: [t.string, t.special(t.string)],              color: 'var(--origin-syntax-string)' },
  { tag: t.regexp,                                     color: 'var(--origin-syntax-string)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--origin-syntax-function)' },
  { tag: t.definition(t.variableName),                 color: 'var(--origin-syntax-function)' },
  { tag: t.definition(t.function(t.variableName)),     color: 'var(--origin-syntax-function)' },
  { tag: t.variableName,                               color: 'var(--origin-syntax-variable)' },
  { tag: t.propertyName,                               color: 'var(--origin-syntax-variable)' },
  { tag: [t.number, t.integer, t.float],               color: 'var(--origin-syntax-constant)' },
  { tag: t.constant(t.variableName),                   color: 'var(--origin-syntax-constant)' },
  { tag: t.bool,                                       color: 'var(--origin-syntax-constant)' },
  { tag: t.null,                                       color: 'var(--origin-syntax-constant)' },
  { tag: [t.typeName, t.className, t.namespace],       color: 'var(--origin-syntax-type)' },
  { tag: t.typeOperator,                               color: 'var(--origin-syntax-type)' },
  { tag: [t.operator, t.punctuation],                  color: 'var(--origin-syntax-operator)' },
  { tag: t.special(t.punctuation),                     color: 'var(--origin-syntax-operator)' },
  { tag: t.attributeName,                              color: 'var(--origin-syntax-attribute)' },
  { tag: t.attributeValue,                             color: 'var(--origin-syntax-string)' },
  { tag: t.tagName,                                    color: 'var(--origin-syntax-keyword)' },
  { tag: t.self,                                       color: 'var(--origin-syntax-keyword)' },
  { tag: [t.meta, t.documentMeta],                     color: 'var(--origin-syntax-comment)' },
  { tag: t.strong,                                     fontWeight: 'bold' },
  { tag: t.emphasis,                                   fontStyle: 'italic' },
  { tag: t.strikethrough,                              textDecoration: 'line-through' },
  { tag: t.link,                                       color: 'var(--origin-syntax-constant)', textDecoration: 'underline' },
  { tag: t.heading,                                    color: 'var(--origin-syntax-keyword)', fontWeight: 'bold' },
]);

// ── Structural theme ───────────────────────────────────────────────────────────

export const originBaseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--origin-fg-default)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, "Geist Mono", "Fira Code", monospace)',
    fontSize: '13px',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 0',
    caretColor: 'var(--origin-accent-blue)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    borderRight: '1px solid var(--origin-border-default)',
    color: 'var(--origin-fg-subtle)',
    paddingRight: '0',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3.2em',
    padding: '0 12px 0 8px',
    textAlign: 'right',
  },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-activeLine': { backgroundColor: 'var(--origin-bg-hover)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--origin-bg-hover)',
    color: 'var(--origin-fg-muted)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--origin-accent-blue)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--origin-accent-blue) 15%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--origin-accent-blue) 40%, transparent)',
    borderRadius: '2px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--origin-bg-base)',
    border: '1px solid var(--origin-border-default)',
    borderRadius: '6px',
    color: 'var(--origin-fg-default)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--origin-bg-hover)',
  },
  '.cm-panels': { backgroundColor: 'var(--origin-bg-base)', color: 'var(--origin-fg-default)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--origin-border-default)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--origin-border-default)' },
  '.cm-search': {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px',
    padding: '6px 10px',
    backgroundColor: 'var(--origin-bg-base)',
  },
  '.cm-search label': { fontSize: '12px', color: 'var(--origin-fg-muted)', display: 'flex', alignItems: 'center', gap: '4px' },
  '.cm-textfield': {
    background: 'var(--origin-bg-input)',
    border: '1px solid var(--origin-border-default)',
    borderRadius: '5px',
    color: 'var(--origin-fg-default)',
    padding: '3px 7px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    minWidth: '120px',
  },
  '.cm-textfield:focus': { borderColor: 'var(--origin-accent-blue)' },
  '.cm-button': {
    background: 'var(--origin-bg-hover)',
    border: '1px solid var(--origin-border-default)',
    borderRadius: '5px',
    color: 'var(--origin-fg-default)',
    padding: '3px 10px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  '.cm-button:hover': { background: 'var(--origin-bg-active)' },
  // ── Unified merge view (diff) ─────────────────────────────────────────────
  '.cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-error) 14%, transparent)',
  },
  '.cm-deletedChunk-gutter': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-error) 28%, transparent)',
    borderRight: '3px solid color-mix(in srgb, var(--origin-semantic-error) 65%, transparent)',
  },
  '.cm-changedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-success) 13%, transparent)',
  },
  '.cm-changedChunk-gutter': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-success) 25%, transparent)',
    borderRight: '3px solid color-mix(in srgb, var(--origin-semantic-success) 65%, transparent)',
  },
  '.cm-insertedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-success) 13%, transparent)',
  },
  '.cm-insertedChunk-gutter': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-success) 25%, transparent)',
    borderRight: '3px solid color-mix(in srgb, var(--origin-semantic-success) 65%, transparent)',
  },
  '.cm-deletedChunkField': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-error) 35%, transparent)',
    borderRadius: '2px',
  },
  '.cm-changedChunkField': {
    backgroundColor: 'color-mix(in srgb, var(--origin-semantic-success) 35%, transparent)',
    borderRadius: '2px',
  },
  '.cm-collapsedLines': {
    backgroundColor: 'var(--origin-bg-hover)',
    color: 'var(--origin-fg-subtle)',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 0',
  },
});

// ── Public types ───────────────────────────────────────────────────────────────

export interface EditorContext {
  filename: string;
  language: string;
  code: string;
  type: 'selection' | 'viewport';
  startLine: number;
  endLine: number;
}

export interface DiffHunk {
  fromLine: number;
  toLine: number;
}

export interface EditorHandle {
  getEditorContext: () => EditorContext | null;
  showDiff: (newCode: string, originalContent?: string) => void;
  rejectDiff: () => void;
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  openFind: () => void;
}

interface Props {
  path: string;
  content: string;
  onChange?: (value: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  initialCursor?: { line: number; col: number };
  jumpTo?: { line: number; col: number; key: number };
  onAddToAiContext?: (ctx: EditorContext) => void;
  onAcceptDiff?: () => void;
  onReady?: () => void;
  // LSP props
  rootPath?: string | null;
  onDefinitionJump?: (filePath: string, line: number, col: number) => void;
  onMissingServer?: (language: string, installCmd: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { path, content, onChange, onCursorChange, initialCursor, jumpTo, onAddToAiContext, onAcceptDiff, onReady, rootPath, onDefinitionJump, onMissingServer }, ref
) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const viewRef        = useRef<EditorView | null>(null);
  const onChangeRef    = useRef(onChange);
  onChangeRef.current  = onChange;
  const onCursorRef    = useRef(onCursorChange);
  onCursorRef.current  = onCursorChange;

  // One Compartment per editor instance — lets us swap in/out the merge extension.
  const mergeCompartment = useRef(new Compartment());
  // LSP extensions compartment — reconfigured per file path
  const lspCompartment = useRef(new Compartment());
  // Stable ref so the LSP definition callback always sees the current value
  const onDefinitionJumpRef = useRef(onDefinitionJump);
  onDefinitionJumpRef.current = onDefinitionJump;
  const onMissingServerRef = useRef(onMissingServer);
  onMissingServerRef.current = onMissingServer;

  const { showToast } = useToast();

  // Keep onAcceptDiff prop current so the hunk plugin callback never goes stale.
  const onAcceptDiffRef = useRef(onAcceptDiff);
  onAcceptDiffRef.current = onAcceptDiff;

  // Stable indirection into handleAcceptDiff for createHunkControls.
  const hunkAllResolvedRef = useRef<() => void>(() => {});

  // Diff state
  const [diffPending, setDiffPending] = useState(false);
  const diffOriginalRef = useRef<string>('');

  type CtxMenu = { x: number; y: number; ctx: EditorContext };
  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function onDown() { setContextMenu(null); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setContextMenu(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useImperativeHandle(ref, () => ({
    getEditorContext(): EditorContext | null {
      const view = viewRef.current;
      if (!view) return null;
      const { state } = view;
      const sel = state.selection.main;
      const filename = path.startsWith('__untitled__')
        ? 'Untitled'
        : (path.split(/[/\\]/).pop() ?? path);
      const language = languageLabel(path);

      if (sel.from !== sel.to) {
        const startLine = state.doc.lineAt(sel.from).number;
        const endLine   = state.doc.lineAt(sel.to).number;
        return { filename, language, code: state.sliceDoc(sel.from, sel.to), type: 'selection', startLine, endLine };
      }

      const visible = view.visibleRanges;
      if (!visible.length) return null;
      const from      = visible[0].from;
      const to        = visible[visible.length - 1].to;
      const startLine = state.doc.lineAt(from).number;
      const endLine   = state.doc.lineAt(to).number;
      return { filename, language, code: state.sliceDoc(from, to), type: 'viewport', startLine, endLine };
    },

    showDiff(newCode: string, originalContent?: string) {
      const view = viewRef.current;
      if (!view) return;

      // Use the explicitly supplied original when the view content may be stale
      // (e.g. file just opened — CodeMirror view was created before content loaded).
      const original = originalContent !== undefined ? originalContent : view.state.doc.toString();
      diffOriginalRef.current = original;

      // Atomically: replace the document + enable the merge extension + per-hunk controls.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newCode },
        effects: mergeCompartment.current.reconfigure([
          unifiedMergeView({
            original,
            highlightChanges: true,
            collapseUnchanged: { margin: 3, minSize: 4 },
            mergeControls: false,
          }),
          createHunkControls(() => hunkAllResolvedRef.current()),
        ]),
      });

      setDiffPending(true);
    },


    rejectDiff() {
      handleRejectDiff();
    },

    undo() { if (viewRef.current) cmUndo(viewRef.current); },
    redo() { if (viewRef.current) cmRedo(viewRef.current); },
    selectAll() { if (viewRef.current) cmSelectAll(viewRef.current); },
    openFind() { if (viewRef.current) openSearchPanel(viewRef.current); },

    cut() {
      const view = viewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      if (sel.from === sel.to) return;
      navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to))
        .then(() => { view.dispatch(view.state.replaceSelection('')); })
        .catch(() => { showToast('Clipboard write failed', 'error'); });
    },

    copy() {
      const view = viewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      if (sel.from === sel.to) return;
      navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to))
        .catch(() => { showToast('Clipboard write failed', 'error'); });
    },

    paste() {
      const view = viewRef.current;
      if (!view) return;
      navigator.clipboard.readText()
        .then(text => { view.dispatch(view.state.replaceSelection(text)); })
        .catch(() => { showToast('Clipboard read failed', 'error'); });
    },
  }));

  function handleAcceptDiff() {
    // Remove merge view, keep the current (modified) document.
    viewRef.current?.dispatch({
      effects: mergeCompartment.current.reconfigure([]),
    });
    setDiffPending(false);
    diffOriginalRef.current = '';
    onAcceptDiffRef.current?.();
  }

  // Keep hunkAllResolvedRef pointing at the latest handleAcceptDiff on every render.
  hunkAllResolvedRef.current = handleAcceptDiff;

  function handleRejectDiff() {
    const view = viewRef.current;
    if (view && diffOriginalRef.current !== '') {
      // Restore original document and remove merge view in one transaction.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: diffOriginalRef.current },
        effects: mergeCompartment.current.reconfigure([]),
      });
    }
    setDiffPending(false);
    diffOriginalRef.current = '';
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        history(),
        syntaxHighlighting(originHighlight),
        search({ top: false }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, ...searchKeymap]),
        getLanguageExtension(path),
        mergeCompartment.current.of([]),
        lspCompartment.current.of([]),
        originBaseTheme,
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            const pos  = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            onCursorRef.current?.(line.number, pos - line.from + 1);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    // Signal the parent that the imperative handle is now usable.
    // useImperativeHandle runs before useEffect, so editorRef.current is already set.
    onReady?.();

    // Restore cursor position from previous visit to this file
    if (initialCursor && (initialCursor.line > 1 || initialCursor.col > 1)) {
      const doc     = view.state.doc;
      const lineNum = Math.min(Math.max(1, initialCursor.line), doc.lines);
      const line    = doc.line(lineNum);
      const ch      = Math.max(0, Math.min(initialCursor.col - 1, line.length));
      view.dispatch({ selection: { anchor: line.from + ch }, scrollIntoView: true });
    }

    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
      setDiffPending(false);
      diffOriginalRef.current = '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Jump to line when triggered from search results
  useEffect(() => {
    const view = viewRef.current;
    if (!jumpTo || !view) return;
    const doc     = view.state.doc;
    const lineNum = Math.min(Math.max(1, jumpTo.line), doc.lines);
    const line    = doc.line(lineNum);
    const ch      = Math.max(0, Math.min((jumpTo.col ?? 1) - 1, line.length));
    view.dispatch({ selection: { anchor: line.from + ch }, scrollIntoView: true });
    view.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.key]);

  // LSP session — install extensions when a supported file is open in a workspace
  useEffect(() => {
    if (!rootPath || path.startsWith('__')) return;
    if (!getLspLanguage(path)) return;

    let cancelled = false;
    createLspExtension({
      filePath: path,
      rootPath,
      onDefinitionJump: (fp, ln, col) => onDefinitionJumpRef.current?.(fp, ln, col),
      onMissingServer: (lang, cmd) => onMissingServerRef.current?.(lang, cmd),
    }).then(exts => {
      if (cancelled) return;
      const v = viewRef.current;
      if (v) v.dispatch({ effects: lspCompartment.current.reconfigure(exts) });
    });

    return () => {
      cancelled = true;
      const v = viewRef.current;
      if (v) v.dispatch({ effects: lspCompartment.current.reconfigure([]) });
    };
  }, [path, rootPath]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!onAddToAiContext) return;
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    if (sel.from === sel.to) return;
    e.preventDefault();
    const filename  = path.startsWith('__untitled__') ? 'Untitled' : (path.split(/[/\\]/).pop() ?? path);
    const startLine = state.doc.lineAt(sel.from).number;
    const endLine   = state.doc.lineAt(sel.to).number;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      ctx: { filename, language: languageLabel(path), code: state.sliceDoc(sel.from, sel.to), type: 'selection', startLine, endLine },
    });
  }

  return (
    <>
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        style={{ flex: 1, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {/* Accept / Reject overlay — shown while a diff is pending */}
        {diffPending && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              zIndex: 50,
              backgroundColor: 'var(--origin-bg-base)',
              border: '1px solid var(--origin-border-default)',
              borderRadius: 7,
              padding: '4px 6px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              fontSize: '11px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--origin-fg-default)',
              color: 'var(--origin-bg-base)',
              fontWeight: 600,
              letterSpacing: '0.01em',
              userSelect: 'none',
            }}>
              Review changes
            </span>
            <button
              onClick={handleAcceptDiff}
              style={{
                padding: '3px 11px',
                borderRadius: 5,
                border: 'none',
                backgroundColor: 'var(--origin-semantic-success)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'color-mix(in srgb, var(--origin-semantic-success) 80%, white)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--origin-semantic-success)'; }}
            >
              Accept All
            </button>
            <button
              onClick={handleRejectDiff}
              style={{
                padding: '3px 11px',
                borderRadius: 5,
                border: 'none',
                backgroundColor: 'var(--origin-semantic-error)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'color-mix(in srgb, var(--origin-semantic-error) 80%, white)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--origin-semantic-error)'; }}
            >
              Reject All
            </button>
          </div>
        )}
      </div>

      {contextMenu && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            minWidth: '200px',
            background: 'color-mix(in srgb, var(--origin-bg-base) 85%, transparent)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--origin-border-default)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            padding: '4px',
            zIndex: 9999,
          }}
        >
          <button
            onClick={() => {
              onAddToAiContext?.(contextMenu.ctx);
              setContextMenu(null);
            }}
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '7px 10px',
              borderRadius: '5px',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              textAlign: 'left',
              gap: '2px',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span style={{ fontSize: '13px', color: 'var(--origin-fg-default)' }}>
              Ask AI about this
            </span>
            <span style={{ fontSize: '11px', color: 'var(--origin-fg-subtle)' }}>
              L{contextMenu.ctx.startLine}–{contextMenu.ctx.endLine} · {contextMenu.ctx.filename}
            </span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
});

export default Editor;
