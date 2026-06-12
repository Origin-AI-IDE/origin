import { useRef, useState } from "react";
import { Minus, Square, X, PanelLeft, PanelBottom, PanelRight } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "./ui/Tooltip";
import DropdownMenu, { type MenuEntry } from "./ui/DropdownMenu";
import StatusIsland from "./StatusIsland";
import { useTheme } from "../themes/ThemeContext";
import logoSrc from "../assets/origin-logo.svg";

const win = getCurrentWindow();

interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  aiPanelOpen: boolean;
  onToggleAiPanel: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  onNewWindow: () => void;
  onOpenPalette: () => void;
  gitBranch:  string | null;
  dirtyCount: number;
}

function IconBtn({
  onClick,
  label,
  active,
  tooltip,
  children,
}: {
  onClick?: () => void;
  label: string;
  active?: boolean;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const btn = (
    <button
      onClick={onClick}
      aria-label={label}
      className="p-2 rounded transition-colors"
      style={{ color: active ? "var(--origin-fg-default)" : "var(--origin-fg-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--origin-fg-default)";
        e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = active ? "var(--origin-fg-default)" : "var(--origin-fg-muted)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );

  return tooltip ? (
    <Tooltip content={tooltip} side="bottom">{btn}</Tooltip>
  ) : btn;
}

function MenuButton({
  label,
  anchorRef,
  isOpen,
  onClick,
}: {
  label: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={anchorRef}
      onClick={onClick}
      className="text-xs px-2 py-1 rounded transition-colors"
      style={{
        color: isOpen ? "var(--origin-fg-default)" : "var(--origin-fg-muted)",
        backgroundColor: isOpen ? "var(--origin-bg-hover)" : "transparent",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--origin-fg-default)";
        e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isOpen) {
          e.currentTarget.style.color = "var(--origin-fg-muted)";
          e.currentTarget.style.backgroundColor = "transparent";
        }
      }}
    >
      {label}
    </button>
  );
}


export default function TitleBar({
  sidebarOpen, onToggleSidebar,
  terminalOpen, onToggleTerminal,
  aiPanelOpen, onToggleAiPanel,
  onOpenFolder, onOpenFile, onNewFile, onNewWindow,
  onOpenPalette,
  gitBranch, dirtyCount,
}: TitleBarProps) {
  const { theme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileRef     = useRef<HTMLButtonElement>(null);
  const editRef     = useRef<HTMLButtonElement>(null);
  const viewRef     = useRef<HTMLButtonElement>(null);
  const termRef     = useRef<HTMLButtonElement>(null);
  const helpRef     = useRef<HTMLButtonElement>(null);

  const close = () => setOpenMenu(null);
  const toggle = (id: string) => () => setOpenMenu(prev => prev === id ? null : id);

  const fileEntries: MenuEntry[] = [
    { type: 'item', label: 'New File',      shortcut: 'Ctrl+N',        onClick: onNewFile },
    { type: 'item', label: 'New Window',    shortcut: 'Ctrl+Shift+N',  onClick: onNewWindow },
    { type: 'separator' },
    { type: 'item', label: 'Open Folder…', shortcut: 'Ctrl+K Ctrl+O', onClick: onOpenFolder },
    { type: 'item', label: 'Open File…',   shortcut: 'Ctrl+O',        onClick: onOpenFile },
    { type: 'item', label: 'Open Recent',  submenu: true,              disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Save',         shortcut: 'Ctrl+S',        disabled: true },
    { type: 'item', label: 'Save As…',     shortcut: 'Ctrl+Shift+S',  disabled: true },
    { type: 'item', label: 'Save All',     shortcut: 'Ctrl+K S',      disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Close Editor', shortcut: 'Ctrl+W',        disabled: true },
    { type: 'item', label: 'Close Folder',                             disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Exit',         shortcut: 'Alt+F4',        onClick: () => win.close() },
  ];

  const editEntries: MenuEntry[] = [
    { type: 'item', label: 'Undo',       shortcut: 'Ctrl+Z',   disabled: true },
    { type: 'item', label: 'Redo',       shortcut: 'Ctrl+Y',   disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Cut',        shortcut: 'Ctrl+X',   disabled: true },
    { type: 'item', label: 'Copy',       shortcut: 'Ctrl+C',   disabled: true },
    { type: 'item', label: 'Paste',      shortcut: 'Ctrl+V',   disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Select All', shortcut: 'Ctrl+A',   disabled: true },
    { type: 'separator' },
    { type: 'item', label: 'Find',       shortcut: 'Ctrl+F',   disabled: true },
    { type: 'item', label: 'Replace',    shortcut: 'Ctrl+H',   disabled: true },
  ];

  const viewEntries: MenuEntry[] = [
    { type: 'item', label: 'Command Palette', shortcut: 'Ctrl+P', onClick: () => { close(); onOpenPalette(); } },
    { type: 'separator' },
    { type: 'item', label: sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar', onClick: () => { close(); onToggleSidebar(); } },
    { type: 'item', label: terminalOpen ? 'Hide Terminal' : 'Show Terminal', shortcut: 'Ctrl+`', onClick: () => { close(); onToggleTerminal(); } },
    { type: 'separator' },
    { type: 'item', label: 'Zoom In',    shortcut: 'Ctrl+=', disabled: true },
    { type: 'item', label: 'Zoom Out',   shortcut: 'Ctrl+-', disabled: true },
    { type: 'item', label: 'Reset Zoom', shortcut: 'Ctrl+0', disabled: true },
  ];

  const terminalEntries: MenuEntry[] = [
    { type: 'item', label: terminalOpen ? 'Hide Terminal' : 'Show Terminal', shortcut: 'Ctrl+`', onClick: () => { close(); onToggleTerminal(); } },
    { type: 'separator' },
    { type: 'item', label: 'New Terminal Tab', disabled: true },
    { type: 'item', label: 'Clear Terminal',   disabled: true },
    { type: 'item', label: 'Kill Terminal',    disabled: true },
  ];

  const helpEntries: MenuEntry[] = [
    { type: 'item', label: 'Keyboard Shortcuts', shortcut: 'Ctrl+P', onClick: () => { close(); onOpenPalette(); } },
    { type: 'separator' },
    { type: 'item', label: 'About Origin', disabled: true },
  ];

  const menus: Array<{ id: string; label: string; ref: React.RefObject<HTMLButtonElement | null>; entries: MenuEntry[] }> = [
    { id: 'file',     label: 'File',     ref: fileRef, entries: fileEntries },
    { id: 'edit',     label: 'Edit',     ref: editRef, entries: editEntries },
    { id: 'view',     label: 'View',     ref: viewRef, entries: viewEntries },
    { id: 'terminal', label: 'Terminal', ref: termRef, entries: terminalEntries },
    { id: 'help',     label: 'Help',     ref: helpRef, entries: helpEntries },
  ];

  return (
    <div
      className="relative z-10 flex items-center h-9 shrink-0 select-none border-b"
      style={{
        backgroundColor: "var(--origin-bg-titlebar)",
        borderColor: "var(--origin-border-default)",
      }}
    >
      {/* Left — menus */}
      <div className="flex items-center gap-1 px-3 z-10 shrink-0">
        <img
          src={logoSrc}
          alt="Origin"
          style={{
            height: "16px",
            width: "auto",
            marginRight: "10px",
            filter: theme.type === "light" ? "invert(1)" : "none",
          }}
        />

        {menus.map(({ id, label, ref, entries }) => (
          <span key={id}>
            <MenuButton
              label={label}
              anchorRef={ref}
              isOpen={openMenu === id}
              onClick={toggle(id)}
            />
            {openMenu === id && (
              <DropdownMenu
                entries={entries}
                anchorEl={ref.current}
                onClose={close}
              />
            )}
          </span>
        ))}
      </div>

      {/* Center — drag region behind island */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Status Island — top pinned so card expands downward */}
      <div
        className="absolute left-1/2 z-20"
        style={{ top: "7px", transform: "translateX(-50%)" }}
      >
        <StatusIsland gitBranch={gitBranch} dirtyCount={dirtyCount} />
      </div>

      {/* Right — panel toggles + window controls */}
      <div className="flex items-center z-10 pr-2 shrink-0">
        <IconBtn
          label="Toggle Left Sidebar"
          tooltip="Toggle Left Sidebar"
          active={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={14} />
        </IconBtn>
        <IconBtn
          label="Toggle Bottom Panel"
          tooltip="Toggle Terminal (Ctrl+`)"
          active={terminalOpen}
          onClick={onToggleTerminal}
        >
          <PanelBottom size={14} />
        </IconBtn>
        <IconBtn
          label="Toggle AI Panel"
          tooltip="Toggle AI Panel"
          active={aiPanelOpen}
          onClick={onToggleAiPanel}
        >
          <PanelRight size={14} />
        </IconBtn>

        <div
          className="w-px h-4 mx-1"
          style={{ backgroundColor: "var(--origin-border-default)" }}
        />

        <IconBtn label="Minimize" onClick={() => win.minimize()}>
          <Minus size={13} />
        </IconBtn>
        <IconBtn label="Maximize" onClick={() => win.toggleMaximize()}>
          <Square size={11} />
        </IconBtn>
        <button
          onClick={() => win.close()}
          aria-label="Close"
          className="p-2 rounded transition-colors"
          style={{ color: "var(--origin-fg-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--origin-accent-red)";
            e.currentTarget.style.backgroundColor = "var(--origin-accent-red)1a";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--origin-fg-muted)";
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
