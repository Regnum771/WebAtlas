/**
 * Proves in a real browser what jsdom cannot (it lays nothing out) about the K3 map shell, at
 * 768x900, 1100x900 and 1440x900. Each check prints one PASS, FAIL or SKIPPED line:
 *
 *   1. The header is 44 px tall and does not overflow; the page does not scroll sideways.
 *   2. The contents panel is 312 px wide, 8 px from the stage's top and left, and ends at least
 *      8 px above the status bar.
 *   3. The status bar (R8) lies along the stage's bottom edge, 32 px tall, unclipped, and is what
 *      the pointer hits at its two ends and at the slider's thumb: with every menu closed, with
 *      each tool menu open in turn (3a), and with a toast showing (3b).
 *   4. Each tool menu stays inside the stage and clear of the status bar, the panel and the tool
 *      stacks (Review Focus 1).
 *   5. Ctrl K opens the command palette and Escape closes it.
 *   6. Signed in (VERIFY_EMAIL, VERIFY_PASSWORD; else SKIPPED): the header still does not overflow
 *      with a long account name, and with Trợ lý open the status bar is still uncovered.
 *
 * A screenshot per width goes to --out. Exits 1 on any FAIL.
 *
 * Run: npm run verify:map-shell -w @webatlas/web -- --out <dir>
 * Needs: the Docker stack, the API and `npm run dev:web` (the toast in 3b is raised through the
 * dev server's module graph).
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
const VIEWPORTS = [768, 1100, 1440].map((width) => ({ width, height: 900, deviceScaleFactor: 1 }));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let failed = false;
function line(status, vp, id, name, detail = '') {
  if (status === 'FAIL') failed = true;
  console.log(`${status.padEnd(7)} ${String(vp).padEnd(4)} ${id.padEnd(3)} ${name}${detail ? `: ${detail}` : ''}`);
}

/** Geometry helpers run in the page. */
const PAGE_HELPERS = () => {
  window.__ms = {
    rect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height };
    },
    overlap(a, b) { return Boolean(a && b && a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5); },
    /** What is wrong with the status bar right now, as a list. */
    barProblems() {
      const out = [];
      const bar = document.querySelector('[data-slot="status-bar"]');
      const stage = this.rect('.map-stage-map');
      if (!bar || !stage) return ['the status bar or the stage is not on the page'];
      const b = this.rect(bar);
      if (Math.abs(b.b - stage.b) > 0.5) out.push(`bottom ${b.b} is not the stage's ${stage.b}`);
      if (Math.round(b.h) !== 32) out.push(`height ${b.h}`);
      if (bar.scrollWidth > bar.clientWidth) out.push(`content ${bar.scrollWidth}px in ${bar.clientWidth}px`);
      const thumb = this.rect('[data-slot="status-bar"] [role="slider"]');
      const points = [['left end', b.x + 3, b.y + b.h / 2], ['right end', b.r - 3, b.y + b.h / 2]];
      if (thumb) points.push(['slider thumb', thumb.x + thumb.w / 2, thumb.y + thumb.h / 2]);
      else out.push('no slider');
      for (const [name, x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!bar.contains(hit)) out.push(`${name} is covered by ${hit?.tagName.toLowerCase()}.${String(hit?.className).split(' ')[0]}`);
      }
      return out;
    },
  };
};

async function openMap(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', (e) => line('FAIL', viewport.width, '-', 'page error', String(e.message).split('\n')[0]));
  await page.goto(`${BASE_URL}/ban-do`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-slot="status-bar"]', { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(PAGE_HELPERS);
  return page;
}

