/**
 * Proves in a real browser that the data dictionary's labels and units reach the screen, for the
 * official dams layer (expected values come from the served dictionary, GET /api/dictionary/dams):
 *
 *   1. The owner signs in, creates the map "Kiểm thử từ điển" in Bản của tôi and adds an edit copy
 *      of dams (Thêm lớp → Sửa một lớp chính thức). Its table opens: a header reads the label of
 *      wattage_mw, and that column's cells end in the display unit's symbol (" MW").
 *   2. A condition on that column, bằng, with the value of one row typed in vi-VN form (a comma
 *      decimal) leaves that row: the header says "· 1 khớp", and the chip names the label.
 *   3. A condition on status offers the operators bằng / khác / trống / không trống and, for the
 *      value, the value names of the dictionary's closed list. Choosing that row's status keeps
 *      "· 1 khớp" (the stored code is what is sent).
 *   4. A click on the row opens the form beside the rows: wattage_mw's field has the same label,
 *      the value in display units and the unit's symbol after the input; status shows its name.
 *   5. The official dams layer switched off and on again: its legend shows "Nhỏ (< 200 MW)",
 *      "Vừa (200 – 1.000 MW)" and "Lớn (> 1.000 MW)", and the status names.
 *   6. The (i) beside the dams layer opens the sheet: it lists the wattage_mw label with MW, and
 *      "Xem đầy đủ" leads to /du-lieu/dams.
 *   7. That layer page shows EPSG:4326 and the two template buttons; the CSV template answers 200.
 *  7b. Under print media the page prints whole: the code values stand open, the table's last row
 *      is shown, the buttons are hidden, and printed on A6 the content runs on past the first page.
 *   8. /du-lieu with the search "dap" finds the dams layer.
 *   9. Staff edit: in /quan-ly/tu-dien the wattage_mw label is saved as "<label> (kiểm thử)"; the
 *      edit copy's table header and its row form then read the new label.
 *  10. "Khôi phục mặc định" brings the label back; the history panel lists the edit and the restore.
 *  11. Cleanup through the API: the test map is deleted (with it the edit copy's draft), the owner
 *      holds the maps, uploads and jobs it held at the start, and the label is back at its default
 *      (GET /api/dictionary/dams). The label is restored through the API even when a step failed.
 *
 * Steps 9 and 10 need an owner who passes dictionary.manage on VN: an admin.
 *
 * Every step runs at 1440x900 and at 768x900 and prints one PASS / FAIL line, then the script
 * exits non-zero on any FAIL. A rerun first deletes maps titled "Kiểm thử từ điển" that an
 * interrupted run left. The API allows 100 requests a minute per address; the script retries its
 * own calls on a 429 and prints a `note` line for every 429 the app received.
 *
 * Credentials come only from the environment:
 *   VERIFY_OWNER_EMAIL / VERIFY_OWNER_PASSWORD   the owner of the test map (an admin: steps 9 and 10 edit the dictionary)
 * Optional: BASE_URL (web, default http://localhost:5173), API_URL (default http://localhost:3001),
 * CHROME_PATH.
 *
 * Run: npm run verify:dictionary -w @webatlas/web -- --out <dir> [--only 1440|768]
 * Needs: the Docker stack, the API and `npm run dev:web`.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const OWNER = { email: process.env.VERIFY_OWNER_EMAIL, password: process.env.VERIFY_OWNER_PASSWORD };
if (!OWNER.email || !OWNER.password) {
  console.error('Set VERIFY_OWNER_EMAIL and VERIFY_OWNER_PASSWORD (see the header of this script).');
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
/** Pause between the two widths, so the first width's requests leave the API's one-minute window. */
const COOL_DOWN_MS = 65000;

const MAP_TITLE = 'Kiểm thử từ điển';
const GROUP_OWN = 'Của tôi';
const LAYER_KEY = 'dams';
/** The official layer's row in Quản lý dữ liệu and its legend title. */
const DAMS_DISPLAY = 'Đập & Hồ chứa';
const NUMBER_COLUMN = 'wattage_mw';
const CODE_COLUMN = 'status';
/** The legend's size classes (thresholds in MW, vi-VN grouping). */
const LEGEND_SIZES = ['Nhỏ (< 200 MW)', 'Vừa (200 – 1.000 MW)', 'Lớn (> 1.000 MW)'];
/** Operators a code column offers (spec ruling 4). */
const CODE_OPS = ['bằng', 'khác', 'trống', 'không trống'];
/** What the staff edit appends to the label; the check always takes it off again. */
const EDIT_SUFFIX = ' (kiểm thử)';

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

/** A call that must answer 200; anything else stops the step with the API's answer. */
async function ok(method, path, token, body) {
  const res = await api(method, path, token, body);
  if (res.status !== 200) throw new Error(`${method} ${path} answered ${res.status}: ${res.json?.error?.message ?? ''}`);
  return res.json;
}

async function login({ email, password }) {
  const res = await api('POST', '/api/auth/login', null, { email, password });
  if (res.status !== 200) throw new Error(`API login for ${email} answered ${res.status}`);
  return res.json.token;
}

const WS = '/api/workspace';
const listMaps = (token) => ok('GET', `${WS}/maps`, token);
const getMap = async (token, id) => {
  const res = await api('GET', `${WS}/maps/${id}`, token);
  return res.status === 200 ? res.json.map : null;
};

