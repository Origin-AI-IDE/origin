import { useState } from "react";
import { Pin, FileCode } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";
import ToolCallCard from "./ToolCallCard";
import PlanCard from "./PlanCard";
import type { DisplayMessage } from "../../lib/aiTypes";
import type { EditorContext } from "../editor/Editor";
import { resolveTargetPath } from "../../lib/resolveTargetPath";

function contextLabel(ctx: EditorContext): string {
  if (ctx.startLine === ctx.endLine) return `L${ctx.startLine}`;
  return `L${ctx.startLine}–${ctx.endLine}`;
}

export default function MessageBubble({
  message,
  folderPath,
  onApplyCode,
  getOpenTabPaths,
  onResolveFail,
  onPin,
  onPlanApprove,
  onPlanReject,
}: {
  message: DisplayMessage;
  folderPath?: string | null;
  onApplyCode?: (code: string, filePath?: string, ctx?: EditorContext) => void;
  getOpenTabPaths?: () => string[];
  onResolveFail?: () => void;
  onPin?: (content: string) => void;
  onPlanApprove?: () => void;
  onPlanReject?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const parts = message.parts;
  const hasVisibleContent = isUser
    ? !!message.content
    : parts
      ? parts.some(p => p.type === "tool-call" || p.type === "plan-card" || (p.type === "text" && p.content.trim()))
      : !!message.content;
  const isEmpty = !hasVisibleContent;
  const hasAttachments = isUser && (
    (message.fileMentions && message.fileMentions.length > 0) || message.editorContext
  );

  const badgeStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "2px 6px", borderRadius: "4px", fontSize: "11px",
    fontFamily: "var(--font-mono)",
    background: "var(--origin-bg-active)", border: "1px solid var(--origin-border-default)",
    color: "var(--origin-fg-default)", whiteSpace: "nowrap",
  };

  const makeApplyCode = (code: string, _lang: string, filePath?: string) => {
    if (!onApplyCode) return;
    const resolved = resolveTargetPath(
      filePath, message.fileMentions, message.sourceFilePath,
      folderPath ?? "", getOpenTabPaths?.() ?? [],
    );
    if (!resolved) { onResolveFail?.(); return; }
    onApplyCode(code, resolved, message.editorContext ?? undefined);
  };

  return (
    <div
      style={{ marginBottom: "20px" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--origin-fg-subtle)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {isUser ? "You" : "Assistant"}
        </span>
        {!isUser && onPin && hovered && message.content && !message.streaming && (
          <button
            onClick={() => onPin(message.content)}
            title="Pin to Pinboard"
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "3px", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", borderRadius: "4px", color: "var(--origin-fg-subtle)", fontSize: "10px" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--origin-fg-default)"; e.currentTarget.style.backgroundColor = "var(--origin-bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--origin-fg-subtle)"; e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Pin size={11} />
          </button>
        )}
      </div>

      {isEmpty && message.streaming ? (
        <span style={{ display: "inline-block", width: "2px", height: "13px", backgroundColor: "var(--origin-fg-muted)", verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
      ) : isUser ? (
        <div style={{ fontSize: "13px", color: "var(--origin-fg-default)", lineHeight: "1.65", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {message.content}
        </div>
      ) : parts && parts.length > 0 ? (
        <>
          {parts.map((part, i) => {
            if (part.type === "plan-card") {
              return (
                <PlanCard
                  key={i}
                  plan={part.plan}
                  status={part.status}
                  onApprove={part.status === "pending" ? (onPlanApprove ?? (() => {})) : undefined}
                  onReject={part.status === "pending" ? (onPlanReject ?? (() => {})) : undefined}
                />
              );
            }
            if (part.type === "tool-call") {
              return <ToolCallCard key={part.tc.id} tc={part.tc} />;
            }
            if (!part.content) return null;
            const isLastPart = i === parts.length - 1;
            return (
              <MarkdownMessage
                key={i}
                content={part.content}
                isStreaming={isLastPart && message.streaming}
                onApplyCode={onApplyCode ? makeApplyCode : undefined}
              />
            );
          })}
        </>
      ) : message.content ? (
        <MarkdownMessage
          content={message.content}
          isStreaming={message.streaming}
          onApplyCode={onApplyCode ? makeApplyCode : undefined}
        />
      ) : null}

      {hasAttachments && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
          {message.editorContext && (
            <span style={badgeStyle}>
              <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
              <span>{message.editorContext.filename}</span>
              <span style={{ padding: "0 4px", borderRadius: "3px", fontSize: "10px", background: "var(--origin-bg-hover)", color: "var(--origin-fg-muted)" }}>
                {contextLabel(message.editorContext)}
              </span>
            </span>
          )}
          {message.fileMentions?.map(fp => {
            const fname = fp.split(/[/\\]/).pop() ?? fp;
            return (
              <span key={fp} style={badgeStyle}>
                <FileCode size={11} style={{ flexShrink: 0, color: "var(--origin-fg-muted)" }} />
                {fname}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
