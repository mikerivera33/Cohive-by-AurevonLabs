/**
 * Domain rules shared by every store backend (in-memory and Postgres):
 * limits, text hygiene, id/token generation and input normalisers.
 * Pure functions only — no I/O, no state.
 */
import { createHash, randomBytes } from 'node:crypto';

import { isValidAmount } from './engine-bundle.mjs';
import { clampFinite, clampLat, clampLng } from './safeJson.mjs';

export const LIMITS = {
  FREE_TRIP_LIMIT: 3,
  MAX_SPOTS_PER_TRIP: 200,
  MAX_MEMBERS_PER_TRIP: 50,
  MAX_EXPENSES_PER_TRIP: 500,
  MAX_FUND_ENTRIES_PER_TRIP: 1000,
  MAX_INVITES_PER_TRIP: 200,
  FREE_HIVE_LIMIT: 3,
  FREE_TRIPS_PER_HIVE: 3,
  MAX_LISTINGS_PER_HIVE: 300,
  MAX_RESTAURANTS_PER_HIVE: 300,
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  MAGIC_TTL_MS: 15 * 60 * 1000,
  INVITE_TTL_MS: 14 * 24 * 60 * 60 * 1000,
};

export const MEMBER_COLORS = ['#60A5FA', '#F472B6', '#34D399', '#A78BFA', '#FBBF24'];
export const REACTIONS = ['💍', '🪴'];
export const TIERS = new Set(['must', 'maybe', 'iftime']);
export const OWNER_COLOR = '#4EB4FF';

export const ALLOWED_CATEGORIES = new Set([
  'food',
  'sight',
  'nature',
  'museum',
  'nightlife',
  'shopping',
  'hotel',
]);

/** Session and magic-link tokens: 24 random bytes as hex. */
export const TOKEN_RE = /^[a-f0-9]{48}$/;
/** Invite codes: 10 chars from an unambiguous alphabet (no 0/O/1/I). */
export const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const newId = () => randomBytes(12).toString('hex');
export const newToken = () => randomBytes(24).toString('hex');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export function newInviteCode() {
  let code = '';
  for (const b of randomBytes(10)) code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return code;
}

/** Strip tags, trim and cap — the one text sanitiser for user-entered labels. */
export const cleanText = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, max);

/** Lower-cased, trimmed email or '' when it does not look like one. */
export function normalizeEmail(v) {
  const n = String(v || '').trim().toLowerCase();
  return n.includes('@') && !/\s/.test(n) && n.length <= 200 && n.length >= 3 ? n : '';
}

export function isPlaceholderMember(memberId) {
  return String(memberId).startsWith('invite-');
}

/** Normalise a scanner candidate into a stored spot, or return `{ error }`. */
export function spotFromCandidate(candidate, source, id) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string') {
    return { error: 'invalid_candidate', status: 400 };
  }
  const category =
    typeof candidate.category === 'string' && ALLOWED_CATEGORIES.has(candidate.category)
      ? candidate.category
      : 'sight';
  const hour = (v, max) =>
    v == null || !Number.isFinite(Number(v)) ? null : clampFinite(v, 0, max);
  return {
    spot: {
      id,
      name: cleanText(candidate.name, 120) || 'Untitled spot',
      category,
      lat: clampLat(candidate.lat),
      lng: clampLng(candidate.lng),
      duration: clampFinite(candidate.duration, 60, 24 * 60) || 60,
      cost: clampFinite(candidate.cost, 0, 1_000_000),
      rating: 4,
      open: hour(candidate.open, 24),
      close: hour(candidate.close, 28),
      source: cleanText(source || 'import', 80),
      tier: null,
      votes: 0,
      note: candidate.matched === 'exact' ? '' : 'Confirmed from scan',
    },
  };
}

/**
 * Normalise an expense request against the trip's member ids.
 * `fallbackPayer` is the caller's member id. Returns `{ error }` or the row
 * minus its id.
 */
