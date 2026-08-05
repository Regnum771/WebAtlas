# Map Load Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut main-thread parse and feature-construction cost on the map's initial load by fetching WFS layers per-viewport instead of nationwide, deferring the wards boundary file until it is actually rendered, and deleting a dead 5.3 MB asset.

**Architecture:** Three isolated changes behind a measurement harness. `wfsSource.ts` gains an OpenLayers `bbox` loading strategy so each thematic layer requests only the current extent; `MapModel.ts` gains a source-level load gate so the 6.9 MB wards file is fetched only once the user crosses zoom 10; the dead `thuyhe.geojson` is removed. A committed puppeteer script measures before and after so every claim is backed by a number.

**Tech Stack:** React 19, OpenLayers 10.9, TypeScript, Vitest + jsdom, `puppeteer-core` driving system Chrome, GeoServer WFS 2.0.0.

**Spec:** [docs/superpowers/specs/2026-08-05-map-performance-design.md](../specs/2026-08-05-map-performance-design.md)

## Global Constraints

- **Node ≥ 22, npm ≥ 10** (root `package.json` `engines`).
- **Do not change visual output.** Styles, colors, widths, and labels stay exactly as they are.
- **Do not break admin editing.** The `Draw`/`Modify`/`Select` controllers and `refreshLayer()` must keep working.
- **Never install full `puppeteer`.** This project uses `puppeteer-core` + system Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Full `puppeteer` downloads a bundled browser and must not be added.
- **Vietnamese commit messages**, matching repo history. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Run all web tests from the repo root** with `npm run test:web`. A single file: `npm run test -w @webatlas/web -- <path>`.
- **The Docker stack must be running** for the harness (Tasks 1 and 6) but NOT for unit tests (Tasks 2–5):
  ```bash
  docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
  ```
- **`apps/api/scripts/prune-hydrosheds-versions.mjs` contains the string `'thuyhe.geojson'` as a database `source` value, not a file path. Do NOT remove or edit it** in Task 5.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/scripts/profile-map.mjs` | **Create.** Measurement harness; drives Chrome, emits JSON + table. Knows nothing about the fixes. | 1 |
| `apps/web/scripts/README.md` | **Create.** How to run the harness and read its output. | 1 |
| `apps/web/src/features/map/model/wfsSource.ts` | **Modify.** Add bbox strategy + idempotent normalization + error logging. | 2, 3 |
| `apps/web/src/features/map/model/wfsSource.test.ts` | **Create.** Unit tests for the URL builder and normalizer idempotency. | 2, 3 |
| `apps/web/src/features/map/model/wardsLoader.ts` | **Create.** The one-shot zoom≥10 load gate, isolated so it is testable without a real `Map`. | 4 |
| `apps/web/src/features/map/model/wardsLoader.test.ts` | **Create.** Gate fires exactly once. | 4 |
| `apps/web/src/features/map/model/MapModel.ts` | **Modify.** Wire the wards gate; wards source starts with no URL. | 4 |
| `apps/web/public/thuyhe.geojson` | **Delete.** 5.3 MB, zero references. | 5 |

**Why `wardsLoader.ts` is its own file:** `MapModel.ts` is already 262 lines and owns map construction, basemaps, visibility, and interactions. The gate is pure logic (given a zoom and a "has loaded" flag, decide whether to fetch) and testing it inside `MapModel` would require constructing a real OpenLayers `Map` in jsdom. Extracting it keeps the test trivial and `MapModel` from growing further.

---

## Task 1: Profiling harness (baseline)

**Files:**
- Create: `apps/web/scripts/profile-map.mjs`
- Create: `apps/web/scripts/README.md`
- Modify: `apps/web/package.json` (add `puppeteer-core` devDependency + `profile` script)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `apps/web/scripts/profile-map.mjs`, runnable as `npm run profile -w @webatlas/web -- --out <path>`. Writes a JSON file with shape:
  ```js
  {
    scenario: string,
    timestamp: string,
    firstRenderMs: number,
    longTaskTotalMs: number,
    features: { rivers: number, lakes: number, dams: number, ... },
    transfer: { [layerName: string]: { requests: number, bytes: number } },
    panFrames: { count: number, avgMs: number, worstMs: number }
  }
  ```

This task adds **no behavioral change to the map** — that is what makes the later
before/after comparison trustworthy.

One deliberate exception: Step 4 adds a dev-only `window.__olMap` hook to `MapModel.ts`.
It is required because the plan's primary success metric is *features constructed*, which
can only be read from live OpenLayers sources. It is guarded by `import.meta.env.DEV`, so
production builds never set it, and it changes no map behavior. This exception is
approved — do not remove it, and do not treat it as scope creep.

- [ ] **Step 1: Verify the stack is up**

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:rivers&outputFormat=application/json&count=1"
```

Expected: `200`. If not 200, the stack is not ready — wait and retry before continuing.

- [ ] **Step 2: Add `puppeteer-core` and the `profile` script**

