import { StateField, StateEffect, Extension, Prec } from '@codemirror/state';
import {
  EditorView, ViewPlugin, ViewUpdate,
  Decoration, DecorationSet, WidgetType, keymap,
} from '@codemirror/view';

// ── Public type ───────────────────────────────────────────────────────────────

export type AiCompletionFn = (
  prefix: string,
  suffix: string,
  signal: AbortSignal,
) => AsyncIterable<string>;

// ── State ─────────────────────────────────────────────────────────────────────

const setSuggestion = StateEffect.define<{ text: string; pos: number } | null>();

interface SuggestionState { text: string | null; pos: number; }

const suggestionField = StateField.define<SuggestionState>({
  create: () => ({ text: null, pos: 0 }),
  update(val, tr) {
    // Auto-clear on document change or explicit cursor movement away from stored position.
    // tr.selection is defined only when the selection was explicitly set in this transaction.
    // Check effects first so a setSuggestion in the same transaction still wins.
    if (tr.docChanged || (tr.selection !== undefined && tr.newSelection.main.head !== val.pos)) {
      for (const e of tr.effects) if (e.is(setSuggestion)) return e.value ?? { text: null, pos: 0 };
      return { text: null, pos: 0 };
    }
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value ?? { text: null, pos: 0 };
    return val;
  },
});

// ── Ghost text decoration ──────────────────────────────────────────────────────

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) { super(); }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ai-ghost';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = this.text;
    return span;
  }

  eq(other: GhostTextWidget) { return this.text === other.text; }
  ignoreEvent() { return false; }
}

// Decoration state field — derived from suggestionField.
// Using a StateField (not ViewPlugin) keeps the decoration lifecycle tied to
// state transitions, which is safer for inline widgets too.
const ghostDecoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const { text, pos } = tr.state.field(suggestionField);
    if (!text || tr.state.selection.main.head !== pos) return Decoration.none;
    return Decoration.set([
      Decoration.widget({ widget: new GhostTextWidget(text), side: 1 }).range(pos),
    ]);
  },
  provide: f => EditorView.decorations.from(f),
});

// ── Keymap — Prec.highest so Tab beats indentWithTab unconditionally ──────────

const ghostKeymap = Prec.highest(keymap.of([
  {
    key: 'Tab',
    run(view) {
      const { text, pos } = view.state.field(suggestionField);
      // Return false when no suggestion so indentWithTab still fires normally.
      if (!text || view.state.selection.main.head !== pos) return false;
      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length },
        effects: setSuggestion.of(null),
      });
      return true;
    },
  },
  {
    key: 'Escape',
    run(view) {
      const { text } = view.state.field(suggestionField);
      if (!text) return false;
      view.dispatch({ effects: setSuggestion.of(null) });
      return true;
    },
  },
]));

// ── Post-processing ───────────────────────────────────────────────────────────

function trimSuggestion(raw: string, prefix: string, suffix: string): string {
  let s = raw;

  // Strip markdown fences if the model wrapped output in ```
  s = s.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

  // Deduplicate prefix-tail overlap: if prefix ends "functi" and model returns
  // "function foo", trim the leading "functi" so ghost shows "on foo".
  const prefixTail = prefix.slice(-20);
  for (let n = Math.min(prefixTail.length, s.length); n > 0; n--) {
    if (prefixTail.endsWith(s.slice(0, n))) { s = s.slice(n); break; }
  }

  // Cap to 6 lines.
  const lines = s.split('\n');
  if (lines.length > 6) s = lines.slice(0, 6).join('\n');

  // Remove trailing suffix overlap: if suffix starts ")" and model returns
  // "x + y)", trim so ghost shows "x + y".
  const suffixHead = suffix.slice(0, 20);
  for (let n = Math.min(suffixHead.length, s.length); n > 0; n--) {
    if (suffixHead.startsWith(s.slice(-n))) { s = s.slice(0, -n); break; }
  }

  return s;
}

// ── Prose detection ───────────────────────────────────────────────────────────

