import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

// ── Adapter types ─────────────────────────────────────────────────────────────

export type DapAdapterType = 'codelldb' | 'debugpy';

export type DapSessionStatus =
  | 'idle'
  | 'starting'
  | 'configuring'
  | 'running'
  | 'paused'
  | 'terminated';

export type DapStoppedReason =
  | 'breakpoint'
  | 'step'
  | 'pause'
  | 'exception'
  | 'entry'
  | string;

// ── DAP protocol types ────────────────────────────────────────────────────────

export interface DapCapabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsFunctionBreakpoints?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsStepBack?: boolean;
  supportsRestartRequest?: boolean;
  supportsTerminateRequest?: boolean;
  supportsSetVariable?: boolean;
  [key: string]: boolean | undefined;
}

export interface DapThread {
  id: number;
  name: string;
}

export interface DapStackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: {
    path?: string;
    name?: string;
    sourceReference?: number;
  };
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  namedVariables?: number;
  indexedVariables?: number;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number; // > 0 means has children (expandable)
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
}

export interface DapSourceBreakpoint {
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface DapBreakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: { path?: string; name?: string };
  line?: number;
}

// ── Event payloads ────────────────────────────────────────────────────────────

export interface DapStoppedEvent {
  reason: DapStoppedReason;
  threadId?: number;
  allThreadsStopped?: boolean;
  description?: string;
  text?: string;
  hitBreakpointIds?: number[];
}

export interface DapOutputEvent {
  category?: 'console' | 'stdout' | 'stderr' | 'telemetry' | string;
  output: string;
  source?: { path?: string; name?: string };
  line?: number;
}

export interface DapBreakpointEvent {
  reason: 'changed' | 'new' | 'removed' | string;
  breakpoint: DapBreakpoint;
}

// ── Launch config ─────────────────────────────────────────────────────────────

export interface DapLaunchConfig {
  adapter: DapAdapterType;
  adapterPath?: string;
  program: string;
  args?: string[];
  cwd?: string;
  stopOnEntry?: boolean;
  /** Breakpoints to set before launching, keyed by absolute file path. */
  sourceBreakpoints: Map<string, DapSourceBreakpoint[]>;
}

// ── IPC wrappers ──────────────────────────────────────────────────────────────

export async function dapStart(
  sessionId: string,
  adapter: DapAdapterType,
  adapterPath?: string,
): Promise<void> {
  await invoke('dap_start', { sessionId, adapter, adapterPath: adapterPath ?? null });
}

export async function dapRequest(
  sessionId: string,
  command: string,
  args: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DAP response shape is command-specific
): Promise<any> {
  return invoke('dap_request', { sessionId, command, arguments: args });
}

export async function dapStop(sessionId: string): Promise<void> {
  await invoke('dap_stop', { sessionId });
}

/**
 * Listen for DAP events emitted by the Rust adapter reader task.
 * The handler receives the full DAP event message: { event, body?, seq, type }.
 * Returns an unlisten function to cancel the subscription.
 *
 * Register this BEFORE calling dapStart — the 'initialized' event can arrive
 * almost immediately after the initialize response and must not be dropped.
 */
export async function onDapEvent(
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DAP event bodies are protocol-defined and vary per event type
  handler: (msg: { event: string; body?: any; seq: number }) => void,
): Promise<UnlistenFn> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tauri event payload is untyped JSON
  return listen(`dap-event-${sessionId}`, (e) => handler(e.payload as any));
}
