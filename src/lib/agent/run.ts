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
  onEvent:      (event: AgentEvent) => void;
}

export function runAgent(options: RunAgentOptions): { cancel: () => void } {
  const { model, messages, tools, systemPrompt, onEvent } = options;
  const controller = new AbortController();

  (async () => {
    try {
      const result = streamText({
        model,
        system:      systemPrompt,
        messages,
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

          case "finish":
            onEvent({
              type:  "finish",
              usage: {
                inputTokens:  part.totalUsage.inputTokens  ?? 0,
                outputTokens: part.totalUsage.outputTokens ?? 0,
              },
            });
            break;

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
