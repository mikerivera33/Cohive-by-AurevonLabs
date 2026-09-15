/**
 * Postgres store checks — the same API surface as verify:api, driven against
 * a real database: auth (password, demo, magic link), invites, ACL, votes,
 * spots, money with true concurrency, account deletion, and durability across
 * store instances. Needs DATABASE_URL (see README "Backend").
 *
 *   DATABASE_URL=postgres://cohive:cohive@127.0.0.1:5432/cohive_test npm run verify:pg
 */
import assert from 'node:assert/strict';

import { createApi } from '../server/api.mjs';
import { createPgStore } from '../server/store-pg.mjs';
import { seed } from '../server/seed.mjs';
import { scanImport } from '../server/engine-bundle.mjs';
import { resetRateLimits } from '../server/rateLimit.mjs';
import { createDb } from '../server/db.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('verify:pg — skipped (DATABASE_URL not set)');
  process.exit(0);
}

// Fresh schema every run.
{
  const db = createDb(url);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.close();
}

let passed = 0;
async function aok(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (e) {
    console.error('  ✗ ' + label);
    throw e;
  }
}

const store = await createPgStore(seed, { url });
const api = createApi({ store, scanImport });
const call = async (method, path, body, token, extraHeaders = {}) => {
  const res = await api.handle(
    new Request('http://x' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    })
  );
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
};

console.log('\npostgres backend: ' + store.backend);
resetRateLimits();

let ada;
let bo;
await aok('register + login round-trip; session cookie is HttpOnly', async () => {
  const r = await call('POST', '/api/auth/register', { email: 'Ada@Example.com', name: 'Ada', password: 'correct horse' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'ada@example.com');
  assert.match(r.headers.get('set-cookie') || '', /cohive_session=[a-f0-9]{48}; Path=\/api;.*HttpOnly/);
  const bad = await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'wrong' });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  assert.equal(ok.status, 200);
  ada = ok.data;
  const me = await call('GET', '/api/auth/me', undefined, ada.token);
  assert.equal(me.data.user.name, 'Ada');
});

