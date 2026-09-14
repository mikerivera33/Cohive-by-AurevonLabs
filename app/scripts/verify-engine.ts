/**
 * Engine smoke check — run with:
 *   node --experimental-strip-types scripts/verify-engine.ts
 *
 * Asserts the properties the product promises: every must-do lands on the plan,
 * days respect the trip window, opening hours are honoured, pace caps hold, and
 * the scanner always resolves at least one candidate.
 */
import assert from 'node:assert/strict';

import { planTrip, scanImport, buildIcs, planAsText } from '../src/engine/engine.ts';
import {
  potShortfalls,
  settleUp,
  splitEqual,
  summarizeLedger,
  withdrawable,
  isValidAmount,
} from '../src/engine/ledger.ts';
import type { FundEntry, LedgerExpense } from '../src/engine/ledger.ts';
import { tripSpots, trip } from '../src/engine/seed.ts';
import type { Pace, PlanVisit } from '../src/types.ts';

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

let checks = 0;
const ok = (label: string, fn: () => void) => {
  fn();
  checks++;
  console.log('  ✓ ' + label);
};

console.log('\nplanTrip');
for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
  const plan = planTrip(tripSpots, {
    days: 4,
    pace,
    startHour: trip.startHour,
    endHour: trip.endHour,
  });
  const visits = plan.days.flatMap((d) => d.items.filter((i): i is PlanVisit => i.type === 'visit'));

  ok(`${pace}: every must-do is placed`, () => {
    const musts = tripSpots.filter((s) => s.tier === 'must').map((s) => s.name);
    const placed = new Set(visits.map((v) => v.name));
    const missing = musts.filter((m) => !placed.has(m));
    assert.deepEqual(missing, [], 'unplaced must-dos: ' + missing.join(', '));
  });

  ok(`${pace}: no spot is scheduled twice`, () => {
    const names = visits.map((v) => v.name);
    assert.equal(new Set(names).size, names.length);
  });

  ok(`${pace}: every visit sits inside the ${trip.startHour}:00–${trip.endHour}:00 window`, () => {
    for (const v of visits) {
      assert.ok(toMin(v.start) >= trip.startHour * 60, `${v.name} starts at ${v.start}`);
      assert.ok(toMin(v.end) <= trip.endHour * 60, `${v.name} ends at ${v.end}`);
    }
  });

  ok(`${pace}: nothing is scheduled before it opens`, () => {
    for (const v of visits) {
      const src = tripSpots.find((s) => s.name === v.name);
      if (src?.open != null) {
        assert.ok(toMin(v.start) >= src.open * 60, `${v.name} starts ${v.start}, opens ${src.open}:00`);
      }
    }
  });

  ok(`${pace}: each day's times run strictly forward`, () => {
    for (const d of plan.days) {
      let cursor = -1;
      for (const it of d.items) {
        if (it.type !== 'visit') continue;
        assert.ok(toMin(it.start) >= cursor, `day ${d.day}: ${it.name} starts before the previous item ends`);
        assert.ok(toMin(it.end) >= toMin(it.start), `day ${d.day}: ${it.name} ends before it starts`);
        cursor = toMin(it.end);
      }
    }
  });

  ok(`${pace}: day cost sums match the visits on that day`, () => {
    for (const d of plan.days) {
      const sum = d.items.filter((i): i is PlanVisit => i.type === 'visit').reduce((a, v) => a + v.cost, 0);
      assert.equal(d.cost, sum, `day ${d.day} cost ${d.cost} != ${sum}`);
    }
    assert.equal(
      plan.totalCost,
      plan.days.reduce((a, d) => a + d.cost, 0)
    );
  });

  ok(`${pace}: hotels are excluded and day count is honoured`, () => {
    assert.equal(plan.days.length, 4);
    assert.equal(visits.filter((v) => v.category === 'hotel').length, 0);
  });
}

ok('a single day still produces a plan', () => {
  const plan = planTrip(tripSpots, { days: 1, pace: 'packed', startHour: 9, endHour: 21 });
  assert.equal(plan.days.length, 1);
  assert.ok(plan.days[0].items.length > 0);
});

ok('an empty shortlist produces empty days, not a crash', () => {
  const plan = planTrip([], { days: 3, pace: 'balanced', startHour: 9, endHour: 21 });
  assert.equal(plan.days.length, 3);
  assert.equal(plan.totalCost, 0);
  assert.deepEqual(plan.unplaced, []);
});

