import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { resolvePath } from "../resolvePath";
import { applyEdit } from "../applyEdit";
import { checkPath } from "./security";

// ── Todo scratchpad ────────────────────────────────────────────────────────────
//
// In-memory, per-session task list the agent maintains across a multi-step
// run. Keyed by session ID; not persisted to disk.

export interface TodoItem {
  id:      string;                              // short unique id, e.g. "t1", "t2"
  content: string;                              // description of the task
  status:  "pending" | "in_progress" | "done";
}

const todoStore = new Map<string, TodoItem[]>();

// ── Pending action descriptors ─────────────────────────────────────────────────

export type PendingAction =
  | { type: "write_file"; path: string; content: string; originalContent: string }
  | { type: "edit";       path: string; original: string; updated: string; mergedContent: string; originalContent: string }
  | { type: "bash_run";   command: string; cwd: string };

export interface ApprovalEvent {
  id:      string;
  action:  PendingAction;
  approve: () => void;
  reject:  () => void;
}

// ── Tool factory ───────────────────────────────────────────────────────────────

export function createTools(opts: {
  folderPath:  string;
  onApproval:  (event: ApprovalEvent) => void;
}) {
  const { folderPath, onApproval } = opts;

  return {

    read_file: tool({
      description:
        `Read the full contents of a file. Workspace root: ${folderPath}. ` +
        "Use absolute paths or paths relative to the workspace root (e.g. src/foo.ts).",
      inputSchema: z.object({
        path: z.string().describe("Absolute or workspace-relative path to the file"),
      }),
      execute: async ({ path }) => {
        const resolved = resolvePath(path, folderPath);
        const guard = checkPath(resolved, "read");
        if (!guard.ok) return { error: guard.reason };
        try {
          const content = await invoke<string>("read_file", { path: resolved, workspaceRoot: folderPath });
          return { content };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    list_directory: tool({
      description:
        `List files and subdirectories at a path. Workspace root: ${folderPath}.`,
      inputSchema: z.object({
        path: z.string().describe("Absolute or workspace-relative path to the directory"),
      }),
      execute: async ({ path }) => {
        const resolved = resolvePath(path, folderPath);
        const guard = checkPath(resolved, "read");
        if (!guard.ok) return { error: guard.reason };
        try {
          const entries = await invoke<{ name: string; path: string; is_dir: boolean }[]>(
            "read_dir", { path: resolved }
          );
          return { entries };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    grep: tool({
      description: "Search for a text pattern across all files in the workspace.",
      inputSchema: z.object({
        query:  z.string().describe("Case-insensitive search query"),
        folder: z.string().optional().describe("Folder to search (defaults to workspace root)"),
      }),
      execute: async ({ query, folder }) => {
        const resolved = folder ? resolvePath(folder, folderPath) : folderPath;
        try {
          const results = await invoke<{ path: string; line: number; col: number; text: string }[]>(
            "search_in_files", { folder: resolved, query }
          );
          return { results };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    glob: tool({
      description: "List all files in the workspace (up to 2000).",
      inputSchema: z.object({
        folder: z.string().optional().describe("Folder to list (defaults to workspace root)"),
      }),
      execute: async ({ folder }) => {
        const resolved = folder ? resolvePath(folder, folderPath) : folderPath;
        try {
          const files = await invoke<{ name: string; path: string; ext: string }[]>(
            "list_workspace_files", { folder: resolved }
          );
          return { files };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    write_file: tool({
      description:
        "Write content to a file (create or overwrite). Requires user approval. " +
        "Parent directories are created automatically.",
      inputSchema: z.object({
        path:    z.string().describe("Absolute or workspace-relative path to write"),
        content: z.string().describe("Full file content to write"),
      }),
      execute: async ({ path, content }, { toolCallId }) => {
        const resolved = resolvePath(path, folderPath);
        const guard = checkPath(resolved, "write");
        if (!guard.ok) return { error: guard.reason };
        let originalContent = "";
        try {
          originalContent = await invoke<string>("read_file", { path: resolved, workspaceRoot: folderPath });
        } catch {
          // New file — original is empty
        }
        return new Promise((resolve) => {
          onApproval({
            id: toolCallId,
            action: { type: "write_file", path: resolved, content, originalContent },
            approve: async () => {
              try {
                await invoke("write_file", { path: resolved, content, workspaceRoot: folderPath });
                resolve({ success: true, path: resolved });
              } catch (e) {
                resolve({ error: String(e) });
              }
            },
            reject: () => resolve({ cancelled: true }),
          });
        });
      },
    }),

    edit: tool({
      description:
        "Edit an existing file using search/replace. " +
        "`original` must match the current file content exactly (including whitespace). " +
        "Requires user approval — the diff will be shown before applying.",
      inputSchema: z.object({
        path:     z.string().describe("Absolute or workspace-relative path to the file"),
        original: z.string().describe("Exact text to find (verbatim)"),
        updated:  z.string().describe("Replacement text"),
      }),
      execute: async ({ path, original, updated }, { toolCallId }) => {
        const resolved = resolvePath(path, folderPath);
        const guard = checkPath(resolved, "write");
        if (!guard.ok) return { error: guard.reason };
        let fileContent: string;
        try {
          fileContent = await invoke<string>("read_file", { path: resolved, workspaceRoot: folderPath });
        } catch (e) {
          return { error: `Cannot read file: ${String(e)}` };
        }

        const mergedContent = applyEdit(fileContent, original, updated);
        if (mergedContent === null) {
          return { error: "ORIGINAL text not found in file — no edit applied." };
        }

        return new Promise((resolve) => {
          onApproval({
            id: toolCallId,
            action: { type: "edit", path: resolved, original, updated, mergedContent, originalContent: fileContent },
            approve: async () => {
              try {
                await invoke("write_file", { path: resolved, content: mergedContent, workspaceRoot: folderPath });
                resolve({ success: true, path: resolved });
              } catch (e) {
                resolve({ error: String(e) });
              }
            },
            reject: () => resolve({ cancelled: true }),
          });
        });
      },
    }),

    bash_run: tool({
      description: "Run a shell command. Requires user approval.",
      inputSchema: z.object({
        command: z.string().describe("Command to execute"),
        cwd:     z.string().optional().describe("Working directory (defaults to workspace root)"),
      }),
      execute: async ({ command, cwd }, { toolCallId }) => {
        const guard = checkPath(command, "exec");
        if (!guard.ok) return { error: guard.reason };
        const resolvedCwd = cwd ? resolvePath(cwd, folderPath) : folderPath;
        return new Promise((resolve) => {
          onApproval({
            id: toolCallId,
            action: { type: "bash_run", command, cwd: resolvedCwd },
            approve: async () => {
              try {
                const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>(
                  "agent_bash_run", { command, cwd: resolvedCwd }
                );
                resolve(result);
              } catch (e) {
                resolve({ error: String(e) });
              }
            },
            reject: () => resolve({ cancelled: true }),
          });
        });
      },
    }),

    todo_write: tool({
      description:
        "Replace the persistent task list for this agent session. Use for any " +
        "non-trivial multi-step task: keep exactly one item `in_progress` and " +
        "flip items to `done` as you finish them. Always pass the FULL list — " +
        "it overwrites the previous one. Auto-executes (no approval).",
      inputSchema: z.object({
        sessionId: z.string().describe("Stable id for this agent session"),
        todos: z.array(
          z.object({
            id:      z.string().describe("Short unique id, e.g. \"t1\", \"t2\""),
            content: z.string().describe("Description of the task"),
            status:  z.enum(["pending", "in_progress", "done"]),
          }),
        ).describe("The complete task list for this session"),
      }),
      execute: async ({ sessionId, todos }) => {
        const items: TodoItem[] = todos.map((t) => ({
          id: t.id, content: t.content, status: t.status,
        }));
        todoStore.set(sessionId, items);
        return { ok: true, count: items.length };
      },
    }),

    todo_read: tool({
      description:
        "Read the persistent task list for this agent session. Returns an " +
        "empty list if nothing has been written yet. Auto-executes (no approval).",
      inputSchema: z.object({
        sessionId: z.string().describe("Stable id for this agent session"),
      }),
      execute: async ({ sessionId }) => {
        return { todos: todoStore.get(sessionId) ?? [] };
      },
    }),

  } as const;
}

// ── Read-only tool subset (used by Plan mode Phase 1) ─────────────────────────

export function createReadOnlyTools(opts: { folderPath: string }) {
  const all = createTools({ folderPath: opts.folderPath, onApproval: () => {} });
  return {
    read_file:      all.read_file,
    list_directory: all.list_directory,
    grep:           all.grep,
    glob:           all.glob,
    todo_read:      all.todo_read,
  };
}

// ── Ask mode tools (edit-only, no disk write — diff view handles write-back) ──

// Resolve a (possibly short) AI-provided path to { fullPath, content }.
// Open editor files take priority — matched by suffix so the AI can pass
// just "layout.tsx" or "app/layout.tsx" and still hit the right open buffer.
// Falls back to a disk read only when the file is not open.
async function resolveFileContent(
  aiPath: string,
  folderPath: string,
  getFileContents: () => Record<string, string>,
): Promise<{ fullPath: string; content: string } | { error: string }> {
  const norm = aiPath.replace(/\\/g, "/");
  const openContents = getFileContents();
  for (const [fullPath, content] of Object.entries(openContents)) {
    const normFull = fullPath.replace(/\\/g, "/");
    if (normFull === norm || normFull.endsWith("/" + norm)) {
      return { fullPath, content };
    }
  }
  // Not open — read from disk
  try {
    const resolved = resolvePath(aiPath, folderPath);
    const content = await invoke<string>("read_file", { path: resolved, workspaceRoot: folderPath });
    return { fullPath: resolved, content };
  } catch (e) {
    return { error: `Cannot read file "${aiPath}": ${String(e)}` };
  }
}

export function createAskTools(opts: {
  folderPath: string;
  getFileContents: () => Record<string, string>;
  onShowDiff: (path: string, original: string, patched: string) => void;
}) {
  const { folderPath, getFileContents, onShowDiff } = opts;

  return {
    edit: tool({
      description:
        "Replace an exact string in a file and open a per-hunk diff for the user to review. " +
        "old_string must match the file verbatim (including whitespace) and be unique — " +
        "include 3–5 lines of surrounding context to guarantee uniqueness.",
      inputSchema: z.object({
        path:       z.string().describe("Workspace-relative path to the file (e.g. src/foo.ts)"),
        old_string: z.string().describe("Exact text to replace — verbatim, must be unique in the file"),
        new_string: z.string().describe("Replacement text"),
      }),
      execute: async ({ path, old_string, new_string }) => {
        const resolved = await resolveFileContent(path, folderPath, getFileContents);
        if ("error" in resolved) return { error: resolved.error };
        const patched = applyEdit(resolved.content, old_string, new_string);
        if (patched === null) return { error: "old_string not found in file — add more context lines to make it unique." };
        onShowDiff(resolved.fullPath, resolved.content, patched);
        return { ok: true };
      },
    }),

    multi_edit: tool({
      description:
        "Apply multiple search/replace edits to a single file atomically, then open a diff for review. " +
        "Edits are applied in order; each old_string is matched against the content after previous edits.",
      inputSchema: z.object({
        path:  z.string().describe("Workspace-relative path to the file"),
        edits: z.array(z.object({
          old_string: z.string().describe("Exact text to replace (verbatim, must be unique)"),
          new_string: z.string().describe("Replacement text"),
        })).describe("Ordered list of replacements to apply"),
      }),
      execute: async ({ path, edits }) => {
        const resolved = await resolveFileContent(path, folderPath, getFileContents);
        if ("error" in resolved) return { error: resolved.error };
        let content = resolved.content;
        for (const e of edits) {
          const result = applyEdit(content, e.old_string, e.new_string);
          if (result === null) return { error: `old_string not found: "${e.old_string.slice(0, 60)}…"` };
          content = result;
        }
        onShowDiff(resolved.fullPath, resolved.content, content);
        return { ok: true };
      },
    }),
  } as const;
}
