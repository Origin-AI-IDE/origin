import { cloneElement, useState, useRef } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
}

export function Tooltip({ content, children, side = "right", delay = 700 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseEnter(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    timer.current = setTimeout(() => {
      let top = 0;
      let left = 0;
      const gap = 8;
      if (side === "right")  { top = rect.top + rect.height / 2; left = rect.right + gap; }
      if (side === "left")   { top = rect.top + rect.height / 2; left = rect.left - gap; }
      if (side === "bottom") { top = rect.bottom + gap; left = rect.left + rect.width / 2; }
      if (side === "top")    { top = rect.top - gap; left = rect.left + rect.width / 2; }
      setPos({ top, left });
      setVisible(true);
    }, delay);
    children.props.onMouseEnter?.(e);
  }

  function handleMouseLeave(e: React.MouseEvent<HTMLElement>) {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
    children.props.onMouseLeave?.(e);
  }

  const transform =
    side === "right"  ? "translateY(-50%)" :
    side === "left"   ? "translateX(-100%) translateY(-50%)" :
    side === "top"    ? "translateX(-50%) translateY(-100%)" :
                        "translateX(-50%)";

  return (
    <>
      {cloneElement(children, { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave })}
      {visible && createPortal(
        <div
          className="fixed z-50 px-2 py-1 text-xs rounded pointer-events-none whitespace-nowrap"
          style={{
            top: pos.top,
            left: pos.left,
            transform,
            backgroundColor: "var(--origin-tooltip-bg)",
            color: "var(--origin-tooltip-fg)",
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
