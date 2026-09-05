/**
 * Engine stress + fuzz — run via `npm run stress:engine`.
 *
 * Hammers planTrip and scanImport with thousands of randomized, adversarial
 * inputs and asserts the invariants that must hold for ANY input: no throws,
 * no NaN, day counts honoured, windows respected, determinism, and a
 * wall-clock budget. The RNG is seeded so failures reproduce.
 */
import assert from 'node:assert/strict';

import { buildIcs, planAsText, planTrip, scanImport } from '../src/engine/engine.ts';
import { trip as seedTrip } from '../src/engine/seed.ts';
import type { Category, Pace, PlanVisit, Spot, Tier, TripPlan } from '../src/types.ts';

/* Mulberry32 — tiny seeded RNG so every failure is reproducible. */
let rngState = 0xC0411FE;
const rand = () => {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const CATS: Category[] = ['food', 'sight', 'nature', 'museum', 'nightlife', 'shopping', 'hotel'];
const TIERS: (Tier | null)[] = ['must', 'maybe', 'iftime', null];
const PACES: Pace[] = ['relaxed', 'balanced', 'packed'];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function randomSpot(id: number): Spot {
  const open = rand() < 0.4 ? null : randInt(0, 23) + pick([0, 0.5]);
  // Deliberately allow close < open, close = open, and >24h closes.
  const close = rand() < 0.4 ? null : randInt(0, 26) + pick([0, 0.5]);
  return {
    id,
    name: 'Spot ' + id + (rand() < 0.1 ? ' — 日本語 & “quotes” 🍜' : ''),
    category: pick(CATS),
    lat: -85 + rand() * 170,
    lng: -180 + rand() * 360,
    duration: pick([0, 5, 30, 60, 90, 180, 600]),
    cost: pick([0, 0, 4, 27, 120, 500]),
    rating: randInt(1, 5),
    open,
    close,
    source: pick(['tiktok', 'instagram', 'maps', 'manual', 'note']),
    tier: pick(TIERS),
    votes: randInt(0, 12),
    note: rand() < 0.2 ? 'fuzz note' : '',
    ...(rand() < 0.05 ? { skipped: true } : {}),
  };
}

const stripVolatile = (p: TripPlan) => JSON.stringify({ ...p, generatedAt: null });

let checks = 0;
const ok = (label: string, fn: () => void) => {
  fn();
  checks++;
  console.log('  ✓ ' + label);
};

/* ── planTrip fuzz ─────────────────────────────────────────────── */
console.log('\nplanTrip fuzz — 300 randomized trips (seeded)');
ok('300 random trips: no throws, no NaN, invariants hold', () => {
  for (let run = 0; run < 300; run++) {
    const spots = Array.from({ length: randInt(0, 120) }, (_, i) => randomSpot(1000 + i));
    const startHour = randInt(0, 23);
    const opts = {
      days: randInt(1, 10),
      pace: pick(PACES),
      startHour,
      // Includes zero-width and inverted windows.
      endHour: pick([startHour, startHour + randInt(1, 14), randInt(0, 23)]),
    };
    const plan = planTrip(spots, opts);

    assert.equal(plan.days.length, opts.days, `run ${run}: day count`);
    const visits = plan.days.flatMap((d) => d.items.filter((i): i is PlanVisit => i.type === 'visit'));
    const eligible = spots.filter((s) => !s.skipped && s.category !== 'hotel');
    assert.ok(
      visits.length + plan.unplaced.length <= eligible.length,
      `run ${run}: ${visits.length} visits + ${plan.unplaced.length} unplaced > ${eligible.length} eligible`
    );
    const ids = visits.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, `run ${run}: duplicate visit`);
    for (const v of visits) {
      assert.ok(/^\d{2}:\d{2}$/.test(v.start) && /^\d{2}:\d{2}$/.test(v.end), `run ${run}: bad time ${v.start}`);
      assert.ok(Number.isFinite(v.cost) && Number.isFinite(v.lat) && Number.isFinite(v.lng), `run ${run}: NaN`);
    }
    for (const d of plan.days) {
      assert.ok(Number.isFinite(d.cost) && d.cost >= 0, `run ${run}: bad day cost`);
      if (opts.endHour > opts.startHour && opts.endHour <= 24) {
        for (const it of d.items) {
          if (it.type !== 'visit') continue;
          assert.ok(toMin(it.start) >= opts.startHour * 60, `run ${run}: starts before window`);
          assert.ok(toMin(it.end) <= opts.endHour * 60, `run ${run}: ends after window`);
        }
      }
    }
    assert.ok(Number.isFinite(plan.totalCost), `run ${run}: totalCost NaN`);
    assert.equal(plan.totalCost, plan.days.reduce((a, d) => a + d.cost, 0), `run ${run}: cost mismatch`);
  }
});

ok('planTrip is deterministic for identical input', () => {
  const spots = Array.from({ length: 60 }, (_, i) => randomSpot(5000 + i));
  const opts = { days: 5, pace: 'balanced' as Pace, startHour: 9, endHour: 21 };
  assert.equal(stripVolatile(planTrip(spots, opts)), stripVolatile(planTrip(spots, opts)));
});

ok('exports survive fuzzed plans', () => {
  for (let run = 0; run < 40; run++) {
    const spots = Array.from({ length: randInt(0, 80) }, (_, i) => randomSpot(9000 + i));
    const plan = planTrip(spots, { days: randInt(1, 8), pace: pick(PACES), startHour: 8, endHour: 22 });
    const ics = buildIcs(plan, seedTrip);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);
    assert.ok(planAsText(plan, seedTrip).includes(seedTrip.name));
  }
});

