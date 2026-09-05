import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { collectSavedPlaceMarkers } from '../lib/savedPlaces';
import { useApp } from '../store/AppStore';
import { FullscreenMap } from './FullscreenMap';
import { LazyMap } from './LazyMap';
import type { MapMarker } from './LazyMap';

interface MapPreviewProps {
  id: string;
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
  height: number;
  light: boolean;
  focus?: { lat: number; lng: number; zoom: number; nonce: number } | null;
  /** Extra styles on the softFrame wrapper. */
  style?: CSSProperties;
  /** Decorative overlays (stats chips). Keep interactive controls above the expand hit. */
  children?: ReactNode;
}

/**
 * Inline map preview — non-interactive, tap anywhere (or Expand) to open a
 * fullscreen map of every saved place across Trip / Nest / Table.
 */
export function MapPreview({
  id,
  center,
  zoom,
  markers,
  height,
  light,
  focus,
  style,
  children,
}: MapPreviewProps) {
  const { spots, nest, table } = useApp();
  const [open, setOpen] = useState(false);

  const allSaved = useMemo(
    () => collectSavedPlaceMarkers({ spots, nest, table }),
    [spots, nest, table]
  );

  return (
    <>
      <div className="softFrame mapPreview" style={{ position: 'relative', ...style }}>
        <LazyMap
          id={id}
          center={center}
          zoom={zoom}
          markers={markers}
          height={height}
          light={light}
          focus={focus}
          interactive={false}
        />
        <button
          type="button"
          className="mapExpandHit"
          aria-label="Open fullscreen map of all saved places"
          onClick={() => setOpen(true)}
        />
        <span className="mapExpandChip grot" aria-hidden>
          Expand
        </span>
        {children}
      </div>
      <FullscreenMap open={open} onClose={() => setOpen(false)} markers={allSaved} light={light} />
    </>
  );
}
