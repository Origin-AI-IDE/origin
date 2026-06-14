import { invoke } from '@tauri-apps/api/core';

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function readDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>('read_dir', { path });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>('write_file', { path, content });
}

export async function renamePath(from: string, to: string): Promise<void> {
  return invoke<void>('rename_path', { from, to });
}

export async function deletePath(path: string): Promise<void> {
  return invoke<void>('delete_path', { path });
}

export async function createDirCmd(path: string): Promise<void> {
  return invoke<void>('create_dir_cmd', { path });
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke<void>('reveal_in_explorer', { path });
}