// Returns true if the text looks like a natural-language sentence rather than
// a code completion (e.g. "There is no text to insert at the cursor...").
function looksLikeProse(s: string): boolean {
  return /^(there |the |i |no |this |it |you |we |here |note |please |sorry |unfortunately |as an |i cannot |i don't |i'm )/i.test(s);
}

// ── Trigger plugin ────────────────────────────────────────────────────────────

function createTriggerPlugin(ref: { current: AiCompletionFn | undefined }) {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private abortCtrl: AbortController | null = null;

    constructor(private view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
      this.abortCtrl?.abort();
      this.abortCtrl = null;
      // suggestionField already clears on docChanged — no extra dispatch needed.
      const delay = parseInt(localStorage.getItem('origin-editor-autocomplete-delay') ?? '350', 10);
      this.timer = setTimeout(() => { this.timer = null; void this.trigger(); }, delay);
    }

    private async trigger() {
      const getCompletion = ref.current;
      if (!getCompletion) return;

      const view = this.view;
      const state = view.state;
      const cursorPos = state.selection.main.head;

      // ── Guards ──────────────────────────────────────────────────────────────

      // Skip mid-identifier: if the char immediately after the cursor is a word
      // character, we're mid-token and a suggestion would be disruptive.
      const charAfter = cursorPos < state.doc.length
        ? state.sliceDoc(cursorPos, cursorPos + 1)
        : '';
      if (/[\w$]/.test(charAfter)) return;

      // Build prefix (up to 4000 chars) and suffix (up to 2000 chars).
      const prefix = state.sliceDoc(Math.max(0, cursorPos - 4000), cursorPos);
      const suffix = state.sliceDoc(cursorPos, Math.min(state.doc.length, cursorPos + 2000));

      // Require at least 2 non-whitespace characters in the recent 200-char
      // window to avoid triggering on blank lines or minimal context.
      const recent = prefix.slice(-200);
      if ((recent.match(/\S/g) ?? []).length < 2) return;

      // ── AI call ─────────────────────────────────────────────────────────────

      const ctrl = new AbortController();
      this.abortCtrl = ctrl;
      let collected = '';

      try {
        for await (const token of getCompletion(prefix, suffix, ctrl.signal)) {
          if (ctrl.signal.aborted) return;
          collected += token;
          // Clip at first newline for single-line progressive display.
          const nl = collected.indexOf('\n');
          if (nl !== -1) { collected = collected.slice(0, nl); break; }
          // Progressive updates while streaming.
          if (collected.trim() && !looksLikeProse(collected)) {
            view.dispatch({ effects: setSuggestion.of({ text: collected, pos: cursorPos }) });
          }
        }
      } catch {
        return; // AbortError or network error — silently ignored
      }

      if (ctrl.signal.aborted) return;

      // Apply post-processing to the final collected text.
      const trimmed = trimSuggestion(collected, prefix, suffix);
      if (trimmed && !looksLikeProse(trimmed)) {
        view.dispatch({ effects: setSuggestion.of({ text: trimmed, pos: cursorPos }) });
      } else {
        view.dispatch({ effects: setSuggestion.of(null) });
      }
      this.abortCtrl = null;
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.abortCtrl?.abort();
    }
  });
}

// ── Ghost text CSS ─────────────────────────────────────────────────────────────

const ghostTheme = EditorView.baseTheme({
  '.cm-ai-ghost': {
    color: 'var(--origin-fg-subtle)',
    opacity: '0.5',
    pointerEvents: 'none',
    userSelect: 'none',
  },
});

// ── Public factory ─────────────────────────────────────────────────────────────

/**
 * Returns the CM6 extensions for AI ghost-text autocomplete.
 * Pass a stable ref whose `.current` is updated each render — the trigger
 * plugin always reads the latest function without needing to be recreated.
 */
export function createAiAutocompleteExtension(
  ref: { current: AiCompletionFn | undefined },
): Extension {
  return [ghostTheme, suggestionField, ghostDecoField, ghostKeymap, createTriggerPlugin(ref)];
}
