import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserKeybinding {
  key: string;
  command: string;
  when?: string;
}

export interface CommandDef {
  id: string;
  label: string;
  category: string;
  defaultKey: string;
  defaultKeyMac?: string;
}

// ── Default command registry ─────────────────────────────────────────────────

export const COMMANDS: CommandDef[] = [
  // File
  { id: "origin.newFile",        label: "New File",             category: "File",    defaultKey: "ctrl+n" },
  { id: "origin.openFile",       label: "Open File",            category: "File",    defaultKey: "ctrl+o" },
  { id: "origin.save",           label: "Save",                 category: "File",    defaultKey: "ctrl+s" },
  { id: "origin.saveAs",         label: "Save As",              category: "File",    defaultKey: "ctrl+shift+s" },
  { id: "origin.closeTab",       label: "Close Editor",         category: "File",    defaultKey: "ctrl+w" },
  // Edit
  { id: "origin.editorUndo",     label: "Undo",                 category: "Edit",    defaultKey: "ctrl+z" },
  { id: "origin.editorRedo",     label: "Redo",                 category: "Edit",    defaultKey: "ctrl+y" },
  { id: "origin.editorFind",     label: "Find",                 category: "Edit",    defaultKey: "ctrl+f" },
  { id: "origin.editorReplace",  label: "Replace",              category: "Edit",    defaultKey: "ctrl+h" },
  { id: "origin.editorCut",      label: "Cut",                  category: "Edit",    defaultKey: "ctrl+x" },
  { id: "origin.editorCopy",     label: "Copy",                 category: "Edit",    defaultKey: "ctrl+c" },
  { id: "origin.editorPaste",    label: "Paste",                category: "Edit",    defaultKey: "ctrl+v" },
  { id: "origin.editorSelectAll",label: "Select All",           category: "Edit",    defaultKey: "ctrl+a" },
  // View
  { id: "origin.togglePalette",  label: "Command Palette",      category: "View",    defaultKey: "ctrl+p" },
  { id: "origin.toggleSidebar",  label: "Toggle Sidebar",       category: "View",    defaultKey: "ctrl+b" },
  { id: "origin.toggleTerminal", label: "Toggle Terminal",      category: "View",    defaultKey: "ctrl+`" },
  { id: "origin.toggleSettings", label: "Open Settings",        category: "View",    defaultKey: "ctrl+," },
  { id: "origin.toggleFullscreen",label: "Toggle Full Screen",  category: "View",    defaultKey: "f11" },
  { id: "origin.zoomIn",         label: "Zoom In",              category: "View",    defaultKey: "ctrl+=" },
  { id: "origin.zoomOut",        label: "Zoom Out",             category: "View",    defaultKey: "ctrl+-" },
  { id: "origin.zoomReset",      label: "Reset Zoom",           category: "View",    defaultKey: "ctrl+0" },
  // Debug
  { id: "origin.startDebug",     label: "Start Debugging",      category: "Debug",   defaultKey: "f5" },
  { id: "origin.stopDebug",      label: "Stop Debugging",       category: "Debug",   defaultKey: "shift+f5" },
  { id: "origin.stepOver",       label: "Step Over",            category: "Debug",   defaultKey: "f10" },
  { id: "origin.stepInto",       label: "Step Into",            category: "Debug",   defaultKey: "f11" },
  { id: "origin.stepOut",        label: "Step Out",             category: "Debug",   defaultKey: "shift+f11" },
  { id: "origin.toggleBreakpoint",label: "Toggle Breakpoint",  category: "Debug",   defaultKey: "f9" },
];

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "origin-keybindings";

export function loadKeybindings(): UserKeybinding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserKeybinding[]) : [];
  } catch {
    return [];
  }
}

