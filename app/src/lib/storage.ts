/**
 * localStorage that never throws. Private windows, cleared site data and
 * WKWebView data-protection can all make these calls fail.
 */
const PREFIX = 'cohive:';

export function load<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate) return validate(parsed) ? parsed : fallback;
    // Without an explicit validator, at least insist the shape didn't change:
    // stored data is user-editable and survives app updates.
    return typeof parsed === typeof fallback && parsed !== null ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && x.length <= 200);
export const isShortString = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;

export function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience — losing it must never break the app.
  }
}
