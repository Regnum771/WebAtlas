/**
 * Proves in a real browser, against the real GeoNode/GeoServer stack, that the catalogue and the
 * time-series layers work end to end (S1 "catalogue → map"):
 *
 *   U1/U2 (only with --upload, and only when the entry is not in the catalogue yet): the owner
 *      uploads the HEC-RAS result (.hdf, hourly) and a zip of MSWEP days through Thêm dữ liệu →
 *      Từ Danh mục → Tải chuỗi thời gian lên and waits for "Đã thêm chuỗi thời gian vào bản đồ.".
 *      Prints how long the upload and the job took.
 *   1. The owner signs in through SSO (Keycloak); Thêm dữ liệu opens on Từ Danh mục; a search for
 *      `thubon` lists the depth entry with "Chưa duyệt" (and its peak-depth raster).
 *   2. Thêm vào bản đồ: the row appears under "Lớp từ Danh mục" and the time slider shows one step
 *      per depth step (73 for 25/10 00:00 → 28/10 00:00).
 *   3. The slider moved to 26/10/2025 12:00 (the page runs in Vietnam time): a GetMap of the entry goes out
 *      with TIME=2025-10-26T05:00:00.000Z.
 *   4. A pointer resting inside the flooded river shows the depth "<n>,<nn> m · 26/10/2025 12:00"
 *      (GetFeatureInfo JSON from the real GeoServer through the proxy).
 *   5. The rain entry is added; with Phát at 4× both layers request new times together: the depth
 *      layer several hours, the rain layer the next day.
 *   6. "Sao vào Bản của tôi" for the peak-depth raster and for a published vector entry into the
 *      test map: the copies land at the source's place (raster bounds match the entry's extent:
 *      WCS coverageId; the vector's points equal the source points: WFS lon/lat axis order). The
 *      save picker and its buttons fit in the side panel.
 *   7. "Lưu vào bản đồ của tôi" for the depth and rain entries; after a reload the map's link
 *      rows are back, on the map, and the slider runs over both again.
 *   8. A second account signs in through SSO: searching for the unpublished entries finds none and
 *      the API answers 404 for them (the published vector entry stays visible). The owner shares
 *      the test map with it: the two links show "Không có quyền xem hoặc đã bị xoá" (gone rows
 *      that fit in the panel), the copies show as ordinary layers.
 *   9. Cleanup through the API: the test map (with its layers and copy jobs) is deleted.
 *
 * Steps 1–9 run at 1440x900 and at 768x900 and print one PASS / FAIL line each; the script exits
 * non-zero on any FAIL. Screenshots go to --out. The catalogue entries stay (they are the test
 * data; docs/runbooks/catalogue-timeseries.md says how to delete them).
 *
 * Environment:
 *   VERIFY_SSO_USERNAME / VERIFY_SSO_PASSWORD         the owner (Keycloak account, e.g. KC_DEV_*)
 *   VERIFY_SECOND_USERNAME / VERIFY_SECOND_PASSWORD   a second Keycloak account
 *   VERIFY_VECTOR_QUERY   search text that finds one published vector entry (default kiem_thu_s1)
 *   VERIFY_HDF / VERIFY_RAIN_ZIP   files for --upload (default var/samples/thubon_vugia_10_25.p01.hdf
 *                                  and var/samples/mswep-2025-10.zip)
 *   Optional: BASE_URL (default http://localhost:5173), API_URL (default http://localhost:3001), CHROME_PATH.
 *
 * Run: npm run verify:catalogue -w @webatlas/web -- --out <dir> [--only 1440|768] [--upload]
 * Needs: the platform stack (keycloak, django, celery, geonode, geoserver, db, redis) and the
 * worker profile, the API and `npm run dev:web` (the dev server exposes window.__olMap).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const ACCOUNTS = {
  owner: { username: process.env.VERIFY_SSO_USERNAME, password: process.env.VERIFY_SSO_PASSWORD },
  second: { username: process.env.VERIFY_SECOND_USERNAME, password: process.env.VERIFY_SECOND_PASSWORD },
};
const missing = [
  !ACCOUNTS.owner.username && 'VERIFY_SSO_USERNAME', !ACCOUNTS.owner.password && 'VERIFY_SSO_PASSWORD',
  !ACCOUNTS.second.username && 'VERIFY_SECOND_USERNAME', !ACCOUNTS.second.password && 'VERIFY_SECOND_PASSWORD',
].filter(Boolean);
if (missing.length > 0) {
  console.error(`Set ${missing.join(', ')} (see the header of this script).`);
  process.exit(2);
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};
const OUT = resolve(arg('--out') ?? tmpdir());
const ONLY = arg('--only') ? Number(arg('--only')) : null;
const UPLOAD = process.argv.includes('--upload');
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 900 },
].filter((v) => ONLY === null || v.width === ONLY);

/** Requests that draw the map; the page counts as settled after QUIET_MS without one in flight. */
const DRAW_REQUEST = /gwc|wmts|tile|arcgis|google|\/api\/catalogue\/[^/]+\/wms/i;
const QUIET_MS = 3000;
const SETTLE_CAP_MS = 60000;
const RATE_WINDOW_MS = 61000;
const COPY_TIMEOUT_MS = 10 * 60000;
const UPLOAD_TIMEOUT_MS = 120 * 60000;

// ---- The test data -------------------------------------------------------------------------

const DEPTH = {
  file: process.env.VERIFY_HDF ?? join(REPO, 'var/samples/thubon_vugia_10_25.p01.hdf'),
  typed: 'Kiểm thử S1 — Độ sâu ngập Thu Bồn – Vu Gia, 25–28/10/2025',
  // The worker appends the HEC-RAS source label to the title typed in the dialog.
  get title() { return `${this.typed} (nội suy từ .hdf trên FABDEM)`; },
  abstract: 'Kết quả HEC-RAS thubon_vugia_10_25.p01, mỗi giờ; nội suy từ .hdf trên FABDEM.',
  pattern: null,
};
const PEAK_TITLE = `${DEPTH.typed} – độ sâu lớn nhất`;
const RAIN = {
  file: process.env.VERIFY_RAIN_ZIP ?? join(REPO, 'var/samples/mswep-2025-10.zip'),
  title: 'Kiểm thử S1 — Mưa ngày MSWEP, 23–29/10/2025',
  abstract: 'MSWEP, các ngày 2025296–2025302 (tệp .nc theo ngày, nén zip).',
  pattern: 'YYYYDDD',
};
const DEPTH_QUERY = 'thubon';
const RAIN_QUERY = 'MSWEP';
const VECTOR_QUERY = process.env.VERIFY_VECTOR_QUERY ?? 'kiem_thu_s1';
const DEPTH_STEPS = 73;
const RAIN_STEPS = 7;
/** Step 3's slider time and the TIME the map request must carry. */
const AT = '2025-10-26T05:00:00.000Z';
const AT_TEXT = '26/10/2025 12:00';
/** The points of the vector test entry (as uploaded to GeoNode), lon/lat. */
const VECTOR_POINTS = [[108.1203, 15.8436], [108.326, 15.8794], [108.24, 15.865]];
const MAP_TITLE = 'Kiểm thử S1 — Danh mục';
const GROUP_OWN = 'Của tôi';
const GROUP_SHARED = 'Được chia sẻ với tôi';
const GONE_TEXT = 'Không có quyền xem hoặc đã bị xoá';