In `apps/web/package.json`, add to `devDependencies` (keep alphabetical order):

```json
"puppeteer-core": "^24.0.0",
```

and add to `scripts`:

```json
"profile": "node scripts/profile-map.mjs"
```

Then install from the repo root:

```bash
npm install
```

> Do **not** run `npm install puppeteer`. See Global Constraints.

- [ ] **Step 3: Write the harness**

Create `apps/web/scripts/profile-map.mjs`:

```js
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
/** Trần thời gian chờ các source nạp xong. Không phải thời gian chờ cố định. */
const SETTLE_TIMEOUT_MS = 60000;
/** Khoảng thăm dò trạng thái idle. */
const POLL_MS = 250;
/** Số nhịp idle LIÊN TIẾP cần có mới coi là đã nạp xong (chống điều kiện tranh chấp). */
const IDLE_STREAK = 8;

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
    // Ưu tiên Content-Length: res.buffer() NÉM LỖI với response lớn dạng stream
    // (rivers ~17MB) và sẽ âm thầm ghi 0 byte, làm hỏng phép so sánh lưu lượng.
    let bytes = Number(res.headers()['content-length'] ?? 0);
    if (!bytes) {
      try {
        bytes = (await res.buffer()).length;
      } catch {
        bytes = 0; // response bị huỷ; ghi 0 nhưng vẫn đếm request
      }
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

  /**
   * Chờ tới khi MỌI vector source ngừng nạp (source.loading === 0), có trần thời gian.
   *
   * KHÔNG dùng thời gian chờ cố định: chính thời gian nạp là thứ ta đang tối ưu, nên
   * một mốc cố định sẽ chụp ở hai thời điểm khác nhau giữa lần đo trước và sau, khiến
   * so sánh trở nên vô nghĩa. Chờ theo ĐIỀU KIỆN thì cả hai lần đều đo "tới khi xong".
   * Trả về số ms đã chờ — đây chính là chỉ số "thời gian tới khi dùng được".
   */
  const waitUntilIdle = async () => {
    const start = Date.now();
    let idleStreak = 0;
    while (Date.now() - start < SETTLE_TIMEOUT_MS) {
      const busy = await page.evaluate(() => {
        const map = window.__olMap;
        if (!map) return -1;
        let pending = 0;
        map.getLayers().forEach((layer) => {
          const src = layer.getSource?.();
          if (src && typeof src.loading === 'number') pending += src.loading;
        });
        return pending;
      });
      // Cần idle LIÊN TIẾP nhiều nhịp: một fetch vừa được kích hoạt (vd. lớp xã sau
      // khi zoom) chưa kịp tăng source.loading, nên nếu chấp nhận idle ngay nhịp đầu
      // ta sẽ báo "xong" trước khi nó kịp bắt đầu.
      idleStreak = busy === 0 ? idleStreak + 1 : 0;
      if (idleStreak >= IDLE_STREAK) return Date.now() - start;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return -1; // chạm trần: còn source chưa nạp xong
  };

  const settleMs = await waitUntilIdle();

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
  const settleAfterZoomMs = await waitUntilIdle();

  const featuresAfterZoom = await countFeatures();
  const longTaskTotalMs = await page.evaluate(
    () => (window.__longTasks ?? []).reduce((a, b) => a + b, 0)
  );

  const result = {
    scenario: 'cold load @MIN_ZOOM -> chờ idle -> pan x4 -> zoom 10.5 -> chờ idle',
    timestamp: new Date().toISOString(),
    firstRenderMs,
    settleMs,
    settleAfterZoomMs,
    longTaskTotalMs,
    featuresAfterLoad,
    featuresAfterZoom,
    transfer,
    panFrames,
  };

  writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\nfirst render      ${firstRenderMs} ms`);
  console.log(`settle (idle)     ${settleMs === -1 ? 'TIMEOUT' : settleMs + ' ms'}`);
  console.log(`settle after zoom ${settleAfterZoomMs === -1 ? 'TIMEOUT' : settleAfterZoomMs + ' ms'}`);
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
```

- [ ] **Step 4: Expose the map instance for the harness**

The harness reads `window.__olMap`. Add this at the end of `MapModel.init()` in
`apps/web/src/features/map/model/MapModel.ts`, immediately after the existing
`map.on('moveend', updateLayersVisibility);` line:

```ts
    // Chỉ để script đo hiệu năng (apps/web/scripts/profile-map.mjs) truy cập được map.
    // Dev-only: production build không đặt biến này.
    if (import.meta.env.DEV) {
      (window as unknown as { __olMap?: Map }).__olMap = map;
    }
