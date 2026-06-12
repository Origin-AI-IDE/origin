import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Non-overridable rule prepended to every request — even when the user has a
// custom system prompt saved. The SEARCH/REPLACE format is load-bearing for
// the diff/apply flow and must not be opt-out.
export const CODE_EDIT_PREFIX =
  `ABSOLUTE RULE — CODE EDITS:\n` +
  `When modifying an existing file, always use SEARCH/REPLACE blocks. Never output the full file. Never use bare fenced snippets for edits.\n` +
  `\n` +
  `Format:\n` +
  `// file: <filename>   ← just the filename (e.g. Button.tsx), always include it\n` +
  `<<<<<<< ORIGINAL\n` +
  `<copy the exact lines that need to change, plus 2–3 lines of context on each side>\n` +
  `=======\n` +
  `<the replacement — can be empty to delete lines>\n` +
  `>>>>>>> UPDATED\n` +
  `\n` +
  `Rules:\n` +
  `• ORIGINAL must be copied verbatim from the file — every space, comma, and newline must match exactly.\n` +
  `• Include only the changed lines plus enough surrounding context to uniquely locate the block.\n` +
  `• One response may contain multiple SEARCH/REPLACE blocks to make several independent changes.\n` +
  `• For brand-new files only: output a plain fenced code block instead (no SEARCH/REPLACE needed).\n` +
  `\n` +
  `Example — rename a variable:\n` +
  `// file: Button.tsx\n` +
  `<<<<<<< ORIGINAL\n` +
  `function handleClick(e: MouseEvent) {\n` +
  `  console.log(e);\n` +
  `=======\n` +
  `function onClick(e: MouseEvent) {\n` +
  `  console.log(e);\n` +
  `>>>>>>> UPDATED`;

export const DEFAULT_SYSTEM_PROMPT =
  `You are Origin AI, a coding assistant embedded in Origin IDE. Be concise and direct — no preamble, no filler, no summaries.\n` +
  `Prefer short targeted answers; use headers and bullets only when the response genuinely needs structure.`;

export interface UsageData {
  inputTokens:  number;
  outputTokens: number;
}

interface StreamChunk {
  token: string;
  done:  boolean;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

let _counter = 0;

export function streamChat(
  providerId: string,
  modelId: string,
  apiKey: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onToken: (token: string) => void,
  onDone: (usage?: UsageData) => void,
  onError: (error: string) => void,
): () => void {
  const streamId = String(++_counter);
  let finished = false;
  let unlisten: (() => void) | null = null;

  listen<StreamChunk>(`ai-stream-${streamId}`, (event) => {
    if (finished) return;
    const { token, done, error, usage } = event.payload;
    if (error) {
      finished = true;
      unlisten?.();
      onError(error);
      return;
    }
    if (token) onToken(token);
    if (done) {
      finished = true;
      unlisten?.();
      const usageData: UsageData | undefined = usage
        ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
        : undefined;
      onDone(usageData);
    }
  }).then((fn) => {
    if (finished) { fn(); return; }
    unlisten = fn;
    invoke("ai_chat_stream", { providerId, modelId, apiKey, messages, systemPrompt, streamId })
      .catch((e: unknown) => {
        if (!finished) {
          finished = true;
          unlisten?.();
          onError(String(e));
        }
      });
  });

  return () => {
    finished = true;
    unlisten?.();
  };
}