// ---- Reporting -------------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let failed = false;
function line(status, viewport, id, name, detail) {
  if (status === 'FAIL') failed = true;
  const text = `${status.padEnd(7)} ${String(viewport).padEnd(4)} ${id.padEnd(3)} ${name}`;
  console.log(detail ? `${text}\n          ${detail}` : text);
}

/** Runs one step. `fn` returns a list of problems (empty: PASS); a thrown error is a FAIL. */
async function check(viewport, id, name, fn) {
  try {
    const problems = await fn();
    if (problems.length === 0) line('PASS', viewport, id, name);
    else line('FAIL', viewport, id, name, problems.join('\n          '));
    return problems.length === 0;
  } catch (error) {
    line('FAIL', viewport, id, name, `error: ${error.message.split('\n')[0]}`);
    // What each open page showed when the step threw.
    for (const s of openSessions) {
      const path = join(OUT, `verify-catalogue-fail-${id}-${s.who}-${viewport}.png`);
      await s.page.screenshot({ path }).then(() => console.log(`shot    ${String(viewport).padEnd(4)} ${path} (${s.page.url()})`), () => {});
    }
    return false;
  }
}
/** The sessions open now, for the screenshots of a failed step. */
const openSessions = new Set();
const note = (vp, text) => console.log(`note    ${String(vp).padEnd(4)} ${text}`);

// ---- The API ---------------------------------------------------------------------------------

