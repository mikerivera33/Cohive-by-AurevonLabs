import { lazy, Suspense } from 'react';

import type { MapMarker } from './MapView';

/**
 * Leaflet is the heaviest thing the app ships, and no map is visible until
 * after onboarding — so the map component (and the leaflet chunk behind it)
 * loads on demand. The fallback holds the exact height to avoid layout shift.
 */
const MapViewLazy = lazy(() =>
  import('./MapView').then((m) => ({ default: m.MapView }))
);

interface LazyMapProps {
  id: string;
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
  height: number;
  light: boolean;
  focus?: { lat: number; lng: number; zoom: number; nonce: number } | null;
}

export type { MapMarker };

export function LazyMap(props: LazyMapProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-hidden
          style={{
            height: props.height,
            background: 'var(--bg2)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <span
            className="hex"
            style={{
              width: 22,
              height: 22,
              background: 'var(--grad)',
              opacity: 0.5,
              animation: 'cvpulse 1.1s ease infinite',
              display: 'block',
            }}
          />
        </div>
      }
    >
      <MapViewLazy {...props} />
    </Suspense>
  );
}
