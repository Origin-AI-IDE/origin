export function applyEdit(fileContent: string, original: string, updated: string): string | null {
  const idx = fileContent.indexOf(original);
  if (idx !== -1) {
    return fileContent.slice(0, idx) + updated + fileContent.slice(idx + original.length);
  }
  const trimmed = original.trim();
  const tidx = fileContent.indexOf(trimmed);
  if (tidx !== -1) {
    return fileContent.slice(0, tidx) + updated + fileContent.slice(tidx + trimmed.length);
  }
  return null;
}