/** One API call; a 429 waits as long as the API asks and tries again. */
async function api(method, path, token, body) {
  let res;
  for (let attempt = 0; ; attempt += 1) {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 429 || attempt === 3) break;
    await res.text();
    await sleep((Number(res.headers.get('retry-after')) || 20) * 1000 + 500);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

async function read(path, token) {
  const res = await api('GET', path, token);
  if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}: ${res.json?.error?.message ?? ''}`);
  return res.json;
}

const WS = '/api/workspace';

/** The visible catalogue entries whose title is exactly `title`. */
async function findEntries(token, query, title) {
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await read(`/api/catalogue/search?${new URLSearchParams({ q: query, page: String(page) })}`, token);
    out.push(...r.items.filter((i) => i.title === title));
    if (page * r.pageSize >= r.total) break;
  }
  return out;
}

async function deleteTestMaps(token) {
  const problems = [];
  const maps = await read(`${WS}/maps`, token);
  for (const m of maps.mine.filter((x) => x.title === MAP_TITLE)) {
    const detail = await api('GET', `${WS}/maps/${m.id}`, token);
    if (detail.status !== 200) continue;
    const res = await api('DELETE', `${WS}/maps/${m.id}`, token, { expectedRevision: detail.json.map.revision });
    if (![200, 204].includes(res.status)) problems.push(`DELETE map ${m.id} answered ${res.status}`);
  }
  return problems;
}

// ---- The browser -----------------------------------------------------------------------------

/** Counts map-drawing requests in flight; the returned function waits for QUIET_MS without any. */
function trackDrawing(page) {
  let inFlight = 0;
  let lastChange = Date.now();
  page.on('request', (r) => { if (DRAW_REQUEST.test(r.url())) { inFlight += 1; lastChange = Date.now(); } });
  const done = (r) => { if (DRAW_REQUEST.test(r.url())) { inFlight = Math.max(0, inFlight - 1); lastChange = Date.now(); } };
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

/** Every request to a catalogue entry's map proxy: `{ id, params }` with upper-case param names. */
function trackProxy(page) {
  const seen = [];
  page.on('request', (r) => {
    const m = /\/api\/catalogue\/([^/]+)\/wms(\?|$)/.exec(r.url());
    if (!m) return;
    const params = {};
    for (const [k, v] of new URL(r.url()).searchParams) params[k.toUpperCase()] = v;
    seen.push({ id: decodeURIComponent(m[1]), params, at: Date.now() });
  });
  return seen;
}

async function openSession(browser, viewport, who) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  // A reload on a loaded dev machine (Vite serves hundreds of modules) can pass the 30 s default.
  page.setDefaultNavigationTimeout(180000);
  // The slider and the hover label show local time; the readers (and the HEC-RAS model clock,
  // imported with the default hdfTimeZone) are in Vietnam time.
  await page.emulateTimezone('Asia/Ho_Chi_Minh');
  page.on('pageerror', (error) => console.log(`pageerror ${viewport.width}  ${String(error.message ?? error).split('\n')[0]}`));
  page.on('response', (response) => {
    if (response.status() === 429) note(viewport.width, `the API answered 429 to ${response.request().method()} ${response.url().replace(API_URL, '')}`);
  });
  const settle = trackDrawing(page);
  const proxy = trackProxy(page);
  // /ban-do: the map page (/ is the hub, drawn over the map).
  await page.goto(`${BASE_URL}/ban-do`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 180000 });
  await settle();
  const session = { context, page, settle, proxy, vp: viewport.width, who };
  openSessions.add(session);
  return session;
}

/** Resolves once the map has rendered everything it has (or after 15 s). */
async function waitRender(page) {
  await page.evaluate(() => new Promise((done) => {
    const map = window.__olMap;
    if (!map) { done(false); return; }
    const timer = setTimeout(() => done(false), 15000);
    map.once('rendercomplete', () => { clearTimeout(timer); done(true); });
    map.render();
  }));
  await sleep(300);
}

async function shot(session, name) {
  await session.settle();
  await waitRender(session.page);
  const path = join(OUT, `verify-catalogue-${name}-${session.vp}.png`);
  await session.page.screenshot({ path });
  console.log(`shot    ${String(session.vp).padEnd(4)} ${path}`);
}

const text = (page, selector) => page.evaluate((s) => {
  const all = document.querySelectorAll(s);
  const el = all[all.length - 1];
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}, selector);

/** Clicks the enabled button whose text (or aria-label) is `label` inside the last match of `selector`. */
async function click(page, selector, label) {
  const done = await page.evaluate((s, l) => {
    const all = document.querySelectorAll(s);
    const root = all[all.length - 1];
    const norm = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    const b = root && [...root.querySelectorAll('button')]
      .find((x) => (norm(x) === l || x.getAttribute('aria-label') === l) && !x.disabled);
    b?.click();
    return Boolean(b);
  }, selector, label);
  if (!done) throw new Error(`no enabled button "${label}" in ${selector}`);
}

async function waitText(page, selector, wanted, timeout, failures = []) {
  const start = Date.now();
  let now = '';
  while (Date.now() - start < timeout) {
    now = await text(page, selector);
    if (now.includes(wanted)) return now;
    const bad = failures.find((f) => now.includes(f));
    if (bad) throw new Error(`${selector} says "${bad}": ${now.slice(-300)}`);
    await sleep(500);
  }
  throw new Error(`${selector} never said "${wanted}": ${now.slice(-300)}`);
}

/** Signs in through Đăng nhập → Đăng nhập một lần → Keycloak's form; back on the map, signed in. */
async function signInSso(session, { username, password }) {
  const { page } = session;
  await click(page, '.top-bar', 'Đăng nhập');
  // The SSO button shows once /api/auth/config has answered.
  await page.waitForSelector('.login-sso button', { visible: true, timeout: 60000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    click(page, '.login-sso', 'Đăng nhập một lần'),
  ]);
  await page.waitForSelector('#username', { timeout: 60000 });
  await page.type('#username', username);
  await page.type('#password', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    page.click('#kc-login'),
  ]);
  try {
    await page.waitForFunction(() => Boolean(document.querySelector('.account-trigger')), { timeout: 60000 });
  } catch {
    throw new Error(`SSO sign-in did not finish on ${page.url()}: ${(await text(page, 'body')).slice(0, 200)}`);
  }
  await page.waitForSelector('.map-container canvas', { timeout: 180000 });
  await page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 120000 });
  await session.settle();
  const token = await page.evaluate(() => localStorage.getItem('webatlas.token'));
  if (!token) throw new Error('signed in, but no token in localStorage');
  return token;
}

/** Opens Thêm dữ liệu (Từ Danh mục tab) unless it is open. */
async function openAddData(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-group button')].find((x) => x.textContent.trim() === 'Thêm dữ liệu');
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
  });
  await page.waitForSelector('[role="tab"]', { visible: true, timeout: 10000 });
  const selected = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim());
  if (selected !== 'Từ Danh mục') await click(page, '[role="tablist"]', 'Từ Danh mục');
  await page.waitForSelector('.catalogue-picker', { visible: true, timeout: 10000 });
  return selected;
}

async function closeAddData(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tool-group button')].find((x) => x.textContent.trim() === 'Thêm dữ liệu');
    if (b && b.getAttribute('aria-expanded') === 'true') b.click();
  });
  await sleep(300);
}

/** Searches the catalogue in the picker and returns the result rows. */
async function search(page, query) {
  await openAddData(page);
  const input = '.catalogue-search input[type="search"]';
  await page.click(input, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(input, query);
  // Wait for this query's answer: the previous results stay on screen until it lands.
  const answered = page.waitForResponse((r) => {
    if (!r.url().includes('/api/catalogue/search')) return false;
    return new URL(r.url()).searchParams.get('q') === query.trim();
  }, { timeout: 60000 });
  await click(page, '.catalogue-search', 'Tìm');
  await answered;
  await sleep(300);
  await page.waitForFunction(() => {
    const p = document.querySelector('.catalogue-picker');
    return p && !p.querySelector('.spin') && (p.querySelector('.catalogue-results') || p.textContent.includes('Không có dữ liệu phù hợp.') || p.textContent.includes('Không kết nối được'));
  }, { timeout: 20000 });
  await sleep(300);
  return page.evaluate(() => [...document.querySelectorAll('.catalogue-result')].map((li) => ({
    title: li.querySelector('b')?.textContent.trim() ?? '',
    badge: li.querySelector('.badge')?.textContent.trim() ?? null,
    hint: li.querySelector('.hint')?.textContent.trim() ?? '',
    canAdd: Boolean(li.querySelector('button')),
  })));
}

/** Thêm vào bản đồ for the result titled `title`; waits for its row under Lớp từ Danh mục. */
async function addFromResults(page, title) {
  await click(page, '.catalogue-results', `Thêm vào bản đồ: ${title}`);
  await page.waitForFunction((t) => [...document.querySelectorAll('.catalogue-layer')]
    .some((li) => li.textContent.includes(t)), { timeout: 10000 }, title);
}

const catalogueRow = (title) => `.catalogue-layer[data-verify="${title.replace(/"/g, '')}"]`;

