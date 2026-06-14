import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { resolvePath } from "../resolvePath";
import { applyEdit } from "../applyEdit";

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
        // Read the current file so the diff can show what changes
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

  } as const;
}

// ── Read-only tool subset (used by Plan mode Phase 1) ─────────────────────────

export function createReadOnlyTools(opts: { folderPath: string }) {
  const all = createTools({ folderPath: opts.folderPath, onApproval: () => {} });
  return { read_file: all.read_file, list_directory: all.list_directory, grep: all.grep, glob: all.glob };
}

