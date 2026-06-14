import { useEffect, useRef } from 'react';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { Check, X } from 'lucide-react';
import { originBaseTheme, originHighlight } from './Editor';
import { getLanguageExtension } from './languageSupport';

export interface AiDiffTabData {
  path: string;           // "__diff__<approvalId>" — unique tab key
  filePath: string;       // actual file being changed
  originalContent: string;
  proposedContent: string;
  approve: () => void;
  reject: () => void;
}

interface Props {
  tab: AiDiffTabData;
  onClose: () => void;
}

export default function AiDiffPane({ tab, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: tab.proposedContent,
      extensions: [
        lineNumbers(),
        syntaxHighlighting(originHighlight),
        getLanguageExtension(tab.filePath),
        // Merge view is baked in from construction — no post-mount mutation
        unifiedMergeView({
          original: tab.originalContent,
          mergeControls: false,
          highlightChanges: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
        }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        originBaseTheme,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    return () => view.destroy();
  // tab.path is unique per approval — recreate view only if a new diff is opened
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path]);

  const fileName = tab.filePath.split(/[\\/]/).filter(Boolean).pop() ?? tab.filePath;

  function handleApprove() {
    tab.approve();
    onClose();
  }

  function handleReject() {
    tab.reject();
    onClose();
  }

  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '5px',
    padding: '4px 12px', fontSize: '12px', fontWeight: 500,
    borderRadius: '5px', border: '1px solid', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '7px 14px',
        borderBottom: '1px solid var(--origin-border-default)',
        backgroundColor: 'var(--origin-bg-panel)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', color: 'var(--origin-fg-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Review AI changes:{' '}
          <span style={{ color: 'var(--origin-fg-default)', fontWeight: 500 }}>{fileName}</span>
        </span>

        <button
          onClick={handleReject}
          style={{
            ...btnBase,
            background: 'transparent',
            borderColor: 'color-mix(in srgb, var(--origin-semantic-error) 40%, transparent)',
            color: 'var(--origin-semantic-error)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--origin-semantic-error) 8%, transparent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <X size={12} />
          Reject
        </button>

        <button
          onClick={handleApprove}
          style={{
            ...btnBase,
            background: 'color-mix(in srgb, var(--origin-semantic-success) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--origin-semantic-success) 50%, transparent)',
            color: 'var(--origin-semantic-success)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--origin-semantic-success) 22%, transparent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--origin-semantic-success) 12%, transparent)'; }}
        >
          <Check size={12} />
          Accept
        </button>
      </div>

      {/* Read-only diff view */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--origin-bg-editor)' }}
      />
    </div>
  );
}
