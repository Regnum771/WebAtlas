// First page load and map interaction in headless Chrome, against the production build.
// Output per session: totalMs = wall time of the session; longTasks / longTaskMs / maxLongTaskMs =
// main-thread tasks over 50 ms (count, total, worst); groups = finished requests by origin
// (n, slowest ms, failed); slow = requests over 800 ms. The first session prints loadMs, nav
// (domContentLoaded, load, fcp in ms) and mapQuietAfterLoadMs (time until the network went quiet);
// the second prints zoomSettleMs (4 zoom-in clicks, z7 -> z11, until the network went quiet).
// Base URL: WEBATLAS_WEB (default http://127.0.0.1:4173/); the API is expected on :3001 and
// GeoServer on :8080. Use 127.0.0.1, not localhost.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const URL_ = process.env.WEBATLAS_WEB ?? 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});

async function session(label, run) {
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await client.send('Performance.enable');
  const reqs = new Map();
  const done = [];
  let inflight = 0;
  let lastActivity = Date.now();
  page.on('request', (r) => { reqs.set(r, Date.now()); inflight++; lastActivity = Date.now(); });
  const finish = (r, failed) => {
    if (!reqs.has(r)) return;
    inflight--; lastActivity = Date.now();
    const resp = failed ? null : r.response();
    done.push({ url: r.url(), ms: Date.now() - reqs.get(r), failed, status: resp?.status() ?? 0, bytes: Number(resp?.headers()['content-length'] ?? 0), kind: r.resourceType() });
  };
  page.on('requestfinished', (r) => finish(r, false));
  page.on('requestfailed', (r) => finish(r, true));
  // Long tasks (>50 ms) on the main thread: what makes panning feel stuck.
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ entryTypes: ['longtask'] });
  });
  const quiet = async (ms = 3000, cap = 120000) => {
    const start = Date.now();
    while (Date.now() - start < cap) {
      if (inflight <= 0 && Date.now() - lastActivity > ms) return Date.now() - start - ms;
      await new Promise((r) => setTimeout(r, 200));
    }
    return -1;
  };
  const t0 = Date.now();
  await run(page, quiet);
  const total = Date.now() - t0;
  const long = await page.evaluate(() => window.__long);
  const groups = {};
  for (const d of done) {
    const host = d.url.includes(':8080/geoserver/gwc') ? 'tiles(gwc)' : d.url.includes(':8080/geoserver') ? 'wfs(geoserver)' : d.url.includes(':3001') ? 'api' : d.url.includes(':4173') ? 'app' : 'external';
    const g = (groups[host] ??= { n: 0, maxMs: 0, failed: 0 });
    g.n++; g.maxMs = Math.max(g.maxMs, d.ms); if (d.failed) g.failed++;
  }
  const slow = done.filter((d) => d.ms > 800).sort((a, b) => b.ms - a.ms).slice(0, 6)
    .map((d) => `${d.ms} ms ${d.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 110)}`);
  console.log(JSON.stringify({ label, totalMs: total, longTasks: long.length, longTaskMs: Math.round(long.reduce((a, b) => a + b, 0)), maxLongTaskMs: Math.round(Math.max(0, ...long)), groups, slow }, null, 1));
  await page.close();
}

await session('first load (cold browser cache), until network quiet', async (page, quiet) => {
  const t = Date.now();
  await page.goto(URL_, { waitUntil: 'load' });
  const loadMs = Date.now() - t;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null };
  });
  const quietAfterLoad = await quiet();
  console.log(JSON.stringify({ loadMs, nav, mapQuietAfterLoadMs: quietAfterLoad }));
});

await session('zoom into Buon Ma Thuot (z7 -> z11, 4 clicks) with water layers', async (page, quiet) => {
  await page.goto(URL_, { waitUntil: 'load' });
  await quiet();
  for (let i = 0; i < 4; i++) {
    await page.click('button[title="Phóng to"]');
    await new Promise((r) => setTimeout(r, 400));
  }
  const settle = await quiet();
  console.log(JSON.stringify({ zoomSettleMs: settle }));
});

await browser.close();
