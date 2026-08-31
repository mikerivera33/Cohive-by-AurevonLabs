import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  lat: number;
  lng: number;
  color: string;
  label: string;
}

interface MapViewProps {
  id: string;
  center: [number, number];
  zoom: number;
  markers: MapMarker[];
  height: number;
  light: boolean;
  /** Set by the parent to recentre imperatively (e.g. "Pin on map"). */
  focus?: { lat: number; lng: number; zoom: number; nonce: number } | null;
}

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function MapView({ id, center, zoom, markers, height, light, focus }: MapViewProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const marksRef = useRef<L.LayerGroup | null>(null);

  // Create once, destroy on unmount — Leaflet leaks handlers otherwise.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
    map.attributionControl.setPrefix('');
    mapRef.current = map;
    tilesRef.current = L.tileLayer(light ? TILES.light : TILES.dark, {
      maxZoom: 18,
      attribution: ATTRIBUTION,
    }).addTo(map);
    marksRef.current = L.layerGroup().addTo(map);

    // The container is often still animating in when the map is created.
    const t = window.setTimeout(() => map.invalidateSize(), 60);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      marksRef.current = null;
    };
    // Centre/zoom are the initial view only; `focus` handles later moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    tilesRef.current?.setUrl(light ? TILES.light : TILES.dark);
  }, [light]);

  useEffect(() => {
    const group = marksRef.current;
    if (!group) return;
    group.clearLayers();
    markers.forEach((mk) => {
      L.circleMarker([mk.lat, mk.lng], {
        radius: 7,
        color: mk.color,
        weight: 2,
        fillColor: mk.color,
        fillOpacity: 0.55,
      })
        .bindPopup(mk.label)
        .addTo(group);
    });
  }, [markers]);

  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.setView([focus.lat, focus.lng], focus.zoom);
  }, [focus]);

  return <div ref={elRef} id={id} style={{ height }} />;
}
