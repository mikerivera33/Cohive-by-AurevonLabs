/**
 * Cohive engine — ported from mikerivera33/rhyme-plus `lib/engine.js` (v2-universal-import).
 *
 * The scheduling maths (geographic day clustering, nearest-neighbour routing, real
 * clock times, opening-hours checks, meal slotting) is carried over verbatim; only
 * the module shape and types are new. Tier-aware scoring (must/maybe/if-time) is the
 * Cohive extension on top.
 */
import { sanitizeImportText } from '../lib/sanitize';
import { clampLat, clampLng } from '../lib/coords';
import { gazetteer } from './seed';
import type {
  Category,
  LatLng,
  PlanDay,
  PlanItem,
  PlanOpts,
  ScanCandidate,
  ScanContext,
  ScanResult,
  ScanSource,
  Spot,
  Trip,
  TripPlan,
} from '../types';

const PACE: Record<string, { dwell: number; maxSpots: number }> = {
  relaxed: { dwell: 1.3, maxSpots: 4 },
  balanced: { dwell: 1.0, maxSpots: 6 },
  packed: { dwell: 0.8, maxSpots: 8 },
};

const TRAVEL_KMH = 18;
const TRANSFER_BUFFER = 8;
/** Hard caps so adversarial / fuzzed inputs cannot explode clustering cost. */
const MAX_PLAN_DAYS = 14;
const MAX_PLAN_SPOTS = 400;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const lat1 = clampLat(a.lat);
  const lng1 = clampLng(a.lng);
  const lat2 = clampLat(b.lat);
  const lng2 = clampLng(b.lng);
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const out = 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, s))));
  return Number.isFinite(out) ? out : 0;
}

const travelMinutes = (a: LatLng, b: LatLng) =>
  Math.round((haversineKm(a, b) / TRAVEL_KMH) * 60) + TRANSFER_BUFFER;

/** Tiered voting: must > maybe > if-time; votes and rating break ties. */
function score(s: Spot): number {
  const tier =
    s.tier === 'must' ? 1000 : s.tier === 'maybe' ? 60 : s.tier === 'iftime' ? 10 : 0;
  return tier + (s.votes || 0) * 10 + (s.rating || 3) * 2;
}

