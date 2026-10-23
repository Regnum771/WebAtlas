/**
 * Proves in a real browser that personal maps work end to end, for an owner and a recipient:
 *
 *   1. The owner signs in, opens Bản của tôi and creates the map "Kiểm thử P3c".
 *   2. The owner uploads a small GeoJSON this script writes into --out (three points and one
 *      polygon in Đà Nẵng, with Vietnamese attribute values) and waits for "Đã nhập xong.". The
 *      layer row is on, and the map draws pixels where the features are: each spot is sampled
 *      with the layer on and off, and must change.
 *   2b. The same with a small GeoTIFF the script writes (3 bands, EPSG:4326, over Đà Nẵng); it
 *      draws through the raster code that loads on demand.
 *   3. The owner adds a drawn polygon layer with one text field, draws a polygon, fills the
 *      field and saves; a click on the polygon opens the feature card with the value.
 *   4. The owner exports as "Shapefile nén (.zip)" in vn2000-tm3-da-nang. The cut-name table
 *      shows what the API's preview lists, the file downloads, and the zip holds .cpg and .prj.
 *   5. The owner shares with the recipient. The recipient sees the map under "Được chia sẻ với
 *      tôi" with no Đổi tên / Xoá bản đồ / Chia sẻ, and makes a copy.
 *   6. The owner revokes the share. The recipient's next read (a zoom out re-reads the layers)
 *      answers 404: the map leaves the list with the toast, and its layers leave the map.
 *   7. At 768 only: nothing covers the scale bar or the coordinate readout, and neither the side
 *      panel nor the page scrolls sideways (owner with the map open, recipient with two maps open).
 *   8. Cleanup through the API: the export jobs, both "Kiểm thử P3c" maps (one per viewport), the
 *      recipient's copies and the uploads are deleted, and the two accounts' maps, uploads and
 *      jobs are compared with what they held at the start. The script deletes no file itself;
 *      deleted exports and rasters are left to the workspace cleanup sweep, as in the app.
 *
 * Every step runs at 1440x900 and at 768x900 and prints one PASS / FAIL line, then the script
 * exits non-zero on any FAIL. A rerun first removes what an interrupted run left (maps titled
 * "Kiểm thử P3c", the recipient's copies of them, the uploads with this script's file names).
 * The API allows 100 requests a minute per address, shared by the browser and the script: the
 * script waits a minute between the two widths, retries its own calls on a 429, and prints a
 * `note` line for every 429 the app received.
 *
 * Credentials come only from the environment:
 *   VERIFY_OWNER_EMAIL / VERIFY_OWNER_PASSWORD           the owner of the test map
 *   VERIFY_RECIPIENT_EMAIL / VERIFY_RECIPIENT_PASSWORD   another account, the map is shared with it
 * Optional: BASE_URL (web, default http://localhost:5173), API_URL (default http://localhost:3001),
 * CHROME_PATH.
 *
 * Run: npm run verify:personal-maps -w @webatlas/web -- --out <dir> [--only 1440|768]
 * Needs: the Docker stack with the worker profile
 * (`docker compose -f infra/docker-compose.yml --profile worker up -d`), the API and `npm run dev:web`
 * (the dev server exposes the map as window.__olMap, which the script uses to frame Đà Nẵng).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const ACCOUNTS = {
  owner: { email: process.env.VERIFY_OWNER_EMAIL, password: process.env.VERIFY_OWNER_PASSWORD },
  recipient: { email: process.env.VERIFY_RECIPIENT_EMAIL, password: process.env.VERIFY_RECIPIENT_PASSWORD },
};
const missing = Object.entries(ACCOUNTS)
  .flatMap(([who, a]) => [!a.email && `VERIFY_${who.toUpperCase()}_EMAIL`, !a.password && `VERIFY_${who.toUpperCase()}_PASSWORD`])
  .filter(Boolean);
if (missing.length > 0) {
  console.error(`Set ${missing.join(', ')} (see the header of this script).`);
  process.exit(2);
}

const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg !== -1 ? process.argv[outArg + 1] : tmpdir());

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg !== -1 ? Number(process.argv[onlyArg + 1]) : null;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 900 },
].filter((v) => ONLY === null || v.width === ONLY);
/** Requests that draw the basemap; the page counts as settled after QUIET_MS without one in flight. */
const TILE_REQUEST = /gwc|wmts|tile|arcgis|google/i;
const QUIET_MS = 3000;
const SETTLE_CAP_MS = 60000;
const IMPORT_TIMEOUT_MS = 120000;
const EXPORT_TIMEOUT_MS = 120000;
/** The API's rate-limit window: 100 requests a minute per address. */
const RATE_WINDOW_MS = 61000;

// ---- The test data -------------------------------------------------------------------

const MAP_TITLE = 'Kiểm thử P3c';
const GROUP_OWN = 'Của tôi';
const GROUP_SHARED = 'Được chia sẻ với tôi';
const GEOJSON_NAME = 'kiem-thu-p3c-dia-diem.geojson';
const TIFF_NAME = 'kiem-thu-p3c-anh.tif';
/** The import names a single-layer file's layer after the file. */
const GEOJSON_LAYER = 'kiem-thu-p3c-dia-diem';
const TIFF_LAYER = 'kiem-thu-p3c-anh';
const DRAWN_LAYER = 'Vùng vẽ kiểm thử';
const DRAWN_FIELD = 'ghi_chu';
const DRAWN_VALUE = 'Khu vực kiểm thử — Hải Châu';
const EXPORT_CRS = 'vn2000-tm3-da-nang';
const MAP_GONE = 'Bản đồ này không còn được chia sẻ với anh/chị hoặc đã bị xoá.';

