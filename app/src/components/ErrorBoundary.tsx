import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render error anywhere below lands here instead of
 * white-screening the app. Styled with raw values, not theme tokens, so it
 * still renders if the theming layer itself is what broke.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cohive crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          padding: 30,
          textAlign: 'center',
          background: '#060B18',
          color: '#EDF2FA',
          fontFamily: "'Outfit', system-ui, sans-serif",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            background: 'linear-gradient(125deg,#6EC4FF,#1B4FD8)',
            clipPath: 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)',
          }}
        />
        <b style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", fontSize: 20 }}>
          The hive hit a snag.
        </b>
        <p style={{ margin: 0, fontSize: 14, color: '#8B98B0', maxWidth: '34ch', lineHeight: 1.5 }}>
          Something went wrong on our side. Your plans are safe — reload to pick up where you left off.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 6,
            background: 'linear-gradient(125deg,#6EC4FF,#1B4FD8)',
            color: '#041018',
            border: 'none',
            borderRadius: 14,
            padding: '13px 26px',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 700,
            fontSize: 12.5,
            letterSpacing: '.09em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Reload Cohive
        </button>
      </div>
    );
  }
}