/** Tags the catalogue layer row titled `title` so later selectors can find it. */
async function tagRow(page, title) {
  const found = await page.evaluate((t) => {
    const li = [...document.querySelectorAll('.catalogue-layer')].find((x) => x.querySelector('.catalogue-layer-name, span')?.textContent.trim() === t);
    if (li) li.dataset.verify = t.replace(/"/g, '');
    return Boolean(li);
  }, title);
  if (!found) throw new Error(`no row "${title}" under Lớp từ Danh mục`);
  return catalogueRow(title);
}

const toMercator = ([lon, lat]) => [
  (lon * 20037508.34) / 180,
  (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180),
];

async function frame(session, bbox) {
  const [x0, y0] = toMercator([bbox[0], bbox[1]]);
  const [x1, y1] = toMercator([bbox[2], bbox[3]]);
  await session.page.evaluate((box) => {
    const map = window.__olMap;
    if (!map) throw new Error('window.__olMap is not exposed: run against the dev server');
    map.getView().fit(box, { size: map.getSize(), padding: [40, 40, 40, 40], duration: 0 });
  }, [x0, y0, x1, y1]);
  await sleep(800);
  await session.settle();
  await waitRender(session.page);
}

/** The slider's state, or null while it is not shown. */
const sliderState = (page) => page.evaluate(() => {
  const range = document.querySelector('.time-slider-range');
  if (!range) return null;
  return { max: Number(range.max), value: Number(range.value), text: document.querySelector('.time-slider-time')?.textContent.trim() ?? '' };
});

/** Moves the slider to step `index` the way a drag does (one input event). */
async function setSliderIndex(page, index) {
  await page.evaluate((i) => {
    const range = document.querySelector('.time-slider-range');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(range, String(i));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await sleep(300);
}

/** What the screen shows inside the map, one screenshot, as RGBA rows of the map's box. */
async function grabMap(page) {
  const png = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async (data) => {
    const r = document.querySelector('.map-container').getBoundingClientRect();
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const box = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    return { box, data: Array.from(ctx.getImageData(box.x, box.y, box.w, box.h).data) };
  }, png);
}

async function setRowOpacity(session, row, value) {
  await session.page.$eval(`${row} input[type="range"]`, (range, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(range, String(v));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await sleep(500);
  await session.settle();
  await waitRender(session.page);
}

/**
 * A window pixel where the layer of `row` draws: the screen is compared with the layer on and
 * off, and the changed pixel with the most changed neighbours (well inside the drawn area) that
 * nothing covers is returned.
 */
async function drawnPixel(session, row) {
  const { page } = session;
  // Opacity, not the checkbox: switching the only series layer off would also take the time
  // slider off the map, and its pixels would count as the layer's.
  const on = await grabMap(page);
  await setRowOpacity(session, row, 0);
  const off = await grabMap(page);
  await setRowOpacity(session, row, 1);
  const { w, h } = on.box;
  const STRIDE = 3;
  const changed = new Set();
  for (let y = 0; y < h; y += STRIDE) {
    for (let x = 0; x < w; x += STRIDE) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(on.data[i] - off.data[i]), Math.abs(on.data[i + 1] - off.data[i + 1]), Math.abs(on.data[i + 2] - off.data[i + 2]));
      if (d > 25) changed.add(`${x},${y}`);
    }
  }
  const scored = [...changed].map((k) => {
    const [x, y] = k.split(',').map(Number);
    let n = 0;
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) if (changed.has(`${x + dx * STRIDE},${y + dy * STRIDE}`)) n += 1;
    return { x: x + on.box.x, y: y + on.box.y, n };
  }).sort((a, b) => b.n - a.n);
  const covers = new Map();
  for (const c of scored.slice(0, 200)) {
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (el && document.querySelector('.map-container').contains(el)) return null;
      return el ? `${el.tagName.toLowerCase()}.${String(el.className)}` : 'nothing';
    }, c);
    if (hit === null) return { ...c, changed: changed.size };
    covers.set(hit, (covers.get(hit) ?? 0) + 1);
  }
  return { x: null, y: null, n: 0, changed: changed.size, covers: [...covers].map(([k, n]) => `${k} ×${n}`).join(', '),
    best: scored[0] && { x: scored[0].x, y: scored[0].y } };
}

/** Problems with how the elements matching `selector` sit in the side panel. */
const fitsInPanel = (page, selector) => page.evaluate((sel) => {
  const out = [];
  const body = document.querySelector('.side-panel-body') ?? document.querySelector('.side-panel');
  if (!body) return ['no side panel on the page'];
  const panel = body.getBoundingClientRect();
  if (body.scrollWidth > body.clientWidth + 0.5) out.push(`the side panel scrolls sideways (${body.scrollWidth}px in ${body.clientWidth}px)`);
  if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
  const els = [...document.querySelectorAll(sel)];
  if (els.length === 0) return [`nothing matches ${sel}`];
  for (const el of els) {
    const kids = [...el.children].filter((k) => k.getBoundingClientRect().width > 0);
    for (const k of [el, ...el.querySelectorAll('*')]) {
      const r = k.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > panel.right + 0.5 || r.left < panel.left - 0.5) out.push(`${sel} ${k.tagName.toLowerCase()}.${k.className} sticks out of the panel (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(panel.left)}–${Math.round(panel.right)})`);
      if (k.scrollWidth > k.clientWidth + 1 && getComputedStyle(k).overflowX !== 'visible') out.push(`${sel} ${k.tagName.toLowerCase()}.${k.className} clips its content`);
    }
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          out.push(`${sel}: ${kids[i].tagName.toLowerCase()}.${kids[i].className} overlaps ${kids[j].tagName.toLowerCase()}.${kids[j].className}`);
        }
      }
    }
  }
  return [...new Set(out)].slice(0, 8);
}, selector);

/** A screenshot of the side panel only. */
async function panelShot(session, name) {
  const el = await session.page.$('.side-panel');
  const path = join(OUT, `verify-catalogue-${name}-${session.vp}.png`);
  if (el) await el.screenshot({ path });
  else await session.page.screenshot({ path });
  console.log(`shot    ${String(session.vp).padEnd(4)} ${path}`);
}

/** The map card titled MAP_TITLE under `group`: expanded, its layer rows listed. */
async function openCard(page, group) {
  await page.waitForFunction((t, g) => [...document.querySelectorAll('.my-maps ul.my-map-list')].some((ul) => {
    const head = ul.previousElementSibling;
    return head && head.textContent.trim() === g && [...ul.children].some((li) => li.querySelector('.my-map-title')?.textContent.trim() === t);
  }), { timeout: 30000 }, MAP_TITLE, group);
  await page.evaluate((t, g) => {
    for (const ul of document.querySelectorAll('.my-maps ul.my-map-list')) {
      if (ul.previousElementSibling?.textContent.trim() !== g) continue;
      for (const li of ul.children) {
        if (li.querySelector('.my-map-title')?.textContent.trim() !== t) continue;
        li.dataset.verify = 'card';
        const head = li.querySelector('.my-map-head');
        if (head.getAttribute('aria-expanded') !== 'true') head.click();
      }
    }
  }, MAP_TITLE, group);
  await sleep(1500);
}

const cardRows = (page) => page.evaluate(() => [...document.querySelectorAll('[data-verify="card"] .my-maps-layer')].map((r) => ({
  title: (r.querySelector('.layer-label span') ?? r.querySelector('.layer-label'))?.textContent.trim() ?? '',
  gone: r.classList.contains('gone'),
  text: r.textContent.replace(/\s+/g, ' ').trim(),
  checked: r.querySelector('input[type="checkbox"]')?.checked ?? null,
})));

const olCatalogueIds = (page) => page.evaluate(() => window.__olMap.getAllLayers()
  .map((l) => l.get('catalogueItem')?.id).filter(Boolean));

// ---- Steps -----------------------------------------------------------------------------------