/** What the map is framed to: central Đà Nẵng, lon/lat. */
const VIEW_EXTENT = [108.12, 15.995, 108.265, 16.1];
const POINTS = [
  { at: [108.2272, 16.0611], ten_dia_diem: 'Cầu Rồng', loai_dia_diem: 'Cầu', ghi_chu: 'Phun lửa tối thứ Bảy' },
  { at: [108.2242, 16.0681], ten_dia_diem: 'Chợ Hàn', loai_dia_diem: 'Chợ', ghi_chu: 'Đặc sản miền Trung' },
  { at: [108.2475, 16.0545], ten_dia_diem: 'Bãi biển Mỹ Khê', loai_dia_diem: 'Bãi biển', ghi_chu: 'Nước trong, cát trắng' },
];
const POLYGON = [[108.205, 16.03], [108.228, 16.03], [108.228, 16.045], [108.205, 16.045], [108.205, 16.03]];
const POLYGON_INSIDE = [108.2165, 16.0375];
/** The GeoTIFF's bounds and one point inside it. */
const RASTER = { west: 108.135, south: 16.005, east: 108.17, north: 16.04 };
const RASTER_INSIDE = [108.1525, 16.0225];
/** The polygon the owner draws, clockwise from the north-west, and a point inside it. */
const DRAWN_RING = [[108.14, 16.09], [108.18, 16.09], [108.18, 16.065], [108.14, 16.065]];
const DRAWN_INSIDE = [108.16, 16.0775];

function writeGeoJson(path) {
  const features = POINTS.map(({ at, ...properties }) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: at },
    properties,
  }));
  features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [POLYGON] },
    properties: { ten_dia_diem: 'Khu trung tâm Hải Châu', loai_dia_diem: 'Khu vực', ghi_chu: 'Vùng thử nghiệm' },
  });
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }, null, 2), 'utf8');
}

/**
 * A minimal uncompressed GeoTIFF: 3 uint8 bands (RGB, one strip), EPSG:4326, north-up. Each band
 * varies across the image, so the import records a real min/max for it.
 */
function writeGeoTiff(path, { west, north, east, south }, width = 64, height = 64) {
  const SHORT = 3;
  const LONG = 4;
  const DOUBLE = 12;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      pixels[i] = 170 + (x % 64);
      pixels[i + 1] = 10 + (y % 40);
      pixels[i + 2] = 150 + ((x + y) % 80);
    }
  }
  const entries = [
    [256, SHORT, [width]],
    [257, SHORT, [height]],
    [258, SHORT, [8, 8, 8]],
    [259, SHORT, [1]],
    [262, SHORT, [2]],
    [273, LONG, [0]], // the strip offset, set below
    [277, SHORT, [3]],
    [278, SHORT, [height]],
    [279, LONG, [pixels.length]],
    [284, SHORT, [1]],
    [33550, DOUBLE, [(east - west) / width, (north - south) / height, 0]],
    [33922, DOUBLE, [0, 0, 0, west, north, 0]],
    // GTModelType geographic, GTRasterType pixel-is-area, GeographicType WGS 84.
    [34735, SHORT, [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]],
  ];
  const size = { [SHORT]: 2, [LONG]: 4, [DOUBLE]: 8 };
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdSize;
  const blocks = [];
  const placed = entries.map(([tag, type, values]) => {
    const bytes = size[type] * values.length;
    if (bytes <= 4) return { tag, type, values, offset: null };
    const offset = extra;
    extra += bytes + (bytes % 2);
    blocks.push({ offset, type, values });
    return { tag, type, values, offset };
  });
  const dataOffset = extra;
  placed.find((e) => e.tag === 273).values = [dataOffset];
  const buf = Buffer.alloc(dataOffset + pixels.length);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(placed.length, 8);
  const writeValues = (at, type, values) => {
    values.forEach((v, i) => {
      if (type === SHORT) buf.writeUInt16LE(v, at + i * 2);
      else if (type === LONG) buf.writeUInt32LE(v, at + i * 4);
      else buf.writeDoubleLE(v, at + i * 8);
    });
  };
  placed.forEach((e, i) => {
    const at = 10 + i * 12;
    buf.writeUInt16LE(e.tag, at);
    buf.writeUInt16LE(e.type, at + 2);
    buf.writeUInt32LE(e.values.length, at + 4);
    if (e.offset === null) writeValues(at + 8, e.type, e.values);
    else buf.writeUInt32LE(e.offset, at + 8);
  });
  buf.writeUInt32LE(0, 10 + placed.length * 12);
  for (const b of blocks) writeValues(b.offset, b.type, b.values);
  pixels.copy(buf, dataOffset);
  writeFileSync(path, buf);
}

