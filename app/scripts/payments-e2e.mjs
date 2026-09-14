/**
 * Payments end-to-end — every money surface, driven by touch on an iPhone-sized
 * viewport, with iOS UX invariants asserted on each screen:
 *
 *   • subscription tiers (Cohive+ monthly → Annual → Platinum → Free) and the
 *     permanent referral code
 *   • booking gate (locked on Free / monthly, unlocked on Annual+)
 *   • group pot: contribute, refused overdraw, own-money withdrawal, refused
 *     short pot bill, covered pot bill, settle-up
 *   • iOS: viewport-fit=cover, no horizontal scroll, ≥44pt tap targets on every
 *     money control, ≥16px inputs (Safari does not zoom), CSP present
 *   • persistence policy: no money state in localStorage, plan tier survives reload
 *
 * Run like the smoke suite:  PLAYWRIGHT=… node scripts/payments-e2e.mjs http://127.0.0.1:4173
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');

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
// iPhone 14 Pro-class viewport with touch; Chromium engine (WebKit is not installed here).
const iphone = devices['iPhone 14 Pro'] || { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 };
const ctx = await browser.newContext({ ...iphone, isMobile: true, hasTouch: true, defaultBrowserType: undefined });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const has = async (text) => {
  if ((await page.getByText(text, { exact: false }).count()) === 0) throw new Error(`"${text}" not found`);
};
const tap = async (name, opts = {}) => {
  await page.getByRole('button', { name, ...opts }).first().tap();
  await page.waitForTimeout(260);
};
const fill = async (label, value) => page.getByLabel(label).fill(String(value));

/** iOS UX invariants for the money controls currently on screen. */
const iosInvariants = async (scope) => {
  await page.waitForTimeout(700); // let reveal-on-scroll transforms settle
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { overflow: document.documentElement.scrollWidth > vw + 1, small: [], zoomy: [], wide: [] };
    const visible = (el) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    for (const el of document.querySelectorAll('button, input, select, [role=button]')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.tagName).trim().slice(0, 30);
      // offsetHeight is layout height — immune to in-flight transform animations.
      if (el.offsetHeight < 44) out.small.push(`${label} (${el.offsetHeight}px)`);
      if (b.right > vw + 1) out.wide.push(label);
      if ((el.tagName === 'INPUT' || el.tagName === 'SELECT') && parseFloat(getComputedStyle(el).fontSize) < 16) {
        out.zoomy.push(label);
      }
    }
    return out;
  });
  const problems = [];
  if (r.overflow) problems.push('page scrolls horizontally');
  if (r.wide.length) problems.push('off-screen: ' + r.wide.join(', '));
  if (r.small.length) problems.push('tap targets < 44pt: ' + r.small.join(', '));
  if (r.zoomy.length) problems.push('inputs < 16px (iOS zooms): ' + r.zoomy.join(', '));
  if (problems.length) throw new Error(`${scope}: ${problems.join('; ')}`);
};

console.log('\niOS shell');
await page.goto(BASE + '/?start=app', { waitUntil: 'networkidle' });
await check('viewport-fit=cover + CSP are declared', async () => {
  const meta = await page.evaluate(() => ({
    vp: document.querySelector('meta[name=viewport]')?.content || '',
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
  }));
  if (!/viewport-fit=cover/.test(meta.vp)) throw new Error('viewport meta lacks viewport-fit=cover');
  if (!/default-src/.test(meta.csp)) throw new Error('CSP meta missing');
});
await check('home fits an iPhone width with touch-sized controls', () => iosInvariants('home'));

console.log('\ngroup pot + split ledger (touch)');
await tap(/Trip/);
await tap('Budget');
await page.waitForTimeout(300);
await check('budget view passes iOS invariants', () => iosInvariants('budget'));
await check('pot and settle-up render from the books', async () => {
  await has('in the pot');
  await has('yours: $200');
  await has('Maya pays You');
  await has('525');
});
await check('contribute credits your envelope', async () => {
  await fill('Pot amount', 75);
  await tap('Add to pot');
  await has('Added $75 to the pot');
  await has('yours: $275');
});
await check('overdraw is refused with a clear reason', async () => {
  await fill('Pot amount', 275.01);
  await tap('Take out');
  await has('only what you put in');
  await has('yours: $275');
});
await check('own money comes back out', async () => {
  await fill('Pot amount', 75);
  await tap('Take out');
  await has('Took $75 out of the pot');
  await has('yours: $200');
});
await check('pot refuses a bill an unfunded member shares', async () => {
  await fill('Expense label', 'ryokan deposit');
  await fill('Expense amount', 300);
  await page.getByLabel('Paid by').selectOption('pot');
  await tap('Add expense');
  await has('Ben is $100 short');
});
await check('pot pays once every share is covered', async () => {
  await page.getByRole('button', { name: 'Ben', exact: true }).tap();
  await tap('Add expense');
  await has('Expense logged');
  await has('Pot paid · 2 ways');
  await has('yours: $50');
});
await check('a person-paid split lands on the settle-up plan', async () => {
  await page.getByLabel('Paid by').selectOption({ label: 'Maya paid' });
  await fill('Expense label', 'karaoke');
  await fill('Expense amount', 90);
  await tap('Add expense');
  await has('Maya paid · 2 ways');
});
await check('mark paid settles a transfer', async () => {
  await page.getByRole('button', { name: /Mark Maya paid You/ }).tap();
  await page.waitForTimeout(300);
  await has('Marked as settled');
  await has('Ben pays You');
});
await check('budget view still passes iOS invariants after edits', () => iosInvariants('budget after edits'));

