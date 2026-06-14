import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { ParsedPlan, PlanStep } from "../../lib/agent/planTypes";

const ACTION_CONFIG: Record<PlanStep["action"], { label: string; bgVar: string; fgVar: string }> = {
  edit:   { label: "edit",   bgVar: "var(--plan-badge-edit-bg)",   fgVar: "var(--plan-badge-edit-fg)"   },
  create: { label: "create", bgVar: "var(--plan-badge-create-bg)", fgVar: "var(--plan-badge-create-fg)" },
  delete: { label: "delete", bgVar: "var(--plan-badge-delete-bg)", fgVar: "var(--plan-badge-delete-fg)" },
};

export default function PlanCard({ plan, onApprove, onReject, status = "pending" }: {
  plan: ParsedPlan;
  onApprove?: () => void;
  onReject?: () => void;
  status?: "pending" | "approved" | "rejected";
}) {
  const isDone = status !== "pending";
  const [expanded, setExpanded] = useState(!isDone);

  const statusColor = status === "approved" ? "#22c55e" : "var(--origin-fg-subtle)";
  const statusLabel = status === "approved" ? "approved" : "rejected";

  return (
    <div style={{
      margin: "8px 0 4px",
      borderRadius: "8px",
      border: "1px solid var(--origin-border-default)",
      backgroundColor: "var(--origin-bg-editor)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      <div
        onClick={isDone ? () => setExpanded(e => !e) : undefined}
        style={{
          padding: "8px 12px",
          borderBottom: expanded ? "1px solid var(--origin-border-default)" : "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: isDone ? "pointer" : "default",
        }}
        onMouseEnter={isDone ? e => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-bg-hover)"; } : undefined}
        onMouseLeave={isDone ? e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; } : undefined}
      >
        {isDone && (
          <span style={{ color: "var(--origin-fg-subtle)", flexShrink: 0, display: "flex" }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--origin-fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
          Plan
        </span>
        <span style={{ fontSize: "12px", color: "var(--origin-fg-default)", flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {plan.title}
        </span>
        {isDone && (
          <span style={{ fontSize: "10px", fontWeight: 600, color: statusColor, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {statusLabel}
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: "6px 12px", maxHeight: "260px", overflowY: "auto" }}>
          {plan.steps.map((step, i) => {
            const cfg = ACTION_CONFIG[step.action] ?? ACTION_CONFIG.edit;
            return (
              <div key={i} style={{ display: "flex", gap: "10px", padding: "4px 0", alignItems: "flex-start" }}>
                <div style={{
                  padding: "1px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: cfg.fgVar,
                  background: cfg.bgVar,
                  flexShrink: 0,
                  marginTop: "2px",
                  fontFamily: "var(--font-mono)",
                }}>
                  {cfg.label}
                </div>
                <div>
                  <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--origin-fg-muted)", marginBottom: "2px", wordBreak: "break-all" }}>
                    {step.file}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--origin-fg-default)", lineHeight: 1.45 }}>
                    {step.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isDone && (
        <div style={{
          padding: "8px 12px 10px",
          display: "flex",
          gap: "8px",
          justifyContent: "flex-end",
          borderTop: "1px solid var(--origin-border-default)",
        }}>
          <button
            onClick={onReject}
            style={{
              padding: "5px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              background: "var(--origin-bg-active)",
              border: "1px solid var(--origin-border-default)",
              color: "var(--origin-fg-muted)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--origin-bg-hover)"; e.currentTarget.style.color = "var(--origin-fg-default)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--origin-bg-active)"; e.currentTarget.style.color = "var(--origin-fg-muted)"; }}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            style={{
              padding: "5px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              background: "var(--origin-fg-default)",
              border: "1px solid transparent",
              color: "var(--origin-bg-base)",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            Approve &amp; Execute
          </button>
        </div>
      )}
    </div>
  );
}
