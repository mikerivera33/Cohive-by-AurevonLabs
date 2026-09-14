/**
 * Thin client for the Cohive API. Returns null / throws ApiError on failure.
 * Session token is persisted via the validated storage helpers.
 */
import { isSessionToken, load, save } from './storage';
import type {
  Expense,
  FundEntry,
  HiveSummary,
  Listing,
  Member,
  MemberId,
  Payer,
  PlanTier,
  ReactionEmoji,
  Restaurant,
  ScanCandidate,
  ScanResult,
  Spot,
  Tier,
  Tier as RestaurantTier,
  TripSummary,
} from '../types';

const TOKEN_KEY = 'apiToken';

export class ApiError extends Error {
  status: number;
  code: string;
  /** Extra fields the server sent with the error (e.g. `shortfalls`, `withdrawable`). */
  data: Record<string, unknown>;
  constructor(status: number, code: string, data: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function getApiToken(): string {
  return load(TOKEN_KEY, '', isSessionToken);
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
    throw new ApiError(res.status, data.error || 'request_failed', data as Record<string, unknown>);
  }
  return data;
}

/** Probe whether the API is reachable (used to choose server vs local demo). */
export async function apiHealthy(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      // Fail fast when preview proxies to a dead upstream (or the network stalls).
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; service?: string };
    // Real API answers `{ ok: true, service: "cohive-api" }`. Preview-static
    // middleware returns `{ ok: false }` so we stay on seed fixtures quietly.
    return data?.ok === true && data?.service === 'cohive-api';
  } catch {
    return false;
  }
}

export async function apiDemoAuth(
  provider: 'apple' | 'google' | 'email' | 'phone',
  opts?: { name?: string; contact?: string }
) {
  const data = await apiFetch<{
    token: string;
    user: { id: string; name: string; email: string };
    mode?: string;
  }>('/api/auth/demo', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      name: opts?.name,
      contact: opts?.contact,
    }),
  });
  setApiToken(data.token);
  return data;
}

export type AuthProviders = {
  google: boolean;
  apple: boolean;
  mode: 'oauth' | 'demo';
};

