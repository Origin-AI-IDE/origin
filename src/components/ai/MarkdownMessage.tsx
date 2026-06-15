import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { Check, Copy, Wand2 } from "lucide-react";
import type { Components } from "react-markdown";

interface Props {
  content: string;
  isStreaming?: boolean;
  onApplyCode?: (code: string, language: string, filePath?: string) => void;
}

function findFilePathFor(rawContent: string, code: string): string | undefined {
  const idx = rawContent.indexOf(code);
  if (idx === -1) return undefined;
  const before = rawContent.slice(0, idx);
  // Allow optional blank lines / whitespace between the comment and the opening fence
  const m = /(?:\/\/|#) file: ([^\n]+)\n\s*```\w*\n?\s*$/.exec(before);
  if (m) return m[1].trim();
  // Also handle: comment is the very first line inside the code block
  const firstLine = code.split("\n")[0] ?? "";
  const m2 = /^(?:\/\/|#) file: (.+)$/.exec(firstLine.trim());
  return m2 ? m2[1].trim() : undefined;
}

function CodeBlock({
  language,
  code,
  rawContent,
  onApply,
}: {
  language: string;
  code: string;
  rawContent: string;
  onApply?: (code: string, lang: string, filePath?: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const filePath = findFilePathFor(rawContent, code);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      style={{
        margin: "10px 0",
        borderRadius: "6px",
        overflow: "hidden",
        border: "1px solid var(--origin-border-default)",
        backgroundColor: "var(--origin-bg-editor)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 8px 4px 12px",
          backgroundColor: "var(--origin-bg-hover)",
          borderBottom: "1px solid var(--origin-border-default)",
          gap: 4,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: "11px",
            color: "var(--origin-fg-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {language || "code"}
        </span>

        <button
          onClick={handleCopy}
          style={iconBtnStyle}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-default)";
            (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-bg-active)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--origin-fg-muted)";
            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>

        {onApply && (
          <button
            onClick={() => onApply(code, language, filePath)}
            style={applyBtnStyle}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--origin-accent-blue)";
              (e.currentTarget as HTMLElement).style.borderColor = "var(--origin-accent-blue)";
              (e.currentTarget as HTMLElement).style.color = "#fff";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(98,166,255,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(98,166,255,0.35)";
              (e.currentTarget as HTMLElement).style.color = "var(--origin-accent-blue)";
            }}
          >
            <Wand2 size={11} />
            <span>Apply</span>
          </button>
        )}
      </div>

      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          overflowX: "auto",
          fontSize: "12px",
          lineHeight: "1.6",
          fontFamily: "var(--font-mono)",
          color: "var(--origin-fg-default)",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: "11px",
  color: "var(--origin-fg-muted)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "2px 7px",
  borderRadius: 4,
  fontFamily: "var(--font-sans)",
};

const applyBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: "11px",
  color: "var(--origin-accent-blue)",
  backgroundColor: "rgba(98,166,255,0.12)",
  border: "1px solid rgba(98,166,255,0.35)",
  cursor: "pointer",
  padding: "2px 8px",
  borderRadius: 4,
  fontFamily: "var(--font-sans)",
};

export default function MarkdownMessage({ content, isStreaming, onApplyCode }: Props) {
  const components: Components = {
    pre({ children }) {
      return <>{children}</>;
    },

    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || "");
      const text = String(children).replace(/\n$/, "");
      const isBlock = !!match || text.includes("\n");

      if (isBlock) {
        return (
          <CodeBlock
            language={match?.[1] ?? ""}
            code={text}
            rawContent={content}
            onApply={!isStreaming ? onApplyCode : undefined}
          />
        );
      }

      return (
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            backgroundColor: "var(--origin-bg-hover)",
            border: "1px solid var(--origin-border-default)",
            borderRadius: "3px",
            padding: "1px 5px",
            color: "var(--origin-fg-default)",
          }}
        >
          {children}
        </code>
      );
    },

    h1: ({ children }) => <h1 style={headingStyle(16, 600)}>{children}</h1>,
    h2: ({ children }) => <h2 style={headingStyle(14, 600)}>{children}</h2>,
    h3: ({ children }) => <h3 style={headingStyle(13, 600)}>{children}</h3>,

    p: ({ children }) => (
      <p style={{ margin: "4px 0 8px", lineHeight: 1.65 }}>{children}</p>
    ),

    ul: ({ children }) => (
      <ul style={{ margin: "4px 0 8px", paddingLeft: 20, lineHeight: 1.65 }}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ margin: "4px 0 8px", paddingLeft: 20, lineHeight: 1.65 }}>{children}</ol>
    ),
    li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,

    strong: ({ children }) => (
      <strong style={{ fontWeight: 600, color: "var(--origin-fg-default)" }}>{children}</strong>
    ),
    em: ({ children }) => (
      <em style={{ fontStyle: "italic", color: "var(--origin-fg-muted)" }}>{children}</em>
    ),

    blockquote: ({ children }) => (
      <blockquote
        style={{
          borderLeft: "2px solid var(--origin-border-default)",
          paddingLeft: 12,
          margin: "8px 0",
          color: "var(--origin-fg-muted)",
        }}
      >
        {children}
      </blockquote>
    ),

    hr: () => (
      <hr
        style={{
          border: "none",
          borderTop: "1px solid var(--origin-border-default)",
          margin: "12px 0",
        }}
      />
    ),

    a: ({ href, children }) => (
      <a href={href} style={{ color: "var(--origin-accent-blue)", textDecoration: "underline" }}>
        {children}
      </a>
    ),

    table: ({ children }) => (
      <div style={{ overflowX: "auto", margin: "8px 0" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "12px", width: "100%" }}>
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th
        style={{
          border: "1px solid var(--origin-border-default)",
          padding: "4px 10px",
          backgroundColor: "var(--origin-bg-hover)",
          fontWeight: 600,
          textAlign: "left",
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td style={{ border: "1px solid var(--origin-border-default)", padding: "4px 10px" }}>
        {children}
      </td>
    ),
  };

  return (
    <div style={{ fontSize: "13px", color: "var(--origin-fg-default)", lineHeight: 1.65 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function headingStyle(size: number, weight: number): React.CSSProperties {
  return {
    fontSize: `${size}px`,
    fontWeight: weight,
    color: "var(--origin-fg-default)",
    margin: "12px 0 4px",
    lineHeight: 1.4,
  };
}