/** What the owner holds, by id; the cleanup must bring it back to this. */
async function holdings(token) {
  return {
    maps: (await listMaps(token)).mine.map((m) => m.id).sort(),
    uploads: (await ok('GET', `${WS}/uploads`, token)).uploads.map((u) => u.id).sort(),
    jobs: (await ok('GET', `${WS}/jobs`, token)).jobs.map((j) => j.id).sort(),
  };
}

/** Deletes the owner's maps titled MAP_TITLE; returns the answers that were not a success. */
async function removeTestMaps(token) {
  const problems = [];
  for (const m of (await listMaps(token)).mine.filter((x) => x.title === MAP_TITLE)) {
    const detail = await getMap(token, m.id);
    if (!detail) continue;
    const res = await api('DELETE', `${WS}/maps/${m.id}`, token, { expectedRevision: detail.revision });
    if (![200, 204].includes(res.status)) problems.push(`DELETE map ${m.id} answered ${res.status}: ${res.json?.error?.message ?? ''}`);
  }
  return problems;
}

/**
 * What the screen must show, from the served dictionary: the labels, the display unit of
 * wattage_mw and its precision, and the status value names in order.
 */
async function expectations() {
  const dict = await ok('GET', `/api/dictionary/${LAYER_KEY}`, null);
  const attr = (name) => {
    const a = dict.attributes.find((x) => x.name === name);
    if (!a) throw new Error(`the served dictionary has no ${LAYER_KEY}.${name}`);
    return a;
  };
  const number = attr(NUMBER_COLUMN);
  const code = attr(CODE_COLUMN);
  if (number.storedUnit !== 'MW' || number.displayUnit !== 'MW') {
    throw new Error(`${NUMBER_COLUMN} is stored in ${number.storedUnit} and shown in ${number.displayUnit}; this check expects MW`);
  }
  const values = [...code.values].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    layerName: dict.name,
    numberLabel: number.label,
    precision: number.precision ?? 2,
    codeLabel: code.label,
    codeNames: values.map((v) => v.name),
    nameOf: Object.fromEntries(values.map((v) => [v.code, v.name])),
  };
}

/**
 * One row of the edit copy whose wattage is shared by no other row and has a fractional part
 * (so the comma decimal is exercised): the largest such. Read through the same query route the
 * table uses, in stored units.
 */
async function pickRow(token, mapId, layerId, expect) {
  const res = await ok('POST', `${WS}/maps/${mapId}/layers/${layerId}/query`, token,
    { conditions: [], match: 'all', offset: 0, limit: 500 });
  const counts = new Map();
  for (const r of res.rows) {
    const v = Number(r.properties[NUMBER_COLUMN]);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const unique = res.rows
    .map((r) => ({ id: r.id, name: r.properties.name, value: Number(r.properties[NUMBER_COLUMN]), status: r.properties[CODE_COLUMN] }))
    .filter((r) => Number.isFinite(r.value) && counts.get(r.value) === 1 && !Number.isInteger(r.value) && r.name && r.status in expect.nameOf)
    .sort((a, b) => b.value - a.value);
  if (unique.length === 0) throw new Error('no dams row has a unique fractional wattage');
  const row = unique[0];
  return {
    ...row,
    total: res.total,
    /** As the cell shows it (vi-VN, display precision) and as typed into the condition. */
    shown: row.value.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: expect.precision }),
    /** As the form seeds it: full precision, comma decimal, no grouping. */
    input: row.value.toLocaleString('vi-VN', { useGrouping: false, maximumFractionDigits: 10 }),
  };
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
  window.__dd = {
    text,
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
      if (scope?.card) return window.__dd.card(scope.card, scope.group);
      if (scope?.selector) {
        const all = document.querySelectorAll(scope.selector);
        return all[all.length - 1] ?? null;
      }
      return document;
    },
    buttons(scope) {
      const root = window.__dd.root(scope);
      return root ? [...root.querySelectorAll('button')].map(text) : [];
    },
    click(scope, label) {
      const root = window.__dd.root(scope);
      const button = root && [...root.querySelectorAll('button')].find((b) => text(b) === label && !b.disabled);
      button?.click();
      return Boolean(button);
    },
    /** The personal layer row titled `title` in a card. */
    hasLayer(scope, title) {
      const root = window.__dd.root(scope);
      return Boolean(root && [...root.querySelectorAll('.my-maps-layer .layer-label span')].some((s) => text(s) === title));
    },
    /** The official layer's checkbox in Quản lý dữ liệu (not a personal layer's). */
    officialBox(name) {
      const label = [...document.querySelectorAll('.layers-panel:not(.my-maps) label.layer-label')]
        .find((l) => l.querySelector('span') && text(l.querySelector('span')) === name);
      return label?.querySelector('input[type="checkbox"]') ?? null;
    },
    /** The legend section of a layer: its entry labels, or null while it is not shown. */
    legend(name) {
      const layer = [...document.querySelectorAll('.legend-panel .legend-layer')]
        .find((l) => l.querySelector('.legend-layer-title') && text(l.querySelector('.legend-layer-title')) === name);
      return layer ? [...layer.querySelectorAll('.legend-entry')].map(text) : null;
    },
  };
}

