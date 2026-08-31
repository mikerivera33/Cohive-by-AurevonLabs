import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';

export function AppHeader() {
  const { planTier, toggleTheme } = useApp();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 'var(--safe-top, 42px) 18px 10px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg)',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div className="hex" aria-hidden style={{ width: 24, height: 24, background: 'var(--grad)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span className="grot" style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}>
          Cohive
        </span>
        <span
          style={{
            fontSize: 7,
            letterSpacing: '.26em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginTop: 3,
          }}
        >
          by AurevonLabs
        </span>
      </div>
      <span
        className="grot"
        style={{
          marginLeft: 'auto',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--honey)',
          border: '1px solid var(--lineB)',
          borderRadius: 99,
          padding: '4px 10px',
        }}
      >
        {planTier}
      </span>
      <button
        className="press"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        style={{
          ...press(0.92),
          width: 32,
          height: 32,
          borderRadius: 99,
          border: '1px solid var(--lineB)',
          background: 'var(--panelS)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 13,
            height: 13,
            borderRadius: 99,
            background: 'var(--grad)',
            boxShadow: 'var(--glow)',
            display: 'block',
          }}
        />
      </button>
    </header>
  );
}