/** The member names of a zip archive, read from its central directory. */
function zipNames(path) {
  const buf = readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error(`${path} is not a zip archive`);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip central directory');
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    names.push(buf.toString('utf8', at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// ---- Reporting ---------------------------------------------------------------------------

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
    return false;
  }
}

// ---- The API, for the expected values and the cleanup --------------------------------

/**
 * One API call. The API allows 100 requests a minute per address, and the browser sessions share
 * that budget with this script (job polling alone is one a second), so a 429 waits as long as the
 * API asks and tries again.
 */
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

async function login({ email, password }) {
  const res = await api('POST', '/api/auth/login', null, { email, password });
  if (res.status !== 200) throw new Error(`API login for ${email} answered ${res.status}`);
  return res.json.token;
}

const WS = '/api/workspace';
/** A GET that must answer 200; anything else stops the step with the API's answer. */
async function read(path, token) {
  const res = await api('GET', path, token);
  if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}: ${res.json?.error?.message ?? ''}`);
  return res.json;
}
const listMaps = (token) => read(`${WS}/maps`, token);
const listUploads = async (token) => (await read(`${WS}/uploads`, token)).uploads;
const listJobs = async (token) => (await read(`${WS}/jobs`, token)).jobs;
const getMap = async (token, id) => {
  const res = await api('GET', `${WS}/maps/${id}`, token);
  return res.status === 200 ? res.json.map : null;
};

/** What one account holds, by id; the cleanup must bring it back to this. */
async function holdings(token) {
  const maps = await listMaps(token);
  return {
    maps: maps.mine.map((m) => m.id).sort(),
    uploads: (await listUploads(token)).map((u) => u.id).sort(),
    jobs: (await listJobs(token)).map((j) => j.id).sort(),
  };
}

/**
 * Deletes what this script makes: the export jobs of the owner's test maps (before the maps: a map's
 * deletion takes its job rows with it, and their files would count against the owner's quota until
 * they expire in 7 days, with no job left to delete them through), the test maps, the
 * recipient's copies of them, and both accounts' uploads with this script's file names. Returns
 * the API answers that were not a success.
 */
async function removeTestData(ctx) {
  const problems = [];
  const expect = (what, res, ok = [200, 204]) => {
    if (!ok.includes(res.status)) problems.push(`${what} answered ${res.status}: ${res.json?.error?.message ?? ''}`);
  };
  const deleteMaps = async (token, keep) => {
    for (const m of (await listMaps(token)).mine.filter(keep)) {
      const detail = await getMap(token, m.id);
      if (!detail) continue;
      expect(`DELETE map ${m.title}`, await api('DELETE', `${WS}/maps/${m.id}`, token, { expectedRevision: detail.revision }));
    }
  };
  const testMaps = (await listMaps(ctx.ownerToken)).mine.filter((m) => m.title === MAP_TITLE).map((m) => m.id);
  for (const job of await listJobs(ctx.ownerToken)) {
    if (job.kind === 'export' && testMaps.includes(job.mapId)) {
      // A job still running cannot be deleted; give it a little time.
      for (let i = 0; i < 30 && (job.status === 'queued' || job.status === 'running'); i += 1) {
        await sleep(1000);
        job.status = (await api('GET', `${WS}/jobs/${job.id}`, ctx.ownerToken)).json?.job?.status;
      }
      expect(`DELETE export job ${job.id}`, await api('DELETE', `${WS}/jobs/${job.id}`, ctx.ownerToken));
    }
  }
  await deleteMaps(ctx.ownerToken, (m) => m.title === MAP_TITLE);
  // A copy is titled after its source ("Bản sao của Kiểm thử P3c").
  await deleteMaps(ctx.recipientToken, (m) => m.title.includes(MAP_TITLE));
  for (const token of [ctx.ownerToken, ctx.recipientToken]) {
    for (const u of await listUploads(token)) {
      if (u.originalName === GEOJSON_NAME || u.originalName === TIFF_NAME) {
        expect(`DELETE upload ${u.originalName}`, await api('DELETE', `${WS}/uploads/${u.id}`, token));
      }
    }
  }
  return problems;
}

// ---- The browser -------------------------------------------------------------------------

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

/** Helpers the steps call inside the page; installed before the app loads. */
function installPageHelpers() {
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  window.__p3c = {
    /** The map card titled `title` in the list under the heading `group`. */
    card(title, group) {
      for (const ul of document.querySelectorAll('.my-maps ul.my-map-list')) {
        const heading = ul.previousElementSibling;
        if (!heading || text(heading) !== group) continue;
        for (const li of ul.children) {
          if (li.querySelector('.my-map-title') && text(li.querySelector('.my-map-title')) === title) return li;
        }
      }
      return null;
    },
    /** `{ card, group }`, or `{ selector }` (its last match: the topmost dialog), or the document. */
    root(scope) {
      if (scope?.card) return window.__p3c.card(scope.card, scope.group);
      if (scope?.selector) {
        const all = document.querySelectorAll(scope.selector);
        return all[all.length - 1] ?? null;
      }
      return document;
    },
    buttons(scope) {
      const root = window.__p3c.root(scope);
      return root ? [...root.querySelectorAll('button')].map(text) : [];
    },
    click(scope, label) {
      const root = window.__p3c.root(scope);
      const button = root && [...root.querySelectorAll('button')].find((b) => text(b) === label && !b.disabled);
      button?.click();
      return Boolean(button);
    },
    /** The personal layer row titled `title` in a card: its checkbox. */
    layerBox(scope, title) {
      const root = window.__p3c.root(scope);
      const row = root && [...root.querySelectorAll('.my-maps-layer')]
        .find((r) => r.querySelector('.layer-label span') && text(r.querySelector('.layer-label span')) === title);
      return row?.querySelector('input[type="checkbox"]') ?? null;
    },
    text(scope) {
      const root = window.__p3c.root(scope);
      return root ? text(root) : '';
    },
  };
}

async function openSession(browser, viewport, downloadPath) {
  const context = await browser.createBrowserContext(
    downloadPath ? { downloadBehavior: { policy: 'allow', downloadPath } } : {},
  );
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(installPageHelpers);
  // An uncaught error in the app is printed as it happens: a failed step may follow from it.
  page.on('pageerror', (error) => console.log(`pageerror ${viewport.width}  ${String(error.message ?? error).split('\n')[0]}`));
  // A 429 to the app is not a failure of the app, but a step that fails after one may be its effect.
  page.on('response', (response) => {
    if (response.status() === 429) console.log(`note    ${viewport.width}  the API answered 429 to ${response.request().method()} ${response.url().replace(API_URL, '')}`);
  });
  const settle = trackTiles(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 30000 });
  await settle();
  return { context, page, settle };
}

async function shot(session, vp, name) {
  await session.settle();
  await waitRender(session.page);
  const path = join(OUT, `verify-personal-maps-${name}-${vp}.png`);
  await session.page.screenshot({ path });
  console.log(`shot    ${vp}  ${path}`);
}

async function click(page, scope, label) {
  const done = await page.evaluate((s, l) => window.__p3c.click(s, l), scope, label);
  if (!done) {
    const offered = await page.evaluate((s) => window.__p3c.buttons(s), scope);
    throw new Error(`no enabled button "${label}" in ${JSON.stringify(scope)}; offered: ${offered.join(' | ')}`);
  }
}

const dialogText = (page) => page.evaluate(() => window.__p3c.text({ selector: '.dialog' }));

/** Waits until the topmost dialog's text contains `wanted`; fails early on one of `failures`. */
async function waitDialogText(page, wanted, timeout, failures = []) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const now = await dialogText(page);
    if (now.includes(wanted)) return now;
    const bad = failures.find((f) => now.includes(f));
    if (bad) throw new Error(`the dialog says "${bad}": ${now.slice(-300)}`);
    await sleep(500);
  }
  throw new Error(`the dialog never said "${wanted}": ${(await dialogText(page)).slice(-300)}`);
}

async function signIn(page, { email, password }) {
  await click(page, { selector: '.top-bar' }, 'Đăng nhập');
  await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
  await page.type('#login-email', email);
  await page.type('#login-password', password);
  await page.$eval('#login-password', (el) => el.form.requestSubmit());
  try {
    await page.waitForFunction(() => Boolean(document.querySelector('.account-trigger')), { timeout: 20000 });
  } catch {
    throw new Error(`sign-in did not finish: ${await dialogText(page)}`);
  }
  await page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 20000 });
  await sleep(800);
}

// ---- The map: framing, pixels and drawing ---------------------------------------------

const toMercator = ([lon, lat]) => [
  (lon * 20037508.34) / 180,
  (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180),
];

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

async function frame(session, extent) {
  const [x0, y0] = toMercator([extent[0], extent[1]]);
  const [x1, y1] = toMercator([extent[2], extent[3]]);
  await session.page.evaluate((box) => {
    const map = window.__olMap;
    if (!map) throw new Error('window.__olMap is not exposed: run against the dev server');
    map.getView().fit(box, { size: map.getSize(), padding: [70, 70, 70, 70], duration: 0 });
  }, [x0, y0, x1, y1]);
  await sleep(800);
  await session.settle();
  await waitRender(session.page);
}

/** Window pixels of lon/lat points on the current view. */
async function pixelsOf(page, points) {
  return page.evaluate((coords) => {
    const map = window.__olMap;
    map.renderSync();
    const r = map.getViewport().getBoundingClientRect();
    return coords.map((c) => {
      const [x, y] = map.getPixelFromCoordinate(c);
      return { x: r.left + x, y: r.top + y };
    });
  }, points.map(toMercator));
}

/** What the screen shows in a (2r+1)² box around each pixel, from one screenshot. */
async function sample(page, pixels, r) {
  const png = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async (data, spots, rad) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return spots.map(({ x, y }) => Array.from(ctx.getImageData(Math.round(x) - rad, Math.round(y) - rad, 2 * rad + 1, 2 * rad + 1).data));
  }, png, pixels, r);
}

/** Pixels whose colour moved by more than `threshold` in some channel. */
function changed(a, b, threshold = 20) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > threshold) n += 1;
  }
  return n;
}

async function setLayer(session, scope, title, on) {
  const state = await session.page.evaluate((s, t, want) => {
    const box = window.__p3c.layerBox(s, t);
    if (!box) return null;
    if (box.checked !== want) box.click();
    return true;
  }, scope, title, on);
  if (!state) throw new Error(`no layer row "${title}"`);
  await sleep(500);
  await waitRender(session.page);
}

/**
 * The layer row is on, and the map draws the layer at each spot: the screen there changes when
 * the row is switched off, and comes back when it is switched on again.
 */
async function drawsAt(session, scope, title, spots, minChanged) {
  const { page } = session;
  const problems = [];
  const on = await page.evaluate((s, t) => window.__p3c.layerBox(s, t)?.checked ?? null, scope, title);
  if (on === null) return [`no layer row "${title}"`];
  if (!on) problems.push(`the layer row "${title}" is off after the import`);
  await setLayer(session, scope, title, true);
  const pixels = await pixelsOf(page, spots.map((s) => s.at));
  const covered = await page.evaluate((pts) => pts.map(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit && !document.querySelector('.map-container').contains(hit) ? hit.className.toString() : null;
  }), pixels);
  covered.forEach((c, i) => { if (c) problems.push(`${spots[i].name} is covered by .${c}`); });
  const shown = await sample(page, pixels, 3);
  await setLayer(session, scope, title, false);
  const hidden = await sample(page, pixels, 3);
  await setLayer(session, scope, title, true);
  const back = await sample(page, pixels, 3);
  spots.forEach((s, i) => {
    const off = changed(shown[i], hidden[i]);
    const again = changed(shown[i], back[i]);
    if (off < minChanged) problems.push(`${s.name}: ${off} of 49 pixels change when "${title}" is switched off (want ≥ ${minChanged})`);
    if (again > 49 - minChanged) problems.push(`${s.name}: switched on again, ${again} of 49 pixels differ from before`);
  });
  return problems;
}

// ---- Steps ---------------------------------------------------------------------------------

const OWN = (title = MAP_TITLE) => ({ card: title, group: GROUP_OWN });
const SHARED = (title = MAP_TITLE) => ({ card: title, group: GROUP_SHARED });

async function ownTestMap(ctx) {
  const maps = (await listMaps(ctx.ownerToken)).mine.filter((m) => m.title === MAP_TITLE);
  if (maps.length !== 1) throw new Error(`the owner has ${maps.length} maps titled "${MAP_TITLE}"`);
  return maps[0];
}

/** Step 1, as the owner. */
async function stepCreate(session, ctx) {
  const { page } = session;
  const problems = [];
  await click(page, { selector: '.my-maps-buttons' }, 'Bản đồ mới');
  await page.waitForSelector('#my-map-title', { visible: true, timeout: 5000 });
  await page.type('#my-map-title', MAP_TITLE);
  await click(page, { selector: '.dialog' }, 'Tạo');
  await page.waitForFunction((t, g) => {
    const card = window.__p3c.card(t, g);
    return card?.querySelector('.my-map-head')?.getAttribute('aria-expanded') === 'true' && card.querySelector('.my-map-actions');
  }, { timeout: 15000 }, MAP_TITLE, GROUP_OWN);
  ctx.mapId = (await ownTestMap(ctx)).id;
  const buttons = await page.evaluate((s) => window.__p3c.buttons(s), OWN());
  for (const wanted of ['Tải xuống', 'Thêm lớp', 'Tải tệp lên vào bản đồ này', 'Chia sẻ', 'Đổi tên', 'Xoá bản đồ', 'Vẽ thêm']) {
    if (!buttons.includes(wanted)) problems.push(`the new map's card has no "${wanted}"`);
  }
  return problems;
}

