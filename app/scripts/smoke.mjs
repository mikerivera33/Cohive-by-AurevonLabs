/**
 * End-to-end smoke test — walks every flow in a real browser and fails on any
 * console error. Playwright is not a project dependency; point at an install:
 *
 *   npm run build && npx vite preview --port 4173 &
 *   PLAYWRIGHT=$(npm root -g)/playwright node scripts/smoke.mjs http://127.0.0.1:4173
 *
 * CHROMIUM=/path/to/chrome overrides the browser binary.
 *
 * Note: map tiles come from a CDN. Where that is unreachable the tile images
 * fail to paint, so the map assertions check Leaflet initialisation and the
 * locally-rendered marker pins rather than loaded tiles.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = require(pwPath);
const { chromium } = pw;

const BASE = process.argv[2] || 'http://localhost:4173';
const errors = [];
const fails = [];
let passed = 0;

const check = async (label, fn) => {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (e) {
    fails.push(label + ' — ' + e.message);
    console.log('  ✗ ' + label + ' — ' + e.message);
  }
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const has = async (text) => {
  const n = await page.getByText(text, { exact: false }).count();
  if (n === 0) throw new Error(`"${text}" not found`);
};
const tap = async (name) => {
  await page.getByRole('button', { name, exact: false }).first().click();
  await page.waitForTimeout(220);
};

console.log('\nonboarding');
await page.goto(BASE + '/?start=onboarding', { waitUntil: 'networkidle' });
await check('gateway renders', () => has('Your hive'));
await check('gateway offers Google', () => has('Continue with Google'));
await check('gateway offers Apple', () => has('Continue with Apple'));
await check('gateway offers email/phone', () => has('Start with email / phone'));
await check('create session via Apple', async () => {
  await tap('Continue with Apple');
  await has('Every idea,');
});
await check('advance to slide 2', async () => { await tap('Continue'); await has('Decide without'); });
await check('advance to slide 3', async () => { await tap('Continue'); await has('From shortlist'); });
await check('create hive step', async () => { await tap('Continue'); await has('Name your'); });
await check('hive kind chips select', async () => { await tap('Home · Nest'); });
await check('invite step with seeded invitees', async () => {
  await page.getByPlaceholder('e.g. Tokyo Crew').fill('Tokyo Crew');
  await tap('Create hive');
  await has('Bring your');
  await has('Maya');
  await has('Ben');
});
await check('add an invitee', async () => {
  await page.getByPlaceholder('Add by name or email').fill('Alex');
  await page.getByRole('button', { name: 'Add invitee' }).click();
  await page.waitForTimeout(200);
  await has('Alex');
});
await check('enter the app', async () => { await tap('Enter your hive'); await has('hives are buzzing'); });

console.log('\nhive home');
await check('three hive cards', async () => {
  await has('Tokyo Crew');
  await has('The Apartment Hunt');
  await has('Date Night');
});
await check('home map initialises with a marker per spot', async () => {
  await page.waitForSelector('#map-home.leaflet-container', { timeout: 8000 });
  await page.waitForSelector('#map-home .leaflet-tile', { state: 'attached', timeout: 8000 });
  const pins = await page.locator('#map-home path.leaflet-interactive').count();
  if (pins !== 15) throw new Error('expected 15 pins, got ' + pins);
});
await check('tap map preview opens fullscreen with all saved places', async () => {
  await page.getByRole('button', { name: 'Open fullscreen map of all saved places' }).first().click();
  await page.waitForSelector('#map-fullscreen.leaflet-container', { timeout: 8000 });
  await page.waitForSelector('#map-fullscreen .leaflet-tile', { state: 'attached', timeout: 8000 });
  await has('All saved places');
  const pins = await page.locator('#map-fullscreen path.leaflet-interactive').count();
  // 15 trip spots + 5 nest listings + 8 table restaurants
  if (pins !== 28) throw new Error('expected 28 fullscreen pins, got ' + pins);
});
await check('Escape closes fullscreen map', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('#map-fullscreen').count()) {
    throw new Error('fullscreen map still present after Escape');
  }
});
await check('activity feed', () => has('Hive activity'));
await check('plan badge shows Free', () => has('Free'));

console.log('\ntrip');
await check('open trip from a hive card', async () => {
  await page.getByText('Tokyo Crew').first().click();
  await page.waitForTimeout(300);
  await has('Tokyo Adventure');
  await has('Bucketlist');
});
await check('trip map initialises with pins', async () => {
  await page.waitForSelector('#map-trip.leaflet-container', { timeout: 8000 });
  const pins = await page.locator('#map-trip path.leaflet-interactive').count();
  if (pins < 15) throw new Error('expected >=15 pins, got ' + pins);
});
await check('scanner: empty input is rejected with a toast', async () => {
  await tap('Scan & detect');
  await page.waitForTimeout(200);
  await has('Paste a link or caption first');
});
await check('scanner: sample resolves candidates with confidence', async () => {
  await tap('Sample');
  await tap('Scan & detect');
  await page.waitForTimeout(1600);
  await has('Detected via');
  await has('Afuri Ramen Ebisu');
  await has('% match');
});
await check('scanner: add a candidate to the trip', async () => {
  const before = await page.getByText('spots saved').innerText();
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.waitForTimeout(400);
  await has('ADDED ✓');
  const after = await page.getByText('spots saved').innerText();
  if (before === after) throw new Error('spot count did not increase: ' + before);
});

await check('spots tab: tier voting works', async () => {
  await tap('Spots');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Must ★' }).first().click();
  await page.waitForTimeout(400);
  await has('Locked in as a must-do');
});
await check('spots tab: category filter narrows the list', async () => {
  const all = await page.locator('.rv').count();
  await page.getByRole('button', { name: 'Food', exact: true }).first().click();
  await page.waitForTimeout(300);
  const food = await page.locator('.rv').count();
  if (food >= all) throw new Error(`filter did not narrow: ${all} -> ${food}`);
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await page.waitForTimeout(200);
});

await check('plan tab: pace select shows its default', async () => {
  await tap('Plan');
  await page.waitForTimeout(300);
  const v = await page.locator('select').inputValue();
  if (v !== 'balanced') throw new Error('pace default is ' + v);
});
await check('plan tab: generates an itinerary with clock times', async () => {
  await tap('Generate itinerary');
  await page.waitForTimeout(3600);
  await has('DAY 1');
  await has('Directions in Google Maps');
  const times = await page.getByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/).count();
  if (times < 3) throw new Error('only ' + times + ' timed items');
});
await check('plan tab: must-do is starred and honey-coloured', async () => {
  const n = await page.getByText('★', { exact: false }).count();
  if (n === 0) throw new Error('no starred must-dos on the plan');
});
await check('plan tab: regenerate label flips', () => has('Regenerate itinerary'));

await check('budget tab: totals and breakdown render', async () => {
  await tap('Budget');
  await page.waitForTimeout(300);
  await has('of $2200 budget');
  await has('Breakdown');
  await has('lodging');
  await has('activities');
});
await check('budget tab: logging an expense updates the list', async () => {
  await page.getByPlaceholder('What — e.g. izakaya night').fill('izakaya night');
  await page.getByLabel('Expense amount').fill('80');
  await tap('Add expense');
  await page.waitForTimeout(400);
  await has('Expense logged');
  await has('izakaya night');
});
await check('budget tab: booking is locked on Free and opens pricing', async () => {
  await page.getByRole('button', { name: /Flights/ }).click();
  await page.waitForTimeout(500);
  await has('Honest pricing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.getByText('Honest pricing').count()) throw new Error('sheet did not close');
});

await check('crew tab: members and invite', async () => {
  await tap('Crew');
  await page.waitForTimeout(300);
  await has('Maya');
  await page.getByPlaceholder('Invite — e.g. Alex').fill('Dana');
  await page.getByRole('button', { name: 'Add member' }).click();
  await page.waitForTimeout(400);
  await has('Dana invited');
});

console.log('\nnest');
await check('nest tab renders listings + map', async () => {
  await page.getByRole('button', { name: /Nest/ }).last().click();
  await page.waitForTimeout(500);
  await has('The Apartment Hunt');
  await has('Sunny 2BR in Park Slope');
  await page.waitForSelector('#map-nest.leaflet-container', { timeout: 8000 });
  const pins = await page.locator('#map-nest path.leaflet-interactive').count();
  if (pins !== 5) throw new Error('expected 5 nest pins, got ' + pins);
});
await check('nest: reaction toggles on and off', async () => {
  const btn = page.getByRole('button', { name: /React 💍 to Greenpoint/ });
  await btn.click();
  await page.waitForTimeout(350);
  if ((await btn.getAttribute('aria-pressed')) !== 'true') throw new Error('reaction did not set');
  await btn.click();
  await page.waitForTimeout(350);
  if ((await btn.getAttribute('aria-pressed')) !== 'false') throw new Error('reaction did not clear');
});
await check('nest: pin on map', async () => {
  await page.getByRole('button', { name: 'Pin on map' }).first().click();
  await page.waitForTimeout(400);
  await has('Pinned Park Slope');
});

console.log('\ntable');
await check('table tab renders restaurants + map', async () => {
  await page.getByRole('button', { name: /Table/ }).last().click();
  await page.waitForTimeout(500);
  await has('Date Night');
  await has('Via Carota');
  await page.waitForSelector('#map-table.leaflet-container', { timeout: 8000 });
  const pins = await page.locator('#map-table path.leaflet-interactive').count();
  if (pins !== 8) throw new Error('expected 8 table pins, got ' + pins);
});
await check('table: every mood filter returns at least one place', async () => {
  for (const mood of ['Cozy', 'Buzzy', 'Occasion', 'Bold', 'Lively', 'Fun', 'Untried']) {
    await page.getByRole('button', { name: mood, exact: true }).click();
    await page.waitForTimeout(250);
    const n = await page.locator('.rv').count();
    if (n === 0) throw new Error(`"${mood}" filter shows nothing`);
  }
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(200);
});
await check('table: Reserve is gated on Free', async () => {
  await page.getByRole('button', { name: /Reserve/ }).first().click();
  await page.waitForTimeout(500);
  await has('Honest pricing');
});

console.log('\npricing + entitlements');
await check('purchase Cohive+ monthly', async () => {
  await page.getByRole('button', { name: 'Start monthly' }).click();
  await page.waitForTimeout(600);
  await has('Cohive+ active');
});
await check('you tab: plan badge and referral code appear', async () => {
  await page.getByRole('button', { name: /You/ }).last().click();
  await page.waitForTimeout(500);
  await has('Your referral code');
  const code = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).count();
  if (code === 0) throw new Error('referral code not in MIKE-XXXX10 form');
});
await check('you tab: all 21 accounts are listed', async () => {
  const names = ['Airbnb', 'Hotels.com', 'Expedia', 'Priceline', 'Uber', 'Resy',
    'American — AAdvantage', 'United Airlines', 'Delta Air Lines', 'Southwest Airlines', 'Frontier Airlines',
    'X', 'TikTok', 'Instagram', 'Threads', 'YouTube', 'Pinterest', 'VSCO', 'Snapchat', 'LinkedIn', 'Facebook'];
  for (const n of names) {
    const c = await page.locator('.listRow').filter({ hasText: n }).count();
    if (c === 0) throw new Error('missing account row: ' + n);
  }
});
await check('you tab: connections unlocked at $4.99 — connect then disconnect', async () => {
  const rows = page.locator('.listRow');
  const total = await rows.count();
  let connected = 0;
  for (let i = 0; i < total; i++) {
    const btn = rows.nth(i).getByRole('button');
    const label = await btn.innerText();
    if (label.includes('Cohive+')) throw new Error('row still locked on a paid tier');
    await btn.click();
    connected++;
  }
  await page.waitForTimeout(300);
  if (connected !== 21) throw new Error('expected 21 rows, toggled ' + connected);
  const still = await page.getByRole('button', { name: 'Connect', exact: true }).count();
  if (still !== 0) throw new Error(still + ' rows failed to connect');
  const first = rows.first().getByRole('button');
  await first.click();
  await page.waitForTimeout(350);
  await has('disconnected');
  await first.click();
  await page.waitForTimeout(300);
});
await check('you tab: booking unlocks only on Annual', async () => {
  await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Go Annual' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Trip/ }).last().click();
  await page.waitForTimeout(400);
  await tap('Budget');
  await page.waitForTimeout(400);
  const locked = await page.getByRole('button', { name: /🔒 Flights/ }).count();
  if (locked !== 0) throw new Error('booking still locked on Annual');
});

console.log('\ntheme + persistence');
await check('light mode toggles', async () => {
  await page.getByLabel('Toggle theme').click();
  await page.waitForTimeout(500);
  const cls = await page.locator('.cv').first().getAttribute('class');
  if (!cls.includes('light')) throw new Error('light class not applied');
});
await check('light mode swaps the map tiles', async () => {
  await tap('Map');
  await page.waitForTimeout(600);
  const src = await page.locator('#map-trip .leaflet-tile').first().getAttribute('src', { timeout: 8000 });
  if (!src.includes('light_all')) throw new Error('tiles still dark: ' + src);
});
await check('theme + plan survive a reload', async () => {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const cls = await page.locator('.cv').first().getAttribute('class');
  if (!cls.includes('light')) throw new Error('theme not persisted');
  await has('Cohive+ Annual');
});
await check('back to dark', async () => {
  await page.getByLabel('Toggle theme').click();
  await page.waitForTimeout(400);
});

console.log('\nreplay tour');
await check('replay welcome tour returns to onboarding', async () => {
  await page.getByRole('button', { name: /You/ }).last().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Replay welcome tour' }).click();
  await page.waitForTimeout(500);
  await has('Your hive');
  await has('Continue with Google');
});
await check('skip returns to the app on the tab you left', async () => {
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForTimeout(500);
  await has('Replay welcome tour');
  await page.getByRole('button', { name: /Hive/ }).last().click();
  await page.waitForTimeout(400);
  await has('hives are buzzing');
});

console.log('\ndeep flows');
await check('scan results survive switching sub-views', async () => {
  await page.getByRole('button', { name: /Trip/ }).last().click();
  await page.waitForTimeout(300);
  await tap('Map');
  await page.waitForTimeout(400);
  await tap('Sample');
  await tap('Scan & detect');
  await page.waitForTimeout(1600);
  await has('Detected via');
  await tap('Spots');
  await page.waitForTimeout(300);
  await tap('Map');
  await page.waitForTimeout(400);
  await has('Detected via');
  await has('Nezu Museum');
});
await check('tapping the active tier un-votes it', async () => {
  await tap('Spots');
  await page.waitForTimeout(300);
  const btn = page.getByRole('button', { name: 'Maybe', exact: true }).first();
  await btn.click();
  await page.waitForTimeout(250);
  if ((await btn.getAttribute('aria-pressed')) !== 'true') throw new Error('tier did not set');
  await btn.click();
  await page.waitForTimeout(250);
  if ((await btn.getAttribute('aria-pressed')) !== 'false') throw new Error('tier did not clear');
});
await check('category filter survives leaving and re-entering the tab', async () => {
  await page.getByRole('button', { name: 'Food', exact: true }).first().click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Nest/ }).last().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trip/ }).last().click();
  await page.waitForTimeout(400);
  const food = page.getByRole('button', { name: 'Food', exact: true }).first();
  if ((await food.getAttribute('aria-pressed')) !== 'true') throw new Error('filter reset on tab switch');
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  await page.waitForTimeout(200);
});
await check('table mood filter survives a tab switch', async () => {
  await page.getByRole('button', { name: /Table/ }).last().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Cozy', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /Hive/ }).last().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Table/ }).last().click();
  await page.waitForTimeout(400);
  const cozy = page.getByRole('button', { name: 'Cozy', exact: true });
  if ((await cozy.getAttribute('aria-pressed')) !== 'true') throw new Error('mood filter reset');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(200);
});
await check('"+ Trip day" links a restaurant', async () => {
  await page.getByRole('button', { name: '+ Trip day' }).first().click();
  await page.waitForTimeout(300);
  await has('linked to your next open trip day');
});
await check('regenerating with fewer days honours the day count', async () => {
  await page.getByRole('button', { name: /Trip/ }).last().click();
  await page.waitForTimeout(300);
  await tap('Plan');
  await page.waitForTimeout(300);
  await page.getByLabel('Days').fill('2');
  // The persistence check reloaded the page, so the in-memory plan is gone
  // and the button reads "Generate" again — match either label.
  await page.getByRole('button', { name: /itinerary$/i }).click();
  await page.waitForTimeout(3600);
  await has('DAY 2');
  if (await page.getByText('DAY 3', { exact: true }).count()) throw new Error('DAY 3 rendered for a 2-day plan');
  await has('Didn’t fit:');
});
await check('.ics export downloads a calendar file', async () => {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: 'Calendar .ics' }).click(),
  ]);
  if (dl.suggestedFilename() !== 'cohive-tokyo.ics') throw new Error('filename: ' + dl.suggestedFilename());
  await page.waitForTimeout(300);
  await has('Calendar file downloaded');
});
await check('copy-as-text puts the itinerary on the clipboard', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.getByRole('button', { name: 'Copy as text' }).click();
  await page.waitForTimeout(400);
  await has('Copied to clipboard');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip.includes('Tokyo Adventure — Cohive itinerary')) throw new Error('clipboard: ' + clip.slice(0, 60));
  if (!clip.includes('Day 2')) throw new Error('clipboard missing Day 2');
});
await check('empty expense is rejected with a toast', async () => {
  await tap('Budget');
  await page.waitForTimeout(300);
  await tap('Add expense');
  await page.waitForTimeout(250);
  await has('Add a label and amount');
});
let savedCode = '';
await check('Platinum keeps the referral code generated earlier', async () => {
  await page.getByRole('button', { name: /You/ }).last().click();
  await page.waitForTimeout(400);
  savedCode = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).innerText();
  await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Own it' }).click();
  await page.waitForTimeout(600);
  await has('Platinum active');
  await has('Lifetime access');
  const code = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).innerText();
  if (code !== savedCode) throw new Error(`code changed: ${savedCode} -> ${code}`);
});
await check('downgrading to Free re-locks connections and hides the code', async () => {
  await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Current plan' }).click();
  await page.waitForTimeout(600);
  await has('You’re on Free');
  await has('Free plan');
  const locked = await page.getByRole('button', { name: /Cohive\+/ }).count();
  if (locked < 21) throw new Error('expected 21 locked rows, got ' + locked);
  await has('Every paid plan includes a permanent referral code');
});
await check('re-purchasing restores the same permanent code', async () => {
  await page.getByRole('button', { name: 'See Cohive+ plans' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Start monthly' }).click();
  await page.waitForTimeout(600);
  const code = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).innerText();
  if (code !== savedCode) throw new Error(`code not permanent: ${savedCode} -> ${code}`);
});
await check('tapping the scrim closes the pricing sheet', async () => {
  await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
  await page.waitForTimeout(500);
  await has('Honest pricing');
  await page.getByRole('button', { name: 'Close plans' }).click({ position: { x: 215, y: 30 } });
  await page.waitForTimeout(500);
  if (await page.getByText('Honest pricing').count()) throw new Error('sheet did not close');
});

console.log('\ndesktop device frame');
await check('wide viewport renders the iOS bezel', async () => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.waitForTimeout(600);
  await has('9:41');
});

await browser.close();

// Ignore favicon noise, offline CDN tiles, and rare aborted health probes.
const appErrors = errors.filter(
  (e) => !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR|\/api\/health/i.test(e)
);
console.log('\n' + passed + ' passed, ' + fails.length + ' failed');
if (appErrors.length) {
  console.log('\nconsole errors:');
  appErrors.slice(0, 20).forEach((e) => console.log('  ! ' + e));
}
if (fails.length || appErrors.length) process.exit(1);
