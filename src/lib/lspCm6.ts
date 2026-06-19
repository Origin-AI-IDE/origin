/* eslint-disable @typescript-eslint/no-explicit-any -- LSP JSON-RPC payloads are protocol-defined, untyped JSON */
import { linter, lintGutter } from '@codemirror/lint';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { LanguageServerClient, languageServerWithTransport } from 'codemirror-languageserver';
import type { Transport } from 'codemirror-languageserver';
import { getLspLanguage, getLspLanguageId, pathToUri, type LspLanguage } from './lsp';

// ── Tauri IPC Transport ───────────────────────────────────────────────────────
// Routes codemirror-languageserver JSON-RPC messages through the existing
// lsp_request / lsp_notify Tauri commands + lsp-notification-{lang} events.

class TauriLspTransport implements Transport {
  private messageCallbacks: ((msg: string) => void)[] = [];
  private closeCallbacks: (() => void)[] = [];
  private errorCallbacks: ((err: Error) => void)[] = [];
  private unlisten: UnlistenFn | null = null;

  constructor(private language: LspLanguage) {
    listen(`lsp-notification-${language}`, (event) => {
      const payload = event.payload as any;
      const msg = JSON.stringify(payload);
      this.messageCallbacks.forEach(cb => cb(msg));
    }).then(fn => { this.unlisten = fn; });
  }

  send(message: string): void {
    let parsed: any;
    try { parsed = JSON.parse(message); } catch { return; }

    if (parsed.id !== undefined && parsed.method) {
      // Inject capabilities the package omits but typescript-language-server 5.x
      // requires before it will push textDocument/publishDiagnostics notifications.
      if (parsed.method === 'initialize' && parsed.params?.capabilities) {
        parsed.params.capabilities.textDocument = {
          ...parsed.params.capabilities.textDocument,
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: false,
            tagSupport: { valueSet: [1, 2] },
          },
        };
        parsed.params.capabilities.workspace = {
          ...parsed.params.capabilities.workspace,
          configuration: true,
        };
      }
      // JSON-RPC request: route through lsp_request, deliver response via onMessage.
      // Rust returns the full server response object; spread it and restore our original
      // id so the package can match it — avoids double-wrapping the result field.
      invoke('lsp_request', {
        language: this.language,
        method: parsed.method,
        params: parsed.params ?? {},
      }).then((rawMsg: any) => {
        const resp = JSON.stringify({ ...rawMsg, id: parsed.id });
        this.messageCallbacks.forEach(cb => cb(resp));
      }).catch((err: any) => {
        const errResp = JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32603, message: String(err) },
        });
        this.messageCallbacks.forEach(cb => cb(errResp));
      });
    } else if (parsed.method) {
      // JSON-RPC notification: fire and forget
      invoke('lsp_notify', {
        language: this.language,
        method: parsed.method,
        params: parsed.params ?? {},
      }).catch(() => {});
    }
  }

  onMessage(callback: (msg: string) => void): void { this.messageCallbacks.push(callback); }
  onClose(callback: () => void): void           { this.closeCallbacks.push(callback); }
  onError(callback: (err: Error) => void): void  { this.errorCallbacks.push(callback); }

  close(): void {
    this.unlisten?.();
    this.closeCallbacks.forEach(cb => cb());
  }
}

// ── Install commands ──────────────────────────────────────────────────────────

const INSTALL_COMMANDS: Record<LspLanguage, string> = {
  typescript: 'npm install -g typescript-language-server typescript',
  rust: 'rustup component add rust-analyzer',
  python: 'pip install python-lsp-server',
};

function isMissingBinaryError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('no such file') ||
    msg.includes('enoent') ||
    msg.includes('cannot find') ||
    msg.includes('program not found') ||
    msg.includes('os error 2') ||
    msg.includes('the system cannot find')
  );
}

// Tracks which languages have already shown the install notification this session
const _missingNotified = new Set<LspLanguage>();

// ── Shared client registry ────────────────────────────────────────────────────
// One LanguageServerClient per language+workspace; shared across all open files.

interface ClientEntry {
  client: LanguageServerClient;
  transport: TauriLspTransport;
}