async function signIn(page) {
  const clicked = await page.$$eval('[data-slot="app-header"] button', (bs) => {
    const b = bs.find((x) => x.textContent.trim() === 'Đăng nhập');
    b?.click();
    return Boolean(b);
  });
  if (!clicked) throw new Error('no Đăng nhập button in the header');
  await page.waitForSelector('#login-email', { visible: true, timeout: 10000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-slot="account-trigger"]', { timeout: 20000 });
  await sleep(1000);
}

async function runViewport(browser, viewport) {
  const vp = viewport.width;
  const page = await openMap(browser, viewport);

  // 1. Header and page width.
  const head = await page.evaluate(() => {
    const h = document.querySelector('[data-slot="app-header"]');
    return { h: h?.getBoundingClientRect().height, over: h ? h.scrollWidth > h.clientWidth : true, scroll: document.documentElement.scrollWidth > window.innerWidth };
  });
  line(head.h === 44 && !head.over && !head.scroll ? 'PASS' : 'FAIL', vp, '1', 'header 44 px, no overflow, no sideways scroll', JSON.stringify(head));

  // 2. The contents panel.
  const panel = await page.evaluate(() => {
    const p = window.__ms.rect('.side-panel'), s = window.__ms.rect('.map-stage-map'), b = window.__ms.rect('[data-slot="status-bar"]');
    return p && s && b ? { w: Math.round(p.w), left: Math.round(p.x - s.x), top: Math.round(p.y - s.y), aboveBar: Math.round(b.y - p.b) } : null;
  });
  const panelOk = panel && panel.w === 312 && panel.left === 8 && panel.top === 8 && panel.aboveBar >= 8;
  line(panelOk ? 'PASS' : 'FAIL', vp, '2', 'panel 312 px, 8 px in, clear of the status bar', JSON.stringify(panel));

  // 3. The status bar with everything closed.
  let problems = await page.evaluate(() => window.__ms.barProblems());
  line(problems.length ? 'FAIL' : 'PASS', vp, '3', 'status bar along the bottom edge, uncovered', problems.join('; '));

  // 3a / 4. Each tool menu open in turn, through a real click so focus lands on its button.
  const tools = await page.$$eval('[data-slot="tool-stack"] button[aria-controls]', (bs) => bs.map((b) => b.getAttribute('aria-label')));
  for (const label of tools) {
    await (await page.$(`[data-slot="tool-stack"] button[aria-label="${label}"]`)).click();
    await sleep(400);
    const m = await page.evaluate(() => {
      const ms = window.__ms;
      const menu = document.querySelector('.tool-menu:not([hidden])');
      if (!menu) return { problems: ['no menu opened'], bar: ms.barProblems() };
      const r = ms.rect(menu), s = ms.rect('.map-stage-map');
      const out = [];
      if (r.y < s.y - 0.5 || r.b > s.b + 0.5 || r.x < s.x - 0.5 || r.r > s.r + 0.5) out.push('leaves the stage');
      if (ms.overlap(r, ms.rect('[data-slot="status-bar"]'))) out.push('overlaps the status bar');
      if (ms.overlap(r, ms.rect('.side-panel'))) out.push('overlaps the panel');
      if (ms.overlap(r, ms.rect('[data-slot="tool-stacks"]'))) out.push('overlaps the tool stacks');
      return { problems: out, bar: ms.barProblems() };
    });
    line(m.problems.length ? 'FAIL' : 'PASS', vp, '4', `menu ${label} inside the stage, clear of the bar, panel and stacks`, m.problems.join('; '));
    line(m.bar.length ? 'FAIL' : 'PASS', vp, '3a', `status bar uncovered with ${label} open`, m.bar.join('; '));
    await page.keyboard.press('Escape');
    await sleep(200);
  }

  // 3b. A toast showing.
  await page.evaluate(() => import('/src/shared/ui/toast.store.ts').then((m) => m.showToast({ tone: 'warning', title: 'Kiểm tra bố cục: một thông báo đang hiện.' })));
  await sleep(800);
  problems = await page.evaluate(() => window.__ms.barProblems());
  const toastOn = await page.evaluate(() => Boolean(document.querySelector('[data-sonner-toast]')));
  line(toastOn && !problems.length ? 'PASS' : 'FAIL', vp, '3b', 'status bar uncovered with a toast showing', toastOn ? problems.join('; ') : 'no toast showed');
  await page.screenshot({ path: join(OUT, `verify-map-shell-${vp}.png`) });
  await page.evaluate(() => import('/src/shared/ui/toast.store.ts').then((m) => m.resetToasts()));

  // 5. Ctrl K.
  await page.mouse.click(5, 5);
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  const opened = await page.waitForSelector('[role="dialog"]', { timeout: 3000 }).then(() => true, () => false);
  await page.keyboard.press('Escape');
  await sleep(300);
  const closed = !(await page.$('[role="dialog"]'));
  line(opened && closed ? 'PASS' : 'FAIL', vp, '5', 'Ctrl K opens the palette, Escape closes it', `opened ${opened}, closed ${closed}`);

  // 6. Signed in.
  if (!EMAIL || !PASSWORD) {
    line('SKIPPED', vp, '6', 'signed in: header and Trợ lý', 'set VERIFY_EMAIL and VERIFY_PASSWORD');
  } else {
    await signIn(page);
    const over = await page.evaluate(() => { const h = document.querySelector('[data-slot="app-header"]'); return h.scrollWidth > h.clientWidth; });
    line(over ? 'FAIL' : 'PASS', vp, '6a', 'signed in: the header does not overflow');
    await page.$$eval('[data-slot="app-header"] button', (bs) => bs.find((b) => b.textContent.trim() === 'Trợ lý')?.click());
    await sleep(1000);
    await page.evaluate(PAGE_HELPERS);
    problems = await page.evaluate(() => window.__ms.barProblems());
    line(problems.length ? 'FAIL' : 'PASS', vp, '6b', 'signed in: status bar uncovered with Trợ lý open', problems.join('; '));
  }
  await page.close();
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
try {
  console.log(`verify-map-shell against ${BASE_URL}; screenshots in ${OUT}`);
  for (const viewport of VIEWPORTS) await runViewport(browser, viewport);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
