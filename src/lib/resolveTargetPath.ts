export function resolveTargetPath(
  llmFilePath: string | undefined,
  messageMentions: string[] | undefined,
  sourceFilePath: string | undefined,
  folderPath: string,
  openTabPaths: string[],
): string | undefined {
  void folderPath;
  const normLlm = llmFilePath ? llmFilePath.replace(/\\/g, "/").toLowerCase() : undefined;

  if (normLlm && messageMentions && messageMentions.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    const byLongestSuffix = messageMentions
      .map(p => ({ p, norm: p.replace(/\\/g, "/").toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (byLongestSuffix.length > 0) return byLongestSuffix[0].p;

    const byBasename = messageMentions.filter(p =>
      (p.split(/[/\\]/).pop() ?? "").toLowerCase() === name
    );
    if (byBasename.length === 1) return byBasename[0];
    if (byBasename.length > 1) {
      return byBasename.find(p => p === sourceFilePath) ?? byBasename[0];
    }
  }

  if (!normLlm && messageMentions?.length === 1) return messageMentions[0];
  if (messageMentions?.length === 1) return messageMentions[0];

  if (normLlm && openTabPaths.length > 0) {
    const name = llmFilePath!.split(/[/\\]/).pop()!.toLowerCase();
    const bySuffix = openTabPaths
      .map(p => ({ p, norm: p.replace(/\\/g, "/").toLowerCase() }))
      .filter(({ norm }) => norm.endsWith(normLlm))
      .sort((a, b) => b.p.length - a.p.length);
    if (bySuffix.length > 0) return bySuffix[0].p;

    const byBasename = openTabPaths.filter(p =>
      (p.split(/[/\\]/).pop() ?? "").toLowerCase() === name
    );
    if (byBasename.length >= 1) {
      return byBasename.find(p => p === sourceFilePath) ?? byBasename[0];
    }
  }

  if (sourceFilePath) return sourceFilePath;
  return undefined;
}
