import { useRef, useState } from 'react';
import { X, File, GitCompare } from 'lucide-react';
import { fileColor } from '../../lib/fileColors';

export interface Tab {
  path: string;   // for ai-diff tabs: "__diff__<approvalId>"
  name: string;
  isDirty: boolean;
  isUntitled?: boolean;
  kind?: 'file' | 'ai-diff';
  // ai-diff only
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
  approve?: () => void;
  reject?: () => void;
}

interface Props {
  tabs: Tab[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

function TabItem({ tab, active, onSelect, onClose }: { tab: Tab; active: boolean; onSelect: () => void; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);

  function handleAuxClick(e: React.MouseEvent) {
    if (e.button === 1) { e.preventDefault(); onClose(); }
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    onClose();
  }

  const showClose = active || hovered || tab.isDirty;

  return (
    <div
      onClick={onSelect}
      onAuxClick={handleAuxClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '0 10px 0 12px',
        height: '100%',
        minWidth: '80px', maxWidth: '180px',
        flexShrink: 0,
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
        background: active ? 'var(--origin-bg-editor)' : 'transparent',
        borderRight: '1px solid var(--origin-border-default)',
        borderTop: active ? '2px solid var(--origin-accent-blue)' : '2px solid transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Icon: diff badge, dirty dot, or file icon */}
      {tab.kind === 'ai-diff'
        ? <GitCompare size={13} style={{ flexShrink: 0, color: 'rgba(46,160,67,0.9)' }} />
        : tab.isDirty
          ? <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--origin-fg-muted)', flexShrink: 0 }} />
          : <File size={13} style={{ flexShrink: 0, color: fileColor(tab.name) }} />
      }

      {/* File name */}
      <span style={{
        fontSize: '12px', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: active ? 'var(--origin-fg-default)' : 'var(--origin-fg-muted)',
        fontWeight: active ? 500 : 400,
        fontStyle: tab.isUntitled ? 'italic' : 'normal',
      }}>
        {tab.name}
      </span>

      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '16px', height: '16px', flexShrink: 0,
          border: 'none', borderRadius: '4px', padding: 0,
          background: 'transparent', cursor: 'pointer',
          color: 'var(--origin-fg-muted)',
          opacity: showClose ? 1 : 0,
          transition: 'opacity 0.1s, background 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-default)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--origin-fg-muted)'; }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

export default function TabBar({ tabs, activeTab, onSelect, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleWheel(e: React.WheelEvent) {
    if (scrollRef.current) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  }

  return (
    <div
      style={{
        height: '36px', flexShrink: 0,
        display: 'flex', alignItems: 'stretch',
        backgroundColor: 'var(--origin-bg-base)',
        borderBottom: '1px solid var(--origin-border-default)',
      }}
    >
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        style={{
          display: 'flex', alignItems: 'stretch',
          overflowX: 'auto', overflowY: 'hidden',
          flex: 1,
          scrollbarWidth: 'none',
        }}
      >
        {tabs.map(tab => (
          <TabItem
            key={tab.path}
            tab={tab}
            active={tab.path === activeTab}
            onSelect={() => onSelect(tab.path)}
            onClose={() => onClose(tab.path)}
          />
        ))}
      </div>
    </div>
  );
}
