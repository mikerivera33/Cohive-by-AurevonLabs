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
  const { tab, setTab, light } = useApp();

  return (
    <nav
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 'var(--safe-bottom, 26px)',
        zIndex: 30,
        display: 'flex',
        background: light ? 'rgba(255, 255, 255, 0.72)' : 'rgba(10, 18, 36, 0.55)',
        backdropFilter: 'blur(28px) saturate(1.35)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.35)',
        border: '1px solid var(--lineB)',
        borderRadius: 999,
        padding: 5,
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
              padding: '10px 0 9px',
              border: 'none',
              cursor: 'pointer',
              borderRadius: 999,
              transition: 'all .28s cubic-bezier(.2,.85,.25,1.1)',
              background: on ? 'var(--grad)' : 'transparent',
              color: on ? 'var(--onGrad)' : 'var(--soft)',
              boxShadow: on ? 'var(--glow)' : 'none',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 15,
                height: 15,
                background: 'currentColor',
                clipPath: clip,
                display: 'block',
                transform: on ? 'scale(1.08)' : 'scale(1)',
                transition: 'transform .28s cubic-bezier(.2,.85,.25,1.1)',
              }}
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