/** Uploads one file into the test map through the card's button and waits for the import. */
async function uploadInto(session, ctx, path) {
  const { page } = session;
  await click(page, OWN(), 'Tải tệp lên vào bản đồ này');
  await page.waitForSelector('#upload-file', { timeout: 5000 });
  const input = await page.$('#upload-file');
  await input.uploadFile(path);
  await page.waitForFunction((name) => document.querySelector('#upload-file-name')?.textContent.trim() === name,
    { timeout: 5000 }, path.split(/[\\/]/).pop());
  const target = await page.$eval('#upload-target', (el) => el.value);
  if (target !== ctx.mapId) throw new Error(`Nhập vào is "${target}", not the map the button belongs to`);
  await click(page, { selector: '.dialog' }, 'Tải lên và nhập');
  await waitDialogText(page, 'Đã nhập xong.', IMPORT_TIMEOUT_MS, ['Lỗi']);
  const done = await dialogText(page);
  await click(page, { selector: '.dialog' }, 'Đóng');
  await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 5000 });
  return done;
}

/** Step 2, as the owner: the GeoJSON. */
async function stepUploadGeoJson(session, vp, ctx) {
  const { page } = session;
  const said = await uploadInto(session, ctx, ctx.geojsonPath);
  const problems = [];
  if (!said.includes(`Đã nhập xong. ${POINTS.length + 1} đối tượng.`)) problems.push(`the dialog said: ${said.slice(-200)}`);
  await page.waitForFunction((s, t) => Boolean(window.__p3c.layerBox(s, t)), { timeout: 15000 }, OWN(), GEOJSON_LAYER);
  await frame(session, VIEW_EXTENT);
  // The vector layer reads by viewport after the frame; give the read a moment.
  await sleep(1500);
  await waitRender(page);
  problems.push(...(await drawsAt(session, OWN(), GEOJSON_LAYER, [
    ...POINTS.map((p) => ({ name: p.ten_dia_diem, at: p.at })),
    { name: 'the polygon', at: POLYGON_INSIDE },
  ], 6)));
  await shot(session, vp, 'tai-len-geojson');
  return problems;
}