console.log('\nscanImport — never dead-ends');
const SCAN_CTX = { city: 'Tokyo', lat: 35.6762, lng: 139.7503 };
const inputs: [string, string][] = [
  ['exact gazetteer hit', 'you HAVE to try Afuri Ramen Ebisu it is unreal'],
  ['multiple exact hits', 'Afuri Ramen Ebisu then Nezu Museum then Tokyo Tower'],
  ['proper-noun mining', 'omg Blue Bottle Kiyosumi is the best coffee bar in the city'],
  ['url slug mining', 'https://example.com/guides/hidden-izakaya-alley'],
  ['bare tiktok url', 'https://www.tiktok.com/@someone/video/123456789'],
  ['emoji only', '🍜🍣🗼'],
  ['whitespace-ish', '...'],
  ['very long caption', 'day 3 '.repeat(200)],
];
for (const [label, text] of inputs) {
  ok(`${label}: resolves ≥1 candidate with a confidence score`, () => {
    const res = scanImport(text, SCAN_CTX);
    assert.ok(res.candidates.length >= 1, 'no candidates for: ' + label);
    assert.ok(res.candidates.length <= 4, 'more than 4 candidates');
    for (const c of res.candidates) {
      assert.ok(c.confidence > 0 && c.confidence <= 100, 'bad confidence ' + c.confidence);
      assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng), 'bad coords for ' + c.name);
      assert.ok(c.name.length > 0);
    }
  });
}

ok('source detection reads the platform off the url', () => {
  assert.equal(scanImport('https://tiktok.com/x', SCAN_CTX).source, 'tiktok');
  assert.equal(scanImport('https://instagram.com/x', SCAN_CTX).source, 'instagram');
  assert.equal(scanImport('https://youtu.be/x', SCAN_CTX).source, 'youtube');
  assert.equal(scanImport('https://streeteasy.com/x', SCAN_CTX).source, 'listing');
  assert.equal(scanImport('https://resy.com/x', SCAN_CTX).source, 'dining');
  assert.equal(scanImport('https://example.com/x', SCAN_CTX).source, 'web');
  assert.equal(scanImport('just a note', SCAN_CTX).source, 'note');
});

ok('an exact hit scores 97 and keeps the real coordinates', () => {
  const res = scanImport('Nezu Museum', SCAN_CTX);
  const hit = res.candidates.find((c) => c.name === 'Nezu Museum');
  assert.ok(hit);
  assert.equal(hit.confidence, 97);
  assert.equal(hit.matched, 'exact');
  assert.equal(hit.lat, 35.6622);
});

console.log('\nexports');
const plan = planTrip(tripSpots, { days: 4, pace: 'balanced', startHour: 9, endHour: 21 });

ok('.ics is well-formed and event counts match the plan', () => {
  const ics = buildIcs(plan, trip);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const ends = (ics.match(/END:VEVENT/g) || []).length;
  const visits = plan.days.flatMap((d) => d.items.filter((i) => i.type === 'visit')).length;
  assert.equal(begins, visits);
  assert.equal(ends, visits);
  assert.ok(/DTSTART:\d{8}T\d{6}/.test(ics), 'DTSTART is not a valid timestamp');
});

ok('.ics dates advance one day per plan day', () => {
  const ics = buildIcs(plan, trip);
  const days = [...new Set((ics.match(/DTSTART:(\d{8})/g) || []).map((s) => s.slice(8)))];
  assert.deepEqual(days, ['20260901', '20260902', '20260903', '20260904'].slice(0, days.length));
});

ok('text export lists every day', () => {
  const txt = planAsText(plan, trip);
  assert.ok(txt.startsWith('Tokyo Adventure'));
  for (const d of plan.days) assert.ok(txt.includes('Day ' + d.day), 'missing day ' + d.day);
});

