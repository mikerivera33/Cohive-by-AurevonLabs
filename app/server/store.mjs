/**
 * Cohive data store — in-memory, optionally file-backed (dev / single node).
 *
 * The hive is the membership unit: trips, Nest listings and Table entries
 * belong to a hive; members, invites and the ACL attach to the hive. Member
 * ids are the money-ledger keys — a placeholder created by "Invite Maya"
 * keeps its id when Maya accepts. Validation lives in rules.mjs and is
 * shared with the Postgres store (store-pg.mjs), which implements the same
 * interface with every method async.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { isValidAmount, potShortfalls, toCents, withdrawable } from './engine-bundle.mjs';
import { defaultPersistPath, loadSnapshot, saveSnapshot } from './persist.mjs';
import {
  INVITE_CODE_RE,
  LIMITS,
  MEMBER_COLORS,
  OWNER_COLOR,
  REACTIONS,
  TIERS,
  TOKEN_RE,
  REFERRAL_CODE_RE,
  capsFor,
  cleanText,
  entitlementFromInput,
  expenseFromInput,
  featuresFor,
  hiveFromBody,
  newReferralCode,
  inviteExhausted,
  listingFromInput,
  newId,
  newInviteCode,
  newToken,
  normalizeEmail,
  publicInvite,
  restaurantFromInput,
  sha256,
  spotFromCandidate,
  tripFromBody,
} from './rules.mjs';

const FREE_TRIP_LIMIT = LIMITS.FREE_TRIPS_PER_HIVE;
const MAX_SPOTS_PER_TRIP = LIMITS.MAX_SPOTS_PER_TRIP;
const MAX_MEMBERS_PER_TRIP = LIMITS.MAX_MEMBERS_PER_TRIP;
const MAX_EXPENSES_PER_TRIP = LIMITS.MAX_EXPENSES_PER_TRIP;
const MAX_FUND_ENTRIES_PER_TRIP = LIMITS.MAX_FUND_ENTRIES_PER_TRIP;
const SESSION_TTL_MS = LIMITS.SESSION_TTL_MS;

const id = newId;
const now = () => new Date().toISOString();
const err = (error, status, extra = {}) => ({ error, status, ...extra });

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  return prev.length === next.length && timingSafeEqual(prev, next);
}

/**
 * @param {object | null} seed
 * @param {{ persistPath?: string | null }} [options]
 */
