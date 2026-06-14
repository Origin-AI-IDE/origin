import { parsePlan } from "./agent/planTypes";
import {
  initDb,
  loadMessages,
  type DbMessage,
  type DbSession,
} from "./db";
import type { DisplayMessage, MessagePart, SessionMeta, ToolCallDisplay } from "./aiTypes";
import type { EditorContext } from "../components/editor/Editor";

export const LS_SESSIONS_KEY = "origin-sessions-v1";

export function activeSessionKey(folderPath: string): string {
  return `origin-active-session:${folderPath}`;
}

export function lsRead(): SessionMeta[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS_KEY) ?? "[]"); }
  catch { return []; }
}

export function lsPush(meta: SessionMeta): void {
  const all = lsRead().filter(s => s.id !== meta.id);
  all.unshift(meta);
  localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(all.slice(0, 100)));
}

export function lsTouch(id: string): void {
  const all = lsRead();
  const idx = all.findIndex(s => s.id === id);
  if (idx >= 0) {
    all[idx].updated_at = Date.now();
    all.unshift(...all.splice(idx, 1));
    localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(all.slice(0, 100)));
  }
}

export function lsDelete(id: string): void {
  localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(lsRead().filter(s => s.id !== id)));
}

export function lsForPath(workspacePath: string): DbSession[] {
  return lsRead()
    .filter(s => s.workspace_path === workspacePath)
    .map(s => ({
      id: s.id, title: s.title, workspace_path: s.workspace_path,
      active_model: "", active_provider: "",
      created_at: s.updated_at, updated_at: s.updated_at,
    }));
}

export async function restoreSession(sessionId: string): Promise<DisplayMessage[]> {
  await initDb();
  const msgs = await loadMessages(sessionId);
  return dbMsgsToDisplay(msgs);
}

export function dbMsgsToDisplay(msgs: DbMessage[]): DisplayMessage[] {
  const filtered = msgs.filter(m => m.message_type === "user" || m.message_type === "assistant");
  let lastUserSingleMention: string | undefined;
  return filtered.map(m => {
    const interrupted = m.status === "interrupted";
    let content = interrupted
      ? m.content ? m.content + "\n\n[Response interrupted]" : "[Response interrupted]"
      : m.content;
    const fileMentions = m.attachments_json
      ? (JSON.parse(m.attachments_json) as string[])
      : undefined;
    if (m.message_type === "user") {
      lastUserSingleMention = fileMentions?.length === 1 ? fileMentions[0] : undefined;
    }
    // Restore interleaved parts from DB. Two formats:
    // - New: array of MessagePart ({ type: "text"|"tool-call", ... })
    // - Old: array of ToolCallDisplay (no type field) — converted to tool-call parts
    let restoredParts: MessagePart[] | undefined;
    if (m.tool_calls_json) {
      try {
        const raw = JSON.parse(m.tool_calls_json) as Record<string, unknown>[];
        if (raw.length > 0) {
          if ("type" in raw[0]) {
            restoredParts = raw.map(p =>
              (p.type === "tool-call" && p.tc)
                ? { type: "tool-call" as const, tc: { ...(p.tc as ToolCallDisplay), status: "complete" as const, approve: undefined, reject: undefined } }
                : { type: "text" as const, content: String((p as { content?: unknown }).content ?? "") }
            );
          } else {
            restoredParts = raw.map(tc => ({
              type: "tool-call" as const,
              tc: { ...(tc as unknown as ToolCallDisplay), status: "complete" as const, approve: undefined, reject: undefined },
            }));
          }
        }
      } catch { /* malformed JSON — ignore */ }
    }

    // Re-derive plan-card from raw XML stored in content; strip it from parts too.
    let planPart: MessagePart | undefined;
    if (m.message_type === "assistant" && !interrupted) {
      const plan = parsePlan(content);
      if (plan) {
        content = content.replace(plan.rawXml, "").trimEnd();
        planPart = { type: "plan-card", plan, status: "rejected" };
        if (restoredParts) {
          restoredParts = restoredParts
            .map(p => p.type === "text"
              ? { ...p, content: p.content.replace(plan.rawXml, "").trimEnd() }
              : p)
            .filter(p => p.type !== "text" || p.content.trim() !== "");
        }
      }
    }

    const finalParts = planPart
      ? [...(restoredParts ?? []), planPart]
      : restoredParts;

    return {
      role: m.message_type as "user" | "assistant",
      content,
      parts: finalParts && finalParts.length > 0 ? finalParts : undefined,
      sourceFilePath: m.message_type === "assistant" ? lastUserSingleMention : undefined,
      fileMentions,
      editorContext: m.editor_context_json
        ? { ...(JSON.parse(m.editor_context_json) as object), code: "", language: "" } as EditorContext
        : undefined,
    };
  });
}