/** Step 2b, as the owner: the GeoTIFF, drawn by the raster code loaded on demand. */
async function stepUploadGeoTiff(session, vp, ctx) {
  const { page } = session;
  const rasterRequests = [];
  const onRequest = (request) => { if (request.url().includes('/raster')) rasterRequests.push(request.url()); };
  page.on('request', onRequest);
  try {
    const said = await uploadInto(session, ctx, ctx.tiffPath);
    const problems = [];
    if (!said.includes('Đã nhập xong.')) problems.push(`the dialog said: ${said.slice(-200)}`);
    await page.waitForFunction((s, t) => Boolean(window.__p3c.layerBox(s, t)), { timeout: 15000 }, OWN(), TIFF_LAYER);
    await frame(session, VIEW_EXTENT);
    await sleep(2500);
    await waitRender(page);
    problems.push(...(await drawsAt(session, OWN(), TIFF_LAYER, [{ name: 'the raster', at: RASTER_INSIDE }], 30)));
    if (rasterRequests.length === 0) problems.push('the page never read the raster route');
    await shot(session, vp, 'tai-len-geotiff');
    return problems;
  } finally {
    page.off('request', onRequest);
  }
}

/** Step 3, as the owner. */
async function stepDraw(session, vp) {
  const { page } = session;
  const problems = [];
  await click(page, OWN(), 'Thêm lớp');
  await click(page, OWN(), 'Lớp vẽ mới');
  await page.waitForSelector('#new-layer-title', { visible: true, timeout: 5000 });
  await page.type('#new-layer-title', DRAWN_LAYER);
  await page.select('#new-layer-geometry', 'polygon');
  await click(page, { selector: '.dialog' }, 'Thêm trường');
  await page.waitForSelector('.dialog input[aria-label="Tên trường"]', { timeout: 5000 });
  await page.type('.dialog input[aria-label="Tên trường"]', DRAWN_FIELD);
  await click(page, { selector: '.dialog' }, 'Tạo lớp');
  try {
    await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 15000 });
  } catch {
    throw new Error(`Lớp vẽ mới did not close: ${(await dialogText(page)).slice(-300)}`);
  }
  await page.waitForFunction((s, t) => Boolean(window.__p3c.layerBox(s, t)), { timeout: 15000 }, OWN(), DRAWN_LAYER);

  await click(page, OWN(), 'Vẽ thêm');
  await page.waitForFunction((s) => window.__p3c.text(s).includes('Chọn lớp để vẽ.'), { timeout: 5000 }, OWN());
  const offered = await page.evaluate(() => [...document.querySelectorAll('.my-map-editing button')].map((b) => b.textContent.trim()));
  if (offered.includes(GEOJSON_LAYER)) problems.push('Vẽ thêm offers the mixed imported layer');
  if (offered.includes(TIFF_LAYER)) problems.push('Vẽ thêm offers the raster layer');
  await click(page, { selector: '.my-map-editing' }, DRAWN_LAYER);
  await page.waitForFunction((s) => window.__p3c.text(s).includes('Vẽ vùng lên bản đồ để tiếp tục.'), { timeout: 5000 }, OWN());

  const vertices = await pixelsOf(page, DRAWN_RING);
  for (const v of [...vertices, vertices[0]]) {
    await page.mouse.click(v.x, v.y);
    await sleep(450);
  }
  await page.waitForSelector('#free-field-0', { visible: true, timeout: 10000 });
  await page.type('#free-field-0', DRAWN_VALUE);
  await click(page, { selector: '.edit-attr-form' }, 'Lưu');
  try {
    await page.waitForFunction(() => !document.querySelector('.edit-attr-form'), { timeout: 15000 });
  } catch {
    const message = await page.$eval('.edit-attr-form', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');
    throw new Error(`the save did not finish: ${message.slice(-200)}`);
  }
  // The mode ends after a drawing; the layer is read again.
  await page.waitForFunction((s) => window.__p3c.buttons(s).includes('Vẽ thêm'), { timeout: 10000 }, OWN());
  await sleep(1500);
  await waitRender(page);

  const [inside] = await pixelsOf(page, [DRAWN_INSIDE]);
  await page.mouse.click(inside.x, inside.y);
  try {
    await page.waitForSelector('.personal-feature-card', { visible: true, timeout: 10000 });
  } catch {
    problems.push('a click inside the drawn polygon opened no feature card');
    return problems;
  }
  const card = await page.$eval('.personal-feature-card', (el) => ({
    title: el.querySelector('.popup-title')?.textContent.trim(),
    rows: [...el.querySelectorAll('.info-row')].map((r) => r.textContent.trim()),
  }));
  if (card.title !== DRAWN_LAYER) problems.push(`the card is titled "${card.title}", expected "${DRAWN_LAYER}"`);
  if (!card.rows.includes(`${DRAWN_FIELD}: ${DRAWN_VALUE}`)) problems.push(`the card shows ${JSON.stringify(card.rows)}`);
  await shot(session, vp, 've-the-doi-tuong');
  await page.click('.personal-feature-card .close-popup-btn');
  return problems;
}

