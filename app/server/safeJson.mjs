/**
 * Safe JSON ingest — reject oversized bodies and prototype-pollution keys.
 */

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_JSON_BODY_BYTES = 64_000;

/**
 * @param {unknown} value
 * @param {number} [depth]
 */
export function hasDangerousKeys(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasDangerousKeys(item, depth + 1)) return true;
    }
    return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    const name = typeof key === 'string' ? key : String(key);
    if (DANGEROUS_KEYS.has(name)) return true;
    if (hasDangerousKeys(/** @type {any} */ (value)[key], depth + 1)) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @param {number} [maxBytes]
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
export function parseJsonBody(text, maxBytes = MAX_JSON_BODY_BYTES) {
  if (typeof text !== 'string') return { ok: false, error: 'invalid_json' };
  if (text.length > maxBytes) return { ok: false, error: 'body_too_large' };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid_json' };
  }
  if (hasDangerousKeys(value)) return { ok: false, error: 'dangerous_keys' };
  return { ok: true, value };
}

/** Finite lat in [-90, 90]; non-finite → 0. */
export function clampLat(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-90, Math.min(90, x));
}

/** Finite lng in [-180, 180]; non-finite → 0. */
export function clampLng(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-180, Math.min(180, x));
}

/** Finite non-negative number with an upper bound. */
export function clampFinite(n, fallback, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(max, x));
}