await aok('the cookie alone authenticates (no bearer)', async () => {
  const me = await call('GET', '/api/auth/me', undefined, '', { Cookie: 'cohive_session=' + ada.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, ada.user.id);
});

await aok('registered users do not auto-join the seed trip (ACL)', async () => {
  const trips = await call('GET', '/api/trips', undefined, ada.token);
  assert.deepEqual(trips.data.trips, []);
  const denied = await call('GET', '/api/trips/1', undefined, ada.token);
  assert.equal(denied.status, 403);
});

let magicTrip;
await aok('magic link: request → dev link → verify creates the account and a starter trip', async () => {
  const req = await call('POST', '/api/auth/magic', { email: 'bo@example.com', name: 'Bo' });
  assert.equal(req.status, 200);
  assert.equal(req.data.sent, false);
  const token = new URL(req.data.devLink).searchParams.get('token');
  assert.match(token, /^[a-f0-9]{48}$/);
  const bad = await call('POST', '/api/auth/magic/verify', { token: 'f'.repeat(48) });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/auth/magic/verify', { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.created, true);
  bo = ok.data;
  const again = await call('POST', '/api/auth/magic/verify', { token });
  assert.equal(again.status, 400, 'a magic link works once');
  const trips = await call('GET', '/api/trips', undefined, bo.token);
  assert.equal(trips.data.trips.length, 1);
  magicTrip = trips.data.trips[0].id;
  const full = await call('GET', '/api/trips/' + magicTrip, undefined, bo.token);
  assert.equal(full.data.me, bo.user.id);
  assert.ok(full.data.spots.length > 0, 'starter trip carries the seed spots');
});

await aok('GET verify redirects into the app without putting the session in the URL', async () => {
  const req = await call('POST', '/api/auth/magic', { email: 'bo@example.com' });
  const token = new URL(req.data.devLink).searchParams.get('token');
  const r = await call('GET', '/api/auth/magic/verify?token=' + token);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location') || '';
  assert.match(loc, /authed=1/);
  assert.match(loc, /mode=magic/);
  assert.equal(/[?&]token=/.test(loc), false);
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  assert.ok(cookies.some((c) => c.startsWith('cohive_session=')));
  assert.ok(cookies.some((c) => c.startsWith('cohive_oauth_handoff=') && !/Max-Age=0/.test(c)));
});

let inviteCode;
let placeholder;
await aok('invite: adding a member mints a single-use invite link', async () => {
  const r = await call('POST', '/api/trips/' + magicTrip + '/members', { name: 'Ada' }, bo.token);
  assert.equal(r.status, 201);
  assert.match(r.data.invite.code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.match(r.data.url, /\?invite=/);
  inviteCode = r.data.invite.code;
  placeholder = r.data.member.id;
  assert.match(placeholder, /^invite-/);
  const preview = await call('GET', '/api/invites/' + inviteCode);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.invite.inviter, 'Bo');
  assert.equal(preview.data.invite.memberName, 'Ada');
  assert.equal(preview.data.invite.expired, false);
  const missing = await call('GET', '/api/invites/ZZZZZZZZZZ');
  assert.equal(missing.status, 404);
});

await aok('accepting binds the account to the placeholder; ledger key is stable; link is spent', async () => {
  const anon = await call('POST', '/api/invites/' + inviteCode + '/accept', {});
  assert.equal(anon.status, 401);
  const r = await call('POST', '/api/invites/' + inviteCode + '/accept', {}, ada.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.joined, true);
  assert.equal(r.data.member.id, placeholder);
  const trip = await call('GET', '/api/trips/' + magicTrip, undefined, ada.token);
  assert.equal(trip.status, 200);
  assert.equal(trip.data.me, placeholder, 'Ada acts as the placeholder member');
  const twice = await call('POST', '/api/invites/' + inviteCode + '/accept', {}, ada.token);
  assert.equal(twice.data.joined, false, 'already a member');
  const third = await store.demoAuth({ provider: 'email', name: 'Cy' });
  const spent = await call('POST', '/api/invites/' + inviteCode + '/accept', {}, third.token);
  assert.equal(spent.status, 410);
});

await aok('open invite links admit new members up to max uses', async () => {
  const r = await call('POST', '/api/trips/' + magicTrip + '/invites', { maxUses: 1 }, bo.token);
  assert.equal(r.status, 201);
  const cy = await store.demoAuth({ provider: 'email', name: 'Cy' });
  const ok = await call('POST', '/api/invites/' + r.data.invite.code + '/accept', {}, cy.token);
  assert.equal(ok.data.joined, true);
  assert.equal(ok.data.member.id, cy.user.id);
  const dee = await store.demoAuth({ provider: 'email', name: 'Dee' });
  const full = await call('POST', '/api/invites/' + r.data.invite.code + '/accept', {}, dee.token);
  assert.equal(full.status, 410);
});

await aok('votes, spots and scan work on the Postgres store', async () => {
  const v = await call('POST', '/api/trips/' + magicTrip + '/votes', { spotId: 1, tier: 'must' }, bo.token);
  assert.equal(v.status, 200);
  assert.equal(v.data.spot.tier, 'must');
  const s = await call('POST', '/api/trips/' + magicTrip + '/spots', { candidate: { name: '<b>Ramen</b> alley', lat: 999, lng: -999, category: 'food' }, source: 'test' }, ada.token);
  assert.equal(s.status, 201);
  assert.equal(s.data.spot.name, 'Ramen alley');
  assert.ok(Math.abs(s.data.spot.lat) <= 90 && Math.abs(s.data.spot.lng) <= 180);
  assert.ok(s.data.spot.id >= 500);
  const scan = await call('POST', '/api/trips/' + magicTrip + '/scan', { text: 'teamLab Planets tonight' }, bo.token);
  assert.equal(scan.status, 200);
  assert.ok(scan.data.candidates.length >= 1);
});

await aok('money: envelope rule holds and the pot refuses uncovered bills', async () => {
  const c = await call('POST', '/api/trips/' + magicTrip + '/fund/contributions', { amount: 100 }, ada.token);
  assert.equal(c.status, 201);
  assert.equal(c.data.fund[0].memberId, placeholder, 'credited to the member key, not the user id');
  const steal = await call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 1 }, bo.token);
  assert.equal(steal.data.error, 'exceeds_envelope');
  const short = await call('POST', '/api/trips/' + magicTrip + '/expenses', { label: 'Dinner', amount: 60, paidBy: 'pot' }, ada.token);
  assert.equal(short.data.error, 'pot_shortfall');
  const ok = await call('POST', '/api/trips/' + magicTrip + '/expenses', { label: 'Taxi', amount: 60, paidBy: 'pot', splitWith: [placeholder] }, ada.token);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.expense.paidBy, 'pot');
});

await aok('two simultaneous withdrawals cannot both pass the envelope check', async () => {
  // Ada has $40 left. Two $40 withdrawals race; exactly one may succeed.
  const results = await Promise.all([
    call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 40 }, ada.token),
    call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 40 }, ada.token),
  ]);
  const wins = results.filter((r) => r.status === 201).length;
  assert.equal(wins, 1, 'exactly one withdrawal wins the row lock');
  const books = await call('GET', '/api/trips/' + magicTrip + '/fund', undefined, ada.token);
  assert.equal(books.data.fund.filter((f) => f.kind === 'withdrawal').length, 1);
  const empty = await call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 0.01 }, ada.token);
  assert.equal(empty.data.error, 'exceeds_envelope');
  assert.equal(empty.data.withdrawable, 0, 'envelope is empty after the winning withdrawal');
});

