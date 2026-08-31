/**
 * Browser stress test — endurance and abuse pass. Run like scripts/smoke.mjs:
 *
 *   PLAYWRIGHT=$(npm root -g)/playwright node scripts/stress-browser.mjs http://127.0.0.1:4173
 *
 * Cycles the whole app hard (tab churn, map create/destroy, scan+add floods,
 * vote/theme/sheet spam, oversized inputs) while watching the JS heap and DOM
 * node count over time and failing on any console error or runaway growth.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw;

const BASE = process.argv[2] || 'http://localhost:4173';
const errors = [];
const appErrors = () => errors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
const fails = [];
let passed = 0;

const check = async (label, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (e) {
    fails.push(label);
    console.log('  ✗ ' + label + ' — ' + e.message.split('\n')[0]);
  }
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.enable');

async function metrics() {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(250);
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const get = (n) => m.find((x) => x.name === n)?.value ?? 0;
  return { heapMB: get('JSHeapUsedSize') / 1048576, nodes: get('Nodes'), listeners: get('JSEventListeners') };
}

const tabBtn = (name) => page.getByRole('button', { name: new RegExp(name) }).last();
const has = async (t) => {
  if ((await page.getByText(t, { exact: false }).count()) === 0) throw new Error(`"${t}" not found`);
};

await page.goto(BASE + '/?start=app', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('\nendurance — tab churn with live maps');

// Warm up, then measure growth across sustained churn.
const TABS = ['Hive', 'Trip', 'Nest', 'Table', 'You'];
for (let i = 0; i < 5; i++) for (const t of TABS) { await tabBtn(t).click(); await page.waitForTimeout(60); }
const base1 = await metrics();
console.log(`      after warm-up: heap ${base1.heapMB.toFixed(1)}MB · ${base1.nodes} nodes · ${base1.listeners} listeners`);

await check('45 more full tab cycles run clean', async () => {
  for (let i = 0; i < 45; i++) for (const t of TABS) { await tabBtn(t).click(); await page.waitForTimeout(35); }
  if (appErrors().length) throw new Error('console errors during churn: ' + appErrors()[0]);
});

await check('heap, DOM nodes and listeners do not run away', async () => {
  const end = await metrics();
  console.log(`      after 50 cycles: heap ${end.heapMB.toFixed(1)}MB · ${end.nodes} nodes · ${end.listeners} listeners`);
  if (end.heapMB > base1.heapMB * 2 + 20) throw new Error(`heap ${base1.heapMB.toFixed(1)} -> ${end.heapMB.toFixed(1)}MB`);
  if (end.nodes > base1.nodes * 1.6 + 500) throw new Error(`nodes ${base1.nodes} -> ${end.nodes}`);
  if (end.listeners > base1.listeners * 2 + 200) throw new Error(`listeners ${base1.listeners} -> ${end.listeners}`);
});

await check('exactly one live Leaflet map after churn', async () => {
  await tabBtn('Hive').click();
  await page.waitForTimeout(500);
  const n = await page.locator('.leaflet-container').count();
  if (n !== 1) throw new Error(n + ' leaflet containers in DOM');
});

console.log('\nscan + add flood');
await check('8 scans back-to-back, adding every candidate', async () => {
  await tabBtn('Trip').click();
  await page.waitForTimeout(300);
  const captions = [
    'you HAVE to try Afuri Ramen Ebisu and Nezu Museum',
    'Sushi Dai then Yoyogi Park then Kappabashi Street',
    'Ghibli Museum is magical, also Roppongi Hills at night',
    'Blue Bottle Kiyosumi best coffee, Golden Temple Annex viewpoint',
    'https://www.tiktok.com/@x/video/hidden-izakaya-alley-guide',
    'Daikanyama T-Site and Shimokitazawa vintage shops',
    'Harbor View Lookout sunset spot, Meguro Sky Garden',
    'Tokyo Tower 🍜 Shibuya Crossing 🍣 teamLab Planets',
  ];
  for (const cap of captions) {
    await page.locator('textarea').fill(cap);
    await page.getByRole('button', { name: 'Scan & detect' }).click();
    await page.waitForTimeout(1400);
    const adds = page.getByRole('button', { name: 'Add', exact: true });
    const n = await adds.count();
    for (let i = 0; i < n; i++) { await adds.first().click(); await page.waitForTimeout(120); }
  }
  const counter = await page.getByText('spots saved').innerText();
  const total = parseInt((counter.match(/(\d+) spots saved/) || [])[1], 10);
  console.log('      trip now holds ' + total + ' spots');
  if (!(total > 25)) throw new Error('flood only reached ' + counter);
});

await check('vote spam across the flooded list', async () => {
  await page.getByRole('button', { name: 'Spots', exact: true }).click();
  await page.waitForTimeout(400);
  const musts = page.getByRole('button', { name: 'Must ★' });
  const n = Math.min(await musts.count(), 12);
  for (let i = 0; i < n; i++) { await musts.nth(i).click(); await page.waitForTimeout(60); }
  const maybes = page.getByRole('button', { name: 'Maybe', exact: true });
  for (let i = 0; i < 6; i++) { await maybes.nth(i).click(); await maybes.nth(i).click(); await page.waitForTimeout(40); }
  if (appErrors().length) throw new Error('console error during vote spam: ' + appErrors()[0]);
});

console.log('\nitinerary under load');
await check('double-tapping Generate runs exactly one build', async () => {
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('Days').fill('999');
  const gen = page.getByRole('button', { name: /itinerary$/i });
  await gen.click();
  await gen.click({ force: true });
  await gen.click({ force: true });
  await page.waitForTimeout(3800);
  const ready = await page.getByText('Itinerary ready').count();
  await has('DAY 1');
});
await check('Days=999 clamps to a 10-day plan', async () => {
  await has('DAY 10');
  if (await page.getByText('DAY 11', { exact: true }).count()) throw new Error('DAY 11 rendered');
});
await check('flooded packed regeneration stays correct', async () => {
  await page.getByLabel('Days').fill('4');
  await page.getByLabel('Pace').selectOption('packed');
  await page.getByRole('button', { name: /itinerary$/i }).click();
  await page.waitForTimeout(3600);
  await has('DAY 4');
  if (await page.getByText('DAY 5', { exact: true }).count()) throw new Error('DAY 5 rendered');
  const times = await page.getByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/).count();
  console.log('      ' + times + ' timed slots across 4 packed days');
  if (times < 12) throw new Error('only ' + times + ' timed slots');
});

console.log('\nui abuse');
await check('20 rapid theme flips', async () => {
  for (let i = 0; i < 20; i++) { await page.getByLabel('Toggle theme').click(); await page.waitForTimeout(40); }
  const cls = await page.locator('.cv').first().getAttribute('class');
  if (cls.includes('light')) await page.getByLabel('Toggle theme').click();
  if (appErrors().length) throw new Error('console error during theme spam: ' + appErrors()[0]);
});
await check('15 pricing sheet open/close cycles', async () => {
  await tabBtn('You').click();
  await page.waitForTimeout(400);
  for (let i = 0; i < 15; i++) {
    await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  if (await page.getByText('Honest pricing').count()) throw new Error('sheet stuck open');
});
await check('oversized emoji caption still resolves', async () => {
  await tabBtn('Trip').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill('🍜🍣🗼💍🪴'.repeat(2000));
  await page.getByRole('button', { name: 'Scan & detect' }).click();
  await page.waitForTimeout(1600);
  await has('Detected via');
  await has('Concierge pick');
});
await check('long hive/member names do not break layout', async () => {
  await page.getByRole('button', { name: 'Crew', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder('Invite — e.g. Alex').fill('Maximiliano Bartholomew von Hexagonstein III 🐝');
  await page.getByRole('button', { name: 'Add member' }).click();
  await page.waitForTimeout(300);
  await has('Maximiliano Bartholomew');
  const overflow = await page.evaluate(() => {
    const m = document.getElementById('cv-scroll');
    return m.scrollWidth - m.clientWidth;
  });
  if (overflow > 2) throw new Error('horizontal overflow: ' + overflow + 'px');
});

await check('final heap after full stress stays bounded', async () => {
  const end = await metrics();
  console.log(`      final: heap ${end.heapMB.toFixed(1)}MB · ${end.nodes} nodes · ${end.listeners} listeners`);
  if (end.heapMB > 120) throw new Error('heap ' + end.heapMB.toFixed(1) + 'MB');
});

await browser.close();

const finalErrors = appErrors();
console.log(`\n${passed} passed, ${fails.length} failed, ${finalErrors.length} console errors`);
finalErrors.slice(0, 10).forEach((e) => console.log('  ! ' + e));
if (fails.length || finalErrors.length) process.exit(1);