async function openSession(browser, viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(installPageHelpers);
  page.on('pageerror', (error) => console.log(`pageerror ${viewport.width}  ${String(error.message ?? error).split('\n')[0]}`));
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
  await sleep(300);
  const path = join(OUT, `verify-dictionary-${name}-${vp}.png`);
  await session.page.screenshot({ path });
  console.log(`shot    ${vp}  ${path}`);
}

async function click(page, scope, label) {
  const done = await page.evaluate((s, l) => window.__dd.click(s, l), scope, label);
  if (!done) {
    const offered = await page.evaluate((s) => window.__dd.buttons(s), scope);
    throw new Error(`no enabled button "${label}" in ${JSON.stringify(scope)}; offered: ${offered.join(' | ')}`);
  }
}

/** A real mouse click on the enabled button `label` inside `selector`. */
async function press(page, selector, label) {
  for (const button of await page.$$(`${selector} button`)) {
    const match = await button.evaluate((b, l) => b.textContent.replace(/\s+/g, ' ').trim() === l && !b.disabled, label);
    if (match) {
      await button.click();
      return;
    }
  }
  throw new Error(`no enabled button "${label}" in ${selector}`);
}

const dialogText = (page) => page.evaluate(() => {
  const all = document.querySelectorAll('.dialog');
  return all.length ? window.__dd.text(all[all.length - 1]) : '';
});

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

// ---- The layer table -----------------------------------------------------------------------

/** What the table docked under the map shows, or null while none is open. */
const tableState = (page) => page.evaluate(() => {
  const table = document.querySelector('.layer-table');
  if (!table) return null;
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  return {
    title: text(table.querySelector('.layer-table-title')),
    count: text(table.querySelector('.layer-table-count')),
    busy: table.querySelector('table')?.getAttribute('aria-busy') === 'true',
    headers: [...table.querySelectorAll('thead th')].map(text),
    rows: [...table.querySelectorAll('tbody tr')].map((r) => ({
      cells: [...r.cells].map(text),
      selected: r.classList.contains('selected'),
    })),
    chips: [...table.querySelectorAll('.layer-table-chip-text')].map(text),
  };
});

/** Waits until the table's state passes `pass`; the error names `what` and shows the table. */
async function waitTable(page, what, pass, timeout = 15000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await tableState(page);
    if (last && pass(last)) return last;
    await sleep(250);
  }
  const shown = last && { title: last.title, count: last.count, headers: last.headers, rows: last.rows.slice(0, 3).map((r) => r.cells.join(' | ')) };
  throw new Error(`the table never showed ${what}: ${JSON.stringify(shown).slice(0, 500)}`);
}

// ---- Steps ---------------------------------------------------------------------------------

const OWN = { card: MAP_TITLE, group: GROUP_OWN };

