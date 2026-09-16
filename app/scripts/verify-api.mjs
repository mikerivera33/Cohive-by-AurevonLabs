/**
 * API property checks — auth, ACL (trips/members/votes), ingest sanitization,
 * and scan rate limiting. Run via `npm run verify:api`.
 */
import assert from 'node:assert/strict';

import { createApi } from '../server/api.mjs';
import { appleProfileFromIdToken } from '../server/oauth.mjs';
import { createStore } from '../server/store.mjs';
import { seed } from '../server/seed.mjs';
import { sanitizeImportText } from '../server/sanitize.mjs';
import { resetRateLimits } from '../server/rateLimit.mjs';
import { scanImport } from '../server/engine-bundle.mjs';

let passed = 0;
function ok(label, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (e) {
    console.error('  ✗ ' + label);
    throw e;
  }
}

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

console.log('\nsanitize on ingest');
ok('strips HTML tags', () => {
  assert.equal(sanitizeImportText('<script>alert(1)</script>Tokyo sushi'), 'alert(1) Tokyo sushi');
});
ok('neutralizes javascript: schemes', () => {
  const out = sanitizeImportText('click javascript:alert(1) for sushi');
  assert.ok(!/javascript\s*:/i.test(out));
  assert.ok(out.includes('sushi'));
});
ok('caps length', () => {
  assert.equal(sanitizeImportText('x'.repeat(20_000)).length, 8_000);
});
ok('scanImport never sees raw markup', () => {
  const r = scanImport('<b onclick=x>teamLab Planets</b>', {
    city: 'Tokyo',
    lat: 35.67,
    lng: 139.75,
  });
  assert.ok(r.candidates.length >= 1);
  assert.ok(r.candidates.some((c) => /teamLab/i.test(c.name)));
});