const _clientMap      = new Map<string, ClientEntry>();
const _clientPromises = new Map<string, Promise<ClientEntry>>();

async function getOrCreateClient(language: LspLanguage, rootPath: string): Promise<ClientEntry> {
  const key = `${language}::${rootPath}`;

  const existing = _clientMap.get(key);
  if (existing) return existing;

  const inFlight = _clientPromises.get(key);
  if (inFlight) return inFlight;

  const rootUri       = pathToUri(rootPath);
  const workspaceName = rootPath.split(/[/\\]/).pop() ?? 'workspace';

  const promise = (async () => {
    await invoke('lsp_start', { language, rootPath });
    const transport = new TauriLspTransport(language);
    const client    = new LanguageServerClient({
      transport,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: workspaceName }],
      documentUri: rootUri,   // placeholder — per-file URI is supplied by the plugin
      languageId: language,
    });
    const entry: ClientEntry = { client, transport };
    _clientMap.set(key, entry);
    return entry;
  })().finally(() => _clientPromises.delete(key));

  _clientPromises.set(key, promise);
  return promise;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function posToOffset(doc: any, pos: { line: number; character: number }): number {
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(pos.line + 1);
  return line.from + Math.min(pos.character, line.length);
}

function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  // decodeURIComponent handles both file:///d%3A/foo and file:///d:/foo
  let p = decodeURIComponent(uri.slice('file://'.length));
  // file:///C:/foo → C:\foo on Windows
  if (p.startsWith('/') && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

// ── Public extension factory ──────────────────────────────────────────────────

export interface LspExtensionOptions {
  filePath: string;
  rootPath: string;
  onDefinitionJump?: (filePath: string, line: number, col: number) => void;
  onMissingServer?: (language: LspLanguage, installCmd: string) => void;
}

export async function createLspExtension(opts: LspExtensionOptions): Promise<Extension> {
  const { filePath, rootPath, onDefinitionJump } = opts;
  const language = getLspLanguage(filePath);
  if (!language) return [];

  let entry: ClientEntry;
  try {
    entry = await getOrCreateClient(language, rootPath);
  } catch (err) {
    if (isMissingBinaryError(err) && !_missingNotified.has(language)) {
      _missingNotified.add(language);
      opts.onMissingServer?.(language, INSTALL_COMMANDS[language]);
    }
    return [];
  }

  const { client, transport } = entry;
  const documentUri = pathToUri(filePath);
  const languageId  = getLspLanguageId(filePath);

  // Custom F12 handler placed before the package's keymap so it takes priority.
  // The package's jumpToDefinitionKeymap only handles same-file navigation;
  // this one additionally calls onDefinitionJump for cross-file results.
  const definitionKeymap = keymap.of([{
    key: 'F12',
    preventDefault: true,
    run: (view) => {
      const pos  = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      client.textDocumentDefinition({
        textDocument: { uri: documentUri },
        position: { line: line.number - 1, character: pos - line.from },
      }).then((result: any) => {
        if (!result) return;
        const loc   = Array.isArray(result) ? result[0] : result;
        if (!loc) return;
        const uri   = (loc.uri   ?? loc.targetUri)   as string | undefined;
        const range =  loc.range ?? loc.targetRange;
        if (!uri || !range) return;
        if (uri === documentUri) {
          const from = posToOffset(view.state.doc, range.start);
          view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
        } else {
          onDefinitionJump?.(uriToPath(uri), range.start.line + 1, range.start.character + 1);
        }
      }).catch(() => {});
      return true;
    },
  }]);

  const lspExtensions = languageServerWithTransport({
    client,
    // transport / rootUri / workspaceFolders are unused at runtime when `client` is
    // provided, but the TypeScript type still requires them.
    transport: transport as Transport,
    rootUri: null,
    workspaceFolders: null,
    documentUri,
    languageId,
  });

  return [
    // lintState must be in the view for codemirror-languageserver's setDiagnostics
    // dispatch to take effect — the package does not install it automatically.
    linter(() => [], { delay: Infinity }),
    lintGutter(),
    definitionKeymap,
    ...lspExtensions,
  ];
}