/** Step 1: the map, the edit copy of dams, and its table's header and cells. */
async function stepEditCopy(session, vp, ctx) {
  const { page } = session;
  const { expect } = ctx;
  const problems = [];
  await click(page, { selector: '.my-maps-buttons' }, 'Bản đồ mới');
  await page.waitForSelector('#my-map-title', { visible: true, timeout: 5000 });
  await page.type('#my-map-title', MAP_TITLE);
  await click(page, { selector: '.dialog' }, 'Tạo');
  await page.waitForFunction((t, g) => {
    const card = window.__dd.card(t, g);
    return card?.querySelector('.my-map-head')?.getAttribute('aria-expanded') === 'true' && card.querySelector('.my-map-actions');
  }, { timeout: 15000 }, MAP_TITLE, GROUP_OWN);
  const maps = (await listMaps(ctx.token)).mine.filter((m) => m.title === MAP_TITLE);
  if (maps.length !== 1) throw new Error(`the owner has ${maps.length} maps titled "${MAP_TITLE}"`);
  ctx.mapId = maps[0].id;

  await click(page, OWN, 'Thêm lớp');
  await click(page, OWN, 'Sửa một lớp chính thức');
  await page.waitForSelector('#edit-copy-layer', { visible: true, timeout: 5000 });
  await page.select('#edit-copy-layer', LAYER_KEY);
  await click(page, { selector: '.dialog' }, 'Tạo bản sửa');
  try {
    await page.waitForFunction(() => !document.querySelector('.dialog'), { timeout: 15000 });
  } catch {
    throw new Error(`Sửa một lớp chính thức did not close: ${(await dialogText(page)).slice(-300)}`);
  }
  const layer = (await getMap(ctx.token, ctx.mapId))?.layers.find((l) => l.kind === 'edit_copy' && l.layerKey === LAYER_KEY);
  if (!layer) throw new Error(`the map holds no edit copy of ${LAYER_KEY}`);
  ctx.layer = layer;
  await page.waitForFunction((s, t) => window.__dd.hasLayer(s, t), { timeout: 15000 }, OWN, layer.title);
  ctx.row = await pickRow(ctx.token, ctx.mapId, layer.id, expect);
  console.log(`          ${vp}: row "${ctx.row.name}", ${NUMBER_COLUMN} ${ctx.row.value} (shown ${ctx.row.shown} MW), ${CODE_COLUMN} ${ctx.row.status}`);

  const found = await page.evaluate((s, t) => {
    const button = [...(window.__dd.root(s)?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === `Bảng ${t}`);
    button?.click();
    return Boolean(button);
  }, OWN, layer.title);
  if (!found) throw new Error(`the layer row "${layer.title}" has no Bảng`);
  const all = `${ctx.row.total.toLocaleString('vi-VN')} đối tượng · ${ctx.row.total.toLocaleString('vi-VN')} khớp`;
  const state = await waitTable(page, `"${all}"`, (s) => s.title === layer.title && s.count === all && !s.busy && s.rows.length > 0);
  const col = state.headers.indexOf(expect.numberLabel);
  if (col === -1) {
    problems.push(`no header reads "${expect.numberLabel}": ${state.headers.join(' | ')}`);
  } else {
    const cells = state.rows.map((r) => r.cells[col]);
    const bare = cells.filter((c) => !c.endsWith(' MW'));
    if (bare.length > 0) problems.push(`${bare.length} of ${cells.length} "${expect.numberLabel}" cells do not end in " MW", e.g. "${bare[0]}"`);
  }
  if (state.headers.includes(NUMBER_COLUMN)) problems.push(`a header still reads the raw name ${NUMBER_COLUMN}`);
  if (!state.headers.includes(expect.codeLabel)) problems.push(`no header reads "${expect.codeLabel}"`);
  ctx.col = col;
  await shot(session, vp, 'bang');
  return problems;
}

/** Step 2: wattage_mw bằng the row's value typed in vi-VN form leaves that row. */
async function stepNumberFilter(session, ctx) {
  const { page } = session;
  const { expect, row } = ctx;
  const problems = [];
  await press(page, '.layer-table-toolbar', '+ Thêm điều kiện');
  const editor = '.layer-table-editor';
  await page.waitForSelector(`${editor} select[aria-label="Trường"]`, { timeout: 5000 });
  const fieldText = await page.evaluate((sel, name) => [...document.querySelector(sel).options].find((o) => o.value === name)?.textContent.trim() ?? null,
    `${editor} select[aria-label="Trường"]`, NUMBER_COLUMN);
  if (fieldText !== expect.numberLabel) problems.push(`the field option for ${NUMBER_COLUMN} reads "${fieldText}"`);
  await page.select(`${editor} select[aria-label="Trường"]`, NUMBER_COLUMN);
  await page.select(`${editor} select[aria-label="Phép so sánh"]`, 'eq');
  const op = await page.$eval(`${editor} select[aria-label="Phép so sánh"]`, (s) => s.selectedOptions[0]?.textContent.trim());
  if (op !== 'bằng') problems.push(`the operator reads "${op}", expected "bằng"`);
  await page.type(`${editor} input[aria-label="Giá trị"]`, row.shown);
  await page.keyboard.press('Enter');
  const state = await waitTable(page, '"· 1 khớp" with one row', (s) => !s.busy && s.count?.endsWith('· 1 khớp') && s.rows.length === 1);
  if (!state.rows[0].cells.includes(row.name)) problems.push(`the row left is ${state.rows[0].cells.join(' | ')}, expected "${row.name}"`);
  if (ctx.col !== -1 && state.rows[0].cells[ctx.col] !== `${row.shown} MW`) {
    problems.push(`its cell reads "${state.rows[0].cells[ctx.col]}", expected "${row.shown} MW"`);
  }
  const chip = `${expect.numberLabel} bằng ${row.shown}`;
  if (state.chips[0] !== chip) problems.push(`the condition chip reads "${state.chips[0]}", expected "${chip}"`);
  return problems;
}

/** Step 3: a condition on status offers the dictionary's value names; the row's own keeps it. */
async function stepCodeFilter(session, vp, ctx) {
  const { page } = session;
  const { expect, row } = ctx;
  const problems = [];
  await press(page, '.layer-table-toolbar', '+ Thêm điều kiện');
  const editor = '.layer-table-editor';
  await page.waitForSelector(`${editor} select[aria-label="Trường"]`, { timeout: 5000 });
  await page.select(`${editor} select[aria-label="Trường"]`, CODE_COLUMN);
  const ops = await page.$$eval(`${editor} select[aria-label="Phép so sánh"] option`, (os) => os.map((o) => o.textContent.trim()));
  if (JSON.stringify(ops) !== JSON.stringify(CODE_OPS)) problems.push(`the operators are ${ops.join(' | ')}, expected ${CODE_OPS.join(' | ')}`);
  await page.select(`${editor} select[aria-label="Phép so sánh"]`, 'eq');
  const valueSelect = `${editor} select[aria-label="Giá trị"]`;
  await page.waitForSelector(valueSelect, { timeout: 5000 });
  const offered = await page.$$eval(`${valueSelect} option`, (os) => os.filter((o) => o.value !== '').map((o) => o.textContent.trim()));
  if (JSON.stringify(offered) !== JSON.stringify(expect.codeNames)) {
    problems.push(`the value picker offers ${offered.join(' | ')}, expected ${expect.codeNames.join(' | ')}`);
  }
  await page.select(valueSelect, row.status);
  await page.focus(valueSelect);
  await page.keyboard.press('Enter');
  const name = expect.nameOf[row.status];
  const chip = `${expect.codeLabel} bằng ${name}`;
  const state = await waitTable(page, `the chip "${chip}" and "· 1 khớp"`,
    (s) => !s.busy && s.chips.includes(chip) && s.count?.endsWith('· 1 khớp') && s.rows.length === 1);
  if (!state.rows[0].cells.includes(name)) problems.push(`the row's ${CODE_COLUMN} cell does not read "${name}": ${state.rows[0].cells.join(' | ')}`);
  await shot(session, vp, 'bang-loc');
  return problems;
}

/** Step 4: the selected row's form shows the same label, the display value and the unit. */
async function stepForm(session, vp, ctx) {
  const { page } = session;
  const { expect, row } = ctx;
  const problems = [];
  for (const r of await page.$$('.layer-table tbody tr')) {
    const cells = await r.$$eval('td', (tds) => tds.map((td) => td.textContent.trim()));
    if (cells.includes(row.name)) { await r.click(); break; }
  }
  await waitTable(page, `the row "${row.name}" selected`, (s) => s.rows.some((r) => r.selected && r.cells.includes(row.name)));
  const input = `.layer-table-form #attr-${NUMBER_COLUMN}`;
  await page.waitForSelector(input, { visible: true, timeout: 10000 });
  const form = await page.evaluate((n, c) => {
    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const root = document.querySelector('.layer-table-form');
    const status = root.querySelector(`#attr-${c}`);
    return {
      label: text(root.querySelector(`label[for="attr-${n}"]`)),
      value: root.querySelector(`#attr-${n}`)?.value ?? null,
      unit: text(root.querySelector(`#attr-${n}-unit`)),
      describedBy: root.querySelector(`#attr-${n}`)?.getAttribute('aria-describedby') ?? null,
      statusLabel: text(root.querySelector(`label[for="attr-${c}"]`)),
      statusShown: status?.selectedOptions?.[0] ? text(status.selectedOptions[0]) : null,
    };
  }, NUMBER_COLUMN, CODE_COLUMN);
  if (form.label !== expect.numberLabel) problems.push(`the field's label reads "${form.label}", expected "${expect.numberLabel}"`);
  if (form.value !== row.input) problems.push(`the field holds "${form.value}", expected "${row.input}"`);
  if (form.unit !== 'MW') problems.push(`the field's unit suffix reads "${form.unit}", expected "MW"`);
  if (form.describedBy !== `attr-${NUMBER_COLUMN}-unit`) problems.push(`the input is not described by its unit (aria-describedby "${form.describedBy}")`);
  if (form.statusLabel !== expect.codeLabel) problems.push(`the status label reads "${form.statusLabel}", expected "${expect.codeLabel}"`);
  if (form.statusShown !== expect.nameOf[row.status]) problems.push(`the status select shows "${form.statusShown}", expected "${expect.nameOf[row.status]}"`);
  // The form scrolls on its own; show the field in the screenshot.
  await page.$eval(input, (el) => el.scrollIntoView({ block: 'center' }));
  await shot(session, vp, 'bieu-mau');
  return problems;
}

/** Step 5: the official dams layer off then on; its legend shows the size classes in MW. */
async function stepLegend(session, vp, ctx) {
  const { page } = session;
  const problems = [];
  if (await page.$('.layer-table')) {
    await press(page, '.layer-table-toolbar', 'Đóng');
    await page.waitForFunction(() => !document.querySelector('.layer-table'), { timeout: 5000 });
  }
  const setOfficial = (on) => page.evaluate((name, want) => {
    const box = window.__dd.officialBox(name);
    if (!box) return false;
    if (box.checked !== want) box.click();
    return true;
  }, DAMS_DISPLAY, on);
  if (!(await setOfficial(false))) throw new Error(`no row "${DAMS_DISPLAY}" in Quản lý dữ liệu`);
  await page.waitForFunction((n) => window.__dd.legend(n) === null, { timeout: 5000 }, DAMS_DISPLAY)
    .catch(() => problems.push(`the legend keeps "${DAMS_DISPLAY}" with the layer off`));
  await setOfficial(true);
  await page.waitForFunction((n) => window.__dd.legend(n) !== null, { timeout: 5000 }, DAMS_DISPLAY);
  const entries = await page.evaluate((n) => window.__dd.legend(n), DAMS_DISPLAY);
  for (const wanted of [...LEGEND_SIZES, ...ctx.expect.codeNames]) {
    if (!entries.includes(wanted)) problems.push(`the legend has no "${wanted}": ${entries.join(' | ')}`);
  }
  await page.evaluate((n) => {
    const layer = [...document.querySelectorAll('.legend-panel .legend-layer')]
      .find((l) => window.__dd.text(l.querySelector('.legend-layer-title')) === n);
    layer?.scrollIntoView({ block: 'center' });
  }, DAMS_DISPLAY);
  await shot(session, vp, 'chu-giai');
  return problems;
}

// ---- Dictionary pages and the staff editor -------------------------------------------------------

/** Waits for the served label of wattage_mw to equal `label`. */
async function waitServedLabel(label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 15000) {
    const dict = await ok('GET', `/api/dictionary/${LAYER_KEY}`, null);
    last = dict.attributes.find((a) => a.name === NUMBER_COLUMN)?.label;
    if (last === label) return;
    await sleep(300);
  }
  throw new Error(`the served label is "${last}", expected "${label}"`);
}

