import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';

export function AppHeader() {
  const { planTier, toggleTheme, openPricing } = useApp();

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 'var(--safe-top, 42px) 18px 12px',
        borderBottom: '1px solid transparent',
        background: 'linear-gradient(180deg, var(--bg) 55%, transparent)',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div
        className="hex"
        aria-hidden
        style={{
          width: 24,
          height: 24,
          background: 'var(--grad)',
          boxShadow: 'var(--glow)',
          animation: 'cvglow 4.5s ease-in-out infinite',
        }}
      />
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
      <button
        type="button"
        className="press grot"
        onClick={openPricing}
        aria-label={`Current plan ${planTier}. Open plans`}
        style={{
          ...press(0.96),
          marginLeft: 'auto',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          color: 'var(--honey)',
          border: '1px solid var(--lineB)',
          borderRadius: 99,
          minHeight: 44,
          padding: '0 14px',
          background: 'var(--panel)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          cursor: 'pointer',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}
      >
        {planTier}
      </button>
      <button
        type="button"
        className="press tapTarget"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        style={{
          ...press(0.92),
          width: 44,
          height: 44,
          borderRadius: 99,
          border: '1px solid var(--lineB)',
          background: 'var(--panel)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
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
