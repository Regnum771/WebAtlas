/**
 * Đo hiệu năng tải bản đồ. Kịch bản cố định để các lần chạy so sánh được với nhau:
 *   cold load ở MIN_ZOOM -> chờ ổn định -> pan theo kịch bản -> zoom 10 -> chờ ổn định
 *
 * Chỉ ĐO, không sửa gì trong app — nhờ vậy số liệu trước/sau mới đáng tin.
 *
 * Chạy: npm run profile -w @webatlas/web -- --out baseline.json
 * Yêu cầu: docker stack đang chạy + `npm run dev -w @webatlas/web` đang phục vụ.
 */
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const SETTLE_MS = 4000;

const outArg = process.argv.indexOf('--out');
const OUT = outArg !== -1 ? process.argv[outArg + 1] : 'profile-result.json';

// Gộp request theo lớp: WFS dùng typeNames=webatlas:<lop>, file tĩnh dùng tên file.
function layerNameFor(url) {
  const wfs = /typeNames=(?:webatlas%3A|webatlas:)([a-z_]+)/i.exec(url);
  if (wfs) return `wfs:${wfs[1]}`;
  const file = /\/([a-z0-9-]+)\.geojson/i.exec(url);
  if (file) return `file:${file[1]}`;
  return null;
}

const run = async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--window-size=1600,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.setCacheEnabled(false); // luôn đo cold load

  const transfer = {};
  page.on('response', async (res) => {
    const name = layerNameFor(res.url());
    if (!name) return;
    let bytes = 0;
    try {
      bytes = (await res.buffer()).length;
    } catch {
      bytes = 0; // response bị huỷ khi điều hướng
    }
    const slot = transfer[name] ?? (transfer[name] = { requests: 0, bytes: 0 });
    slot.requests += 1;
    slot.bytes += bytes;
  });

  // Ghi nhận long task trước khi app khởi động.
  await page.evaluateOnNewDocument(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
    }).observe({ entryTypes: ['longtask'] });
  });

  const t0 = Date.now();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  // "First render" = canvas OpenLayers đầu tiên có nội dung.
  await page.waitForSelector('canvas', { timeout: 30000 });
  const firstRenderMs = Date.now() - t0;

  await new Promise((r) => setTimeout(r, SETTLE_MS));

  // Đếm feature thực sự đã dựng trong từng source (chi phí main-thread thật sự).
  const countFeatures = () => page.evaluate(() => {
    const map = window.__olMap;
    if (!map) return { error: 'window.__olMap not exposed' };
    const out = {};
    map.getLayers().forEach((layer) => {
      const id = layer.get('id');
      const src = layer.getSource?.();
      if (id && src?.getFeatures) out[id] = src.getFeatures().length;
    });
    return out;
  });

  const featuresAfterLoad = await countFeatures();

  // Pan theo kịch bản + đo nhịp khung hình.
  const panFrames = await page.evaluate(async () => {
    const map = window.__olMap;
    if (!map) return { count: 0, avgMs: 0, worstMs: 0 };
    const view = map.getView();
    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const [x, y] = view.getCenter();
    for (let i = 1; i <= 4; i++) {
      view.setCenter([x + i * 40000, y + i * 20000]);
      await new Promise((r) => setTimeout(r, 500));
    }
    running = false;
    await new Promise((r) => setTimeout(r, 100));
    const count = frames.length;
    const avgMs = count ? frames.reduce((a, b) => a + b, 0) / count : 0;
    const worstMs = count ? Math.max(...frames) : 0;
    return { count, avgMs, worstMs };
  });

  // Vượt ngưỡng zoom 10 để kích hoạt lớp xã.
  await page.evaluate(() => window.__olMap?.getView().setZoom(10.5));
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const featuresAfterZoom = await countFeatures();
  const longTaskTotalMs = await page.evaluate(
    () => (window.__longTasks ?? []).reduce((a, b) => a + b, 0)
  );

  const result = {
    scenario: 'cold load @MIN_ZOOM -> settle -> pan x4 -> zoom 10.5 -> settle',
    timestamp: new Date().toISOString(),
    firstRenderMs,
    longTaskTotalMs,
    featuresAfterLoad,
    featuresAfterZoom,
    transfer,
    panFrames,
  };

  writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\nfirst render      ${firstRenderMs} ms`);
  console.log(`long tasks total  ${longTaskTotalMs.toFixed(0)} ms`);
  console.log(`pan avg / worst   ${panFrames.avgMs.toFixed(1)} / ${panFrames.worstMs.toFixed(1)} ms`);
  console.log('\nfeatures after initial load:');
  for (const [k, v] of Object.entries(featuresAfterLoad)) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log('\ntransfer by layer:');
  for (const [k, v] of Object.entries(transfer)) {
    console.log(`  ${k.padEnd(28)} ${v.requests} req  ${(v.bytes / 1048576).toFixed(2)} MB`);
  }
  console.log(`\nwrote ${OUT}`);

  await browser.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
