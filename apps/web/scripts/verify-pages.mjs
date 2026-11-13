/**
 * Proves in a real browser what jsdom cannot about the K5 pages, at 768x900, 1100x900 and 1440x900. Each check
 * prints one PASS, FAIL or SKIPPED line:
 *
 *   1. Hub (/): the hero, the layer stack with its four loaded images and four labels, the service panels and
 *      the "Mới cập nhật" section are there; nothing scrolls sideways; every label sits inside the window.
 *   2. Hub under reduced motion: no element of the hub runs an animation.
 *   3. Profile (/ho-so) signed out: its page frame shows, nothing scrolls sideways.
 *   4. Signed in (VERIFY_EMAIL and VERIFY_PASSWORD of an admin; else SKIPPED): the profile and each Quản lý
 *      section render their title, and neither the page nor a section scrolls sideways (a table scrolls inside
 *      its own frame).
 *
 * A screenshot per page and width goes to --out. Exits 1 on any FAIL.
 *
 * Run: npm run verify:pages -w @webatlas/web -- --out <dir>
 * Needs: the Docker stack, the API and `npm run dev:web`.
 */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg === -1 ? tmpdir() : process.argv[outArg + 1]);
const WIDTHS = [768, 1100, 1440];
const SECTIONS = ['/quan-ly/nhom-quyen', '/quan-ly/nguoi-dung', '/quan-ly/chua-gan', '/quan-ly/ban-do-ca-nhan', '/quan-ly/tu-dien'];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let failed = false;
function line(status, vp, id, name, detail = '') {
  if (status === 'FAIL') failed = true;
  console.log(`${status.padEnd(7)} ${String(vp).padEnd(4)} ${id.padEnd(3)} ${name}${detail ? `: ${detail}` : ''}`);
}

async function open(browser, width, { reduce = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', (e) => line('FAIL', width, '-', 'page error', String(e.message).split('\n')[0]));
  return page;
}

async function go(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle2' });
  await sleep(1500);
}

/** The routed page over the map scrolls only up and down. */
const sideways = (page) => page.evaluate(() => {
  const route = document.querySelector('.quan-ly-route');
  return !route || route.scrollWidth > route.clientWidth + 0.5 || document.documentElement.scrollWidth > window.innerWidth;
});

async function hub(browser, width) {
  const page = await open(browser, width);
  await go(page, '/');
  const m = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('[data-slot="layer-stack"] [data-layer] img')];
    const labels = [...document.querySelectorAll('[data-slot="layer-stack"] li')];
    return {
      hero: Boolean(document.querySelector('[data-slot="hub"] h1')),
      images: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      labels: labels.length,
      labelsInside: labels.every((li) => li.getBoundingClientRect().right <= window.innerWidth + 0.5),
      panels: document.querySelectorAll('#hub-services ~ ul > li').length,
      recent: Boolean(document.querySelector('#hub-recent')),
    };
  });
  const ok = m.hero && m.images === 4 && m.labels === 4 && m.labelsInside && m.panels >= 2 && m.recent && !(await sideways(page));
  line(ok ? 'PASS' : 'FAIL', width, '1', 'hub: hero, four-layer stack, panels, Mới cập nhật, no sideways scroll', JSON.stringify(m));
  await page.screenshot({ path: join(OUT, `verify-pages-hub-${width}.png`) });
  await page.close();

  const still = await open(browser, width, { reduce: true });
  await go(still, '/');
  const running = await still.evaluate(() => [...document.querySelectorAll('[data-slot="hub"] *')]
    .map((e) => getComputedStyle(e).animationName).filter((n) => n && n !== 'none'));
  line(running.length ? 'FAIL' : 'PASS', width, '2', 'hub holds still under reduced motion', running.join(', '));
  await still.close();
}

async function signedOutProfile(browser, width) {
  const page = await open(browser, width);
  await go(page, '/ho-so');
  const title = await page.$eval('[data-slot="profile"] h1', (h) => h.textContent.trim()).catch(() => null);
  line(title === 'Hồ sơ' && !(await sideways(page)) ? 'PASS' : 'FAIL', width, '3', 'profile frame when signed out', `title ${title}`);
  await page.close();
}

async function signedIn(browser, width) {
  if (!EMAIL || !PASSWORD) {
    line('SKIPPED', width, '4', 'signed in: profile and Quản lý', 'set VERIFY_EMAIL and VERIFY_PASSWORD');
    return;
  }
  const page = await open(browser, width);
  await go(page, '/ban-do');
  await page.$$eval('[data-slot="app-header"] button', (bs) => bs.find((b) => b.textContent.trim() === 'Đăng nhập')?.click());
  await page.waitForSelector('#login-email', { visible: true, timeout: 10000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-slot="account-trigger"]', { timeout: 20000 });
  for (const path of ['/ho-so', ...SECTIONS]) {
    await go(page, path);
    const title = await page.evaluate(() => (document.querySelector('[data-slot="admin-section"] h2') ?? document.querySelector('[data-slot="profile"] h1'))?.textContent.trim() ?? null);
    const scrolls = await sideways(page);
    line(title && !scrolls ? 'PASS' : 'FAIL', width, '4', `signed in: ${path}`, `title ${title}${scrolls ? ', scrolls sideways' : ''}`);
    await page.screenshot({ path: join(OUT, `verify-pages${path.replace(/\//g, '-')}-${width}.png`) });
  }
  await page.close();
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  console.log(`verify-pages against ${BASE_URL}; screenshots in ${OUT}`);
  for (const width of WIDTHS) {
    await hub(browser, width);
    await signedOutProfile(browser, width);
    await signedIn(browser, width);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
