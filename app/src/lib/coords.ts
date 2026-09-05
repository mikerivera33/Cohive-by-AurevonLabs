/**
 * Coordinate clamps — reject NaN / Infinity / out-of-range map poisoning.
 */

/** True when lat/lng are finite and within WGS84 bounds (no remapping). */
export function hasValidCoords(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180
  );
}

/** Finite lat in [-90, 90]; non-finite → 0. */
export function clampLat(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-90, Math.min(90, x));
}

/** Finite lng in [-180, 180]; non-finite → 0. */
export function clampLng(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-180, Math.min(180, x));
}
