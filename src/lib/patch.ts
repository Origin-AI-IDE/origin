import { invoke } from "@tauri-apps/api/core";

export interface PatchOptions {
  ignore_trailing_ws: boolean;
  min_confidence: number;
  max_file_bytes: number;
}

export const DEFAULT_PATCH_OPTIONS: PatchOptions = {
  ignore_trailing_ws: true,
  min_confidence: 0.5,
  max_file_bytes: 5 * 1024 * 1024,
};

export interface DiffLine {
  kind: "added" | "unchanged";
  new_line: number;
  old_line: number | null;
}

export interface DeletionBlock {
  after_new_line: number;
  old_from_line: number;
  old_to_line: number;
  lines: string[];
}

export interface DiffModel {
  new_line_count: number;
  lines: DiffLine[];
  deletions: DeletionBlock[];
}

export interface Candidate {
  start_line: number;
  end_line: number;
  score: number;
}

export interface Placement {
  strategy: string;
  start_line: number;
  end_line: number;
  candidates: Candidate[];
}

export type PatchOutcome = "Applied" | "Ambiguous" | "NotFound" | "NoOp" | "Rejected";

export interface PatchResult {
  outcome: PatchOutcome;
  merged_content: string | null;
  diff: DiffModel | null;
  placement: Placement | null;
  confidence: number;
  message: string;
}

export function patchApplySnippet(
  original_content: string,
  snippet: string,
  file_path: string,
  language?: string,
  line_hint?: number,
  options: PatchOptions = DEFAULT_PATCH_OPTIONS,
): Promise<PatchResult> {
  return invoke("patch_apply_snippet", {
    req: { original_content, snippet, file_path, language: language ?? null, line_hint: line_hint ?? null, options },
  });
}

export function patchReplaceRegion(
  original_content: string,
  snippet: string,
  from_line: number,
  to_line: number,
  options: PatchOptions = DEFAULT_PATCH_OPTIONS,
): Promise<PatchResult> {
  return invoke("patch_replace_region", {
    req: { original_content, snippet, from_line, to_line, options },
  });
}

export function patchDeleteRegion(
  original_content: string,
  from_line: number,
  to_line: number,
  options: PatchOptions = DEFAULT_PATCH_OPTIONS,
): Promise<PatchResult> {
  return invoke("patch_delete_region", {
    req: { original_content, from_line, to_line, options },
  });
}
