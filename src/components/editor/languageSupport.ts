import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

export function getLanguageExtension(path: string): Extension {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':  return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'js':  return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'rs':  return rust();
    case 'py':  return python();
    case 'css': case 'scss': case 'sass': return css();
    case 'html': return html();
    case 'json': case 'jsonc': return json();
    case 'md': case 'mdx': return markdown();
    default: return [];
  }
}

export function languageLabel(path: string | null): string {
  if (!path || path.startsWith('__untitled__')) return 'Plain Text';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':   return 'TypeScript';
    case 'tsx':  return 'TypeScript JSX';
    case 'js':   return 'JavaScript';
    case 'jsx':  return 'JavaScript JSX';
    case 'rs':   return 'Rust';
    case 'py':   return 'Python';
    case 'css':  return 'CSS';
    case 'scss': return 'SCSS';
    case 'sass': return 'Sass';
    case 'html': return 'HTML';
    case 'json': case 'jsonc': return 'JSON';
    case 'md':   return 'Markdown';
    case 'mdx':  return 'MDX';
    case 'toml': return 'TOML';
    case 'yaml': case 'yml': return 'YAML';
    case 'sh':   case 'bash': return 'Shell Script';
    case 'svg':  return 'SVG';
    default:     return 'Plain Text';
  }
}
