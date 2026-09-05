import type { MapMarker } from '../components/MapView';
import type { Listing, Restaurant, Spot } from '../types';
import { clampLat, clampLng, hasValidCoords } from './coords';
import { catColor } from './styles';

/** Nest listings — violet to match Nest accent. */
export const NEST_MARKER_COLOR = '#A78BFA';
/** Table restaurants — pink to match Table accent. */
export const TABLE_MARKER_COLOR = '#F472B6';

export interface SavedPlacesInput {
  spots: Spot[];
  nest: Listing[];
  table: Restaurant[];
}

/**
 * Every hive place with usable coordinates: trip spots, Nest listings, and
 * Table restaurants. Invalid / missing coords are dropped (not remapped to 0,0).
 */
export function collectSavedPlaceMarkers({ spots, nest, table }: SavedPlacesInput): MapMarker[] {
  const out: MapMarker[] = [];

  for (const s of spots) {
    if (!hasValidCoords(s.lat, s.lng)) continue;
    out.push({
      lat: clampLat(s.lat),
      lng: clampLng(s.lng),
      color: catColor(s.category),
      label: `Trip · ${s.name}`,
      kind: 'trip',
    });
  }

  for (const n of nest) {
    if (!hasValidCoords(n.lat, n.lng)) continue;
    out.push({
      lat: clampLat(n.lat),
      lng: clampLng(n.lng),
      color: NEST_MARKER_COLOR,
      label: `Nest · ${n.title}`,
      kind: 'nest',
    });
  }

  for (const t of table) {
    if (!hasValidCoords(t.lat, t.lng)) continue;
    out.push({
      lat: clampLat(t.lat),
      lng: clampLng(t.lng),
      color: TABLE_MARKER_COLOR,
      label: `Table · ${t.name}`,
      kind: 'table',
    });
  }

  return out;
}
