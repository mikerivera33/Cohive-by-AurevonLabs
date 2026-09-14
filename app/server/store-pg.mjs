/**
 * Postgres-backed Cohive store — same interface as store.mjs, every method
 * async. Money operations run in one transaction with the trip row locked,
 * so two members acting at once cannot both pass the envelope check.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { createDb } from './db.mjs';
import { potShortfalls, toCents, withdrawable } from './engine-bundle.mjs';
import {
  INVITE_CODE_RE,
  LIMITS,
  MEMBER_COLORS,
  OWNER_COLOR,
  TOKEN_RE,
  cleanText,
  expenseFromInput,
  inviteExhausted,
  newId,
  newInviteCode,
  newToken,
  normalizeEmail,
  publicInvite,
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
const memberRow = (m) => ({ id: m.member_id, name: m.name, color: m.color, role: m.role });
const expenseRow = (e) => ({
  id: Number(e.id),
  label: e.label,
  category: e.category,
  amount: Number(e.amount),
  paidBy: e.paid_by ?? undefined,
  splitWith: Array.isArray(e.split_with) ? e.split_with : undefined,
});
const fundRow = (f) => ({ id: Number(f.id), memberId: f.member_id, kind: f.kind, amount: Number(f.amount), at: iso(f.at) });
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
    const tripId = String(s.trip.id ?? 1);
    const { rowCount } = await db.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    if (rowCount) return;
    await db.tx(async (c) => {
      const t = s.trip;
      await c.query(
        `INSERT INTO trips (id, owner_id, name, city, country, start_date, days, pace, start_hour, end_hour, budget, currency, lat, lng)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [tripId, t.name, t.city, t.country || '', t.startDate, t.days, t.pace, t.startHour, t.endHour, t.budget, t.currency, t.lat, t.lng]
      );
      for (const sp of s.tripSpots || []) {
        await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [tripId, sp.id, JSON.stringify(sp)]);
      }
      for (const e of t.expenses || []) {
        await c.query(
          'INSERT INTO expenses (trip_id, label, category, amount, paid_by, split_with) VALUES ($1, $2, $3, $4, NULL, NULL)',
          [tripId, e.label, e.category, e.amount]
        );
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
      `INSERT INTO users (id, email, name, salt, hash, provider, contact, oauth_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [u.id, u.email, u.name, u.salt ?? null, u.hash ?? null, u.provider ?? null, u.contact ?? null, Boolean(u.oauthVerified)]
    );
    return { ...u, createdAt: new Date().toISOString() };
  }
  async function createSession(userId, c = db) {
    const token = newToken();
    await c.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
      token,
      userId,
      new Date(Date.now() + LIMITS.SESSION_TTL_MS),
    ]);
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

  async function register({ email, name, password }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    const pw = String(password || '');
    if (pw.length < 8 || pw.length > 200) return err('weak_password', 400);
    if (await userByEmail(norm)) return err('email_taken', 409);
    const display = cleanText(name || norm.split('@')[0], 64) || 'You';
    const user = await insertUser(db, { id: newId(), email: norm, name: display, ...hashPassword(pw) });
    return { user: publicUser(user), token: await createSession(user.id) };
  }

  async function login({ email, password }) {
    const user = await userByEmail(normalizeEmail(email));
    if (!user || user.deletedAt || !verifyPassword(String(password || ''), user.salt, user.hash)) {
      return err('invalid_credentials', 401);
    }
    return { user: publicUser(user), token: await createSession(user.id) };
  }

  async function demoAuth({ provider, name, contact }) {
    const p = String(provider || 'email');
    if (!['apple', 'google', 'email', 'phone'].includes(p)) return err('invalid_provider', 400);
    const display = cleanText(name || 'You', 64) || 'You';
    const rawContact = cleanText(contact, 120);
    let email;
    if (p === 'email' && rawContact.includes('@')) email = rawContact.toLowerCase();
    else if (p === 'phone' && rawContact) email = `phone-${rawContact.replace(/[^\d+]/g, '').slice(0, 20) || newId().slice(0, 8)}@cohive.local`;
    else email = `demo-${p}-${newId().slice(0, 8)}@cohive.local`;
    let user = await userByEmail(email);
    if (!user) {
      user = await insertUser(db, { id: newId(), email, name: display, ...hashPassword(newToken()), provider: p, contact: rawContact || null });
    }
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
      await db.query('UPDATE users SET provider = $2, oauth_verified = $3, name = CASE WHEN $4 <> \'You\' THEN $4 ELSE name END WHERE id = $1', [
        user.id,
        p,
        Boolean(verified),
        display,
      ]);
    }
    await ensureDemoMembership(user);
    return { user: publicUser(user), token: await createSession(user.id), mode: verified ? 'oauth' : 'oauth_provisional' };
  }

  /** Demo sign-ins join the shared seed trip, as in the in-memory store. */
  async function ensureDemoMembership(user) {
    const tripId = String(seed?.trip?.id ?? '1');
    await db.tx(async (c) => {
      const t = await c.query('SELECT owner_id FROM trips WHERE id = $1 FOR UPDATE', [tripId]);
      if (!t.rowCount) return;
      const m = await c.query('SELECT 1 FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, user.id]);
      if (m.rowCount) return;
      const count = await c.query('SELECT count(*)::int AS n FROM trip_members WHERE trip_id = $1', [tripId]);
      const first = count.rows[0].n === 0;
      if (first) await c.query('UPDATE trips SET owner_id = $2 WHERE id = $1 AND owner_id IS NULL', [tripId, user.id]);
      await c.query(
        'INSERT INTO trip_members (trip_id, member_id, user_id, name, color, role) VALUES ($1, $2, $2, $3, $4, $5)',
        [tripId, user.id, user.name, OWNER_COLOR, first ? 'owner' : 'member']
      );
    });
  }

  /* ── magic links ──────────────────────────────────────────── */

  async function requestMagicLink({ email, name }) {
    const norm = normalizeEmail(email);
    if (!norm) return err('invalid_email', 400);
    const token = newToken();
    await db.query('DELETE FROM magic_links WHERE expires_at < now() - interval \'1 day\'');
    await db.query('INSERT INTO magic_links (token_hash, email, name, expires_at) VALUES ($1, $2, $3, $4)', [
      sha256(token),
      norm,
      cleanText(name, 64) || null,
      new Date(Date.now() + LIMITS.MAGIC_TTL_MS),
    ]);
    return { token, email: norm };
  }

  async function consumeMagicLink(token) {
    if (!token || !TOKEN_RE.test(token)) return err('invalid_token', 400);
    return db.tx(async (c) => {
      const { rows } = await c.query(
        'UPDATE magic_links SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, name',
        [sha256(token)]
      );
      if (!rows.length) return err('invalid_token', 400);
      const { email, name } = rows[0];
      let user = await userByEmail(email, c);
      let created = false;
      if (!user) {
        user = await insertUser(c, { id: newId(), email, name: name || email.split('@')[0], provider: 'email', oauthVerified: true });
        created = true;
      } else if (user.deletedAt) {
        return err('account_deleted', 410);
      } else {
        await c.query('UPDATE users SET oauth_verified = true WHERE id = $1', [user.id]);
      }
      if (created) await starterTrip(c, user);
      return { user: publicUser(user), token: await createSession(user.id, c), mode: 'magic', created };
    });
  }

  /** A real account starts with its own copy of the seed trip, not the shared demo one. */
  async function starterTrip(c, user) {
    const s = seed?.trip;
    const t = tripFromBody(
      s ? { ...s, name: 'My first trip' } : { name: 'My first trip' },
      user.id,
      newId()
    );
    await insertTrip(c, t, user);
    for (const sp of seed?.tripSpots || []) {
      await c.query('INSERT INTO spots (trip_id, id, data) VALUES ($1, $2, $3)', [t.id, sp.id, JSON.stringify({ ...sp, tier: null, votes: 0 })]);
    }
    return t;
  }

  async function insertTrip(c, t, user) {
    await c.query(
      `INSERT INTO trips (id, owner_id, name, city, country, start_date, days, pace, start_hour, end_hour, budget, currency, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [t.id, user.id, t.name, t.city, t.country, t.startDate, t.days, t.pace, t.startHour, t.endHour, t.budget, t.currency, t.lat, t.lng]
    );
    await c.query(
      'INSERT INTO trip_members (trip_id, member_id, user_id, name, color, role) VALUES ($1, $2, $2, $3, $4, $5)',
      [t.id, user.id, user.name || 'You', OWNER_COLOR, 'owner']
    );
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
      // Ledger keys stay; the person loses access and their name.
      await c.query("UPDATE trip_members SET user_id = NULL, name = 'Deleted member' WHERE user_id = $1", [userId]);
      return { ok: true };
    });
  }

  /* ── membership ───────────────────────────────────────────── */

  async function membersOf(tripId, c = db) {
    const { rows } = await c.query('SELECT * FROM trip_members WHERE trip_id = $1 ORDER BY joined_at, member_id', [String(tripId)]);
    return rows;
  }
  async function membershipFor(tripId, userId, c = db) {
    const { rows } = await c.query('SELECT * FROM trip_members WHERE trip_id = $1 AND user_id = $2', [String(tripId), userId]);
    return rows[0] || null;
  }
  async function isMember(tripId, userId) {
    return Boolean(await membershipFor(tripId, userId));
  }
  async function requireMember(tripId, userId, c = db) {
    const t = await c.query('SELECT 1 FROM trips WHERE id = $1', [String(tripId)]);
    if (!t.rowCount) return err('trip_not_found', 404);
    const m = await membershipFor(tripId, userId, c);
    if (!m) return err('forbidden', 403);
    return null;
  }

  async function listTripsForUser(userId) {
    const { rows } = await db.query(
      `SELECT t.* FROM trips t JOIN trip_members m ON m.trip_id = t.id
       WHERE m.user_id = $1 ORDER BY t.created_at`,
      [userId]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, country: r.country, startDate: r.start_date, days: r.days }));
  }

  async function getTrip(tripId, userId) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const id = String(tripId);
    const [{ rows: t }, { rows: spots }, members, books] = await Promise.all([
      db.query('SELECT * FROM trips WHERE id = $1', [id]),
      db.query('SELECT data FROM spots WHERE trip_id = $1 ORDER BY id', [id]),
      membersOf(id),
      loadBooks(id),
    ]);
    const me = members.find((m) => m.user_id === userId);
    return {
      trip: { ...tripRow(t[0]), expenses: books.expenses },
      spots: spots.map((s) => s.data),
      members: members.map(memberRow),
      fund: books.fund,
      me: me ? me.member_id : null,
    };
  }

  async function createTrip(userId, body) {
    const user = await userById(userId);
    if (!user) return err('unauthorized', 401);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM trip_members WHERE user_id = $1', [userId]);
    if (rows[0].n >= LIMITS.FREE_TRIP_LIMIT) return err('trip_limit', 402);
    const t = tripFromBody(body, userId, newId());
    await db.tx((c) => insertTrip(c, t, user));
    return { trip: { ...t } };
  }

  async function castVote(tripId, userId, spotId, tier) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    if (!(tier === 'must' || tier === 'maybe' || tier === 'iftime' || tier === null)) return err('invalid_tier', 400);
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

  async function addMember(tripId, userId, name) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const display = cleanText(name, 64);
    if (!display) return err('invalid_name', 400);
    const id = String(tripId);
    return db.tx(async (c) => {
      await c.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
      const members = await membersOf(id, c);
      if (members.length >= LIMITS.MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
      const memberId = 'invite-' + newId();
      const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
      await c.query(
        'INSERT INTO trip_members (trip_id, member_id, user_id, name, color, role) VALUES ($1, $2, NULL, $3, $4, $5)',
        [id, memberId, display, color, 'member']
      );
      const invite = await insertInvite(c, id, userId, { memberId, maxUses: 1 });
      return { member: { id: memberId, name: display, color, role: 'member' }, invite: publicInvite(invite) };
    });
  }

  /* ── invites ──────────────────────────────────────────────── */

  async function insertInvite(c, tripId, createdBy, { memberId = null, maxUses = 1 }) {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM invites WHERE trip_id = $1', [tripId]);
    if (rows[0].n >= LIMITS.MAX_INVITES_PER_TRIP) throw Object.assign(new Error('invite_limit'), { code: 'invite_limit' });
    const invite = {
      code: newInviteCode(),
      tripId,
      memberId,
      createdBy,
      expiresAt: new Date(Date.now() + LIMITS.INVITE_TTL_MS),
      maxUses: memberId ? 1 : Math.max(1, Math.min(50, Math.floor(Number(maxUses)) || 1)),
      uses: 0,
    };
    await c.query(
      'INSERT INTO invites (code, trip_id, member_id, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6)',
      [invite.code, tripId, memberId, createdBy, invite.expiresAt, invite.maxUses]
    );
    return invite;
  }

  async function createInvite(tripId, userId, opts = {}) {
    const denied = await requireMember(tripId, userId);
    if (denied) return denied;
    const id = String(tripId);
    const memberId = opts.memberId ? String(opts.memberId) : null;
    try {
      return await db.tx(async (c) => {
        await c.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [id]);
        if (memberId) {
          const { rows } = await c.query('SELECT user_id FROM trip_members WHERE trip_id = $1 AND member_id = $2', [id, memberId]);
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
      `SELECT i.*, t.name AS trip_name, t.city, t.country, u.name AS inviter, m.name AS member_name
       FROM invites i JOIN trips t ON t.id = i.trip_id
       LEFT JOIN users u ON u.id = i.created_by
       LEFT JOIN trip_members m ON m.trip_id = i.trip_id AND m.member_id = i.member_id
       WHERE i.code = $1`,
      [code]
    );
    if (!rows.length) return err('invite_not_found', 404);
    const i = rows[0];
    return {
      invite: {
        code: i.code,
        expired: inviteExhausted({ expiresAt: i.expires_at, uses: i.uses, maxUses: i.max_uses }),
        trip: { id: i.trip_id, name: i.trip_name, city: i.city, country: i.country },
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
      await c.query('SELECT 1 FROM trips WHERE id = $1 FOR UPDATE', [i.trip_id]);
      const { rows: t } = await c.query('SELECT * FROM trips WHERE id = $1', [i.trip_id]);
      const existing = await membershipFor(i.trip_id, userId, c);
      if (existing) return { trip: tripRow(t[0]), member: memberRow(existing), joined: false };
      if (inviteExhausted({ expiresAt: i.expires_at, uses: i.uses, maxUses: i.max_uses })) return err('invite_expired', 410);
      const members = await membersOf(i.trip_id, c);
      let member;
      if (i.member_id) {
        const slot = members.find((m) => m.member_id === i.member_id);
        if (!slot) return err('member_not_found', 404);
        if (slot.user_id) return err('invite_used', 409);
        const name = user.name && user.name !== 'You' ? user.name : slot.name;
        await c.query('UPDATE trip_members SET user_id = $3, name = $4 WHERE trip_id = $1 AND member_id = $2', [i.trip_id, i.member_id, userId, name]);
        member = { ...slot, user_id: userId, name };
      } else {
        if (members.length >= LIMITS.MAX_MEMBERS_PER_TRIP) return err('member_limit', 400);
        member = { member_id: userId, user_id: userId, name: user.name || 'You', color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], role: 'member' };
        await c.query(
          'INSERT INTO trip_members (trip_id, member_id, user_id, name, color, role) VALUES ($1, $2, $3, $4, $5, $6)',
          [i.trip_id, member.member_id, userId, member.name, member.color, member.role]
        );
      }
      await c.query('UPDATE invites SET uses = uses + 1 WHERE code = $1', [code]);
      return { trip: tripRow(t[0]), member: memberRow(member), joined: true };
    });
  }

  /* ── money ────────────────────────────────────────────────── */

  async function loadBooks(tripId, c = db) {
    const id = String(tripId);
    const [{ rows: t }, { rows: ex }, { rows: fu }] = await Promise.all([
      c.query('SELECT owner_id FROM trips WHERE id = $1', [id]),
      c.query('SELECT * FROM expenses WHERE trip_id = $1 ORDER BY id', [id]),
      c.query('SELECT * FROM fund_entries WHERE trip_id = $1 ORDER BY id', [id]),
    ]);
    const members = await membersOf(id, c);
    const owner = t[0]?.owner_id || members[0]?.member_id;
    const raw = ex.map(expenseRow);
    return {
      owner,
      memberIds: members.map((m) => m.member_id),
      rawExpenses: raw,
      expenses: raw.map((e) => ({ ...e, paidBy: e.paidBy ?? owner })),
      fund: fu.map(fundRow),
    };
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
      const me = await membershipFor(id, userId, c);
      if (!me) return err('forbidden', 403);
      const books = await loadBooks(id, c);
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
    listTripsForUser,
    getTrip,
    castVote,
    addMember,
    addSpot,
    createTrip,
    createInvite,
    getInvite,
    acceptInvite,
    getFund,
    contribute,
    withdraw,
    addExpense,
    isMember,
    requireMember,
    flush: async () => {},
    hydrate: () => {},
    close: () => db.close(),
  };
}