/** U1/U2: one time-series upload through the dialog, timed. */
async function uploadSeries(session, entry) {
  const { page } = session;
  if (!existsSync(entry.file)) throw new Error(`${entry.file} does not exist`);
  await openAddData(page);
  await click(page, '.catalogue-picker', 'Tải chuỗi thời gian lên');
  await page.waitForSelector('#ts-file', { timeout: 10000 });
  const t0 = Date.now();
  let queuedAt = null;
  const onResponse = (r) => {
    if (r.url().includes('/api/catalogue/timeseries') && r.request().method() === 'POST') queuedAt = Date.now();
  };
  page.on('response', onResponse);
  try {
    await (await page.$('#ts-file')).uploadFile(entry.file);
    await page.type('#ts-title', entry.typed ?? entry.title);
    await page.type('#ts-abstract', entry.abstract);
    if (entry.pattern) await page.select('#ts-pattern', entry.pattern);
    await click(page, ':is([role="dialog"],[role="alertdialog"])', 'Tải lên');
    await waitText(page, ':is([role="dialog"],[role="alertdialog"])', 'Đã thêm chuỗi thời gian vào bản đồ.', UPLOAD_TIMEOUT_MS, ['Xử lý không thành công', 'Chưa tải lên được', 'Lỗi']);
    const done = Date.now();
    console.log(`time    ${String(session.vp).padEnd(4)} ${entry.title}: upload ${queuedAt ? Math.round((queuedAt - t0) / 1000) : '?'} s, job ${queuedAt ? Math.round((done - queuedAt) / 1000) : '?'} s, total ${Math.round((done - t0) / 1000)} s`);
    await click(page, ':is([role="dialog"],[role="alertdialog"])', 'Đóng');
    await page.waitForFunction(() => !document.querySelector(':is([role="dialog"],[role="alertdialog"])'), { timeout: 10000 });
    return [];
  } finally {
    page.off('response', onResponse);
  }
}

/** Steps 1–2 as the owner. */
async function stepSearchAndAdd(session, ctx) {
  const { page } = session;
  const problems = [];
  const tab = await openAddData(page);
  if (tab !== 'Từ Danh mục') problems.push(`Thêm dữ liệu opened on "${tab}", expected Từ Danh mục`);
  const rows = await search(page, DEPTH_QUERY);
  const depth = rows.find((r) => r.title === DEPTH.title);
  const peak = rows.find((r) => r.title === PEAK_TITLE);
  if (!depth) problems.push(`no result "${DEPTH.title}" for ${DEPTH_QUERY}: ${rows.map((r) => r.title).join(' | ')}`);
  else {
    if (depth.badge !== 'Chưa duyệt') problems.push(`the depth entry's badge is "${depth.badge}", expected Chưa duyệt`);
    if (!depth.hint.startsWith('Chuỗi thời gian')) problems.push(`the depth entry reads "${depth.hint}", expected Chuỗi thời gian`);
  }
  if (!peak) problems.push(`no result "${PEAK_TITLE}"`);
  else if (!peak.hint.startsWith('Raster')) problems.push(`the peak entry reads "${peak.hint}", expected Raster`);
  await shot(session, 'tim-thubon');
  return problems;
}

async function stepAddDepth(session, ctx) {
  const { page } = session;
  const problems = [];
  await addFromResults(page, DEPTH.title);
  ctx.depthRow = await tagRow(page, DEPTH.title);
  await page.waitForSelector('.time-slider-range', { timeout: 10000 });
  const s = await sliderState(page);
  if (s.max + 1 !== DEPTH_STEPS) problems.push(`the slider has ${s.max + 1} steps, expected ${DEPTH_STEPS}`);
  if (s.text !== '25/10/2025 00:00') problems.push(`the slider starts at "${s.text}", expected 25/10/2025 00:00`);
  const steps = ctx.depth.timeSteps ?? [];
  if (steps.length !== DEPTH_STEPS) problems.push(`the entry has ${steps.length} time steps, expected ${DEPTH_STEPS}`);
  // 25/10 00:00 → 28/10 00:00 in Vietnam time (UTC+7), the default hdfTimeZone.
  if (steps[0] !== '2025-10-24T17:00:00.000Z' || steps[steps.length - 1] !== '2025-10-27T17:00:00.000Z') {
    problems.push(`the entry's steps run ${steps[0]} → ${steps[steps.length - 1]}, expected 2025-10-24T17:00Z → 2025-10-27T17:00Z (imported as Vietnam time)`);
  }
  await closeAddData(page);
  await frame(session, ctx.depth.bbox4326);
  await shot(session, 'do-sau-buoc-dau');
  return problems;
}

/** Step 3. */
async function stepTime(session, ctx) {
  const { page, proxy } = session;
  const problems = [];
  const index = ctx.depth.timeSteps.indexOf(AT);
  if (index < 0) return [`the entry has no step ${AT}`];
  const from = proxy.length;
  await setSliderIndex(page, index);
  await session.settle();
  await waitRender(page);
  const s = await sliderState(page);
  if (s.text !== AT_TEXT) problems.push(`the slider reads "${s.text}", expected ${AT_TEXT}`);
  const maps = proxy.slice(from).filter((r) => r.id === ctx.depth.id && r.params.REQUEST === 'GetMap');
  if (!maps.some((r) => r.params.TIME === AT)) {
    problems.push(`no GetMap with TIME=${AT}; sent: ${maps.map((r) => r.params.TIME).join(', ') || 'none'}`);
  }
  if (maps.some((r) => r.params.LAYERS !== ctx.depth.layerName)) problems.push('a GetMap names another layer');
  await shot(session, 'do-sau-26-10-12h');
  return problems;
}

/** Step 4. */
async function stepHover(session, ctx) {
  const { page, proxy } = session;
  const problems = [];
  const spot = await drawnPixel(session, ctx.depthRow);
  if (spot.x === null) {
    return [`no uncovered pixel where the depth layer draws (${spot.changed} changed pixels; best ${JSON.stringify(spot.best)}; covered by ${spot.covers || '-'})`];
  }
  const from = proxy.length;
  await page.mouse.move(spot.x - 3, spot.y - 3);
  await sleep(100);
  await page.mouse.move(spot.x, spot.y);
  let tip = '';
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('.catalogue-hover-tip');
      return el && !el.hidden && el.textContent.trim() !== '';
    }, { timeout: 10000 });
    tip = await text(page, '.catalogue-hover-tip');
  } catch {
    problems.push(`no value label at (${spot.x}, ${spot.y})`);
  }
  const infos = proxy.slice(from).filter((r) => r.id === ctx.depth.id && r.params.REQUEST === 'GetFeatureInfo');
  if (infos.length === 0) problems.push('no GetFeatureInfo went out');
  else if (infos.some((r) => r.params.INFO_FORMAT !== 'application/json' || r.params.TIME !== AT)) {
    problems.push(`GetFeatureInfo params: ${JSON.stringify(infos[0].params).slice(0, 300)}`);
  }
  const m = /^(\d+(?:\.\d{3})*,\d{2}) m · (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/.exec(tip);
  if (tip && !m) problems.push(`the label reads "${tip}", expected "<n>,<nn> m · ${AT_TEXT}"`);
  else if (m) {
    const value = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (!(value > 0.05)) problems.push(`the depth reads ${value} m, expected more than 0,05 m inside the flood`);
    if (m[2] !== AT_TEXT) problems.push(`the label's time is ${m[2]}, expected ${AT_TEXT}`);
    console.log(`          ${session.vp}: "${tip}" at (${spot.x}, ${spot.y})`);
  }
  await shot(session, 're-chuot-do-sau');
  return problems;
}

