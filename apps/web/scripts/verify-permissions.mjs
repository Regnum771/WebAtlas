/**
 * Proves in a real browser that permissions by administrative level and managing
 * units work end to end:
 *
 *   1. An admin creates two groups from the templates (a tỉnh group on Đà Nẵng, a xã
 *      group on one Đà Nẵng ward), each with "duyệt và xuất bản", and assigns user P
 *      to the first and user X to the second.
 *   2. P signs in, sees Biên tập, and edits the name of a lake managed by a Đà Nẵng
 *      ward through the map form. The save goes through; the name is put back after.
 *   3. X signs in and opens a lake managed by Đà Nẵng. "Đơn vị chủ quản" is read-only
 *      and says "ngoài phạm vi"; a forced save through the API answers 403 with the
 *      exact refusal message.
 *   4. A visitor who is not signed in sees neither Biên tập nor Quản lý.
 *   5. The admin opens Đơn vị chưa gán and sees the features without geometry.
 *
 * Every step runs at 1440x900 and at 768x900 and prints one PASS / FAIL line, then the
 * script exits non-zero on any FAIL. At 768 it also checks that nothing covers the scale
 * bar or the coordinate readout, that Quản lý does not scroll sideways, and that Biên tập
 * and Quản lý stay reachable. The two "Kiểm thử — ..." groups are deleted at the end of
 * each viewport, so a rerun starts clean. A lake edit is undone twice: the old name is saved back, and at the end
 * the script deletes the edit versions it made (and their audit rows) and re-activates the lakes version
 * that was active when it started, so the database is left as it was found.
 *
 * Credentials come only from the environment:
 *   VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD   an admin
 *   VERIFY_P_EMAIL / VERIFY_P_PASSWORD           a viewer with no group (the script assigns one)
 *   VERIFY_X_EMAIL / VERIFY_X_PASSWORD           a viewer with no group (the script assigns one)
 *   DATABASE_URL                               the dev database, to undo the lake edit when the run ends
 * Optional: BASE_URL (web, default http://localhost:5173), API_URL (default http://localhost:3001),
 * CHROME_PATH, X_WARD (the xã of X's group, default 20551 Điện Bàn), P_LAKE_WARD (the ward whose
 * lakes P edits, default 20209 Thanh Khê).
 *
 * Run: npm run verify:permissions -w @webatlas/web -- --out <dir>
 * Needs: the Docker stack, the API and `npm run dev:web`.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

// pg is resolved from the repo root, the way the workspace installs it.
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { Pool } = require('pg');

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const X_WARD = process.env.X_WARD ?? '20551';
const P_LAKE_WARD = process.env.P_LAKE_WARD ?? '20209';
const PROVINCE = '48';

const ACCOUNTS = {
  admin: { email: process.env.VERIFY_ADMIN_EMAIL, password: process.env.VERIFY_ADMIN_PASSWORD },
  p: { email: process.env.VERIFY_P_EMAIL, password: process.env.VERIFY_P_PASSWORD },
  x: { email: process.env.VERIFY_X_EMAIL, password: process.env.VERIFY_X_PASSWORD },
};
const missing = Object.entries(ACCOUNTS)
  .flatMap(([who, a]) => [!a.email && `VERIFY_${who.toUpperCase()}_EMAIL`, !a.password && `VERIFY_${who.toUpperCase()}_PASSWORD`])
  .filter(Boolean);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) missing.push('DATABASE_URL');
if (missing.length > 0) {
  console.error(`Set ${missing.join(', ')} (see the header of this script).`);
  process.exit(2);
}

// Named after the unit they cover; set in run() once the unit tree is read.
let GROUP_P = '';
let GROUP_X = '';
const GROUP_PREFIX = 'Kiểm thử —';
const REVIEW_LABEL = 'duyệt và xuất bản';
/** How Đơn vị chưa gán names the dams layer. */
const DAMS_LABEL = 'Đập & Hồ chứa';

const outArg = process.argv.indexOf('--out');
const OUT = outArg !== -1 ? process.argv[outArg + 1] : tmpdir();

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 900 },
];
/** Requests that draw the map; the page counts as settled after QUIET_MS without one in flight. */
const TILE_REQUEST = /gwc|wmts|tile|arcgis|google/i;
const QUIET_MS = 4000;
const SETTLE_CAP_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** A page of one signed-in (or anonymous) user in its own browser context. */
async function openSession(browser, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  const settle = trackTiles(page);
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 30000 });
  await settle();
  return { context, page, settle };
}

