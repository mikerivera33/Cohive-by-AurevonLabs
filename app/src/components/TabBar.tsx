import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';
import type { TabId } from '../types';

const TABS: [TabId, string, string][] = [
  ['home', 'Hive', 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)'],
  ['trip', 'Trip', 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)'],
  ['nest', 'Nest', 'circle(50% at 50% 50%)'],
  ['table', 'Table', 'inset(8% round 28%)'],
  ['you', 'You', 'circle(38% at 50% 42%)'],
];

export function TabBar() {
  const { tab, setTab } = useApp();

  return (
    <nav
      className="panelCard"
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 'var(--safe-bottom, 26px)',
        zIndex: 30,
        display: 'flex',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid var(--lineB)',
        borderRadius: 24,
        padding: 7,
        boxShadow: 'var(--shadow)',
      }}
    >
      {TABS.map(([id, label, clip]) => {
        const on = tab === id;
        return (
          <button
            key={id}
            className="press"
            onClick={() => setTab(id)}
            aria-current={on ? 'page' : undefined}
            style={{
              ...press(0.92),
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '9px 0 8px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 18,
              transition: 'all .22s cubic-bezier(.2,.9,.25,1.2)',
              background: on ? 'var(--grad)' : 'transparent',
              color: on ? 'var(--onGrad)' : 'var(--soft)',
              boxShadow: on ? 'var(--glow)' : 'none',
            }}
          >
            <span
              aria-hidden
              style={{ width: 15, height: 15, background: 'currentColor', clipPath: clip, display: 'block' }}
            />
            <span className="grot" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.06em' }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
