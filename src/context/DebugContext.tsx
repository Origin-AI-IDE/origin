import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  type DapBreakpoint,
  type DapCapabilities,
  type DapLaunchConfig,
  type DapScope,
  type DapSessionStatus,
  type DapSourceBreakpoint,
  type DapStackFrame,
  type DapStoppedReason,
  type DapThread,
  dapRequest,
  dapStart,
  dapStop,
  onDapEvent,
} from '../lib/dap';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BreakpointEntry {
  line: number;
  verified: boolean;
  adapterBpId?: number;
  condition?: string;
}

export interface DebugSessionState {
  sessionId: string | null;
  status: DapSessionStatus;
  capabilities: DapCapabilities;
  stoppedThreadId: number | null;
  stoppedReason: DapStoppedReason | null;
  threads: DapThread[];
  stackFrames: DapStackFrame[];
  scopes: DapScope[];
  /** Absolute file path → breakpoint entries. Updated optimistically on toggle. */
  breakpoints: Map<string, BreakpointEntry[]>;
  outputLines: Array<{ category: string; text: string }>;
}

export interface DebugContextType {
  session: DebugSessionState;
  toggleBreakpoint: (filePath: string, line: number) => void;
  startSession: (config: DapLaunchConfig) => Promise<void>;
  stopSession: () => Promise<void>;
  continueExec: () => Promise<void>;
  stepOver: () => Promise<void>;
  stepIn: () => Promise<void>;
  stepOut: () => Promise<void>;
  pause: () => Promise<void>;
  /** Called by App.tsx so DebugContext can navigate the editor to a paused line. */
  setNavigationCallback: (cb: (filePath: string, line: number, col: number) => void) => void;
}

// ── Empty state ───────────────────────────────────────────────────────────────

const emptySession: DebugSessionState = {
  sessionId: null,
  status: 'idle',
  capabilities: {},
  stoppedThreadId: null,
  stoppedReason: null,
  threads: [],
  stackFrames: [],
  scopes: [],
  breakpoints: new Map(),
  outputLines: [],
};

// ── Context ───────────────────────────────────────────────────────────────────

const DebugContext = createContext<DebugContextType | null>(null);

