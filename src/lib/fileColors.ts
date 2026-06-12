export function fileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': case 'tsx': return '#3b82f6';
    case 'js': case 'jsx': return '#eab308';
    case 'json': return '#f97316';
    case 'css': case 'scss': case 'sass': return '#06b6d4';
    case 'html': return '#f43f5e';
    case 'md': case 'mdx': return '#a1a1a1';
    case 'rs': return '#fb923c';
    case 'py': return '#60a5fa';
    case 'go': return '#34d399';
    case 'svg': return '#c084fc';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': return '#c084fc';
    case 'toml': case 'yaml': case 'yml': return '#a78bfa';
    case 'sh': case 'bash': return '#4ade80';
    default: return '#a1a1a1';
  }
}
