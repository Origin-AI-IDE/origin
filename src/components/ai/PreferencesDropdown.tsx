import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { PROVIDERS } from "./providers";

interface Props {
  anchorEl: HTMLElement | null;
  selectedModelId: string;
  onSelect: (providerId: string, modelId: string) => void;
  onClose: () => void;
}

const DROPDOWN_WIDTH  = 310;
const DROPDOWN_HEIGHT = 260;

function ProgressiveBlur({ direction, size = 36 }: { direction: "top" | "bottom"; size?: number }) {
  const layers = 6;
  const intensity = 0.8;
  const segSize = 1 / (layers + 1);
  const angle = direction === "top" ? 180 : 0;
  const edgeStyle: React.CSSProperties = direction === "top"
    ? { top: 0, left: 0, right: 0, height: size }
    : { bottom: 0, left: 0, right: 0, height: size };

  return (
    <>
      {Array.from({ length: layers }).map((_, i) => {
        const start = i * segSize;
        const mid1  = (i + 1) * segSize;
        const mid2  = (i + 2) * segSize;
        const end   = (i + 3) * segSize;
        const gradient = `linear-gradient(${angle}deg,
          transparent ${start * 100}%,
          black ${mid1 * 100}%,
          black ${mid2 * 100}%,
          transparent ${end * 100}%)`;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              ...edgeStyle,
              pointerEvents: "none",
              backdropFilter: `blur(${i * intensity}px)`,
              WebkitBackdropFilter: `blur(${i * intensity}px)`,
              maskImage: gradient,
              WebkitMaskImage: gradient,
              zIndex: 2,
            }}
          />
        );
      })}
    </>
  );
}

export default function PreferencesDropdown({ anchorEl, selectedModelId, onSelect, onClose }: Props) {
  const menuRef      = useRef<HTMLDivElement>(null);
  const searchRef    = useRef<HTMLInputElement>(null);
  const providerScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp,   setCanScrollUp]   = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = () => {
    const el = providerScrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 2);
    setCanScrollDown(el.scrollTop < el.scrollHeight - el.clientHeight - 2);
  };
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    const p = PROVIDERS.find(p => p.models.some(m => m.id === selectedModelId));
    return p?.id ?? PROVIDERS[0].id;
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow < DROPDOWN_HEIGHT + 10
      ? r.top - DROPDOWN_HEIGHT - 6
      : r.bottom + 6;
    setPos({ top, left: Math.max(8, r.right - DROPDOWN_WIDTH) });
  }, [anchorEl]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 50); }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => updateScrollState());
    const el = providerScrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState);
    return () => {
      cancelAnimationFrame(id);
      el.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  const activeProvider  = PROVIDERS.find(p => p.id === activeProviderId)!;
  const filteredModels  = activeProvider.models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase())
  );

  if (!anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: DROPDOWN_WIDTH,
        height: DROPDOWN_HEIGHT,
        display: "flex",
        background: "color-mix(in srgb, var(--origin-bg-base) 90%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--origin-border-default)",
        borderRadius: "10px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        overflow: "hidden",
        zIndex: 9999,
      }}
    >
      {/* Left: provider column — outer wrapper for blur overlays */}
      <div
        style={{
          width: "48px",
          height: "100%",
          flexShrink: 0,
          borderRight: "1px solid var(--origin-border-default)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Scrollable inner */}
        <div
          ref={providerScrollRef}
          style={{
            position: "absolute",
            inset: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "6px 0",
            gap: "2px",
            scrollbarWidth: "none",
          }}
        >
          {PROVIDERS.map(p => {
            const isActive = activeProviderId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => { setActiveProviderId(p.id); setSearch(""); }}
                title={p.name}
                style={{
                  width: "34px",
                  height: "30px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isActive ? "var(--origin-bg-hover)" : "transparent",
                  flexShrink: 0,
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)";
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {p.icon
                  ? <img src={p.icon} alt={p.name} style={{ width: 20, height: 20, objectFit: "contain", filter: p.invert ? "brightness(0) invert(1)" : "none" }} />
                  : <div style={{ width: 20, height: 20, borderRadius: "4px", backgroundColor: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", fontWeight: 700, color: p.textColor }}>{p.initial}</div>
                }
              </button>
            );
          })}
        </div>

        {canScrollUp   && <ProgressiveBlur direction="top" />}
        {canScrollDown && <ProgressiveBlur direction="bottom" />}
      </div>

      {/* Right: model list */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{
          padding: "10px 12px 6px",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--origin-fg-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          flexShrink: 0,
        }}>
          {activeProvider.name}
        </div>

        <div style={{ padding: "0 8px 6px", flexShrink: 0 }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "5px 8px",
            borderRadius: "6px",
            border: "1px solid var(--origin-border-default)",
            backgroundColor: "var(--origin-bg-sidebar)",
          }}>
            <Search size={11} style={{ color: "var(--origin-fg-subtle)", flexShrink: 0 }} />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: "12px",
                color: "var(--origin-fg-default)",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 4px" }}>
          {filteredModels.length === 0 ? (
            <div style={{
              padding: "16px 8px",
              fontSize: "12px",
              color: "var(--origin-fg-subtle)",
              textAlign: "center",
            }}>
              {activeProvider.models.length === 0
                ? "Models are detected automatically."
                : "No models found."}
            </div>
          ) : filteredModels.map(m => {
            const isSelected = m.id === selectedModelId;
            return (
              <button
                key={m.id}
                onClick={() => { onSelect(activeProvider.id, m.id); onClose(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {(m.icon ?? activeProvider.icon)
                    ? <img src={m.icon ?? activeProvider.icon!} alt={m.name} style={{ width: 22, height: 22, objectFit: "contain", filter: (m.iconInvert ?? activeProvider.invert) ? "brightness(0) invert(1)" : "none" }} />
                    : <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--origin-fg-muted)" }}>{activeProvider.initial}</span>
                  }
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "12px",
                    fontWeight: isSelected ? 600 : 400,
                    color: "var(--origin-fg-default)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {m.name}
                  </div>
                  <div style={{
                    fontSize: "10px",
                    color: "var(--origin-fg-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginTop: "1px",
                  }}>
                    {m.description}
                  </div>
                </div>

                {isSelected && (
                  <div style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "var(--origin-accent-blue)",
                    flexShrink: 0,
                  }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