export function useDebugContext(): DebugContextType {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error('useDebugContext must be used inside DebugProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<DebugSessionState>(emptySession);

  // Stable refs so closures inside event handlers always see current state
  const sessionRef      = useRef(session);
  sessionRef.current    = session;
  const unlistenRef     = useRef<(() => void) | null>(null);
  const navigationCbRef = useRef<((f: string, l: number, c: number) => void) | null>(null);
  const launchConfigRef = useRef<DapLaunchConfig | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setStatus(status: DapSessionStatus) {
    setSession(prev => ({ ...prev, status }));
  }

  function setCapabilities(caps: DapCapabilities) {
    setSession(prev => ({ ...prev, capabilities: caps }));
  }

  // ── Event handler (wired in Phase 4 — stub logs for now) ─────────────────

  const handleEvent = useCallback(async (msg: { event: string; body?: any }) => {
    const sid = sessionRef.current.sessionId;
    if (!sid) return;

    switch (msg.event) {
      case 'initialized': {
        const config = launchConfigRef.current;
        if (!config) break;

        // Send setBreakpoints for each file
        for (const [filePath, bps] of config.sourceBreakpoints) {
          const result = await dapRequest(sid, 'setBreakpoints', {
            source: { path: filePath },
            breakpoints: bps,
          }).catch(() => ({ breakpoints: [] as DapBreakpoint[] }));

          // Update verified status from adapter response
          const verified: DapBreakpoint[] = result?.breakpoints ?? [];
          setSession(prev => {
            const next = new Map(prev.breakpoints);
            const entries = next.get(filePath);
            if (entries) {
              next.set(filePath, entries.map((e, i) => ({
                ...e,
                verified: verified[i]?.verified ?? false,
                adapterBpId: verified[i]?.id,
              })));
            }
            return { ...prev, breakpoints: next };
          });
        }

        await dapRequest(sid, 'setExceptionBreakpoints', { filters: [] }).catch(() => {});
        if (sessionRef.current.capabilities.supportsConfigurationDoneRequest) {
          await dapRequest(sid, 'configurationDone', {}).catch(() => {});
        }

        const { adapter, program, args = [], cwd, stopOnEntry = false } = config;
        await dapRequest(sid, 'launch', {
          type: adapter,
          request: 'launch',
          name: 'Launch',
          program,
          args,
          cwd: cwd ?? '',
          stopOnEntry,
        }).catch(() => {});

        setStatus('running');
        break;
      }

      case 'stopped': {
        const body = msg.body as { reason: DapStoppedReason; threadId?: number; allThreadsStopped?: boolean };
        setSession(prev => ({
          ...prev,
          status: 'paused',
          stoppedThreadId: body.threadId ?? null,
          stoppedReason: body.reason,
        }));

        // Fetch threads, stack, scopes, first-level variables
        const threadId = body.threadId ?? 0;
        const threadsRes = await dapRequest(sid, 'threads', {}).catch(() => ({ threads: [] }));
        const threads: DapThread[] = threadsRes?.threads ?? [];

        const stackRes = await dapRequest(sid, 'stackTrace', {
          threadId,
          startFrame: 0,
          levels: 20,
        }).catch(() => ({ stackFrames: [] }));
        const stackFrames: DapStackFrame[] = stackRes?.stackFrames ?? [];

        let scopes: DapScope[] = [];
        if (stackFrames.length > 0) {
          const scopesRes = await dapRequest(sid, 'scopes', { frameId: stackFrames[0].id })
            .catch(() => ({ scopes: [] }));
          scopes = scopesRes?.scopes ?? [];
        }

        setSession(prev => ({ ...prev, threads, stackFrames, scopes }));

        // Navigate editor to the paused line
        const frame = stackFrames[0];
        if (frame?.source?.path && navigationCbRef.current) {
          navigationCbRef.current(frame.source.path, frame.line, frame.column);
        }
        break;
      }

      case 'continued':
        setSession(prev => ({
          ...prev,
          status: 'running',
          stoppedThreadId: null,
          stoppedReason: null,
          stackFrames: [],
          scopes: [],
        }));
        break;

      case 'terminated':
        setSession(prev => ({ ...prev, status: 'terminated', stackFrames: [], scopes: [], threads: [] }));
        unlistenRef.current?.();
        unlistenRef.current = null;
        await dapStop(sid).catch(() => {});
        break;

      case 'output': {
        const body = msg.body as { category?: string; output: string };
        setSession(prev => ({
          ...prev,
          outputLines: [...prev.outputLines, { category: body.category ?? 'console', text: body.output }],
        }));
        break;
      }

      case 'breakpoint': {
        // Adapter updated a breakpoint (verified/line changed)
        const body = msg.body as { reason: string; breakpoint: DapBreakpoint };
        const bp = body.breakpoint;
        if (!bp.id || !bp.source?.path) break;
        setSession(prev => {
          const next = new Map(prev.breakpoints);
          const filePath = bp.source!.path!;
          const entries = next.get(filePath);
          if (entries) {
            next.set(filePath, entries.map(e =>
              e.adapterBpId === bp.id ? { ...e, verified: bp.verified } : e
            ));
          }
          return { ...prev, breakpoints: next };
        });
        break;
      }
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────

  const toggleBreakpoint = useCallback((filePath: string, line: number) => {
    setSession(prev => {
      const next = new Map(prev.breakpoints);
      const entries = next.get(filePath) ?? [];
      const idx = entries.findIndex(e => e.line === line);
      if (idx >= 0) {
        const updated = entries.filter((_, i) => i !== idx);
        if (updated.length === 0) next.delete(filePath);
        else next.set(filePath, updated);
      } else {
        next.set(filePath, [...entries, { line, verified: false }]);
      }
      return { ...prev, breakpoints: next };
    });

    // If a session is active, update the adapter immediately
    const { sessionId: sid, status } = sessionRef.current;
    if (sid && (status === 'running' || status === 'paused')) {
      const updatedEntries = sessionRef.current.breakpoints.get(filePath) ?? [];
      const bps: DapSourceBreakpoint[] = updatedEntries.map(e => ({ line: e.line }));
      dapRequest(sid, 'setBreakpoints', {
        source: { path: filePath },
        breakpoints: bps,
      }).catch(() => {});
    }
  }, []);

  const startSession = useCallback(async (config: DapLaunchConfig) => {
    const id = crypto.randomUUID();
    launchConfigRef.current = config;

    // Carry existing breakpoints into the launch config
    const currentBps = new Map(sessionRef.current.breakpoints);
    if (config.sourceBreakpoints.size === 0 && currentBps.size > 0) {
      for (const [fp, entries] of currentBps) {
        config.sourceBreakpoints.set(fp, entries.map(e => ({ line: e.line })));
      }
    }

    setSession(prev => ({
      ...emptySession,
      breakpoints: prev.breakpoints, // preserve user-set breakpoints across sessions
      sessionId: id,
      status: 'starting',
    }));

    // Subscribe to events BEFORE starting the adapter process.
    // 'initialized' can arrive almost immediately after the initialize response.
    const unlisten = await onDapEvent(id, handleEvent);
    unlistenRef.current = unlisten;

    await dapStart(id, config.adapter, config.adapterPath);

    const caps = await dapRequest(id, 'initialize', {
      clientID: 'origin',
      clientName: 'Origin IDE',
      adapterID: config.adapter,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });
    setCapabilities(caps ?? {});
    setStatus('configuring');
    // 'initialized' event drives the rest (see handleEvent above)
  }, [handleEvent]);

  const stopSession = useCallback(async () => {
    const { sessionId: sid } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'disconnect', { terminateDebuggee: true }).catch(() => {});
    await dapStop(sid).catch(() => {});
    unlistenRef.current?.();
    unlistenRef.current = null;
    setSession(prev => ({ ...emptySession, breakpoints: prev.breakpoints }));
  }, []);

  const continueExec = useCallback(async () => {
    const { sessionId: sid, stoppedThreadId } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'continue', { threadId: stoppedThreadId ?? 1 }).catch(() => {});
  }, []);

  const stepOver = useCallback(async () => {
    const { sessionId: sid, stoppedThreadId } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'next', { threadId: stoppedThreadId ?? 1 }).catch(() => {});
  }, []);

  const stepIn = useCallback(async () => {
    const { sessionId: sid, stoppedThreadId } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'stepIn', { threadId: stoppedThreadId ?? 1 }).catch(() => {});
  }, []);

  const stepOut = useCallback(async () => {
    const { sessionId: sid, stoppedThreadId } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'stepOut', { threadId: stoppedThreadId ?? 1 }).catch(() => {});
  }, []);

  const pause = useCallback(async () => {
    const { sessionId: sid, threads } = sessionRef.current;
    if (!sid) return;
    await dapRequest(sid, 'pause', { threadId: threads[0]?.id ?? 1 }).catch(() => {});
  }, []);

  const setNavigationCallback = useCallback(
    (cb: (filePath: string, line: number, col: number) => void) => {
      navigationCbRef.current = cb;
    },
    [],
  );

  return (
    <DebugContext.Provider value={{
      session,
      toggleBreakpoint,
      startSession,
      stopSession,
      continueExec,
      stepOver,
      stepIn,
      stepOut,
      pause,
      setNavigationCallback,
    }}>
      {children}
    </DebugContext.Provider>
  );
}