await aok('voiding a pot-paid bill restores the envelope; double void is refused', async () => {
  const books = await call('GET', '/api/trips/' + magicTrip + '/fund', undefined, ada.token);
  const taxi = books.data.expenses.find((e) => e.label === 'Taxi');
  const stranger = await store.demoAuth({ provider: 'email', name: 'Zed' });
  const denied = await call('POST', `/api/trips/${magicTrip}/expenses/${taxi.id}/void`, {}, stranger.token);
  assert.equal(denied.status, 403);
  const r = await call('POST', `/api/trips/${magicTrip}/expenses/${taxi.id}/void`, {}, ada.token);
  assert.equal(r.status, 200);
  assert.ok(r.data.expense.voidedAt);
  assert.equal(r.data.expense.voidedBy, placeholder);
  const again = await call('POST', `/api/trips/${magicTrip}/expenses/${taxi.id}/void`, {}, ada.token);
  assert.equal(again.status, 409);
  const back = await call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 60 }, ada.token);
  assert.equal(back.status, 201, 'the $60 pot share is Ada\'s again');
  const empty = await call('POST', '/api/trips/' + magicTrip + '/fund/withdrawals', { amount: 0.01 }, ada.token);
  assert.equal(empty.data.error, 'exceeds_envelope');
});

await aok('payout handle persists on users and surfaces on hive members', async () => {
  const bad = await call('POST', '/api/auth/me/profile', { payHandle: 'zelle:ada' }, ada.token);
  assert.equal(bad.data.error, 'invalid_pay_handle');
  const r = await call('POST', '/api/auth/me/profile', { payHandle: 'cashapp:$ada' }, ada.token);
  assert.equal(r.status, 200);
  assert.equal(r.data.payHandle, 'cashapp:$ada');
  const trip = await call('GET', '/api/trips/' + magicTrip, undefined, bo.token);
  assert.equal(trip.data.members.find((m) => m.id === placeholder).payHandle, 'cashapp:$ada');
});

await aok('live updates: version stamped on reads, bumped by writes, durable on Postgres', async () => {
  const trip = await call('GET', '/api/trips/' + magicTrip, undefined, bo.token);
  const { hiveId, version } = trip.data.sync;
  const v0 = await call('GET', `/api/hives/${hiveId}/version`, undefined, bo.token);
  assert.equal(v0.data.version, version);
  const stranger = await store.demoAuth({ provider: 'email', name: 'Nosy' });
  const denied = await call('GET', `/api/hives/${hiveId}/version`, undefined, stranger.token);
  assert.equal(denied.status, 403);
  const w = await call('POST', '/api/trips/' + magicTrip + '/votes', { spotId: 1, tier: 'maybe' }, bo.token);
  assert.equal(w.data.sync.version, version + 1);
  const back = await call('POST', '/api/trips/' + magicTrip + '/votes', { spotId: 1, tier: 'must' }, bo.token);
  assert.equal(back.data.sync.version, version + 2);
  const again = await createPgStore(seed, { url });
  assert.equal((await again.peekHiveVersion(hiveId)).version, version + 2);
});

await aok('trip limit and createTrip enforce membership counts', async () => {
  for (let i = 0; i < 2; i++) {
    const r = await call('POST', '/api/trips', { name: 'Trip ' + i, lat: 1, lng: 1 }, bo.token);
    assert.equal(r.status, 201);
  }
  const over = await call('POST', '/api/trips', { name: 'one too many' }, bo.token);
  assert.equal(over.status, 402);
});

