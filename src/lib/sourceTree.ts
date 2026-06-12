import { invoke } from '@tauri-apps/api/core';

export interface FileTreeNode {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  children: FileTreeNode[];
}

export interface ImportEdge {
  from: string;
  to: string;
}

export const getFileTree  = (folder: string) => invoke<FileTreeNode>('get_file_tree', { folder });
export const getImportEdges = (folder: string) => invoke<ImportEdge[]>('get_import_edges', { folder });