function newZip(dir, before) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  if (names.some((n) => n.endsWith('.crdownload'))) return null;
  return names.find((n) => n.toLowerCase().endsWith('.zip') && !before.includes(n)) ?? null;
}

/** Step 4, as the owner. */
async function stepExport(session, vp, ctx) {
  const { page } = session;
  const problems = [];
  await click(page, OWN(), 'Tải xuống');
  await page.waitForSelector('#export-format', { visible: true, timeout: 15000 });
  await page.select('#export-format', 'shp');
  await page.select('#export-crs', EXPORT_CRS);
  const layers = await page.$$eval('.dialog fieldset .check-row', (rows) => rows.map((r) => r.textContent.trim()));
  if (layers.includes(TIFF_LAYER)) problems.push('the raster is offered for export');
  // The preview follows the options after 300 ms.
  await sleep(2500);
  const detail = await getMap(ctx.ownerToken, ctx.mapId);
  const layerIds = detail.layers.filter((l) => l.kind !== 'raster').map((l) => l.id);
  const preview = (await api('GET', `${WS}/maps/${ctx.mapId}/exports/preview?format=shp&crs=${EXPORT_CRS}&layerIds=${layerIds.join(',')}`, ctx.ownerToken)).json;
  const expected = (preview?.layers ?? []).flatMap((l) => l.truncated.map((t) => `${l.title} ${t.from} ${t.to}`));
  const shown = await page.$$eval('.export-cuts tbody tr', (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' ')));
  if (JSON.stringify(shown) !== JSON.stringify(expected)) {
    problems.push(`the cut-name table shows ${JSON.stringify(shown)}, the preview lists ${JSON.stringify(expected)}`);
  }
  console.log(`          ${vp}: the cut-name table lists ${shown.length} renamed fields${shown.length ? `: ${shown.join('; ')}` : ''}`);
  await shot(session, vp, 'xuat-ten-truong');

  const before = existsSync(ctx.downloads) ? readdirSync(ctx.downloads) : [];
  await click(page, { selector: '.dialog' }, 'Xuất');
  await page.waitForFunction(() => {
    const dialog = [...document.querySelectorAll('.dialog')].pop();
    const texts = [...(dialog?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim());
    return texts.includes('Tải tệp') || dialog?.querySelector('.job-step.failed');
  }, { timeout: EXPORT_TIMEOUT_MS });
  if (await page.$('.dialog .job-step.failed')) throw new Error(`the export failed: ${(await dialogText(page)).slice(-300)}`);
  await click(page, { selector: '.dialog' }, 'Tải tệp');
  let zip = null;
  for (let i = 0; i < 60 && !zip; i += 1) {
    await sleep(500);
    zip = newZip(ctx.downloads, before);
  }
  if (!zip) {
    problems.push(`no new .zip arrived in ${ctx.downloads}`);
  } else {
    const names = zipNames(join(ctx.downloads, zip));
    for (const ext of ['.shp', '.dbf', '.cpg', '.prj']) {
      if (!names.some((n) => n.toLowerCase().endsWith(ext))) problems.push(`${zip} holds no ${ext}: ${names.join(', ')}`);
    }
    console.log(`          ${vp}: downloaded ${join(ctx.downloads, zip)} (${names.join(', ')})`);
  }
  const listed = await page.$$eval('.dialog .exports-row', (rows) => rows.length);
  if (listed < 1) problems.push('Tệp đã xuất lists no file');
  await shot(session, vp, 'xuat');
  await click(page, { selector: '.dialog' }, 'Đóng');
  await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 5000 });
  return problems;
}

/** Opens the owner's Chia sẻ dialog and waits for its list of shares. */
async function openShare(page) {
  await click(page, OWN(), 'Chia sẻ');
  await page.waitForFunction(() => {
    const d = document.querySelector('.dialog');
    return d && !d.querySelector('[aria-labelledby="share-current-title"] .spinner') && /Chưa chia sẻ với ai\.|Thu hồi/.test(d.textContent);
  }, { timeout: 10000 });
}