await aok('account deletion revokes sessions and anonymises, ledger stays balanced', async () => {
  const del = await call('DELETE', '/api/auth/me', undefined, ada.token);
  assert.equal(del.status, 200);
  const gone = await call('GET', '/api/auth/me', undefined, ada.token);
  assert.equal(gone.status, 401);
  const trip = await call('GET', '/api/trips/' + magicTrip, undefined, bo.token);
  const ghost = trip.data.members.find((m) => m.id === placeholder);
  assert.equal(ghost.name, 'Deleted member');
  assert.ok(trip.data.fund.every((f) => f.memberId !== undefined));
  const login = await call('POST', '/api/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  assert.equal(login.status, 401);
});

await aok('hives: list, create, per-hive trip cap, Nest + Table CRUD on Postgres', async () => {
  const hives = await call('GET', '/api/hives', undefined, bo.token);
  assert.equal(hives.data.hives.length, 1);
  const hiveId = hives.data.hives[0].id;
  assert.equal(hives.data.hives[0].trips[0].id, magicTrip);
  const full = await call('GET', '/api/hives/' + hiveId, undefined, bo.token);
  assert.equal(full.data.me, bo.user.id);
  assert.equal(full.data.nest.length, 0, 'a real account starts with an empty Nest');
  const add = await call('POST', '/api/hives/' + hiveId + '/nest', { title: 'Bushwick 1BR', price: 2600, hood: 'Bushwick', lat: 40.69, lng: -73.92 }, bo.token);
  assert.equal(add.status, 201);
  const on = await call('POST', '/api/hives/' + hiveId + '/nest/' + add.data.listing.id + '/react', { emoji: '🪴' }, bo.token);
  assert.deepEqual(on.data.listing.reactions['🪴'], [bo.user.id]);
  const dish = await call('POST', '/api/hives/' + hiveId + '/table', { name: 'Kru', cuisine: 'Thai', hood: 'Greenpoint' }, bo.token);
  assert.equal(dish.status, 201);
  const upd = await call('POST', '/api/hives/' + hiveId + '/table/' + dish.data.restaurant.id, { tried: true, tier: 'must' }, bo.token);
  assert.equal(upd.data.restaurant.tried, true);
  const again = await call('GET', '/api/hives/' + hiveId, undefined, bo.token);
  assert.equal(again.data.nest.length, 1);
  assert.equal(again.data.table[0].tier, 'must');
  const over = await call('POST', '/api/hives/' + hiveId + '/trips', { name: 'one too many' }, bo.token);
  assert.equal(over.status, 402, 'three trips already exist in this hive');
  const made = await call('POST', '/api/hives', { name: 'Ski crew' }, bo.token);
  assert.equal(made.status, 201);
  assert.equal((await call('POST', '/api/hives/' + made.data.hive.id + '/trips', { name: 'Niseko' }, bo.token)).status, 201);
  const cy = await store.demoAuth({ provider: 'email', name: 'Cy' });
  assert.equal((await call('GET', '/api/hives/' + made.data.hive.id, undefined, cy.token)).status, 403);
});

await aok('entitlements on Postgres: signed webhook, idempotency, caps, referral attribution', async () => {
  const { createHmac } = await import('node:crypto');
  process.env.COHIVE_BILLING_SECRET = 'pg-secret';
  const signed = (body) => ({ 'X-Cohive-Signature': createHmac('sha256', 'pg-secret').update(JSON.stringify(body)).digest('hex') });
  const evt = { userId: bo.user.id, tier: 'Platinum', source: 'revenuecat', eventId: 'rc_1' };
  assert.equal((await call('POST', '/api/billing/webhook', evt)).status, 401);
  const ok = await call('POST', '/api/billing/webhook', evt, undefined, signed(evt));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.entitlement.tier, 'Platinum');
  assert.match(ok.data.referralCode, /^BO-[A-Z0-9]{4}10$/);
  const dup = await call('POST', '/api/billing/webhook', evt, undefined, signed(evt));
  assert.equal(dup.data.duplicate, true);
  const me = await call('GET', '/api/auth/me', undefined, bo.token);
  assert.deepEqual(me.data.caps, { hives: 20, tripsPerHive: 20 });
  const hives = await call('GET', '/api/hives', undefined, bo.token);
  const extra = await call('POST', '/api/hives/' + hives.data.hives[0].id + '/trips', { name: 'now allowed' }, bo.token);
  assert.equal(extra.status, 201, 'paid tier lifts the per-hive trip cap');
  const ref = await call('POST', '/api/auth/register', { email: 'ref@example.com', name: 'Ref', password: 'hunter2hunter2', ref: me.data.referralCode });
  assert.equal((await call('GET', '/api/auth/me', undefined, ref.data.token)).data.referredBy, bo.user.id);
  delete process.env.COHIVE_BILLING_SECRET;
});

await aok('a second store instance on the same database sees everything (durability)', async () => {
  const s2 = await createPgStore(seed, { url });
  const user = await s2.getSessionUser(bo.token);
  assert.equal(user.name, 'Bo');
  const t = await s2.getTrip(magicTrip, bo.user.id);
  assert.ok(!t.error);
  assert.equal(t.spots.find((x) => x.id === 1).tier, 'must');
  assert.ok(t.fund.length >= 2);
  await s2.close();
});

await store.close();
console.log(`\nverify:pg — ${passed} checks passed`);
