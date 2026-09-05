/**
 * Cohive data store — membership is the ACL source of truth.
 * Optional file-backed snapshots via persistPath / COHIVE_DATA_FILE.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { clampFinite, clampLat, clampLng } from './safeJson.mjs';
import { defaultPersistPath, loadSnapshot, saveSnapshot } from './persist.mjs';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const TOKEN_RE = /^[a-f0-9]{48}$/;
const FREE_TRIP_LIMIT = 3;
const MAX_SPOTS_PER_TRIP = 200;
const MAX_MEMBERS_PER_TRIP = 50;
const ALLOWED_CATEGORIES = new Set([
  'food',
  'sight',
  'nature',
  'museum',
  'nightlife',
  'shopping',
  'hotel',
]);

/** @typedef {'must' | 'maybe' | 'iftime' | null} Tier */

function id() {
  return randomBytes(12).toString('hex');
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

/**
 * @param {object | null} seed
 * @param {{ persistPath?: string | null }} [options]
 */
export function createStore(seed = null, options = {}) {
  const persistPath =
    options.persistPath === undefined ? null : options.persistPath;

  /** @type {Map<string, any>} */
  const users = new Map();
  /** @type {Map<string, { userId: string, expiresAt: number }>} */
  const sessions = new Map();
  /** @type {Map<string, any>} */
  const trips = new Map();
  /** @type {Map<string, Array<{ userId: string, name: string, color: string, role: 'owner' | 'member' }>>} */
  const memberships = new Map();
  /** @type {Map<string, any[]>} */
  const spotsByTrip = new Map();
  /** @type {Map<string, Array<{ spotId: number, userId: string, tier: Tier, at: string }>>} */
  const votesByTrip = new Map();

  let nextSpotId = 500;
  let persistTimer = undefined;
  let persistChain = Promise.resolve();

  function bootstrapFromSeed(s) {
    if (!s?.trip) return;
    const tripId = String(s.trip.id ?? 1);
    trips.set(tripId, {
      id: tripId,
      name: s.trip.name,
      city: s.trip.city,
      country: s.trip.country,
      startDate: s.trip.startDate,
      days: s.trip.days,
      pace: s.trip.pace,
      startHour: s.trip.startHour,
      endHour: s.trip.endHour,
      budget: s.trip.budget,
      currency: s.trip.currency,
      lat: s.trip.lat,
      lng: s.trip.lng,
      expenses: (s.trip.expenses || []).map((e) => ({ ...e })),
      ownerId: null,
    });
    spotsByTrip.set(
      tripId,
      (s.tripSpots || []).map((sp) => ({ ...sp }))
    );
    votesByTrip.set(tripId, []);
    memberships.set(tripId, []);
    const maxId = Math.max(0, ...(s.tripSpots || []).map((sp) => sp.id || 0));
    nextSpotId = Math.max(nextSpotId, maxId + 1);
  }

  if (seed) bootstrapFromSeed(seed);

  function toSnapshot() {
    const userList = [];
    const seen = new Set();
    for (const u of users.values()) {
      if (!u?.id || seen.has(u.id)) continue;
      seen.add(u.id);
      userList.push({
        id: u.id,
        email: u.email,
        name: u.name,
        salt: u.salt,
        hash: u.hash,
        provider: u.provider || null,
        createdAt: u.createdAt,
      });
    }
    return {
      users: userList,
      sessions: [...sessions.entries()].map(([token, s]) => ({
        token,
        userId: s.userId,
        expiresAt: s.expiresAt,
      })),
      trips: [...trips.values()],
      memberships: Object.fromEntries(
        [...memberships.entries()].map(([k, v]) => [k, v.map((m) => ({ ...m }))])
      ),
      spotsByTrip: Object.fromEntries(
        [...spotsByTrip.entries()].map(([k, v]) => [k, v.map((s) => ({ ...s }))])
      ),
      votesByTrip: Object.fromEntries(
        [...votesByTrip.entries()].map(([k, v]) => [k, v.map((x) => ({ ...x }))])
      ),
      nextSpotId,
    };
  }

  function hydrate(snap) {
    if (!snap) return;
    users.clear();
    sessions.clear();
    trips.clear();
    memberships.clear();
    spotsByTrip.clear();
    votesByTrip.clear();

    for (const u of snap.users || []) {
      if (!u?.id || !u?.email) continue;
      users.set(u.email, u);
      users.set(u.id, u);
    }
    const now = Date.now();
    for (const s of snap.sessions || []) {
      if (!s?.token || !TOKEN_RE.test(s.token)) continue;
      if (s.expiresAt < now) continue;
      sessions.set(s.token, { userId: s.userId, expiresAt: s.expiresAt });
    }
    for (const t of snap.trips || []) {
      if (!t?.id) continue;
      trips.set(String(t.id), t);
    }
    for (const [k, v] of Object.entries(snap.memberships || {})) {
      memberships.set(k, Array.isArray(v) ? v : []);
    }
    for (const [k, v] of Object.entries(snap.spotsByTrip || {})) {
      spotsByTrip.set(k, Array.isArray(v) ? v : []);
    }
    for (const [k, v] of Object.entries(snap.votesByTrip || {})) {
      votesByTrip.set(k, Array.isArray(v) ? v : []);
    }
    nextSpotId = Number(snap.nextSpotId) || nextSpotId;
    // Ensure seed trip exists even after hydrate of empty/partial file.
    if (seed && !trips.has(String(seed.trip?.id ?? 1))) bootstrapFromSeed(seed);
  }

  function schedulePersist() {
    if (!persistPath) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistChain = persistChain
        .then(() => saveSnapshot(persistPath, toSnapshot()))
        .catch((e) => console.warn('[cohive-store] persist failed:', e?.message || e));
    }, 40);
  }

  async function flush() {
    if (!persistPath) return;
    clearTimeout(persistTimer);
    await persistChain;
    await saveSnapshot(persistPath, toSnapshot());
  }

  function publicUser(u) {
    return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
  }

  function createSession(userId) {
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    schedulePersist();
    return token;
  }

  function getSessionUser(token) {
    if (!token || !TOKEN_RE.test(token)) return null;
    const sess = sessions.get(token);
    if (!sess) return null;
    if (sess.expiresAt < Date.now()) {
      sessions.delete(token);
      schedulePersist();
      return null;
    }
    return users.get(sess.userId) || null;
  }

  function register({ email, name, password }) {
    const norm = String(email || '')
      .trim()
      .toLowerCase();
    if (!norm || !norm.includes('@') || norm.length > 200) {
      return { error: 'invalid_email', status: 400 };
    }
    if (users.has(norm)) return { error: 'email_taken', status: 409 };
    const display = String(name || norm.split('@')[0]).trim().slice(0, 64) || 'You';
    const pw = String(password || '');
    if (pw.length < 8 || pw.length > 200) return { error: 'weak_password', status: 400 };
    const { salt, hash } = hashPassword(pw);
    const user = {
      id: id(),
      email: norm,
      name: display,
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    users.set(norm, user);
    users.set(user.id, user);
    const token = createSession(user.id);
    // Register/login do not auto-join seed trips — membership is the ACL boundary.
    schedulePersist();
    return { user: publicUser(user), token };
  }

  function login({ email, password }) {
    const norm = String(email || '')
      .trim()
      .toLowerCase();
    const user = users.get(norm);
    if (!user || !user.hash) return { error: 'invalid_credentials', status: 401 };
    if (!verifyPassword(String(password || ''), user.salt, user.hash)) {
      return { error: 'invalid_credentials', status: 401 };
    }
    const token = createSession(user.id);
    schedulePersist();
    return { user: publicUser(user), token };
  }

  /** Demo onboarding providers — still creates a real session + membership. */
  function demoAuth({ provider, name }) {
    const p = String(provider || 'email');
    if (p !== 'apple' && p !== 'google' && p !== 'email') {
      return { error: 'invalid_provider', status: 400 };
    }
    const display = String(name || 'You').trim().slice(0, 64) || 'You';
    const email = `demo-${p}-${id().slice(0, 8)}@cohive.local`;
    const { salt, hash } = hashPassword(randomBytes(16).toString('hex'));
    const user = {
      id: id(),
      email,
      name: display,
      salt,
      hash,
      provider: p,
      createdAt: new Date().toISOString(),
    };
    users.set(email, user);
    users.set(user.id, user);
    const token = createSession(user.id);
    ensureDemoMembership(user);
    schedulePersist();
    return { user: publicUser(user), token };
  }

  function logout(token) {
    if (token && sessions.delete(token)) schedulePersist();
  }

  function ensureDemoMembership(user) {
    const tripId = String(seed?.trip?.id ?? '1');
    if (!trips.has(tripId)) return;
    const members = memberships.get(tripId) || [];
    if (members.some((m) => m.userId === user.id)) return;
    if (!members.length) {
      const trip = trips.get(tripId);
      if (trip) trip.ownerId = user.id;
    }
    members.push({
      userId: user.id,
      name: user.name,
      color: '#F5A524',
      role: members.length ? 'member' : 'owner',
    });
    memberships.set(tripId, members);
  }

  function isMember(tripId, userId) {
    const members = memberships.get(String(tripId));
    if (!members) return false;
    return members.some((m) => m.userId === userId);
  }

  function requireMember(tripId, userId) {
    if (!trips.has(String(tripId))) return { error: 'trip_not_found', status: 404 };
    if (!isMember(tripId, userId)) return { error: 'forbidden', status: 403 };
    return null;
  }

  function listTripsForUser(userId) {
    const out = [];
    for (const [tripId, trip] of trips) {
      if (isMember(tripId, userId)) {
        out.push({
          id: trip.id,
          name: trip.name,
          city: trip.city,
          country: trip.country,
          startDate: trip.startDate,
          days: trip.days,
        });
      }
    }
    return out;
  }

  function getTrip(tripId, userId) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const trip = trips.get(String(tripId));
    const spots = (spotsByTrip.get(String(tripId)) || []).map((s) => ({ ...s }));
    const members = (memberships.get(String(tripId)) || []).map((m) => ({
      id: m.userId,
      name: m.name,
      color: m.color,
      role: m.role,
    }));
    return { trip: { ...trip }, spots, members };
  }

  function castVote(tripId, userId, spotId, tier) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const allowed = tier === 'must' || tier === 'maybe' || tier === 'iftime' || tier === null;
    if (!allowed) return { error: 'invalid_tier', status: 400 };
    const spots = spotsByTrip.get(String(tripId));
    if (!spots) return { error: 'trip_not_found', status: 404 };
    const spot = spots.find((s) => s.id === Number(spotId));
    if (!spot) return { error: 'spot_not_found', status: 404 };

    const votes = votesByTrip.get(String(tripId)) || [];
    const prev = votes.find((v) => v.userId === userId && v.spotId === spot.id);
    if (prev) {
      if (prev.tier === tier || tier === null) {
        votesByTrip.set(
          String(tripId),
          votes.filter((v) => !(v.userId === userId && v.spotId === spot.id))
        );
        spot.tier = null;
        spot.votes = Math.max(0, (spot.votes || 0) - 1);
        schedulePersist();
        return { spot: { ...spot } };
      }
      prev.tier = tier;
      prev.at = new Date().toISOString();
      spot.tier = tier;
      schedulePersist();
      return { spot: { ...spot } };
    }

    votes.push({
      spotId: spot.id,
      userId,
      tier,
      at: new Date().toISOString(),
    });
    votesByTrip.set(String(tripId), votes);
    spot.tier = tier;
    spot.votes = (spot.votes || 0) + 1;
    schedulePersist();
    return { spot: { ...spot } };
  }

  function addMember(tripId, userId, name) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const display = String(name || '').trim().slice(0, 64);
    if (!display) return { error: 'invalid_name', status: 400 };
    const members = memberships.get(String(tripId)) || [];
    if (members.length >= MAX_MEMBERS_PER_TRIP) {
      return { error: 'member_limit', status: 400 };
    }
    const inviteId = 'invite-' + id();
    const colors = ['#60A5FA', '#F472B6', '#34D399', '#A78BFA', '#FBBF24'];
    const member = {
      userId: inviteId,
      name: display,
      color: colors[members.length % colors.length],
      role: 'member',
    };
    members.push(member);
    memberships.set(String(tripId), members);
    schedulePersist();
    return {
      member: { id: member.userId, name: member.name, color: member.color, role: member.role },
    };
  }

  function addSpot(tripId, userId, candidate, source) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    if (!candidate || typeof candidate !== 'object' || typeof candidate.name !== 'string') {
      return { error: 'invalid_candidate', status: 400 };
    }
    const spots = spotsByTrip.get(String(tripId)) || [];
    if (spots.length >= MAX_SPOTS_PER_TRIP) {
      return { error: 'spot_limit', status: 400 };
    }
    const category =
      typeof candidate.category === 'string' && ALLOWED_CATEGORIES.has(candidate.category)
        ? candidate.category
        : 'sight';
    const open =
      candidate.open == null || !Number.isFinite(Number(candidate.open))
        ? null
        : clampFinite(candidate.open, 0, 24);
    const close =
      candidate.close == null || !Number.isFinite(Number(candidate.close))
        ? null
        : clampFinite(candidate.close, 0, 28);
    const spot = {
      id: nextSpotId++,
      name: String(candidate.name).slice(0, 120),
      category,
      lat: clampLat(candidate.lat),
      lng: clampLng(candidate.lng),
      duration: clampFinite(candidate.duration, 60, 24 * 60) || 60,
      cost: clampFinite(candidate.cost, 0, 1_000_000),
      rating: 4,
      open,
      close,
      source: String(source || 'import').slice(0, 80),
      tier: null,
      votes: 0,
      note: candidate.matched === 'exact' ? '' : 'Confirmed from scan',
    };
    spots.push(spot);
    spotsByTrip.set(String(tripId), spots);
    schedulePersist();
    return { spot };
  }

  function tripCountForUser(userId) {
    let n = 0;
    for (const [tripId] of trips) if (isMember(tripId, userId)) n++;
    return n;
  }

  function createTrip(userId, body) {
    if (tripCountForUser(userId) >= FREE_TRIP_LIMIT) {
      return { error: 'trip_limit', status: 402 };
    }
    const tripId = id();
    const trip = {
      id: tripId,
      name: String(body?.name || 'New trip').slice(0, 80),
      city: String(body?.city || '').slice(0, 80),
      country: String(body?.country || '').slice(0, 80),
      startDate: String(body?.startDate || new Date().toISOString().slice(0, 10)),
      days: Math.max(1, Math.min(14, Math.floor(clampFinite(body?.days, 3, 14)) || 3)),
      pace: body?.pace === 'relaxed' || body?.pace === 'packed' ? body.pace : 'balanced',
      startHour: Math.min(23, Math.floor(clampFinite(body?.startHour, 9, 23))),
      endHour: Math.min(24, Math.floor(clampFinite(body?.endHour, 21, 24))),
      budget: clampFinite(body?.budget, 0, 10_000_000),
      currency: String(body?.currency || 'USD').slice(0, 8),
      lat: clampLat(body?.lat),
      lng: clampLng(body?.lng),
      expenses: [],
      ownerId: userId,
    };
    const user = users.get(userId);
    trips.set(tripId, trip);
    spotsByTrip.set(tripId, []);
    votesByTrip.set(tripId, []);
    memberships.set(tripId, [
      {
        userId,
        name: user?.name || 'You',
        color: '#F5A524',
        role: 'owner',
      },
    ]);
    schedulePersist();
    return { trip };
  }

  return {
    register,
    login,
    demoAuth,
    logout,
    getSessionUser,
    publicUser,
    listTripsForUser,
    getTrip,
    castVote,
    addMember,
    addSpot,
    createTrip,
    isMember,
    requireMember,
    flush,
    hydrate,
    FREE_TRIP_LIMIT,
    MAX_SPOTS_PER_TRIP,
    MAX_MEMBERS_PER_TRIP,
    persistPath,
    /** @internal test helpers */
    _trips: trips,
    _memberships: memberships,
    _spotsByTrip: spotsByTrip,
  };
}

/**
 * Create a store and hydrate from disk when a persist path is configured.
 * @param {object | null} seed
 * @param {{ persistPath?: string | null }} [options]
 */
export async function createStoreAsync(seed = null, options = {}) {
  const persistPath =
    options.persistPath === undefined ? defaultPersistPath() : options.persistPath;
  const store = createStore(seed, { persistPath });
  if (persistPath) {
    const snap = await loadSnapshot(persistPath);
    if (snap) store.hydrate(snap);
  }
  return store;
}
