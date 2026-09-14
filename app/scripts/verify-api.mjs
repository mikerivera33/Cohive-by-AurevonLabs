/**
 * API property checks — auth, ACL (trips/members/votes), ingest sanitization,
 * and scan rate limiting. Run via `npm run verify:api`.
 */
import assert from 'node:assert/strict';

import { createApi } from '../server/api.mjs';
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

console.log(`\nverify:api — ${passed} checks passed`);
