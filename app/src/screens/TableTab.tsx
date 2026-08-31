import { useMemo } from 'react';

import { MapView } from '../components/MapView';
import type { MapMarker } from '../components/MapView';
import { NYC_TABLE_CENTER } from '../engine/seed';
import { Reveal } from '../lib/Reveal';
import { chipStyle, press } from '../lib/styles';
import { useApp } from '../store/AppStore';
import type { Tier } from '../types';

const TABLE_CHIP_FILL = 'linear-gradient(120deg,#F472B6,#E2691B)';

const TIER_META: Record<Tier, [string, string]> = {
  must: ['Must', 'var(--honey)'],
  maybe: ['Maybe', 'var(--soft)'],
  iftime: ['If time', 'var(--soft)'],
};

export function TableTab() {
  const { table, light, say, openPricing, bookingUnlocked, tableFilter: filter, setTableFilter: setFilter } =
    useApp();

  const markers = useMemo<MapMarker[]>(
    () => table.map((t) => ({ lat: t.lat, lng: t.lng, color: '#F472B6', label: t.name })),
    [table]
  );

  // Derived from the data so every mood present is actually reachable.
  const filters = useMemo(() => ['All', ...new Set(table.map((t) => t.mood)), 'Untried'], [table]);

  const visible = table.filter(
    (t) => filter === 'All' || (filter === 'Untried' ? !t.tried : t.mood === filter)
  );

  const onReserve = (name: string) => {
    if (!bookingUnlocked) {
      openPricing();
      return;
    }
    say('Requesting a table at ' + name + '…');
  };

  return (
    <div style={{ animation: 'cvrise .4s cubic-bezier(.2,.9,.25,1.1) both' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '4px 0 3px' }}>
        <h1 className="grot" style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.03em', margin: 0 }}>
          Date Night
        </h1>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--pink)',
          }}
        >
          Table
        </span>
      </div>
      <p style={{ color: 'var(--soft)', fontSize: 12.5, margin: '0 0 14px' }}>
        The list that survives the group chat · {table.length} places
      </p>

      <div
        style={{
          border: '1px solid var(--lineB)',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: 'var(--shadow)',
          marginBottom: 14,
        }}
      >
        <MapView id="map-table" center={NYC_TABLE_CENTER} zoom={12} markers={markers} height={170} light={light} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {filters.map((f) => (
          <button
            key={f}
            className="press"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            style={{ ...chipStyle(filter === f, TABLE_CHIP_FILL), ...press(0.95) }}
          >
            {f}
          </button>
        ))}
      </div>

      {visible.map((t) => {
        const [tierLabel, tierColor] = TIER_META[t.tier];
        return (
          <Reveal
            key={t.id}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 16,
              padding: '14px 16px',
              marginBottom: 10,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: 3, background: 'var(--pink)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b className="grot" style={{ fontSize: 15 }}>
                {t.name}
              </b>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: tierColor,
                  border: `1px solid ${tierColor}`,
                  borderRadius: 99,
                  padding: '2px 8px',
                }}
              >
                {tierLabel}
              </span>
              {t.tried && (
                <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.1em', color: 'var(--mint)' }}>
                  TRIED ✓
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--soft)' }}>{t.price}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--soft)', margin: '4px 0 10px' }}>
              {t.cuisine} · {t.mood} · {t.hood} · {t.hours}
            </div>

            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button
                className="press ctaBtn"
                onClick={() => onReserve(t.name)}
                style={{
                  ...press(0.95),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 10,
                  padding: '8px 13px',
                  fontSize: 10.5,
                  letterSpacing: '.07em',
                }}
              >
                {bookingUnlocked ? 'Reserve' : '🔒 Reserve'}
              </button>
              <a
                href={
                  'https://www.yelp.com/search?find_desc=' +
                  encodeURIComponent(t.name) +
                  '&find_loc=New+York'
                }
                target="_blank"
                rel="noreferrer"
                className="ghostBtn"
                style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 10, padding: '7px 12px', letterSpacing: '.05em' }}
              >
                Yelp
              </a>
              <a
                href={'https://www.google.com/maps/search/' + encodeURIComponent(t.name + ' ' + t.hood + ' NYC')}
                target="_blank"
                rel="noreferrer"
                className="ghostBtn"
                style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 10, padding: '7px 12px', letterSpacing: '.05em' }}
              >
                Maps
              </a>
              <button
                className="grot"
                onClick={() => say(t.name + ' linked to your next open trip day')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--honey)',
                  fontWeight: 600,
                  fontSize: 10.5,
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  padding: '7px 4px',
                }}
              >
                + Trip day
              </button>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
