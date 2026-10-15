/**
 * Rehearses the flood scenario demo in a real browser and screenshots each step, so the layout
 * and the assistant's answers can be checked by eye before the demo:
 *
 *   1. open Kịch bản lũ, pick the KTTV replay, play a few seconds;
 *   2. sign in, ask which roads are flooded by 06:00 30/10;
 *   3. ask for the evacuation plan;
 *   4. switch to the 1.300 mm preset and ask again.
 *
 * Prints each assistant answer and a PASS / FAIL line per step; exits non-zero on any FAIL.
 *
 * Run: VERIFY_EMAIL=... VERIFY_PASSWORD=... node scripts/rehearse-flood-demo.mjs --out <dir> [--width 1440]
 * Needs: the Docker stack, the scenario build (docs/runbooks/flood-scenario-demo.md), the API
 * with ANTHROPIC_API_KEY, and `npm run dev:web`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
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
    await page.$$eval('.flood-menu-item', (items) => items.find((b) => b.textContent.includes('tái hiện'))?.click());
    await page.waitForFunction(() => document.querySelector('.flood-dock [aria-label="Phát"]:not([disabled])'), { timeout: 60000 });
    const time = await page.$eval('.flood-dock-time', (el) => el.textContent);
    report(time.startsWith('05:00 26/10/2025'), 'dock opens at the decision moment, before the rise', time);
    await clickButton(page, '.tool-group', 'Kịch bản lũ');
    await clickButton(page, '.flood-dock', 'Phát');
    await sleep(4000);
    await clickButton(page, '.flood-dock', 'Tạm dừng');
    const after = await page.$eval('.flood-dock-time', (el) => el.textContent);
    report(after !== time, 'playback advances the hour', after);
    const dock = await rectOf(page, '.flood-dock');
    const scale = await rectOf(page, '.scale-control');
    report(!overlaps(dock, scale), 'dock clear of the scale control');
    // .map-cursor-elevation shows only while the pointer hovers the map.
    for (const sel of ['.map-scaleline', '.map-mouseposition', '.map-crs-select']) {
      const r = await rectOf(page, sel);
      report(r !== null && !overlaps(dock, r), `dock clear of ${sel}`, r ? '' : 'not on the page');
    }
    await shot('1-replay');

    // Step 1a: drag the slider across every hour, then switch scenario: must not trip a rate limit.
    await page.$eval('.flood-dock-slider input', async (input) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (let h = 0; h <= Number(input.max); h++) {
        set.call(input, String(h));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 5));
      }
    });
    await page.select('.flood-dock-select', 'preset-1300');
    const switched = await page.waitForFunction(() => document.querySelector('.flood-dock [aria-label="Phát"]:not([disabled])'), { timeout: 60000 }).then(() => true).catch(() => false);
    const apiOk = await page.evaluate(async () => (await fetch('http://localhost:3001/api/scenarios')).status);
    report(switched && apiOk === 200, 'slider drag then scenario switch still loads, API not rate-limited', `GET /api/scenarios → ${apiOk}`);
    await page.select('.flood-dock-select', 'kttv-2025-10');
    await page.waitForFunction(() => document.querySelector('.flood-dock [aria-label="Phát"]:not([disabled])'), { timeout: 60000 });

    // Step 1b: the plan from the dock button, the fallback if the assistant cannot answer.
    await clickButton(page, '.flood-dock', 'Phương án sơ tán');
    const planFromDock = await page.waitForFunction(() => document.querySelector('.flood-legend')?.textContent.includes('Điểm tập kết'), { timeout: 30000 }).then(() => true).catch(() => false);
    report(planFromDock, 'plan drawn from the dock button');
    await shot('1b-plan-from-dock');
    await clickButton(page, '.flood-dock', 'Phương án sơ tán');

    // Step 2: sign in and ask about roads.
    if (!EMAIL || !PASSWORD) {
      report(false, 'assistant steps', 'set VERIFY_EMAIL and VERIFY_PASSWORD');
      return;
    }
    await clickButton(page, '.top-bar', 'Đăng nhập');
    await page.waitForSelector('#login-email', { visible: true, timeout: 5000 });
    await page.type('#login-email', EMAIL);
    await page.type('#login-password', PASSWORD);
    await page.$eval('#login-password', (el) => el.form.requestSubmit());
    await page.waitForFunction(() => [...document.querySelectorAll('.top-bar button')].some((b) => b.textContent.trim() === 'Trợ lý'), { timeout: 15000 });
    await clickButton(page, '.top-bar', 'Trợ lý');
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

    // Step 4: switch to 1.300 mm and ask again.
    await page.select('.flood-dock-select', 'preset-1300');
    await page.waitForFunction(() => document.querySelector('.flood-dock [aria-label="Phát"]:not([disabled])'), { timeout: 60000 });
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