```

- [ ] **Step 5: Run the app and capture the baseline**

In one terminal:

```bash
npm run dev:web
```

In another, from the repo root:

```bash
npm run profile -w @webatlas/web -- --out docs/superpowers/plans/baseline-2026-08-05.json
```

Expected: a printed table plus the JSON file. `featuresAfterLoad` should show roughly
`layer_rivers ≈ 9486` and `layer_lakes ≈ 3868` — the full nationwide set. **Record these
numbers; they are the baseline every later task is measured against.**

`settleMs` is expected to be large here (measured at ~20-30s on this dataset) — that is
the honest cost of loading everything nationwide, and it is the number bbox loading
should shrink most. If `settleMs` prints `TIMEOUT`, raise `SETTLE_TIMEOUT_MS` and re-run;
do NOT record a timed-out baseline.

**A baseline is only valid if ALL of these hold.** Check before committing:

```bash
node -e "
const b=require('./docs/superpowers/plans/baseline-2026-08-05.json');
const bad=[];
if (b.featuresAfterLoad.layer_rivers !== 9486) bad.push('rivers != 9486');
if (b.featuresAfterLoad.layer_lakes !== 3868) bad.push('lakes != 3868');
if (b.featuresAfterZoom.layer_wards_2026 !== 616) bad.push('wards@zoom != 616');
if (b.settleMs <= 0) bad.push('settleMs invalid');
for (const k of ['wfs:rivers','wfs:lakes','file:wards-region']) {
  if (!(b.transfer[k]?.bytes > 0)) bad.push(k + ' has 0 bytes');
}
console.log(bad.length ? 'INVALID: ' + bad.join('; ') : 'baseline OK');
"
```

Expected: `baseline OK`. Anything else means re-run — a baseline with zeros silently
inverts the Task 6 comparison.

> **Do not run the profiler in a tight loop.** GeoServer's WFS response degrades sharply
> under back-to-back heavy requests (observed: 2.3s → 60s+, needing a container restart).
> Let it idle between runs, and prefer an otherwise-quiet machine — wall-clock metrics
> vary materially with host CPU load.

If `window.__olMap not exposed` appears, Step 4 was not applied or the dev server is
serving a stale bundle — restart `npm run dev:web`.

- [ ] **Step 6: Document the harness**

Create `apps/web/scripts/README.md`:

```markdown
# Script đo hiệu năng bản đồ

`profile-map.mjs` chạy một kịch bản cố định trên Chrome hệ thống và ghi lại:

- `firstRenderMs` — tới khi canvas OpenLayers đầu tiên xuất hiện
- `longTaskTotalMs` — tổng thời gian long task trên main thread
- `featuresAfterLoad` / `featuresAfterZoom` — **số feature đã dựng trong mỗi lớp**
  (đây là chỉ số chính: chi phí main thread tỉ lệ với số feature, không phải số byte nén)
- `transfer` — số request và số byte theo từng lớp
- `panFrames` — nhịp khung hình khi pan

## Yêu cầu

- Docker stack đang chạy: `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`
- Dev server đang chạy: `npm run dev:web`
- Chrome hệ thống. Đặt `CHROME_PATH` nếu Chrome không nằm ở đường dẫn mặc định.
  Dự án dùng `puppeteer-core` (KHÔNG dùng `puppeteer` bản đầy đủ — nó tải kèm trình duyệt riêng).

## Chạy

```bash
npm run profile -w @webatlas/web -- --out ket-qua.json
```

Không chạy trong CI; đây là công cụ chạy theo nhu cầu.
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/scripts/profile-map.mjs apps/web/scripts/README.md apps/web/package.json apps/web/src/features/map/model/MapModel.ts package-lock.json docs/superpowers/plans/baseline-2026-08-05.json
git commit -m "$(cat <<'EOF'
perf(web): script đo hiệu năng tải bản đồ + số liệu nền

Chạy kịch bản cố định trên Chrome hệ thống qua puppeteer-core, ghi lại
số feature đã dựng, thời gian long task, first render và lưu lượng theo lớp.
Chỉ đo, chưa tối ưu gì — để so sánh trước/sau.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Idempotent feature normalization

