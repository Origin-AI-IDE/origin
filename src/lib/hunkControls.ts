import { ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, EditorView } from '@codemirror/view';
import { EditorState, Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { getChunks, acceptChunk, rejectChunk } from '@codemirror/merge';

// ── Per-hunk Accept / Reject widget ───────────────────────────────────────────

class HunkControlWidget extends WidgetType {
  constructor(readonly chunkFromB: number) { super(); }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 8px',
      borderTop: '1px solid color-mix(in srgb, var(--origin-border-default) 50%, transparent)',
      backgroundColor: 'color-mix(in srgb, var(--origin-bg-panel) 60%, transparent)',
      userSelect: 'none',
    });

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const acceptBtn = makeBtn('✓ Accept hunk', true);
    acceptBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acceptChunk(view, this.chunkFromB);
    });

    const rejectBtn = makeBtn('✗ Reject hunk', false);
    rejectBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rejectChunk(view, this.chunkFromB);
    });

    wrap.append(spacer, rejectBtn, acceptBtn);
    return wrap;
  }

  eq(other: HunkControlWidget) { return this.chunkFromB === other.chunkFromB; }
  get estimatedHeight() { return 24; }
}

function makeBtn(text: string, isAccept: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  Object.assign(btn.style, {
    padding: '1px 8px',
    borderRadius: '4px',
    border: isAccept
      ? '1px solid color-mix(in srgb, var(--origin-semantic-success) 35%, transparent)'
      : '1px solid transparent',
    background: isAccept
      ? 'color-mix(in srgb, var(--origin-semantic-success) 12%, transparent)'
      : 'transparent',
    color: isAccept ? 'var(--origin-semantic-success)' : 'var(--origin-fg-muted)',
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: 'var(--font-sans)',
    lineHeight: '1.6',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.background = isAccept
      ? 'color-mix(in srgb, var(--origin-semantic-success) 22%, transparent)'
      : 'var(--origin-bg-hover)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = isAccept
      ? 'color-mix(in srgb, var(--origin-semantic-success) 12%, transparent)'
      : 'transparent';
  });

  return btn;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getChunkList(state: EditorState) {
  const result = getChunks(state);
  return result ? result.chunks : null;
}

// Takes EditorState (not EditorView) so it can be used inside StateField.
function buildDecos(state: EditorState): DecorationSet {
  const chunks = getChunkList(state);
  if (!chunks || chunks.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const chunk of chunks) {
    builder.add(chunk.fromB, chunk.fromB, Decoration.widget({
      widget: new HunkControlWidget(chunk.fromB),
      block: true, // CM6 rule: block decorations must live in a StateField, not a ViewPlugin.
      side: -1,
    }));
  }
  return builder.finish();
}

// StateField owns the block decorations — CM6 forbids block decos inside ViewPlugin.
const hunkDecoField = StateField.define<DecorationSet>({
  create: (state) => buildDecos(state),
  update(decos, tr) {
    if (tr.docChanged || tr.reconfigured) return buildDecos(tr.state);
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Returns a CM6 extension that renders per-hunk Accept / Reject buttons.
 * `onAllResolved` fires (via setTimeout) when every chunk has been accepted or
 * rejected and the merge view has no remaining diffs.
 */
export function createHunkControls(onAllResolved: () => void): Extension {
  return [
    hunkDecoField,
    // Bare ViewPlugin — no decorations — only watches for "all chunks resolved".
    ViewPlugin.fromClass(class {
      prevCount: number;

      constructor(view: EditorView) {
        const chunks = getChunkList(view.state);
        this.prevCount = chunks ? chunks.length : 0;
      }

      update(update: ViewUpdate) {
        const chunks = getChunkList(update.state);
        const count = chunks ? chunks.length : 0;
        if (this.prevCount > 0 && count === 0) {
          setTimeout(onAllResolved, 0);
        }
        this.prevCount = count;
      }
    }),
  ];
}
