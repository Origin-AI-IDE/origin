import { useState, useRef, useCallback } from "react";
import ActivityBar from "./ActivityBar";
import FileTree from "./FileTree";
import SearchPanel from "./SearchPanel";
import SourceTreePanel from "./SourceTreePanel";

const MIN_WIDTH = 180;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 240;

interface Props {
  onFileOpen: (path: string) => void;
  onFileOpenAtLine: (path: string, line: number, col: number) => void;
}

function PanelPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-xs" style={{ color: "var(--origin-fg-subtle)" }}>{label}</p>
    </div>
  );
}

function ActivePanel({ id, onFileOpen, onFileOpenAtLine }: {
  id: string;
  onFileOpen: (path: string) => void;
  onFileOpenAtLine: (path: string, line: number, col: number) => void;
}) {
  switch (id) {
    case "explorer":   return <FileTree onFileOpen={onFileOpen} />;
    case "search":     return <SearchPanel onFileOpenAtLine={onFileOpenAtLine} />;
    case "sourcetree": return <SourceTreePanel />;
    case "extensions": return <PanelPlaceholder label="Extensions" />;
    default:           return null;
  }
}

export default function Sidebar({ onFileOpen, onFileOpenAtLine }: Props) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState("explorer");
  const isResizing = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;

    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX)));
    }

    function onMouseUp() {
      isResizing.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div
      className="relative flex flex-col shrink-0 border-r"
      style={{
        width,
        backgroundColor: "var(--origin-bg-sidebar)",
        borderColor: "var(--origin-border-default)",
      }}
    >
      <ActivityBar active={active} onSelect={setActive} />
      <ActivePanel
        id={active}
        onFileOpen={onFileOpen}
        onFileOpenAtLine={onFileOpenAtLine}
      />

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize z-10"
        style={{ backgroundColor: "transparent" }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-border-default)"; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
      />
    </div>
  );
}
