/**
 * Proves in a real browser the layout claims that jsdom cannot: nothing covers the
 * scale bar or the coordinate readout, the page never scrolls sideways, the map
 * controls stay inside the map stage, Archivo loaded, the signed-in columns keep
 * their widths, the map survives navigation, the print page sits under the top bar,
 * the scale slider's thumb and focus ring render where they should, a toast stays
 * clear of an open menu and of the bottom-corner readouts, and Trợ lý opens a
 * visible assistant on the routed pages.
 *
 * Every check runs at 1440x900 and at 768x900 and prints one PASS / FAIL / SKIPPED
 * line. SKIPPED is not a pass: the signed-in checks need VERIFY_EMAIL and
 * VERIFY_PASSWORD. Exits non-zero on any FAIL.
 *
 * Run: VERIFY_EMAIL=... VERIFY_PASSWORD=... npm run verify:shell -w @webatlas/web -- --out <dir>
 * Needs: the Docker stack, the API and `npm run dev:web`.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;

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
/** The focus ring is --mark, #FFD928. */
const MARK = 'rgb(255, 217, 40)';
/** How far the slider's thumb centre may sit from its tick. */
const THUMB_TOLERANCE_PX = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = false;
/** What check 6 saw of the print page, read by check 7. */
let printPage = null;

function line(status, viewport, id, name, detail) {
  if (status === 'FAIL') failed = true;
  const text = `${status.padEnd(7)} ${String(viewport).padEnd(4)} ${id.padEnd(3)} ${name}`;
  console.log(detail ? `${text}\n          ${detail}` : text);
}

/**
 * Runs one check. `fn` returns a list of problems (empty: PASS) or { skip: reason };
 * a thrown error is a FAIL.
 */