**Files:**
- Modify: `apps/web/src/features/map/model/wfsSource.ts:34-66`
- Create: `apps/web/src/features/map/model/wfsSource.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (Task 1 only added a dev-only global).
- Produces: an exported `normalizeLoadedFeatures(layerKey: EditableLayerKey, features: Feature[]): void` from `wfsSource.ts`. Task 3 calls it from the `featuresloadend` handler.

**Why this comes before bbox:** under bbox loading `featuresloadend` fires once per extent
rather than once per session, so normalization must be safe to re-enter *before* we
change when it fires. Doing it in this order means the codebase is never in a broken state.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/wfsSource.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { normalizeLoadedFeatures } from './wfsSource';

describe('normalizeLoadedFeatures', () => {
  it('đổi tên thuộc tính DB sang tên ISO và đóng dấu layerKey', () => {
    const f = new Feature({ geometry: new Point([0, 0]), name: 'Sông Ba', stream_order: 4 });
    normalizeLoadedFeatures('rivers', [f]);
    expect(f.get('layerKey')).toBe('rivers');
    expect(f.get('streamOrder')).toBe(4);
    expect(f.get('stream_order')).toBeUndefined();
  });

  it('chạy lại lần hai không làm đổi thuộc tính (idempotent)', () => {
    const f = new Feature({ geometry: new Point([0, 0]), name: 'Sông Ba', stream_order: 4 });
    normalizeLoadedFeatures('rivers', [f]);
    const after1 = { ...f.getProperties() };
    delete (after1 as Record<string, unknown>).geometry;

    normalizeLoadedFeatures('rivers', [f]);
    const after2 = { ...f.getProperties() };
    delete (after2 as Record<string, unknown>).geometry;

    expect(after2).toEqual(after1);
  });

  it('đóng dấu statusSlug và nhãn hiển thị cho lớp đập', () => {
    const f = new Feature({ geometry: new Point([0, 0]), status: 'nguy_hiem' });
    normalizeLoadedFeatures('dams', [f]);
    expect(f.get('statusSlug')).toBe('nguy_hiem');
    expect(typeof f.get('operationalStatus')).toBe('string');
  });

  it('chạy lại trên lớp đập vẫn giữ nguyên statusSlug', () => {
    const f = new Feature({ geometry: new Point([0, 0]), status: 'nguy_hiem' });
    normalizeLoadedFeatures('dams', [f]);
    const slug1 = f.get('statusSlug');
    const label1 = f.get('operationalStatus');
    normalizeLoadedFeatures('dams', [f]);
    expect(f.get('statusSlug')).toBe(slug1);
    expect(f.get('operationalStatus')).toBe(label1);
  });

  it('bỏ qua feature không có hình học', () => {
    const f = new Feature({ name: 'không toạ độ' });
    expect(() => normalizeLoadedFeatures('dams', [f])).not.toThrow();
    expect(f.get('layerKey')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wfsSource.test.ts
```

Expected: FAIL — `normalizeLoadedFeatures is not a function` / no matching export.

- [ ] **Step 3: Extract and harden the normalizer**

In `apps/web/src/features/map/model/wfsSource.ts`, replace the whole
`source.on('featuresloadend', ...)` block (lines 33–66) with an exported function plus a
thin handler. The new file body from line 19 onward:

```ts
/**
 * Chuẩn hoá feature vừa tải: bỏ feature không hình học, đổi tên thuộc tính DB -> ISO,
 * đóng dấu `layerKey`, và với lớp đập thì tính sẵn `statusSlug` + nhãn hiển thị.
 *
 * PHẢI idempotent: dưới chiến lược bbox, `featuresloadend` bắn theo từng extent nên
 * một feature có thể được xử lý nhiều lần. Dấu `layerKey` đóng vai trò cờ "đã xử lý".
 */
export function normalizeLoadedFeatures(layerKey: EditableLayerKey, features: Feature[]): void {
  for (const f of features) {
    if (!f.getGeometry()) continue;
    // Đã chuẩn hoá rồi thì bỏ qua — tránh churn thuộc tính mỗi lần pan.
    if (f.get('layerKey') === layerKey) continue;

    const raw = f.getProperties();
    const geomKey = f.getGeometryName();
    const dbProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k !== geomKey) dbProps[k] = v;
    }
    const iso = normalizeFeatureProperties(layerKey, dbProps);
    for (const k of Object.keys(dbProps)) f.unset(k, true);
    f.setProperties(iso, true);

    if (layerKey === 'dams') {
      const slug = toDamStatusSlug(f.get('operationalStatus'));
      f.set('statusSlug', slug, true);
      f.set('operationalStatus', DAM_STATUS_DISPLAY[slug].label, true);
    }
  }
}

/**
 * VectorSource for a thematic layer served from GeoServer WFS as GeoJSON.
 * - Reprojects EPSG:4326 -> EPSG:3857 (map view projection).
 * - Drops features with no geometry (e.g. coordinate-less dams).
 * - Renames properties to ISO/INSPIRE names and stamps `layerKey`.
 */
export function createWfsVectorSource(layerKey: EditableLayerKey): VectorSource {
  const info = LAYER_ATTRIBUTE_MAP[layerKey];
  const format = new GeoJSON();
  const source = new VectorSource({
    format,
    url: wfsUrl(info.wfsTypeName),
  });

  source.on('featuresloadend', (evt) => {
    const loaded = (evt as unknown as { features?: Feature[] }).features ?? [];
    normalizeLoadedFeatures(layerKey, loaded);
    // Feature không hình học không dùng được để vẽ — loại khỏi source.
    for (const f of loaded) {
      if (!f.getGeometry()) source.removeFeature(f);
    }
    source.changed();
  });

  return source;
}
```

Two deliberate changes beyond the extraction:

1. The `?? source.getFeatures()` fallback is **gone**. Under bbox loading it would re-scan
   every previously loaded feature on every pan. `evt.features` is always populated on
   this event (verified in `node_modules/ol/source/Vector.js:1005-1017`).
