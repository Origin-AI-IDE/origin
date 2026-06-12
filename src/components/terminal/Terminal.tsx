import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  terminalCreate,
  terminalWrite,
  terminalResize,
  terminalClose,
  onTerminalOutput,
  onTerminalExit,
} from "../../lib/terminal";
import { useTheme } from "../../themes/ThemeContext";

interface Props {
  cwd: string;
  active: boolean;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildTheme() {
  return {
    background:          cssVar("--origin-bg-panel"),
    foreground:          cssVar("--origin-terminal-fg"),
    cursor:              cssVar("--origin-terminal-fg"),
    cursorAccent:        cssVar("--origin-bg-panel"),
    selectionBackground: cssVar("--origin-terminal-selection"),
    black:               cssVar("--origin-terminal-black"),
    red:                 cssVar("--origin-terminal-red"),
    green:               cssVar("--origin-terminal-green"),
    yellow:              cssVar("--origin-terminal-yellow"),
    blue:                cssVar("--origin-terminal-blue"),
    magenta:             cssVar("--origin-terminal-purple"),
    cyan:                cssVar("--origin-terminal-cyan"),
    white:               cssVar("--origin-terminal-white"),
    brightBlack:         cssVar("--origin-terminal-brightBlack"),
    brightRed:           cssVar("--origin-terminal-brightRed"),
    brightGreen:         cssVar("--origin-terminal-brightGreen"),
    brightYellow:        cssVar("--origin-terminal-brightYellow"),
    brightBlue:          cssVar("--origin-terminal-brightBlue"),
    brightMagenta:       cssVar("--origin-terminal-brightPurple"),
    brightCyan:          cssVar("--origin-terminal-brightCyan"),
    brightWhite:         cssVar("--origin-terminal-brightWhite"),
  };
}

export default function Terminal({ cwd, active }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef    = useRef<XTerm | null>(null);
  const cwdRef      = useRef(cwd);
  const termIdRef   = useRef<number | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Create the xterm instance once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new XTerm({
      fontFamily: "GeistMono, 'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: buildTheme(),
      cursorBlink: true,
      scrollback: 5000,
    });

    xtermRef.current = xterm;
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();

    const dims = fitAddon.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;

    let cleanupOutput: (() => void) | null = null;
    let cleanupExit: (() => void) | null = null;

    terminalCreate(cwdRef.current, cols, rows)
      .then(async (id) => {
        termIdRef.current = id;
        cleanupOutput = await onTerminalOutput(id, (data) => xterm.write(data));
        cleanupExit = await onTerminalExit(id, () => {
          xterm.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
        });
      })
      .catch((err: unknown) => {
        xterm.write(`\r\n\x1b[31mFailed to start terminal: ${String(err)}\x1b[0m\r\n`);
      });

    const dataDisposable = xterm.onData((data) => {
      if (termIdRef.current !== null) {
        terminalWrite(termIdRef.current, data).catch(() => {});
      }
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      const d = fitAddon.proposeDimensions();
      if (termIdRef.current !== null && d) {
        terminalResize(termIdRef.current, d.cols, d.rows).catch(() => {});
      }
    });
    observer.observe(containerRef.current);

    return () => {
      cleanupOutput?.();
      cleanupExit?.();
      dataDisposable.dispose();
      observer.disconnect();
      if (termIdRef.current !== null) {
        terminalClose(termIdRef.current).catch(() => {});
        termIdRef.current = null;
      }
      fitAddonRef.current = null;
      xtermRef.current = null;
      xterm.dispose();
    };
  }, []); // intentionally empty — terminal lifecycle is independent of React renders

  // Re-theme XTerm whenever the IDE theme changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = buildTheme();
    }
  }, [theme]);

  // Re-fit when this tab becomes active (dimensions may have changed while hidden)
  useEffect(() => {
    if (!active || !fitAddonRef.current) return;
    requestAnimationFrame(() => {
      if (!fitAddonRef.current) return;
      fitAddonRef.current.fit();
      const d = fitAddonRef.current.proposeDimensions();
      if (termIdRef.current !== null && d) {
        terminalResize(termIdRef.current, d.cols, d.rows).catch(() => {});
      }
    });
  }, [active]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />;
}
