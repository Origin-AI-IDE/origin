import { Sun, Moon, GitBranch, Settings } from 'lucide-react';
import { useTheme } from '../themes/ThemeContext';

interface Props {
  language: string;
  line: number;
  col: number;
  branch: string | null;
  onOpenSettings?: () => void;
  debugStatus?: 'paused' | 'running' | null;
}

function StatusItem({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '0 8px', height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '2px',
        transition: 'background 0.1s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        if (onClick) (e.currentTarget as HTMLElement).style.background = 'var(--origin-bg-hover)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </div>
  );
}

export default function StatusBar({ language, line, col, branch, onOpenSettings, debugStatus }: Props) {
  const { theme, themes, setTheme } = useTheme();
  const isDark = theme.type === 'dark';

  function toggleTheme() {
    const target = isDark
      ? themes.find(t => t.type === 'light')
      : themes.find(t => t.type === 'dark');
    if (target) setTheme(target);
  }

  return (
    <div
      style={{
        height: '22px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'var(--origin-bg-base)',
        borderTop: '1px solid var(--origin-border-default)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: 'var(--origin-fg-subtle)',
        userSelect: 'none',
        paddingLeft: '4px',
        paddingRight: '4px',
      }}
    >
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        {branch && (
          <StatusItem>
            <GitBranch size={11} />
            <span>{branch}</span>
          </StatusItem>
        )}
        {debugStatus && (
          <StatusItem>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              backgroundColor: debugStatus === 'paused'
                ? 'var(--origin-accent-yellow)'
                : 'var(--origin-semantic-success)',
            }} />
            <span>{debugStatus === 'paused' ? 'Paused' : 'Running'}</span>
          </StatusItem>
        )}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <StatusItem>
          <span>{language}</span>
        </StatusItem>
        <StatusItem>
          <span>Ln {line}, Col {col}</span>
        </StatusItem>
        <StatusItem>
          <span>UTF-8</span>
        </StatusItem>
        <StatusItem
          onClick={onOpenSettings}
          title="Settings (Ctrl+,)"
        >
          <Settings size={11} />
        </StatusItem>
        <StatusItem
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {isDark
            ? <Sun size={11} />
            : <Moon size={11} />
          }
        </StatusItem>
      </div>
    </div>
  );
}
