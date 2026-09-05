import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { NEST_MARKER_COLOR, TABLE_MARKER_COLOR } from '../lib/savedPlaces';
import { WORLD_CENTER, WORLD_ZOOM } from '../lib/mapDefaults';
import { LazyMap } from './LazyMap';
import type { MapMarker } from './LazyMap';

interface FullscreenMapProps {
  open: boolean;
  onClose: () => void;
  markers: MapMarker[];
  light: boolean;
}

export function FullscreenMap({ open, onClose, markers, light }: FullscreenMapProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const scrollEl = document.getElementById('cv-scroll');
    const prevOverflow = scrollEl?.style.overflowY;
    if (scrollEl) scrollEl.style.overflowY = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      if (scrollEl) scrollEl.style.overflowY = prevOverflow || '';
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const host = document.getElementById('cv-shell') || document.body;
  const tripN = markers.filter((m) => m.kind === 'trip').length;
  const nestN = markers.filter((m) => m.kind === 'nest').length;
  const tableN = markers.filter((m) => m.kind === 'table').length;

  return createPortal(
    <div
      className="mapFullscreen"
      role="dialog"
      aria-modal="true"
      aria-label="All saved places map"
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="mapFullscreen__bar">
        <button type="button" className="press grot mapFullscreen__back" onClick={onClose} aria-label="Close map">
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="grot mapFullscreen__title">All saved places</h2>
          <p className="mapFullscreen__sub">
            {markers.length} pin{markers.length === 1 ? '' : 's'} · Trip, Nest &amp; Table
          </p>
        </div>
      </header>

      <div className="mapFullscreen__stage">
        <LazyMap
          id="map-fullscreen"
          center={WORLD_CENTER}
          zoom={WORLD_ZOOM}
          markers={markers}
          height="100%"
          light={light}
          interactive
          fitMarkers
        />
      </div>

      <footer className="mapFullscreen__legend">
        <LegendDot color="var(--honey)" label={`Trip ${tripN}`} />
        <LegendDot color={NEST_MARKER_COLOR} label={`Nest ${nestN}`} />
        <LegendDot color={TABLE_MARKER_COLOR} label={`Table ${tableN}`} />
      </footer>
    </div>,
    host
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: color,
          boxShadow: '0 0 0 2px var(--line)',
        }}
      />
      {label}
    </span>
  );
}
