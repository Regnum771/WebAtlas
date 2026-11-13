/**
 * Rehearses the flood scenario demo in a real browser and screenshots each step, so the layout
 * and the assistant's answers can be checked by eye before the demo:
 *
 *   1. open Kịch bản lũ, pick the KTTV replay (the dock opens), play a few seconds in the time row;
 *   2. sign in, ask which roads are flooded by 06:00 30/10;
 *   3. ask for the evacuation plan;
 *   4. switch to the 1.300 mm preset and ask again.
 *
 * Prints each assistant answer and a PASS / FAIL line per step; exits non-zero on any FAIL.
 *
 * Run: VERIFY_EMAIL=... VERIFY_PASSWORD=... [BASE_URL=...] [API_URL=...] node scripts/rehearse-flood-demo.mjs --out <dir> [--width 1440]
 * Needs: the Docker stack, the scenario build (docs/runbooks/flood-scenario-demo.md), the API
 * with ANTHROPIC_API_KEY, and `npm run dev:web`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const OUT = arg('out', tmpdir());
const WIDTH = Number(arg('width', '1440'));

const TILE_REQUEST = /gwc|wmts|tile|arcgis|google/i;
const QUIET_MS = 3000;
const SETTLE_CAP_MS = 45000;
const ANSWER_CAP_MS = 180000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = false;
function report(ok, name, detail = '') {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function trackTiles(page) {
  let inFlight = 0;
  let lastChange = Date.now();
  page.on('request', (r) => { if (TILE_REQUEST.test(r.url())) { inFlight += 1; lastChange = Date.now(); } });
  const done = (r) => { if (TILE_REQUEST.test(r.url())) { inFlight = Math.max(0, inFlight - 1); lastChange = Date.now(); } };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    const start = Date.now();
    while (Date.now() - start < SETTLE_CAP_MS) {
      if (inFlight === 0 && Date.now() - lastChange >= QUIET_MS) return;
      await sleep(250);
    }
  };
}

async function clickButton(page, scope, text) {
  const clicked = await page.$$eval(`${scope} button`, (buttons, wanted) => {
    const b = buttons.find((x) => x.textContent.trim() === wanted || x.getAttribute('aria-label') === wanted);
    b?.click();
    return Boolean(b);
  }, text);
  if (!clicked) throw new Error(`no button "${text}" in ${scope}`);
}

/** Do two element rectangles overlap? */
const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectOf = (page, selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}).catch(() => null);

// K4: the scenario's clock is the time row above the status bar; its figures, picker and the
// evacuation plan button are in the dock (a column from 1100 px, a drawer below).
const ROW = '[data-slot="time-row"]';
const ROW_THUMB = `${ROW} [role="slider"]`;
const HEADER = '[data-slot="run-header"]';
const DOCK = 'aside[aria-label="Dự báo và phân tích"]';

/** The scenario named in the dock's picker has loaded: the time row is back and nothing is loading. */
const scenarioReady = (page, nameIncludes) => page.waitForFunction((row, header, name) => {
  const picker = document.querySelector(`${header} [role="combobox"]`);
  return document.querySelector(row) && picker?.textContent.includes(name)
    && !document.querySelector(header)?.textContent.includes('Đang tải');
}, { timeout: 60000 }, ROW, HEADER, nameIncludes);

/** Picks a scenario in the dock's run header by part of its name. */
async function pickScenario(page, nameIncludes) {
  await page.click(`${HEADER} [role="combobox"]`);
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  for (const option of await page.$$('[role="option"]')) {
    if ((await option.evaluate((o) => o.textContent)).includes(nameIncludes)) { await option.click(); break; }
  }
  await scenarioReady(page, nameIncludes);
}

/** Moves the time row to hour `index` from the keyboard, `pauseMs` between steps (0: as fast as keys go). */
async function setHourByKeys(page, index, pauseMs = 0) {
  await page.focus(ROW_THUMB);
  await page.keyboard.press('Home');
  for (let i = 0; i < index; i++) {
    await page.keyboard.press('ArrowRight');
    if (pauseMs) await sleep(pauseMs);
  }
}

