import {
  EditorView,
  GutterMarker,
  gutter,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import {
  StateEffect,
  StateField,
  RangeSet,
  type Extension,
} from '@codemirror/state';

// ── State effects (exported so Editor.tsx can dispatch them in syncBreakpoints) ──

/** Add a breakpoint at this 1-based line number. */
export const addBreakpointEffect = StateEffect.define<number>();
/** Remove the breakpoint at this 1-based line number. */
export const removeBreakpointEffect = StateEffect.define<number>();
/** Remove all breakpoints at once (used by syncBreakpoints). */
export const clearBreakpointsEffect = StateEffect.define<null>();
/** Set the current paused line (1-based), or null to clear. */
export const setPausedLineEffect = StateEffect.define<number | null>();

// ── Gutter marker — rendered red dot ─────────────────────────────────────────

class BreakpointMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement('div');
    el.style.cssText = [
      'width:8px',
      'height:8px',
      'border-radius:50%',
      'background:var(--origin-semantic-error)',
      'margin:auto',
      'cursor:pointer',
      'flex-shrink:0',
    ].join(';');
    return el;
  }
}

const BP_MARKER = new BreakpointMarker();

// ── breakpointField — RangeSet of markers keyed by line.from offset ──────────

export const breakpointField = StateField.define<RangeSet<BreakpointMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    // Remap marker positions after document edits
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addBreakpointEffect)) {
        const lineNo = e.value;
        if (lineNo < 1 || lineNo > tr.state.doc.lines) continue;
        const lineFrom = tr.state.doc.line(lineNo).from;
        set = set.update({ add: [BP_MARKER.range(lineFrom)] });
      } else if (e.is(removeBreakpointEffect)) {
        const lineNo = e.value;
        if (lineNo < 1 || lineNo > tr.state.doc.lines) continue;
        const lineFrom = tr.state.doc.line(lineNo).from;
        set = set.update({ filter: from => from !== lineFrom });
      } else if (e.is(clearBreakpointsEffect)) {
        set = RangeSet.empty;
      }
    }
    return set;
  },
});

// ── pausedLineField — tracks current execution line ───────────────────────────

export const pausedLineField = StateField.define<number | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setPausedLineEffect)) return e.value;
    }
    return val;
  },
});

// ── Paused-line highlight — StateField so it can provide block decorations ───

const pausedLineDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPausedLineEffect)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) {
          return Decoration.none;
        }
        const lineFrom = tr.state.doc.line(e.value).from;
        return Decoration.set([
          Decoration.line({ class: 'cm-dap-paused-line' }).range(lineFrom),
        ]);
      }
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f),
});

// ── Theme ─────────────────────────────────────────────────────────────────────

const dapTheme = EditorView.baseTheme({
  '.cm-breakpoint-gutter': {
    width: '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  '.cm-dap-paused-line': {
    backgroundColor: 'color-mix(in srgb, var(--origin-accent-yellow) 18%, transparent)',
  },
});

// ── Public factory ────────────────────────────────────────────────────────────

export interface DapExtensionOptions {
  /** Absolute path of the currently displayed file. */
  filePath: string;
  /** Called when the user clicks the gutter next to a line. */
  onToggleBreakpoint: (line: number) => void;
}

/**
 * Returns the set of CM6 extensions needed for DAP debugging UX:
 * - Clickable breakpoint gutter
 * - Paused-line background highlight
 *
 * External callers drive state via StateEffects dispatched through
 * EditorHandle.syncBreakpoints (addBreakpointEffect, clearBreakpointsEffect,
 * setPausedLineEffect).
 */
export function createDapExtension(opts: DapExtensionOptions): Extension {
  return [
    breakpointField,
    pausedLineField,
    pausedLineDecoField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: view => view.state.field(breakpointField),
      // Reserves horizontal space even on empty lines
      initialSpacer: () => BP_MARKER,
      domEventHandlers: {
        click(view, line) {
          const lineNo = view.state.doc.lineAt(line.from).number;
          opts.onToggleBreakpoint(lineNo);
          return true; // prevent event propagation
        },
      },
    }),
    dapTheme,
  ];
}