/** Step 6: the (i) beside the dams layer opens the sheet; "Xem đầy đủ" leads to its page. */
async function stepSheet(session, vp, ctx) {
  const { page } = session;
  const problems = [];
  const info = await page.$(`button[aria-label="Thuộc tính của ${DAMS_DISPLAY}"]`);
  if (!info) throw new Error(`no (i) button beside "${DAMS_DISPLAY}"`);
  await info.evaluate((b) => b.click());
  await page.waitForSelector('.dictionary-sheet', { visible: true, timeout: 10000 });
  const rows = await page.$$eval('.dictionary-sheet-row', (els) => els.map((el) => ({
    label: el.querySelector('.dictionary-sheet-label span')?.textContent.trim(),
    unit: el.querySelector('.dictionary-sheet-unit')?.textContent.trim() ?? null,
  })));
  const row = rows.find((r) => r.label === ctx.expect.numberLabel);
  if (!row) problems.push(`the sheet has no row "${ctx.expect.numberLabel}": ${rows.map((r) => r.label).join(' | ')}`);
  else if (row.unit !== 'MW') problems.push(`its unit reads "${row.unit}", expected "MW"`);
  await shot(session, vp, 'ban-thuoc-tinh');
  await page.$eval('.dictionary-sheet a.link', (a) => a.click());
  await page.waitForFunction((k) => location.pathname === `/du-lieu/${k}`, { timeout: 10000 }, LAYER_KEY)
    .catch(() => problems.push('"Xem đầy đủ" did not lead to /du-lieu/dams'));
  return problems;
}