export function createStore(seed = null, options = {}) {
  const persistPath = options.persistPath === undefined ? null : options.persistPath;

  const users = new Map(); // email → user, id → user
  const sessions = new Map(); // token → { userId, expiresAt }
  const hives = new Map(); // hiveId → hive
  const memberships = new Map(); // hiveId → [{ userId|null, memberId, name, color, role }]
  const trips = new Map(); // tripId → trip (with hiveId)
  const spotsByTrip = new Map();
  const votesByTrip = new Map();
  const fundByTrip = new Map();
  const nestByHive = new Map(); // hiveId → listings[]
  const tableByHive = new Map(); // hiveId → restaurants[]
  const invites = new Map(); // code → invite (hiveId)
  const magicLinks = new Map(); // sha256(token) → { email, name, ref, expiresAt, usedAt }
  const entitlements = new Map(); // userId → { tier, source, expiresAt, updatedAt }
  const billingEvents = new Set(); // provider event ids already applied

  let nextSpotId = 500;
  let nextLedgerId = 1000;
  let nextItemId = 1000; // listings + restaurants
  let persistTimer;
  let persistChain = Promise.resolve();

  /* ── seed ─────────────────────────────────────────────────── */

  function bootstrapFromSeed(s) {
    if (!s?.trip) return;
    const hiveId = String(s.hive?.id ?? s.trip.id ?? 1);
    const tripId = String(s.trip.id ?? 1);
    if (!hives.has(hiveId)) {
      hives.set(hiveId, { id: hiveId, name: s.hive?.name || s.trip.name, ownerId: null, createdAt: now() });
      memberships.set(hiveId, []);
      nestByHive.set(hiveId, (s.nest || []).map((n) => ({ ...n, reactions: { ...n.reactions } })));
      tableByHive.set(hiveId, (s.table || []).map((r) => ({ ...r })));
    }
    if (!trips.has(tripId)) {
      trips.set(tripId, {
        ...tripFromBody(s.trip, null, tripId),
        hiveId,
        expenses: (s.trip.expenses || []).map((e) => ({ ...e })),
      });
      spotsByTrip.set(tripId, (s.tripSpots || []).map((sp) => ({ ...sp })));
      votesByTrip.set(tripId, []);
      fundByTrip.set(tripId, []);
    }
    const maxId = Math.max(0, ...(s.tripSpots || []).map((sp) => sp.id || 0));
    nextSpotId = Math.max(nextSpotId, maxId + 1);
  }

  if (seed) bootstrapFromSeed(seed);

  /* ── persistence ──────────────────────────────────────────── */

  const mapOfArrays = (m) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.map((x) => ({ ...x }))]));

  function toSnapshot() {
    const userList = [];
    const seen = new Set();
    for (const u of users.values()) {
      if (!u?.id || seen.has(u.id)) continue;
      seen.add(u.id);
      userList.push({ ...u });
    }
    return {
      users: userList,
      sessions: [...sessions.entries()].map(([token, s]) => ({ token, ...s })),
      hives: [...hives.values()].map((h) => ({ ...h })),
      trips: [...trips.values()].map((t) => ({ ...t, expenses: t.expenses.map((e) => ({ ...e })) })),
      memberships: mapOfArrays(memberships),
      spotsByTrip: mapOfArrays(spotsByTrip),
      votesByTrip: mapOfArrays(votesByTrip),
      fundByTrip: mapOfArrays(fundByTrip),
      nestByHive: mapOfArrays(nestByHive),
      tableByHive: mapOfArrays(tableByHive),
      invites: [...invites.values()].map((x) => ({ ...x })),
      entitlements: [...entitlements.entries()].map(([userId, e]) => ({ userId, ...e })),
      billingEvents: [...billingEvents],
      magicLinks: [...magicLinks.entries()].map(([hash, m]) => ({ hash, ...m })),
      nextSpotId,
      nextLedgerId,
      nextItemId,
    };
  }

  function hydrate(snap) {
    if (!snap) return;
    for (const m of [users, sessions, hives, memberships, trips, spotsByTrip, votesByTrip, fundByTrip, nestByHive, tableByHive, invites, magicLinks, entitlements, billingEvents]) m.clear();

    for (const u of snap.users || []) {
      if (!u?.id || !u?.email) continue;
      users.set(u.email, u);
      users.set(u.id, u);
    }
    const t0 = Date.now();
    for (const s of snap.sessions || []) {
      if (!s?.token || !TOKEN_RE.test(s.token) || s.expiresAt < t0) continue;
      sessions.set(s.token, { userId: s.userId, expiresAt: s.expiresAt });
    }
    for (const h of snap.hives || []) if (h?.id) hives.set(String(h.id), h);
    for (const t of snap.trips || []) {
      if (!t?.id) continue;
      const tripId = String(t.id);
      // Pre-hive snapshots: the trip was its own membership unit.
      if (!t.hiveId) {
        t.hiveId = tripId;
        if (!hives.has(tripId)) hives.set(tripId, { id: tripId, name: t.name, ownerId: t.ownerId || null, createdAt: now() });
      }
      trips.set(tripId, t);
    }
    for (const [k, v] of Object.entries(snap.memberships || {})) {
      memberships.set(k, Array.isArray(v) ? v.map((m) => ({ ...m, memberId: m.memberId || m.userId })) : []);
    }
    for (const [name, m] of [['spotsByTrip', spotsByTrip], ['votesByTrip', votesByTrip], ['fundByTrip', fundByTrip], ['nestByHive', nestByHive], ['tableByHive', tableByHive]]) {
      for (const [k, v] of Object.entries(snap[name] || {})) m.set(k, Array.isArray(v) ? v : []);
    }
    for (const i of snap.invites || []) if (i?.code) invites.set(i.code, { ...i, hiveId: String(i.hiveId || i.tripId) });
    for (const m of snap.magicLinks || []) if (m?.hash) magicLinks.set(m.hash, { email: m.email, name: m.name, ref: m.ref || null, expiresAt: m.expiresAt, usedAt: m.usedAt ?? null });
    for (const e of snap.entitlements || []) if (e?.userId) entitlements.set(e.userId, { tier: e.tier, source: e.source, expiresAt: e.expiresAt ?? null, updatedAt: e.updatedAt });
    for (const id of snap.billingEvents || []) billingEvents.add(id);
    nextSpotId = Number(snap.nextSpotId) || nextSpotId;
    nextLedgerId = Number(snap.nextLedgerId) || nextLedgerId;
    nextItemId = Number(snap.nextItemId) || nextItemId;
    for (const h of hives.keys()) {
      if (!memberships.has(h)) memberships.set(h, []);
      if (!nestByHive.has(h)) nestByHive.set(h, []);
      if (!tableByHive.has(h)) tableByHive.set(h, []);
    }
    if (seed) bootstrapFromSeed(seed);
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

  /* ── users + sessions ─────────────────────────────────────── */

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

  function createSession(userId) {
    const token = newToken();
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

  function logout(token) {
    if (token && sessions.delete(token)) schedulePersist();
  }

  function insertUser(u) {
    const user = { createdAt: now(), ...u };
    users.set(user.email, user);
    users.set(user.id, user);
    return user;
  }

  /** The user who owns `code`, or null. Self-referrals are rejected by the caller. */
  function referrerFor(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!REFERRAL_CODE_RE.test(c)) return null;
    for (const u of users.values()) if (u.referralCode === c && !u.deletedAt) return u;
    return null;
  }

  function register({ email, name, password, ref }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    if (users.has(norm)) return err('email_taken', 409);
    const pw = String(password || '');
    if (pw.length < 8 || pw.length > 200) return err('weak_password', 400);
    const user = insertUser({ id: id(), email: norm, name: cleanText(name || norm.split('@')[0], 64) || 'You', ...hashPassword(pw), referredBy: referrerFor(ref)?.id || null });
    // Register/login never auto-join the seed hive — membership is the ACL boundary.
    const token = createSession(user.id);
    return { user: publicUser(user), token };
  }

  function login({ email, password }) {
    const user = users.get(normalizeEmail(email));
    if (!user || user.deletedAt || !verifyPassword(String(password || ''), user.salt, user.hash)) return err('invalid_credentials', 401);
    return { user: publicUser(user), token: createSession(user.id) };
  }

  /** Demo / provisional onboarding providers — a real session that joins the seed hive. */
  function demoAuth({ provider, name, contact, ref }) {
    const p = String(provider || 'email');
    if (!['apple', 'google', 'email', 'phone'].includes(p)) return err('invalid_provider', 400);
    const display = cleanText(name || 'You', 64) || 'You';
    const rawContact = cleanText(contact, 120);
    let email;
    if (p === 'email' && rawContact.includes('@')) email = rawContact.toLowerCase();
    else if (p === 'phone' && rawContact) email = `phone-${rawContact.replace(/[^\d+]/g, '').slice(0, 20) || id().slice(0, 8)}@cohive.local`;
    else email = `demo-${p}-${id().slice(0, 8)}@cohive.local`;
    let user = users.get(email);
    if (!user) user = insertUser({ id: id(), email, name: display, ...hashPassword(newToken()), provider: p, contact: rawContact || undefined, referredBy: referrerFor(ref)?.id || null });
    ensureDemoMembership(user);
    return { user: publicUser(user), token: createSession(user.id), mode: 'demo' };
  }

  function oauthUpsert({ provider, email, name, verified }) {
    const p = provider === 'apple' ? 'apple' : 'google';
    const norm = normalizeEmail(email);
    const mail = norm || `oauth-${p}-${id().slice(0, 8)}@cohive.local`;
    const display = cleanText(name || 'You', 64) || 'You';
    let user = users.get(mail);
    if (!user) {
      user = insertUser({ id: id(), email: mail, name: display, ...hashPassword(newToken()), provider: p, oauthVerified: Boolean(verified) });
    } else {
      user.provider = p;
      if (display && display !== 'You') user.name = display;
      user.oauthVerified = Boolean(verified);
    }
    ensureDemoMembership(user);
    return { user: publicUser(user), token: createSession(user.id), mode: verified ? 'oauth' : 'oauth_provisional' };
  }

  function ensureDemoMembership(user) {
    const hiveId = String(seed?.hive?.id ?? seed?.trip?.id ?? '1');
    const hive = hives.get(hiveId);
    if (!hive) return;
    const members = memberships.get(hiveId) || [];
    if (members.some((m) => m.userId === user.id)) return;
    if (!members.length) hive.ownerId = user.id;
    members.push({ userId: user.id, memberId: user.id, name: user.name, color: OWNER_COLOR, role: members.length ? 'member' : 'owner' });
    memberships.set(hiveId, members);
    schedulePersist();
  }

  /* ── magic links ──────────────────────────────────────────── */

  function requestMagicLink({ email, name, ref }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    const t0 = Date.now();
    for (const [h, m] of magicLinks) if (m.expiresAt < t0 - 86_400_000) magicLinks.delete(h);
    const token = newToken();
    magicLinks.set(sha256(token), { email: norm, name: cleanText(name, 64), ref: cleanText(ref, 12).toUpperCase() || null, expiresAt: t0 + LIMITS.MAGIC_TTL_MS, usedAt: null });
    schedulePersist();
    return { token, email: norm };
  }

  function consumeMagicLink(token) {
    if (!token || !TOKEN_RE.test(token)) return err('invalid_token', 400);
    const m = magicLinks.get(sha256(token));
    if (!m || m.usedAt || m.expiresAt < Date.now()) return err('invalid_token', 400);
    m.usedAt = Date.now();
    let user = users.get(m.email);
    let created = false;
    if (!user) {
      user = insertUser({ id: id(), email: m.email, name: m.name || m.email.split('@')[0], ...hashPassword(newToken()), provider: 'email', oauthVerified: true, referredBy: referrerFor(m.ref)?.id || null });
      created = true;
      // A real account starts with its own hive and trip, not the shared demo one.
      const hive = createHive(user.id, { name: `${user.name}’s hive` }).hive;
      createTrip(user.id, { ...(seed?.trip || {}), name: 'My first trip', hiveId: hive.id }, { seedSpots: true });
    } else if (user.deletedAt) {
      return err('account_deleted', 410);
    } else {
      user.oauthVerified = true;
    }
    return { user: publicUser(user), token: createSession(user.id), mode: 'magic', created };
  }

  function deleteAccount(userId) {
    const user = users.get(userId);
    if (!user) return err('not_found', 404);
    for (const [token, s] of sessions) if (s.userId === userId) sessions.delete(token);
    users.delete(user.email);
    Object.assign(user, { email: `deleted-${user.id}@cohive.local`, name: 'Deleted member', salt: null, hash: null, provider: null, contact: undefined, deletedAt: now() });
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

  /* ── hives + membership ───────────────────────────────────── */

  const membersOf = (hiveId) => memberships.get(String(hiveId)) || [];
  const shapeMember = (m) => ({ id: m.memberId, name: m.name, color: m.color, role: m.role });
  const hiveOfTrip = (tripId) => trips.get(String(tripId))?.hiveId ?? null;

  function isHiveMember(hiveId, userId) {
    return membersOf(hiveId).some((m) => m.userId === userId);
  }

  function requireHiveMember(hiveId, userId) {
    if (!hives.has(String(hiveId))) return err('hive_not_found', 404);
    if (!isHiveMember(hiveId, userId)) return err('forbidden', 403);
    return null;
  }

  function requireMember(tripId, userId) {
    const trip = trips.get(String(tripId));
    if (!trip) return err('trip_not_found', 404);
    if (!isHiveMember(trip.hiveId, userId)) return err('forbidden', 403);
    return null;
  }

  const isMember = (tripId, userId) => !requireMember(tripId, userId);

  /** The ledger key for `userId` in this hive (direct members: their user id). */
  function memberIdFor(hiveId, userId) {
    const m = membersOf(hiveId).find((x) => x.userId === userId);
    return m ? m.memberId : userId;
  }

  const memberIds = (hiveId) => membersOf(hiveId).map((m) => m.memberId);

  const tripSummary = (t) => ({ id: t.id, name: t.name, city: t.city, country: t.country, startDate: t.startDate, days: t.days, hiveId: t.hiveId });

  function hiveSummary(h, userId) {
    const members = membersOf(h.id);
    const me = members.find((m) => m.userId === userId);
    return {
      id: h.id,
      name: h.name,
      role: me?.role || 'member',
      memberCount: members.length,
      trips: [...trips.values()].filter((t) => t.hiveId === h.id).map(tripSummary),
    };
  }

  function listHivesForUser(userId) {
    return [...hives.values()].filter((h) => isHiveMember(h.id, userId)).map((h) => hiveSummary(h, userId));
  }

  function ownedHives(userId) {
    return [...hives.values()].filter((h) => h.ownerId === userId).length;
  }

  function createHive(userId, body) {
    const user = users.get(userId);
    if (!user) return err('unauthorized', 401);
    if (ownedHives(userId) >= capsFor(entitlementFor(userId).tier).hives) return err('hive_limit', 402);
    const hive = hiveFromBody(body, userId, id());
    hives.set(hive.id, hive);
    memberships.set(hive.id, [{ userId, memberId: userId, name: user.name || 'You', color: OWNER_COLOR, role: 'owner' }]);
    nestByHive.set(hive.id, []);
    tableByHive.set(hive.id, []);
    schedulePersist();
    return { hive: { ...hiveSummary(hive, userId) } };
  }

  function getHive(hiveId, userId) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const h = hives.get(String(hiveId));
    return {
      hive: hiveSummary(h, userId),
      members: membersOf(h.id).map(shapeMember),
      trips: hiveSummary(h, userId).trips,
      nest: (nestByHive.get(h.id) || []).map((n) => ({ ...n, reactions: { ...n.reactions } })),
      table: (tableByHive.get(h.id) || []).map((r) => ({ ...r })),
      me: memberIdFor(h.id, userId),
    };
  }

  function listTripsForUser(userId) {
    return [...trips.values()].filter((t) => isHiveMember(t.hiveId, userId)).map(tripSummary);
  }

  function getTrip(tripId, userId) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const trip = trips.get(String(tripId));
    return {
      trip: { ...trip, expenses: getFund(tripId, userId).expenses },
      spots: (spotsByTrip.get(String(tripId)) || []).map((s) => ({ ...s })),
      members: membersOf(trip.hiveId).map(shapeMember),
      fund: getFund(tripId, userId).fund,
      me: memberIdFor(trip.hiveId, userId),
    };
  }

  /** First hive the user belongs to, creating a personal one when they have none. */
  function defaultHiveFor(userId) {
    const mine = [...hives.values()].find((h) => isHiveMember(h.id, userId));
    if (mine) return mine.id;
    const user = users.get(userId);
    const made = createHive(userId, { name: `${user?.name || 'My'}’s hive` });
    return made.error ? null : made.hive.id;
  }

  function createTrip(userId, body, opts = {}) {
    const hiveId = body?.hiveId ? String(body.hiveId) : defaultHiveFor(userId);
    if (!hiveId) return err('hive_limit', 402);
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const count = [...trips.values()].filter((t) => t.hiveId === hiveId).length;
    if (count >= capsFor(entitlementFor(userId).tier).tripsPerHive) return err('trip_limit', 402);
    const tripId = id();
    const trip = { ...tripFromBody(body, userId, tripId), hiveId };
    trips.set(tripId, trip);
    spotsByTrip.set(tripId, (opts.seedSpots ? seed?.tripSpots || [] : []).map((sp) => ({ ...sp, tier: null, votes: 0 })));
    votesByTrip.set(tripId, []);
    fundByTrip.set(tripId, []);
    schedulePersist();
    return { trip: { ...trip } };
  }

  /* ── spots + votes ────────────────────────────────────────── */

  function castVote(tripId, userId, spotId, tier) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    if (!(TIERS.has(tier) || tier === null)) return err('invalid_tier', 400);
    const spots = spotsByTrip.get(String(tripId)) || [];
    const spot = spots.find((s) => s.id === Number(spotId));
    if (!spot) return err('spot_not_found', 404);
    const votes = votesByTrip.get(String(tripId)) || [];
    const prev = votes.find((v) => v.userId === userId && v.spotId === spot.id);
    if (prev) {
      if (prev.tier === tier || tier === null) {
        votesByTrip.set(String(tripId), votes.filter((v) => v !== prev));
        spot.tier = null;
        spot.votes = Math.max(0, (spot.votes || 0) - 1);
      } else {
        prev.tier = tier;
        prev.at = now();
        spot.tier = tier;
      }
    } else {
      votes.push({ spotId: spot.id, userId, tier, at: now() });
      votesByTrip.set(String(tripId), votes);
      spot.tier = tier;
      spot.votes = (spot.votes || 0) + 1;
    }
    schedulePersist();
    return { spot: { ...spot } };
  }

  function addSpot(tripId, userId, candidate, source) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const spots = spotsByTrip.get(String(tripId)) || [];
    if (spots.length >= MAX_SPOTS_PER_TRIP) return err('spot_limit', 400);
    const made = spotFromCandidate(candidate, source, nextSpotId);
    if (made.error) return made;
    nextSpotId++;
    spots.push(made.spot);
    spotsByTrip.set(String(tripId), spots);
    schedulePersist();
    return { spot: made.spot };
  }

  /* ── members + invites (hive level) ───────────────────────── */

  function addMember(hiveId, userId, name) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const display = cleanText(name, 64);
    if (!display) return err('invalid_name', 400);
    const members = membersOf(hiveId);
    if (members.length >= MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
    const member = { userId: null, memberId: 'invite-' + id(), name: display, color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], role: 'member' };
    members.push(member);
    memberships.set(String(hiveId), members);
    const inv = createInvite(hiveId, userId, { memberId: member.memberId });
    schedulePersist();
    return { member: shapeMember(member), invite: inv.invite };
  }

  function createInvite(hiveId, userId, opts = {}) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const h = String(hiveId);
    const memberId = opts.memberId ? String(opts.memberId) : null;
    if (memberId) {
      const m = membersOf(h).find((x) => x.memberId === memberId);
      if (!m) return err('member_not_found', 404);
      if (m.userId) return err('already_joined', 409);
    }
    let count = 0;
    for (const i of invites.values()) if (i.hiveId === h) count++;
    if (count >= LIMITS.MAX_INVITES_PER_TRIP) return err('invite_limit', 400);
    const invite = {
      code: newInviteCode(),
      hiveId: h,
      memberId,
      createdBy: userId,
      expiresAt: Date.now() + LIMITS.INVITE_TTL_MS,
      maxUses: memberId ? 1 : Math.max(1, Math.min(50, Math.floor(Number(opts.maxUses)) || 1)),
      uses: 0,
      createdAt: now(),
    };
    invites.set(invite.code, invite);
    schedulePersist();
    return { invite: publicInvite(invite) };
  }

  /** Public preview — enough to render "Maya invited you to Tokyo Crew" before sign-in. */
  function getInvite(code) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return err('invite_not_found', 404);
    const i = invites.get(code);
    const hive = i && hives.get(i.hiveId);
    if (!hive) return err('invite_not_found', 404);
    const inviter = users.get(i.createdBy);
    const slot = i.memberId ? membersOf(i.hiveId).find((m) => m.memberId === i.memberId) : null;
    const firstTrip = [...trips.values()].find((t) => t.hiveId === hive.id);
    return {
      invite: {
        code: i.code,
        expired: inviteExhausted(i),
        hive: { id: hive.id, name: hive.name },
        trip: firstTrip ? { id: firstTrip.id, name: firstTrip.name, city: firstTrip.city, country: firstTrip.country } : null,
        inviter: inviter?.name || 'A hive member',
        memberName: slot?.name || null,
      },
    };
  }

  function acceptInvite(code, userId) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return err('invite_not_found', 404);
    const i = invites.get(code);
    const hive = i && hives.get(i.hiveId);
    if (!hive) return err('invite_not_found', 404);
    const user = users.get(userId);
    if (!user || user.deletedAt) return err('unauthorized', 401);
    const members = membersOf(hive.id);
    const firstTrip = [...trips.values()].find((t) => t.hiveId === hive.id);
    const result = (member, joined) => ({
      hive: hiveSummary(hive, userId),
      trip: firstTrip ? tripSummary(firstTrip) : null,
      member: shapeMember(member),
      joined,
    });
    const existing = members.find((m) => m.userId === userId);
    if (existing) return result(existing, false);
    if (inviteExhausted(i)) return err('invite_expired', 410);
    let member;
    if (i.memberId) {
      const slot = members.find((m) => m.memberId === i.memberId);
      if (!slot) return err('member_not_found', 404);
      if (slot.userId) return err('invite_used', 409);
      slot.userId = userId;
      if (user.name && user.name !== 'You') slot.name = user.name;
      member = slot;
    } else {
      if (members.length >= MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
      member = { userId, memberId: userId, name: user.name || 'You', color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], role: 'member' };
      members.push(member);
      memberships.set(hive.id, members);
    }
    i.uses++;
    schedulePersist();
    return result(member, true);
  }

  /* ── Nest + Table ─────────────────────────────────────────── */

  function addListing(hiveId, userId, input) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const list = nestByHive.get(String(hiveId)) || [];
    if (list.length >= LIMITS.MAX_LISTINGS_PER_HIVE) return err('listing_limit', 400);
    const made = listingFromInput(input, nextItemId);
    if (made.error) return made;
    nextItemId++;
    list.push(made.listing);
    nestByHive.set(String(hiveId), list);
    schedulePersist();
    return { listing: { ...made.listing, reactions: { ...made.listing.reactions } } };
  }

  function toggleReaction(hiveId, userId, listingId, emoji) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    if (!REACTIONS.includes(emoji)) return err('invalid_reaction', 400);
    const listing = (nestByHive.get(String(hiveId)) || []).find((n) => n.id === Number(listingId));
    if (!listing) return err('listing_not_found', 404);
    const me = String(memberIdFor(hiveId, userId));
    const cur = listing.reactions[emoji] || [];
    listing.reactions[emoji] = cur.includes(me) ? cur.filter((x) => x !== me) : [...cur, me];
    schedulePersist();
    return { listing: { ...listing, reactions: { ...listing.reactions } } };
  }

  function addRestaurant(hiveId, userId, input) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const list = tableByHive.get(String(hiveId)) || [];
    if (list.length >= LIMITS.MAX_RESTAURANTS_PER_HIVE) return err('restaurant_limit', 400);
    const made = restaurantFromInput(input, nextItemId);
    if (made.error) return made;
    nextItemId++;
    list.push(made.restaurant);
    tableByHive.set(String(hiveId), list);
    schedulePersist();
    return { restaurant: { ...made.restaurant } };
  }

  function updateRestaurant(hiveId, userId, restaurantId, patch) {
    const denied = requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const r = (tableByHive.get(String(hiveId)) || []).find((x) => x.id === Number(restaurantId));
    if (!r) return err('restaurant_not_found', 404);
    if (patch?.tried !== undefined) r.tried = Boolean(patch.tried);
    if (patch?.tier !== undefined) {
      if (!TIERS.has(patch.tier)) return err('invalid_tier', 400);
      r.tier = patch.tier;
    }
    schedulePersist();
    return { restaurant: { ...r } };
  }

  /* ── entitlements + referrals ─────────────────────────────── */

  /** Active tier for a user; an expired record reads as Free. */
  function entitlementFor(userId) {
    const e = entitlements.get(userId);
    if (!e) return { tier: 'Free', expiresAt: null, source: 'none' };
    if (e.expiresAt && Date.parse(e.expiresAt) < Date.now()) return { tier: 'Free', expiresAt: e.expiresAt, source: 'expired' };
    return { tier: e.tier, expiresAt: e.expiresAt, source: e.source };
  }

  function issueReferralCode(user) {
    if (user.referralCode) return user.referralCode;
    let code = newReferralCode(user.name);
    while (referrerFor(code)) code = newReferralCode(user.name);
    user.referralCode = code; // permanent — never regenerated
    return code;
  }

  /** Apply a normalised billing event (idempotent by eventId). */
  function applyEntitlement(input) {
    const norm = entitlementFromInput(input);
    if (norm.error) return norm;
    const { userId, tier, expiresAt, source, eventId } = norm.entitlement;
    const user = users.get(userId);
    if (!user || user.deletedAt) return err('user_not_found', 404);
    if (eventId && billingEvents.has(eventId)) return { ok: true, duplicate: true, ...meProfile(user) };
    if (eventId) {
      if (billingEvents.size >= LIMITS.MAX_BILLING_EVENTS) billingEvents.delete(billingEvents.values().next().value);
      billingEvents.add(eventId);
    }
    entitlements.set(userId, { tier, source, expiresAt, updatedAt: now() });
    if (tier !== 'Free') issueReferralCode(user);
    schedulePersist();
    return { ok: true, duplicate: false, ...meProfile(user) };
  }

  /** Non-production helper: mirrors the demo pricing sheet server-side. */
  function demoPurchase(userId, tier) {
    return applyEntitlement({ userId, tier, source: 'demo', eventId: null });
  }

  function meProfile(user) {
    const entitlement = entitlementFor(user.id);
    return {
      user: publicUser(user),
      entitlement,
      features: featuresFor(entitlement.tier),
      caps: capsFor(entitlement.tier),
      referralCode: user.referralCode || null,
      referredBy: user.referredBy || null,
    };
  }

  /* ── money ────────────────────────────────────────────────── */

  function books(tripId) {
    const trip = trips.get(String(tripId));
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const fund = fundByTrip.get(String(tripId)) || [];
    fundByTrip.set(String(tripId), fund);
    const owner = trip.ownerId || hives.get(trip.hiveId)?.ownerId || memberIds(trip.hiveId)[0];
    return { trip, fund, owner, ids: memberIds(trip.hiveId) };
  }

  function getFund(tripId, userId) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const { trip, fund, owner } = books(tripId);
    return {
      fund: fund.map((f) => ({ ...f })),
      // Legacy rows carry no payer; pin them to the owner so every member computes the same balances.
      expenses: trip.expenses.map((e) => ({ ...e, paidBy: e.paidBy ?? owner })),
    };
  }

  function contribute(tripId, userId, amount) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const amt = Number(amount);
    if (!isValidAmount(amt)) return err('invalid_amount', 400);
    const { trip, fund } = books(tripId);
    if (fund.length >= MAX_FUND_ENTRIES_PER_TRIP) return err('fund_limit', 400);
    fund.push({ id: nextLedgerId++, memberId: memberIdFor(trip.hiveId, userId), kind: 'contribution', amount: amt, at: now() });
    schedulePersist();
    return getFund(tripId, userId);
  }

  function withdraw(tripId, userId, amount) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const amt = Number(amount);
    if (!isValidAmount(amt)) return err('invalid_amount', 400);
    const { trip, fund, owner, ids } = books(tripId);
    if (fund.length >= MAX_FUND_ENTRIES_PER_TRIP) return err('fund_limit', 400);
    const me = memberIdFor(trip.hiveId, userId);
    const limit = withdrawable(me, ids, trip.expenses, fund, owner);
    if (toCents(amt) > toCents(limit)) return err('exceeds_envelope', 400, { withdrawable: limit });
    fund.push({ id: nextLedgerId++, memberId: me, kind: 'withdrawal', amount: amt, at: now() });
    schedulePersist();
    return getFund(tripId, userId);
  }

  function addExpense(tripId, userId, input) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const { trip, fund, owner, ids } = books(tripId);
    if (trip.expenses.length >= MAX_EXPENSES_PER_TRIP) return err('expense_limit', 400);
    const norm = expenseFromInput(input, ids, memberIdFor(trip.hiveId, userId));
    if (norm.error) return norm;
    const expense = { id: nextLedgerId++, ...norm.expense };
    if (expense.paidBy === 'pot') {
      const shortfalls = potShortfalls(expense, ids, trip.expenses, fund, owner);
      if (shortfalls.length) return err('pot_shortfall', 400, { shortfalls });
    }
    trip.expenses.push(expense);
    schedulePersist();
    return { expense: { ...expense }, ...getFund(tripId, userId) };
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
    requestMagicLink,
    consumeMagicLink,
    deleteAccount,
    entitlementFor,
    applyEntitlement,
    demoPurchase,
    meProfile,
    listHivesForUser,
    createHive,
    getHive,
    hiveOfTrip,
    listTripsForUser,
    getTrip,
    castVote,
    addMember,
    addSpot,
    createTrip,
    createInvite,
    getInvite,
    acceptInvite,
    addListing,
    toggleReaction,
    addRestaurant,
    updateRestaurant,
    getFund,
    contribute,
    withdraw,
    addExpense,
    isMember,
    requireMember,
    requireHiveMember,
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
    _hives: hives,
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
  const persistPath = options.persistPath === undefined ? defaultPersistPath() : options.persistPath;
  const store = createStore(seed, { persistPath });
  if (persistPath) {
    const snap = await loadSnapshot(persistPath);
    if (snap) store.hydrate(snap);
  }
  return store;
}