/** Which social providers have real OAuth client IDs configured on the server. */
export async function apiAuthProviders(): Promise<AuthProviders> {
  try {
    const res = await fetch('/api/auth/providers', {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { google: false, apple: false, mode: 'demo' };
    const data = (await res.json()) as Partial<AuthProviders> & { ok?: boolean };
    // Preview-static middleware answers `{ ok: false }` for every /api path.
    if (data?.ok === false) return { google: false, apple: false, mode: 'demo' };
    return {
      google: Boolean(data.google),
      apple: Boolean(data.apple),
      mode: data.google || data.apple ? 'oauth' : 'demo',
    };
  } catch {
    return { google: false, apple: false, mode: 'demo' };
  }
}

export function oauthStartPath(provider: 'google' | 'apple'): string {
  return '/api/auth/oauth/' + provider;
}

export interface MeProfile {
  user: { id: string; name: string; email: string };
  /** The server is the authority on what has been paid for. */
  entitlement: { tier: PlanTier; expiresAt: string | null; source: string };
  features: { connections: boolean; booking: boolean };
  caps: { hives: number; tripsPerHive: number };
  referralCode: string | null;
  referredBy: string | null;
}

export async function apiMe() {
  return apiFetch<MeProfile>('/api/auth/me');
}

/** Non-production: sets the tier server-side the way the demo sheet does locally. */
export async function apiDemoPurchase(tier: PlanTier) {
  return apiFetch<MeProfile>('/api/billing/demo-purchase', { method: 'POST', body: JSON.stringify({ tier }) });
}

/* ── passwordless email (magic links) ─────────────────────── */

export async function apiMagicRequest(email: string, name?: string, ref?: string) {
  return apiFetch<{ ok: true; email: string; sent: boolean; devLink?: string }>('/api/auth/magic', {
    method: 'POST',
    body: JSON.stringify({ email, name, ref }),
  });
}

export async function apiMagicVerify(token: string) {
  const data = await apiFetch<{
    token: string;
    user: { id: string; name: string; email: string };
    created?: boolean;
  }>('/api/auth/magic/verify', { method: 'POST', body: JSON.stringify({ token }) });
  setApiToken(data.token);
  return data;
}

/** Permanent: sessions revoked, profile anonymised, ledger keys kept. */
export async function apiDeleteAccount() {
  const data = await apiFetch<{ ok: true }>('/api/auth/me', { method: 'DELETE' });
  clearApiToken();
  return data;
}

/* ── invites ──────────────────────────────────────────────── */

export interface InvitePreview {
  code: string;
  expired: boolean;
  trip: { id: string; name: string; city: string; country: string };
  inviter: string;
  memberName: string | null;
}

export const isInviteCode = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-HJ-NP-Z2-9]{10}$/.test(v);

export async function apiGetInvite(code: string) {
  return apiFetch<{ invite: InvitePreview }>('/api/invites/' + encodeURIComponent(code));
}

export async function apiAcceptInvite(code: string) {
  return apiFetch<{ trip: { id: string; name: string; city: string }; member: Member; joined: boolean }>(
    '/api/invites/' + encodeURIComponent(code) + '/accept',
    { method: 'POST', body: '{}' }
  );
}

export async function apiCreateInvite(tripId: string, opts: { memberId?: MemberId; maxUses?: number } = {}) {
  return apiFetch<{ invite: { code: string; expiresAt: string }; url: string }>(
    '/api/trips/' + encodeURIComponent(tripId) + '/invites',
    { method: 'POST', body: JSON.stringify(opts) }
  );
}

export async function apiListTrips() {
  return apiFetch<{ trips: Array<{ id: string; name: string; city: string }> }>('/api/trips');
}

/* ── hives ────────────────────────────────────────────────── */

const hivePath = (hiveId: string, rest = '') => '/api/hives/' + encodeURIComponent(hiveId) + rest;

export async function apiListHives() {
  return apiFetch<{ hives: HiveSummary[] }>('/api/hives');
}

export async function apiGetHive(hiveId: string) {
  return apiFetch<{
    hive: HiveSummary;
    members: Member[];
    trips: TripSummary[];
    nest: Listing[];
    table: Restaurant[];
    me: MemberId | null;
  }>(hivePath(hiveId));
}

export async function apiCreateTrip(hiveId: string, body: { name: string; city?: string; country?: string; lat?: number; lng?: number }) {
  return apiFetch<{ trip: { id: string; name: string; city: string } }>(hivePath(hiveId, '/trips'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiAddListing(hiveId: string, input: Partial<Listing>) {
  return apiFetch<{ listing: Listing }>(hivePath(hiveId, '/nest'), { method: 'POST', body: JSON.stringify(input) });
}

export async function apiReact(hiveId: string, listingId: number, emoji: ReactionEmoji) {
  return apiFetch<{ listing: Listing }>(hivePath(hiveId, '/nest/' + listingId + '/react'), {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export async function apiAddRestaurant(hiveId: string, input: Partial<Restaurant>) {
  return apiFetch<{ restaurant: Restaurant }>(hivePath(hiveId, '/table'), { method: 'POST', body: JSON.stringify(input) });
}

export async function apiUpdateRestaurant(hiveId: string, id: number, patch: { tried?: boolean; tier?: RestaurantTier }) {
  return apiFetch<{ restaurant: Restaurant }>(hivePath(hiveId, '/table/' + id), { method: 'POST', body: JSON.stringify(patch) });
}

export async function apiGetTrip(tripId: string) {
  return apiFetch<{
    trip: { id: string; hiveId?: string; name: string; city: string; lat: number; lng: number; expenses?: Expense[] };
    spots: Spot[];
    members: Member[];
    fund?: FundEntry[];
    /** The caller's member id in this trip — the ledger key, not necessarily the user id. */
    me?: MemberId | null;
  }>('/api/trips/' + encodeURIComponent(tripId));
}

/** The trip's books after a money action — the client replaces its copy wholesale. */
export interface FundPayload {
  fund: FundEntry[];
  expenses: Expense[];
}

const fundPath = (tripId: string, rest: string) => '/api/trips/' + encodeURIComponent(tripId) + rest;

export async function apiContribute(tripId: string, amount: number) {
  return apiFetch<FundPayload>(fundPath(tripId, '/fund/contributions'), {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export async function apiWithdraw(tripId: string, amount: number) {
  return apiFetch<FundPayload>(fundPath(tripId, '/fund/withdrawals'), {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export interface ExpenseInput {
  label: string;
  amount: number;
  category?: string;
  paidBy?: Payer;
  splitWith?: MemberId[];
}

export async function apiAddExpense(tripId: string, input: ExpenseInput) {
  return apiFetch<FundPayload & { expense: Expense }>(fundPath(tripId, '/expenses'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function apiCastVote(tripId: string, spotId: number, tier: Tier | null) {
  return apiFetch<{ spot: Spot }>('/api/trips/' + encodeURIComponent(tripId) + '/votes', {
    method: 'POST',
    body: JSON.stringify({ spotId, tier }),
  });
}

export async function apiAddMember(tripId: string, name: string) {
  return apiFetch<{ member: Member; invite?: { code: string; expiresAt: string }; url?: string | null }>('/api/trips/' + encodeURIComponent(tripId) + '/members', {
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