2. Geometry-less features are removed *after* normalization rather than during, so the
   loop is not mutating the collection it iterates.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wfsSource.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full web suite for regressions**

```bash
npm run test:web
```

Expected: all pass. This is the guard on the editing controllers.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/map/model/wfsSource.ts apps/web/src/features/map/model/wfsSource.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): tách hàm chuẩn hoá feature và làm cho nó idempotent

Chuẩn bị cho chiến lược bbox: featuresloadend sẽ bắn theo từng extent
nên một feature có thể được xử lý lại nhiều lần. Dùng dấu layerKey làm
cờ "đã xử lý" và bỏ nhánh dự phòng getFeatures() vốn sẽ quét lại toàn bộ
feature cũ mỗi lần pan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: BBOX loading strategy

**Files:**
- Modify: `apps/web/src/features/map/model/wfsSource.ts:7-17` (URL builder) and the `createWfsVectorSource` body
- Modify: `apps/web/src/features/map/model/wfsSource.test.ts` (add URL-builder tests)

**Interfaces:**
- Consumes: `normalizeLoadedFeatures(layerKey, features)` from Task 2.
- Produces: an exported `wfsUrl(typeName: string, extent?: number[]): string`. Returns a WFS 2.0.0 GetFeature URL; when `extent` is supplied it appends `bbox=<minx>,<miny>,<maxx>,<maxy>,EPSG:3857`.

- [ ] **Step 1: Write the failing tests**

Add to the top of `apps/web/src/features/map/model/wfsSource.test.ts` — extend the import
and append a new `describe` block:

```ts
import { normalizeLoadedFeatures, wfsUrl } from './wfsSource';
```

```ts
describe('wfsUrl', () => {
  it('dựng URL WFS 2.0.0 GetFeature cơ bản', () => {
    const url = wfsUrl('webatlas:rivers');
    expect(url).toContain('service=WFS');
    expect(url).toContain('version=2.0.0');
    expect(url).toContain('request=GetFeature');
    expect(url).toContain('typeNames=webatlas%3Arivers');
    expect(url).toContain('outputFormat=application%2Fjson');
  });

  it('không có tham số bbox khi không truyền extent', () => {
    expect(wfsUrl('webatlas:rivers')).not.toContain('bbox');
  });

  it('thêm bbox theo EPSG:3857 khi có extent', () => {
    const url = wfsUrl('webatlas:rivers', [1, 2, 3, 4]);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('bbox=1,2,3,4,EPSG:3857');
  });

  it('srsName vẫn là EPSG:4326 để feature trả về đúng hệ toạ độ nguồn', () => {
    const decoded = decodeURIComponent(wfsUrl('webatlas:rivers', [1, 2, 3, 4]));
    expect(decoded).toContain('srsName=EPSG:4326');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wfsSource.test.ts
```

Expected: FAIL — `wfsUrl` is not exported.

- [ ] **Step 3: Add the bbox strategy**

In `apps/web/src/features/map/model/wfsSource.ts`, add the import at the top:

```ts
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
```

Replace the `wfsUrl` function (lines 7–17) with:

```ts
/**
 * URL WFS GetFeature. Có `extent` (EPSG:3857, do OpenLayers cấp) thì giới hạn theo bbox.
 * `srsName` vẫn là EPSG:4326 vì đó là hệ toạ độ GeoServer trả về; chỉ bbox dùng 3857
 * để khớp với hệ chiếu khung nhìn.
 */
export function wfsUrl(typeName: string, extent?: number[]): string {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  });
  if (extent) {
    params.set('bbox', `${extent.join(',')},EPSG:3857`);
  }
  return `${GEOSERVER_URL}/ows?${params.toString()}`;
}
```

Then change the `VectorSource` construction inside `createWfsVectorSource` from:

```ts
  const source = new VectorSource({
    format,
    url: wfsUrl(info.wfsTypeName),
  });
```

to:

