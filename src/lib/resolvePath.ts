function normalizePath(full: string, sep: string): string {
  let prefix = '';
  let body = full;

  if (/^[A-Za-z]:/.test(full)) {
    prefix = full.slice(0, 2);
    body = full.slice(2);
  } else if (full.startsWith('\\\\')) {
    const m = full.match(/^\\\\[^\\/]+[\\/][^\\/]*/);
    prefix = m ? m[0] : '\\\\';
    body = full.slice(prefix.length);
  }

  const stack: string[] = [];
  for (const seg of body.split(/[/\\]/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }

  return prefix + sep + stack.join(sep);
}

export function resolvePath(p: string, base: string): string {
  const trimmed = p.trim();
  const root = base.replace(/[/\\]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';

  const isAbsolute =
    /^[A-Za-z]:[/\\]/.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\\\');

  const raw = isAbsolute ? trimmed : root + sep + trimmed.replace(/[/\\]/g, sep);
  const resolved = normalizePath(raw, sep);
  const normalRoot = normalizePath(root, sep);

  const ci = sep === '\\';
  const lo = (s: string) => (ci ? s.toLowerCase() : s);

  if (!lo(resolved).startsWith(lo(normalRoot) + sep) && lo(resolved) !== lo(normalRoot)) {
    throw new Error(`Path escapes workspace: "${p}"`);
  }

  return resolved;
}