console.log('\nsubscription + booking gate (touch)');
await check('booking is locked on Free and opens the plans sheet', async () => {
  await page.getByRole('button', { name: /🔒 Flights/ }).tap();
  await page.waitForTimeout(500);
  await has('Honest pricing');
});
await check('plans sheet passes iOS invariants', () => iosInvariants('pricing sheet'));
await check('Cohive+ monthly activates but does not unlock booking', async () => {
  await tap('Start monthly');
  await page.waitForTimeout(500);
  await has('Cohive+ active');
  if ((await page.getByRole('button', { name: /🔒 Flights/ }).count()) === 0) throw new Error('booking unlocked on monthly');
});
await check('Annual unlocks in-app booking', async () => {
  await page.getByRole('button', { name: /🔒 Flights/ }).tap();
  await page.waitForTimeout(500);
  await tap('Go Annual');
  await page.waitForTimeout(500);
  await has('Cohive+ Annual active');
  await tap('Flights');
  await has('opening your linked accounts');
});
let code = '';
await check('referral code is issued once and survives Platinum', async () => {
  await page.getByRole('button', { name: /You/ }).last().tap();
  await page.waitForTimeout(500);
  await has('Your referral code');
  code = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).innerText();
  await tap('See Cohive+ plans');
  await page.waitForTimeout(400);
  await tap('Own it');
  await page.waitForTimeout(500);
  await has('Platinum active');
  const again = await page.getByText(/^MIKE-[A-Z0-9]{4}10$/).innerText();
  if (again !== code) throw new Error(`code changed ${code} -> ${again}`);
});
await check('you tab passes iOS invariants', () => iosInvariants('you tab'));
await check('downgrade to Free re-locks booking', async () => {
  await tap('See Cohive+ plans');
  await page.waitForTimeout(400);
  await tap('Current plan');
  await page.waitForTimeout(500);
  await has('You’re on Free');
  await page.getByRole('button', { name: /Trip/ }).first().tap();
  await page.waitForTimeout(300);
  await tap('Budget');
  await page.waitForTimeout(300);
  if ((await page.getByRole('button', { name: /🔒 Flights/ }).count()) === 0) throw new Error('booking still unlocked on Free');
});

console.log('\npersistence policy');
await check('no money state is written to localStorage; plan tier is', async () => {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const money = keys.filter((k) => /fund|expense|ledger|pot|balance/i.test(k));
  if (money.length) throw new Error('money keys persisted: ' + money.join(', '));
  if (!keys.includes('cohive:planTier')) throw new Error('planTier not persisted');
});
await check('plan tier survives a reload, pot edits do not', async () => {
  await tap('Start monthly').catch(() => {});
  await page.getByRole('button', { name: /🔒 Flights/ }).tap().catch(() => {});
  await page.waitForTimeout(400);
  await tap('Start monthly').catch(() => {});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Trip/ }).first().tap();
  await tap('Budget');
  await page.waitForTimeout(300);
  await has('yours: $200'); // seed pot again — session-only by design
  const tier = await page.evaluate(() => localStorage.getItem('cohive:planTier'));
  if (!/Cohive\+/.test(tier || '')) throw new Error('tier did not persist: ' + tier);
});

await browser.close();

const appErrors = errors.filter((e) => !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR|\/api\/health/i.test(e));
console.log('\n' + passed + ' passed, ' + fails.length + ' failed');
if (appErrors.length) {
  console.log('\nconsole errors:');
  appErrors.slice(0, 20).forEach((e) => console.log('  ! ' + e));
}
if (fails.length || appErrors.length) process.exit(1);
