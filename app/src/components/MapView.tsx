import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { clampLat, clampLng, hasValidCoords } from '../lib/coords';
import { WORLD_CENTER, WORLD_ZOOM } from '../lib/mapDefaults';

export type MapMarkerKind = 'trip' | 'nest' | 'table' | 'other';

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
  label: string;
  kind?: MapMarkerKind;
}

interface MapViewProps {
  id: string;
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
  /** Pixel height, or a CSS length (e.g. `"100%"`) for flex fill. */
  height: number | string;
  light: boolean;
  /** Set by the parent to recentre imperatively (e.g. "Pin on map"). */
  focus?: { lat: number; lng: number; zoom: number; nonce: number } | null;
  /**
   * When false (preview), disable pan/zoom so a parent can treat the map as a
   * tap target. Fullscreen maps pass true.
   */
  interactive?: boolean;
  /** Fit the view to markers (≥2 → bounds, 1 → close zoom, 0 → world). */
  fitMarkers?: boolean;
}

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function applyView(map: L.Map, points: [number, number][], fit: boolean, fallback: [number, number], zoom: number) {
  if (!fit) {
    map.setView(fallback, zoom);
    return;
  }
  if (points.length >= 2) {
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 12, animate: false });
  } else if (points.length === 1) {
    map.setView(points[0], 12, { animate: false });
  } else {
    map.setView(WORLD_CENTER, WORLD_ZOOM, { animate: false });
  }
}

export function MapView({
  id,
  center,
  zoom,
  markers,
  height,
  light,
  focus,
  interactive = true,
  fitMarkers = false,
}: MapViewProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const marksRef = useRef<L.LayerGroup | null>(null);
  const fitRef = useRef(fitMarkers);
  fitRef.current = fitMarkers;

  // Create once, destroy on unmount — Leaflet leaks handlers otherwise.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const safeCenter: [number, number] = hasValidCoords(center[0], center[1])
      ? [clampLat(center[0]), clampLng(center[1])]
      : WORLD_CENTER;

    const map = L.map(el, {
      zoomControl: interactive,
      attributionControl: true,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      scrollWheelZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      worldCopyJump: true,
    }).setView(safeCenter, zoom);
    map.attributionControl.setPrefix('');
    mapRef.current = map;
    tilesRef.current = L.tileLayer(light ? TILES.light : TILES.dark, {
      maxZoom: 20,
      maxNativeZoom: 18,
      minZoom: 1,
      attribution: ATTRIBUTION,
      // Worldwide coverage; no region lock.
      noWrap: false,
    }).addTo(map);
    marksRef.current = L.layerGroup().addTo(map);

    // Classic blank-map bug: container often has 0 size on first paint
    // (overlay open, softFrame animating). Invalidate until layout settles.
    const invalidate = () => map.invalidateSize({ animate: false });
    const timers = [0, 60, 200, 400].map((ms) => window.setTimeout(invalidate, ms));
    const ro = new ResizeObserver(() => invalidate());
    ro.observe(el);
    requestAnimationFrame(invalidate);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      marksRef.current = null;
    };
    // Centre/zoom are the initial view only; `focus` / `fitMarkers` handle later moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, interactive]);

  useEffect(() => {
    tilesRef.current?.setUrl(light ? TILES.light : TILES.dark);
  }, [light]);

  useEffect(() => {
    const map = mapRef.current;
    const group = marksRef.current;
    if (!group || !map) return;

    group.clearLayers();
    const points: [number, number][] = [];

    markers.forEach((mk) => {
      if (!hasValidCoords(mk.lat, mk.lng)) return;
      const lat = clampLat(mk.lat);
      const lng = clampLng(mk.lng);
      points.push([lat, lng]);
      L.circleMarker([lat, lng], {
        radius: 7,
        color: mk.color,
        weight: 2,
        fillColor: mk.color,
        fillOpacity: 0.55,
        // Stay pickable at every zoom; pixel-fixed circleMarkers don't shrink away.
        interactive: true,
      })
        .bindPopup(mk.label)
        .addTo(group);
    });

    if (fitRef.current) {
      map.invalidateSize({ animate: false });
      applyView(map, points, true, WORLD_CENTER, WORLD_ZOOM);
    }
  }, [markers]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    if (!hasValidCoords(focus.lat, focus.lng)) return;
    mapRef.current.setView([clampLat(focus.lat), clampLng(focus.lng)], focus.zoom);
  }, [focus]);

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      ref={elRef}
      id={id}
      style={{ height: heightStyle, width: '100%' }}
      // Preview maps sit under an expand hit-target; keep Leaflet from stealing focus.
      aria-hidden={!interactive}
    />
  );
}