/** Step 7: the layer page names the CRS and offers both templates; the CSV one answers 200. */
async function stepLayerPage(session, vp) {
  const { page } = session;
  const problems = [];
  await page.waitForSelector('.layer-page .layer-page-templates', { timeout: 10000 });
  const info = await page.evaluate(() => {
    const root = document.querySelector('.layer-page');
    return {
      meta: root.querySelector('.layer-page-meta')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      links: [...root.querySelectorAll('.layer-page-templates a')].map((a) => ({ text: a.textContent.trim(), href: a.href })),
    };
  });
  if (!info.meta.includes('EPSG:4326')) problems.push(`the page does not show EPSG:4326: "${info.meta}"`);
  for (const wanted of ['Tải mẫu GeoPackage', 'Tải mẫu CSV']) {
    if (!info.links.some((l) => l.text === wanted)) problems.push(`no button "${wanted}": ${info.links.map((l) => l.text).join(' | ')}`);
  }
  const csv = info.links.find((l) => l.text === 'Tải mẫu CSV');
  if (csv) {
    const status = await page.evaluate((href) => fetch(href).then((r) => r.status), csv.href);
    if (status !== 200) problems.push(`the CSV template answered ${status}`);
  }
  await shot(session, vp, 'trang-lop');
  return problems;
}

/** The number of pages in a PDF the browser printed. */
function pdfPages(pdf) {
  return (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

/**
 * Step 7b: the layer page prints whole. Under print media the code values stand open and the
 * table's last row is shown; printed on A6 (the page is taller than one A6 sheet), the content
 * runs on to more pages instead of being cut at the first one.
 */
async function stepPrint(session, vp) {
  const { page } = session;
  const problems = [];
  await page.emulateMediaType('print');
  try {
    const state = await page.evaluate(() => {
      const root = document.querySelector('.layer-page');
      const rows = [...root.querySelectorAll('.layer-page-table tbody tr')];
      const last = rows[rows.length - 1];
      const values = [...root.querySelectorAll('.layer-page-values li')];
      return {
        rows: rows.length,
        lastShown: Boolean(last && last.checkVisibility() && last.getBoundingClientRect().height > 0),
        lastLabel: last?.querySelector('th span')?.textContent.trim() ?? null,
        values: values.length,
        hiddenValues: values.filter((li) => !li.checkVisibility() || li.getBoundingClientRect().height === 0).map((li) => li.textContent.trim()),
        buttonsShown: [...root.querySelectorAll('.no-print')].filter((el) => el.checkVisibility()).length,
      };
    });
    if (state.rows === 0) problems.push('the attribute table has no rows');
    if (!state.lastShown) problems.push(`the table's last row "${state.lastLabel}" is not shown in print`);
    if (state.values === 0) problems.push('the page lists no code values');
    if (state.hiddenValues.length > 0) problems.push(`code values hidden in print: ${state.hiddenValues.join(' | ')}`);
    if (state.buttonsShown > 0) problems.push(`${state.buttonsShown} buttons or links of the page still show in print`);
    const pages = pdfPages(await page.pdf({ format: 'A6' }));
    if (pages < 2) problems.push(`printed on A6 the page takes ${pages} page(s): its content is cut at the first page`);
    console.log(`          ${vp}: printed on A6 in ${pages} pages; ${state.values} code values shown; last row "${state.lastLabel}"`);
  } finally {
    await page.emulateMediaType(null);
  }
  return problems;
}

/** Step 8: back on /du-lieu, the search "dap" finds the dams layer. */
async function stepList(session, vp, ctx) {
  const { page } = session;
  await page.$$eval('.layer-page a.link', (as) => as.find((a) => a.textContent.trim() === 'Về danh sách')?.click());
  await page.waitForSelector('input[aria-label="Tìm lớp"]', { visible: true, timeout: 10000 });
  await page.type('input[aria-label="Tìm lớp"]', 'dap');
  const found = await page.waitForFunction((name) => [...document.querySelectorAll('.dictionary-list-row')]
    .some((a) => a.textContent.includes(name) && a.getAttribute('href') === '/du-lieu/dams'), { timeout: 10000 }, ctx.expect.layerName)
    .then(() => true, () => false);
  await shot(session, vp, 'du-lieu');
  return found ? [] : [`the search "dap" does not list "${ctx.expect.layerName}" with a link to /du-lieu/dams`];
}

/** Opens /quan-ly/tu-dien on the dams layer with the attribute button `label` chosen. */
async function openEditor(page, label) {
  await page.goto(`${BASE_URL}/quan-ly/tu-dien`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dict-layer', { visible: true, timeout: 30000 });
  await page.select('#dict-layer', LAYER_KEY);
  await page.waitForFunction((l) => [...document.querySelectorAll('nav[aria-label="Thuộc tính"] button')].some((b) => b.textContent.trim() === l),
    { timeout: 15000 }, label);
  await page.evaluate((l) => [...document.querySelectorAll('nav[aria-label="Thuộc tính"] button')].find((b) => b.textContent.trim() === l).click(), label);
  await page.waitForSelector('#dict-attr-label', { visible: true, timeout: 10000 });
}

/** Reloads the map and opens the edit copy's table from its card. */
async function openEditCopyTable(page, ctx) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 30000 });
  await page.waitForSelector('.my-maps .my-maps-buttons', { timeout: 20000 });
  await page.waitForFunction((t, g) => Boolean(window.__dd.card(t, g)), { timeout: 15000 }, MAP_TITLE, GROUP_OWN);
  const expanded = await page.evaluate((t, g) => window.__dd.card(t, g).querySelector('.my-map-head').getAttribute('aria-expanded') === 'true', MAP_TITLE, GROUP_OWN);
  if (!expanded) await page.evaluate((t, g) => window.__dd.card(t, g).querySelector('.my-map-head').click(), MAP_TITLE, GROUP_OWN);
  await page.waitForFunction((s, t) => window.__dd.hasLayer(s, t), { timeout: 15000 }, OWN, ctx.layer.title);
  await page.evaluate((s, t) => [...window.__dd.root(s).querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === `Bảng ${t}`).click(), OWN, ctx.layer.title);
}

