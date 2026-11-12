/**
 * Proves in a real browser that legacy screens keep their look: the computed style
 * of every element on the legacy pages is snapshotted (--save) and later compared
 * (--compare). Elements under a [data-slot] (the new primitives) and the toast host
 * are not walked; they are allowed to change.
 *
 * Runs at 1440x900 only. Signed-out pages: /, /ban-do, /du-lieu. Signed-in pages:
 * /ban-do, /ho-so, /quan-ly/nhom-quyen, /quan-ly/tu-dien; without VERIFY_EMAIL and
 * VERIFY_PASSWORD these print SKIPPED (which is not a pass). Exits 1 on any difference.
 *
 * Run: npm run verify:legacy-styles -w @webatlas/web -- --save <file> | --compare <file>
 * Needs: the Docker stack, the API and `npm run dev:web`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { diffSnapshots, elementKey, PROPERTIES } from './legacy-styles.mjs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MAX_LINES = 50;

/** Requests that draw the map; the page counts as settled after QUIET_MS without one in flight. */
const TILE_REQUEST = /gwc|wmts|tile|arcgis|google/i;
const QUIET_MS = 4000;
const SETTLE_CAP_MS = 60000;
/** The element structure must hold still this long before it is read. */
const STABLE_MS = 3000;

const SIGNED_OUT = ['/', '/ban-do', '/du-lieu'];
const SIGNED_IN = ['/ban-do', '/ho-so', '/quan-ly/nhom-quyen', '/quan-ly/tu-dien'];

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const SAVE = argOf('--save');
const COMPARE = argOf('--compare');
if (Boolean(SAVE) === Boolean(COMPARE)) {
  console.error('usage: verify-legacy-styles.mjs --save <file> | --compare <file>');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The service probe is live (a service can answer or time out from one run to the next),
 * so the page gets a fixed answer: the top bar and the hub are what is compared, not the
 * stack's health. One service is down so the down styling is part of the snapshot.
 */
const SERVICES = {
  services: [
    { id: 'geonode', label: 'Danh mục bản đồ', url: 'http://localhost:8000/', status: 'up', checkedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'dagster', label: 'Điều phối dữ liệu', url: 'http://localhost:3070/', status: 'down', checkedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'keycloak', label: 'Tài khoản', url: 'http://localhost:8180/realms/webatlas/account', status: 'up', checkedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

async function stubServices(page) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (!request.url().includes('/api/platform/services')) {
      request.continue();
      return;
    }
    request.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': request.headers().origin ?? BASE_URL, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(SERVICES),
    });
  });
}

/** Counts tile requests in flight; the returned function waits for QUIET_MS without any. */
function trackTiles(page) {
  let inFlight = 0;
  let lastChange = Date.now();
  page.on('request', (request) => {
    if (!TILE_REQUEST.test(request.url())) return;
    inFlight += 1;
    lastChange = Date.now();
  });
  const done = (request) => {
    if (!TILE_REQUEST.test(request.url())) return;
    inFlight = Math.max(0, inFlight - 1);
    lastChange = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    const start = Date.now();
    while (Date.now() - start < SETTLE_CAP_MS) {
      if (inFlight === 0 && Date.now() - lastChange >= QUIET_MS) return true;
      await sleep(250);
    }
    return false;
  };
}

/** Waits until no spinner is on the page, so a loading state is never snapshotted. */
const spinnersGone = (page) =>
  page.waitForFunction(() => !document.querySelector('.spin, [data-slot="spinner"], [aria-busy="true"]'), { timeout: SETTLE_CAP_MS });

/** Reads the computed style of every element outside [data-slot] subtrees and the toast host. */
async function snapshotPage(page, prefix) {
  const rows = await page.evaluate((properties) => {
    const out = [];
    const skip = (el) => el.matches('[data-slot], .toast-host, script, style, noscript');
    const segment = (el) => {
      const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      return [el.tagName.toLowerCase(), ...classes].join('.');
    };
    const walk = (el, path) => {
      if (skip(el)) return;
      const next = [...path, segment(el)];
      const cs = getComputedStyle(el);
      out.push({ path: next, style: Object.fromEntries(properties.map((p) => [p, cs.getPropertyValue(p)])) });
      for (const child of el.children) walk(child, next);
    };
    walk(document.body, []);
    return out;
  }, PROPERTIES);
  const seen = new Map();
  const snapshot = {};
  for (const { path, style } of rows) snapshot[`${prefix} ${elementKey(path, seen)}`] = style;
  return snapshot;
}

