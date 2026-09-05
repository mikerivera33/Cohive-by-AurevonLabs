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

await aok('demo auth cannot take over a password-registered account', async () => {
  resetRateLimits();
  const email = 'locked-demo@cohive.test';
  const reg = await req('POST', '/api/auth/register', {
    email,
    name: 'Locked',
    password: 'password1',
  });
  assert.equal(reg.status, 201);
  const victimId = reg.data.user.id;
  const hijack = await req('POST', '/api/auth/demo', {
    provider: 'email',
    name: 'Attacker',
    contact: email,
  });
  assert.equal(hijack.status, 401);
  assert.equal(hijack.data.error, 'use_registered_login');
  assert.equal(hijack.data.token, undefined);
  const stillLogin = await req('POST', '/api/auth/login', {
    email,
    password: 'password1',
  });
  assert.equal(stillLogin.status, 200);
  assert.equal(stillLogin.data.user.id, victimId);
});

await aok('demo auth cannot take over a verified OAuth account', async () => {
  resetRateLimits();
  const store2 = createStore(seed);
  const api2 = createApi({ store: store2, scanImport });
  async function req2(method, path, body) {
    const res = await api2.handle(
      new Request('http://test' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const upserted = store2.oauthUpsert({
    provider: 'google',
    email: 'oauth-victim@cohive.test',
    name: 'OAuth Maya',
    verified: true,
  });
  assert.ok(upserted.token);
  const hijack = await req2('POST', '/api/auth/demo', {
    provider: 'email',
    name: 'Attacker',
    contact: 'oauth-victim@cohive.test',
  });
  assert.equal(hijack.status, 401);
  assert.equal(hijack.data.error, 'use_registered_login');
  assert.equal(hijack.data.token, undefined);
});

await aok('demo auth still re-enters an existing demo email session', async () => {
  resetRateLimits();
  const first = await req('POST', '/api/auth/demo', {
    provider: 'email',
    name: 'Demo Maya',
    contact: 'demo-reentry@cohive.test',
  });
  assert.equal(first.status, 201);
  const again = await req('POST', '/api/auth/demo', {
    provider: 'email',
    name: 'Demo Maya',
    contact: 'demo-reentry@cohive.test',
  });
  assert.equal(again.status, 201);
  assert.ok(again.data.token);
  assert.equal(again.data.user.id, first.data.user.id);
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

console.log(`\nverify:api — ${passed} checks passed`);
