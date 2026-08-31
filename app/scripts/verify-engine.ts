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

console.log(`\n${checks} checks passed.\n`);
