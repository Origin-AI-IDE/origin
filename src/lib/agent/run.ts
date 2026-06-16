import { streamText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import type { PendingAction } from "./tools";
import type { UsageData } from "../ai";

// ── Event types ────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "token";             delta: string }
  | { type: "tool-call";         id: string; toolName: string; args: unknown }
  | { type: "tool-result";       id: string; toolName: string; result: unknown }
  | { type: "approval-required"; id: string; action: PendingAction; approve: () => void; reject: () => void }
  | { type: "step-finish" }
  | { type: "finish";            usage: UsageData }
  | { type: "error";             message: string };

// ── runAgent ───────────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  model:        LanguageModel;
  messages:     ModelMessage[];
  tools:        ToolSet;
  systemPrompt: string;
  cacheSystem?: boolean;
  onEvent:      (event: AgentEvent) => void;
}

export function runAgent(options: RunAgentOptions): { cancel: () => void } {
  const { model, messages, tools, systemPrompt, cacheSystem = false, onEvent } = options;
  const controller = new AbortController();

  (async () => {
    try {
      // System prompt as a leading message so we can attach cache_control via providerOptions.
      // When cacheSystem is true (Anthropic only), two cache breakpoints are set:
      //   1. The system message — caches tools + system prompt prefix.
      //   2. The last history message — caches the growing conversation prefix each turn.
      // Max 4 breakpoints allowed by Anthropic; we use ≤ 2.
      const sysMsg = (
        cacheSystem
          ? { role: "system", content: systemPrompt, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
          : { role: "system", content: systemPrompt }
      ) as ModelMessage;

      let historyMsgs = messages.slice();
      if (cacheSystem && historyMsgs.length > 0) {
        const last = historyMsgs[historyMsgs.length - 1];
        const lastWithOptions = last as ModelMessage & { providerOptions?: { anthropic?: Record<string, unknown> } };
        historyMsgs[historyMsgs.length - 1] = {
          ...last,
          providerOptions: {
            ...(lastWithOptions.providerOptions ?? {}),
            anthropic: {
              ...(lastWithOptions.providerOptions?.anthropic ?? {}),
              cacheControl: { type: "ephemeral" },
            },
          },
        } as ModelMessage;
      }

      const result = streamText({
        model,
        messages:    [sysMsg, ...historyMsgs],
        tools,
        stopWhen:    stepCountIs(24),
        abortSignal: controller.signal,
      });

      for await (const part of result.fullStream) {
        if (controller.signal.aborted) break;

        switch (part.type) {
          case "text-delta":
            onEvent({ type: "token", delta: part.text });
            break;

          case "tool-call":
            onEvent({
              type:     "tool-call",
              id:       part.toolCallId,
              toolName: part.toolName,
              args:     (part as { input?: unknown }).input,
            });
            break;

          case "tool-result":
            onEvent({
              type:     "tool-result",
              id:       part.toolCallId,
              toolName: part.toolName,
              result:   (part as { output?: unknown }).output,
            });
            break;

          case "finish-step":
            onEvent({ type: "step-finish" });
            break;

          case "finish": {
            const { inputTokenDetails } = part.totalUsage;
            onEvent({
              type:  "finish",
              usage: {
                inputTokens:         part.totalUsage.inputTokens          ?? 0,
                outputTokens:        part.totalUsage.outputTokens         ?? 0,
                cacheReadTokens:     inputTokenDetails.cacheReadTokens    ?? 0,
                cacheCreationTokens: inputTokenDetails.cacheWriteTokens   ?? 0,
              },
            });
            break;
          }

          case "error":
            onEvent({ type: "error", message: String(part.error) });
            break;
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        onEvent({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  })();

  return { cancel: () => controller.abort() };
}
