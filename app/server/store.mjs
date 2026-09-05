/**
 * In-memory Cohive data store with seed bootstrap.
 * Membership is the ACL source of truth — never trust the client for that.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const FREE_TRIP_LIMIT = 3;

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
 * @param {object} seed — optional seed fixtures { trip, tripSpots, members }
 */
export function createStore(seed = null) {
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
      ownerId: null, // filled when first member joins
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

  function publicUser(u) {
    return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
  }

  function createSession(userId) {
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  function getSessionUser(token) {
    if (!token) return null;
    const sess = sessions.get(token);
    if (!sess) return null;
    if (sess.expiresAt < Date.now()) {
      sessions.delete(token);
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
    if (pw.length < 8) return { error: 'weak_password', status: 400 };
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
    // Index by id too for lookups
    users.set(user.id, user);
    const token = createSession(user.id);
    ensureDemoMembership(user);
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
    ensureDemoMembership(user);
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
    return { user: publicUser(user), token };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  function ensureDemoMembership(user) {
    // Attach new users only to the seeded demo trip — never auto-join
    // user-created trips (those require an explicit invite).
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
      // Clearing the same tier removes the vote; switching tiers updates it.
      if (prev.tier === tier || tier === null) {
        votesByTrip.set(
          String(tripId),
          votes.filter((v) => !(v.userId === userId && v.spotId === spot.id))
        );
        spot.tier = null;
        spot.votes = Math.max(0, (spot.votes || 0) - 1);
        return { spot: { ...spot } };
      }
      prev.tier = tier;
      prev.at = new Date().toISOString();
      spot.tier = tier;
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
    return { spot: { ...spot } };
  }

  function addMember(tripId, userId, name) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    const display = String(name || '').trim().slice(0, 64);
    if (!display) return { error: 'invalid_name', status: 400 };
    const members = memberships.get(String(tripId)) || [];
    // Invited people are placeholder members until they claim an account.
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
    return {
      member: { id: member.userId, name: member.name, color: member.color, role: member.role },
    };
  }

  function addSpot(tripId, userId, candidate, source) {
    const denied = requireMember(tripId, userId);
    if (denied) return denied;
    if (!candidate || typeof candidate.name !== 'string') {
      return { error: 'invalid_candidate', status: 400 };
    }
    const spot = {
      id: nextSpotId++,
      name: String(candidate.name).slice(0, 120),
      category: candidate.category || 'sight',
      lat: Number(candidate.lat) || 0,
      lng: Number(candidate.lng) || 0,
      duration: Number(candidate.duration) || 60,
      cost: Number(candidate.cost) || 0,
      rating: 4,
      open: candidate.open ?? null,
      close: candidate.close ?? null,
      source: String(source || 'import').slice(0, 80),
      tier: null,
      votes: 0,
      note: candidate.matched === 'exact' ? '' : 'Confirmed from scan',
    };
    const spots = spotsByTrip.get(String(tripId)) || [];
    spots.push(spot);
    spotsByTrip.set(String(tripId), spots);
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
      days: Math.max(1, Math.min(14, Number(body?.days) || 3)),
      pace: body?.pace || 'balanced',
      startHour: Number(body?.startHour) || 9,
      endHour: Number(body?.endHour) || 21,
      budget: Number(body?.budget) || 0,
      currency: String(body?.currency || 'USD').slice(0, 8),
      lat: Number(body?.lat) || 0,
      lng: Number(body?.lng) || 0,
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
    FREE_TRIP_LIMIT,
    /** @internal test helpers */
    _trips: trips,
    _memberships: memberships,
    _spotsByTrip: spotsByTrip,
  };
}