function clusterByDay(spots: Spot[], days: number): Spot[][] {
  if (spots.length === 0) return Array.from({ length: days }, () => []);
  const seeds: Spot[] = [spots[0]];
  while (seeds.length < Math.min(days, spots.length)) {
    let best: Spot | null = null;
    let bestDist = -1;
    for (const s of spots) {
      const d = Math.min(...seeds.map((c) => haversineKm(s, c)));
      if (d > bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (!best) break;
    seeds.push(best);
  }
  const clusters: Spot[][] = seeds.map(() => []);
  const ranked = [...spots].sort((a, b) => score(b) - score(a));
  for (const s of ranked) {
    let bi = 0;
    let bd = Infinity;
    seeds.forEach((seed, i) => {
      // The length term spreads spots out instead of piling them on one day.
      const d = haversineKm(s, seed) + clusters[i].length * 1.5;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    clusters[bi].push(s);
  }
  while (clusters.length < days) clusters.push([]);
  return clusters;
}

function orderRoute(cluster: Spot[]): Spot[] {
  if (cluster.length <= 2) return cluster;
  const rest = [...cluster];
  rest.sort((a, b) => score(b) - score(a));
  const route = [rest.shift() as Spot];
  while (rest.length) {
    const last = route[route.length - 1];
    let bi = 0;
    let bd = Infinity;
    rest.forEach((s, i) => {
      const d = haversineKm(last, s);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    route.push(rest.splice(bi, 1)[0]);
  }
  return route;
}

const fmt = (mins: number): string => {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};

interface ScheduledDay extends PlanDay {
  overflow: Spot[];
}

function scheduleDay(cluster: Spot[], opts: PlanOpts, dayIndex: number): ScheduledDay {
  const pace = PACE[opts.pace] || PACE.balanced;
  const startM = opts.startHour * 60;
  const endM = opts.endHour * 60;
  const ordered = orderRoute(cluster);
  const route = ordered.slice(0, pace.maxSpots);
  const overflow = ordered.slice(pace.maxSpots);

  // Slot the first food stop into the middle of the day rather than the front.
  const lunchIdx = route.findIndex((s) => s.category === 'food');
  if (lunchIdx > 0) {
    const [lunch] = route.splice(lunchIdx, 1);
    const mid = Math.max(1, Math.floor(route.length / 2));
    route.splice(mid, 0, lunch);
  }

  const items: PlanItem[] = [];
  const warnings: string[] = [];
  let t = startM;
  let prev: Spot | null = null;
  let cost = 0;

  for (const spot of route) {
    const tm = prev ? travelMinutes(prev, spot) : 0;
    let arrive = t + tm;
    const waited = spot.open != null && arrive < spot.open * 60;
    if (waited) arrive = (spot.open as number) * 60;
    const dwell = Math.round((spot.duration || 60) * pace.dwell);

    if (spot.close != null && arrive >= spot.close * 60) {
      overflow.push(spot);
      continue;
    }
    if (arrive + dwell > endM) {
      overflow.push(spot);
      continue;
    }

    if (tm && prev) items.push({ type: 'travel', minutes: tm, from: prev.name, to: spot.name });
    if (waited) {
      warnings.push(
        spot.name + ' opens at ' + fmt((spot.open as number) * 60) + ' — added a short wait.'
      );
    }
    if (spot.close != null && arrive + dwell > spot.close * 60) {
      warnings.push(
        spot.name + ' closes at ' + fmt(spot.close * 60) + ' — visit may be cut short.'
      );
    }

    t = arrive;
    items.push({
      type: 'visit',
      id: spot.id,
      name: spot.name,
      category: spot.category,
      start: fmt(t),
      end: fmt(t + dwell),
      minutes: dwell,
      cost: spot.cost || 0,
      lat: spot.lat,
      lng: spot.lng,
      tier: spot.tier || null,
      votes: spot.votes || 0,
      source: spot.source,
    });
    cost += spot.cost || 0;
    t += dwell;
    prev = spot;
  }

  return { day: dayIndex + 1, items, warnings, cost, overflow };
}

export function planTrip(spots: Spot[], opts: PlanOpts): TripPlan {
  const days = Math.max(1, Math.min(MAX_PLAN_DAYS, Math.floor(Number(opts.days) || 1)));
  const pace = opts.pace === 'relaxed' || opts.pace === 'packed' ? opts.pace : 'balanced';
  const startHour = Number.isFinite(opts.startHour) ? opts.startHour : 9;
  const endHour = Number.isFinite(opts.endHour) ? opts.endHour : 21;
  const safeOpts: PlanOpts = { days, pace, startHour, endHour };

  const active = spots
    .filter((s) => !s.skipped && s.category !== 'hotel')
    .slice(0, MAX_PLAN_SPOTS)
    .map((s) => ({
      ...s,
      lat: clampLat(s.lat),
      lng: clampLng(s.lng),
      duration: Number.isFinite(s.duration) ? Math.max(0, Math.min(24 * 60, s.duration)) : 60,
      cost: Number.isFinite(s.cost) ? Math.max(0, s.cost) : 0,
    }));
  const clusters = clusterByDay(active, days);
  const planDays: PlanDay[] = [];
  // Carry only ids between days so overflow Spot refs do not pin the full
  // input array alive across long solve loops (stress / batch planning).
  let carryIds: number[] = [];
  const byId = new Map(active.map((s) => [s.id, s]));

  for (let i = 0; i < days; i++) {
    const carried = carryIds.map((id) => byId.get(id)).filter((s): s is Spot => !!s);
    const pool = carried.concat(clusters[i] || []);
    const scheduled = scheduleDay(pool, safeOpts, i);
    carryIds = scheduled.overflow.map((s) => s.id);
    planDays.push({
      day: scheduled.day,
      items: scheduled.items,
      warnings: scheduled.warnings,
      cost: scheduled.cost,
    });
  }

  const unplaced = carryIds.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);

  return {
    days: planDays,
    unplaced,
    totalCost: planDays.reduce((a, d) => a + d.cost, 0),
    opts: { days, pace, startHour, endHour },
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Never-fail import scanner
 *
 * Order: exact gazetteer hit (97%) → proper-noun mining with category
 * keywords (62–88%) → URL slug mining (61%) → concierge assist near the
 * hive's city (55%). Always returns at least one candidate — the scanner
 * never dead-ends on "destination not found".
 * ------------------------------------------------------------------ */

const CATS: [RegExp, Category][] = [
  [
    /ramen|sushi|omakase|cafe|coffee|bakery|market|izakaya|taco|pizza|restaurant|brunch|dinner|eat/i,
    'food',
  ],
  [/museum|gallery|exhibit|teamlab/i, 'museum'],
  [/temple|shrine|tower|bridge|crossing|castle|cathedral|viewpoint|lookout/i, 'sight'],
  [/park|garden|beach|trail|forest|falls|onsen/i, 'nature'],
  [/bar|club|speakeasy|jazz|rooftop|nightlife/i, 'nightlife'],
  [/shop|store|street|vintage|thrift|mall|arcade/i, 'shopping'],
];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
};

function catFor(text: string): Category {
  for (const [re, c] of CATS) if (re.test(text)) return c;
  return 'sight';
}

function detectSource(text: string): ScanSource {
  const u = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
  if (/tiktok/i.test(u)) return 'tiktok';
  if (/instagr/i.test(u)) return 'instagram';
  if (/youtu/i.test(u)) return 'youtube';
  if (/zillow|streeteasy|realtor|redfin|apartments\./i.test(u)) return 'listing';
  if (/opentable|resy|yelp/i.test(u)) return 'dining';
  if (u) return 'web';
  return 'note';
}

/** Lowercased gazetteer names — built once so scan loops do not re-lowercase. */
const gazetteerLower = gazetteer.map((g) => ({
  entry: g,
  needle: g.name.toLowerCase(),
}));

function mkCandidate(
  name: string,
  text: string,
  ctx: ScanContext,
  conf: number
): ScanCandidate {
  const h = hash(name.toLowerCase());
  const baseLat = clampLat(ctx.lat);
  const baseLng = clampLng(ctx.lng);
  return {
    name,
    category: catFor(name + ' ' + text),
    // Deterministic jitter around the hive's city until real geocoding lands.
    lat: clampLat(baseLat + ((h % 1000) / 1000) * 0.045 - 0.0225),
    lng: clampLng(baseLng + (((h >> 10) % 1000) / 1000) * 0.055 - 0.0275),
    duration: 60,
    cost: 0,
    open: null,
    close: null,
    confidence: conf,
    matched: 'inferred',
  };
}

export function scanImport(rawText: string, ctx: ScanContext): ScanResult {
  // Sanitize on ingest — strip markup / dangerous schemes before any matching.
  const text = sanitizeImportText(rawText);
  const source = detectSource(text);
  const lower = text.toLowerCase();
  const out: ScanCandidate[] = [];
  // Short category probe string — avoid retaining the full paste in candidates.
  const catProbe = text.slice(0, 280);
  const safeCtx: ScanContext = {
    city: String(ctx.city || '').slice(0, 80),
    lat: clampLat(ctx.lat),
    lng: clampLng(ctx.lng),
  };

  // Pre-lowercased needles — avoid re-allocating on every scan in long loops.
  for (const { entry: g, needle } of gazetteerLower) {
    if (lower.includes(needle)) {
      out.push({
        name: g.name,
        category: g.category,
        lat: clampLat(g.lat),
        lng: clampLng(g.lng),
        duration: g.duration,
        cost: g.cost,
        open: g.open,
        close: g.close,
        city: g.city,
        confidence: 97,
        matched: 'exact',
      });
      if (out.length >= 4) break;
    }
  }

  if (!out.length) {
    const stop =
      /^(The|You|We|My|Our|This|That|Have|Just|And|But|For|With|From|Watch|Check|Trust|Me|Best|Top|Day|POV|OMG|If|So|It|Go|Get|New|Here|Hidden|Gems?)$/i;
    const seen = new Set<string>();
    const stripped = text.replace(/https?:\/\/\S+/g, ' ');
    const phrases: string[] = [];
    for (const m of stripped.matchAll(/([A-Z][\w’'&-]+(?:\s+[A-Z][\w’'&-]+){0,3})/g)) {
      const p = m[1].trim();
      if (p.length > 3 && !stop.test(p) && !seen.has(p.toLowerCase())) {
        seen.add(p.toLowerCase());
        phrases.push(p);
        if (phrases.length >= 3) break;
      }
    }
    for (const p of phrases) {
      const kw = CATS.some(([re]) => re.test(p));
      out.push(mkCandidate(p, catProbe, safeCtx, kw ? 84 : 68));
    }
  }

  if (!out.length) {
    const slug = ((text.match(/https?:\/\/[^\s]+/) || [])[0] || '').split('/').filter(Boolean).pop() || '';
    const words = slug
      .replace(/[?#].*$/, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\.\w+$/, '')
      .trim();
    if (words && !/^\d+$/.test(words) && words.length > 3) {
      const name = words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 48);
      out.push(mkCandidate(name, catProbe, safeCtx, 61));
    }
  }

  if (!out.length) {
    out.push({
      ...mkCandidate('Concierge pick — ' + (safeCtx.city || 'nearby'), catProbe, safeCtx, 55),
      matched: 'assist',
    });
  }

  return { source, candidates: out.slice(0, 4) };
}

export function buildIcs(plan: TripPlan, trip: Trip): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cohive//Bucketlist//EN'];
  const d0 = new Date(trip.startDate + 'T00:00:00');
  plan.days.forEach((day, i) => {
    const date = new Date(d0);
    date.setDate(d0.getDate() + i);
    const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
    day.items
      .filter((it): it is Extract<PlanItem, { type: 'visit' }> => it.type === 'visit')
      .forEach((it, j) => {
        lines.push(
          'BEGIN:VEVENT',
          'UID:cohive-' + i + '-' + j + '@cohive.app',
          'DTSTART:' + ymd + 'T' + it.start.replace(':', '') + '00',
          'DTEND:' + ymd + 'T' + it.end.replace(':', '') + '00',
          'SUMMARY:' + it.name + (it.tier === 'must' ? ' ★' : ''),
          'END:VEVENT'
        );
      });
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function planAsText(plan: TripPlan, trip: Trip): string {
  let s = trip.name + ' — Cohive itinerary\n';
  plan.days.forEach((d) => {
    s += '\nDay ' + d.day + ' — $' + d.cost + '\n';
    d.items.forEach((it) => {
      s +=
        it.type === 'travel'
          ? '   ↓ ' + it.minutes + ' min\n'
          : it.start + '–' + it.end + '  ' + it.name + (it.tier === 'must' ? ' ★' : '') + '\n';
    });
  });
  return s;
}