```ts
  const source = new VectorSource({
    format,
    strategy: bboxStrategy,
    url: (extent) => wfsUrl(info.wfsTypeName, extent),
  });

  // Dưới bbox, số request tăng nhiều nên lỗi tạm thời dễ xảy ra hơn và để lại
  // "lỗ hổng" trên bản đồ. Ghi log để chẩn đoán. Không tự thử lại (ngoài phạm vi spec).
  // Lưu ý: sự kiện featuresloaderror của OpenLayers KHÔNG kèm extent.
  source.on('featuresloaderror', () => {
    console.error(`[wfs] tải feature thất bại cho lớp "${layerKey}"`);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wfsSource.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full web suite**

```bash
npm run test:web
```

Expected: all pass.

- [ ] **Step 6: Verify manually against the real stack**

With `npm run dev:web` running and the Docker stack up, open the app and confirm in the
browser DevTools Network tab:

1. Rivers/lakes requests now carry a `bbox=` parameter.
2. Panning issues **new** requests; panning **back** to an already-visited area issues
   none (OpenLayers skips extents it already holds).
3. Clicking a river still highlights it.
4. As an admin, creating or editing a feature still makes it appear after save
   (this exercises `refreshLayer()` under the bbox strategy).

If step 4 fails, `source.refresh()` under bbox needs the current extent re-requested —
stop and report rather than working around it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/wfsSource.ts apps/web/src/features/map/model/wfsSource.test.ts
git commit -m "$(cat <<'EOF'
perf(web): tải lớp WFS theo bbox thay vì toàn quốc

Mỗi lớp chuyên đề chỉ còn yêu cầu phần dữ liệu trong khung nhìn hiện tại,
cắt mạnh số feature phải parse và dựng trên main thread. Thêm log lỗi
tải theo lớp vì số request tăng nhiều dưới chiến lược này.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Zoom-gated wards loading

**Files:**
- Create: `apps/web/src/features/map/model/wardsLoader.ts`
- Create: `apps/web/src/features/map/model/wardsLoader.test.ts`
- Modify: `apps/web/src/features/map/model/MapModel.ts:103` and the `moveend` wiring

**Interfaces:**
- Consumes: nothing from Tasks 2–3.
- Produces: `WARDS_MIN_ZOOM: number` (= 10.0) and `createWardsLoadGate(load: () => void): (zoom: number) => void` from `wardsLoader.ts`. The returned function is called on every `moveend`; it invokes `load` the first time zoom ≥ `WARDS_MIN_ZOOM` and never again.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/wardsLoader.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createWardsLoadGate, WARDS_MIN_ZOOM } from './wardsLoader';

describe('createWardsLoadGate', () => {
  it('chưa tải khi còn zoom nhỏ hơn ngưỡng', () => {
    const load = vi.fn();
    const gate = createWardsLoadGate(load);
    gate(7);
    gate(9.9);
    expect(load).not.toHaveBeenCalled();
  });

  it('tải khi vượt ngưỡng', () => {
    const load = vi.fn();
    const gate = createWardsLoadGate(load);
    gate(WARDS_MIN_ZOOM);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('chỉ tải đúng một lần dù ra vào ngưỡng nhiều lần', () => {
    const load = vi.fn();
    const gate = createWardsLoadGate(load);
    gate(10.5);
    gate(7);
    gate(11);
    gate(8);
    gate(12);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua zoom không xác định', () => {
    const load = vi.fn();
    const gate = createWardsLoadGate(load);
    gate(undefined as unknown as number);
    expect(load).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wardsLoader.test.ts
```

Expected: FAIL — cannot resolve `./wardsLoader`.

- [ ] **Step 3: Write the gate**

Create `apps/web/src/features/map/model/wardsLoader.ts`:

```ts
/**
 * Cổng tải lớp ranh giới xã.
 *
 * `setMinZoom` của OpenLayers chỉ chặn VẼ; source có `url` vẫn tải ngay khi khởi tạo.
 * Vì file xã nặng ~6,9 MB mà chỉ hiển thị từ zoom 10 trở lên, ta chặn ở tầng source:
 * source khởi tạo rỗng, chỉ nạp URL vào lần đầu người dùng vượt ngưỡng.
 */

/** Ngưỡng zoom bắt đầu hiển thị ranh giới xã — khớp với recomputeVisibility() trong MapModel. */
export const WARDS_MIN_ZOOM = 10.0;

/**
 * Trả về hàm gọi mỗi lần `moveend`. Lần đầu zoom >= WARDS_MIN_ZOOM thì gọi `load()`,
 * sau đó không gọi lại nữa dù người dùng ra vào ngưỡng bao nhiêu lần.
 */
export function createWardsLoadGate(load: () => void): (zoom: number) => void {
  let loaded = false;
  return (zoom: number) => {
    if (loaded) return;
    if (typeof zoom !== 'number' || Number.isNaN(zoom)) return;
    if (zoom < WARDS_MIN_ZOOM) return;
    loaded = true;
    load();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -w @webatlas/web -- src/features/map/model/wardsLoader.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the gate into MapModel**

In `apps/web/src/features/map/model/MapModel.ts`, add to the imports:

```ts
import { createWardsLoadGate, WARDS_MIN_ZOOM } from './wardsLoader';
```

Add a field beside the other private fields (near line 47):

```ts
  private wardsGate: ((zoom: number) => void) | null = null;
```

Replace line 103:

```ts
    const wardsLayer = createVectorLayerFromUrl('layer_wards_2026', './wards-region.geojson', wardsStyle);
```

with:

```ts
    // Source khởi tạo RỖNG: file xã ~6,9 MB chỉ được tải khi người dùng thực sự
    // zoom tới mức nhìn thấy nó (xem wardsLoader.ts).
    // `format` BẮT BUỘC phải có ngay từ đầu: setUrl() có assert yêu cầu format
    // đã được set (ol/source/Vector.js:1192). Đừng bỏ tham số này.
    const wardsSource = new VectorSource({ format: new GeoJSON() });
    const wardsLayer = new VectorLayer({
      source: wardsSource,
      style: wardsStyle,
      properties: { id: 'layer_wards_2026' },
    });
    this.layers['layer_wards_2026'] = wardsLayer;
    this.wardsGate = createWardsLoadGate(() => {
      wardsSource.setUrl('./wards-region.geojson');
      wardsSource.refresh();
    });
