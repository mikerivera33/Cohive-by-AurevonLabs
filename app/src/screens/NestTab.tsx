import { useMemo, useState } from 'react';

import { MapPreview } from '../components/MapPreview';
import type { MapMarker } from '../components/LazyMap';
import { NYC_NEST_CENTER } from '../engine/seed';
import { Reveal } from '../lib/Reveal';
import { press } from '../lib/styles';
import { useApp } from '../store/AppStore';
import type { ReactionEmoji } from '../types';

const REACTIONS: ReactionEmoji[] = ['💍', '🪴'];

export function NestTab() {
  const { nest, light, toggleReaction, say } = useApp();
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number; nonce: number } | null>(null);

  const markers = useMemo<MapMarker[]>(
    () => nest.map((n) => ({ lat: n.lat, lng: n.lng, color: '#A78BFA', label: n.title })),
    [nest]
  );

  return (
    <div style={{ animation: 'cvrise .4s cubic-bezier(.2,.9,.25,1.1) both' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, margin: '4px 0 3px' }}>
        <h1 className="grot" style={{ fontWeight: 700, fontSize: 24, letterSpacing: '-.03em', margin: 0 }}>
          The Apartment Hunt
        </h1>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--violet)',
          }}
        >
          Nest
        </span>
      </div>
      <p style={{ color: 'var(--soft)', fontSize: 12.5, margin: '0 0 14px' }}>
        NYC · you + Maya · {nest.length} listings saved
      </p>

      <MapPreview
        id="map-nest"
        center={NYC_NEST_CENTER}
        zoom={11}
        markers={markers}
        height={190}
        light={light}
        focus={focus}
        style={{ marginBottom: 14 }}
      />

      {nest.map((n) => (
        <Reveal
          key={n.id}
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 28,
            padding: '15px 16px',
            marginBottom: 11,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: 4,
              borderRadius: '0 8px 8px 0',
              background: 'var(--violet)',
            }}
          />

          {n.tagged && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--violet)',
                background: 'rgba(167,139,250,.1)',
                border: '1px solid rgba(167,139,250,.3)',
                borderRadius: 9,
                padding: '7px 11px',
                marginBottom: 10,
              }}
            >
              {n.tagged}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <b className="grot" style={{ fontSize: 15, flex: 1 }}>
              {n.title}
            </b>
            <b className="grot" style={{ fontSize: 15.5, color: 'var(--honey)', whiteSpace: 'nowrap' }}>
              ${n.price.toLocaleString()}/mo
            </b>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--soft)', margin: '4px 0 8px' }}>
            {n.beds}bd · {n.baths}ba · {n.sqft} sqft · {n.hood} ·{' '}
            <span style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 9.5, fontWeight: 600 }}>
              {n.source}
            </span>
          </div>
          <p style={{ fontSize: 12.5, margin: '0 0 11px', color: 'var(--ink)' }}>{n.note}</p>

          <div style={{ display: 'flex', gap: 7 }}>
            {REACTIONS.map((em) => {
              const mine = n.reactions[em].includes('You');
              const count = n.reactions[em].length;
              return (
                <button
                  key={em}
                  className="press"
                  onClick={() => toggleReaction(n.id, em)}
                  aria-pressed={mine}
                  aria-label={`React ${em} to ${n.title}`}
                  style={{
                    ...press(0.9),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    borderRadius: 99,
                    padding: '6px 13px',
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all .18s ease',
                    border: mine ? '1px solid var(--honey)' : '1px solid var(--line)',
                    background: mine ? 'rgba(78,180,255,.14)' : 'transparent',
                    color: 'var(--ink)',
                  }}
                >
                  {`${em} ${count || ''}`.trim()}
                </button>
              );
            })}
            <button
              className="grot"
              onClick={() => {
                setFocus({ lat: n.lat, lng: n.lng, zoom: 14, nonce: Date.now() });
                say('Pinned ' + n.hood);
              }}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: '1px solid var(--line)',
                color: 'var(--soft)',
                borderRadius: 99,
                padding: '6px 13px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Pin on map
            </button>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