/** Step 5. */
async function stepRainAndPlay(session, ctx) {
  const { page, proxy } = session;
  const problems = [];
  const rows = await search(page, RAIN_QUERY);
  const rain = rows.find((r) => r.title === RAIN.title);
  if (!rain) return [`no result "${RAIN.title}" for ${RAIN_QUERY}`];
  if (rain.badge !== 'Chưa duyệt') problems.push(`the rain entry's badge is "${rain.badge}"`);
  await addFromResults(page, RAIN.title);
  ctx.rainRow = await tagRow(page, RAIN.title);
  await closeAddData(page);
  const steps = ctx.rain.timeSteps ?? [];
  if (steps.length !== RAIN_STEPS) problems.push(`the rain entry has ${steps.length} steps, expected ${RAIN_STEPS}`);
  const union = new Set([...ctx.depth.timeSteps, ...steps].map((t) => Date.parse(t))).size;
  const s = await sliderState(page);
  if (s.max + 1 !== union) problems.push(`the slider has ${s.max + 1} steps with both layers, expected ${union}`);
  if (s.text !== AT_TEXT) problems.push(`adding the rain moved the slider to "${s.text}"`);
  await session.settle();
  const firstRain = proxy.filter((r) => r.id === ctx.rain.id && r.params.REQUEST === 'GetMap').pop();
  const rainAt = (t) => [...steps].filter((x) => Date.parse(x) <= Date.parse(t)).sort().pop();
  if (!firstRain || firstRain.params.TIME !== rainAt(AT)) problems.push(`the rain layer asked TIME=${firstRain?.params.TIME}, expected ${rainAt(AT)}`);
  // Play at 4× for 6 s: 24 steps of the union, past the next day's rain step (19 hourly steps
  // from 12:00 Vietnam time to the 07:00 rain day boundary, 00:00 UTC).
  await click(page, '.time-slider-speeds', '4×');
  const from = proxy.length;
  await click(page, '.time-slider', 'Phát');
  await sleep(6000);
  await click(page, '.time-slider', 'Tạm dừng');
  const sent = proxy.slice(from).filter((r) => r.params.REQUEST === 'GetMap');
  const depthTimes = new Set(sent.filter((r) => r.id === ctx.depth.id).map((r) => r.params.TIME));
  const rainTimes = new Set(sent.filter((r) => r.id === ctx.rain.id).map((r) => r.params.TIME));
  if (depthTimes.size < 5) problems.push(`while playing the depth layer asked ${depthTimes.size} times: ${[...depthTimes].join(', ')}`);
  const nextDay = steps.find((t) => Date.parse(t) > Date.parse(AT));
  if (!rainTimes.has(nextDay)) problems.push(`while playing the rain layer asked ${[...rainTimes].join(', ') || 'nothing'}, expected ${nextDay}`);
  const after = await sliderState(page);
  console.log(`          ${session.vp}: played to ${after.text}; depth ${depthTimes.size} times, rain ${[...rainTimes].join(', ')}`);
  await shot(session, 'mua-va-do-sau');
  // Back to step 3's time for the steps after.
  await setSliderIndex(page, [...new Set([...ctx.depth.timeSteps, ...steps])].sort().indexOf(AT));
  return problems;
}

/** Opens the save picker of a catalogue row (`mode` link | copy) and picks the test map. */
async function openSave(session, row, mode, mapId) {
  const { page } = session;
  await click(page, `${row} .catalogue-layer-save`, mode === 'copy' ? 'Sao vào Bản của tôi' : 'Lưu vào bản đồ của tôi');
  await page.waitForSelector(`${row} .catalogue-save select`, { timeout: 10000 });
  await page.select(`${row} .catalogue-save select`, mapId);
}

/** Step 6: copies of the peak raster and the vector entry. */
async function stepCopies(session, ctx) {
  const { page } = session;
  const problems = [];
  // The peak raster.
  await search(page, DEPTH_QUERY);
  await addFromResults(page, PEAK_TITLE);
  const peakRow = await tagRow(page, PEAK_TITLE);
  await closeAddData(page);
  await openSave(session, peakRow, 'copy', ctx.mapId);
  problems.push(...(await fitsInPanel(page, `${peakRow} .catalogue-layer-save`)), ...(await fitsInPanel(page, `${peakRow} .catalogue-save`)));
  await panelShot(session, 'chon-ban-do-sao');
  const tCopy = Date.now();
  await click(page, `${peakRow} .catalogue-save`, 'Sao');
  await waitText(page, `${peakRow} .catalogue-save`, 'Đã sao vào', COPY_TIMEOUT_MS, ['Chưa sao được', 'Lỗi', 'không']);
  console.log(`time    ${String(session.vp).padEnd(4)} copy of the peak raster: ${Math.round((Date.now() - tCopy) / 1000)} s`);
  problems.push(...(await fitsInPanel(page, `${peakRow} .catalogue-save`)));
  await panelShot(session, 'da-sao-raster');
  // The vector entry (published, someone else's).
  const rows = await search(page, VECTOR_QUERY);
  const vector = rows.find((r) => r.hint.startsWith('Vector'));
  if (!vector) {
    problems.push(`no vector result for ${VECTOR_QUERY}`);
  } else {
    if (vector.badge) problems.push(`the vector entry has the badge "${vector.badge}" (expected published)`);
    await addFromResults(page, vector.title);
    const vectorRow = await tagRow(page, vector.title);
    await closeAddData(page);
    await openSave(session, vectorRow, 'copy', ctx.mapId);
    const tVec = Date.now();
    await click(page, `${vectorRow} .catalogue-save`, 'Sao');
    await waitText(page, `${vectorRow} .catalogue-save`, 'Đã sao vào', COPY_TIMEOUT_MS, ['Chưa sao được', 'Lỗi', 'không']);
    console.log(`time    ${String(session.vp).padEnd(4)} copy of the vector entry: ${Math.round((Date.now() - tVec) / 1000)} s`);
  }
  // Where the copies landed.
  const map = (await read(`${WS}/maps/${ctx.mapId}`, ctx.ownerToken)).map;
  const raster = map.layers.find((l) => l.kind === 'raster');
  if (!raster) problems.push(`the test map has no raster layer: ${map.layers.map((l) => `${l.kind}:${l.title}`).join(', ')}`);
  else {
    const b = raster.raster?.bounds4326;
    const e = ctx.peak.bbox4326;
    const off = b && e ? Math.max(...b.map((v, i) => Math.abs(v - e[i]))) : Infinity;
    console.log(`          ${session.vp}: raster copy bounds ${JSON.stringify(b)}; entry ${JSON.stringify(e)}`);
    if (!(off < 0.02)) problems.push(`the raster copy's bounds ${JSON.stringify(b)} differ from the entry's ${JSON.stringify(e)} by ${off}°`);
  }
  const vectorLayer = map.layers.find((l) => l.kind === 'free');
  if (vector && !vectorLayer) problems.push(`the test map has no vector layer: ${map.layers.map((l) => `${l.kind}:${l.title}`).join(', ')}`);
  else if (vectorLayer) {
    const fc = await read(`${WS}/maps/${ctx.mapId}/layers/${vectorLayer.id}/features?bbox=-180,-90,180,90`, ctx.ownerToken);
    const got = fc.features.map((f) => f.geometry?.coordinates);
    console.log(`          ${session.vp}: vector copy points ${JSON.stringify(got)}`);
    if (got.length !== VECTOR_POINTS.length) problems.push(`the vector copy has ${got.length} features, expected ${VECTOR_POINTS.length}`);
    for (const p of VECTOR_POINTS) {
      if (!got.some((c) => Array.isArray(c) && Math.abs(c[0] - p[0]) < 1e-5 && Math.abs(c[1] - p[1]) < 1e-5)) {
        problems.push(`no copied point at lon ${p[0]}, lat ${p[1]} (axis order?)`);
      }
    }
  }
  await frame(session, ctx.peak.bbox4326);
  await shot(session, 'ban-sao');
  return problems;
}

