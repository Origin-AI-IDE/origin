import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLineGutter, highlightActiveLine, drawSelection,
  Decoration, type DecorationSet, WidgetType,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting, HighlightStyle,
  bracketMatching, indentOnInput,
} from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { diffLines } from 'diff';
import { getLanguageExtension, languageLabel } from './languageSupport';
import type { PatchResult } from '../../lib/patch';

// ── Diff decoration state ─────────────────────────────────────────────────────

const setDiffEffect   = StateEffect.define<DecorationSet>();
const clearDiffEffect = StateEffect.define<null>();

const diffDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDiffEffect))   return e.value;
      if (e.is(clearDiffEffect)) return Decoration.none;
    }
    return deco;
  },
  provide: f => EditorView.decorations.from(f),
});

const addedLineDeco = Decoration.line({ class: 'cm-diff-added' });

// ── Deleted-lines ghost widget (shown inline above the replacement) ─────────

class DeletedLinesWidget extends WidgetType {
  private readonly lines: string[];
  constructor(lines: string[]) {
    super();
    this.lines = lines;
  }
  eq(other: DeletedLinesWidget) {
    return this.lines.join('\n') === other.lines.join('\n');
  }
  toDOM() {
    const container = document.createElement('div');
    container.style.cssText = 'pointer-events:none;';
    for (const line of this.lines) {
      const el = document.createElement('div');
      el.className = 'cm-diff-deleted';
      // Use non-breaking space so empty lines still render at full height
      el.textContent = line || ' ';
      container.appendChild(el);
    }
    return container;
  }
  ignoreEvent() { return true; }
}

// ── Syntax token colors — all via CSS variables ────────────────────────────────

