/* Cohive engine — ported from mikerivera33/rhyme-plus lib/engine.js + lib/seed.js (v2-universal-import).
   Tier-aware scoring (must/maybe/if-time), never-fail import scanner, Nest + Table demo data. */
(function () {
  'use strict';
  const PACE = { relaxed: { dwell: 1.3, maxSpots: 4 }, balanced: { dwell: 1.0, maxSpots: 6 }, packed: { dwell: 0.8, maxSpots: 8 } };
  const TRAVEL_KMH = 18, TRANSFER_BUFFER = 8;
  function haversineKm(a, b) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const travelMinutes = (a, b) => Math.round((haversineKm(a, b) / TRAVEL_KMH) * 60) + TRANSFER_BUFFER;
  // Tiered voting: must > maybe > if-time; votes and rating break ties.
  function score(s) {
    const tier = s.tier === 'must' ? 1000 : s.tier === 'maybe' ? 60 : s.tier === 'iftime' ? 10 : 0;
    return tier + (s.votes || 0) * 10 + (s.rating || 3) * 2;
  }
  function clusterByDay(spots, days) {
    if (spots.length === 0) return Array.from({ length: days }, () => []);
    const seeds = [spots[0]];
    while (seeds.length < Math.min(days, spots.length)) {
      let best = null, bestDist = -1;
      for (const s of spots) { const d = Math.min(...seeds.map((c) => haversineKm(s, c))); if (d > bestDist) { bestDist = d; best = s; } }
      seeds.push(best);
    }
    const clusters = seeds.map(() => []);
    const ranked = [...spots].sort((a, b) => score(b) - score(a));
    for (const s of ranked) {
      let bi = 0, bd = Infinity;
      seeds.forEach((seed, i) => { const d = haversineKm(s, seed) + clusters[i].length * 1.5; if (d < bd) { bd = d; bi = i; } });
      clusters[bi].push(s);
    }
    while (clusters.length < days) clusters.push([]);
    return clusters;
  }
  function orderRoute(cluster) {
    if (cluster.length <= 2) return cluster;
    const rest = [...cluster];
    rest.sort((a, b) => score(b) - score(a));
    const route = [rest.shift()];
    while (rest.length) {
      const last = route[route.length - 1];
      let bi = 0, bd = Infinity;
      rest.forEach((s, i) => { const d = haversineKm(last, s); if (d < bd) { bd = d; bi = i; } });
      route.push(rest.splice(bi, 1)[0]);
    }
    return route;
  }
  const fmt = (mins) => { const h = Math.floor(mins / 60) % 24, m = Math.round(mins % 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  function scheduleDay(cluster, opts, dayIndex) {
    const pace = PACE[opts.pace] || PACE.balanced;
    const startM = opts.startHour * 60, endM = opts.endHour * 60;
    const ordered = orderRoute(cluster);
    const route = ordered.slice(0, pace.maxSpots);
    const overflow = ordered.slice(pace.maxSpots);
    const lunchIdx = route.findIndex((s) => s.category === 'food');
    if (lunchIdx > 0) { const [lunch] = route.splice(lunchIdx, 1); const mid = Math.max(1, Math.floor(route.length / 2)); route.splice(mid, 0, lunch); }
    const items = [], warnings = [];
    let t = startM, prev = null, cost = 0;
    for (const spot of route) {
      const tm = prev ? travelMinutes(prev, spot) : 0;
      let arrive = t + tm;
      const waited = spot.open != null && arrive < spot.open * 60;
      if (waited) arrive = spot.open * 60;
      const dwell = Math.round((spot.duration || 60) * pace.dwell);
      if (spot.close != null && arrive >= spot.close * 60) { overflow.push(spot); continue; }
      if (arrive + dwell > endM) { overflow.push(spot); continue; }
      if (tm) items.push({ type: 'travel', minutes: tm, from: prev.name, to: spot.name });
      if (waited) warnings.push(spot.name + ' opens at ' + fmt(spot.open * 60) + ' — added a short wait.');
      if (spot.close != null && (arrive + dwell) > spot.close * 60) warnings.push(spot.name + ' closes at ' + fmt(spot.close * 60) + ' — visit may be cut short.');
      t = arrive;
      items.push({ type: 'visit', id: spot.id, name: spot.name, category: spot.category, start: fmt(t), end: fmt(t + dwell), minutes: dwell, cost: spot.cost || 0, lat: spot.lat, lng: spot.lng, tier: spot.tier || null, votes: spot.votes || 0, source: spot.source });
      cost += spot.cost || 0; t += dwell; prev = spot;
    }
    return { day: dayIndex + 1, items, warnings, cost, overflow };
  }
  function planTrip(spots, opts) {
    const active = spots.filter((s) => !s.skipped && s.category !== 'hotel');
    const clusters = clusterByDay(active, opts.days);
    const days = []; let carry = [];
    for (let i = 0; i < opts.days; i++) {
      const pool = [...carry, ...(clusters[i] || [])]; carry = [];
      const day = scheduleDay(pool, opts, i);
      carry = day.overflow; delete day.overflow; days.push(day);
    }
    return { days, unplaced: carry.map((s) => s.name), totalCost: days.reduce((a, d) => a + d.cost, 0), opts: { ...opts }, generatedAt: new Date().toISOString() };
  }

  /* ---- seed: Tokyo trip (verbatim from lib/seed.js, tiers mapped from mustDo/votes) ---- */
  let nid = 100;
  const sp = (name, category, lat, lng, o) => ({ id: nid++, name, category, lat, lng, duration: o.dur, cost: o.cost || 0, rating: o.rating || 4, open: o.open ?? null, close: o.close ?? null, source: o.source || 'manual', tier: o.tier || null, votes: o.votes || 0, note: o.note || '' });
  const tripSpots = [
    sp('Senso-ji Temple', 'sight', 35.7148, 139.7967, { dur: 75, open: 6, close: 17, rating: 5, tier: 'must', votes: 3, source: 'tiktok', note: 'Go early, Nakamise street gets packed' }),
    sp('Shibuya Crossing', 'sight', 35.6595, 139.7005, { dur: 40, rating: 5, tier: 'maybe', votes: 2, source: 'instagram' }),
    sp('Meiji Shrine', 'nature', 35.6764, 139.6993, { dur: 80, open: 5, close: 18, rating: 5, votes: 1, tier: 'maybe', source: 'instagram' }),
    sp('teamLab Planets', 'museum', 35.6491, 139.7898, { dur: 120, open: 9, close: 22, cost: 27, rating: 5, tier: 'must', votes: 4, source: 'tiktok', note: 'Book tickets ahead' }),
    sp('Tsukiji Outer Market', 'food', 35.6654, 139.7707, { dur: 90, open: 7, close: 14, cost: 20, rating: 5, votes: 2, tier: 'must', source: 'tiktok', note: 'Tamagoyaki + tuna bowls' }),
    sp('Shinjuku Gyoen', 'nature', 35.6852, 139.7100, { dur: 90, open: 9, close: 17.5, cost: 4, rating: 4, tier: 'iftime', source: 'maps' }),
    sp('Golden Gai', 'nightlife', 35.6944, 139.7046, { dur: 90, open: 19, close: 26, cost: 25, rating: 4, votes: 1, tier: 'maybe', source: 'instagram' }),
    sp('Akihabara Electric Town', 'shopping', 35.7022, 139.7745, { dur: 100, open: 10, close: 20, rating: 4, tier: 'iftime', source: 'maps' }),
    sp('Ueno Park & Museums', 'nature', 35.7156, 139.7745, { dur: 90, open: 5, close: 23, rating: 4, source: 'maps' }),
    sp('Nakameguro Canal', 'sight', 35.6440, 139.6982, { dur: 60, rating: 4, tier: 'maybe', source: 'instagram' }),
    sp('Takeshita Street', 'shopping', 35.6716, 139.7031, { dur: 60, open: 10, close: 20, cost: 15, rating: 3, tier: 'iftime', source: 'tiktok' }),
    sp('Ichiran Ramen Shibuya', 'food', 35.6613, 139.7003, { dur: 45, open: 10, close: 22, cost: 12, rating: 4, votes: 2, tier: 'maybe', source: 'tiktok' }),
    sp('Shinjuku Omoide Yokocho', 'food', 35.6934, 139.6995, { dur: 75, open: 17, close: 24, cost: 22, rating: 4, tier: 'maybe', source: 'instagram', note: 'Yakitori alley' }),
    sp('Tokyo Skytree', 'sight', 35.7101, 139.8107, { dur: 90, open: 10, close: 21, cost: 21, rating: 4, tier: 'iftime', source: 'maps' }),
    sp('Odaiba Seaside Park', 'nature', 35.6300, 139.7756, { dur: 70, rating: 3, source: 'maps' }),
  ];
  const trip = {
    id: 1, name: 'Tokyo Adventure', city: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503,
    startDate: '2026-09-01', days: 4, pace: 'balanced', startHour: 9, endHour: 21, budget: 2200, currency: 'USD',
    expenses: [
      { id: 1, label: 'Shibuya hotel (4 nights)', category: 'lodging', amount: 640 },
      { id: 2, label: 'Round-trip flights', category: 'transport', amount: 890 },
      { id: 3, label: '72h metro passes ×3', category: 'transport', amount: 45 },
    ],
  };
  const members = [
    { id: 1, name: 'You', color: '#F5A524' },
    { id: 2, name: 'Maya', color: '#A78BFA' },
    { id: 3, name: 'Ben', color: '#34D399' },
  ];
  const activity = [
    { who: 'Maya', what: 'moved teamLab Planets to Must-do', when: 'yesterday' },
    { who: 'Ben', what: 'imported 3 spots from a TikTok reel', when: 'yesterday' },
    { who: 'Maya', what: 'reacted 💍 to the Park Slope 2BR', when: '2 days ago' },
    { who: 'Ben', what: 'added Bonnie’s to Date Night', when: '3 days ago' },
  ];
  const gazetteer = [
    ...tripSpots.map((s) => ({ name: s.name, category: s.category, lat: s.lat, lng: s.lng, duration: s.duration, cost: s.cost, open: s.open, close: s.close, city: 'Tokyo' })),
    { name: 'Ghibli Museum', category: 'museum', lat: 35.6962, lng: 139.5704, duration: 120, cost: 10, open: 10, close: 18, city: 'Tokyo' },
    { name: 'Roppongi Hills', category: 'shopping', lat: 35.6605, lng: 139.7292, duration: 90, cost: 0, open: 11, close: 21, city: 'Tokyo' },
    { name: 'Sushi Dai', category: 'food', lat: 35.6459, lng: 139.7854, duration: 60, cost: 40, open: 6, close: 14, city: 'Tokyo' },
    { name: 'Yoyogi Park', category: 'nature', lat: 35.6712, lng: 139.6949, duration: 70, cost: 0, open: null, close: null, city: 'Tokyo' },
    { name: 'Kappabashi Street', category: 'shopping', lat: 35.7136, lng: 139.7885, duration: 60, cost: 0, open: 10, close: 17, city: 'Tokyo' },
    { name: 'Shimokitazawa', category: 'shopping', lat: 35.6613, lng: 139.6681, duration: 100, cost: 0, open: null, close: null, city: 'Tokyo' },
    { name: 'Tokyo Tower', category: 'sight', lat: 35.6586, lng: 139.7454, duration: 75, cost: 12, open: 9, close: 22.5, city: 'Tokyo' },
    { name: 'Daikanyama T-Site', category: 'shopping', lat: 35.6486, lng: 139.7030, duration: 60, cost: 0, open: 9, close: 22, city: 'Tokyo' },
    { name: 'Afuri Ramen Ebisu', category: 'food', lat: 35.6467, lng: 139.7101, duration: 45, cost: 11, open: 11, close: 23, city: 'Tokyo' },
    { name: 'Nezu Museum', category: 'museum', lat: 35.6622, lng: 139.7175, duration: 80, cost: 9, open: 10, close: 17, city: 'Tokyo' },
  ];

  /* ---- Nest: NYC apartment hunt ---- */
  const nest = [
    { id: 1, title: 'Sunny 2BR in Park Slope', price: 3850, beds: 2, baths: 1, sqft: 850, hood: 'Park Slope', lat: 40.6710, lng: -73.9814, source: 'zillow', note: 'Top floor, W/D in unit, pets ok', reactions: { '💍': ['You', 'Maya'], '🪴': [] }, tagged: null },
    { id: 2, title: 'Greenpoint loft, skyline view', price: 4200, beds: 1, baths: 1, sqft: 780, hood: 'Greenpoint', lat: 40.7304, lng: -73.9515, source: 'streeteasy', note: '14ft ceilings, roof deck', reactions: { '💍': [], '🪴': ['Maya'] }, tagged: null },
    { id: 3, title: 'Astoria 2BR near the park', price: 2975, beds: 2, baths: 1, sqft: 900, hood: 'Astoria', lat: 40.7644, lng: -73.9235, source: 'zillow', note: 'Renovated kitchen, 2 blocks to N/W', reactions: { '💍': ['Maya'], '🪴': ['You'] }, tagged: null },
    { id: 4, title: 'Fort Greene brownstone floor-through', price: 4650, beds: 2, baths: 1.5, sqft: 1050, hood: 'Fort Greene', lat: 40.6892, lng: -73.9742, source: 'instagram', note: 'Original details, garden access', reactions: { '💍': [], '🪴': [] }, tagged: 'Maya tagged you — “the one with the mantel 👀”' },
    { id: 5, title: 'LIC high-rise 1BR + den', price: 3600, beds: 1, baths: 1, sqft: 720, hood: 'Long Island City', lat: 40.7447, lng: -73.9485, source: 'zillow', note: 'Gym + doorman, den fits a desk', reactions: { '💍': [], '🪴': ['You'] }, tagged: null },
  ];

  /* ---- Table: date-night list, NYC ---- */
  const table = [
    { id: 1, name: 'Via Carota', cuisine: 'Italian', mood: 'Cozy', price: '$$$', hood: 'West Village', lat: 40.7331, lng: -74.0036, hours: '5–11 pm', tried: true, tier: 'must' },
    { id: 2, name: 'Lilia', cuisine: 'Italian', mood: 'Buzzy', price: '$$$', hood: 'Williamsburg', lat: 40.7178, lng: -73.9527, hours: '5:30–11 pm', tried: false, tier: 'must' },
    { id: 3, name: 'Atomix', cuisine: 'Korean tasting', mood: 'Occasion', price: '$$$$', hood: 'NoMad', lat: 40.7443, lng: -73.9843, hours: 'Seatings 5 & 8:30', tried: false, tier: 'maybe' },
    { id: 4, name: 'Dhamaka', cuisine: 'Indian', mood: 'Bold', price: '$$', hood: 'Lower East Side', lat: 40.7183, lng: -73.9878, hours: '5:30 pm–12 am', tried: true, tier: 'maybe' },
    { id: 5, name: 'Frenchette', cuisine: 'French', mood: 'Lively', price: '$$$', hood: 'Tribeca', lat: 40.7195, lng: -74.0089, hours: '5–10:30 pm', tried: false, tier: 'iftime' },
    { id: 6, name: 'Bonnie’s', cuisine: 'Cantonese-American', mood: 'Fun', price: '$$', hood: 'Williamsburg', lat: 40.7145, lng: -73.9425, hours: '5:30–11 pm', tried: false, tier: 'maybe' },
    { id: 7, name: 'Rezdôra', cuisine: 'Italian', mood: 'Cozy', price: '$$$', hood: 'Flatiron', lat: 40.7398, lng: -73.9891, hours: '5–10 pm', tried: true, tier: 'iftime' },
    { id: 8, name: 'Double Chicken Please', cuisine: 'Cocktail bar', mood: 'Fun', price: '$$', hood: 'Lower East Side', lat: 40.7157, lng: -73.9860, hours: '5 pm–2 am', tried: false, tier: 'maybe' },
  ];

  /* ---- Never-fail import scanner ----
     Order: exact gazetteer hit (97%) → proper-noun mining with category keywords (62–88%) →
     URL slug mining (61%) → concierge assist near the hive's city (55%). Always ≥1 candidate. */
  const CATS = [
    [/ramen|sushi|omakase|cafe|coffee|bakery|market|izakaya|taco|pizza|restaurant|brunch|dinner|eat/i, 'food'],
    [/museum|gallery|exhibit|teamlab/i, 'museum'],
    [/temple|shrine|tower|bridge|crossing|castle|cathedral|viewpoint|lookout/i, 'sight'],
    [/park|garden|beach|trail|forest|falls|onsen/i, 'nature'],
    [/bar|club|speakeasy|jazz|rooftop|nightlife/i, 'nightlife'],
    [/shop|store|street|vintage|thrift|mall|arcade/i, 'shopping'],
  ];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; };
  function catFor(text) { for (const [re, c] of CATS) if (re.test(text)) return c; return 'sight'; }
  function detectSource(text) {
    const u = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
    if (/tiktok/i.test(u)) return 'tiktok';
    if (/instagr/i.test(u)) return 'instagram';
    if (/youtu/i.test(u)) return 'youtube';
    if (/zillow|streeteasy|realtor|redfin|apartments\./i.test(u)) return 'listing';
    if (/opentable|resy|yelp/i.test(u)) return 'dining';
    if (u) return 'web';
    return 'note';
  }
  function mkCandidate(name, text, ctx, conf) {
    const h = hash(name.toLowerCase());
    return {
      name, category: catFor(name + ' ' + text),
      lat: ctx.lat + ((h % 1000) / 1000) * 0.045 - 0.0225,
      lng: ctx.lng + (((h >> 10) % 1000) / 1000) * 0.055 - 0.0275,
      duration: 60, cost: 0, open: null, close: null, confidence: conf, matched: 'inferred',
    };
  }
  function scanImport(text, ctx) {
    const source = detectSource(text);
    const lower = text.toLowerCase();
    let out = [];
    for (const g of gazetteer) if (lower.includes(g.name.toLowerCase())) out.push({ ...g, confidence: 97, matched: 'exact' });
    if (!out.length) {
      const stop = /^(The|You|We|My|Our|This|That|Have|Just|And|But|For|With|From|Watch|Check|Trust|Me|Best|Top|Day|POV|OMG|If|So|It|Go|Get|New|Here|Hidden|Gems?)$/i;
      const seen = new Set();
      const phrases = [...text.replace(/https?:\/\/\S+/g, ' ').matchAll(/([A-Z][\w’'&-]+(?:\s+[A-Z][\w’'&-]+){0,3})/g)]
        .map((m) => m[1].trim())
        .filter((p) => p.length > 3 && !stop.test(p) && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
      for (const p of phrases.slice(0, 3)) {
        const kw = CATS.some(([re]) => re.test(p));
        out.push(mkCandidate(p, text, ctx, kw ? 84 : 68));
      }
    }
    if (!out.length) {
      const slug = ((text.match(/https?:\/\/[^\s]+/) || [])[0] || '').split('/').filter(Boolean).pop() || '';
      const words = slug.replace(/[?#].*$/, '').replace(/[-_+]+/g, ' ').replace(/\.\w+$/, '').trim();
      if (words && !/^\d+$/.test(words) && words.length > 3) {
        const name = words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 48);
        out.push(mkCandidate(name, text, ctx, 61));
      }
    }
    if (!out.length) out.push({ ...mkCandidate('Concierge pick — ' + (ctx.city || 'nearby'), text, ctx, 55), matched: 'assist' });
    return { source, candidates: out.slice(0, 4) };
  }

  function buildIcs(plan, trip) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cohive//Bucketlist//EN'];
    const d0 = new Date(trip.startDate + 'T00:00:00');
    plan.days.forEach((day, i) => {
      const date = new Date(d0); date.setDate(d0.getDate() + i);
      const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
      day.items.filter((it) => it.type === 'visit').forEach((it, j) => {
        lines.push('BEGIN:VEVENT', 'UID:cohive-' + i + '-' + j + '@cohive.app',
          'DTSTART:' + ymd + 'T' + it.start.replace(':', '') + '00',
          'DTEND:' + ymd + 'T' + it.end.replace(':', '') + '00',
          'SUMMARY:' + it.name + (it.tier === 'must' ? ' ★' : ''), 'END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function planAsText(plan, trip) {
    let s = trip.name + ' — Cohive itinerary\n';
    plan.days.forEach((d) => {
      s += '\nDay ' + d.day + ' — $' + d.cost + '\n';
      d.items.forEach((it) => {
        s += it.type === 'travel' ? '   ↓ ' + it.minutes + ' min\n' : it.start + '–' + it.end + '  ' + it.name + (it.tier === 'must' ? ' ★' : '') + '\n';
      });
    });
    return s;
  }

  window.Cohive = { planTrip, scanImport, buildIcs, planAsText, haversineKm, seed: { trip, spots: tripSpots, members, activity, nest, table } };
  window.dispatchEvent(new Event('cohive-ready'));
})();
