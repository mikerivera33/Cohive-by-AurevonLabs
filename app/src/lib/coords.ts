/**
 * Coordinate clamps — reject NaN / Infinity / out-of-range map poisoning.
 */

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
