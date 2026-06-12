import { invoke } from '@tauri-apps/api/core';

export interface SearchMatch {
  path: string;
  line: number;
  col: number;
  text: string;
}

export async function searchInFiles(folder: string, query: string): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>('search_in_files', { folder, query });
}