/** Step 9: the staff edit reaches the edit copy's table header and its row form. */
async function stepStaffEdit(session, vp, ctx) {
  const { page } = session;
  const problems = [];
  const original = ctx.expect.numberLabel;
  const edited = `${original}${EDIT_SUFFIX}`;
  await openEditor(page, original);
  await page.click('#dict-attr-label', { clickCount: 3 });
  await page.keyboard.press('End');
  await page.type('#dict-attr-label', EDIT_SUFFIX);
  ctx.edited = true;
  await press(page, `form[aria-label="${original}"]`, 'Lưu');
  await waitServedLabel(edited);
  await shot(session, vp, 'tu-dien-sua');

  await openEditCopyTable(page, ctx);
  const state = await waitTable(page, `a header "${edited}"`, (s) => !s.busy && s.headers.includes(edited) && s.rows.length > 0);
  if (state.headers.includes(original)) problems.push(`a header still reads the old label "${original}"`);
  await page.evaluate(() => document.querySelector('.layer-table tbody tr').click());
  await page.waitForSelector(`.layer-table-form label[for="attr-${NUMBER_COLUMN}"]`, { visible: true, timeout: 10000 });
  const formLabel = await page.$eval(`.layer-table-form label[for="attr-${NUMBER_COLUMN}"]`, (l) => l.textContent.replace(/\s+/g, ' ').trim());
  if (formLabel !== edited) problems.push(`the row form's label reads "${formLabel}", expected "${edited}"`);
  await shot(session, vp, 'nhan-moi');
  return problems;
}