/** Waits until the page's element structure (tags and classes) has not changed for STABLE_MS. */
async function structureStable(page) {
  const signature = () => page.evaluate(() => [...document.body.querySelectorAll('*')]
    .map((el) => `${el.tagName}.${typeof el.className === 'string' ? el.className : ''}`).join('|'));
  let last = await signature();
  let since = Date.now();
  const start = Date.now();
  while (Date.now() - start < SETTLE_CAP_MS) {
    await sleep(250);
    const now = await signature();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= STABLE_MS) return;
  }
  throw new Error('the page structure never stopped changing');
}

async function openPage(page, settle, route) {
  // The top bar and the hub colour a service by a live probe; wait for its answer so the
  // snapshot never catches the page before it (or a half-drawn nav).
  const probed = page.waitForResponse((r) => r.url().includes('/api/platform/services'), { timeout: SETTLE_CAP_MS });
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load' });
  await probed;
  if (!(await settle())) throw new Error(`tile requests still in flight after ${SETTLE_CAP_MS / 1000} s on ${route}`);
  await spinnersGone(page);
  await page.evaluate(() => document.fonts.ready);
  await structureStable(page);
}

async function signIn(page, settle) {
  await openPage(page, settle, '/ban-do');
  const clicked = await page.$$eval('[data-slot="app-header"] button', (buttons) => {
    const button = buttons.find((b) => b.textContent.trim() === 'Đăng nhập');
    button?.click();
    return Boolean(button);
  });
  if (!clicked) throw new Error('no Đăng nhập button in the header');
  await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', PASSWORD);
  await page.$eval('#login-password', (el) => el.form.requestSubmit());
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-slot="app-header"] button')].some((b) => b.textContent.trim() === 'Trợ lý'),
      { timeout: 20000 },
    );
  } catch {
    throw new Error('sign-in did not finish');
  }
}

async function collect(browser) {
  const snapshot = {};
  let pages = 0;
  const visit = async (label, routes, signedIn) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport(VIEWPORT);
    await stubServices(page);
    const settle = trackTiles(page);
    try {
      if (signedIn) await signIn(page, settle);
      for (const route of routes) {
        await openPage(page, settle, route);
        const part = await snapshotPage(page, `${label} ${route}`);
        Object.assign(snapshot, part);
        pages += 1;
        console.log(`PASS    ${label.padEnd(10)} ${route.padEnd(22)} ${Object.keys(part).length} elements`);
      }
    } finally {
      await context.close();
    }
  };
  await visit('signed-out', SIGNED_OUT, false);
  if (EMAIL && PASSWORD) {
    await visit('signed-in', SIGNED_IN, true);
  } else {
    for (const route of SIGNED_IN) {
      console.log(`SKIPPED signed-in  ${route.padEnd(22)} set VERIFY_EMAIL and VERIFY_PASSWORD`);
    }
  }
  return { snapshot, pages };
}

const run = async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  let result;
  try {
    console.log(`verify-legacy-styles against ${BASE_URL}`);
    result = await collect(browser);
  } finally {
    await browser.close();
  }
  const { snapshot, pages } = result;
  const elements = Object.keys(snapshot).length;
  if (SAVE) {
    writeFileSync(SAVE, JSON.stringify(snapshot));
    console.log(`saved ${pages} pages, ${elements} elements to ${SAVE}`);
    return 0;
  }
  const differences = diffSnapshots(JSON.parse(readFileSync(COMPARE, 'utf8')), snapshot);
  if (differences.length === 0) {
    console.log(`compared ${pages} pages, ${elements} elements: 0 differences`);
    return 0;
  }
  for (const text of differences.slice(0, MAX_LINES)) console.log(`FAIL    ${text}`);
  if (differences.length > MAX_LINES) console.log(`... and ${differences.length - MAX_LINES} more`);
  console.log(`compared ${pages} pages, ${elements} elements: ${differences.length} differences`);
  return 1;
};

run().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
