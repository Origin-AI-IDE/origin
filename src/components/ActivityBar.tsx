import { Files, Search, GitBranch, Bug } from "lucide-react";
import { Tooltip } from "./ui/Tooltip";

const items = [
  { id: "explorer",   icon: Files,     label: "Explorer" },
  { id: "search",     icon: Search,    label: "Search" },
  { id: "sourcetree", icon: GitBranch, label: "Source Control" },
  { id: "debug",      icon: Bug,       label: "Debug" },
];

interface ActivityBarProps {
  active: string;
  onSelect: (id: string) => void;
}

export default function ActivityBar({ active, onSelect }: ActivityBarProps) {
  return (
    <div
      className="flex items-center justify-center gap-1 px-2 py-1 border-b shrink-0"
      style={{ borderColor: "var(--origin-border-default)" }}
    >
      {items.map(({ id, icon: Icon, label }) => {
        const isActive = active === id;
        return (
          <Tooltip key={id} content={label} side="bottom">
            <button
              onClick={() => onSelect(id)}
              className="p-1.5 rounded transition-colors"
              style={{
                color: isActive ? "var(--origin-fg-default)" : "var(--origin-fg-subtle)",
                backgroundColor: isActive ? "var(--origin-bg-active)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "var(--origin-fg-muted)";
                if (!isActive) e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = isActive ? "var(--origin-fg-default)" : "var(--origin-fg-subtle)";
                e.currentTarget.style.backgroundColor = isActive ? "var(--origin-bg-active)" : "transparent";
              }}
              aria-label={label}
            >
              <Icon size={15} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
