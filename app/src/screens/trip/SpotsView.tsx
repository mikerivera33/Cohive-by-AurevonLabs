import { Reveal } from '../../lib/Reveal';
import { catChip, catColor, catLabel, chipStyle, press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';
import type { Category, Tier } from '../../types';

const TIER_BUTTONS: [Tier, string][] = [
  ['must', 'Must ★'],
  ['maybe', 'Maybe'],
  ['iftime', 'If time'],
];

export function SpotsView() {
  const { spots, setTier, catFilter, setCatFilter } = useApp();

  const cats: (Category | 'all')[] = ['all', ...new Set(spots.map((s) => s.category))];
  const visible = spots.filter((s) => catFilter === 'all' || s.category === catFilter);

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {cats.map((c) => (
          <button
            key={c}
            className="press"
            onClick={() => setCatFilter(c)}
            aria-pressed={catFilter === c}
            style={{ ...chipStyle(catFilter === c), ...press(0.95) }}
          >
            {c === 'all' ? 'All' : catLabel(c)}
          </button>
        ))}
      </div>

      {visible.map((s) => (
        <Reveal
          key={s.id}
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderLeft: `3px solid ${catColor(s.category)}`,
            borderRadius: 14,
            padding: '13px 14px',
            marginBottom: 9,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={catChip(s.category)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="grot" style={{ fontSize: 14.5 }}>
                {s.name}
              </b>
              <div style={{ fontSize: 11, color: 'var(--soft)', marginTop: 2 }}>
                {catLabel(s.category)} · {s.duration} min
                {s.cost ? ' · $' + s.cost : ''}
                {s.note ? ' · ' + s.note : ''}
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--soft)', whiteSpace: 'nowrap' }}>▲ {s.votes}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {TIER_BUTTONS.map(([t, label]) => {
              const on = s.tier === t;
              return (
                <button
                  key={t}
                  className="press grot"
                  onClick={() => setTier(s.id, t)}
                  aria-pressed={on}
                  style={{
                    ...press(0.94),
                    flex: 1,
                    fontWeight: 600,
                    fontSize: 10.5,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    borderRadius: 9,
                    padding: '8px 0',
                    cursor: 'pointer',
                    transition: 'all .18s ease',
                    border: on ? 'none' : '1px solid var(--line)',
                    background: on ? (t === 'must' ? 'var(--grad)' : 'var(--panelS)') : 'transparent',
                    color: on ? (t === 'must' ? 'var(--onGrad)' : 'var(--honey)') : 'var(--soft)',
                    boxShadow: on && t === 'must' ? 'var(--glow)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Reveal>
      ))}
    </>
  );
}
