import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '16px',
        background: 'var(--origin-bg-base)',
        color: 'var(--origin-fg-default)',
        fontFamily: 'monospace',
        padding: '32px',
      }}>
        <div style={{ fontSize: '18px', color: 'var(--origin-semantic-error)' }}>
          Something went wrong
        </div>
        <pre style={{
          maxWidth: '720px',
          maxHeight: '300px',
          overflow: 'auto',
          padding: '16px',
          background: 'var(--origin-bg-surface)',
          borderRadius: '6px',
          fontSize: '12px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {error.message}
          {error.stack ? '\n\n' + error.stack : ''}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            background: 'var(--origin-bg-surface)',
            color: 'var(--origin-fg-default)',
            border: '1px solid var(--origin-border-default)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
