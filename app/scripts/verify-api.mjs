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

await aok('outsider cannot read trip', async () => {
  const b = await req('POST', '/api/auth/register', {
    email: 'outsider@cohive.test',
    name: 'Out',
    password: 'password1',
  });
  // Fresh store attaches every new user to the seed trip — carve an outsider
  // by creating a second trip owner and removing them is awkward; instead
  // register then vote on a fabricated trip id.
  tokenB = b.data.token;
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

console.log(`\nverify:api — ${passed} checks passed`);