/** Takes a screenshot once the map has been quiet for QUIET_MS. */
async function shot(session, vp, name) {
  await session.settle();
  const path = join(OUT, `verify-permissions-${name}-${vp}.png`);
  await session.page.screenshot({ path });
  console.log(`shot    ${vp}  ${path}`);
}

/** Clicks the first element of `selector` whose trimmed text satisfies `match`, as a script would. */
async function clickText(page, selector, text, { exact = true, scope = 'document' } = {}) {
  const clicked = await page.evaluate((sel, wanted, isExact, scopeSel) => {
    const root = scopeSel === 'document' ? document : document.querySelector(scopeSel);
    const el = [...(root?.querySelectorAll(sel) ?? [])].find((e) => {
      const t = e.textContent.replace(/\s+/g, ' ').trim();
      return isExact ? t === wanted : t.includes(wanted);
    });
    el?.click();
    return Boolean(el);
  }, selector, text, exact, scope);
  if (!clicked) throw new Error(`no ${selector} "${text}" in ${scope}`);
}

async function signIn(page, { email, password }) {
  await clickText(page, '.top-bar button', 'Đăng nhập');
  await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
  await page.type('#login-email', email);
  await page.type('#login-password', password);
  await page.$eval('#login-password', (el) => el.form.requestSubmit());
  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('.account-trigger')),
      { timeout: 20000 },
    );
  } catch {
    const message = await page.$eval('.dialog', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');
    throw new Error(`sign-in did not finish: ${message}`);
  }
  // The session is settled once the top bar stops changing; the tools list follows the user's groups.
  await sleep(1500);
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

// ---- Quản lý: navigation and the group / user forms ----------------------------------

async function openQuanLy(page, section) {
  if (!page.url().includes('/quan-ly')) {
    await clickText(page, '.top-nav a', 'Quản lý');
    await page.waitForSelector('.quan-ly-nav', { timeout: 10000 });
  }
  await clickText(page, '.quan-ly-nav a', section);
  await page.waitForFunction((s) => document.querySelector('.quan-ly-nav [aria-current="page"]')?.textContent.trim() === s,
    { timeout: 10000 }, section);
  await sleep(500);
}

/** Group names in the Nhóm quyền table. */
const groupNames = (page) =>
  page.$$eval('.user-table tbody tr', (rows) => rows.map((r) => r.cells[0].childNodes[0]?.textContent.trim() ?? ''));

async function deleteTestGroups(page) {
  for (let guard = 0; guard < 10; guard += 1) {
    const names = await groupNames(page);
    const index = names.findIndex((n) => n.startsWith(GROUP_PREFIX));
    if (index === -1) return;
    await page.$$eval('.user-table tbody tr', (rows, i) => {
      [...rows[i].querySelectorAll('button')].find((b) => b.textContent.trim() === 'Xoá')?.click();
    }, index);
    await page.waitForSelector('.dialog', { visible: true, timeout: 5000 });
    await clickText(page, '.dialog button', 'Xoá');
    await page.waitForFunction((n, before) => document.querySelectorAll('.user-table tbody tr').length < before
      || !document.querySelector('.user-table'), { timeout: 10000 }, names[index], names.length);
    await sleep(300);
  }
  throw new Error('could not clear the earlier test groups');
}

async function createGroup(page, { name, template, unit }) {
  await clickText(page, '.user-mgmt-header button', 'Tạo nhóm');
  await page.waitForSelector('.group-form', { visible: true, timeout: 5000 });
  await clickText(page, '.group-form label', template, { exact: true });
  // The picker lists every unit; the search narrows it to the one with this exact code.
  await page.type('.unit-picker input[type="search"]', unit);
  await sleep(400);
  const picked = await page.evaluate((code) => {
    const row = [...document.querySelectorAll('.unit-picker-row')]
      .find((li) => li.querySelector('.unit-picker-code')?.textContent.trim() === code);
    const box = row?.querySelector('input');
    if (!box || box.disabled) return false;
    box.click();
    return true;
  }, unit);
  if (!picked) throw new Error(`unit ${unit} is not selectable in the picker`);
  // The templates carry the feature permissions; the review right is added on top.
  const review = await page.evaluate((label) => {
    const box = [...document.querySelectorAll('.group-form-set label')]
      .find((l) => l.textContent.includes(label))?.querySelector('input');
    if (!box) return false;
    if (!box.checked) box.click();
    return true;
  }, REVIEW_LABEL);
  if (!review) throw new Error(`no permission "${REVIEW_LABEL}" in the form`);
  await page.click('#gf-name', { clickCount: 3 });
  await page.type('#gf-name', name);
  await sleep(200);
  await clickText(page, '.group-form button', 'Lưu');
  try {
    await page.waitForFunction(() => !document.querySelector('.group-form'), { timeout: 10000 });
  } catch {
    const message = await page.$eval('.group-form', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');
    throw new Error(`group "${name}" was not saved: ${message.slice(-200)}`);
  }
  await sleep(500);
}

async function assignGroup(page, email, groupName) {
  await page.waitForSelector('.user-table tbody tr', { timeout: 10000 });
  const clicked = await page.$$eval('.user-table tbody tr', (rows, mail) => {
    const row = rows.find((r) => r.cells[0].textContent.trim() === mail);
    const button = row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Nhóm');
    button?.click();
    return Boolean(button);
  }, email);
  if (!clicked) throw new Error(`user ${email} is not in the Người dùng table`);
  await page.waitForSelector('.group-form', { visible: true, timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('.group-form-set label').length > 0, { timeout: 10000 });
  const ticked = await page.evaluate((wanted) => {
    const box = [...document.querySelectorAll('.group-form-set label')]
      .find((l) => l.textContent.replace(/\s+/g, ' ').trim().startsWith(wanted))?.querySelector('input');
    if (!box || box.disabled) return false;
    if (!box.checked) box.click();
    return true;
  }, groupName);
  if (!ticked) throw new Error(`group "${groupName}" is not offered in the user's group dialog`);
  await clickText(page, '.group-form button', 'Lưu');
  await page.waitForFunction(() => !document.querySelector('.group-form'), { timeout: 10000 });
  await sleep(500);
}

/** Step 1, run as the admin. */
async function stepGroups(session, vp) {
  const { page } = session;
  await openQuanLy(page, 'Nhóm quyền');
  await page.waitForSelector('.user-mgmt', { timeout: 10000 });
  await sleep(800);
  await deleteTestGroups(page);
  await createGroup(page, { name: GROUP_P, template: 'Cán bộ cấp tỉnh', unit: PROVINCE });
  await createGroup(page, { name: GROUP_X, template: 'Cán bộ cấp xã', unit: X_WARD });
  const names = await groupNames(page);
  const problems = [GROUP_P, GROUP_X].filter((n) => !names.includes(n)).map((n) => `group "${n}" is not in the list`);
  await shot(session, vp, 'nhom-quyen');

  await openQuanLy(page, 'Người dùng');
  await assignGroup(page, ACCOUNTS.p.email, GROUP_P);
  await assignGroup(page, ACCOUNTS.x.email, GROUP_X);
  for (const [email, group] of [[ACCOUNTS.p.email, GROUP_P], [ACCOUNTS.x.email, GROUP_X]]) {
    const row = await page.$$eval('.user-table tbody tr', (rows, mail) =>
      rows.find((r) => r.cells[0].textContent.trim() === mail)?.innerText.replace(/\s+/g, ' ') ?? '', email);
    if (!row.includes(group)) problems.push(`${email} does not show "${group}" after the assignment: ${row.slice(0, 160)}`);
  }
  await shot(session, vp, 'nguoi-dung');
  return problems;
}

/** Step 5, run as the admin: the page lists exactly what the API says is unassigned. */
async function stepUnassigned(session, vp, adminToken) {
  const { page } = session;
  await openQuanLy(page, 'Đơn vị chưa gán');
  const expected = (await api('GET', '/api/layers/unassigned', adminToken)).json?.features ?? [];
  const problems = [];
  if (expected.length === 0) {
    problems.push('the API lists no unassigned features, so there is nothing to see (is the data loaded?)');
    return problems;
  }
  await page.waitForSelector('.quan-ly-section .user-table tbody tr', { timeout: 15000 });
  const rows = await page.$$eval('.quan-ly-section .user-table tbody tr', (trs) => trs.map((r) => r.cells[0].textContent.trim()));
  if (rows.length !== expected.length) problems.push(`the page shows ${rows.length} rows, the API lists ${expected.length}`);
  const dams = expected.filter((f) => f.layerKey === 'dams').length;
  const damRows = rows.filter((label) => label === DAMS_LABEL).length;
  if (dams === 0) problems.push('the API lists no dams without geometry');
  if (damRows !== dams) problems.push(`the page shows ${damRows} dam rows, the API lists ${dams}`);
  await shot(session, vp, 'don-vi-chua-gan');
  return problems;
}

// ---- Quản lý layout, 768 px ---------------------------------------------------------

const rectsOf = (page, selector) =>
  page.$$eval(selector, (els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      })
      .filter((r) => r.width > 0 && r.height > 0),
  );
const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const fmt = (r) => `[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`;

/** On the map, with the admin's extra tools (Biên tập) present: nothing sits on the scale bar or the readout. */
async function mapReadoutsClear(page) {
  const problems = [];
  const covered = ['.map-scaleline', '.map-mouseposition'];
  const coverers = ['.tool-group', '.scale-slider', '.scale-readout', '.tool-menu:not([hidden])'];
  for (const selector of covered) {
    const own = await rectsOf(page, selector);
    if (own.length === 0) problems.push(`${selector} is not on the page`);
    for (const a of own) {
      for (const other of coverers) {
        for (const b of await rectsOf(page, other)) {
          if (intersects(a, b)) problems.push(`${selector} ${fmt(a)} overlaps ${other} ${fmt(b)}`);
        }
      }
    }
  }
  return problems;
}

/**
 * In Quản lý: the area starts under the top bar, the page never scrolls sideways, its links answer a
 * click, and no map control (scale bar, readout, tools, slider) shows through it.
 */
async function quanLyFits(page) {
  return page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth) out.push(`page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px window`);
    const route = document.querySelector('.quan-ly-route');
    const bar = document.querySelector('.top-bar');
    if (!route) return [...out, '.quan-ly-route is not on the page'];
    if (route.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 0.5) out.push('.quan-ly-route starts above the bottom of the top bar');
    for (const selector of ['.map-scaleline', '.map-mouseposition', '.tool-group', '.scale-slider']) {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      const previous = el.style.pointerEvents;
      el.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      el.style.pointerEvents = previous;
      if (hit && !route.contains(hit)) out.push(`${selector} shows through the Quản lý area`);
    }
    const nav = document.querySelector('.quan-ly-nav');
    if (!nav) out.push('.quan-ly-nav is not on the page');
    else {
      for (const a of nav.querySelectorAll('a')) {
        const r = a.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        if (!hit || !a.contains(hit)) out.push(`the Quản lý link "${a.textContent.trim()}" is covered`);
        if (r.right > window.innerWidth) out.push(`the Quản lý link "${a.textContent.trim()}" leaves the window`);
      }
    }
    return out;
  });
}

