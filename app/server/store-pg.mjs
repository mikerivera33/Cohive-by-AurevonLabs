/**
 * Postgres-backed Cohive store — same interface as store.mjs, every method
 * async. The hive is the membership unit; money operations run in one
 * transaction with the trip row locked, so two members acting at once cannot
 * both pass the envelope check.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { createDb } from './db.mjs';
import { potShortfalls, toCents, withdrawable } from './engine-bundle.mjs';
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
  normalizePayHandle,
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

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({
  salt,
  hash: scryptSync(password, salt, 32).toString('hex'),
});
const verifyPassword = (password, salt, hash) => {
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  return prev.length === next.length && timingSafeEqual(prev, next);
};
const err = (error, status, extra = {}) => ({ error, status, ...extra });
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

const tripRow = (r) => ({
  id: r.id,
  hiveId: r.hive_id,
  name: r.name,
  city: r.city,
  country: r.country,
  startDate: r.start_date,
  days: r.days,
  pace: r.pace,
  startHour: r.start_hour,
  endHour: r.end_hour,
  budget: Number(r.budget),
  currency: r.currency,
  lat: r.lat,
  lng: r.lng,
  ownerId: r.owner_id,
});
const tripSummary = (r) => ({ id: r.id, name: r.name, city: r.city, country: r.country, startDate: r.start_date, days: r.days, hiveId: r.hive_id });
const memberRow = (m) => ({ id: m.member_id, name: m.name, color: m.color, role: m.role, payHandle: m.pay_handle || null });
const expenseRow = (e) => ({
  id: Number(e.id),
  label: e.label,
  category: e.category,
  amount: Number(e.amount),
  paidBy: e.paid_by ?? undefined,
  splitWith: Array.isArray(e.split_with) ? e.split_with : undefined,
  voidedAt: e.voided_at ? iso(e.voided_at) : null,
  voidedBy: e.voided_by || undefined,
});
const fundRow = (f) => ({ id: Number(f.id), memberId: f.member_id, kind: f.kind, amount: Number(f.amount), at: iso(f.at) });
const itemRow = (r) => ({ ...r.data, id: Number(r.id) });
const userRow = (u) =>
  u && {
    id: u.id,
    email: u.email,
    name: u.name,
    salt: u.salt,
    hash: u.hash,
    provider: u.provider,
    contact: u.contact,
    oauthVerified: u.oauth_verified,
    referralCode: u.referral_code || null,
    referredBy: u.referred_by || null,
    payHandle: u.pay_handle || null,
    deletedAt: u.deleted_at,
    createdAt: iso(u.created_at),
  };

/**
 * @param {object | null} seed
 * @param {{ url: string }} options
 */
