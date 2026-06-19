import type { ModelMessage } from "ai";

// ── Types mirroring what buildModelHistory emits ───────────────────────────────

type AssistantPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
};

// ── Token-budget gate ──────────────────────────────────────────────────────────
//
// Only compact once the conversation grows large enough to matter. Rough
// estimate: 1 token ≈ 4 chars of serialized JSON. Gate at 40k tokens — well
// below Claude's 200k and GPT-4's 128k windows, so short sessions are never
// touched and we avoid mangling history we don't need to.

const COMPACT_TOKEN_GATE = 40_000;

function estimateTokens(messages: ModelMessage[]): number {
  return JSON.stringify(messages).length / 4;
}

// ── compactHistory ─────────────────────────────────────────────────────────────
//
// Removes redundant or stale read_file results from the message history before
// sending to the model. A read result is dropped when it is no longer
// authoritative:
//
//   1. Superseded reads — the same path was read again later; only the most
//      recent read of an un-mutated file carries the current state.
//   2. Mutation-invalidated reads — the agent wrote to or edited the path
//      AFTER (or at) this read. A write makes ALL prior reads of that path
//      stale, even if the file was read only once.
//
// In both cases the tool-result content is swapped for a one-line placeholder.
// Assistant messages (the model's reasoning and tool calls) are always kept
// intact, so the chain of reasoning is preserved, and the most-recent
// authoritative read is preserved verbatim.
//
// Compaction is gated on a token budget: under COMPACT_TOKEN_GATE the messages
// are returned unchanged to avoid needless work on short sessions.

export function compactHistory(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length < 2) return messages;

  // Token-budget gate — short sessions are returned untouched.
  if (estimateTokens(messages) <= COMPACT_TOKEN_GATE) return messages;

  // Last message is the current user turn — never touch it.
  const history = messages.slice(0, -1);
  const currentUserMsg = messages[messages.length - 1];

  // Pass 1: walk assistant messages in order, recording for each tool call:
  //   - read_file calls: { callId, path, index }
  //   - write_file / edit calls: path → earliest mutation index
  // `index` is the position in `history` so we can compare ordering.
  const reads: { callId: string; path: string; index: number }[] = [];
  const firstMutationIndex = new Map<string, number>(); // path → first write/edit index

  for (let index = 0; index < history.length; index++) {
    const msg = history[index];
    if (msg.role !== "assistant") continue;
    const content = Array.isArray(msg.content) ? (msg.content as AssistantPart[]) : [];
    for (const part of content) {
      if (part.type !== "tool-call") continue;

      if (part.toolName === "read_file") {
        const path = (part.input as { path?: string })?.path ?? "";
        reads.push({ callId: part.toolCallId, path, index });
      } else if (part.toolName === "write_file" || part.toolName === "edit") {
        const path = (part.input as { path?: string })?.path ?? "";
        if (path && !firstMutationIndex.has(path)) {
          firstMutationIndex.set(path, index);
        }
      }
    }
  }

  if (reads.length === 0) return messages; // no file reads at all

  // Pass 2: determine which read call IDs are stale.
  //
  //   - Superseded: a later read of the same path exists (higher index).
  //   - Mutation-invalidated: a write/edit to the same path occurred at or
  //     after this read's index. A write at the same step reflects newer
  //     intent, so we treat it as invalidating.
  const lastReadIndexPerPath = new Map<string, number>();
  for (const r of reads) {
    const prev = lastReadIndexPerPath.get(r.path);
    if (prev === undefined || r.index > prev) lastReadIndexPerPath.set(r.path, r.index);
  }

  const superseded = new Set<string>();
  const callIdToPath = new Map<string, string>();
  for (const r of reads) {
    callIdToPath.set(r.callId, r.path);

    const lastReadIdx = lastReadIndexPerPath.get(r.path)!;
    const isSuperseded = r.index < lastReadIdx;

    const mutationIdx = firstMutationIndex.get(r.path);
    const isMutated = mutationIdx !== undefined && mutationIdx >= r.index;

    if (isSuperseded || isMutated) superseded.add(r.callId);
  }

  if (superseded.size === 0) return messages; // nothing stale

  // Pass 3: rewrite tool messages that contain stale read results.
  const compactedHistory = history.map((msg): ModelMessage => {
    if (msg.role !== "tool") return msg;

    const content = msg.content as ToolResultPart[];
    let changed = false;
    const newContent = content.map((part): ToolResultPart => {
      if (part.toolName !== "read_file" || !superseded.has(part.toolCallId)) return part;
      const path = callIdToPath.get(part.toolCallId) ?? "unknown";
      const wasMutated = firstMutationIndex.has(path);
      changed = true;
      return {
        ...part,
        output: {
          type: "text",
          value: wasMutated
            ? `[File contents omitted — invalidated by a later write/edit of ${path}]`
            : `[File contents omitted — superseded by a later read of ${path}]`,
        },
      };
    });

    return changed ? ({ ...msg, content: newContent } as ModelMessage) : msg;
  });

  return [...compactedHistory, currentUserMsg];
}
