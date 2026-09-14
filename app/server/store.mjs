/**
 * Cohive data store — membership is the ACL source of truth.
 * Optional file-backed snapshots via persistPath / COHIVE_DATA_FILE.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { defaultPersistPath, loadSnapshot, saveSnapshot } from './persist.mjs';
import { isValidAmount, potShortfalls, toCents, withdrawable } from './engine-bundle.mjs';
import {
  INVITE_CODE_RE,
  LIMITS,
  MEMBER_COLORS,
  OWNER_COLOR,
  cleanText,
  expenseFromInput,
  inviteExhausted,
  newInviteCode,
  newToken,
  normalizeEmail,
  publicInvite,
  sha256,
  spotFromCandidate,
  tripFromBody,
} from './rules.mjs';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const TOKEN_RE = /^[a-f0-9]{48}$/;
const FREE_TRIP_LIMIT = 3;
const MAX_SPOTS_PER_TRIP = 200;
const MAX_MEMBERS_PER_TRIP = 50;
const MAX_EXPENSES_PER_TRIP = 500;
const MAX_FUND_ENTRIES_PER_TRIP = 1000;
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
  /** @type {Map<string, Array<{ id: number, memberId: string, kind: 'contribution' | 'withdrawal', amount: number, at: string }>>} */
  const fundByTrip = new Map();
  /** @type {Map<string, any>} code -> invite */
  const invites = new Map();
  /** @type {Map<string, { email: string, name: string, expiresAt: number, usedAt: number | null }>} */
  const magicLinks = new Map();

  let nextSpotId = 500;
  let nextLedgerId = 1000;
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
    fundByTrip.set(tripId, []);
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
      fundByTrip: Object.fromEntries(
        [...fundByTrip.entries()].map(([k, v]) => [k, v.map((x) => ({ ...x }))])
      ),
      invites: [...invites.values()].map((x) => ({ ...x })),
      magicLinks: [...magicLinks.entries()].map(([hash, m]) => ({ hash, ...m })),
      nextSpotId,
      nextLedgerId,
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
    fundByTrip.clear();
    invites.clear();
    magicLinks.clear();

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
      // Pre-invite snapshots keyed members by userId only; memberId is the ledger key.
      memberships.set(k, Array.isArray(v) ? v.map((m) => ({ ...m, memberId: m.memberId || m.userId })) : []);
    }
    for (const i of snap.invites || []) if (i?.code) invites.set(i.code, i);
    for (const m of snap.magicLinks || []) if (m?.hash) magicLinks.set(m.hash, { email: m.email, name: m.name, expiresAt: m.expiresAt, usedAt: m.usedAt ?? null });
    for (const [k, v] of Object.entries(snap.spotsByTrip || {})) {
      spotsByTrip.set(k, Array.isArray(v) ? v : []);
    }
    for (const [k, v] of Object.entries(snap.votesByTrip || {})) {
      votesByTrip.set(k, Array.isArray(v) ? v : []);
    }
    for (const [k, v] of Object.entries(snap.fundByTrip || {})) {
      fundByTrip.set(k, Array.isArray(v) ? v : []);
    }
    nextSpotId = Number(snap.nextSpotId) || nextSpotId;
    nextLedgerId = Number(snap.nextLedgerId) || nextLedgerId;
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
    const u = users.get(sess.userId);
    return u && !u.deletedAt ? u : null;
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

  /** Demo / provisional onboarding providers — still creates a real session + membership. */
  function demoAuth({ provider, name, contact }) {
    const p = String(provider || 'email');
    if (p !== 'apple' && p !== 'google' && p !== 'email' && p !== 'phone') {
      return { error: 'invalid_provider', status: 400 };
    }
    const display = String(name || 'You').trim().slice(0, 64) || 'You';
    const rawContact = String(contact || '').trim().slice(0, 120);
    let email;
    if (p === 'email' && rawContact.includes('@')) {
      email = rawContact.toLowerCase();
    } else if (p === 'phone' && rawContact) {
      const digits = rawContact.replace(/[^\d+]/g, '').slice(0, 20);
      email = `phone-${digits || id().slice(0, 8)}@cohive.local`;
    } else {
      email = `demo-${p}-${id().slice(0, 8)}@cohive.local`;
    }
    const existing = users.get(email);
    if (existing) {
      const token = createSession(existing.id);
      ensureDemoMembership(existing);
      schedulePersist();
      return { user: publicUser(existing), token, mode: 'demo' };
    }
    const { salt, hash } = hashPassword(randomBytes(16).toString('hex'));
    const user = {
      id: id(),
      email,
      name: display,
      salt,
      hash,
      provider: p,
      contact: rawContact || undefined,
      createdAt: new Date().toISOString(),
    };
    users.set(email, user);
    users.set(user.id, user);
    const token = createSession(user.id);
    ensureDemoMembership(user);
    schedulePersist();
    return { user: publicUser(user), token, mode: 'demo' };
  }

  /** Upsert an OAuth (or provisional OAuth-return) user and open a session. */
  function oauthUpsert({ provider, email, name, verified }) {
    const p = provider === 'apple' ? 'apple' : 'google';
    const norm = String(email || '')
      .trim()
      .toLowerCase()
      .slice(0, 120);
    const mail = norm.includes('@') ? norm : `oauth-${p}-${id().slice(0, 8)}@cohive.local`;
    const display = String(name || 'You').trim().slice(0, 64) || 'You';
    let user = users.get(mail);
    if (!user) {
      const { salt, hash } = hashPassword(randomBytes(16).toString('hex'));
      user = {
        id: id(),
        email: mail,
        name: display,
        salt,
        hash,
        provider: p,
        oauthVerified: Boolean(verified),
        createdAt: new Date().toISOString(),
      };
      users.set(mail, user);
      users.set(user.id, user);
    } else {
      user.provider = p;
      if (display && display !== 'You') user.name = display;
      user.oauthVerified = Boolean(verified);
    }
    const token = createSession(user.id);
    ensureDemoMembership(user);
    schedulePersist();
    return {
      user: publicUser(user),
      token,
      mode: verified ? 'oauth' : 'oauth_provisional',
    };
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
      memberId: user.id,
      name: user.name,
      color: OWNER_COLOR,
      role: members.length ? 'member' : 'owner',
    });
    memberships.set(tripId, members);
  }

  function isMember(tripId, userId) {
    const members = memberships.get(String(tripId));
    if (!members) return false;
    return members.some((m) => m.userId === userId);
  }

  /** The ledger key for `userId` in this trip (direct members: their user id). */
  function memberIdFor(tripId, userId) {
    const m = (memberships.get(String(tripId)) || []).find((x) => x.userId === userId);
    return m ? m.memberId : userId;
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
      id: m.memberId,
      name: m.name,
      color: m.color,
      role: m.role,
    }));
    return { trip: { ...trip }, spots, members, fund: getFund(tripId, userId).fund, me: memberIdFor(tripId, userId) };
  }

  // ── Money: shared pot + cost splitting ─────────────────────
  // The acting user is always the session user — nobody can move money for
  // someone else, and a withdrawal may never exceed the user's own envelope.

  function memberIds(tripId) {
    return (memberships.get(String(tripId)) || []).map((m) => m.memberId);
  }

  function books(tripId) {
    const trip = trips.get(String(tripId));
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const fund = fundByTrip.get(String(tripId)) || [];
    fundByTrip.set(String(tripId), fund);
    return { trip, fund };
  }

  function getFund(tripId, userId) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const { trip, fund } = books(tripId);
    const owner = trip.ownerId || memberIds(tripId)[0];
    return {
      fund: fund.map((f) => ({ ...f })),
      // Legacy seed rows carry no payer; pin them to the owner so every member
      // computes the same balances.
      expenses: trip.expenses.map((e) => ({ ...e, paidBy: e.paidBy ?? owner })),
    };
  }

  function contribute(tripId, userId, amount) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const amt = Number(amount);
    if (!isValidAmount(amt)) return { error: 'invalid_amount', status: 400 };
    const { fund } = books(tripId);
    if (fund.length >= MAX_FUND_ENTRIES_PER_TRIP) return { error: 'fund_limit', status: 400 };
    fund.push({
      id: nextLedgerId++,
      memberId: memberIdFor(tripId, userId),
      kind: 'contribution',
      amount: amt,
      at: new Date().toISOString(),
    });
    schedulePersist();
    return getFund(tripId, userId);
  }

  function withdraw(tripId, userId, amount) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const amt = Number(amount);
    if (!isValidAmount(amt)) return { error: 'invalid_amount', status: 400 };
    const { trip, fund } = books(tripId);
    if (fund.length >= MAX_FUND_ENTRIES_PER_TRIP) return { error: 'fund_limit', status: 400 };
    const owner = trip.ownerId || memberIds(tripId)[0];
    const me = memberIdFor(tripId, userId);
    const limit = withdrawable(me, memberIds(tripId), trip.expenses, fund, owner);
    if (toCents(amt) > toCents(limit)) {
      return { error: 'exceeds_envelope', status: 400, withdrawable: limit };
    }
    fund.push({
      id: nextLedgerId++,
      memberId: me,
      kind: 'withdrawal',
      amount: amt,
      at: new Date().toISOString(),
    });
    schedulePersist();
    return getFund(tripId, userId);
  }

  function addExpense(tripId, userId, input) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const ids = memberIds(tripId);
    const { trip, fund } = books(tripId);
    if (trip.expenses.length >= MAX_EXPENSES_PER_TRIP) return { error: 'expense_limit', status: 400 };
    const norm = expenseFromInput(input, ids, memberIdFor(tripId, userId));
    if (norm.error) return norm;
    const expense = { id: nextLedgerId++, ...norm.expense };
    if (expense.paidBy === 'pot') {
      const owner = trip.ownerId || ids[0];
      const shortfalls = potShortfalls(expense, ids, trip.expenses, fund, owner);
      if (shortfalls.length) return { error: 'pot_shortfall', status: 400, shortfalls };
    }
    trip.expenses.push(expense);
    schedulePersist();
    return { expense: { ...expense }, ...getFund(tripId, userId) };
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
    const member = {
      userId: null,
      memberId: inviteId,
      name: display,
      color: MEMBER_COLORS[members.length % MEMBER_COLORS.length],
      role: 'member',
    };
    members.push(member);
    memberships.set(String(tripId), members);
    const inv = createInvite(tripId, userId, { memberId: inviteId });
    schedulePersist();
    return {
      member: { id: member.memberId, name: member.name, color: member.color, role: member.role },
      invite: inv.invite,
    };
  }

  function addSpot(tripId, userId, candidate, source) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const spots = spotsByTrip.get(String(tripId)) || [];
    if (spots.length >= MAX_SPOTS_PER_TRIP) {
      return { error: 'spot_limit', status: 400 };
    }
    const made = spotFromCandidate(candidate, source, nextSpotId);
    if (made.error) return made;
    nextSpotId++;
    const spot = made.spot;
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

  function createTrip(userId, body, opts = {}) {
    if (tripCountForUser(userId) >= FREE_TRIP_LIMIT) {
      return { error: 'trip_limit', status: 402 };
    }
    const tripId = id();
    const trip = tripFromBody(body, userId, tripId);
    const user = users.get(userId);
    trips.set(tripId, trip);
    spotsByTrip.set(tripId, (opts.seedSpots ? seed?.tripSpots || [] : []).map((sp) => ({ ...sp, tier: null, votes: 0 })));
    votesByTrip.set(tripId, []);
    fundByTrip.set(tripId, []);
    memberships.set(tripId, [
      {
        userId,
        memberId: userId,
        name: user?.name || 'You',
        color: OWNER_COLOR,
        role: 'owner',
      },
    ]);
    schedulePersist();
    return { trip };
  }

  // ── Invites ─────────────────────────────────────────────────
  function createInvite(tripId, userId, opts = {}) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const t = String(tripId);
    const members = memberships.get(t) || [];
    const memberId = opts.memberId ? String(opts.memberId) : null;
    if (memberId) {
      const m = members.find((x) => x.memberId === memberId);
      if (!m) return { error: 'member_not_found', status: 404 };
      if (m.userId) return { error: 'already_joined', status: 409 };
    }
    let count = 0;
    for (const i of invites.values()) if (i.tripId === t) count++;
    if (count >= LIMITS.MAX_INVITES_PER_TRIP) return { error: 'invite_limit', status: 400 };
    const invite = {
      code: newInviteCode(),
      tripId: t,
      memberId,
      createdBy: userId,
      expiresAt: Date.now() + LIMITS.INVITE_TTL_MS,
      maxUses: memberId ? 1 : Math.max(1, Math.min(50, Math.floor(Number(opts.maxUses)) || 1)),
      uses: 0,
      createdAt: new Date().toISOString(),
    };
    invites.set(invite.code, invite);
    schedulePersist();
    return { invite: publicInvite(invite) };
  }

  /** Public preview — enough to render "Maya invited you to Tokyo" before sign-in. */
  function getInvite(code) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return { error: 'invite_not_found', status: 404 };
    const i = invites.get(code);
    if (!i) return { error: 'invite_not_found', status: 404 };
    const trip = trips.get(i.tripId);
    if (!trip) return { error: 'invite_not_found', status: 404 };
    const inviter = users.get(i.createdBy);
    const slot = i.memberId ? (memberships.get(i.tripId) || []).find((m) => m.memberId === i.memberId) : null;
    return {
      invite: {
        code: i.code,
        expired: inviteExhausted(i),
        trip: { id: trip.id, name: trip.name, city: trip.city, country: trip.country },
        inviter: inviter?.name || 'A hive member',
        memberName: slot?.name || null,
      },
    };
  }

  function acceptInvite(code, userId) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return { error: 'invite_not_found', status: 404 };
    const i = invites.get(code);
    if (!i || !trips.has(i.tripId)) return { error: 'invite_not_found', status: 404 };
    const user = users.get(userId);
    if (!user || user.deletedAt) return { error: 'unauthorized', status: 401 };
    const trip = trips.get(i.tripId);
    const members = memberships.get(i.tripId) || [];
    const existing = members.find((m) => m.userId === userId);
    const shape = (m) => ({ id: m.memberId, name: m.name, color: m.color, role: m.role });
    if (existing) return { trip: { ...trip }, member: shape(existing), joined: false };
    if (inviteExhausted(i)) return { error: 'invite_expired', status: 410 };
    let member;
    if (i.memberId) {
      const slot = members.find((m) => m.memberId === i.memberId);
      if (!slot) return { error: 'member_not_found', status: 404 };
      if (slot.userId) return { error: 'invite_used', status: 409 };
      slot.userId = userId;
      if (user.name && user.name !== 'You') slot.name = user.name;
      member = slot;
    } else {
      if (members.length >= MAX_MEMBERS_PER_TRIP) return { error: 'member_limit', status: 400 };
      member = { userId, memberId: userId, name: user.name || 'You', color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], role: 'member' };
      members.push(member);
      memberships.set(i.tripId, members);
    }
    i.uses++;
    schedulePersist();
    return { trip: { ...trip }, member: shape(member), joined: true };
  }

  // ── Magic links (passwordless email) ─────────────────────────
  function requestMagicLink({ email, name }) {
    const norm = normalizeEmail(email);
    if (!norm) return { error: 'invalid_email', status: 400 };
    const now = Date.now();
    for (const [h, m] of magicLinks) if (m.expiresAt < now - 86_400_000) magicLinks.delete(h);
    const token = newToken();
    magicLinks.set(sha256(token), { email: norm, name: cleanText(name, 64), expiresAt: now + LIMITS.MAGIC_TTL_MS, usedAt: null });
    schedulePersist();
    return { token, email: norm };
  }

  function consumeMagicLink(token) {
    if (!token || !TOKEN_RE.test(token)) return { error: 'invalid_token', status: 400 };
    const m = magicLinks.get(sha256(token));
    if (!m || m.usedAt || m.expiresAt < Date.now()) return { error: 'invalid_token', status: 400 };
    m.usedAt = Date.now();
    let user = users.get(m.email);
    let created = false;
    if (!user) {
      const { salt, hash } = hashPassword(newToken());
      user = { id: id(), email: m.email, name: m.name || m.email.split('@')[0], salt, hash, provider: 'email', oauthVerified: true, createdAt: new Date().toISOString() };
      users.set(m.email, user);
      users.set(user.id, user);
      created = true;
      // A real account starts with its own trip, not the shared demo one.
      createTrip(user.id, { ...(seed?.trip || {}), name: 'My first trip' }, { seedSpots: true });
    } else if (user.deletedAt) {
      return { error: 'account_deleted', status: 410 };
    } else {
      user.oauthVerified = true;
    }
    const sessionToken = createSession(user.id);
    schedulePersist();
    return { user: publicUser(user), token: sessionToken, mode: 'magic', created };
  }

  // ── Account deletion (App Store requirement; GDPR erasure) ───
  function deleteAccount(userId) {
    const user = users.get(userId);
    if (!user) return { error: 'not_found', status: 404 };
    for (const [token, s] of sessions) if (s.userId === userId) sessions.delete(token);
    users.delete(user.email);
    user.email = `deleted-${user.id}@cohive.local`;
    user.name = 'Deleted member';
    user.salt = null;
    user.hash = null;
    user.provider = null;
    user.contact = undefined;
    user.deletedAt = new Date().toISOString();
    users.set(user.email, user);
    for (const members of memberships.values()) {
      for (const m of members) {
        if (m.userId === userId) {
          m.userId = null; // ledger key (memberId) stays so balances still add up
          m.name = 'Deleted member';
        }
      }
    }
    schedulePersist();
    return { ok: true };
  }

  return {
    backend: 'memory',
    register,
    login,
    demoAuth,
    oauthUpsert,
    logout,
    getSessionUser,
    publicUser,
    listTripsForUser,
    getTrip,
    castVote,
    addMember,
    addSpot,
    createTrip,
    createInvite,
    getInvite,
    acceptInvite,
    requestMagicLink,
    consumeMagicLink,
    deleteAccount,
    getFund,
    contribute,
    withdraw,
    addExpense,
    isMember,
    requireMember,
    flush,
    hydrate,
    FREE_TRIP_LIMIT,
    MAX_SPOTS_PER_TRIP,
    MAX_MEMBERS_PER_TRIP,
    MAX_EXPENSES_PER_TRIP,
    MAX_FUND_ENTRIES_PER_TRIP,
    persistPath,
    /** @internal test helpers */
    _trips: trips,
    _memberships: memberships,
    _spotsByTrip: spotsByTrip,
    _snapshot: toSnapshot,
    _invites: invites,
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
