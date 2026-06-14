import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

// ── Language detection ────────────────────────────────────────────────────────

export type LspLanguage = 'typescript' | 'rust' | 'python';

export function getLspLanguage(filePath: string): LspLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': return 'typescript';
    case 'rs': return 'rust';
    case 'py': return 'python';
    default: return null;
  }
}

export function getLspLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':  return 'typescript';
    case 'tsx': return 'typescriptreact';
    case 'js':  return 'javascript';
    case 'jsx': return 'javascriptreact';
    case 'rs':  return 'rust';
    case 'py':  return 'python';
    default:    return 'plaintext';
  }
}

export function pathToUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  // Windows: C:/foo → file:///c%3A/foo
  // tsserver normalizes drive-letter colons to %3A internally; matching that format
  // ensures hover/completion/highlight requests can look up open documents correctly.
  if (/^[A-Za-z]:\//.test(normalized)) {
    const drive = normalized[0].toLowerCase();
    const rest  = normalized.slice(2); // strip "C:"
    return `file:///${drive}%3A${rest}`;
  }
  if (normalized.startsWith('/')) return `file://${normalized}`;
  return `file:///${normalized}`;
}

// ── Singleton state ───────────────────────────────────────────────────────────

// Tracks which (language + rootPath) pairs are fully initialized
const initializedKeys = new Set<string>();
// Prevents parallel init of the same language server
const initInProgress = new Map<string, Promise<void>>();
// Tracks open doc URIs and their version numbers
const openDocuments = new Map<string, number>();

function initKey(language: LspLanguage, rootPath: string) {
  return `${language}::${rootPath}`;
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

export async function ensureLspServer(
  language: LspLanguage,
  rootPath: string,
): Promise<void> {
  const key = initKey(language, rootPath);
  if (initializedKeys.has(key)) return;
  if (initInProgress.has(language)) return initInProgress.get(language)!;

  const promise = (async () => {
    await invoke('lsp_start', { language, rootPath });
    await invoke('lsp_request', {
      language,
      method: 'initialize',
      params: buildInitializeParams(rootPath),
    });
    await invoke('lsp_notify', { language, method: 'initialized', params: {} });
    initializedKeys.add(key);
  })().finally(() => initInProgress.delete(language));

  initInProgress.set(language, promise);
  return promise;
}

function buildInitializeParams(rootPath: string) {
  const rootUri = pathToUri(rootPath);
  return {
    processId: null,
    clientInfo: { name: 'Origin IDE', version: '0.1.0' },
    rootUri,
    rootPath,
    capabilities: {
      textDocument: {
        synchronization: { didSave: false, willSave: false, willSaveWaitUntil: false },
        completion: {
          completionItem: {
            snippetSupport: false,
            documentationFormat: ['markdown', 'plaintext'],
          },
          completionItemKind: {
            valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],
          },
          contextSupport: true,
        },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        publishDiagnostics: { relatedInformation: true },
        definition: {},
      },
      workspace: { workspaceFolders: true },
    },
    initializationOptions: {},
  };
}

// ── Document synchronization ──────────────────────────────────────────────────

export async function lspDidOpen(
  language: LspLanguage,
  filePath: string,
  text: string,
): Promise<void> {
  const uri = pathToUri(filePath);
  if (openDocuments.has(uri)) return;
  openDocuments.set(uri, 1);
  await invoke('lsp_notify', {
    language,
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri, languageId: getLspLanguageId(filePath), version: 1, text },
    },
  });
}

export async function lspDidChange(
  language: LspLanguage,
  filePath: string,
  text: string,
): Promise<void> {
  const uri = pathToUri(filePath);
  const version = (openDocuments.get(uri) ?? 0) + 1;
  openDocuments.set(uri, version);
  await invoke('lsp_notify', {
    language,
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    },
  });
}

export async function lspDidClose(
  language: LspLanguage,
  filePath: string,
): Promise<void> {
  const uri = pathToUri(filePath);
  openDocuments.delete(uri);
  await invoke('lsp_notify', {
    language,
    method: 'textDocument/didClose',
    params: { textDocument: { uri } },
  }).catch(() => {});
}

// ── Request helpers ───────────────────────────────────────────────────────────

export async function lspCompletion(
  language: LspLanguage,
  filePath: string,
  line: number,
  character: number,
): Promise<any> {
  return invoke('lsp_request', {
    language,
    method: 'textDocument/completion',
    params: {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
      context: { triggerKind: 1 },
    },
  });
}

export async function lspHoverRequest(
  language: LspLanguage,
  filePath: string,
  line: number,
  character: number,
): Promise<any> {
  return invoke('lsp_request', {
    language,
    method: 'textDocument/hover',
    params: {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
    },
  });
}

export async function lspDefinition(
  language: LspLanguage,
  filePath: string,
  line: number,
  character: number,
): Promise<any> {
  return invoke('lsp_request', {
    language,
    method: 'textDocument/definition',
    params: {
      textDocument: { uri: pathToUri(filePath) },
      position: { line, character },
    },
  });
}

// ── Notification listener ─────────────────────────────────────────────────────

export function onLspNotification(
  language: LspLanguage,
  handler: (msg: any) => void,
): Promise<UnlistenFn> {
  return listen(`lsp-notification-${language}`, (event) => handler(event.payload));
}