/** Step 5: the owner shares, the recipient sees the map read-only and copies it. */
async function stepShare(owner, recipientSession, vp, ctx) {
  const problems = [];
  const { page } = owner;
  await openShare(page);
  await page.type('#share-search', ACCOUNTS.recipient.email);
  await page.waitForFunction((email) => [...document.querySelectorAll('.dialog .share-row')]
    .some((r) => r.textContent.includes(email)), { timeout: 10000 }, ACCOUNTS.recipient.email);
  await page.evaluate((email) => {
    const row = [...document.querySelectorAll('.dialog .share-row')].find((r) => r.textContent.includes(email));
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Chia sẻ').click();
  }, ACCOUNTS.recipient.email);
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-labelledby="share-current-title"] .share-row')].length > 0,
    { timeout: 10000 });
  await shot(owner, vp, 'chia-se');
  await click(page, { selector: '.dialog' }, 'Đóng');

  const { page: rp } = recipientSession;
  await signIn(rp, ACCOUNTS.recipient);
  await rp.waitForFunction((s) => Boolean(window.__p3c.root(s)), { timeout: 15000 }, SHARED());
  const meta = await rp.evaluate((s) => window.__p3c.root(s).querySelector('.my-map-meta')?.textContent.trim(), SHARED());
  if (!meta?.startsWith('của ')) problems.push(`the shared card's line says "${meta}", expected the owner's name`);
  // Framed before the map opens: its layers then read Đà Nẵng only, so the zoom out in step 6
  // is a new read (a view inside an extent already read would make none).
  await frame(recipientSession, VIEW_EXTENT);
  await rp.evaluate((s) => window.__p3c.root(s).querySelector('.my-map-head').click(), SHARED());
  await rp.waitForFunction((s, t) => Boolean(window.__p3c.layerBox(s, t)), { timeout: 15000 }, SHARED(), DRAWN_LAYER);
  const buttons = await rp.evaluate((s) => window.__p3c.buttons(s), SHARED());
  for (const banned of ['Đổi tên', 'Xoá bản đồ', 'Chia sẻ', 'Thêm lớp', 'Vẽ thêm', 'Sửa đối tượng', 'Tải tệp lên vào bản đồ này']) {
    if (buttons.includes(banned)) problems.push(`the recipient is offered "${banned}"`);
  }
  for (const wanted of ['Tải xuống', 'Tạo bản sao']) if (!buttons.includes(wanted)) problems.push(`the recipient has no "${wanted}"`);
  const settings = await rp.evaluate((s) => window.__p3c.root(s).querySelectorAll('[aria-label^="Thiết lập lớp"]').length, SHARED());
  if (settings > 0) problems.push(`the recipient is offered ${settings} layer settings buttons`);
  await sleep(1500);
  await shot(recipientSession, vp, 'nguoi-nhan');

  await click(rp, SHARED(), 'Tạo bản sao');
  const toast = await rp.waitForFunction(() => [...document.querySelectorAll('.toast-host .toast')]
    .map((t) => t.textContent.trim()).find((t) => t.startsWith('Đã tạo bản sao')) ?? false, { timeout: 20000 });
  const said = await toast.jsonValue();
  const copies = (await listMaps(ctx.recipientToken)).mine.filter((m) => m.title.includes(MAP_TITLE));
  if (copies.length !== 1) problems.push(`the recipient owns ${copies.length} maps after Tạo bản sao, expected 1`);
  else {
    ctx.copyTitle = copies[0].title;
    if (!said.includes(copies[0].title)) problems.push(`the toast says "${said}", the copy is "${copies[0].title}"`);
    await rp.waitForFunction((s) => Boolean(window.__p3c.root(s)), { timeout: 10000 }, OWN(copies[0].title));
  }
  return problems;
}

/** The ids of the personal layers on the OpenLayers map that belong to `mapId`. */
const mapLayersOf = (page, mapId) => page.evaluate((id) => window.__olMap.getAllLayers()
  .filter((l) => l.get('mapId') === id).map((l) => l.get('layerId')), mapId);

/** Step 6: the owner revokes, the recipient's next read drops the map. */
async function stepRevoke(owner, recipientSession, vp, ctx) {
  const problems = [];
  const { page } = owner;
  await openShare(page);
  await page.evaluate(() => {
    const row = document.querySelector('[aria-labelledby="share-current-title"] .share-row');
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thu hồi').click();
  });
  await page.waitForFunction(() => document.querySelectorAll('.dialog').length === 2, { timeout: 5000 });
  await click(page, { selector: '.dialog' }, 'Thu hồi');
  await page.waitForFunction(() => document.querySelector('.dialog')?.textContent.includes('Chưa chia sẻ với ai.'), { timeout: 10000 });
  await click(page, { selector: '.dialog' }, 'Đóng');

  const { page: rp } = recipientSession;
  const before = await mapLayersOf(rp, ctx.mapId);
  if (before.length === 0) problems.push('before the revoke, the shared map had no layers on the recipient\'s map');
  // The next read: a zoom out makes every vector layer read the larger view.
  await rp.click('button[aria-label="Thu nhỏ"]');
  try {
    await rp.waitForFunction((copy) => [...document.querySelectorAll('.toast-host .toast')]
      .some((t) => t.textContent.includes(copy)), { timeout: 20000 }, MAP_GONE);
  } catch {
    problems.push(`no toast "${MAP_GONE}" after the next read`);
  }
  await sleep(1000);
  if (await rp.evaluate((s) => Boolean(window.__p3c.root(s)), SHARED())) problems.push('the map is still under "Được chia sẻ với tôi"');
  const after = await mapLayersOf(rp, ctx.mapId);
  if (after.length > 0) problems.push(`${after.length} of its layers are still on the map`);
  const sharedNow = (await listMaps(ctx.recipientToken)).sharedWithMe.filter((m) => m.id === ctx.mapId);
  if (sharedNow.length > 0) problems.push('the API still lists the map as shared with the recipient');
  await shot(recipientSession, vp, 'thu-hoi');
  return problems;
}

