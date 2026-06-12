import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function terminalCreate(cwd: string, cols: number, rows: number): Promise<number> {
  return invoke("terminal_create", { cwd, cols, rows });
}

export function terminalWrite(id: number, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export function terminalResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke("terminal_resize", { id, cols, rows });
}

export function terminalClose(id: number): Promise<void> {
  return invoke("terminal_close", { id });
}

export async function onTerminalOutput(
  id: number,
  cb: (data: string) => void,
): Promise<() => void> {
  return listen<string>(`terminal-output-${id}`, (event) => cb(event.payload));
}

export async function onTerminalExit(id: number, cb: () => void): Promise<() => void> {
  return listen(`terminal-exit-${id}`, () => cb());
}
