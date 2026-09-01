import { useMemo } from 'react';

import { LazyMap } from '../components/LazyMap';
import type { MapMarker } from '../components/LazyMap';
import { Reveal } from '../lib/Reveal';
import { catColor, memberDot, press } from '../lib/styles';
import { TOKYO_CENTER } from '../engine/seed';
import { useApp } from '../store/AppStore';
import type { TabId } from '../types';

interface HiveCard {
  name: string;
  kind: string;
  desc: string;
  accent: string;
  tab: TabId;
  dots: string[];
  stat1: string;
  stat1l: string;
  stat2: string;
  stat2l: string;
}

const greeting = (): string => {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning.' : hr < 18 ? 'Good afternoon.' : 'Good evening.';
};

export function HomeTab() {
  const { spots, nest, table, activity, members, light, setTab } = useApp();

  const markers = useMemo<MapMarker[]>(
    () => spots.map((s) => ({ lat: s.lat, lng: s.lng, color: catColor(s.category), label: s.name })),
    [spots]
  );

  const cards: HiveCard[] = [
    {
      name: 'Tokyo Crew',
      kind: 'Bucketlist · Trip',
      desc: 'Sep 1–4 · itinerary in progress',
      accent: 'var(--honey)',
      tab: 'trip',
      dots: ['#F5A524', '#A78BFA', '#34D399'],
      stat1: String(spots.length),
      stat1l: 'spots',
      stat2: String(spots.filter((x) => x.tier === 'must').length),
      stat2l: 'must-dos',
    },
    {
      name: 'The Apartment Hunt',
      kind: 'Nest · Home',
      desc: 'NYC · 2BRs under $4k trending',
      accent: '#A78BFA',
      tab: 'nest',
      dots: ['#F5A524', '#A78BFA'],
      stat1: String(nest.length),
      stat1l: 'listings',
      stat2: String(nest.reduce((a, n) => a + n.reactions['💍'].length, 0)),
      stat2l: '💍 reactions',
    },
    {
      name: 'Date Night',
      kind: 'Table · Dinners',
      desc: 'Lilia is winning the vote',
      accent: '#F472B6',
      tab: 'table',
      dots: ['#F5A524', '#A78BFA'],
      stat1: String(table.length),
      stat1l: 'places',
      stat2: String(table.filter((t) => t.tried).length),
      stat2l: 'tried',
    },
  ];

  return (
    <div style={{ animation: 'cvrise .4s cubic-bezier(.2,.9,.25,1.1) both' }}>
      <h1 className="grot" style={{ fontWeight: 700, fontSize: 29, letterSpacing: '-.03em', margin: '8px 0 4px' }}>
        {greeting()}
      </h1>
      <p style={{ color: 'var(--soft)', fontSize: 14, margin: '0 0 16px' }}>
        Three hives are buzzing. Here’s where the plans stand.
      </p>

      <div
        style={{
          position: 'relative',
          border: '1px solid var(--lineB)',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: 'var(--shadow)',
          marginBottom: 16,
        }}
      >
        <LazyMap id="map-home" center={TOKYO_CENTER} zoom={11} markers={markers} height={180} light={light} />
        <div
          className="panelCard"
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            zIndex: 400,
            display: 'flex',
            gap: 12,
            alignItems: 'baseline',
            borderRadius: 12,
            padding: '7px 13px',
            fontSize: 11,
            color: 'var(--soft)',
          }}
        >
          <b className="grot" style={{ fontSize: 12, color: 'var(--honey)' }}>
            Tokyo Adventure
          </b>
          <span>
            <b className="grot" style={{ color: 'var(--ink)' }}>
              {spots.length}
            </b>{' '}
            spots live
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {cards.map((hv) => (
          <Reveal
            as="button"
            key={hv.name}
            className="panelCard press"
            onClick={() => setTab(hv.tab)}
            style={{
              ...press(0.98),
              textAlign: 'left',
              borderRadius: 18,
              padding: '17px 18px',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              color: 'var(--ink)',
              fontFamily: "'Outfit', system-ui, sans-serif",
            }}
          >
            <div style={{ position: 'absolute', inset: '0 auto 0 0', width: 3, background: hv.accent }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                className="hex"
                aria-hidden
                style={{ width: 36, height: 36, flexShrink: 0, background: hv.accent, opacity: 0.9 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <b className="grot" style={{ fontSize: 16.5 }}>
                    {hv.name}
                  </b>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      color: 'var(--soft)',
                    }}
                  >
                    {hv.kind}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--soft)', marginTop: 3 }}>{hv.desc}</div>
              </div>
              <div style={{ display: 'flex' }}>
                {hv.dots.map((c, i) => (
                  <span
                    key={c + i}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 99,
                      background: c,
                      border: '2px solid var(--bg)',
                      marginLeft: i ? -7 : 0,
                      display: 'inline-block',
                    }}
                  />
                ))}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 13,
                paddingTop: 12,
                borderTop: '1px dashed var(--line)',
                fontSize: 12,
                color: 'var(--soft)',
              }}
            >
              <span>
                <b className="grot" style={{ color: 'var(--honey)' }}>
                  {hv.stat1}
                </b>{' '}
                {hv.stat1l}
              </span>
              <span>
                <b className="grot" style={{ color: 'var(--honey)' }}>
                  {hv.stat2}
                </b>{' '}
                {hv.stat2l}
              </span>
              <span className="grot" style={{ marginLeft: 'auto', color: 'var(--honey)', fontWeight: 600 }}>
                Open →
              </span>
            </div>
          </Reveal>
        ))}
      </div>

      <h2 className="sectionTitle" style={{ margin: '28px 0 4px' }}>
        Hive activity
      </h2>
      {activity.map((a, i) => (
        <Reveal
          key={a.who + a.what + i}
          style={{
            display: 'flex',
            gap: 10,
            padding: '12px 0',
            borderBottom: '1px solid var(--line)',
            fontSize: 13.5,
          }}
        >
          <span style={memberDot(members.find((m) => m.name === a.who)?.color || '#F5A524')} />
          <span style={{ color: 'var(--soft)' }}>
            <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{a.who}</b> {a.what}
            <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{a.when}</span>
          </span>
        </Reveal>
      ))}
    </div>
  );
}