/** Step 7: the readouts are clear and neither the side panel nor the page scrolls sideways. */
async function layoutFits(page) {
  return page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth) out.push(`the page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px window`);
    const body = document.querySelector('.side-panel-body');
    if (!body) out.push('.side-panel-body is not on the page');
    else if (body.scrollWidth > body.clientWidth + 0.5) {
      const wide = [...body.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > body.getBoundingClientRect().right + 0.5)
        .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      out.push(`the side panel is ${body.scrollWidth}px wide in ${body.clientWidth}px (too wide: ${wide.join(', ')})`);
    }
    const coverers = ['.tool-group', '.tool-menu:not([hidden])', '.scale-slider', '.scale-readout', '.side-panel',
      '.personal-feature-card', '.toast-host > *', '.dialog'];
    const box = (el) => el.getBoundingClientRect();
    for (const selector of ['.map-scaleline', '.map-mouseposition']) {
      const el = document.querySelector(selector);
      const r = el && box(el);
      if (!r || r.width === 0) { out.push(`${selector} is not on the page`); continue; }
      // The readouts let clicks through to the map; take the hit as if they did not.
      const previous = el.style.pointerEvents;
      el.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      el.style.pointerEvents = previous;
      if (!hit || !(el.contains(hit) || hit.contains(el))) out.push(`${selector} is covered by ${hit?.tagName.toLowerCase()}.${hit?.className}`);
      for (const other of coverers) {
        for (const o of document.querySelectorAll(other)) {
          const b = box(o);
          if (b.width > 0 && b.height > 0 && r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) {
            out.push(`${selector} overlaps ${other}`);
          }
        }
      }
    }
    return out;
  });
}

// ---- One viewport ------------------------------------------------------------------------

async function runViewport(browser, viewport, ctx) {
  const vp = viewport.width;
  ctx.downloads = join(OUT, `downloads-${vp}`);
  mkdirSync(ctx.downloads, { recursive: true });
  const leftovers = await removeTestData(ctx);
  if (leftovers.length > 0) throw new Error(`could not clear an earlier run: ${leftovers.join('; ')}`);
  const owner = await openSession(browser, viewport, ctx.downloads);
  let recipient = null;
  try {
    await signIn(owner.page, ACCOUNTS.owner);
    const created = await check(vp, '1', `the owner creates "${MAP_TITLE}" in Bản của tôi`, () => stepCreate(owner, ctx));
    if (!created) return;
    await check(vp, '2', 'the owner uploads a GeoJSON: Đã nhập xong., the row is on, the features are drawn',
      () => stepUploadGeoJson(owner, vp, ctx));
    await check(vp, '2b', 'the owner uploads a GeoTIFF: Đã nhập xong., the row is on, the raster is drawn',
      () => stepUploadGeoTiff(owner, vp, ctx));
    await check(vp, '3', 'the owner draws a polygon in a new layer and its card shows the field value',
      () => stepDraw(owner, vp));
    await check(vp, '4', `the owner exports a zipped Shapefile in ${EXPORT_CRS}; the zip holds .cpg and .prj`,
      () => stepExport(owner, vp, ctx));
    if (vp === 768) {
      await check(vp, '7', 'owner at 768: scale bar and readout clear, no sideways scroll in the panel or the page', async () => {
        const problems = await layoutFits(owner.page);
        await shot(owner, vp, 'bo-cuc-chu');
        return problems;
      });
    }
    recipient = await openSession(browser, viewport, null);
    const shared = await check(vp, '5', 'the owner shares; the recipient sees the map read-only and makes a copy',
      () => stepShare(owner, recipient, vp, ctx));
    if (vp === 768) {
      await check(vp, '7b', 'recipient at 768: scale bar and readout clear, no sideways scroll in the panel or the page', async () => {
        const problems = await layoutFits(recipient.page);
        await shot(recipient, vp, 'bo-cuc-nguoi-nhan');
        return problems;
      });
    }
    await check(vp, '6', 'the owner revokes; the recipient\'s next read removes the map and its layers, with the toast', async () => {
      if (!shared) return ['skipped: step 5 failed'];
      return stepRevoke(owner, recipient, vp, ctx);
    });
  } finally {
    await recipient?.context.close().catch(() => {});
    await owner.context.close().catch(() => {});
    await check(vp, '8', 'cleanup through the API: export jobs, test map, copy, uploads; both accounts hold what they held at the start', async () => {
      const problems = await removeTestData(ctx);
      for (const [who, token] of [['owner', ctx.ownerToken], ['recipient', ctx.recipientToken]]) {
        const now = await holdings(token);
        for (const key of ['maps', 'uploads', 'jobs']) {
          if (JSON.stringify(now[key]) !== JSON.stringify(ctx.start[who][key])) {
            problems.push(`the ${who} held ${ctx.start[who][key].length} ${key} at the start, holds ${now[key].length} now`);
          }
        }
      }
      return problems;
    });
  }
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const ctx = {
    ownerToken: await login(ACCOUNTS.owner),
    recipientToken: await login(ACCOUNTS.recipient),
    geojsonPath: join(OUT, GEOJSON_NAME),
    tiffPath: join(OUT, TIFF_NAME),
  };
  writeGeoJson(ctx.geojsonPath);
  writeGeoTiff(ctx.tiffPath, RASTER);
  // What the accounts hold before this run's own leftovers are cleared is not the baseline:
  // clear first, then record.
  const leftovers = await removeTestData(ctx);
  if (leftovers.length > 0) throw new Error(`could not clear an earlier run: ${leftovers.join('; ')}`);
  ctx.start = { owner: await holdings(ctx.ownerToken), recipient: await holdings(ctx.recipientToken) };

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    console.log(`verify-personal-maps against ${BASE_URL} and ${API_URL}; files in ${OUT}`);
    for (const [i, viewport] of VIEWPORTS.entries()) {
      // A fresh rate-limit window for each viewport (see api()).
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
