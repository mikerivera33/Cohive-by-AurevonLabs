/**
 * Sliding-window rate limiter keyed by account and/or IP.
 * In-memory — fine for a single Node process; swap for Redis in multi-instance.
 */

/** @typedef {{ timestamps: number[] }} Bucket */

const buckets = new Map();

/**
 * @param {string} key
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ ok: true, remaining: number } | { ok: false, remaining: number, retryAfterSec: number }}
 */
export function takeToken(key, { limit, windowMs }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }
  bucket.timestamps.push(now);
  return { ok: true, remaining: limit - bucket.timestamps.length };
}

/** Test helper — clears all buckets. */
export function resetRateLimits() {
  buckets.clear();
}