/** The top-bar link and the Biên tập button answer a click at their centre. */
async function reachable(page, selector, text) {
  return page.evaluate((sel, wanted) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === wanted);
    if (!el) return [`no ${sel} "${wanted}" on the page`];
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    const problems = [];
    if (!hit || !el.contains(hit)) problems.push(`"${wanted}" is covered`);
    if (r.right > window.innerWidth || r.left < 0) problems.push(`"${wanted}" leaves the window`);
    return problems;
  }, selector, text);
}

/** In Quản lý: each section's content fits the window, so no control (Nhóm, Gán đơn vị) hides off to the right. */
const contentFits = (page) =>
  page.evaluate(() => {
    const route = document.querySelector('.quan-ly-route');
    if (!route) return ['.quan-ly-route is not on the page'];
    return route.scrollWidth > route.clientWidth + 0.5
      ? [`content is ${route.scrollWidth}px wide in ${route.clientWidth}px: part of it is only reachable by scrolling sideways`]
      : [];
  });

// ---- Editing a lake through the map ---------------------------------------------------

const toMercator = ([lon, lat]) => [
  (lon * 20037508.34) / 180,
  (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180),
];

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A point inside the feature's largest polygon, nearest its bounding-box centre. */
function pointInside(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const ringArea = (r) => Math.abs(r.reduce((s, [x, y], i) => s + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0));
  const outer = polygons.map((p) => p[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
  const xs = outer.map((c) => c[0]);
  const ys = outer.map((c) => c[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  let best = null;
  for (let i = 1; i < 40; i += 1) {
    for (let j = 1; j < 40; j += 1) {
      const p = [box[0] + ((box[2] - box[0]) * i) / 40, box[1] + ((box[3] - box[1]) * j) / 40];
      if (!insideRing(p, outer)) continue;
      const d = (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2;
      if (!best || d < best.d) best = { p, d };
    }
  }
  return { box, point: best?.p ?? centre };
}

const bboxArea = (geometry) => {
  const coords = JSON.stringify(geometry.coordinates).match(/-?\d+\.?\d*/g).map(Number);
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

/** The largest named lake the filter leaves, found through the API as `token`'s holder. */
async function findLake(token, query, keep) {
  const res = await api('GET', `/api/layers/lakes/features?${query}`, token);
  const lakes = (res.json?.features ?? []).filter((f) => f.properties.name && f.geometry && keep(f.properties));
  lakes.sort((a, b) => bboxArea(b.geometry) - bboxArea(a.geometry));
  if (lakes.length === 0) throw new Error(`no named lake for ${query}`);
  return lakes[0];
}

async function openBienTap(page) {
  if (await page.$('.tool-menu:not([hidden])')) return;
  await clickText(page, '.tool-group button', 'Biên tập');
  await page.waitForSelector('.tool-menu:not([hidden])', { timeout: 5000 });
}

/** Zooms the map onto the lake, then clicks it with edit-existing mode on; the form opens. */
async function openLakeForm(session, lake) {
  const { page } = session;
  await openBienTap(page);
  await clickText(page, '.tool-menu button', 'Sửa đối tượng có sẵn');
  const { box, point } = pointInside(lake.geometry);
  const [x0, y0] = toMercator([box[0], box[1]]);
  const [x1, y1] = toMercator([box[2], box[3]]);
  const [px, py] = toMercator(point);
  await page.evaluate((extent) => {
    const map = window.__olMap;
    if (!map) throw new Error('window.__olMap is not exposed: run against the dev server');
    map.getView().fit(extent, { size: map.getSize(), maxZoom: 17, padding: [80, 80, 80, 80], duration: 0 });
  }, [x0, y0, x1, y1]);
  await sleep(1000);
  await session.settle();
  // The lakes are WFS features: wait until the layer has the lake before clicking.
  await sleep(2500);
  const pixel = await page.evaluate((coordinate) => {
    const map = window.__olMap;
    map.renderSync();
    const [x, y] = map.getPixelFromCoordinate(coordinate);
    const r = map.getViewport().getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }, [px, py]);
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForSelector('.edit-attr-form', { visible: true, timeout: 15000 });
  await sleep(1200);
}

async function managingUnitText(page) {
  return page.$eval('.managing-unit-field', (el) => el.innerText.replace(/\s+/g, ' ').trim());
}

/** Step 2, run as P. */
async function stepEditLake(session, vp, lake, token) {
  const { page } = session;
  const problems = [];
  const original = lake.properties.name;
  const edited = `${original} (kiểm thử)`;
  try {
    problems.push(...(await reachable(page, '.tool-group button', 'Biên tập')));
    await openLakeForm(session, lake);
    const shownName = await page.$eval('#attr-name', (el) => el.value);
    if (shownName !== original) problems.push(`the form shows the name "${shownName}", expected "${original}"`);
    const unit = await managingUnitText(page);
    if (unit.includes('ngoài phạm vi')) problems.push(`P's own ward shows as out of scope: ${unit}`);
    await shot(session, vp, 'p-bien-tap');

    await page.click('#attr-name', { clickCount: 3 });
    await page.type('#attr-name', edited);
    await clickText(page, '.edit-attr-form button', 'Lưu');
    try {
      await page.waitForFunction(() => !document.querySelector('.edit-attr-form'), { timeout: 15000 });
    } catch {
      const message = await page.$eval('.edit-attr-form', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');
      problems.push(`the save did not finish: ${message.slice(-200)}`);
    }
    const saved = await currentLake(token, lake);
    if (saved?.properties.name !== edited) problems.push(`the API shows the name "${saved?.properties.name}", expected "${edited}"`);
    await shot(session, vp, 'p-saved');
  } finally {
    // Put the old name back whatever happened above, so the lake is as it was found.
    const now = await currentLake(token, lake).catch(() => null);
    if (now && now.properties.name !== original) {
      const restore = await api('PUT', `/api/layers/lakes/features/${now.id}`, token, { properties: { name: original } });
      if (restore.status !== 200) problems.push(`restoring the name answered ${restore.status}`);
    }
  }
  return problems;
}

/** The lake as the API serves it now: its id changes with every edit, its external_id does not. */
async function currentLake(token, lake) {
  const res = await api('GET', `/api/layers/lakes/features?ward=${P_LAKE_WARD}`, token);
  return res.json?.features?.find((f) => f.properties.external_id === lake.properties.external_id) ?? null;
}

/** Step 3, run as X. */
async function stepOutOfScope(session, vp, lake, token, provinceName, wardName) {
  const { page } = session;
  const problems = [];
  await openLakeForm(session, lake);
  const unit = await managingUnitText(page);
  if (!unit.includes('ngoài phạm vi')) problems.push(`the field does not say "ngoài phạm vi": ${unit}`);
  if (!unit.includes(provinceName)) problems.push(`the field does not name ${provinceName}: ${unit}`);
  const editable = await page.$eval('.managing-unit-field', (el) => el.querySelectorAll('input, select').length);
  if (editable > 0) problems.push(`the Đơn vị chủ quản field has ${editable} editable controls, expected none`);
  await shot(session, vp, 'x-ngoai-pham-vi');

  const res = await api('PUT', `/api/layers/lakes/features/${lake.id}`, token, { properties: { name: `${lake.properties.name} (không được lưu)` } });
  const expected = `Đối tượng thuộc ${provinceName}; nhóm của anh/chị chỉ có quyền trong ${wardName}.`;
  if (res.status !== 403) problems.push(`the forced save answered ${res.status}, expected 403`);
  if (res.json?.error?.message !== expected) problems.push(`the refusal says "${res.json?.error?.message}", expected "${expected}"`);
  return problems;
}

/** Step 4: a visitor sees no Biên tập and no Quản lý, and /quan-ly sends them to the map. */
async function stepVisitor(session, vp) {
  const { page } = session;
  const problems = [];
  const tools = await page.$$eval('.tool-group button', (bs) => bs.map((b) => b.textContent.trim()));
  if (tools.includes('Biên tập')) problems.push('Biên tập is offered to a visitor');
  const links = await page.$$eval('.top-nav a', (as) => as.map((a) => a.textContent.trim()));
  if (links.includes('Quản lý')) problems.push('Quản lý is offered to a visitor');
  await page.goto(`${BASE_URL}/quan-ly`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const path = new URL(page.url()).pathname;
  if (path.startsWith('/quan-ly')) problems.push(`/quan-ly stayed open for a visitor (${path})`);
  await shot(session, vp, 'khach');
  return problems;
}

async function deleteGroupsAsAdmin(session) {
  await openQuanLy(session.page, 'Nhóm quyền');
  await session.page.waitForSelector('.user-mgmt', { timeout: 10000 });
  await sleep(800);
  await deleteTestGroups(session.page);
}

async function runViewport(browser, viewport, ctx) {
  const vp = viewport.width;
  const admin = await openSession(browser, viewport);
  const others = [];
  try {
  await signIn(admin.page, ACCOUNTS.admin);

  // Step 1 and 5 first: the groups must exist for 2 and 3.
  const grouped = await check(vp, '1', 'admin creates both groups from the templates and assigns P and X', () => stepGroups(admin, vp));
  await check(vp, '5', 'admin sees the features without geometry in Đơn vị chưa gán', () => stepUnassigned(admin, vp, ctx.adminToken));

  if (vp === 768) {
    await check(vp, '5b', 'Quản lý at 768: under the top bar, links reachable, no map control shows through', async () => {
      const problems = [];
      for (const section of ['Nhóm quyền', 'Người dùng', 'Đơn vị chưa gán']) {
        await openQuanLy(admin.page, section);
        problems.push(...(await quanLyFits(admin.page)).map((p) => `${section}: ${p}`));
      }
      return problems;
    });
    await check(vp, '5d', 'every Quản lý section fits the window width (no control hidden to the right)', async () => {
      const problems = [];
      for (const section of ['Nhóm quyền', 'Người dùng', 'Đơn vị chưa gán']) {
        await openQuanLy(admin.page, section);
        await sleep(500);
        problems.push(...(await contentFits(admin.page)).map((p) => `${section}: ${p}`));
      }
      return problems;
    });
    await check(vp, '5c', 'on the map, Biên tập and Quản lý are reachable and nothing covers the scale bar or the readout', async () => {
      await clickText(admin.page, '.top-nav a', 'Bản đồ');
      await admin.page.waitForFunction(() => !document.querySelector('.quan-ly-route'), { timeout: 10000 });
      await sleep(800);
      const problems = [
        ...(await reachable(admin.page, '.top-nav a', 'Quản lý')),
        ...(await reachable(admin.page, '.tool-group button', 'Biên tập')),
        ...(await mapReadoutsClear(admin.page)),
      ];
      await openBienTap(admin.page);
      problems.push(...(await mapReadoutsClear(admin.page)).map((p) => `Biên tập open: ${p}`));
      await shot(admin, vp, 'admin-ban-do');
      await clickText(admin.page, '.tool-group button', 'Biên tập');
      return problems;
    });
  }

  const p = await openSession(browser, viewport);
  others.push(p);
  await signIn(p.page, ACCOUNTS.p);
  await check(vp, '2', 'P sees Biên tập and edits the name of a lake managed by a Đà Nẵng xã', async () => {
    if (!grouped) return ['skipped: step 1 failed, so P has no group'];
    return stepEditLake(p, vp, ctx.pLake, ctx.pToken);
  });
  await check(vp, '2b', 'P, with no users.manage and no right at VN, does not see Quản lý', async () => {
    const links = await p.page.$$eval('.top-nav a', (as) => as.map((a) => a.textContent.trim()));
    return links.includes('Quản lý') ? ['Quản lý is offered to P'] : [];
  });

  const x = await openSession(browser, viewport);
  others.push(x);
  await signIn(x.page, ACCOUNTS.x);
  await check(vp, '3', 'X opens a lake managed by Đà Nẵng: read-only field, 403 on a forced save', async () => {
    if (!grouped) return ['skipped: step 1 failed, so X has no group'];
    return stepOutOfScope(x, vp, ctx.xLake, ctx.xToken, ctx.provinceName, ctx.wardName);
  });

  const visitor = await openSession(browser, viewport);
  others.push(visitor);
  await check(vp, '4', 'a visitor with no group sees no Biên tập and no Quản lý', () => stepVisitor(visitor, vp));

  } finally {
    // Whatever failed above, the test groups go and the browser contexts close.
    await check(vp, '6', 'admin deletes both test groups', async () => {
      await deleteGroupsAsAdmin(admin);
      const names = await groupNames(admin.page);
      return names.filter((n) => n.startsWith(GROUP_PREFIX)).map((n) => `group "${n}" is still listed`);
    });
    for (const other of others) await other.context.close().catch(() => {});
    await admin.context.close().catch(() => {});
  }
}

// ---- Undoing the run's database writes ------------------------------------------------

/** The same resolution packages/versioning uses: the rows a lakes version shows, by external_id along its chain. */
const RESOLVED_LAKES = `
  WITH RECURSIVE chain AS (
    SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = $1
    UNION ALL
    SELECT p.id, p.parent_version_id, c.depth + 1
      FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
  ),
  resolved AS (
    SELECT DISTINCT ON (t.external_id) t.*
      FROM water.lakes t JOIN chain c ON t.dataset_version_id = c.id
     ORDER BY t.external_id, c.depth
  )
  SELECT id FROM resolved WHERE NOT deleted`;

async function dbSnapshot(pool) {
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
  const active = await one(`SELECT id FROM app.dataset_versions WHERE layer_key = 'lakes' AND is_active`);
  const ids = (await pool.query(`SELECT id FROM app.users WHERE email = ANY($1)`,
    [[ACCOUNTS.admin.email, ACCOUNTS.p.email, ACCOUNTS.x.email]])).rows.map((r) => r.id);
  return {
    activeVersion: active?.id ?? null,
    startedAt: (await one(`SELECT clock_timestamp() AS t`)).t,
    accountIds: ids,
    lakeRows: Number((await one(`SELECT count(*) AS n FROM water.lakes`)).n),
    currentRows: Number((await one(`SELECT count(*) AS n FROM water.lakes WHERE is_current`)).n),
    versions: Number((await one(`SELECT count(*) AS n FROM app.dataset_versions WHERE layer_key = 'lakes'`)).n),
    audit: Number((await one(`SELECT count(*) AS n FROM app.audit_log`)).n),
  };
}

/**
 * Deletes what this run wrote: the lakes edit versions made by the P or X account since the start
 * (and their rows), the audit rows of the three accounts since the start, then re-activates the
 * recorded lakes version and moves is_current to the rows it resolves to.
 */
async function dbCleanup(pool, before) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const writerIds = (await client.query(`SELECT id FROM app.users WHERE email = ANY($1)`,
      [[ACCOUNTS.p.email, ACCOUNTS.x.email]])).rows.map((r) => r.id);
    const mine = `SELECT id FROM app.dataset_versions
                   WHERE layer_key = 'lakes' AND kind = 'edit' AND ingested_at >= $1 AND ingested_by = ANY($2)`;
    await client.query(`DELETE FROM water.lakes WHERE dataset_version_id IN (${mine})`, [before.startedAt, writerIds]);
    await client.query(`DELETE FROM app.dataset_versions WHERE id IN (${mine})`, [before.startedAt, writerIds]);
    await client.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1) AND created_at >= $2`, [before.accountIds, before.startedAt]);
    if (before.activeVersion) {
      await client.query(
        `UPDATE app.dataset_versions SET is_active = (id = $1) WHERE layer_key = 'lakes' AND is_active <> (id = $1)`,
        [before.activeVersion]);
      await client.query(
        `UPDATE water.lakes t SET is_current = false
          WHERE t.is_current AND NOT EXISTS (SELECT 1 FROM (${RESOLVED_LAKES}) r WHERE r.id = t.id)`,
        [before.activeVersion]);
      await client.query(
        `UPDATE water.lakes SET is_current = true WHERE NOT is_current AND id IN (${RESOLVED_LAKES})`,
        [before.activeVersion]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupCheck(pool, before) {
  try {
    await dbCleanup(pool, before);
    const after = await dbSnapshot(pool);
    const keys = ['lakeRows', 'currentRows', 'versions', 'audit'];
    const summary = keys.map((k) => `${k} ${before[k]} -> ${after[k]}`).join(', ');
    const problems = keys.filter((k) => after[k] !== before[k]).map((k) => `${k} was ${before[k]}, is ${after[k]}`);
    if (after.activeVersion !== before.activeVersion) {
      problems.push(`active lakes version was ${before.activeVersion}, is ${after.activeVersion}`);
    }
    if (problems.length === 0) line('PASS', 'all', 'cleanup', `database restored (${summary})`);
    else line('FAIL', 'all', 'cleanup', `${problems.join('; ')} (${summary})`);
  } catch (error) {
    line('FAIL', 'all', 'cleanup', `error: ${error.message.split('\n')[0]}`);
  }
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const adminToken = await login(ACCOUNTS.admin);
  const pToken = await login(ACCOUNTS.p);
  const xToken = await login(ACCOUNTS.x);
  // The units' names come from the same tree the app shows.
  const tree = (await api('GET', '/api/admin-units/tree', adminToken)).json;
  const units = Array.isArray(tree?.units) ? tree.units : [];
  const isWardOf = (code, province) => units.some((n) => n.code === code && n.level === 'ward' && n.parent === province);
  const nameOf = (code) => {
    const nodes = tree?.units ?? tree?.nodes ?? tree;
    const hit = Array.isArray(nodes) ? nodes.find((n) => n.code === code) : null;
    return hit?.name ?? code;
  };
  const ctx = {
    adminToken,
    pToken,
    xToken,
    provinceName: nameOf(PROVINCE),
    wardName: nameOf(X_WARD),
    pLake: await findLake(adminToken, `ward=${P_LAKE_WARD}`, (props) => isWardOf(props.managing_unit, PROVINCE)),
    xLake: await findLake(adminToken, `province=${PROVINCE}`, (props) => props.managing_unit === PROVINCE),
  };
  GROUP_P = `${GROUP_PREFIX} ${ctx.provinceName}`;
  GROUP_X = `${GROUP_PREFIX} ${ctx.wardName}`;
  if (!isWardOf(ctx.pLake.properties.managing_unit, PROVINCE)) {
    throw new Error(`P's lake is managed by ${ctx.pLake.properties.managing_unit}, not a ward of province ${PROVINCE}`);
  }
  console.log(`P edits "${ctx.pLake.properties.name}" (${ctx.pLake.id}); X opens "${ctx.xLake.properties.name}" (${ctx.xLake.id})`);

  const pool = new Pool({ connectionString: DATABASE_URL });
  const before = await dbSnapshot(pool);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });
  try {
    console.log(`verify-permissions against ${BASE_URL} and ${API_URL}`);
    for (const viewport of VIEWPORTS) await runViewport(browser, viewport, ctx);
  } finally {
    await browser.close().catch(() => {});
    await cleanupCheck(pool, before);
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