export function saveKeybindings(bindings: UserKeybinding[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function resetKeybindings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Returns effective key for a command: user override → default. */
export function getEffectiveKey(commandId: string): string | null {
  const user = loadKeybindings();
  const override = user.find(b => b.command === commandId);
  if (override) return override.key;
  return COMMANDS.find(c => c.id === commandId)?.defaultKey ?? null;
}

/** Full map of commandId → effective key (used by the global listener). */
export function getCommandKeyMap(): Record<string, string> {
  const user = loadKeybindings();
  const map: Record<string, string> = {};
  for (const cmd of COMMANDS) {
    map[cmd.id] = cmd.defaultKey;
  }
  for (const b of user) {
    if (b.command) map[b.command] = b.key;
  }
  return map;
}

/** Rebind a single command. Pass null key to remove the override. */
export function setKeybinding(commandId: string, key: string | null): void {
  const bindings = loadKeybindings().filter(b => b.command !== commandId);
  if (key !== null) bindings.push({ command: commandId, key });
  saveKeybindings(bindings);
}

// ── Key matching ─────────────────────────────────────────────────────────────

interface ParsedKey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseKey(keyStr: string): ParsedKey {
  const parts = keyStr.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  return {
    ctrl:  parts.includes("ctrl") || parts.includes("cmd"),
    shift: parts.includes("shift"),
    alt:   parts.includes("alt"),
    key,
  };
}

export function matchesEvent(e: KeyboardEvent, keyStr: string): boolean {
  const { ctrl, shift, alt, key } = parseKey(keyStr);
  // Normalise e.key → lowercase single token
  const eKey = e.key === "`" ? "`"
    : e.key === "=" ? "="
    : e.key === "-" ? "-"
    : e.key === "0" ? "0"
    : e.key === "," ? ","
    : e.key.toLowerCase();

  return (
    (e.ctrlKey || e.metaKey) === ctrl &&
    e.shiftKey === shift &&
    e.altKey === alt &&
    eKey === key
  );
}

// ── VS Code / Cursor / Windsurf import ───────────────────────────────────────

// Maps VS Code command IDs → Origin command IDs
const VSCODE_CMD_MAP: Record<string, string> = {
  "workbench.action.files.newUntitledFile":    "origin.newFile",
  "workbench.action.files.openFile":           "origin.openFile",
  "workbench.action.files.save":               "origin.save",
  "workbench.action.files.saveAs":             "origin.saveAs",
  "workbench.action.closeActiveEditor":        "origin.closeTab",
  "undo":                                       "origin.editorUndo",
  "redo":                                       "origin.editorRedo",
  "actions.find":                               "origin.editorFind",
  "editor.action.startFindReplaceAction":      "origin.editorReplace",
  "editor.action.clipboardCutAction":          "origin.editorCut",
  "editor.action.clipboardCopyAction":         "origin.editorCopy",
  "editor.action.clipboardPasteAction":        "origin.editorPaste",
  "editor.action.selectAll":                   "origin.editorSelectAll",
  "workbench.action.quickOpen":                "origin.togglePalette",
  "workbench.action.showCommands":             "origin.togglePalette",
  "workbench.action.toggleSidebarVisibility":  "origin.toggleSidebar",
  "workbench.action.terminal.toggleTerminal":  "origin.toggleTerminal",
  "workbench.action.openSettings":             "origin.toggleSettings",
  "workbench.action.toggleFullScreen":         "origin.toggleFullscreen",
  "workbench.action.zoomIn":                   "origin.zoomIn",
  "workbench.action.zoomOut":                  "origin.zoomOut",
  "workbench.action.zoomReset":                "origin.zoomReset",
  "workbench.action.debug.start":              "origin.startDebug",
  "workbench.action.debug.run":                "origin.startDebug",
  "workbench.action.debug.stop":               "origin.stopDebug",
  "workbench.action.debug.stepOver":           "origin.stepOver",
  "workbench.action.debug.stepInto":           "origin.stepInto",
  "workbench.action.debug.stepOut":            "origin.stepOut",
  "editor.debug.action.toggleBreakpoint":      "origin.toggleBreakpoint",
};

interface ImportResult {
  imported: number;
  bindings: UserKeybinding[];
}

function stripJsonComments(raw: string): string {
  // Very simple single-line comment stripper for keybindings.json
  return raw.replace(/\/\/[^\n]*/g, "");
}

export function parseEditorKeybindings(json: string): ImportResult {
  try {
    const items = JSON.parse(stripJsonComments(json));
    if (!Array.isArray(items)) return { imported: 0, bindings: [] };
    const bindings: UserKeybinding[] = [];
    for (const item of items) {
      if (typeof item.key !== "string" || typeof item.command !== "string") continue;
      // Skip negation entries (command starting with -)
      if (item.command.startsWith("-")) continue;
      const originCmd = VSCODE_CMD_MAP[item.command];
      if (originCmd) {
        bindings.push({
          key: item.key.toLowerCase(),
          command: originCmd,
          ...(item.when ? { when: item.when } : {}),
        });
      }
    }
    return { imported: bindings.length, bindings };
  } catch {
    return { imported: 0, bindings: [] };
  }
}

// ── Tauri wrappers ───────────────────────────────────────────────────────────

export async function detectInstalledEditors(): Promise<string[]> {
  return invoke<string[]>("detect_installed_editors");
}

export async function importKeybindingsFromEditor(editorId: string): Promise<ImportResult> {
  const json = await invoke<string>("read_editor_keybindings", { editor: editorId });
  return parseEditorKeybindings(json);
}

/**
 * Import keybindings from an editor, merge with existing user overrides,
 * and persist. Returns the number of commands that were mapped.
 */
export async function applyKeybindingsFromEditor(editorId: string): Promise<number> {
  const { imported, bindings } = await importKeybindingsFromEditor(editorId);
  if (imported === 0) return 0;
  // Merge: editor import wins over current user overrides for matching commands
  const existing = loadKeybindings().filter(
    b => !bindings.some(nb => nb.command === b.command)
  );
  saveKeybindings([...existing, ...bindings]);
  return imported;
}