async function ask(page, question) {
  const before = await page.$$eval('.assistant-turn-bot', (els) => els.length);
  await page.click('[aria-label="Câu hỏi cho trợ lý"]', { clickCount: 3 });
  await page.type('[aria-label="Câu hỏi cho trợ lý"]', question);
  await page.click('[aria-label="Gửi"]');
  await page.waitForFunction((n) => document.querySelectorAll('.assistant-turn-bot').length > n, { timeout: ANSWER_CAP_MS }, before);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Gửi"]')?.closest('form')?.querySelector('[aria-busy="true"]'), { timeout: ANSWER_CAP_MS }).catch(() => {});
  return page.$$eval('.assistant-turn-bot', (els) => els[els.length - 1].innerText);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: WIDTH, height: 900 },
  });
  const page = await browser.newPage();
  const settle = trackTiles(page);
  const shot = async (name) => { await settle(); await page.screenshot({ path: join(OUT, `${WIDTH}-${name}.png`) }); };
  const answers = [];
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tool-group', { timeout: 30000 });

    // Step 1: open the replay and play.
    await clickButton(page, '.tool-group', 'Kịch bản lũ');
    await page.waitForSelector('.flood-menu-item', { visible: true, timeout: 15000 });
    const scaleBefore = await page.$eval('[data-slot="scale-slider"] output', (el) => el.textContent);
    await page.$$eval('.flood-menu-item', (items) => items.find((b) => b.textContent.includes('tái hiện'))?.click());
    await scenarioReady(page, 'tái hiện');
    const time = await page.$eval(`${ROW} output`, (el) => el.textContent);
    await sleep(1200);
    const scaleAfter = await page.$eval('[data-slot="scale-slider"] output', (el) => el.textContent);
    report(scaleAfter !== scaleBefore, 'choosing a scenario flies the map to its area', `${scaleBefore} → ${scaleAfter}`);
    report(time.startsWith('05:00 26/10/2025'), 'the time row opens at the decision moment, before the rise', time);
    report(await page.$(DOCK) !== null, 'choosing a scenario opens the dock');
    report(await page.$eval('section[aria-label="Kịch bản lũ"]', (el) => el.hidden), 'the Kịch bản lũ menu closes once the dock has the scenario');
    await clickButton(page, ROW, 'Phát');
    await sleep(4000);
    await clickButton(page, ROW, 'Tạm dừng');
    const after = await page.$eval(`${ROW} output`, (el) => el.textContent);
    report(after !== time, 'playback advances the hour', after);
    // R8: neither the dock nor the time row covers the status bar.
    const dock = await rectOf(page, DOCK);
    const row = await rectOf(page, ROW);
    const scale = await rectOf(page, '[data-slot="scale-slider"]');
    report(!overlaps(dock, scale) && !overlaps(row, scale), 'dock and time row clear of the scale control');
    // .map-cursor-elevation shows only while the pointer hovers the map.
    for (const sel of ['.map-scaleline', '.map-mouseposition', '.map-crs-select']) {
      const r = await rectOf(page, sel);
      report(r !== null && !overlaps(dock, r) && !overlaps(row, r), `dock and time row clear of ${sel}`, r ? '' : 'not on the page');
    }
    await shot('1-replay');

    // Step 1c: at the peak hour, pointing at the flood shows its depth by the cursor.
    await setHourByKeys(page, 87);
    // Below 1100 px the dock is a drawer over half the map: close it to look, as a reader would.
    const drawer = await page.$('aside[data-variant="drawer"]');
    if (drawer) await clickButton(page, 'aside[data-variant="drawer"]', 'Đóng khung phân tích');
    await sleep(800);
    const box = await page.$eval('.map-stage', (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    let tip = null;
    for (let gy = 0.25; gy <= 0.6 && !tip; gy += 0.05) {
      for (let gx = 0.3; gx <= 0.8 && !tip; gx += 0.05) {
        await page.mouse.move(box.x + box.w * gx, box.y + box.h * gy);
        await sleep(120);
        tip = await page.$eval('.flood-depth-tip', (el) => (el.hidden ? null : el.textContent)).catch(() => null);
      }
    }
    report(tip !== null && /^Ngập (≥ )?[\d,]+ m · /.test(tip), 'pointing at the flood shows its depth', tip ?? 'no label');
    await shot('1c-depth-hover');
    if (drawer) await clickButton(page, '[data-slot="rail"]', 'Dự báo và phân tích');

    // Step 1a: sweep the time row across every hour, then switch scenario: must not trip a rate limit.
    const lastHour = await page.$eval(ROW_THUMB, (el) => Number(el.getAttribute('aria-valuemax')));
    await setHourByKeys(page, lastHour, 5);
    const switched = await pickScenario(page, '1.300').then(() => true).catch(() => false);
    const apiOk = await page.evaluate(async (api) => (await fetch(`${api}/api/scenarios`)).status, API_URL);
    report(switched && apiOk === 200, 'time row sweep then scenario switch still loads, API not rate-limited', `GET /api/scenarios → ${apiOk}`);
    await pickScenario(page, 'tái hiện');

    // Step 1b: the plan from the dock's button, the fallback if the assistant cannot answer.
    await clickButton(page, HEADER, 'Phương án sơ tán');
    const planFromDock = await page.waitForFunction(() => document.querySelector('.flood-legend')?.textContent.includes('Điểm tập kết'), { timeout: 30000 }).then(() => true).catch(() => false);
    report(planFromDock, 'plan drawn from the dock button');
    await shot('1b-plan-from-dock');
    await clickButton(page, HEADER, 'Phương án sơ tán');

    // Step 2: sign in and ask about roads.
    if (!EMAIL || !PASSWORD) {
      report(false, 'assistant steps', 'set VERIFY_EMAIL and VERIFY_PASSWORD');
      return;
    }
    await clickButton(page, '[data-slot="app-header"]', 'Đăng nhập');
    await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
    await page.type('#login-email', EMAIL);
    await page.type('#login-password', PASSWORD);
    await page.$eval('#login-password', (el) => el.form.requestSubmit());
    await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="app-header"] button')].some((b) => b.textContent.trim() === 'Trợ lý'), { timeout: 15000 });
    await clickButton(page, '[data-slot="app-header"]', 'Trợ lý');
    await page.waitForSelector('[aria-label="Câu hỏi cho trợ lý"]', { visible: true, timeout: 10000 });

    const q1 = 'Theo bản tin KTTV 21 giờ ngày 28/10, đến 6 giờ sáng 30/10 những tuyến đường nào bị ngập?';
    const a1 = await ask(page, q1);
    answers.push({ q: q1, a: a1 });
    report(/30\/10/.test(a1) && /(ĐT|QL|đường|Đường)/.test(a1), 'roads answer names roads and the time');
    await shot('2-roads');

    // Step 3: evacuation plan.
    const q2 = 'Kịch bản sơ tán cho trận lũ này?';
    const a2 = await ask(page, q2);
    answers.push({ q: q2, a: a2 });
    const planDrawn = await page.waitForFunction(() => document.querySelector('.flood-legend')?.textContent.includes('Điểm tập kết'), { timeout: 30000 }).then(() => true).catch(() => false);
    report(planDrawn, 'plan drawn on the map (legend shows gathering points)');
    report(/sơ tán|tập kết/i.test(a2), 'plan answer gives an evacuation plan');
    await shot('3-plan');

    // Step 4: switch to 1.300 mm (the dock's forecast view, from the rail) and ask again in Trợ lý,
    // whose conversation the dock keeps while it shows the other view.
    await clickButton(page, '[data-slot="rail"]', 'Dự báo và phân tích');
    await pickScenario(page, '1.300');
    await clickButton(page, '[data-slot="rail"]', 'Trợ lý');
    report(await page.$$eval('.assistant-turn-bot', (els) => els.length) >= 2, 'Trợ lý kept its conversation across the dock switch');
    const q3 = 'Nếu mưa 1.300 mm thì phương án sơ tán thay đổi thế nào?';
    const a3 = await ask(page, q3);
    answers.push({ q: q3, a: a3 });
    report(a3.length > 50, 'preset answer');
    await shot('4-preset');
  } catch (e) {
    report(false, 'rehearsal ran to the end', e.message);
    await page.screenshot({ path: join(OUT, `${WIDTH}-error.png`) }).catch(() => {});
  } finally {
    writeFileSync(join(OUT, `${WIDTH}-answers.md`), answers.map((x) => `## ${x.q}\n\n${x.a}\n`).join('\n'));
    for (const x of answers) console.log(`\n--- ${x.q}\n${x.a}`);
    await browser.close();
  }
}

await main();
process.exit(failed ? 1 : 0);
