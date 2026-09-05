/**
 * One-shot heap probe: 3000 planTrip + 3000 scanImport with forced GC.
 * Run: node --expose-gc scripts/heap-probe.mjs
 */
import { buildSync } from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('node_modules/.cache', { recursive: true });
buildSync({
  entryPoints: ['src/engine/engine.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'node_modules/.cache/engine-heap-probe.mjs',
  logLevel: 'error',
});

const { planTrip, scanImport } = await import('../node_modules/.cache/engine-heap-probe.mjs');

const CATS = ['food', 'sight', 'nature', 'museum', 'nightlife', 'shopping', 'hotel'];
const TIERS = ['must', 'maybe', 'iftime', null];
const PACES = ['relaxed', 'balanced', 'packed'];
let rngState = 0xc0411fe;
const rand = () => {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

function randomSpot(id) {
  return {
    id,
    name: 'Spot ' + id,
    category: pick(CATS),
    lat: -85 + rand() * 170,
    lng: -180 + rand() * 360,
    duration: pick([30, 60, 90, 180]),
    cost: pick([0, 4, 27, 120]),
    rating: randInt(1, 5),
    open: rand() < 0.4 ? null : randInt(0, 23),
    close: rand() < 0.4 ? null : randInt(0, 26),
    source: 'manual',
    tier: pick(TIERS),
    votes: randInt(0, 12),
    note: '',
  };
}

function heapMB() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().heapUsed / 1048576;
}

for (let i = 0; i < 50; i++) {
  planTrip(Array.from({ length: 80 }, (_, j) => randomSpot(j)), {
    days: 5,
    pace: 'balanced',
    startHour: 9,
    endHour: 21,
  });
}
const h0 = heapMB();
let last = null;
for (let i = 0; i < 3000; i++) {
  last = planTrip(Array.from({ length: 80 }, (_, j) => randomSpot(10000 + i * 100 + j)), {
    days: 5,
    pace: pick(PACES),
    startHour: 8,
    endHour: 22,
  });
}
last = null;
const h1 = heapMB();
console.log(
  `planTrip x3000: ${h0.toFixed(1)} -> ${h1.toFixed(1)} MB (Δ ${(h1 - h0).toFixed(1)} MB)`
);

const CTX = { city: 'Tokyo', lat: 35.6762, lng: 139.7503 };
const big = 'Tokyo Tower Shibuya Ramen '.repeat(400);
for (let i = 0; i < 50; i++) scanImport(big + i, CTX);
const s0 = heapMB();
let sl = null;
for (let i = 0; i < 3000; i++) {
  sl = scanImport(big + ' run ' + i + ' https://tiktok.com/@x/video/' + i, CTX);
}
sl = null;
const s1 = heapMB();
console.log(
  `scanImport x3000: ${s0.toFixed(1)} -> ${s1.toFixed(1)} MB (Δ ${(s1 - s0).toFixed(1)} MB)`
);

const retained = Math.max(h1 - h0, 0) + Math.max(s1 - s0, 0);
if (retained > 15) {
  console.error(`WARN: retained ~${retained.toFixed(1)} MB after 3000+3000 solves`);
  process.exitCode = 1;
} else {
  console.log(`OK: retained ~${retained.toFixed(1)} MB (budget 15 MB)`);
}