async function check(viewport, id, name, fn) {
  try {
    const result = await fn();
    if (result && !Array.isArray(result) && result.skip) line('SKIPPED', viewport, id, name, result.skip);
    else if (result.length === 0) line('PASS', viewport, id, name);
    else line('FAIL', viewport, id, name, result.join('\n          '));
  } catch (error) {
    line('FAIL', viewport, id, name, `error: ${error.message.split('\n')[0]}`);
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

/** Bounding rectangles of every element matching `selector`, empty ones left out. */
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

/** Problems for every pair of `subjects` x `others` rectangles that overlap. */
async function overlaps(page, subjects, others) {
  const problems = [];
  for (const subject of subjects) {
    for (const a of await rectsOf(page, subject)) {
      for (const other of others) {
        for (const b of await rectsOf(page, other)) {
          if (intersects(a, b)) problems.push(`${subject} ${fmt(a)} overlaps ${other} ${fmt(b)}`);
        }
      }
    }
  }
  return problems;
}

/** Problems when a selector matches nothing visible. */
async function present(page, selectors) {
  const problems = [];
  for (const selector of selectors) {
    if ((await rectsOf(page, selector)).length === 0) problems.push(`${selector} is not on the page`);
  }
  return problems;
}

/** Clicks the first button in `scope` whose text is `text`, as a script would (no pointer move). */
async function clickButton(page, scope, text) {
  const clicked = await page.$$eval(`${scope} button`, (buttons, wanted) => {
    const button = buttons.find((b) => b.textContent.trim() === wanted);
    button?.click();
    return Boolean(button);
  }, text);
  if (!clicked) throw new Error(`no button "${text}" in ${scope}`);
}

const menuOpen = (page) => page.$('.tool-menu:not([hidden])').then(Boolean);

async function setRoiMenu(page, open) {
  if ((await menuOpen(page)) === open) return;
  await clickButton(page, '.tool-group', 'Vùng phân tích');
  await page.waitForFunction(
    (wanted) => Boolean(document.querySelector('.tool-menu:not([hidden])')) === wanted,
    { timeout: 5000 },
    open,
  );
}

/**
 * Puts the pointer on a spot of open map, so the coordinate readout shows text
 * the way it does while someone works. Scans the stage for a point whose topmost
 * element belongs to the map viewport and is clear of the two bottom readouts.
 */
async function hoverOpenMap(page) {
  const point = await page.evaluate(() => {
    const stage = document.querySelector('.map-stage').getBoundingClientRect();
    const map = document.querySelector('.map-container');
    const avoid = ['.map-scaleline', '.map-mouseposition', '.map-cursor-elevation']
      .map((s) => document.querySelector(s)?.getBoundingClientRect())
      .filter(Boolean);
    for (let fy = 0.5; fy > 0.1; fy -= 0.05) {
      for (let fx = 0.5; fx < 0.95; fx += 0.05) {
        const x = stage.left + stage.width * fx;
        const y = stage.top + stage.height * fy;
        const hit = document.elementFromPoint(x, y);
        const clear = avoid.every((r) => x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40);
        if (hit && map.contains(hit) && clear) return { x, y };
      }
    }
    return null;
  });
  if (point) await page.mouse.move(point.x, point.y);
  await sleep(300);
}

/**
 * Check 1: the scale bar and the readout are painted on top and touched by nothing.
 * Every coverer listed must be on the page, or the check would pass by looking at nothing.
 */
async function nothingCoversReadouts(page, coverers) {
  const problems = await page.evaluate(() => {
    const describe = (el) => (el
      ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`
      : 'nothing');
    const out = [];
    for (const selector of ['.map-scaleline', '.map-mouseposition']) {
      const el = document.querySelector(selector);
      if (!el) {
        out.push(`${selector} is not on the page`);
        continue;
      }
      // Both readouts take no pointer events, which elementFromPoint would look
      // through; they take them for the duration of the probe only.
      const previous = el.style.pointerEvents;
      el.style.pointerEvents = 'auto';
      const r = el.getBoundingClientRect();
      const points = [
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
        [r.left + 2, r.top + 2], [r.right - 2, r.top + 2],
        [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2],
      ];
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) out.push(`${selector} at (${Math.round(x)},${Math.round(y)}) is under ${describe(hit)}`);
      }
      el.style.pointerEvents = previous;
    }
    return out;
  });
  return [
    ...problems,
    ...(await present(page, coverers)),
    ...(await overlaps(page, ['.map-scaleline', '.map-mouseposition'], coverers)),
  ];
}

/**
 * What could cover the readouts with every menu closed (1a) and with Vùng phân tích
 * open (1b). Toasts are not listed: none is raised here, and check 11 places one.
 */
const COVERERS_CLOSED = ['.tool-group', '.scale-slider', '.scale-readout'];
const COVERERS_OPEN = [...COVERERS_CLOSED, '.tool-menu:not([hidden])'];

/** Check 2: no sideways scroll on the page or in the top bar. */
const noSidewaysScroll = (page) =>
  page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth) out.push(`page is ${doc.scrollWidth}px wide in a ${window.innerWidth}px window`);
    const bar = document.querySelector('.top-bar');
    if (!bar) out.push('.top-bar is not on the page');
    else if (bar.scrollWidth > bar.clientWidth) out.push(`.top-bar content is ${bar.scrollWidth}px in ${bar.clientWidth}px`);
    return out;
  });

/** Check 3: the map controls lie within the map stage. */
async function controlsInsideStage(page) {
  const [stage] = await rectsOf(page, '.map-stage');
  if (!stage) return ['.map-stage is not on the page'];
  const problems = await present(page, ['.tool-group', '.scale-slider', '.scale-readout']);
  for (const selector of ['.tool-group', '.scale-slider', '.scale-readout']) {
    for (const r of await rectsOf(page, selector)) {
      const inside = r.left >= stage.left - 0.5 && r.right <= stage.right + 0.5
        && r.top >= stage.top - 0.5 && r.bottom <= stage.bottom + 0.5;
      if (!inside) problems.push(`${selector} ${fmt(r)} leaves .map-stage ${fmt(stage)}`);
    }
  }
  return problems;
}

/** Check 4: Archivo is loaded and is the body's first family. */
const archivoLoaded = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const out = [];
    const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Archivo');
    if (!faces.some((f) => f.status === 'loaded')) {
      out.push(`no Archivo face loaded (${faces.length} declared: ${faces.map((f) => f.status).join(', ') || 'none'})`);
    }
    const family = getComputedStyle(document.body).fontFamily;
    if (!family.replace(/["']/g, '').startsWith('Archivo')) out.push(`body font-family is ${family}`);
    return out;
  });

/** Check 8: Tab reaches the scale slider, which then shows the yellow ring. */
async function tabReachesSlider(page) {
  for (let presses = 0; presses < 300; presses += 1) {
    await page.keyboard.press('Tab');
    const style = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.classList.contains('scale-range')) return null;
      const cs = getComputedStyle(el);
      return { color: cs.outlineColor, style: cs.outlineStyle, width: cs.outlineWidth };
    });
    if (style) {
      await page.evaluate(() => document.activeElement.blur());
      const out = [];
      if (style.color !== MARK) out.push(`outline-color is ${style.color}, expected ${MARK}`);
      if (style.style === 'none' || style.width === '0px') out.push(`outline is ${style.style} ${style.width}`);
      return out;
    }
  }
  return ['300 presses of Tab never reached the scale slider'];
}

/**
 * Centre y of the slider's thumb, measured from pixels: the ticks, the track line
 * and the step icons are hidden for one screenshot of the range, so the only ink
 * left in it is the thumb.
 */
async function thumbCentreY(page) {
  const [clip] = await rectsOf(page, '.scale-range');
  const hide = await page.addStyleTag({
    content: '.scale-tick, .scale-step svg { visibility: hidden !important; }'
      + ' .scale-range::-webkit-slider-runnable-track { background: transparent !important; }',
  });
  await sleep(100);
  const png = await page.screenshot({
    clip: { x: clip.left, y: clip.top, width: clip.width, height: clip.height },
    encoding: 'base64',
  });
  await hide.evaluate((el) => el.remove());
  const rows = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
    const dark = [];
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const i = (y * img.width + x) * 4;
        if (px[i] + px[i + 1] + px[i + 2] < 300) {
          dark.push(y);
          break;
        }
      }
    }
    return dark;
  }, png);
  if (rows.length === 0) return null;
  return clip.top + (rows[0] + rows[rows.length - 1] + 1) / 2;
}

/** Waits until the slider's value has left `from` and held still for 800 ms. */
async function waitForStop(page, from) {
  let last = null;
  let since = Date.now();
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const value = await page.$eval('.scale-range', (el) => Number(el.value));
    if (value !== last) {
      last = value;
      since = Date.now();
    } else if (value !== from && Date.now() - since >= 800) {
      return value;
    }
    await sleep(100);
  }
  throw new Error(`the slider stayed at stop ${last}`);
}

/** Check 9: at two stops reached with Phóng to, the thumb's centre is on that stop's tick. */
async function thumbOnTick(page) {
  const problems = [];
  for (let step = 0; step < 2; step += 1) {
    const from = await page.$eval('.scale-range', (el) => Number(el.value));
    await page.$eval('.scale-step[aria-label="Phóng to"]', (el) => el.click());
    const stop = await waitForStop(page, from);
    const tickY = await page.$$eval('.scale-tick', (ticks, i) => {
      const r = ticks[i].getBoundingClientRect();
      return r.top + r.height / 2;
    }, stop);
    const thumbY = await thumbCentreY(page);
    if (thumbY === null) problems.push(`stop ${stop}: no thumb found in the range`);
    else if (Math.abs(thumbY - tickY) > THUMB_TOLERANCE_PX) {
      problems.push(`stop ${stop}: thumb centre y ${thumbY.toFixed(1)}, tick y ${tickY.toFixed(1)}`);
    }
  }
  return problems;
}

async function signIn(page) {
  await clickButton(page, '.top-bar', 'Đăng nhập');
  await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', PASSWORD);
  await page.$eval('#login-password', (el) => el.form.requestSubmit());
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('.top-bar button')].some((b) => b.textContent.trim() === 'Trợ lý'),
      { timeout: 20000 },
    );
  } catch {
    const message = await page.$eval('.dialog', (el) => el.innerText.replace(/\s+/g, ' ')).catch(() => '');
    throw new Error(`sign-in did not finish: ${message}`);
  }
}

async function openAssistant(page) {
  await clickButton(page, '.top-bar', 'Trợ lý');
  await page.waitForSelector('.assistant-dock', { visible: true, timeout: 5000 });
  await sleep(500); // the map stage resizes; MapView follows with a ResizeObserver
}

/** Opens or closes the assistant from the top bar, whichever `open` asks for. */
async function setAssistant(page, open) {
  if (Boolean(await page.$('.assistant-dock')) === open) return;
  await clickButton(page, '.top-bar', 'Trợ lý');
  await page.waitForFunction(
    (wanted) => Boolean(document.querySelector('.assistant-dock')) === wanted,
    { timeout: 5000 },
    open,
  );
  await sleep(500);
}

/** The routed pages, each with how a reader reaches it from the map. */
const ROUTED_PAGES = [
  {
    selector: '.print-route',
    open: (page) => page.$eval('.side-panel-footer a[href="/print"]', (a) => a.click()),
  },
  {
    selector: '.admin-users-route',
    open: async (page) => {
      await page.$eval('.account-trigger', (b) => b.click());
      await page.waitForSelector('.account-menu a[href="/admin/users"]', { timeout: 5000 });
      await page.$eval('.account-menu a[href="/admin/users"]', (a) => a.click());
    },
  },
];

/**
 * Check 10: on each routed page, Trợ lý (pressed there) opens an assistant that can be
 * seen: the element at the dock's centre is inside it, and at 1440 the page stops at
 * the dock's edge.
 */
async function assistantOnRoutedPages(page, vp) {
  const problems = [];
  for (const { selector, open } of ROUTED_PAGES) {
    await setAssistant(page, false);
    await open(page);
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    await clickButton(page, '.top-bar', 'Trợ lý');
    try {
      await page.waitForSelector('.assistant-dock', { visible: true, timeout: 5000 });
    } catch {
      problems.push(`on ${selector}, Trợ lý opened no .assistant-dock`);
    }
    await sleep(300);
    const hit = await page.evaluate(() => {
      const dock = document.querySelector('.assistant-dock');
      if (!dock) return null;
      const r = dock.getBoundingClientRect();
      const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      if (el && dock.contains(el)) return null;
      return el ? `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}` : 'nothing';
    });
    if (hit) problems.push(`on ${selector}, the centre of .assistant-dock is under ${hit}`);
    if (vp === 1440) problems.push(...(await overlaps(page, ['.assistant-dock'], [selector])));
    await page.$eval('.top-bar .wordmark', (a) => a.click());
    await page.waitForFunction((s) => !document.querySelector(s), { timeout: 10000 }, selector);
  }
  return problems;
}

/** What a toast must not touch while Thêm dữ liệu is open; all but the elevation must be on the page. */
const TOAST_REQUIRED = ['.tool-menu:not([hidden])', '.tool-group', '.map-scaleline', '.map-mouseposition', '.map-crs-select'];
const TOAST_AVOIDS = [...TOAST_REQUIRED, '.map-cursor-elevation'];

/**
 * Check 11: with Thêm dữ liệu open, adding a WMS layer whose server does not answer
 * raises the sticky error toast; it touches neither the menu nor the corner readouts.
 */
async function toastClearsMenu(page, shot) {
  await clickButton(page, '.tool-group', 'Thêm dữ liệu');
  await page.waitForSelector('#wms-url', { visible: true, timeout: 5000 });
  await hoverOpenMap(page);
  await page.type('#wms-url', 'http://127.0.0.1:9/wms');
  await page.type('#wms-layer', 'kiem_tra:khong_co');
  await page.$eval('#wms-url', (el) => el.form.requestSubmit());
  await page.waitForSelector('.toast-host > .toast.bad', { visible: true, timeout: 15000 });
  await sleep(300);
  const problems = await present(page, ['.toast-host > .toast.bad', ...TOAST_REQUIRED]);
  problems.push(...(await overlaps(page, ['.toast-host > *'], TOAST_AVOIDS)));
  await page.screenshot({ path: shot });
  // Leave the page as it was: the sticky toast dismissed, the menu closed.
  await page.$$eval('.toast-host button[aria-label="Đóng thông báo"]', (buttons) => buttons.forEach((b) => b.click()));
  await clickButton(page, '.tool-group', 'Thêm dữ liệu');
  return problems;
}

async function runViewport(browser, viewport) {
  const vp = viewport.width;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  const settle = trackTiles(page);

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-container canvas', { timeout: 30000 });
  if (!(await settle())) console.log(`note    ${vp}  tile requests still in flight after ${SETTLE_CAP_MS / 1000} s`);

  await check(vp, '4', 'the face loaded (Archivo)', () => archivoLoaded(page));
  // Before any click, so Tab starts from the top of the document.
  await check(vp, '8', 'Tab reaches the scale slider and shows the yellow ring', () => tabReachesSlider(page));

  await hoverOpenMap(page);
  await check(vp, '1a', 'nothing covers the scale bar or the readout (menus closed)',
    () => nothingCoversReadouts(page, COVERERS_CLOSED));
  await setRoiMenu(page, true);
  await hoverOpenMap(page);
  await check(vp, '1b', 'nothing covers the scale bar or the readout (Vùng phân tích open)',
    () => nothingCoversReadouts(page, COVERERS_OPEN));
  await check(vp, '2', 'the page does not scroll sideways', () => noSidewaysScroll(page));
  await check(vp, '3', 'controls sit inside the map stage', () => controlsInsideStage(page));
  await setRoiMenu(page, false);

  await check(vp, '9', 'the slider thumb sits on the tick of its stop', () => thumbOnTick(page));
  await clickButton(page, '.scale-readout', 'Toàn vùng');
  await settle();

  let signedIn = false;
  const signedInCheck = (id, name, fn) => check(vp, id, name, async () => {
    if (!EMAIL || !PASSWORD) return { skip: 'set VERIFY_EMAIL and VERIFY_PASSWORD' };
    if (!signedIn) {
      await signIn(page);
      signedIn = true;
    }
    return fn();
  });

  if (vp === 768) {
    await signedInCheck('1c', 'as an admin, the tool group and Vùng phân tích clear the scale control and the scale bar', async () => {
      await setRoiMenu(page, true);
      const problems = await present(page, ['.tool-menu:not([hidden])']);
      problems.push(...(await overlaps(page, ['.tool-group', '.tool-menu:not([hidden])'], ['.scale-control', '.map-scaleline'])));
      await setRoiMenu(page, false);
      return problems;
    });
  }

  await signedInCheck('5', 'signed in, the assistant docks beside the panel', async () => {
    await openAssistant(page);
    const [panel] = await rectsOf(page, '.side-panel');
    const [dock] = await rectsOf(page, '.assistant-dock');
    const [stage] = await rectsOf(page, '.map-stage');
    if (!panel || !dock || !stage) return ['.side-panel, .assistant-dock or .map-stage is not on the page'];
    const problems = [];
    if (intersects(panel, dock)) problems.push(`.assistant-dock ${fmt(dock)} overlaps .side-panel ${fmt(panel)}`);
    if (vp === 1440) {
      if (Math.abs(panel.width - 348) > 0.5) problems.push(`.side-panel is ${panel.width}px wide, expected 348`);
      if (Math.abs(dock.width - 360) > 0.5) problems.push(`.assistant-dock is ${dock.width}px wide, expected 360`);
      if (stage.width < 600) problems.push(`.map-stage is ${stage.width}px wide, expected at least 600`);
    } else {
      problems.push(...(await noSidewaysScroll(page)).map((p) => `check 2 with the assistant open: ${p}`));
    }
    return problems;
  });

  if (vp === 1440) {
    await signedInCheck('5b', 'with the assistant and Vùng phân tích open, neither covers the panel, the scale or the readouts', async () => {
      await setRoiMenu(page, true);
      await hoverOpenMap(page);
      const problems = await present(page, ['.assistant-dock', '.tool-menu:not([hidden])']);
      problems.push(...(await overlaps(
        page,
        ['.assistant-dock', '.tool-group', '.tool-menu:not([hidden])'],
        ['.side-panel', '.scale-control', '.map-scaleline', '.map-mouseposition'],
      )));
      return problems;
    });
  } else if (signedIn) {
    await setRoiMenu(page, true);
    await hoverOpenMap(page);
  } else {
    await setRoiMenu(page, true);
  }

  const shot = join(OUT, `verify-shell-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: shot });
  console.log(`shot    ${vp}  ${shot}`);
  await setRoiMenu(page, false);

  // At 1440 the toast is placed against the docked assistant. Below 1100 px the
  // assistant floats over the map's right edge, so it is closed for this check.
  const toastShot = join(OUT, `verify-shell-toast-${viewport.width}x${viewport.height}.png`);
  await signedInCheck('11', `a toast clears the open Thêm dữ liệu menu and the corner readouts${vp === 1440 ? ' (assistant docked)' : ''}`, async () => {
    await setAssistant(page, vp === 1440);
    return toastClearsMenu(page, toastShot);
  });
  if (signedIn) console.log(`shot    ${vp}  ${toastShot}`);

  await check(vp, '6', 'the map survives navigation to /print and back', async () => {
    await page.evaluate(() => {
      window.__verifyCanvas = document.querySelector('.map-container canvas');
    });
    await page.$eval('.side-panel-footer a[href="/print"]', (a) => a.click());
    await page.waitForSelector('.print-route', { timeout: 10000 });
    // Check 7 reads the print page while it is open.
    printPage = await page.evaluate(() => {
      const bar = document.querySelector('.top-bar');
      const route = document.querySelector('.print-route');
      const b = bar.getBoundingClientRect();
      const wordmark = bar.querySelector('.wordmark').getBoundingClientRect();
      const hit = document.elementFromPoint((wordmark.left + wordmark.right) / 2, (wordmark.top + wordmark.bottom) / 2);
      return {
        barBottom: b.bottom,
        barHeight: b.height,
        barVisible: getComputedStyle(bar).visibility === 'visible' && bar.contains(hit),
        routeTop: route.getBoundingClientRect().top,
      };
    });
    await page.$eval('.top-bar .wordmark', (a) => a.click());
    await page.waitForFunction(() => !document.querySelector('.print-route'), { timeout: 10000 });
    const same = await page.evaluate(() => {
      const now = document.querySelector('.map-container canvas');
      return Boolean(now) && now === window.__verifyCanvas && now.isConnected;
    });
    return same ? [] : ['the map canvas is a different node after coming back from /print'];
  });

  await check(vp, '7', 'the print page sits under a visible top bar', async () => {
    if (!printPage) return ['the print page never opened (see check 6)'];
    const problems = [];
    if (printPage.routeTop < printPage.barBottom - 0.5) {
      problems.push(`.print-route top ${printPage.routeTop} is above the top bar's bottom ${printPage.barBottom}`);
    }
    if (!printPage.barVisible || printPage.barHeight <= 0) problems.push('the top bar is hidden on /print');
    return problems;
  });
  printPage = null;

  await signedInCheck('10', 'signed in, Trợ lý opens a visible assistant on /print and on /admin/users',
    () => assistantOnRoutedPages(page, vp));

  await context.close();
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });
  try {
    console.log(`verify-shell against ${BASE_URL}`);
    for (const viewport of VIEWPORTS) await runViewport(browser, viewport);
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