```

Then change the `moveend` handler so it drives the gate as well.

> **Note:** Task 1 Step 4 already appended a dev-only `window.__olMap` block *below*
> `map.on('moveend', updateLayersVisibility);`. Leave that block untouched — the harness
> in Task 6 depends on it. You are replacing only the handler definition above it.

Replace:

```ts
    const updateLayersVisibility = () => this.recomputeVisibility();
```

with:

```ts
    const updateLayersVisibility = () => {
      const zoom = this.map?.getView().getZoom();
      if (zoom !== undefined) this.wardsGate?.(zoom);
      this.recomputeVisibility();
    };
```

Finally, in `dispose()`, add beside the other cleanup so a remounted map re-gates:

```ts
    this.wardsGate = null;
```

> `WARDS_MIN_ZOOM` is imported so the threshold has one source of truth. Update the
> literal `10.0` in `recomputeVisibility()` (line ~170) to use it:
>
> ```ts
>         } else if (state.id === 'layer_wards_2026') {
>           zoomVisible = currentZoom >= WARDS_MIN_ZOOM;
>         }
> ```

- [ ] **Step 6: Run the full web suite**

```bash
npm run test:web
```

Expected: all pass — including `boundaries.test.ts`, which asserts a file-size ceiling and
is unaffected by *when* the file loads.

- [ ] **Step 7: Verify manually**

With the app running, open DevTools Network, filter `wards`:

1. On first load at the default zoom, `wards-region.geojson` is **not** requested.
2. Zoom past 10 — it is requested exactly once.
3. Zoom out below 10 and back in — **no** second request.
4. Ward boundaries render as before at zoom ≥ 10.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/map/model/wardsLoader.ts apps/web/src/features/map/model/wardsLoader.test.ts apps/web/src/features/map/model/MapModel.ts
git commit -m "$(cat <<'EOF'
perf(web): hoãn tải ranh giới xã tới khi zoom >= 10

File xã ~6,9 MB trước đây tải ngay lúc khởi tạo bản đồ dù chỉ hiển thị
từ zoom 10. setMinZoom chỉ chặn vẽ chứ không chặn tải, nên phải chặn ở
tầng source: khởi tạo rỗng, nạp URL đúng một lần khi vượt ngưỡng.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete the dead thuyhe.geojson

**Files:**
- Delete: `apps/web/public/thuyhe.geojson`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Fully independent of Tasks 1–4.

- [ ] **Step 1: Re-verify there are no runtime references**

```bash
grep -rn "thuyhe" apps/web/src apps/web/index.html
```

Expected: **no output.** If anything is printed, stop — the file is still in use and this
task must not proceed.

- [ ] **Step 2: Confirm what the remaining references are**

```bash
grep -rln "thuyhe" --include="*.ts" --include="*.mjs" apps/ | grep -v node_modules
```

Expected exactly these two, both of which must be left alone:

- `apps/api/src/db/seeds/seed.test.ts` — asserts thuyhe is *absent* from seeds
- `apps/api/scripts/prune-hydrosheds-versions.mjs` — contains `'thuyhe.geojson'` as a
  **database `source` value**, not a file path

- [ ] **Step 3: Delete the file**

```bash
git rm apps/web/public/thuyhe.geojson
```

- [ ] **Step 4: Verify the build still succeeds**

```bash
npm run build:web
```

Expected: build succeeds. (`apps/web/dist/` is git-ignored; a stale copy there is
regenerated and does not matter.)

- [ ] **Step 5: Run the full web suite**

```bash
npm run test:web
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(web): xoá thuyhe.geojson không còn dùng (5,3 MB)

Lớp sông đã chuyển hẳn sang OSM; file này không còn tham chiếu nào
trong apps/web/src. Chuỗi 'thuyhe.geojson' trong prune-hydrosheds-versions.mjs
là giá trị source trong DB, không phải đường dẫn file — giữ nguyên.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Measure the result and record the outcome

**Files:**
- Create: `docs/superpowers/plans/result-2026-08-05.json`
- Modify: `docs/superpowers/specs/2026-08-05-map-performance-design.md` (append a results section)

**Interfaces:**
- Consumes: the harness from Task 1 and every change from Tasks 2–5.
- Produces: the before/after evidence the spec's §8 success criteria demand.

- [ ] **Step 1: Re-run the harness**

With the Docker stack up and `npm run dev:web` running:

```bash
npm run profile -w @webatlas/web -- --out docs/superpowers/plans/result-2026-08-05.json
```

- [ ] **Step 2: Compare against the baseline**