export function expenseFromInput(input, memberIds, fallbackPayer) {
  const label = cleanText(input?.label, 80);
  if (!label) return { error: 'invalid_label', status: 400 };
  const amount = Number(input?.amount);
  if (!isValidAmount(amount)) return { error: 'invalid_amount', status: 400 };
  const category = cleanText(input?.category, 24).toLowerCase() || 'other';
  const ids = memberIds.map(String);
  const paidBy =
    input?.paidBy === 'pot' ? 'pot' : ids.includes(String(input?.paidBy)) ? String(input.paidBy) : String(fallbackPayer);
  let splitWith = Array.isArray(input?.splitWith)
    ? [...new Set(input.splitWith.slice(0, LIMITS.MAX_MEMBERS_PER_TRIP).map(String))].filter((x) => ids.includes(x))
    : [];
  if (!splitWith.length) splitWith = ids;
  return { expense: { label, category, amount, paidBy, splitWith } };
}

/** Normalise a create-trip body. */
export function tripFromBody(body, ownerId, id) {
  return {
    id,
    name: cleanText(body?.name || 'New trip', 80) || 'New trip',
    city: cleanText(body?.city, 80),
    country: cleanText(body?.country, 80),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.startDate || ''))
      ? String(body.startDate)
      : new Date().toISOString().slice(0, 10),
    days: Math.max(1, Math.min(14, Math.floor(clampFinite(body?.days, 3, 14)) || 3)),
    pace: body?.pace === 'relaxed' || body?.pace === 'packed' ? body.pace : 'balanced',
    startHour: Math.min(23, Math.floor(clampFinite(body?.startHour, 9, 23))),
    endHour: Math.min(24, Math.floor(clampFinite(body?.endHour, 21, 24))),
    budget: clampFinite(body?.budget, 0, 10_000_000),
    currency: cleanText(body?.currency || 'USD', 8) || 'USD',
    lat: clampLat(body?.lat),
    lng: clampLng(body?.lng),
    expenses: [],
    ownerId,
  };
}

/** Normalise a create-hive body. */
export function hiveFromBody(body, ownerId, id) {
  return { id, name: cleanText(body?.name || 'My hive', 60) || 'My hive', ownerId, createdAt: new Date().toISOString() };
}

/** Normalise a saved home listing (Nest). */
export function listingFromInput(input, id) {
  const title = cleanText(input?.title, 120);
  if (!title) return { error: 'invalid_title', status: 400 };
  return {
    listing: {
      id,
      title,
      price: Math.round(clampFinite(input?.price, 0, 1_000_000)),
      beds: clampFinite(input?.beds, 1, 20),
      baths: clampFinite(input?.baths, 1, 20),
      sqft: Math.round(clampFinite(input?.sqft, 0, 100_000)),
      hood: cleanText(input?.hood, 60),
      lat: clampLat(input?.lat),
      lng: clampLng(input?.lng),
      source: cleanText(input?.source || 'saved', 40).toLowerCase(),
      note: cleanText(input?.note, 240),
      reactions: Object.fromEntries(REACTIONS.map((r) => [r, []])),
      tagged: null,
    },
  };
}

/** Normalise a dinner-list entry (Table). */
export function restaurantFromInput(input, id) {
  const name = cleanText(input?.name, 120);
  if (!name) return { error: 'invalid_name', status: 400 };
  return {
    restaurant: {
      id,
      name,
      cuisine: cleanText(input?.cuisine, 60) || 'Dinner',
      mood: cleanText(input?.mood, 30) || 'Cozy',
      price: /^\$+$/.test(String(input?.price || '')) ? String(input.price).slice(0, 4) : '$$',
      hood: cleanText(input?.hood, 60),
      lat: clampLat(input?.lat),
      lng: clampLng(input?.lng),
      hours: cleanText(input?.hours, 40),
      tried: Boolean(input?.tried),
      tier: TIERS.has(input?.tier) ? input.tier : 'maybe',
    },
  };
}

/** Shape an invite row for API responses. */
export function publicInvite(i) {
  const expiresAt = typeof i.expiresAt === 'number' ? new Date(i.expiresAt).toISOString() : i.expiresAt;
  return {
    code: i.code,
    hiveId: String(i.hiveId),
    memberId: i.memberId || null,
    expiresAt,
    maxUses: i.maxUses,
    uses: i.uses,
  };
}

export function inviteExhausted(i, now = Date.now()) {
  const exp = typeof i.expiresAt === 'number' ? i.expiresAt : new Date(i.expiresAt).getTime();
  return exp < now || i.uses >= i.maxUses;
}
