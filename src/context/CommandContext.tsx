import { createContext, useContext } from 'react';

export interface AppCommands {
  // Layout toggles
  sidebarOpen: boolean;
  terminalOpen: boolean;
  aiPanelOpen: boolean;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleAiPanel: () => void;
  // Window
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // Navigation
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  onNewWindow: () => void;
  onOpenPalette: () => void;
  // Status
  gitBranch: string | null;
  dirtyCount: number;
  hasActiveTab: boolean;
  hasFolderOpen: boolean;
  // File menu
  onSave: () => void;
  onSaveAs: () => void;
  onSaveAll: () => void;
  onCloseEditor: () => void;
  onCloseFolder: () => void;
  // Editor actions
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onEditorCut: () => void;
  onEditorCopy: () => void;
  onEditorPaste: () => void;
  onEditorSelectAll: () => void;
  onEditorFind: () => void;
  // Zoom
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  // Terminal
  onNewTerminalTab: () => void;
  onClearTerminal: () => void;
  onKillTerminal: () => void;
  // Help
  onAbout: () => void;
}

const noop = () => {};

const defaults: AppCommands = {
  sidebarOpen: false, terminalOpen: false, aiPanelOpen: false,
  onToggleSidebar: noop, onToggleTerminal: noop, onToggleAiPanel: noop,
  isFullscreen: false, onToggleFullscreen: noop,
  onOpenFolder: noop, onOpenFile: noop, onNewFile: noop, onNewWindow: noop, onOpenPalette: noop,
  gitBranch: null, dirtyCount: 0, hasActiveTab: false, hasFolderOpen: false,
  onSave: noop, onSaveAs: noop, onSaveAll: noop, onCloseEditor: noop, onCloseFolder: noop,
  onEditorUndo: noop, onEditorRedo: noop, onEditorCut: noop, onEditorCopy: noop,
  onEditorPaste: noop, onEditorSelectAll: noop, onEditorFind: noop,
  onZoomIn: noop, onZoomOut: noop, onZoomReset: noop,
  onNewTerminalTab: noop, onClearTerminal: noop, onKillTerminal: noop,
  onAbout: noop,
};

export const CommandContext = createContext<AppCommands>(defaults);

export function useCommands(): AppCommands {
  return useContext(CommandContext);
}
