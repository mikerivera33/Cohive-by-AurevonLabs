import { useMemo } from 'react';

import { LazyMap } from '../../components/LazyMap';
import type { MapMarker } from '../../components/LazyMap';
import { TOKYO_CENTER } from '../../engine/seed';
import { Reveal } from '../../lib/Reveal';
import { catChip, catColor, catLabel, press } from '../../lib/styles';
import { useApp } from '../../store/AppStore';

const SAMPLE =
  'day 3 tokyo!! you HAVE to try Afuri Ramen Ebisu, then Nezu Museum is so underrated, sunset at Tokyo Tower 🍜';

export function TripMapView() {
  const { spots, light, addedIds, addSpotFromScan, scanText, setScanText, scanning, scanResult, scan } =
    useApp();

  const markers = useMemo<MapMarker[]>(
    () => spots.map((s) => ({ lat: s.lat, lng: s.lng, color: catColor(s.category), label: s.name })),
    [spots]
  );

  const mustCount = spots.filter((s) => s.tier === 'must').length;

  return (
    <>
      <div
        style={{
          position: 'relative',
          border: '1px solid var(--lineB)',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: 'var(--shadow)',
        }}
      >
        <LazyMap id="map-trip" center={TOKYO_CENTER} zoom={11} markers={markers} height={240} light={light} />
        <div
          className="panelCard"
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            zIndex: 400,
            display: 'flex',
            gap: 12,
            borderRadius: 12,
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--soft)',
          }}
        >
          <span>
            <b className="grot" style={{ fontSize: 15, color: 'var(--honey)' }}>
              {spots.length}
            </b>{' '}
            spots
          </span>
          <span>
            <b className="grot" style={{ fontSize: 15, color: 'var(--honey)' }}>
              {mustCount}
            </b>{' '}
            must-dos
          </span>
          <span>
            <b className="grot" style={{ fontSize: 15, color: 'var(--honey)' }}>
              4
            </b>{' '}
            days
          </span>
        </div>
      </div>

      <Reveal
        className="panelCard"
        style={{
          border: '1px solid var(--lineB)',
          borderRadius: 18,
          padding: 18,
          marginTop: 14,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 2, background: 'var(--grad)' }} />
        <h2 className="grot" style={{ fontWeight: 700, fontSize: 19, margin: '0 0 4px' }}>
          Drop a link.
          <br />
          <em className="gradText" style={{ fontStyle: 'normal' }}>
            We find the places.
          </em>
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--soft)', margin: '0 0 12px', lineHeight: 1.5 }}>
          A TikTok, a Reel, a blog, messy caption text — paste anything. The scanner always resolves a place;
          you just confirm it.
        </p>
        <textarea
          rows={3}
          value={scanText}
          onChange={(e) => setScanText(e.target.value)}
          placeholder={'“you HAVE to try Afuri Ramen Ebisu…” or https://tiktok.com/…'}
          aria-label="Link or caption to scan"
          style={{ resize: 'none' }}
        />
        <div style={{ display: 'flex', gap: 9, marginTop: 11, alignItems: 'center' }}>
          <button
            className="press ctaBtn"
            onClick={scan}
            style={{ ...press(0.96), borderRadius: 12, padding: '12px 20px', fontSize: 12, letterSpacing: '.09em' }}
          >
            Scan &amp; detect
          </button>
          <button
            className="grot"
            onClick={() => setScanText(SAMPLE)}
            style={{
              background: 'none',
              border: '1px solid var(--lineB)',
              color: 'var(--soft)',
              borderRadius: 12,
              padding: '11px 14px',
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Sample
          </button>
        </div>

        {scanning && (
          <>
            <div
              style={{
                marginTop: 14,
                height: 4,
                borderRadius: 99,
                background: 'var(--bg2)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '45%',
                  background: 'var(--grad)',
                  borderRadius: 99,
                  animation: 'cvscan 1s linear infinite',
                }}
              />
            </div>
            <p
              style={{
                fontSize: 11.5,
                color: 'var(--soft)',
                margin: '8px 0 0',
                animation: 'cvpulse 1.2s ease infinite',
              }}
            >
              Reading the link · mining places · geocoding…
            </p>
          </>
        )}

        {scanResult && !scanning && (
          <div style={{ marginTop: 14, borderTop: '1px dashed var(--lineB)', paddingTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--soft)',
                marginBottom: 9,
              }}
            >
              Detected via <span style={{ color: 'var(--honey)' }}>{scanResult.source}</span>
            </div>
            {scanResult.candidates.map((c) => {
              const added = addedIds.includes(c.name);
              return (
                <div
                  key={c.name}
                  style={{
                    background: 'var(--bg2)',
                    border: '1px solid var(--line)',
                    borderRadius: 13,
                    padding: '12px 13px',
                    marginBottom: 8,
                    animation: 'cvpop .35s ease both',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={catChip(c.category)} />
                    <b className="grot" style={{ fontSize: 14, flex: 1 }}>
                      {c.name}
                    </b>
                    {added ? (
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: 'var(--mint)' }}>
                        ADDED ✓
                      </span>
                    ) : (
                      <button
                        className="press grot"
                        onClick={() => addSpotFromScan(c, scanResult.source)}
                        style={{
                          ...press(0.94),
                          background: 'var(--grad)',
                          color: 'var(--onGrad)',
                          border: 'none',
                          borderRadius: 9,
                          padding: '7px 13px',
                          fontWeight: 700,
                          fontSize: 10.5,
                          letterSpacing: '.08em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                        }}
                      >
                        Add
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
                    <div
                      style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--bg)', overflow: 'hidden' }}
                    >
                      <div
                        style={{
                          width: c.confidence + '%',
                          height: '100%',
                          background:
                            c.confidence > 80 ? 'var(--grad)' : 'linear-gradient(120deg,#FBBF24,#E2691B)',
                          borderRadius: 99,
                          transition: 'width .6s ease',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 10.5, color: 'var(--soft)', whiteSpace: 'nowrap' }}>
                      {c.confidence}% match · {catLabel(c.category)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Reveal>
    </>
  );
}