/* ── scanImport fuzz ───────────────────────────────────────────── */
console.log('\nscanImport fuzz — 2000 adversarial inputs (seeded)');
const CTX = { city: 'Tokyo', lat: 35.6762, lng: 139.7503 };
const GLYPHS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n\t.,!?#@$%&*()[]{}<>\'"’“”—–…https://:/-_+=🍜🍣🗼💍🪴⬡日本語ラーメン渋谷';
const randomText = (): string => {
  const kind = randInt(0, 6);
  if (kind === 0) return '';
  if (kind === 1) return ' '.repeat(randInt(1, 40));
  if (kind === 2) {
    return 'https://' + pick(['tiktok.com', 'instagram.com', 'youtu.be', 'zillow.com', 'x.example']) +
      '/' + Array.from({ length: randInt(0, 4) }, () =>
        Array.from({ length: randInt(1, 12) }, () => pick([...GLYPHS])).join('').replace(/\s/g, '-')
      ).join('/');
  }
  const len = kind === 6 ? randInt(2000, 12000) : randInt(1, 300);
  return Array.from({ length: len }, () => pick([...GLYPHS])).join('');
};

ok('2000 fuzzed scans: always ≥1 candidate, sane fields, no throws', () => {
  for (let i = 0; i < 2000; i++) {
    const res = scanImport(randomText(), CTX);
    assert.ok(res.candidates.length >= 1 && res.candidates.length <= 4, `iter ${i}: ${res.candidates.length} candidates`);
    for (const c of res.candidates) {
      assert.ok(c.name.length > 0, `iter ${i}: empty name`);
      assert.ok(c.confidence >= 1 && c.confidence <= 100, `iter ${i}: confidence ${c.confidence}`);
      assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng), `iter ${i}: bad coords`);
      assert.ok(Math.abs(c.lat - CTX.lat) < 1 || c.confidence === 97, `iter ${i}: inferred coords far from hive`);
    }
  }
});

ok('scanImport is deterministic', () => {
  const inputs = Array.from({ length: 50 }, randomText);
  for (const t of inputs) {
    assert.equal(JSON.stringify(scanImport(t, CTX)), JSON.stringify(scanImport(t, CTX)));
  }
});

/* ── performance budget ────────────────────────────────────────── */
console.log('\nperformance');
ok('planTrip with 300 spots stays under 250ms', () => {
  const spots = Array.from({ length: 300 }, (_, i) => randomSpot(20000 + i));
  const t0 = performance.now();
  planTrip(spots, { days: 10, pace: 'packed', startHour: 8, endHour: 22 });
  const ms = performance.now() - t0;
  console.log(`      300 spots / 10 days / packed: ${ms.toFixed(1)}ms`);
  assert.ok(ms < 250, `took ${ms.toFixed(1)}ms`);
});

ok('scanImport averages under 2ms on 10KB captions', () => {
  const big = Array.from({ length: 20 }, randomText).map((t) => t.padEnd(10000, ' Tokyo Tower '));
  const t0 = performance.now();
  for (const t of big) scanImport(t, CTX);
  const avg = (performance.now() - t0) / big.length;
  console.log(`      avg ${avg.toFixed(2)}ms per 10KB scan`);
  assert.ok(avg < 2, `avg ${avg.toFixed(2)}ms`);
});

/* ── load curve + heap (requires node --expose-gc) ─────────────── */
console.log('\nload curve + heap');
const heapMB = (): number => {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') g();
  return process.memoryUsage().heapUsed / 1048576;
};

ok('3000 consecutive planTrip solves stay under load-curve budget', () => {
  const spots = Array.from({ length: 80 }, (_, i) => randomSpot(40000 + i));
  const opts = { days: 5, pace: 'balanced' as Pace, startHour: 9, endHour: 21 };
  // Warm + force a baseline after nursery churn settles.
  for (let i = 0; i < 40; i++) planTrip(spots, opts);
  const h0 = heapMB();
  const t0 = performance.now();
  let last: TripPlan | null = null;
  const samples: number[] = [];
  for (let i = 0; i < 3000; i++) {
    const s0 = performance.now();
    last = planTrip(spots, opts);
    if (i % 500 === 499) samples.push(performance.now() - s0);
  }
  last = null;
  const elapsed = performance.now() - t0;
  const h1 = heapMB();
  const delta = h1 - h0;
  console.log(
    `      3000 solves: ${elapsed.toFixed(0)}ms total · p500 samples ${samples
      .map((m) => m.toFixed(2) + 'ms')
      .join(', ')} · heap ${h0.toFixed(1)}→${h1.toFixed(1)} MB (Δ ${delta.toFixed(1)})`
  );
  assert.ok(elapsed < 8000, `3000 solves took ${elapsed.toFixed(0)}ms`);
  assert.ok(delta < 15, `heap grew ${delta.toFixed(1)} MB over 3000 solves`);
});

ok('3000 consecutive scanImport calls do not retain heap', () => {
  const big = 'Tokyo Tower Shibuya Ramen '.repeat(400);
  for (let i = 0; i < 40; i++) scanImport(big + i, CTX);
  const h0 = heapMB();
  let last: ReturnType<typeof scanImport> | null = null;
  for (let i = 0; i < 3000; i++) {
    last = scanImport(big + ' run ' + i, CTX);
  }
  last = null;
  const h1 = heapMB();
  const delta = h1 - h0;
  console.log(`      3000 scans: heap ${h0.toFixed(1)}→${h1.toFixed(1)} MB (Δ ${delta.toFixed(1)})`);
  assert.ok(delta < 15, `heap grew ${delta.toFixed(1)} MB over 3000 scans`);
});

console.log(`\n${checks} stress checks passed.\n`);
