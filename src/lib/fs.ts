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