/** Step 7: the depth and rain links saved, then a reload restores them. */
async function stepLinks(session, ctx) {
  const { page } = session;
  const problems = [];
  for (const [row, entry] of [[ctx.depthRow, DEPTH], [ctx.rainRow, RAIN]]) {
    await openSave(session, row, 'link', ctx.mapId);
    await click(page, `${row} .catalogue-save`, 'Lưu');
    await page.waitForFunction((t) => ![...document.querySelectorAll('.catalogue-layer')].some((li) => li.textContent.includes(t)),
      { timeout: 15000 }, entry.title);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 180000 });
  await page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 120000 });
  await openCard(page, GROUP_OWN);
  await page.waitForFunction(() => document.querySelectorAll('[data-verify="card"] .my-maps-layer').length >= 4, { timeout: 30000 })
    .catch(() => {});
  const rows = await cardRows(page);
  for (const entry of [DEPTH, RAIN]) {
    const r = rows.find((x) => x.title === entry.title);
    if (!r) problems.push(`after the reload the map has no row "${entry.title}": ${rows.map((x) => x.title).join(' | ')}`);
    else if (r.gone) problems.push(`the owner's link "${entry.title}" shows as gone`);
  }
  // Turn the links on if the reload left them off, then check they draw and drive the slider.
  await page.evaluate((titles) => {
    for (const r of document.querySelectorAll('[data-verify="card"] .my-maps-layer')) {
      const t = r.querySelector('.layer-label span')?.textContent.trim();
      const box = r.querySelector('input[type="checkbox"]');
      if (titles.includes(t) && box && !box.checked) box.click();
    }
  }, [DEPTH.title, RAIN.title]);
  await sleep(1500);
  await session.settle();
  const ids = await olCatalogueIds(page);
  for (const [entry, item] of [[DEPTH, ctx.depth], [RAIN, ctx.rain]]) {
    if (!ids.includes(item.id)) problems.push(`after the reload no map layer shows "${entry.title}"`);
  }
  const s = await sliderState(page);
  const union = new Set([...ctx.depth.timeSteps, ...ctx.rain.timeSteps].map((t) => Date.parse(t))).size;
  if (!s) problems.push('after the reload the time slider is gone');
  else if (s.max + 1 !== union) problems.push(`after the reload the slider has ${s.max + 1} steps, expected ${union}`);
  await frame(session, ctx.depth.bbox4326);
  await shot(session, 'tai-lai-lien-ket');
  return problems;
}

/** Step 8: the second account. */
async function stepSecondUser(second, owner, ctx) {
  const { page } = second;
  const problems = [];
  const token = await signInSso(second, ACCOUNTS.second);
  for (const q of [DEPTH_QUERY, RAIN_QUERY]) {
    const rows = await search(page, q);
    const leaked = rows.filter((r) => [DEPTH.title, PEAK_TITLE, RAIN.title].includes(r.title));
    if (leaked.length > 0) problems.push(`the second account finds ${leaked.map((r) => r.title).join(', ')} searching ${q}`);
    if (rows.length === 0 && !(await text(page, '.catalogue-picker')).includes('Không có dữ liệu phù hợp.')) {
      problems.push(`searching ${q}, the picker does not say "Không có dữ liệu phù hợp."`);
    }
  }
  await shot(second, 'nguoi-thu-hai-tim');
  for (const item of [ctx.depth, ctx.peak, ctx.rain]) {
    const res = await api('GET', `/api/catalogue/${item.id}`, token);
    if (res.status !== 404) problems.push(`GET /api/catalogue/<${item.title}> answered ${res.status} to the second account`);
    const wms = await fetch(`${API_URL}/api/catalogue/${item.id}/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=x&STYLES=&CRS=EPSG:3857&BBOX=0,0,1,1&WIDTH=1&HEIGHT=1&FORMAT=image/png`, { headers: { authorization: `Bearer ${token}` } });
    if (![403, 404].includes(wms.status)) problems.push(`the map proxy answered ${wms.status} to the second account for ${item.title}`);
  }
  if (ctx.vectorId) {
    const res = await api('GET', `/api/catalogue/${ctx.vectorId}`, token);
    if (res.status !== 200) problems.push(`the published vector entry answered ${res.status} to the second account`);
  }
  // The owner shares the test map: the links are gone for the second account, the copies are not.
  const me = (await read('/api/auth/me', token)).user;
  const share = await api('POST', `${WS}/maps/${ctx.mapId}/shares`, ctx.ownerToken, { userId: me.id });
  if (![200, 201].includes(share.status)) return [...problems, `sharing the test map answered ${share.status}: ${share.json?.error?.message ?? ''}`];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 120000 });
  await openCard(page, GROUP_SHARED);
  await page.waitForFunction(() => document.querySelectorAll('[data-verify="card"] .my-maps-layer').length >= 4, { timeout: 30000 })
    .catch(() => {});
  const rows = await cardRows(page);
  for (const entry of [DEPTH, RAIN]) {
    const r = rows.find((x) => x.title === entry.title || x.text.startsWith(entry.title));
    if (!r) problems.push(`the shared map has no row "${entry.title}": ${rows.map((x) => x.title).join(' | ')}`);
    else if (!r.gone || !r.text.includes(GONE_TEXT)) problems.push(`the link "${entry.title}" is not gone for the second account: ${r.text}`);
  }
  const ordinary = rows.filter((r) => !r.gone);
  if (ordinary.length < 2) problems.push(`the copies do not show as ordinary rows: ${rows.map((r) => `${r.gone ? '(gone) ' : ''}${r.title}`).join(' | ')}`);
  const ids = await olCatalogueIds(page);
  if (ids.includes(ctx.depth.id) || ids.includes(ctx.rain.id)) problems.push('a gone link is still drawn on the second account\'s map');
  problems.push(...(await fitsInPanel(page, '[data-verify="card"] .my-maps-layer.gone')));
  await page.$eval('[data-verify="card"]', (el) => el.scrollIntoView({ block: 'start' }));
  await panelShot(second, 'lien-ket-mat-quyen');
  await shot(second, 'nguoi-thu-hai-ban-do');
  // Back to the owner: nothing changed for them.
  if (owner) await owner.page.bringToFront();
  return problems;
}