```bash
node -e "
const b=require('./docs/superpowers/plans/baseline-2026-08-05.json');
const r=require('./docs/superpowers/plans/result-2026-08-05.json');
const row=(k,x,y,u='')=>console.log(k.padEnd(24), String(x).padStart(10), '->', String(y).padStart(10), u);
row('first render', b.firstRenderMs, r.firstRenderMs, 'ms');
row('settle to idle', b.settleMs, r.settleMs, 'ms');
row('long tasks', b.longTaskTotalMs.toFixed(0), r.longTaskTotalMs.toFixed(0), 'ms');
for (const k of new Set([...Object.keys(b.featuresAfterLoad||{}), ...Object.keys(r.featuresAfterLoad||{})])) {
  row('features '+k, (b.featuresAfterLoad||{})[k] ?? '-', (r.featuresAfterLoad||{})[k] ?? '-');
}
const mb=t=>Object.values(t).reduce((a,v)=>a+v.bytes,0)/1048576;
row('total transfer', mb(b.transfer).toFixed(2), mb(r.transfer).toFixed(2), 'MB');
"
```

Expected direction: features for `layer_rivers` and `layer_lakes` on initial load drop
sharply (viewport-only instead of nationwide), first render and long-task totals improve.

**If features did not drop, the bbox strategy is not active — stop and diagnose rather
than proceeding.**

- [ ] **Step 3: Record the results in the spec**

Append to `docs/superpowers/specs/2026-08-05-map-performance-design.md`:

```markdown
## 11. Results (measured 2026-08-05)

Harness: `apps/web/scripts/profile-map.mjs`, same scenario for both runs.
Raw data: `docs/superpowers/plans/baseline-2026-08-05.json` and `result-2026-08-05.json`.

| Metric | Before | After |
|---|---|---|
| Features built on initial load (rivers) | _fill from Step 2_ | _fill from Step 2_ |
| Features built on initial load (lakes) | _fill from Step 2_ | _fill from Step 2_ |
| Time to first render | _fill_ ms | _fill_ ms |
| **Time until all sources idle** | _fill_ ms | _fill_ ms |
| Main-thread long tasks | _fill_ ms | _fill_ ms |
| Total transfer | _fill_ MB | _fill_ MB |

Wards (6.9 MB) is no longer requested on initial load at all; it is fetched once on the
first crossing of zoom 10.
```

Replace every `_fill_` with the real numbers from Step 2. **Leaving a `_fill_` in place is
a task failure.**

- [ ] **Step 4: Run the full suite one last time**

```bash
npm run test:web
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/result-2026-08-05.json docs/superpowers/specs/2026-08-05-map-performance-design.md
git commit -m "$(cat <<'EOF'
docs: số liệu hiệu năng sau tối ưu

Đo lại bằng đúng kịch bản của lần đo nền. Ghi kết quả trước/sau vào spec.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4.1 Profiling harness | 1 |
| §4.2 bbox loading | 3 |
| §4.2 idempotent normalization | 2 |
| §4.3 zoom-gated wards | 4 |
| §4.4 delete thuyhe | 5 |
| §6 error handling (`featuresloaderror`) | 3, Step 3 |
| §7 bbox URL test | 3, Step 1 |
| §7 normalizer idempotency test | 2, Step 1 |
| §7 wards gate fires once | 4, Step 1 |
| §7 existing suites pass | 2, 3, 4, 5 — every task runs `npm run test:web` |
| §7 `refreshLayer()` under bbox | 3, Step 6 (manual verification) |
| §8 success criteria measured | 6 |

**Deviation from the spec, deliberate:** §6 says the error handler logs "the layer key and
the failed extent." OpenLayers' `featuresloaderror` event carries **no extent**
(verified in `node_modules/ol/source/Vector.js:1019-1024`), so Task 3 logs the layer key
only, with a comment recording why.

**Deviation from the spec, deliberate:** §7 lists `refreshLayer()` under bbox as needing
"an explicit test." It is verified manually in Task 3 Step 6 rather than by unit test —
asserting it meaningfully requires a live GeoServer and a real `Map`, which the jsdom
suite cannot provide. The manual check is explicit and blocking.

**Placeholder scan:** The only intentional placeholders are the `_fill_` markers in
Task 6 Step 3, which that step's own instruction requires replacing with measured values.

**Type consistency:** `normalizeLoadedFeatures(layerKey, features)` is defined in Task 2
and called in Task 3 with the same signature. `wfsUrl(typeName, extent?)` is defined in
Task 3 and used only there. `createWardsLoadGate(load)` and `WARDS_MIN_ZOOM` are defined
in Task 4 and consumed in the same task's `MapModel` wiring. `window.__olMap` is set in
Task 1 Step 4 and read by the harness in Task 1 Step 3 and again in Task 6.

**Ordering constraint:** Task 2 must precede Task 3 — normalization must be safe to
re-enter *before* the event starts firing per-extent. Tasks 4 and 5 are independent and
may run in any order. Task 6 requires 1–5.
