/**
 * localStorage that never throws. Private windows, cleared site data and
 * WKWebView data-protection can all make these calls fail.
 */
const PREFIX = 'cohive:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience — losing it must never break the app.
  }
}