console.log('\nledger — pot + envelopes + splitting');
{
  const ids = [1, 2, 3];
  const fund: FundEntry[] = [
    { id: 1, memberId: 1, kind: 'contribution', amount: 200, at: '' },
    { id: 2, memberId: 2, kind: 'contribution', amount: 150, at: '' },
  ];
  const legacy: LedgerExpense[] = [{ id: 1, amount: 100 }]; // no payer/split → owner, everyone

  ok('splitEqual always adds up to the cent', () => {
    for (const [amt, n] of [[100, 3], [0.01, 2], [10, 7], [1234.56, 5]] as const) {
      const shares = splitEqual(amt, n);
      assert.equal(shares.length, n);
      assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), Math.round(amt * 100));
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 0.01 + 1e-9);
    }
    assert.deepEqual(splitEqual(100, 3), [33.34, 33.33, 33.33]);
    assert.deepEqual(splitEqual(5, 0), []);
  });

  ok('isValidAmount rejects junk, negatives, >2 decimals and huge values', () => {
    for (const bad of [0, -1, NaN, Infinity, '5', 1.005, 1e9, null]) assert.equal(isValidAmount(bad), false, String(bad));
    for (const good of [0.01, 5, 26.67, 999999.99]) assert.equal(isValidAmount(good), true, String(good));
  });

  ok('envelopes track each member’s own money and sum to the pot', () => {
    const l = summarizeLedger(ids, legacy, fund, 1);
    assert.equal(l.pot, 350);
    assert.deepEqual(l.envelopes, { 1: 200, 2: 150, 3: 0 });
    assert.equal(Object.values(l.envelopes).reduce((a, b) => a + b, 0), l.pot);
  });

  ok('withdrawable is capped at what you put in — never others’ money', () => {
    assert.equal(withdrawable(1, ids, legacy, fund, 1), 200);
    assert.equal(withdrawable(3, ids, legacy, fund, 1), 0);
    const after = [...fund, { id: 3, memberId: 1, kind: 'withdrawal' as const, amount: 200, at: '' }];
    assert.equal(withdrawable(1, ids, legacy, after, 1), 0);
    assert.equal(withdrawable(2, ids, legacy, after, 1), 150);
  });

  ok('pot refuses to pay a bill any participant cannot cover', () => {
    const dinner: LedgerExpense = { id: 9, amount: 300, paidBy: 'pot' };
    assert.deepEqual(potShortfalls(dinner, ids, legacy, fund, 1), [{ memberId: 3, short: 100 }]);
    const twoWay: LedgerExpense = { id: 9, amount: 300, paidBy: 'pot', splitWith: [1, 2] };
    assert.deepEqual(potShortfalls(twoWay, ids, legacy, fund, 1), []);
    const tooBig: LedgerExpense = { id: 9, amount: 500, paidBy: 'pot', splitWith: [1, 2] };
    assert.deepEqual(potShortfalls(tooBig, ids, legacy, fund, 1), [{ memberId: 1, short: 50 }, { memberId: 2, short: 100 }]);
  });

  ok('a pot-paid bill charges each participant’s envelope and creates no IOUs', () => {
    const l = summarizeLedger(ids, [{ id: 9, amount: 300, paidBy: 'pot', splitWith: [1, 2] }], fund, 1);
    assert.deepEqual(l.envelopes, { 1: 50, 2: 0, 3: 0 });
    assert.equal(l.pot, 50);
    assert.deepEqual(l.balances, { 1: 0, 2: 0, 3: 0 });
    assert.deepEqual(l.transfers, []);
  });

  ok('legacy rows default to the owner paying, split with everyone', () => {
    const l = summarizeLedger(ids, legacy, [], 1);
    assert.deepEqual(l.balances, { 1: 66.66, 2: -33.33, 3: -33.33 });
  });

  ok('balances net to zero and settle-up clears them in ≤ n−1 transfers', () => {
    const exps: LedgerExpense[] = [
      { id: 1, amount: 90, paidBy: 1 },
      { id: 2, amount: 45.5, paidBy: 2, splitWith: [2, 3] },
      { id: 3, amount: 12.34, paidBy: 3, splitWith: [1] },
    ];
    const l = summarizeLedger(ids, exps, [], 1);
    const net = Object.values(l.balances).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(net) < 1e-9, 'balances must net to zero');
    assert.ok(l.transfers.length <= ids.length - 1);
    const bal = { ...l.balances };
    for (const t of l.transfers) {
      bal[String(t.from)] = Math.round((bal[String(t.from)] + t.amount) * 100) / 100;
      bal[String(t.to)] = Math.round((bal[String(t.to)] - t.amount) * 100) / 100;
    }
    for (const v of Object.values(bal)) assert.equal(v, 0);
  });

  ok('recording a settlement as a transfer expense nets both sides', () => {
    const base: LedgerExpense[] = [{ id: 1, amount: 90, paidBy: 1 }];
    const [t] = summarizeLedger(ids, base, [], 1).transfers;
    const settled = [...base, { id: 2, amount: t.amount, paidBy: t.from, splitWith: [t.to] }];
    const l = summarizeLedger(ids, settled, [], 1);
    assert.equal(l.balances[String(t.from)], 0);
    assert.equal(l.transfers.length, 1);
  });

  ok('unknown members and empty books are harmless', () => {
    const l = summarizeLedger(ids, [{ id: 1, amount: 50, paidBy: 99, splitWith: [98] }], [{ id: 1, memberId: 42, kind: 'contribution', amount: 5, at: '' }], 1);
    assert.equal(l.pot, 0);
    assert.deepEqual(l.transfers, []);
    assert.deepEqual(settleUp({}), []);
    assert.deepEqual(summarizeLedger([], [], [], 1).envelopes, {});
  });
}

console.log(`\n${checks} checks passed.\n`);
