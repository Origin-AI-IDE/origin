import type { PendingAction } from "./agent/tools";
import type { ParsedPlan } from "./agent/planTypes";
import type { EditorContext } from "../components/editor/Editor";

export interface ToolCallDisplay {
  id: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete" | "approval-required";
  action?: PendingAction;
  approve?: () => void;
  reject?: () => void;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool-call"; tc: ToolCallDisplay }
  | { type: "plan-card"; plan: ParsedPlan; status: "pending" | "approved" | "rejected" };

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];
  streaming?: boolean;
  sourceFilePath?: string;
  fileMentions?: string[];
  editorContext?: EditorContext | null;
}

export interface PinnedMessage {
  id: string;
  content: string;
  pinnedAt: number;
  sessionId?: string;
  label?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  workspace_path: string;
  updated_at: number;
}

export function appendText(parts: MessagePart[], delta: string): MessagePart[] {
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { type: "text", content: last.content + delta }];
  }
  return [...parts, { type: "text", content: delta }];
}

export function updateTcInParts(parts: MessagePart[], id: string, update: Partial<ToolCallDisplay>): MessagePart[] {
  return parts.map(p =>
    p.type === "tool-call" && p.tc.id === id ? { ...p, tc: { ...p.tc, ...update } } : p
  );
}