/** Step 10: "Khôi phục mặc định" brings the label back; the history lists the edit and the restore. */
async function stepRestore(session, vp, ctx) {
  const { page } = session;
  const problems = [];
  const original = ctx.expect.numberLabel;
  const edited = `${original}${EDIT_SUFFIX}`;
  await openEditor(page, edited);
  const clicked = await page.evaluate(() => {
    const field = document.querySelector('#dict-attr-label')?.closest('.dictionary-field');
    const button = field && [...field.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Khôi phục mặc định');
    button?.click();
    return Boolean(button);
  });
  if (!clicked) throw new Error('the label field offers no "Khôi phục mặc định"');
  await waitServedLabel(original);
  ctx.edited = false;
  const rows = () => page.$$eval('.dictionary-history-table tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  const start = Date.now();
  let list = [];
  while (Date.now() - start < 15000) {
    list = await rows();
    if (list.some((r) => r[4] === 'khôi phục') && list.some((r) => r[4] === 'sửa')) break;
    await sleep(300);
  }
  const edit = list.find((r) => r[4] === 'sửa' && r[3].endsWith(`→ ${edited}`));
  const restore = list.find((r) => r[4] === 'khôi phục' && r[3].startsWith(edited));
  const dump = list.map((r) => r.slice(2).join(' / ')).join(' ; ');
  if (!edit) problems.push(`the history has no edit row "… → ${edited}": ${dump}`);
  if (!restore) problems.push(`the history has no restore row "${edited} → …": ${dump}`);
  const shown = await page.$eval('#dict-attr-label', (i) => i.value);
  if (shown !== original) problems.push(`the field reads "${shown}" after the restore, expected "${original}"`);
  await shot(session, vp, 'lich-su');
  return problems;
}

/** The served label of wattage_mw. */
async function servedLabel() {
  const dict = await ok('GET', `/api/dictionary/${LAYER_KEY}`, null);
  return dict.attributes.find((a) => a.name === NUMBER_COLUMN)?.label;
}

/**
 * Restores the label through the API when it ends in EDIT_SUFFIX; returns the problems. A restore
 * quotes the attribute's current revision, read just before (a stale one is refused 409).
 */
async function restoreLabel(token) {
  const dict = await ok('GET', `/api/dictionary/${LAYER_KEY}`, null);
  const attr = dict.attributes.find((a) => a.name === NUMBER_COLUMN);
  if (!attr?.label.endsWith(EDIT_SUFFIX)) return [];
  const res = await api('POST', `/api/dictionary/${LAYER_KEY}/${NUMBER_COLUMN}/restore`, token,
    { expectedRevision: attr.revision, fields: ['label'] });
  return res.status === 200 ? [] : [`restoring the label answered ${res.status}: ${res.json?.error?.message ?? ''}`];
}

// ---- One viewport ------------------------------------------------------------------------

async function runViewport(browser, viewport, ctx) {
  const vp = viewport.width;
  const leftovers = await removeTestMaps(ctx.token);
  if (leftovers.length > 0) throw new Error(`could not clear an earlier run: ${leftovers.join('; ')}`);
  const session = await openSession(browser, viewport);
  try {
    await signIn(session.page, OWNER);
    const opened = await check(vp, '1', `an edit copy of ${LAYER_KEY}: a header reads "${ctx.expect.numberLabel}", its cells end in " MW"`,
      () => stepEditCopy(session, vp, ctx));
    const after = (fn) => async () => (opened ? fn() : ['skipped: step 1 failed']);
    const filtered = await check(vp, '2', `a condition "${ctx.expect.numberLabel}" bằng one row's value in vi-VN form: "· 1 khớp"`,
      after(() => stepNumberFilter(session, ctx)));
    await check(vp, '3', `a condition on ${CODE_COLUMN} offers the dictionary's value names`,
      after(() => stepCodeFilter(session, vp, ctx)));
    await check(vp, '4', `the selected row's form: "${ctx.expect.numberLabel}" with the MW suffix`,
      after(async () => (filtered ? stepForm(session, vp, ctx) : ['skipped: step 2 failed'])));
    await check(vp, '5', `the dams layer on: the legend shows "${LEGEND_SIZES[0]}"`, () => stepLegend(session, vp, ctx));
    const sheet = await check(vp, '6', `the (i) sheet lists "${ctx.expect.numberLabel}" with MW; "Xem đầy đủ" opens /du-lieu/${LAYER_KEY}`,
      () => stepSheet(session, vp, ctx));
    const layerPage = await check(vp, '7', 'the layer page shows EPSG:4326 and both templates; the CSV template answers 200',
      async () => (sheet ? stepLayerPage(session, vp) : ['skipped: step 6 failed']));
    await check(vp, '7b', 'the layer page prints whole: code values open, the last row shown, the content runs on past one A6 page',
      async () => (layerPage ? stepPrint(session, vp) : ['skipped: step 7 failed']));
    await check(vp, '8', '/du-lieu search "dap" finds the dams layer',
      async () => (layerPage ? stepList(session, vp, ctx) : ['skipped: step 7 failed']));
    const staff = await check(vp, '9', `staff edit: "${ctx.expect.numberLabel}${EDIT_SUFFIX}" reaches the table header and the row form`,
      after(() => stepStaffEdit(session, vp, ctx)));
    await check(vp, '10', 'Khôi phục mặc định brings the label back; the history lists the edit and the restore',
      async () => (staff || ctx.edited ? stepRestore(session, vp, ctx) : ['skipped: step 9 failed']));
  } finally {
    await session.context.close().catch(() => {});
    await check(vp, '11', 'cleanup through the API: the test map is deleted; the owner holds what it held at the start; the label is at its default', async () => {
      const problems = [...(await removeTestMaps(ctx.token)), ...(await restoreLabel(ctx.token))];
      if ((await servedLabel()) !== ctx.expect.numberLabel) problems.push(`the served label is not "${ctx.expect.numberLabel}"`);
      const now = await holdings(ctx.token);
      for (const key of ['maps', 'uploads', 'jobs']) {
        if (JSON.stringify(now[key]) !== JSON.stringify(ctx.start[key])) {
          problems.push(`the owner held ${ctx.start[key].length} ${key} at the start, holds ${now[key].length} now`);
        }
      }
      return problems;
    });
  }
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const token = await login(OWNER);
  // A label an interrupted run left edited is restored first, so the expectations read the default.
  const stale = await restoreLabel(token);
  if (stale.length > 0) throw new Error(stale.join('; '));
  const ctx = { token, expect: await expectations(), edited: false };
  // Clear an interrupted run's leftovers first, then record the baseline.
  const leftovers = await removeTestMaps(ctx.token);
  if (leftovers.length > 0) throw new Error(`could not clear an earlier run: ${leftovers.join('; ')}`);
  ctx.start = await holdings(ctx.token);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    console.log(`verify-dictionary against ${BASE_URL} and ${API_URL}; files in ${OUT}`);
    for (const [index, viewport] of VIEWPORTS.entries()) {
      // The API allows 100 requests a minute per address: let the first width's burst expire.
      if (index > 0) await sleep(COOL_DOWN_MS);
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