console.log('\nauth + ACL');
resetRateLimits();
const store = createStore(seed);
const api = createApi({ store, scanImport });

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await api.handle(
    new Request('http://test' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

await aok('register creates a session', async () => {
  const { status, data } = await req('POST', '/api/auth/register', {
    email: 'maya@cohive.test',
    name: 'Maya',
    password: 'password1',
  });
  assert.equal(status, 201);
  assert.ok(data.token);
  assert.equal(data.user.name, 'Maya');
});

let tokenA;
let tokenB;
let tripId;

await aok('demo auth + trip membership', async () => {
  const a = await req('POST', '/api/auth/demo', { provider: 'apple', name: 'Alex' });
  assert.equal(a.status, 201);
  tokenA = a.data.token;
  const trips = await req('GET', '/api/trips', undefined, tokenA);
  assert.equal(trips.status, 200);
  assert.ok(trips.data.trips.length >= 1);
  tripId = trips.data.trips[0].id;
});

await aok('auth providers advertise demo mode without OAuth keys', async () => {
  const res = await req('GET', '/api/auth/providers');
  assert.equal(res.status, 200);
  assert.equal(res.data.mode, 'demo');
  assert.equal(res.data.google, false);
  assert.equal(res.data.apple, false);
});

await aok('demo auth accepts phone contact', async () => {
  const res = await req('POST', '/api/auth/demo', {
    provider: 'phone',
    name: 'Pat',
    contact: '+1 555 010 9988',
  });
  assert.equal(res.status, 201);
  assert.ok(res.data.token);
  assert.equal(res.data.mode, 'demo');
});

await aok('oauth start without keys returns demo hint', async () => {
  const res = await req('GET', '/api/auth/oauth/google');
  assert.equal(res.status, 501);
  assert.equal(res.data.demo, true);
});

{
  const clientId = 'com.cohive.app';
  const jwtFor = (payload) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'none' })}.${enc(payload)}.sig`;
  };
  const base = {
    iss: 'https://appleid.apple.com',
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: '001234.abcDEF.0',
  };

  await aok('Apple id_token email is the account key (not Date.now())', async () => {
    const a = appleProfileFromIdToken(
      jwtFor({ ...base, email: 'maya@icloud.com', email_verified: 'true' }),
      clientId
    );
    const b = appleProfileFromIdToken(
      jwtFor({ ...base, email: 'maya@icloud.com', email_verified: true }),
      clientId
    );
    assert.equal(a.email, 'maya@icloud.com');
    assert.equal(b.email, 'maya@icloud.com');
    assert.equal(a.verified, true);
    const first = store.oauthUpsert(a);
    const again = store.oauthUpsert(b);
    assert.equal(again.user.id, first.user.id, 'second Sign in with Apple must reopen the same account');
  });

  await aok('Apple Sign In without email stays stable across logins via sub', async () => {
    const a = appleProfileFromIdToken(jwtFor(base), clientId);
    const b = appleProfileFromIdToken(jwtFor({ ...base, exp: base.exp + 10 }), clientId);
    assert.equal(a.email, b.email);
    assert.match(a.email, /^apple-001234\.abcDEF\.0@cohive\.local$/);
    const first = store.oauthUpsert(a);
    const again = store.oauthUpsert(b);
    assert.equal(again.user.id, first.user.id);
  });

  await aok('Apple id_token with the wrong audience or unverified email is rejected', async () => {
    assert.equal(appleProfileFromIdToken(jwtFor({ ...base, email: 'x@y.z', email_verified: true, aud: 'other.app' }), clientId), null);
    assert.equal(appleProfileFromIdToken(jwtFor({ ...base, email: 'x@y.z', email_verified: false }), clientId), null);
    assert.equal(appleProfileFromIdToken(jwtFor({ ...base, email: 'x@y.z' }), clientId), null);
    assert.equal(appleProfileFromIdToken('not-a-jwt', clientId), null);
  });
}

await aok('outsider cannot read trip', async () => {
  const b = await req('POST', '/api/auth/register', {
    email: 'outsider@cohive.test',
    name: 'Out',
    password: 'password1',
  });
  assert.equal(b.status, 201);
  tokenB = b.data.token;
  // Register must NOT auto-join the demo seed trip — ACL boundary.
  const seedDenied = await req('GET', `/api/trips/${tripId}`, undefined, tokenB);
  assert.equal(seedDenied.status, 403);
  const denied = await req('GET', '/api/trips/does-not-exist', undefined, tokenB);
  assert.equal(denied.status, 404);
});

await aok('member can vote; non-member forbidden on foreign trip', async () => {
  const vote = await req(
    'POST',
    `/api/trips/${tripId}/votes`,
    { spotId: 1, tier: 'must' },
    tokenA
  );
  assert.equal(vote.status, 200);
  assert.equal(vote.data.spot.tier, 'must');

  // Create a private trip for A, then B must not access it.
  const created = await req('POST', '/api/trips', { name: 'Private', city: 'Osaka' }, tokenA);
  assert.equal(created.status, 201);
  const privateId = created.data.trip.id;
  const forbidden = await req('GET', `/api/trips/${privateId}`, undefined, tokenB);
  assert.equal(forbidden.status, 403);
  const forbiddenVote = await req(
    'POST',
    `/api/trips/${privateId}/votes`,
    { spotId: 1, tier: 'maybe' },
    tokenB
  );
  assert.equal(forbiddenVote.status, 403);
});

await aok('member invite is server-gated', async () => {
  const privateTrips = await req('GET', '/api/trips', undefined, tokenA);
  const privateId = privateTrips.data.trips.find((t) => t.name === 'Private')?.id;
  assert.ok(privateId);
  const add = await req('POST', `/api/trips/${privateId}/members`, { name: 'Ben' }, tokenA);
  assert.equal(add.status, 201);
  const blocked = await req('POST', `/api/trips/${privateId}/members`, { name: 'Eve' }, tokenB);
  assert.equal(blocked.status, 403);
});

console.log('\nscan rate limit + sanitize');
await aok('scan sanitizes and returns candidates', async () => {
  const res = await req(
    'POST',
    `/api/trips/${tripId}/scan`,
    { text: '<img src=x onerror=alert(1)> teamLab Planets https://tiktok.com/x' },
    tokenA
  );
  assert.equal(res.status, 200);
  assert.ok(res.data.candidates.length >= 1);
  assert.equal(res.data.source, 'tiktok');
});

await aok('scan is rate-limited per account', async () => {
  resetRateLimits();
  let limited = false;
  for (let i = 0; i < 35; i++) {
    const res = await req(
      'POST',
      `/api/trips/${tripId}/scan`,
      { text: 'Sushi bar in Shibuya #' + i },
      tokenA
    );
    if (res.status === 429) {
      limited = true;
      assert.equal(res.data.error, 'rate_limited');
      assert.ok(Number(res.headers.get('Retry-After')) >= 1);
      break;
    }
  }
  assert.ok(limited, 'expected 429 within 35 scans');
});

await aok('unauthenticated scan rejected', async () => {
  const res = await req('POST', `/api/trips/${tripId}/scan`, { text: 'hello' });
  assert.equal(res.status, 401);
});


console.log('\nabuse-surface guards');
await aok('rejects prototype-pollution keys in JSON body', async () => {
  const res = await api.handle(
    new Request('http://test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"x@y.z","password":"password1","__proto__":{"admin":true}}',
    })
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'dangerous_keys');
});

await aok('rejects oversized JSON bodies', async () => {
  const res = await api.handle(
    new Request('http://test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"x":"' + 'a'.repeat(70_000) + '"}',
    })
  );
  assert.equal(res.status, 413);
});

await aok('auth endpoints are IP rate-limited', async () => {
  resetRateLimits();
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const res = await req('POST', '/api/auth/login', {
      email: 'nobody@cohive.test',
      password: 'wrong-password',
    });
    if (res.status === 429) {
      limited = true;
      assert.equal(res.data.error, 'rate_limited');
      break;
    }
  }
  assert.ok(limited, 'expected auth 429 within 25 attempts');
});

await aok('addSpot clamps poisoned coordinates', async () => {
  resetRateLimits();
  const res = await req(
    'POST',
    `/api/trips/${tripId}/spots`,
    {
      candidate: {
        name: 'Poison Pier',
        lat: Number.POSITIVE_INFINITY,
        lng: Number.NaN,
        duration: Number.POSITIVE_INFINITY,
        cost: Number.NaN,
        category: '__proto__',
      },
      source: 'fuzz',
    },
    tokenA
  );
  assert.equal(res.status, 201);
  assert.equal(res.data.spot.lat, 0);
  assert.equal(res.data.spot.lng, 0);
  assert.equal(res.data.spot.category, 'sight');
  assert.ok(Number.isFinite(res.data.spot.duration));
  assert.ok(Number.isFinite(res.data.spot.cost));
});

await aok('register does not auto-join seed trip (ACL)', async () => {
  resetRateLimits();
  const reg = await req('POST', '/api/auth/register', {
    email: 'solo@cohive.test',
    name: 'Solo',
    password: 'password1',
  });
  assert.equal(reg.status, 201);
  const trips = await req('GET', '/api/trips', undefined, reg.data.token);
  assert.equal(trips.status, 200);
  assert.equal(trips.data.trips.length, 0);
});

await aok('file-backed store survives reload', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadSnapshot } = await import('../server/persist.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'cohive-store-'));
  const path = join(dir, 'store.json');
  try {
    const s1 = createStore(seed, { persistPath: path });
    const demo = s1.demoAuth({ provider: 'email', name: 'Persist' });
    assert.ok(demo.token);
    s1.castVote('1', demo.user.id, 1, 'maybe');
    await s1.flush();
    const s2 = createStore(seed, { persistPath: path });
    const snap = await loadSnapshot(path);
    s2.hydrate(snap);
    const user = s2.getSessionUser(demo.token);
    assert.ok(user);
    assert.equal(user.name, 'Persist');
    const trip = s2.getTrip('1', user.id);
    assert.ok(!trip.error);
    const spot = trip.spots.find((x) => x.id === 1);
    assert.equal(spot.tier, 'maybe');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

console.log('\nmoney — pot + splitting');
{
  const s = createStore(seed);
  const m = createApi({ store: s, scanImport });
  const call = async (method, path, body, token) => {
    const res = await m.handle(
      new Request('http://x' + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: body ? JSON.stringify(body) : undefined,
      })
    );
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const a = s.demoAuth({ provider: 'email', name: 'Ada' });
  const b = s.demoAuth({ provider: 'email', name: 'Bo' });

  await aok('non-members cannot touch the pot', async () => {
    assert.equal(s.contribute('1', 'nobody', 10).error, 'forbidden');
    assert.equal(s.withdraw('1', 'nobody', 10).error, 'forbidden');
    assert.equal(s.addExpense('1', 'nobody', { label: 'x', amount: 1 }).error, 'forbidden');
    const r = await call('POST', '/api/trips/1/fund/contributions', { amount: 10 }, 'deadbeef'.repeat(6));
    assert.equal(r.status, 401);
  });

  await aok('contribution is credited to the session user only', async () => {
    const r = await call('POST', '/api/trips/1/fund/contributions', { amount: 100, memberId: b.user.id }, a.token);
    assert.equal(r.status, 201);
    assert.equal(r.data.fund.length, 1);
    assert.equal(r.data.fund[0].memberId, a.user.id);
    assert.equal(r.data.fund[0].amount, 100);
  });

  await aok('amounts are validated (junk, negative, sub-cent, huge)', async () => {
    for (const amount of [0, -5, 'abc', 1.005, 1e12, null]) {
      const r = await call('POST', '/api/trips/1/fund/contributions', { amount }, a.token);
      assert.equal(r.status, 400, String(amount));
      assert.equal(r.data.error, 'invalid_amount');
    }
  });

  await aok('you can only take out what you put in', async () => {
    const steal = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 50 }, b.token);
    assert.equal(steal.status, 400);
    assert.equal(steal.data.error, 'exceeds_envelope');
    assert.equal(steal.data.withdrawable, 0);
    const over = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 100.01 }, a.token);
    assert.equal(over.data.error, 'exceeds_envelope');
    assert.equal(over.data.withdrawable, 100);
    const ok1 = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 40 }, a.token);
    assert.equal(ok1.status, 201);
    assert.equal(ok1.data.fund.length, 2);
  });

  await aok('pot refuses a bill a participant has not funded', async () => {
    const r = await call('POST', '/api/trips/1/expenses', { label: 'Dinner', amount: 60, paidBy: 'pot' }, a.token);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'pot_shortfall');
    assert.deepEqual(r.data.shortfalls, [{ memberId: b.user.id, short: 30 }]);
  });

  await aok('pot pays a covered bill and charges only the participants', async () => {
    const r = await call('POST', '/api/trips/1/expenses', { label: 'Taxi', amount: 60, paidBy: 'pot', splitWith: [a.user.id] }, a.token);
    assert.equal(r.status, 201);
    assert.equal(r.data.expense.paidBy, 'pot');
    assert.deepEqual(r.data.expense.splitWith, [a.user.id]);
    const left = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 0.01 }, a.token);
    assert.equal(left.data.error, 'exceeds_envelope');
    assert.equal(left.data.withdrawable, 0);
  });

  await aok('split expenses sanitize payer/participants and cap label length', async () => {
    const r = await call('POST', '/api/trips/1/expenses', { label: 'x'.repeat(500), amount: 30, paidBy: 'ghost', splitWith: ['ghost', b.user.id, b.user.id], category: '<b>food</b>' }, a.token);
    assert.equal(r.status, 201);
    assert.equal(r.data.expense.label.length, 80);
    assert.equal(r.data.expense.paidBy, a.user.id);
    assert.deepEqual(r.data.expense.splitWith, [b.user.id]);
    assert.equal(r.data.expense.category, 'food');
    const bad = await call('POST', '/api/trips/1/expenses', { label: '   ', amount: 30 }, a.token);
    assert.equal(bad.data.error, 'invalid_label');
  });

  await aok('GET /fund returns the books with legacy rows pinned to the owner', async () => {
    const r = await call('GET', '/api/trips/1/fund', undefined, b.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.fund.length, 2);
    const legacy = r.data.expenses.find((e) => e.id === 1);
    assert.equal(legacy.paidBy, a.user.id);
    const trip = await call('GET', '/api/trips/1', undefined, b.token);
    assert.equal(trip.data.fund.length, 2);
  });

  await aok('the pot survives a snapshot round-trip', async () => {
    const snap = JSON.parse(JSON.stringify(s._snapshot()));
    const s2 = createStore(seed);
    s2.hydrate(snap);
    assert.equal(s2.getFund('1', a.user.id).fund.length, 2);
    assert.equal(s2.withdraw('1', a.user.id, 1).error, 'exceeds_envelope');
    const c = s2.contribute('1', b.user.id, 5);
    assert.ok(c.fund.every((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i), 'ledger ids stay unique after hydrate');
  });

  await aok('voiding an expense reverses it, keeps the audit row and cannot repeat', async () => {
    const books = await call('GET', '/api/trips/1/fund', undefined, a.token);
    const taxi = books.data.expenses.find((e) => e.label === 'Taxi');
    assert.equal(s.voidExpense('1', 'nobody', taxi.id).error, 'forbidden');
    const missing = await call('POST', '/api/trips/1/expenses/999999/void', {}, a.token);
    assert.equal(missing.status, 404);
    const r = await call('POST', `/api/trips/1/expenses/${taxi.id}/void`, {}, a.token);
    assert.equal(r.status, 200);
    assert.ok(r.data.expense.voidedAt, 'void is stamped');
    assert.equal(r.data.expense.voidedBy, a.user.id);
    assert.ok(r.data.expenses.some((e) => e.id === taxi.id && e.voidedAt), 'row stays in the books');
    const again = await call('POST', `/api/trips/1/expenses/${taxi.id}/void`, {}, a.token);
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'already_voided');
    const back = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 60 }, a.token);
    assert.equal(back.status, 201, 'the pot share comes back to the envelope it was charged to');
    const empty = await call('POST', '/api/trips/1/fund/withdrawals', { amount: 0.01 }, a.token);
    assert.equal(empty.data.error, 'exceeds_envelope');
  });

  await aok('payout handles are validated, saved on the profile and shown on members', async () => {
    const anon = await call('POST', '/api/auth/me/profile', { payHandle: 'venmo:@ada' }, 'deadbeef'.repeat(6));
    assert.equal(anon.status, 401);
    const bad = await call('POST', '/api/auth/me/profile', { payHandle: 'zelle:ada' }, a.token);
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'invalid_pay_handle');
    const r = await call('POST', '/api/auth/me/profile', { payHandle: ' venmo:@ada ' }, a.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.payHandle, 'venmo:@ada');
    const trip = await call('GET', '/api/trips/1', undefined, b.token);
    assert.equal(trip.data.members.find((m) => m.id === a.user.id).payHandle, 'venmo:@ada');
    const me = await call('GET', '/api/auth/me', undefined, a.token);
    assert.equal(me.data.payHandle, 'venmo:@ada');
    const clear = await call('POST', '/api/auth/me/profile', { payHandle: '' }, a.token);
    assert.equal(clear.data.payHandle, null);
  });

  await aok('live updates: hive/trip responses carry sync, mutations bump it, non-members cannot read it', async () => {
    const trip = await call('GET', '/api/trips/1', undefined, a.token);
    assert.ok(trip.data.sync && typeof trip.data.sync.version === 'number', 'GET is stamped with sync');
    const { hiveId, version } = trip.data.sync;
    const v0 = await call('GET', `/api/hives/${hiveId}/version`, undefined, a.token);
    assert.equal(v0.status, 200);
    assert.equal(v0.data.version, version);
    const c = await call('POST', '/api/trips/1/fund/contributions', { amount: 1 }, b.token);
    assert.equal(c.status, 201);
    assert.equal(c.data.sync.version, version + 1, 'a write bumps the counter and returns it');
    const bad = await call('POST', '/api/trips/1/fund/contributions', { amount: -1 }, b.token);
    assert.equal(bad.status, 400);
    const v1 = await call('GET', `/api/hives/${hiveId}/version`, undefined, a.token);
    assert.equal(v1.data.version, version + 1, 'a refused write does not bump');
    assert.equal(s.hiveVersion(hiveId, 'nobody').error, 'forbidden');
    const snap = JSON.parse(JSON.stringify(s._snapshot()));
    const s2 = createStore(seed);
    s2.hydrate(snap);
    assert.equal(s2.peekHiveVersion(hiveId).version, version + 1, 'the counter survives a snapshot');
  });
}

console.log('\nidentity + invites (memory store)');
{
  const s = createStore(seed);
  const m = createApi({ store: s, scanImport });
  const call = async (method, path, body, token) => {
    const res = await m.handle(
      new Request('http://x' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
    );
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
  };
  await aok('magic link creates an account with its own starter trip; link is single-use', async () => {
    const req = await call('POST', '/api/auth/magic', { email: 'Eve@Example.com', name: 'Eve' });
    assert.equal(req.status, 200);
    const token = new URL(req.data.devLink).searchParams.get('token');
    const ok = await call('POST', '/api/auth/magic/verify', { token });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.created, true);
    assert.match(ok.headers.get('set-cookie') || '', /cohive_session=.*HttpOnly/);
    const again = await call('POST', '/api/auth/magic/verify', { token });
    assert.equal(again.status, 400);
    const trips = await call('GET', '/api/trips', undefined, ok.data.token);
    assert.equal(trips.data.trips.length, 1);
    assert.notEqual(trips.data.trips[0].id, '1', 'not the shared demo trip');
    const bad = await call('POST', '/api/auth/magic', { email: 'nope' });
    assert.equal(bad.status, 400);
  });
  await aok('invite placeholder → accept binds the user; the member id stays the ledger key', async () => {
    const owner = s.demoAuth({ provider: 'email', name: 'Owner' });
    const added = await call('POST', '/api/trips/1/members', { name: 'Fay' }, owner.token);
    assert.equal(added.status, 201);
    const code = added.data.invite.code;
    const slot = added.data.member.id;
    assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
    const preview = await call('GET', '/api/invites/' + code);
    assert.equal(preview.data.invite.memberName, 'Fay');
    const fay = s.register({ email: 'fay@example.com', name: 'Fay', password: 'hunter2hunter2' });
    const joined = await call('POST', '/api/invites/' + code + '/accept', {}, fay.token);
    assert.equal(joined.data.joined, true);
    assert.equal(joined.data.member.id, slot);
    const trip = await call('GET', '/api/trips/1', undefined, fay.token);
    assert.equal(trip.status, 200);
    assert.equal(trip.data.me, slot);
    const c = await call('POST', '/api/trips/1/fund/contributions', { amount: 25 }, fay.token);
    assert.equal(c.data.fund.at(-1).memberId, slot);
    const other = s.register({ email: 'gus@example.com', name: 'Gus', password: 'hunter2hunter2' });
    const spent = await call('POST', '/api/invites/' + code + '/accept', {}, other.token);
    assert.equal(spent.status, 410);
  });
  await aok('account deletion revokes sessions and anonymises memberships', async () => {
    const zed = s.register({ email: 'zed@example.com', name: 'Zed', password: 'hunter2hunter2' });
    const del = await call('DELETE', '/api/auth/me', undefined, zed.token);
    assert.equal(del.status, 200);
    assert.equal((await call('GET', '/api/auth/me', undefined, zed.token)).status, 401);
    assert.equal(s.login({ email: 'zed@example.com', password: 'hunter2hunter2' }).error, 'invalid_credentials');
  });
  await aok('invites and magic links survive a snapshot round-trip', async () => {
    const snap = JSON.parse(JSON.stringify(s._snapshot()));
    const s2 = createStore(seed);
    s2.hydrate(snap);
    const preview = s2.getInvite([...s2._invites.keys()][0]);
    assert.ok(!preview.error);
    assert.ok(s2._memberships.get('1').every((mm) => mm.memberId));
  });
}

console.log('\nhives — trips, Nest and Table inside one membership unit (memory store)');
{
  const s = createStore(seed);
  const m = createApi({ store: s, scanImport });
  const call = async (method, path, body, token) => {
    const res = await m.handle(
      new Request('http://x' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    );
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const owner = s.demoAuth({ provider: 'email', name: 'Hal' });
  const stranger = s.register({ email: 'ivy@example.com', name: 'Ivy', password: 'hunter2hunter2' });

  await aok('the seed hive lists its trip, members, Nest and Table; strangers get 403', async () => {
    const hives = await call('GET', '/api/hives', undefined, owner.token);
    assert.equal(hives.data.hives.length, 1);
    assert.equal(hives.data.hives[0].trips[0].id, '1');
    const h = await call('GET', '/api/hives/1', undefined, owner.token);
    assert.equal(h.status, 200);
    assert.equal(h.data.me, owner.user.id);
    assert.ok(h.data.nest.length >= 3 && h.data.table.length >= 3);
    assert.equal((await call('GET', '/api/hives/1', undefined, stranger.token)).status, 403);
    assert.equal((await call('POST', '/api/hives/1/nest', { title: 'x' }, stranger.token)).status, 403);
  });

  await aok('trips are capped per hive on Free; a new hive starts its own count', async () => {
    assert.equal((await call('POST', '/api/hives/1/trips', { name: 'Kyoto', lat: 35, lng: 135 }, owner.token)).status, 201);
    assert.equal((await call('POST', '/api/hives/1/trips', { name: 'Osaka' }, owner.token)).status, 201);
    const over = await call('POST', '/api/hives/1/trips', { name: 'Nara' }, owner.token);
    assert.equal(over.status, 402);
    assert.equal(over.data.error, 'trip_limit');
    const hive = await call('POST', '/api/hives', { name: '<b>Ski</b> crew' }, owner.token);
    assert.equal(hive.status, 201);
    assert.equal(hive.data.hive.name, 'Ski crew');
    assert.equal(hive.data.hive.role, 'owner');
    assert.equal((await call('POST', '/api/hives/' + hive.data.hive.id + '/trips', { name: 'Niseko' }, owner.token)).status, 201);
  });

  await aok('Nest: save a listing and toggle a reaction keyed by member id', async () => {
    const add = await call('POST', '/api/hives/1/nest', { title: 'Bushwick 1BR', price: 2600.7, beds: 1, baths: 1, hood: 'Bushwick', lat: 40.69, lng: -73.92 }, owner.token);
    assert.equal(add.status, 201);
    assert.equal(add.data.listing.price, 2601);
    const on = await call('POST', '/api/hives/1/nest/' + add.data.listing.id + '/react', { emoji: '💍' }, owner.token);
    assert.deepEqual(on.data.listing.reactions['💍'], [owner.user.id]);
    const off = await call('POST', '/api/hives/1/nest/' + add.data.listing.id + '/react', { emoji: '💍' }, owner.token);
    assert.deepEqual(off.data.listing.reactions['💍'], []);
    assert.equal((await call('POST', '/api/hives/1/nest/' + add.data.listing.id + '/react', { emoji: '🔥' }, owner.token)).status, 400);
    assert.equal((await call('POST', '/api/hives/1/nest', { title: '' }, owner.token)).status, 400);
  });

  await aok('Table: add a place, mark it tried, move its tier; bad tiers are refused', async () => {
    const add = await call('POST', '/api/hives/1/table', { name: 'Kru', cuisine: 'Thai', hood: 'Greenpoint', price: '$$$' }, owner.token);
    assert.equal(add.status, 201);
    assert.equal(add.data.restaurant.tier, 'maybe');
    const id = add.data.restaurant.id;
    const upd = await call('POST', '/api/hives/1/table/' + id, { tried: true, tier: 'must' }, owner.token);
    assert.equal(upd.data.restaurant.tried, true);
    assert.equal(upd.data.restaurant.tier, 'must');
    assert.equal((await call('POST', '/api/hives/1/table/' + id, { tier: 'never' }, owner.token)).status, 400);
    const hive = await call('GET', '/api/hives/1', undefined, owner.token);
    assert.ok(hive.data.table.some((r) => r.id === id && r.tried));
  });

  await aok('a hive invite admits the member to every trip in the hive', async () => {
    const inv = await call('POST', '/api/hives/1/invites', { maxUses: 2 }, owner.token);
    assert.equal(inv.status, 201);
    const joined = await call('POST', '/api/invites/' + inv.data.invite.code + '/accept', {}, stranger.token);
    assert.equal(joined.data.joined, true);
    assert.equal(joined.data.hive.id, '1');
    const trips = await call('GET', '/api/trips', undefined, stranger.token);
    assert.equal(trips.data.trips.length, 3, 'all three trips of the hive');
    assert.equal((await call('GET', '/api/hives/1', undefined, stranger.token)).status, 200);
  });

  await aok('pre-hive snapshots hydrate into hives', async () => {
    const snap = JSON.parse(JSON.stringify(s._snapshot()));
    delete snap.hives;
    for (const t of snap.trips) delete t.hiveId;
    for (const i of snap.invites) { i.tripId = i.hiveId; delete i.hiveId; }
    const s2 = createStore(seed);
    s2.hydrate(snap);
    assert.ok(s2._hives.has('1'));
    assert.equal(s2.getTrip('1', owner.user.id).trip.hiveId, '1');
    assert.ok(!s2.getHive('1', stranger.user.id).error, 'invited member survives the migration');
  });
}

console.log('\nentitlements — the server decides what is paid for (memory store)');
{
  const { createHmac } = await import('node:crypto');
  process.env.COHIVE_BILLING_SECRET = 'test-secret';
  const s = createStore(seed);
  const m = createApi({ store: s, scanImport });
  const call = async (method, path, body, token, headers = {}) => {
    const raw = body ? JSON.stringify(body) : undefined;
    const res = await m.handle(
      new Request('http://x' + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
        body: raw,
      })
    );
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const sign = (body) => ({ 'X-Cohive-Signature': createHmac('sha256', 'test-secret').update(JSON.stringify(body)).digest('hex') });
  const mike = s.register({ email: 'mike@example.com', name: 'Mike', password: 'hunter2hunter2' });

  await aok('/me reports Free with Free caps and no referral code', async () => {
    const me = await call('GET', '/api/auth/me', undefined, mike.token);
    assert.equal(me.data.entitlement.tier, 'Free');
    assert.deepEqual(me.data.caps, { hives: 3, tripsPerHive: 3 });
    assert.deepEqual(me.data.features, { connections: false, booking: false });
    assert.equal(me.data.referralCode, null);
  });

  await aok('billing webhook demands a valid HMAC signature', async () => {
    const evt = { userId: mike.user.id, tier: 'Platinum', source: 'stripe', eventId: 'evt_1' };
    assert.equal((await call('POST', '/api/billing/webhook', evt)).status, 401);
    assert.equal((await call('POST', '/api/billing/webhook', evt, undefined, { 'X-Cohive-Signature': 'deadbeef' })).status, 401);
    const ok = await call('POST', '/api/billing/webhook', evt, undefined, sign(evt));
    assert.equal(ok.status, 200);
    assert.equal(ok.data.entitlement.tier, 'Platinum');
    assert.match(ok.data.referralCode, /^MIKE-[A-Z0-9]{4}10$/);
  });

  await aok('events are idempotent; the referral code never changes; caps lift with a paid tier', async () => {
    const first = (await call('GET', '/api/auth/me', undefined, mike.token)).data.referralCode;
    const evt = { userId: mike.user.id, tier: 'Cohive+', source: 'stripe', eventId: 'evt_1' };
    const dup = await call('POST', '/api/billing/webhook', evt, undefined, sign(evt));
    assert.equal(dup.data.duplicate, true);
    assert.equal(dup.data.entitlement.tier, 'Platinum', 'a replayed event does not overwrite');
    const evt2 = { userId: mike.user.id, tier: 'Cohive+', source: 'stripe', eventId: 'evt_2' };
    const next = await call('POST', '/api/billing/webhook', evt2, undefined, sign(evt2));
    assert.equal(next.data.entitlement.tier, 'Cohive+');
    assert.equal(next.data.referralCode, first);
    assert.deepEqual(next.data.features, { connections: true, booking: false });
    for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/hives', { name: 'H' + i }, mike.token)).status, 201, 'paid: more than 3 hives');
  });

  await aok('an expired entitlement reads as Free and Free caps return', async () => {
    const evt = { userId: mike.user.id, tier: 'Cohive+', source: 'stripe', eventId: 'evt_3', expiresAt: new Date(Date.now() - 1000).toISOString() };
    const r = await call('POST', '/api/billing/webhook', evt, undefined, sign(evt));
    assert.equal(r.data.entitlement.tier, 'Free');
    assert.equal(r.data.entitlement.source, 'expired');
    assert.equal((await call('POST', '/api/hives', { name: 'one more' }, mike.token)).status, 402);
    const bad = { userId: 'nobody', tier: 'Platinum', eventId: 'evt_4' };
    assert.equal((await call('POST', '/api/billing/webhook', bad, undefined, sign(bad))).status, 404);
    const junk = { userId: mike.user.id, tier: 'Gold', eventId: 'evt_5' };
    assert.equal((await call('POST', '/api/billing/webhook', junk, undefined, sign(junk))).status, 400);
  });

  await aok('sign-ups carry referral attribution; demo purchase mirrors the sheet outside production', async () => {
    const code = (await call('GET', '/api/auth/me', undefined, mike.token)).data.referralCode;
    const nia = await call('POST', '/api/auth/register', { email: 'nia@example.com', name: 'Nia', password: 'hunter2hunter2', ref: code.toLowerCase() });
    assert.equal(nia.status, 201);
    assert.equal((await call('GET', '/api/auth/me', undefined, nia.data.token)).data.referredBy, mike.user.id);
    const buy = await call('POST', '/api/billing/demo-purchase', { tier: 'Cohive+ Annual' }, nia.data.token);
    assert.equal(buy.status, 200);
    assert.equal(buy.data.features.booking, true);
    assert.match(buy.data.referralCode, /^NIA-[A-Z0-9]{4}10$/);
    assert.equal((await call('POST', '/api/billing/demo-purchase', { tier: 'Gold' }, nia.data.token)).status, 400);
  });
  delete process.env.COHIVE_BILLING_SECRET;
}

console.log(`\nverify:api — ${passed} checks passed`);