export async function createPgStore(seed, { url }) {
  const db = createDb(url);
  await db.migrate();
  if (seed?.trip) await bootstrapSeed(seed);

  async function bootstrapSeed(s) {
    const hiveId = String(s.hive?.id ?? s.trip.id ?? 1);
    const tripId = String(s.trip.id ?? 1);
    const { rowCount } = await db.query('SELECT 1 FROM hives WHERE id = $1', [hiveId]);
    if (rowCount) return;
    await db.tx(async (c) => {
      await c.query('INSERT INTO hives (id, owner_id, name) VALUES ($1, NULL, $2)', [hiveId, s.hive?.name || s.trip.name]);
      await insertTripRow(c, { ...tripFromBody(s.trip, null, tripId), hiveId, ownerId: null });
      for (const sp of s.tripSpots || []) {
        await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [tripId, sp.id, JSON.stringify(sp)]);
      }
      for (const e of s.trip.expenses || []) {
        await c.query('INSERT INTO expenses (trip_id, label, category, amount) VALUES ($1, $2, $3, $4)', [tripId, e.label, e.category, e.amount]);
      }
      for (const n of s.nest || []) {
        await c.query('INSERT INTO listings (hive_id, data) VALUES ($1, $2)', [hiveId, JSON.stringify(n)]);
      }
      for (const r of s.table || []) {
        await c.query('INSERT INTO restaurants (hive_id, data) VALUES ($1, $2)', [hiveId, JSON.stringify(r)]);
      }
    });
  }

  /* ── users + sessions ─────────────────────────────────────── */

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

  async function userByEmail(email, c = db) {
    const { rows } = await c.query('SELECT * FROM users WHERE email = $1', [email]);
    return userRow(rows[0]);
  }
  async function userById(id, c = db) {
    const { rows } = await c.query('SELECT * FROM users WHERE id = $1', [id]);
    return userRow(rows[0]);
  }
  async function insertUser(c, u) {
    await c.query(
      `INSERT INTO users (id, email, name, salt, hash, provider, contact, oauth_verified, referred_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.email, u.name, u.salt ?? null, u.hash ?? null, u.provider ?? null, u.contact ?? null, Boolean(u.oauthVerified), u.referredBy ?? null]
    );
    return { ...u, createdAt: new Date().toISOString() };
  }

  /** The user who owns `code`, or null. */
  async function referrerFor(code, c = db) {
    const norm = String(code || '').trim().toUpperCase();
    if (!REFERRAL_CODE_RE.test(norm)) return null;
    const { rows } = await c.query('SELECT * FROM users WHERE referral_code = $1 AND deleted_at IS NULL', [norm]);
    return userRow(rows[0]) || null;
  }
  async function createSession(userId, c = db) {
    const token = newToken();
    await c.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, new Date(Date.now() + LIMITS.SESSION_TTL_MS)]);
    return token;
  }

  async function getSessionUser(token) {
    if (!token || !TOKEN_RE.test(token)) return null;
    const { rows } = await db.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [token]
    );
    return userRow(rows[0]) || null;
  }

  async function logout(token) {
    if (token && TOKEN_RE.test(token)) await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async function register({ email, name, password, ref }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    const pw = String(password || '');
    if (pw.length < 8 || pw.length > 200) return err('weak_password', 400);
    if (await userByEmail(norm)) return err('email_taken', 409);
    const referrer = await referrerFor(ref);
    const user = await insertUser(db, { id: newId(), email: norm, name: cleanText(name || norm.split('@')[0], 64) || 'You', ...hashPassword(pw), referredBy: referrer?.id || null });
    return { user: publicUser(user), token: await createSession(user.id) };
  }

  async function login({ email, password }) {
    const user = await userByEmail(normalizeEmail(email));
    if (!user || user.deletedAt || !verifyPassword(String(password || ''), user.salt, user.hash)) return err('invalid_credentials', 401);
    return { user: publicUser(user), token: await createSession(user.id) };
  }

  async function demoAuth({ provider, name, contact, ref }) {
    const p = String(provider || 'email');
    if (!['apple', 'google', 'email', 'phone'].includes(p)) return err('invalid_provider', 400);
    const display = cleanText(name || 'You', 64) || 'You';
    const rawContact = cleanText(contact, 120);
    let email;
    if (p === 'email' && rawContact.includes('@')) email = rawContact.toLowerCase();
    else if (p === 'phone' && rawContact) email = `phone-${rawContact.replace(/[^\d+]/g, '').slice(0, 20) || newId().slice(0, 8)}@cohive.local`;
    else email = `demo-${p}-${newId().slice(0, 8)}@cohive.local`;
    let user = await userByEmail(email);
    if (!user) user = await insertUser(db, { id: newId(), email, name: display, ...hashPassword(newToken()), provider: p, contact: rawContact || null, referredBy: (await referrerFor(ref))?.id || null });
    await ensureDemoMembership(user);
    return { user: publicUser(user), token: await createSession(user.id), mode: 'demo' };
  }

  async function oauthUpsert({ provider, email, name, verified }) {
    const p = provider === 'apple' ? 'apple' : 'google';
    const norm = normalizeEmail(email);
    const mail = norm || `oauth-${p}-${newId().slice(0, 8)}@cohive.local`;
    const display = cleanText(name || 'You', 64) || 'You';
    let user = await userByEmail(mail);
    if (!user) {
      user = await insertUser(db, { id: newId(), email: mail, name: display, ...hashPassword(newToken()), provider: p, oauthVerified: Boolean(verified) });
    } else {
      await db.query("UPDATE users SET provider = $2, oauth_verified = $3, name = CASE WHEN $4 <> 'You' THEN $4 ELSE name END WHERE id = $1", [user.id, p, Boolean(verified), display]);
    }
    await ensureDemoMembership(user);
    return { user: publicUser(user), token: await createSession(user.id), mode: verified ? 'oauth' : 'oauth_provisional' };
  }

  /** Demo sign-ins join the shared seed hive, as in the in-memory store. */
  async function ensureDemoMembership(user) {
    const hiveId = String(seed?.hive?.id ?? seed?.trip?.id ?? '1');
    await db.tx(async (c) => {
      const h = await c.query('SELECT owner_id FROM hives WHERE id = $1 FOR UPDATE', [hiveId]);
      if (!h.rowCount) return;
      const m = await c.query('SELECT 1 FROM hive_members WHERE hive_id = $1 AND user_id = $2', [hiveId, user.id]);
      if (m.rowCount) return;
      const count = await c.query('SELECT count(*)::int AS n FROM hive_members WHERE hive_id = $1', [hiveId]);
      const first = count.rows[0].n === 0;
      if (first) await c.query('UPDATE hives SET owner_id = $2 WHERE id = $1 AND owner_id IS NULL', [hiveId, user.id]);
      await c.query('INSERT INTO hive_members (hive_id, member_id, user_id, name, color, role) VALUES ($1, $2, $2, $3, $4, $5)', [hiveId, user.id, user.name, OWNER_COLOR, first ? 'owner' : 'member']);
    });
  }

  /* ── magic links ──────────────────────────────────────────── */

  async function requestMagicLink({ email, name, ref }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    const token = newToken();
    await db.query("DELETE FROM magic_links WHERE expires_at < now() - interval '1 day'");
    // The referral code rides in the name column's sibling: a JSON note keeps the schema stable.
    const note = cleanText(ref, 12).toUpperCase();
    await db.query('INSERT INTO magic_links (token_hash, email, name, expires_at) VALUES ($1, $2, $3, $4)', [sha256(token), norm, JSON.stringify({ name: cleanText(name, 64) || null, ref: note || null }), new Date(Date.now() + LIMITS.MAGIC_TTL_MS)]);
    return { token, email: norm };
  }

  async function consumeMagicLink(token) {
    if (!token || !TOKEN_RE.test(token)) return err('invalid_token', 400);
    return db.tx(async (c) => {
      const { rows } = await c.query('UPDATE magic_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, name', [sha256(token)]);
      if (!rows.length) return err('invalid_token', 400);
      const { email } = rows[0];
      let meta = { name: null, ref: null };
      try {
        meta = { ...meta, ...JSON.parse(rows[0].name || '{}') };
      } catch {
        meta.name = rows[0].name;
      }
      let user = await userByEmail(email, c);
      let created = false;
      if (!user) {
        user = await insertUser(c, { id: newId(), email, name: meta.name || email.split('@')[0], provider: 'email', oauthVerified: true, referredBy: (await referrerFor(meta.ref, c))?.id || null });
        created = true;
        // A real account starts with its own hive and trip, not the shared demo one.
        const hive = await insertHive(c, hiveFromBody({ name: `${user.name}’s hive` }, user.id, newId()), user);
        const t = { ...tripFromBody({ ...(seed?.trip || {}), name: 'My first trip' }, user.id, newId()), hiveId: hive.id };
        await insertTripRow(c, t);
        for (const sp of seed?.tripSpots || []) {
          await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [t.id, sp.id, JSON.stringify({ ...sp, tier: null, votes: 0 })]);
        }
      } else if (user.deletedAt) {
        return err('account_deleted', 410);
      } else {
        await c.query('UPDATE users SET oauth_verified = true WHERE id = $1', [user.id]);
      }
      return { user: publicUser(user), token: await createSession(user.id, c), mode: 'magic', created };
    });
  }

  async function deleteAccount(userId) {
    return db.tx(async (c) => {
      const user = await userById(userId, c);
      if (!user) return err('not_found', 404);
      await c.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await c.query(
        `UPDATE users SET email = $2, name = 'Deleted member', salt = NULL, hash = NULL, provider = NULL,
         contact = NULL, oauth_verified = false, deleted_at = now() WHERE id = $1`,
        [userId, `deleted-${userId}@cohive.local`]
      );
      await c.query("UPDATE hive_members SET user_id = NULL, name = 'Deleted member' WHERE user_id = $1", [userId]);
      return { ok: true };
    });
  }

  /* ── hives + membership ───────────────────────────────────── */

  async function membersOf(hiveId, c = db) {
    const { rows } = await c.query(
      `SELECT m.*, u.pay_handle FROM hive_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.hive_id = $1 ORDER BY m.joined_at, m.member_id`,
      [String(hiveId)]
    );
    return rows;
  }
  async function membershipFor(hiveId, userId, c = db) {
    const { rows } = await c.query('SELECT * FROM hive_members WHERE hive_id = $1 AND user_id = $2', [String(hiveId), userId]);
    return rows[0] || null;
  }
  async function hiveOfTrip(tripId, c = db) {
    const { rows } = await c.query('SELECT hive_id FROM trips WHERE id = $1', [String(tripId)]);
    return rows[0]?.hive_id ?? null;
  }
  async function requireHiveMember(hiveId, userId, c = db) {
    const h = await c.query('SELECT 1 FROM hives WHERE id = $1', [String(hiveId)]);
    if (!h.rowCount) return err('hive_not_found', 404);
    if (!(await membershipFor(hiveId, userId, c))) return err('forbidden', 403);
    return null;
  }
  async function requireMember(tripId, userId, c = db) {
    const hiveId = await hiveOfTrip(tripId, c);
    if (!hiveId) return err('trip_not_found', 404);
    if (!(await membershipFor(hiveId, userId, c))) return err('forbidden', 403);
    return null;
  }
  const isMember = async (tripId, userId) => !(await requireMember(tripId, userId));

  async function tripsOfHive(hiveId, c = db) {
    const { rows } = await c.query('SELECT * FROM trips WHERE hive_id = $1 ORDER BY created_at', [String(hiveId)]);
    return rows;
  }

  async function hiveSummary(h, userId, c = db) {
    const members = await membersOf(h.id, c);
    const me = members.find((m) => m.user_id === userId);
    return { id: h.id, name: h.name, role: me?.role || 'member', memberCount: members.length, trips: (await tripsOfHive(h.id, c)).map(tripSummary) };
  }

  async function listHivesForUser(userId) {
    const { rows } = await db.query('SELECT h.* FROM hives h JOIN hive_members m ON m.hive_id = h.id WHERE m.user_id = $1 ORDER BY h.created_at', [userId]);
    return Promise.all(rows.map((h) => hiveSummary(h, userId)));
  }

  async function insertHive(c, hive, user) {
    await c.query('INSERT INTO hives (id, owner_id, name) VALUES ($1, $2, $3)', [hive.id, user.id, hive.name]);
    await c.query('INSERT INTO hive_members (hive_id, member_id, user_id, name, color, role) VALUES ($1, $2, $2, $3, $4, $5)', [hive.id, user.id, user.name || 'You', OWNER_COLOR, 'owner']);
    return hive;
  }

  async function createHive(userId, body) {
    const user = await userById(userId);
    if (!user) return err('unauthorized', 401);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM hives WHERE owner_id = $1', [userId]);
    if (rows[0].n >= capsFor((await entitlementFor(userId)).tier).hives) return err('hive_limit', 402);
    const hive = hiveFromBody(body, userId, newId());
    await db.tx((c) => insertHive(c, hive, user));
    return { hive: await hiveSummary(hive, userId) };
  }

  async function getHive(hiveId, userId) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const id = String(hiveId);
    const [{ rows: h }, members, { rows: nest }, { rows: table }] = await Promise.all([
      db.query('SELECT * FROM hives WHERE id = $1', [id]),
      membersOf(id),
      db.query('SELECT * FROM listings WHERE hive_id = $1 ORDER BY id', [id]),
      db.query('SELECT * FROM restaurants WHERE hive_id = $1 ORDER BY id', [id]),
    ]);
    const summary = await hiveSummary(h[0], userId);
    const me = members.find((m) => m.user_id === userId);
    return { hive: summary, members: members.map(memberRow), trips: summary.trips, nest: nest.map(itemRow), table: table.map(itemRow), me: me ? me.member_id : null };
  }

  async function listTripsForUser(userId) {
    const { rows } = await db.query('SELECT t.* FROM trips t JOIN hive_members m ON m.hive_id = t.hive_id WHERE m.user_id = $1 ORDER BY t.created_at', [userId]);
    return rows.map(tripSummary);
  }

  async function getTrip(tripId, userId) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const id = String(tripId);
    const { rows: t } = await db.query('SELECT * FROM trips WHERE id = $1', [id]);
    const [{ rows: spots }, members, books] = await Promise.all([
      db.query('SELECT data FROM spots WHERE trip_id = $1 ORDER BY id', [id]),
      membersOf(t[0].hive_id),
      loadBooks(id),
    ]);
    const me = members.find((m) => m.user_id === userId);
    return { trip: { ...tripRow(t[0]), expenses: books.expenses }, spots: spots.map((s) => s.data), members: members.map(memberRow), fund: books.fund, me: me ? me.member_id : null };
  }

  async function insertTripRow(c, t) {
    await c.query(
      `INSERT INTO trips (id, hive_id, owner_id, name, city, country, start_date, days, pace, start_hour, end_hour, budget, currency, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [t.id, t.hiveId, t.ownerId, t.name, t.city, t.country, t.startDate, t.days, t.pace, t.startHour, t.endHour, t.budget, t.currency, t.lat, t.lng]
    );
  }

  async function createTrip(userId, body, opts = {}) {
    const user = await userById(userId);
    if (!user) return err('unauthorized', 401);
    return db.tx(async (c) => {
      let hiveId = body?.hiveId ? String(body.hiveId) : null;
      if (!hiveId) {
        const { rows } = await c.query('SELECT h.id FROM hives h JOIN hive_members m ON m.hive_id = h.id WHERE m.user_id = $1 ORDER BY h.created_at LIMIT 1', [userId]);
        hiveId = rows[0]?.id;
        if (!hiveId) {
          const owned = await c.query('SELECT count(*)::int AS n FROM hives WHERE owner_id = $1', [userId]);
          if (owned.rows[0].n >= capsFor((await entitlementFor(userId, c)).tier).hives) return err('hive_limit', 402);
          hiveId = (await insertHive(c, hiveFromBody({ name: `${user.name}’s hive` }, userId, newId()), user)).id;
        }
      }
      const denied = await requireHiveMember(hiveId, userId, c);
      if (denied) return denied;
      await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [hiveId]);
      const { rows } = await c.query('SELECT count(*)::int AS n FROM trips WHERE hive_id = $1', [hiveId]);
      if (rows[0].n >= capsFor((await entitlementFor(userId, c)).tier).tripsPerHive) return err('trip_limit', 402);
      const t = { ...tripFromBody(body, userId, newId()), hiveId };
      await insertTripRow(c, t);
      if (opts.seedSpots) {
        for (const sp of seed?.tripSpots || []) {
          await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [t.id, sp.id, JSON.stringify({ ...sp, tier: null, votes: 0 })]);
        }
      }
      return { trip: { ...t } };
    });
  }

  /* ── spots + votes ────────────────────────────────────────── */

  async function castVote(tripId, userId, spotId, tier) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    if (!(TIERS.has(tier) || tier === null)) return err('invalid_tier', 400);
    const id = String(tripId);
    const sid = Number(spotId);
    return db.tx(async (c) => {
      const { rows } = await c.query('SELECT data FROM spots WHERE trip_id = $1 AND id = $2 FOR UPDATE', [id, sid]);
      if (!rows.length) return err('spot_not_found', 404);
      const spot = rows[0].data;
      const prev = await c.query('SELECT tier FROM votes WHERE trip_id = $1 AND spot_id = $2 AND user_id = $3', [id, sid, userId]);
      if (prev.rowCount) {
        if (prev.rows[0].tier === tier || tier === null) {
          await c.query('DELETE FROM votes WHERE trip_id = $1 AND spot_id = $2 AND user_id = $3', [id, sid, userId]);
          spot.tier = null;
          spot.votes = Math.max(0, (spot.votes || 0) - 1);
        } else {
          await c.query('UPDATE votes SET tier = $4, at = now() WHERE trip_id = $1 AND spot_id = $2 AND user_id = $3', [id, sid, userId, tier]);
          spot.tier = tier;
        }
      } else {
        await c.query('INSERT INTO votes (trip_id, spot_id, user_id, tier) VALUES ($1, $2, $3, $4)', [id, sid, userId, tier]);
        spot.tier = tier;
        spot.votes = (spot.votes || 0) + 1;
      }
      await c.query('UPDATE spots SET data = $3 WHERE trip_id = $1 AND id = $2', [id, sid, JSON.stringify(spot)]);
      return { spot: { ...spot } };
    });
  }

  async function addSpot(tripId, userId, candidate, source) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const id = String(tripId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
      const { rows } = await c.query('SELECT count(*)::int AS n, COALESCE(MAX(id), 499) AS max FROM spots WHERE trip_id = $1', [id]);
      if (rows[0].n >= LIMITS.MAX_SPOTS_PER_TRIP) return err('spot_limit', 400);
      const made = spotFromCandidate(candidate, source, Math.max(500, Number(rows[0].max) + 1));
      if (made.error) return made;
      await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [id, made.spot.id, JSON.stringify(made.spot)]);
      return { spot: made.spot };
    });
  }

  /* ── members + invites (hive level) ───────────────────────── */

  async function addMember(hiveId, userId, name) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const display = cleanText(name, 64);
    if (!display) return err('invalid_name', 400);
    const id = String(hiveId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [id]);
      const members = await membersOf(id, c);
      if (members.length >= LIMITS.MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
      const memberId = 'invite-' + newId();
      const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
      await c.query('INSERT INTO hive_members (hive_id, member_id, user_id, name, color, role) VALUES ($1, $2, NULL, $3, $4, $5)', [id, memberId, display, color, 'member']);
      const invite = await insertInvite(c, id, userId, { memberId, maxUses: 1 });
      return { member: { id: memberId, name: display, color, role: 'member' }, invite: publicInvite(invite) };
    });
  }

  async function insertInvite(c, hiveId, createdBy, { memberId = null, maxUses = 1 }) {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM invites WHERE hive_id = $1', [hiveId]);
    if (rows[0].n >= LIMITS.MAX_INVITES_PER_TRIP) throw Object.assign(new Error('invite_limit'), { code: 'invite_limit' });
    const invite = {
      code: newInviteCode(),
      hiveId,
      memberId,
      createdBy,
      expiresAt: new Date(Date.now() + LIMITS.INVITE_TTL_MS),
      maxUses: memberId ? 1 : Math.max(1, Math.min(50, Math.floor(Number(maxUses)) || 1)),
      uses: 0,
    };
    await c.query('INSERT INTO invites (code, hive_id, member_id, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6)', [invite.code, hiveId, memberId, createdBy, invite.expiresAt, invite.maxUses]);
    return invite;
  }

  async function createInvite(hiveId, userId, opts = {}) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const id = String(hiveId);
    const memberId = opts.memberId ? String(opts.memberId) : null;
    try {
      return await db.tx(async (c) => {
        await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [id]);
        if (memberId) {
          const { rows } = await c.query('SELECT user_id FROM hive_members WHERE hive_id = $1 AND member_id = $2', [id, memberId]);
          if (!rows.length) return err('member_not_found', 404);
          if (rows[0].user_id) return err('already_joined', 409);
        }
        return { invite: publicInvite(await insertInvite(c, id, userId, { memberId, maxUses: opts.maxUses })) };
      });
    } catch (e) {
      if (e?.code === 'invite_limit') return err('invite_limit', 400);
      throw e;
    }
  }

  async function getInvite(code) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return err('invite_not_found', 404);
    const { rows } = await db.query(
      `SELECT i.*, h.name AS hive_name, u.name AS inviter, m.name AS member_name
       FROM invites i JOIN hives h ON h.id = i.hive_id
       LEFT JOIN users u ON u.id = i.created_by
       LEFT JOIN hive_members m ON m.hive_id = i.hive_id AND m.member_id = i.member_id
       WHERE i.code = $1`,
      [code]
    );
    if (!rows.length) return err('invite_not_found', 404);
    const i = rows[0];
    const first = (await tripsOfHive(i.hive_id))[0];
    return {
      invite: {
        code: i.code,
        expired: inviteExhausted({ expiresAt: i.expires_at, uses: i.uses, maxUses: i.max_uses }),
        hive: { id: i.hive_id, name: i.hive_name },
        trip: first ? { id: first.id, name: first.name, city: first.city, country: first.country } : null,
        inviter: i.inviter || 'A hive member',
        memberName: i.member_name || null,
      },
    };
  }

  async function acceptInvite(code, userId) {
    if (!INVITE_CODE_RE.test(String(code || ''))) return err('invite_not_found', 404);
    const user = await userById(userId);
    if (!user || user.deletedAt) return err('unauthorized', 401);
    return db.tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM invites WHERE code = $1 FOR UPDATE', [code]);
      if (!rows.length) return err('invite_not_found', 404);
      const i = rows[0];
      await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [i.hive_id]);
      const { rows: h } = await c.query('SELECT * FROM hives WHERE id = $1', [i.hive_id]);
      if (!h.length) return err('invite_not_found', 404);
      const first = (await tripsOfHive(i.hive_id, c))[0];
      const result = async (member, joined) => ({ hive: await hiveSummary(h[0], userId, c), trip: first ? tripSummary(first) : null, member: memberRow(member), joined });
      const existing = await membershipFor(i.hive_id, userId, c);
      if (existing) return result(existing, false);
      if (inviteExhausted({ expiresAt: i.expires_at, uses: i.uses, maxUses: i.max_uses })) return err('invite_expired', 410);
      const members = await membersOf(i.hive_id, c);
      let member;
      if (i.member_id) {
        const slot = members.find((m) => m.member_id === i.member_id);
        if (!slot) return err('member_not_found', 404);
        if (slot.user_id) return err('invite_used', 409);
        const name = user.name && user.name !== 'You' ? user.name : slot.name;
        await c.query('UPDATE hive_members SET user_id = $3, name = $4 WHERE hive_id = $1 AND member_id = $2', [i.hive_id, i.member_id, userId, name]);
        member = { ...slot, user_id: userId, name };
      } else {
        if (members.length >= LIMITS.MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
        member = { member_id: userId, user_id: userId, name: user.name || 'You', color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], role: 'member' };
        await c.query('INSERT INTO hive_members (hive_id, member_id, user_id, name, color, role) VALUES ($1, $2, $3, $4, $5, $6)', [i.hive_id, member.member_id, userId, member.name, member.color, member.role]);
      }
      await c.query('UPDATE invites SET uses = uses + 1 WHERE code = $1', [code]);
      return result(member, true);
    });
  }

  /* ── Nest + Table ─────────────────────────────────────────── */

  async function addListing(hiveId, userId, input) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const id = String(hiveId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [id]);
      const { rows } = await c.query('SELECT count(*)::int AS n FROM listings WHERE hive_id = $1', [id]);
      if (rows[0].n >= LIMITS.MAX_LISTINGS_PER_HIVE) return err('listing_limit', 400);
      const made = listingFromInput(input, 0);
      if (made.error) return made;
      const { listing } = made;
      const ins = await c.query('INSERT INTO listings (hive_id, data, created_by) VALUES ($1, $2, $3) RETURNING id', [id, JSON.stringify(listing), userId]);
      listing.id = Number(ins.rows[0].id);
      await c.query('UPDATE listings SET data = $2 WHERE id = $1', [listing.id, JSON.stringify(listing)]);
      return { listing };
    });
  }

  async function toggleReaction(hiveId, userId, listingId, emoji) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    if (!REACTIONS.includes(emoji)) return err('invalid_reaction', 400);
    const id = String(hiveId);
    return db.tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM listings WHERE hive_id = $1 AND id = $2 FOR UPDATE', [id, Number(listingId)]);
      if (!rows.length) return err('listing_not_found', 404);
      const listing = itemRow(rows[0]);
      const me = String((await membershipFor(id, userId, c))?.member_id ?? userId);
      const cur = listing.reactions?.[emoji] || [];
      listing.reactions = { ...listing.reactions, [emoji]: cur.includes(me) ? cur.filter((x) => x !== me) : [...cur, me] };
      await c.query('UPDATE listings SET data = $2 WHERE id = $1', [listing.id, JSON.stringify(listing)]);
      return { listing };
    });
  }

  async function addRestaurant(hiveId, userId, input) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    const id = String(hiveId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM hives WHERE id = $1 FOR UPDATE', [id]);
      const { rows } = await c.query('SELECT count(*)::int AS n FROM restaurants WHERE hive_id = $1', [id]);
      if (rows[0].n >= LIMITS.MAX_RESTAURANTS_PER_HIVE) return err('restaurant_limit', 400);
      const made = restaurantFromInput(input, 0);
      if (made.error) return made;
      const { restaurant } = made;
      const ins = await c.query('INSERT INTO restaurants (hive_id, data, created_by) VALUES ($1, $2, $3) RETURNING id', [id, JSON.stringify(restaurant), userId]);
      restaurant.id = Number(ins.rows[0].id);
      await c.query('UPDATE restaurants SET data = $2 WHERE id = $1', [restaurant.id, JSON.stringify(restaurant)]);
      return { restaurant };
    });
  }

  async function updateRestaurant(hiveId, userId, restaurantId, patch) {
    const denied = await requireHiveMember(hiveId, userId);
    if (denied) return denied;
    if (patch?.tier !== undefined && !TIERS.has(patch.tier)) return err('invalid_tier', 400);
    const id = String(hiveId);
    return db.tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM restaurants WHERE hive_id = $1 AND id = $2 FOR UPDATE', [id, Number(restaurantId)]);
      if (!rows.length) return err('restaurant_not_found', 404);
      const r = itemRow(rows[0]);
      if (patch?.tried !== undefined) r.tried = Boolean(patch.tried);
      if (patch?.tier !== undefined) r.tier = patch.tier;
      await c.query('UPDATE restaurants SET data = $2 WHERE id = $1', [r.id, JSON.stringify(r)]);
      return { restaurant: r };
    });
  }

  /* ── entitlements + referrals ─────────────────────────────── */

  async function entitlementFor(userId, c = db) {
    const { rows } = await c.query('SELECT tier, source, expires_at FROM entitlements WHERE user_id = $1', [userId]);
    const e = rows[0];
    if (!e) return { tier: 'Free', expiresAt: null, source: 'none' };
    const expiresAt = e.expires_at ? iso(e.expires_at) : null;
    if (e.expires_at && new Date(e.expires_at).getTime() < Date.now()) return { tier: 'Free', expiresAt, source: 'expired' };
    return { tier: e.tier, expiresAt, source: e.source };
  }

  async function issueReferralCode(c, user) {
    if (user.referralCode) return user.referralCode;
    for (let i = 0; i < 20; i++) {
      const code = newReferralCode(user.name);
      const { rowCount } = await c.query('UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE referral_code = $2)', [user.id, code]);
      if (rowCount) return code;
      const { rows } = await c.query('SELECT referral_code FROM users WHERE id = $1', [user.id]);
      if (rows[0]?.referral_code) return rows[0].referral_code;
    }
    throw new Error('referral_code_exhausted');
  }

  async function meProfile(user, c = db) {
    const fresh = (await userById(user.id, c)) || user;
    const entitlement = await entitlementFor(user.id, c);
    return { user: publicUser(fresh), entitlement, features: featuresFor(entitlement.tier), caps: capsFor(entitlement.tier), referralCode: fresh.referralCode || null, referredBy: fresh.referredBy || null, payHandle: fresh.payHandle || null };
  }

  async function updateProfile(userId, patch) {
    const user = await userById(userId);
    if (!user || user.deletedAt) return err('not_found', 404);
    let name;
    if (patch?.name !== undefined) {
      name = cleanText(patch.name, 64);
      if (!name) return err('invalid_name', 400);
    }
    let handle;
    if (patch?.payHandle !== undefined) {
      handle = normalizePayHandle(patch.payHandle);
      if (handle === null) return err('invalid_pay_handle', 400);
    }
    await db.tx(async (c) => {
      if (name !== undefined) {
        await c.query('UPDATE users SET name = $2 WHERE id = $1', [userId, name]);
        await c.query('UPDATE hive_members SET name = $2 WHERE user_id = $1', [userId, name]);
      }
      if (handle !== undefined) await c.query('UPDATE users SET pay_handle = $2 WHERE id = $1', [userId, handle || null]);
    });
    return meProfile(user);
  }

  async function applyEntitlement(input) {
    const norm = entitlementFromInput(input);
    if (norm.error) return norm;
    const { userId, tier, expiresAt, source, eventId } = norm.entitlement;
    return db.tx(async (c) => {
      const user = await userById(userId, c);
      if (!user || user.deletedAt) return err('user_not_found', 404);
      if (eventId) {
        const { rowCount } = await c.query('INSERT INTO billing_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]);
        if (!rowCount) return { ok: true, duplicate: true, ...(await meProfile(user, c)) };
      }
      await c.query(
        `INSERT INTO entitlements (user_id, tier, source, expires_at, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, source = EXCLUDED.source, expires_at = EXCLUDED.expires_at, updated_at = now()`,
        [userId, tier, source, expiresAt]
      );
      if (tier !== 'Free') await issueReferralCode(c, user);
      return { ok: true, duplicate: false, ...(await meProfile(user, c)) };
    });
  }

  const demoPurchase = (userId, tier) => applyEntitlement({ userId, tier, source: 'demo', eventId: null });

  /* ── money ────────────────────────────────────────────────── */

  async function loadBooks(tripId, c = db) {
    const id = String(tripId);
    const { rows: t } = await c.query('SELECT hive_id, owner_id FROM trips WHERE id = $1', [id]);
    const [{ rows: ex }, { rows: fu }, members, { rows: h }] = await Promise.all([
      c.query('SELECT * FROM expenses WHERE trip_id = $1 ORDER BY id', [id]),
      c.query('SELECT * FROM fund_entries WHERE trip_id = $1 ORDER BY id', [id]),
      membersOf(t[0]?.hive_id, c),
      c.query('SELECT owner_id FROM hives WHERE id = $1', [t[0]?.hive_id]),
    ]);
    const owner = t[0]?.owner_id || h[0]?.owner_id || members[0]?.member_id;
    const raw = ex.map(expenseRow);
    return { owner, hiveId: t[0]?.hive_id, memberIds: members.map((m) => m.member_id), rawExpenses: raw, expenses: raw.map((e) => ({ ...e, paidBy: e.paidBy ?? owner })), fund: fu.map(fundRow) };
  }

  async function getFund(tripId, userId) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const b = await loadBooks(tripId);
    return { fund: b.fund, expenses: b.expenses };
  }

  /** Lock the trip, load the books and the caller's member id, run `fn`. */
  async function moneyTx(tripId, userId, fn) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const id = String(tripId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
      const books = await loadBooks(id, c);
      const me = await membershipFor(books.hiveId, userId, c);
      if (!me) return err('forbidden', 403);
      const out = await fn(c, books, me.member_id);
      if (out?.error) return out;
      const after = await loadBooks(id, c);
      return { ...out, fund: after.fund, expenses: after.expenses };
    });
  }

  const validAmount = (v) => {
    const amt = Number(v);
    return Number.isFinite(amt) && amt > 0 && amt <= 1_000_000 && Math.abs(amt * 100 - Math.round(amt * 100)) < 1e-6 ? amt : null;
  };

  async function contribute(tripId, userId, amount) {
    const amt = validAmount(amount);
    if (amt == null) return err('invalid_amount', 400);
    return moneyTx(tripId, userId, async (c, books, me) => {
      if (books.fund.length >= LIMITS.MAX_FUND_ENTRIES_PER_TRIP) return err('fund_limit', 400);
      await c.query('INSERT INTO fund_entries (trip_id, member_id, kind, amount) VALUES ($1, $2, $3, $4)', [String(tripId), me, 'contribution', amt]);
      return {};
    });
  }

  async function withdraw(tripId, userId, amount) {
    const amt = validAmount(amount);
    if (amt == null) return err('invalid_amount', 400);
    return moneyTx(tripId, userId, async (c, books, me) => {
      if (books.fund.length >= LIMITS.MAX_FUND_ENTRIES_PER_TRIP) return err('fund_limit', 400);
      const limit = withdrawable(me, books.memberIds, books.rawExpenses, books.fund, books.owner);
      if (toCents(amt) > toCents(limit)) return err('exceeds_envelope', 400, { withdrawable: limit });
      await c.query('INSERT INTO fund_entries (trip_id, member_id, kind, amount) VALUES ($1, $2, $3, $4)', [String(tripId), me, 'withdrawal', amt]);
      return {};
    });
  }

  async function voidExpense(tripId, userId, expenseId) {
    return moneyTx(tripId, userId, async (c, books, me) => {
      const { rows } = await c.query('SELECT * FROM expenses WHERE trip_id = $1 AND id = $2 FOR UPDATE', [String(tripId), Number(expenseId)]);
      if (!rows.length) return err('expense_not_found', 404);
      if (rows[0].voided_at) return err('already_voided', 409);
      const upd = await c.query('UPDATE expenses SET voided_at = now(), voided_by = $3 WHERE trip_id = $1 AND id = $2 RETURNING *', [String(tripId), Number(expenseId), me]);
      return { expense: expenseRow(upd.rows[0]) };
    });
  }

  async function addExpense(tripId, userId, input) {
    return moneyTx(tripId, userId, async (c, books, me) => {
      if (books.rawExpenses.length >= LIMITS.MAX_EXPENSES_PER_TRIP) return err('expense_limit', 400);
      const norm = expenseFromInput(input, books.memberIds, me);
      if (norm.error) return norm;
      const e = norm.expense;
      if (e.paidBy === 'pot') {
        const shortfalls = potShortfalls({ id: 0, ...e }, books.memberIds, books.rawExpenses, books.fund, books.owner);
        if (shortfalls.length) return err('pot_shortfall', 400, { shortfalls });
      }
      const { rows } = await c.query(
        'INSERT INTO expenses (trip_id, label, category, amount, paid_by, split_with, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [String(tripId), e.label, e.category, e.amount, e.paidBy, JSON.stringify(e.splitWith), userId]
      );
      return { expense: expenseRow(rows[0]) };
    });
  }

  return {
    backend: 'postgres',
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
    voidExpense,
    updateProfile,
    isMember,
    requireMember,
    requireHiveMember,
    flush: async () => {},
    hydrate: () => {},
    close: () => db.close(),
  };
}
