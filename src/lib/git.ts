import { invoke } from '@tauri-apps/api/core';

export async function getBranch(path: string): Promise<string | null> {
  return invoke<string | null>('git_branch', { path });
}

export interface CommitEntry { hash: string; msg: string; }
export interface GitChanges { files: number; commits_ahead: number; log: CommitEntry[]; }

export async function getGitChanges(path: string): Promise<GitChanges | null> {
  try {
    return await invoke<GitChanges | null>('git_changes', { path });
  } catch {
    return null;
  }
}

export interface StatusFile { status: string; path: string; }
export interface FullCommitEntry { hash: string; subject: string; author: string; date: string; }

export async function getStatusFiles(path: string): Promise<StatusFile[]> {
  return invoke<StatusFile[]>('git_status_files', { path }).catch(() => []);
}

export async function getGitLogFull(path: string): Promise<FullCommitEntry[]> {
  return invoke<FullCommitEntry[]>('git_log_full', { path }).catch(() => []);
}

export async function gitCommit(path: string, title: string, description: string): Promise<void> {
  await invoke('git_commit', { path, title, description });
}

export async function gitCommitPush(path: string, title: string, description: string): Promise<void> {
  await invoke('git_commit_push', { path, title, description });
}
