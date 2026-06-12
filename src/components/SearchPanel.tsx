import { useState, useEffect, useRef } from 'react';
import { Search, File } from 'lucide-react';
import { searchInFiles, type SearchMatch } from '../lib/search';
import { fileColor } from '../lib/fileColors';
import { useWorkspace } from '../context/WorkspaceContext';

interface Props {
  onFileOpenAtLine: (path: string, line: number, col: number) => void;
}

interface Group {
  path: string;
  name: string;
  rel: string;
  matches: SearchMatch[];
}

function groupResults(matches: SearchMatch[], base: string | null): Group[] {
  const map = new Map<string, Group>();
  for (const m of matches) {
    if (!map.has(m.path)) {
      const name = m.path.split(/[/\\]/).pop() ?? m.path;
      const rel = base && m.path.startsWith(base)
        ? m.path.slice(base.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
        : m.path;
      map.set(m.path, { path: m.path, name, rel, matches: [] });
    }
    map.get(m.path)!.matches.push(m);
  }
  return [...map.values()];
}

function MatchLine({ match, query, onOpen }: { match: SearchMatch; query: string; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  const lc = match.text.toLowerCase();
  const ql = query.toLowerCase();
  const idx = lc.indexOf(ql);

  const highlighted = idx !== -1 ? (
    <>
      {match.text.slice(0, idx)}
      <mark style={{ background: 'var(--origin-accent-blue)', color: 'var(--origin-bg-base)', borderRadius: 2, padding: '0 1px' }}>
        {match.text.slice(idx, idx + query.length)}
      </mark>
      {match.text.slice(idx + query.length)}
    </>
  ) : match.text;

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        padding: '2px 10px 2px 24px', cursor: 'pointer',
        background: hovered ? 'var(--origin-bg-hover)' : 'transparent',
        transition: 'background 0.08s',
      }}
    >
      <span style={{
        fontSize: 10, color: 'var(--origin-fg-subtle)', flexShrink: 0,
        fontFamily: 'var(--font-mono)', minWidth: 26, textAlign: 'right',
      }}>
        {match.line}
      </span>
      <span style={{
        fontSize: 12, color: 'var(--origin-fg-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontFamily: 'var(--font-mono)',
      }}>
        {highlighted}
      </span>
    </div>
  );
}

export default function SearchPanel({ onFileOpenAtLine }: Props) {
  const { folderPath } = useWorkspace();
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim() || !folderPath) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      searchInFiles(folderPath, query)
        .then(r => { setResults(r); setLoading(false); })
        .catch(() => setLoading(false));
    }, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, folderPath]);

  const groups = groupResults(results, folderPath);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Section label */}
      <div style={{
        padding: '10px 12px 6px', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.8px', textTransform: 'uppercase',
        color: 'var(--origin-fg-muted)',
      }}>
        Search
      </div>

      {/* Input */}
      <div style={{ padding: '0 8px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--origin-bg-input)',
          border: '1px solid var(--origin-border-default)',
          borderRadius: 6, padding: '5px 8px',
        }}>
          <Search
            size={12}
            style={{
              color: 'var(--origin-fg-muted)', flexShrink: 0,
              opacity: loading ? 0.4 : 1,
              animation: loading ? 'pulse 1s ease-in-out infinite' : 'none',
            }}
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search files…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 12, color: 'var(--origin-fg-default)', fontFamily: 'var(--font-sans)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--origin-fg-subtle)', padding: 0, fontSize: 14, lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Results summary */}
      {results.length > 0 && (
        <div style={{ padding: '0 12px 4px', fontSize: 10, color: 'var(--origin-fg-subtle)' }}>
          {results.length}{results.length >= 500 ? '+' : ''} result{results.length !== 1 ? 's' : ''} in {groups.length} file{groups.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Result list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!folderPath && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--origin-fg-subtle)', textAlign: 'center' }}>
            Open a folder to search
          </div>
        )}

        {folderPath && query.trim() && !loading && results.length === 0 && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--origin-fg-subtle)', textAlign: 'center' }}>
            No results for "{query}"
          </div>
        )}

        {groups.map(group => (
          <div key={group.path}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 10px 2px', fontSize: 12, fontWeight: 500,
              color: 'var(--origin-fg-default)',
              position: 'sticky', top: 0,
              background: 'var(--origin-bg-sidebar)',
            }}>
              <File size={12} style={{ color: fileColor(group.name), flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {group.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--origin-fg-subtle)', flexShrink: 0 }}>
                {group.matches.length}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--origin-fg-subtle)', padding: '0 10px 3px 24px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {group.rel}
            </div>
            {group.matches.map((m, i) => (
              <MatchLine
                key={i}
                match={m}
                query={query}
                onOpen={() => onFileOpenAtLine(m.path, m.line, m.col + 1)}
              />
            ))}
          </div>
        ))}

        {results.length >= 500 && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--origin-fg-subtle)', fontStyle: 'italic' }}>
            Showing first 500 matches — refine your query to narrow results
          </div>
        )}
      </div>
    </div>
  );
}
