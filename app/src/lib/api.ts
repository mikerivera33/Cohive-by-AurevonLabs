/**
 * Thin client for the Cohive API. Returns null / throws ApiError on failure.
 * Session token is persisted via the validated storage helpers.
 */
import { isShortString, load, save } from './storage';
import type { Member, ScanCandidate, ScanResult, Spot, Tier } from '../types';

const TOKEN_KEY = 'apiToken';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function getApiToken(): string {
  return load(TOKEN_KEY, '', isShortString);
}

export function setApiToken(token: string): void {
  save(TOKEN_KEY, token);
}

export function clearApiToken(): void {
  save(TOKEN_KEY, '');
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getApiToken();
  if (token) headers.set('Authorization', 'Bearer ' + token);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network');
  }

  let data: { error?: string } & T;
  try {
    data = (await res.json()) as { error?: string } & T;
  } catch {
    throw new ApiError(res.status, 'invalid_response');
  }

  if (!res.ok) {
    throw new ApiError(res.status, data.error || 'request_failed');
  }
  return data;
}

/** Probe whether the API is reachable (used to choose server vs local demo). */
export async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiDemoAuth(provider: 'apple' | 'google' | 'email', name?: string) {
  const data = await apiFetch<{ token: string; user: { id: string; name: string; email: string } }>(
    '/api/auth/demo',
    { method: 'POST', body: JSON.stringify({ provider, name }) }
  );
  setApiToken(data.token);
  return data;
}

export async function apiMe() {
  return apiFetch<{ user: { id: string; name: string; email: string } }>('/api/auth/me');
}

export async function apiListTrips() {
  return apiFetch<{ trips: Array<{ id: string; name: string; city: string }> }>('/api/trips');
}

export async function apiGetTrip(tripId: string) {
  return apiFetch<{
    trip: { id: string; name: string; city: string; lat: number; lng: number };
    spots: Spot[];
    members: Member[];
  }>('/api/trips/' + encodeURIComponent(tripId));
}

export async function apiCastVote(tripId: string, spotId: number, tier: Tier | null) {
  return apiFetch<{ spot: Spot }>('/api/trips/' + encodeURIComponent(tripId) + '/votes', {
    method: 'POST',
    body: JSON.stringify({ spotId, tier }),
  });
}

export async function apiAddMember(tripId: string, name: string) {
  return apiFetch<{ member: Member }>('/api/trips/' + encodeURIComponent(tripId) + '/members', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function apiScan(tripId: string, text: string) {
  return apiFetch<ScanResult & { sanitizedLength: number }>(
    '/api/trips/' + encodeURIComponent(tripId) + '/scan',
    { method: 'POST', body: JSON.stringify({ text }) }
  );
}

export async function apiAddSpot(tripId: string, candidate: ScanCandidate, source: string) {
  return apiFetch<{ spot: Spot }>('/api/trips/' + encodeURIComponent(tripId) + '/spots', {
    method: 'POST',
    body: JSON.stringify({ candidate, source }),
  });
}