// ---- One viewport ----------------------------------------------------------------------------

async function runViewport(browser, viewport, ctx) {
  const vp = viewport.width;
  const owner = await openSession(browser, viewport, 'owner');
  let second = null;
  try {
    const signed = await check(vp, '1a', 'the owner signs in through SSO (Keycloak)', async () => {
      ctx.ownerToken = await signInSso(owner, ACCOUNTS.owner);
      return [];
    });
    if (!signed) return;
    const leftovers = await deleteTestMaps(ctx.ownerToken);
    if (leftovers.length > 0) throw new Error(`could not clear an earlier run: ${leftovers.join('; ')}`);

    if (UPLOAD && ctx.uploadsPending) {
      for (const [id, entry] of [['U1', DEPTH], ['U2', RAIN]]) {
        if ((await findEntries(ctx.ownerToken, entry.title, entry.title)).length > 0) {
          note(vp, `${entry.title} is in the catalogue already: no upload`);
          continue;
        }
        await check(vp, id, `upload ${entry.file.split(/[\\/]/).pop()} through Tải chuỗi thời gian lên`, () => uploadSeries(owner, entry));
        await owner.page.reload({ waitUntil: 'domcontentloaded' });
        await owner.page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 120000 });
      }
      ctx.uploadsPending = false;
    }

    const found = await check(vp, '0', 'the test entries are in the catalogue (depth, its peak, rain; a published vector)', async () => {
      const problems = [];
      const one = async (q, title) => {
        const all = await findEntries(ctx.ownerToken, q, title);
        if (all.length !== 1) problems.push(`${all.length} entries titled "${title}"${all.length === 0 ? ' (run with --upload)' : ''}`);
        return all[0];
      };
      ctx.depth = await one(DEPTH_QUERY, DEPTH.title);
      ctx.peak = await one(DEPTH_QUERY, PEAK_TITLE);
      ctx.rain = await one(RAIN_QUERY, RAIN.title);
      const vectors = (await read(`/api/catalogue/search?${new URLSearchParams({ q: VECTOR_QUERY, kind: 'vector' })}`, ctx.ownerToken)).items;
      ctx.vectorId = vectors.find((v) => v.isPublished)?.id ?? null;
      if (!ctx.vectorId) problems.push(`no published vector entry for "${VECTOR_QUERY}"`);
      return problems;
    });
    if (!found) return;
    const created = await api('POST', `${WS}/maps`, ctx.ownerToken, { title: MAP_TITLE });
    if (created.status !== 201 && created.status !== 200) throw new Error(`creating the test map answered ${created.status}`);
    ctx.mapId = created.json.map.id;
    // The save picker lists the maps it read at sign-in: read them again.
    await owner.page.reload({ waitUntil: 'domcontentloaded' });
    await owner.page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 120000 });
    await owner.settle();

    const searched = await check(vp, '1', `Thêm dữ liệu opens on Từ Danh mục; "${DEPTH_QUERY}" lists the depth entry with Chưa duyệt and its peak raster`,
      () => stepSearchAndAdd(owner, ctx));
    const added = searched && await check(vp, '2', `Thêm vào bản đồ: the row appears, the slider has ${DEPTH_STEPS} steps (25/10 00:00 → 28/10 00:00)`,
      () => stepAddDepth(owner, ctx));
    const timed = added && await check(vp, '3', `slider at ${AT_TEXT}: GetMap carries TIME=${AT}`, () => stepTime(owner, ctx));
    if (timed) await check(vp, '4', 'a pointer resting in the flooded river shows the depth in m', () => stepHover(owner, ctx));
    if (added) await check(vp, '5', 'the rain entry joins the slider; Phát plays both layers together', () => stepRainAndPlay(owner, ctx));
    await check(vp, '6', 'Sao vào Bản của tôi: the peak raster and a vector entry land where their sources are; the picker fits',
      () => stepCopies(owner, ctx));
    if (added && ctx.rainRow) {
      await check(vp, '7', 'Lưu vào bản đồ của tôi for depth and rain; after a reload the links are back and drive the slider',
        () => stepLinks(owner, ctx));
    }
    second = await openSession(browser, viewport, 'second');
    await check(vp, '8', 'a second account finds no unpublished entry (404 too); in the shared map the links are gone rows that fit',
      () => stepSecondUser(second, owner, ctx));
  } finally {
    for (const s of [second, owner]) if (s) openSessions.delete(s);
    await second?.context.close().catch(() => {});
    await owner.context.close().catch(() => {});
    if (ctx.ownerToken) {
      await check(vp, '9', 'cleanup through the API: the test map with its layers and copy jobs', () => deleteTestMaps(ctx.ownerToken));
    }
  }
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const ctx = { uploadsPending: true };
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox'],
    // A loaded machine can stall one page call well past the 180 s default.
    protocolTimeout: 600000,
  });
  try {
    console.log(`verify-catalogue against ${BASE_URL} and ${API_URL}; screenshots in ${OUT}`);
    for (const [i, viewport] of VIEWPORTS.entries()) {
      if (i > 0) await sleep(RATE_WINDOW_MS);
      try {
        await runViewport(browser, viewport, ctx);
      } catch (error) {
        line('FAIL', viewport.width, '-', `the run stopped: ${error.message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
