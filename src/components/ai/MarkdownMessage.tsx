import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useMemo } from "react";
import { Check, Copy, Wand2 } from "lucide-react";
import type { Components } from "react-markdown";

interface Props {
  content: string;
  isStreaming?: boolean;
  onApplyCode?: (code: string, language: string, filePath?: string) => void;
}

// Find the "// file: <path>" or "# file: <path>" line that appears immediately
// before this block's opening fence in the raw markdown source. The markdown
// AST strips that comment line into a sibling node, so we recover it by
// locating the code text in the original content and reading the line above it.
function findFilePathFor(rawContent: string, code: string): string | undefined {
  const idx = rawContent.indexOf(code);
  if (idx === -1) return undefined;
  const before = rawContent.slice(0, idx);
  // Match the last "// file:" / "# file:" line that sits just above the fence.
  const m = /(?:\/\/|#) file: ([^\n]+)\n```\w*\n?\s*$/.exec(before);
  return m ? m[1].trim() : undefined;
}

// Split content into markdown text segments and SEARCH/REPLACE block segments.
// Complete blocks (with >>>>>>> UPDATED) become 'sr-complete'; a trailing
// incomplete block (streaming in progress) becomes 'sr-partial'.
type Segment =
  | { type: 'markdown'; text: string }
  | { type: 'sr-complete'; filePath?: string; original: string; updated: string }
  | { type: 'sr-partial'; text: string };

function splitIntoSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const completeRe = /((?:(?:\/\/|#) file: ([^\n]+))\n)?<<<<<<< ORIGINAL\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> UPDATED/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = completeRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', text: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'sr-complete',
      filePath: match[2]?.trim(),
      original: match[3],
      updated: match[4],
    });
    lastIndex = completeRe.lastIndex;
  }

  const remaining = content.slice(lastIndex);
  const partialStart = remaining.indexOf('<<<<<<< ORIGINAL');
  if (partialStart !== -1) {
    if (partialStart > 0) segments.push({ type: 'markdown', text: remaining.slice(0, partialStart) });
    segments.push({ type: 'sr-partial', text: remaining.slice(partialStart) });
  } else if (remaining) {
    segments.push({ type: 'markdown', text: remaining });
  }

  return segments;
}

function SearchReplaceBlock({
  filePath,
  original,
  updated,
  onApply,
}: {
  filePath?: string;
  original: string;
  updated: string;
  onApply?: (original: string, updated: string, filePath?: string) => void;
}) {
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
      {/* Header */}
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
          {filePath || "code"}
        </span>
        {onApply && (
          <button
            onClick={() => onApply(original, updated, filePath)}
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

      {/* Updated code — plain, no diff colors */}
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
        <code>{updated}</code>
      </pre>
    </div>
  );
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
      {/* Header bar */}
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
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "var(--origin-fg-default)";
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "var(--origin-bg-active)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "var(--origin-fg-muted)";
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "transparent";
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>

        {onApply && (
          <button
            onClick={() => onApply(code, language, filePath)}
            style={applyBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "var(--origin-accent-blue)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "var(--origin-accent-blue)";
              (e.currentTarget as HTMLElement).style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "rgba(98,166,255,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "rgba(98,166,255,0.35)";
              (e.currentTarget as HTMLElement).style.color =
                "var(--origin-accent-blue)";
            }}
          >
            <Wand2 size={11} />
            <span>Apply</span>
          </button>
        )}
      </div>

      {/* Code body */}
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

export default function MarkdownMessage({
  content,
  isStreaming,
  onApplyCode,
}: Props) {
  const segments = useMemo(() => splitIntoSegments(content), [content]);

  const components: Components = {
    // Suppress the <pre> wrapper — our CodeBlock is already a styled block
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
      {segments.map((seg, i) => {
        if (seg.type === 'sr-complete') {
          return (
            <SearchReplaceBlock
              key={i}
              filePath={seg.filePath}
              original={seg.original}
              updated={seg.updated}
              onApply={onApplyCode
                ? (orig, upd, fp) =>
                    onApplyCode(
                      `<<<<<<< ORIGINAL\n${orig}\n=======\n${upd}\n>>>>>>> UPDATED`,
                      'diff',
                      fp,
                    )
                : undefined}
            />
          );
        }
        if (seg.type === 'sr-partial') {
          return (
            <div
              key={i}
              style={{
                margin: "10px 0",
                padding: "10px 14px",
                borderRadius: "6px",
                border: "1px solid var(--origin-border-default)",
                backgroundColor: "var(--origin-bg-editor)",
                fontSize: "11px",
                color: "var(--origin-fg-subtle)",
                fontFamily: "var(--font-mono)",
              }}
            >
              Generating changes…
            </div>
          );
        }
        if (!seg.text.trim()) return null;
        return (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
            {seg.text}
          </ReactMarkdown>
        );
      })}
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
