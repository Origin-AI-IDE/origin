import { invoke } from '@tauri-apps/api/core';

export interface MemoryInfo { used_gb: number; total_gb: number; }

export async function getMemory(): Promise<MemoryInfo | null> {
  try {
    return await invoke<MemoryInfo | null>('sys_memory');
  } catch {
    return null;
  }
}