const originHighlight = HighlightStyle.define([
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

const originBaseTheme = EditorView.theme({
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
    backgroundColor: 'rgba(98,166,255,0.15)',
    outline: '1px solid rgba(98,166,255,0.4)',
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
  // Diff decorations
  '.cm-diff-added': { backgroundColor: 'rgba(46,160,67,0.28)' },
  '.cm-diff-deleted': {
    backgroundColor: 'rgba(218,54,51,0.22)',
    color: 'rgba(240,100,90,0.85)',
    textDecoration: 'line-through',
    display: 'block',
    fontFamily: 'var(--font-mono, "Geist Mono", monospace)',
    fontSize: '13px',
    lineHeight: '1.65',
    paddingLeft: '56px',
    whiteSpace: 'pre',
    userSelect: 'none',
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
  /** Replace the hunk (or full doc if no hunk) with snippet and show a diff preview. */
  showDiff: (snippet: string, hunk?: DiffHunk) => void;
  /** Load a fully-resolved merge from the patch engine and paint its diff. */
  showResolvedDiff: (result: PatchResult) => void;
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
}

// ── Component ──────────────────────────────────────────────────────────────────

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { path, content, onChange, onCursorChange, initialCursor, jumpTo, onAddToAiContext, onAcceptDiff }, ref
) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const viewRef        = useRef<EditorView | null>(null);
  const onChangeRef    = useRef(onChange);
  onChangeRef.current  = onChange;
  const onCursorRef    = useRef(onCursorChange);
  onCursorRef.current  = onCursorChange;

  // Diff state
  const [diffPending, setDiffPending] = useState(false);
  const diffOriginalRef  = useRef<string>('');
  // Tracks which hunk was replaced (null = full-file diff)
  const diffHunkRef = useRef<{ fromPos: number; toPos: number; deletedText: string; insertedLines: number } | null>(null);

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
        : (path.split(/[\/\\]/).pop() ?? path);
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

    showDiff(snippet: string, hunk?: DiffHunk) {
      const view = viewRef.current;
      if (!view) return;

      const doc      = view.state.doc;
      const original = doc.toString();
      diffOriginalRef.current = original;
      diffHunkRef.current = null;

      const decoRanges: Range<Decoration>[] = [];

      if (hunk) {
        // ── Hunk-level replacement ─────────────────────────────────────────────
        const fromLine = Math.max(1, Math.min(hunk.fromLine, doc.lines));
        const toLine   = Math.max(fromLine, Math.min(hunk.toLine, doc.lines));
        const fromPos  = doc.line(fromLine).from;
        const toPos    = doc.line(toLine).to;

        const deletedText  = doc.sliceString(fromPos, toPos);
        const deletedLines = deletedText.split('\n');
        const snippetLines = snippet.split('\n');

        // Replace only the hunk
        view.dispatch({ changes: { from: fromPos, to: toPos, insert: snippet } });

        // Store for reject
        diffHunkRef.current = {
          fromPos,
          toPos: fromPos + snippet.length, // new end after insertion
          deletedText,
          insertedLines: snippetLines.length,
        };

        // Green decorations on the new (inserted) lines
        for (let i = 0; i < snippetLines.length; i++) {
          const lineNum = fromLine + i;
          if (lineNum <= view.state.doc.lines) {
            decoRanges.push(addedLineDeco.range(view.state.doc.line(lineNum).from));
          }
        }

        // Red ghost widget for the deleted lines — appears above the replacement
        if (deletedLines.length > 0 && deletedText.trim() !== '') {
          const insertPos = view.state.doc.line(fromLine).from;
          decoRanges.push(
            Decoration.widget({
              widget: new DeletedLinesWidget(deletedLines),
              side: -1,
            }).range(insertPos),
          );
        }
      } else {
        // ── Full-file replacement (fallback when no hunk is known) ──────────────
        view.dispatch({ changes: { from: 0, to: doc.length, insert: snippet } });

        const changes = diffLines(original, snippet);
        let lineInNew = 1;
        let pendingDeleted: string[] = [];

        for (const ch of changes) {
          const count = ch.count ?? 0;
          if (ch.removed) {
            // Collect deleted lines — will be shown as red ghost widget
            // before the next surviving line (or at end of file).
            const raw = (ch.value ?? '').split('\n');
            // diffLines includes a trailing empty string from the final \n — drop it
            if (raw[raw.length - 1] === '') raw.pop();
            pendingDeleted.push(...raw);
            continue;
          }

          // Flush pending deletions before this block of unchanged/added lines
          if (pendingDeleted.length > 0) {
            const atLine = Math.min(lineInNew, view.state.doc.lines);
            if (atLine >= 1) {
              decoRanges.push(
                Decoration.widget({ widget: new DeletedLinesWidget(pendingDeleted), side: -1 })
                  .range(view.state.doc.line(atLine).from),
              );
            }
            pendingDeleted = [];
          }

          if (ch.added) {
            for (let i = 0; i < count; i++) {
              const lineNum = lineInNew + i;
              if (lineNum <= view.state.doc.lines) {
                decoRanges.push(addedLineDeco.range(view.state.doc.line(lineNum).from));
              }
            }
          }
          lineInNew += count;
        }

        // Flush any deletions at the very end of the file
        if (pendingDeleted.length > 0 && view.state.doc.lines >= 1) {
          decoRanges.push(
            Decoration.widget({ widget: new DeletedLinesWidget(pendingDeleted), side: 1 })
              .range(view.state.doc.line(view.state.doc.lines).to),
          );
        }
      }

      if (decoRanges.length > 0) {
        view.dispatch({
          effects: setDiffEffect.of(Decoration.set(decoRanges, true)),
        });
      }

      setDiffPending(true);
    },

    showResolvedDiff(result: PatchResult) {
      const view = viewRef.current;
      if (!view) return;
      if (result.merged_content == null || result.diff == null) return;

      const doc = view.state.doc;
      diffOriginalRef.current = doc.toString();
      diffHunkRef.current = null;

      // Swap the whole document for the engine-merged content in one change.
      view.dispatch({ changes: { from: 0, to: doc.length, insert: result.merged_content } });

      const newDoc = view.state.doc;
      const decoRanges: Range<Decoration>[] = [];

      for (const line of result.diff.lines) {
        if (line.kind === 'added' && line.new_line >= 1 && line.new_line <= newDoc.lines) {
          decoRanges.push(addedLineDeco.range(newDoc.line(line.new_line).from));
        }
      }

      for (const block of result.diff.deletions) {
        // after_new_line === 0 anchors the ghost rows at the very top of the doc.
        const pos = block.after_new_line === 0
          ? 0
          : newDoc.line(Math.min(block.after_new_line, newDoc.lines)).from;
        decoRanges.push(
          Decoration.widget({ widget: new DeletedLinesWidget(block.lines), side: -1 }).range(pos),
        );
      }

      if (decoRanges.length > 0) {
        view.dispatch({ effects: setDiffEffect.of(Decoration.set(decoRanges, true)) });
      }

      setDiffPending(true);
    },
  }));

  function handleAcceptDiff() {
    viewRef.current?.dispatch({ effects: clearDiffEffect.of(null) });
    setDiffPending(false);
    diffOriginalRef.current = '';
    diffHunkRef.current     = null;
    onAcceptDiff?.();
  }

  function handleRejectDiff() {
    const view = viewRef.current;
    if (view && diffOriginalRef.current !== '') {
      const hunk = diffHunkRef.current;
      if (hunk) {
        // Restore just the replaced hunk
        const hunkEndLine = Math.min(
          view.state.doc.lines,
          view.state.doc.lineAt(hunk.fromPos).number + hunk.insertedLines - 1,
        );
        view.dispatch({
          changes: {
            from: hunk.fromPos,
            to: view.state.doc.line(hunkEndLine).to,
            insert: hunk.deletedText,
          },
          effects: clearDiffEffect.of(null),
        });
      } else {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: diffOriginalRef.current },
          effects: clearDiffEffect.of(null),
        });
      }
    }
    setDiffPending(false);
    diffOriginalRef.current = '';
    diffHunkRef.current     = null;
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
        diffDecoField,
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

    // Restore cursor position from previous visit to this file
    if (initialCursor && (initialCursor.line > 1 || initialCursor.col > 1)) {
      const doc    = view.state.doc;
      const lineNum = Math.min(Math.max(1, initialCursor.line), doc.lines);
      const line   = doc.line(lineNum);
      const ch     = Math.max(0, Math.min(initialCursor.col - 1, line.length));
      view.dispatch({ selection: { anchor: line.from + ch }, scrollIntoView: true });
    }

    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
      setDiffPending(false);
      diffOriginalRef.current = '';
      diffHunkRef.current     = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Jump to line when triggered from search results
  useEffect(() => {
    const view = viewRef.current;
    if (!jumpTo || !view) return;
    const doc    = view.state.doc;
    const lineNum = Math.min(Math.max(1, jumpTo.line), doc.lines);
    const line   = doc.line(lineNum);
    const ch     = Math.max(0, Math.min((jumpTo.col ?? 1) - 1, line.length));
    view.dispatch({ selection: { anchor: line.from + ch }, scrollIntoView: true });
    view.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.key]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!onAddToAiContext) return;
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    if (sel.from === sel.to) return;
    e.preventDefault();
    const filename  = path.startsWith('__untitled__') ? 'Untitled' : (path.split(/[\/\\]/).pop() ?? path);
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
            {/* Label — inverted chip: fg color as bg, bg color as text */}
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
                backgroundColor: 'rgb(35,134,54)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgb(46,160,67)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgb(35,134,54)'; }}
            >
              Accept
            </button>
            <button
              onClick={handleRejectDiff}
              style={{
                padding: '3px 11px',
                borderRadius: 5,
                border: 'none',
                backgroundColor: 'rgb(218,54,51)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgb(248,81,73)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgb(218,54,51)'; }}
            >
              Reject
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
