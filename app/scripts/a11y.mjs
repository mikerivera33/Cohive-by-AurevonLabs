/**
 * Accessibility audit — runs axe-core across every screen and the pricing
 * sheet, in dark and light mode, and fails on serious/critical violations.
 * Run like scripts/smoke.mjs:
 *
 *   PLAYWRIGHT=$(npm root -g)/playwright node scripts/a11y.mjs http://127.0.0.1:4173
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw;
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const BASE = process.argv[2] || 'http://localhost:4173';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });

let worst = 0;
const scan = async (label) => {
  await page.evaluate(axeSource);
  const res = await page.evaluate(() =>
    // Leaflet's internals aren't ours to fix; everything else is.
    window.axe.run(document.body, { exclude: [['.leaflet-container']] })
  );
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = res.violations.length - bad.length;
  console.log(
    `  ${bad.length ? '✗' : '✓'} ${label} — ${bad.length} serious/critical` +
      (minor ? ` (${minor} minor/moderate)` : '')
  );
  for (const v of bad) {
    worst++;
    console.log(`      [${v.impact}] ${v.id}: ${v.help}`);
    v.nodes.slice(0, 3).forEach((n) => console.log('        ' + n.target.join(' ')));
  }
  for (const v of res.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')) {
    console.log(`      (note) [${v.impact}] ${v.id}: ${v.help} ×${v.nodes.length}`);
  }
};

const tab = async (name) => {
  await page.getByRole('button', { name: new RegExp(name) }).last().click();
  await page.waitForTimeout(400);
};

console.log('\nonboarding');
await page.goto(BASE + '/?start=onboarding', { waitUntil: 'networkidle' });
await scan('intro slides');
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.waitForTimeout(400);
await scan('auth');
await page.getByRole('button', { name: /Continue with Apple/ }).click();
await page.waitForTimeout(400);
await scan('create hive');
await page.getByRole('button', { name: 'Create hive' }).click();
await page.waitForTimeout(400);
await scan('invite');

console.log('\napp — dark');
await page.goto(BASE + '/?start=app', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await scan('hive home');
await tab('Trip');
await scan('trip · map + scanner');
for (const v of ['Spots', 'Plan', 'Budget', 'Crew']) {
  await page.getByRole('button', { name: v, exact: true }).click();
  await page.waitForTimeout(350);
  await scan('trip · ' + v.toLowerCase());
}
await tab('Nest');
await scan('nest');
await tab('Table');
await scan('table');
await tab('You');
await scan('you');
await page.getByRole('button', { name: 'See Cohive+ plans' }).click();
await page.waitForTimeout(500);
await scan('pricing sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

console.log('\napp — light');
await page.getByLabel('Toggle theme').click();
await page.waitForTimeout(400);
await tab('Hive');
await scan('hive home (light)');
await tab('You');
await scan('you (light)');

await browser.close();
console.log(worst ? `\n${worst} serious/critical violations` : '\nNo serious or critical violations.');
process.exit(worst ? 1 : 0);
