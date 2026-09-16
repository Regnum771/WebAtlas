# River Overview Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the main river trunks (sông chính) visible across the zoomed-out half of the scale range, where the river network is currently absent entirely.

**Architecture:** A materialized view holding only bucket-3 rivers, pre-simplified to a tolerance far below one pixel at the far zoom, published as its own GeoServer layer and loaded by a second `VectorLayer` that is active only *below* the existing `minZoom: 8.5` gate. The two river layers are mutually exclusive by construction, so there is never double drawing.

**Tech Stack:** PostGIS (`ST_SimplifyPreserveTopology`), node-pg-migrate, GeoServer WFS, OpenLayers, Vitest.

---

## The problem, measured

`layer_rivers` has `minZoom: 8.5` ([layerDisplay.ts:37](../../../apps/web/src/entities/layer/layerDisplay.ts#L37)), enforced at the source by `zoomLoadGate` — below zoom 8.5 the WFS layer does not load at all. Zoom 8.5 is **1:1.570.934**, so after the range widened to 1:12.800.000 there are now **five slider notches with no river network**:

| Notch | zoom | rivers |
|---|---|---|
| 1:12.800.000 … 1:1.750.000 | 5.47–8.34 | **not loaded** |
| 1:1.000.000 | 9.15 | bucket 3 |
| 1:500.000 | 10.15 | + bucket 2 |
| 1:250.000 | 11.15 | + bucket 1 |
| 1:100.000 and closer | 12.47+ | all |

The gate is not arbitrary — the payload justifies it:

| Request | Time | Payload |
|---|---|---|
| All rivers | 12,3s | 17,6 MB |
| Bucket 3 only (`stream_order = 5`) | 3,6s | 5,1 MB |

**The cost is vertices, not features.** Bucket 3 is only 1.723 features but 223.052 vertices:

| Tolerance | Vertices | Geometry |
|---|---|---|
| raw | 223.052 | 3.552 kB |
| 0,001° (~110 m) | 21.240 | 377 kB |
| **0,01° (~1,1 km)** | **4.484** | **104 kB** |
| 0,03° (~3,3 km) | 3.535 | 83 kB |

At 1:12.800.000 one pixel is **3,39 km** on the ground, so 0,01° (~1,1 km) is a third of a pixel — invisible, and a **34× reduction**. That is what makes this viable: ~104 kB of geometry instead of 3,5 MB.

---

## Global Constraints

- **Do not change `minZoom: 8.5` on `layer_rivers`.** The full-detail layer keeps its gate; this plan adds a layer *below* it.
- **The two river layers must never both draw.** Bucket 3 would render twice, at two different simplifications.
- **Tolerance 0,01°**, chosen against the 3,39 km pixel at `MIN_SCALE`. Record the reasoning wherever it is set.
- **Only `stream_order = 5`.** `minRiverBucketAt` already hides buckets 0–2 above 1:1.000.000, so carrying them in the overview would be pure waste.
- **`rivers_active` has no `deleted` column** — the view already excludes deleted rows, so do not add such a filter.
- **Materialized, not a plain view.** On-the-fly `ST_SimplifyPreserveTopology` over bucket 3 measured **316 ms**; under the bbox strategy that recurs on every viewport change.
- **Vietnamese comments and UI copy**, matching the surrounding code.
- Migration numbering continues from `1000000000008_assistant-db-role.cjs` → **`1000000000009`**.

---

## The versioning hazard — read before starting

`water.rivers_active` is a **view** over a recursive CTE against `app.dataset_versions`; it changes meaning the moment someone activates a different dataset version. A materialized view built from it is a **snapshot** and will silently serve the old version until refreshed.

This is the one correctness risk in the plan. Two places must refresh it:

1. **After ingest** (`ingest:rivers`) — new data loaded.
2. **After a version is activated** — the versions module changes which rows `_active` returns.

Task 3 covers both, and Task 1 adds a test that fails if the overview disagrees with `rivers_active` about which features are current. Without that, the far-zoom map can show a superseded river network with no indication anything is wrong.

---

## File Structure

**Created:**
- `apps/api/src/db/migrations/1000000000009_river-overview.cjs` — the materialized view, its index, and a refresh function.
- `apps/api/src/db/riverOverview.ts` — `refreshRiverOverview(pool)`, one place both callers use.
- `apps/api/src/db/riverOverview.test.ts` — content and staleness tests.
- `apps/web/src/features/map/model/riverOverview.ts` — `riverOverviewVisibleAt(zoom)`, the pure mutual-exclusion rule.
- `apps/web/src/features/map/model/riverOverview.test.ts`

**Modified:**
- `apps/api/src/geoserver/publish.ts` — publish `rivers_overview`.
- `apps/api/src/db/seeds/ingestRivers.ts` — refresh after ingest.
- `apps/api/src/modules/versions/` — refresh after activation (exact file found in Task 3).
- `apps/web/src/features/map/model/MapModel.ts` — the second layer and its zoom wiring.
- `apps/web/src/entities/layer/layerDisplay.ts` — no new panel entry; the overview rides on `layer_rivers`' own toggle.

---

### Task 1: The materialized view

**Files:**
- Create: `apps/api/src/db/migrations/1000000000009_river-overview.cjs`
- Create: `apps/api/src/db/riverOverview.test.ts`

**Interfaces:**
- Produces: `water.rivers_overview` with columns `id`, `name`, `stream_order`, `geom`; a GiST index `rivers_overview_geom_idx`.

- [x] **Step 1: Write the failing test**

Create `apps/api/src/db/riverOverview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from './pool';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

describe('water.rivers_overview', () => {
  it('carries only the main trunks — the other buckets are hidden at these scales anyway', async () => {
    const { rows } = await pool.query<{ stream_order: number }>(
      'SELECT DISTINCT stream_order FROM water.rivers_overview',
    );
    expect(rows.map((r) => r.stream_order)).toEqual([5]);
  });

  it('is simplified far below one pixel at the far zoom', async () => {
    // At 1:12.800.000 one pixel is 3,39 km; the 0,01° tolerance is ~1,1 km, so
    // the shape a user sees is unchanged while the payload drops ~34x.
    const { rows } = await pool.query<{ overview: string; full: string }>(`
      SELECT (SELECT sum(ST_NPoints(geom)) FROM water.rivers_overview)::text AS overview,
             (SELECT sum(ST_NPoints(geom)) FROM water.rivers_active WHERE stream_order = 5)::text AS full
    `);
    expect(Number(rows[0].overview)).toBeLessThan(Number(rows[0].full) / 10);
  });

  it('holds the same features as the active version — a stale snapshot shows a superseded network', async () => {
    // rivers_active is version-aware; this materialized view is a snapshot of it.
    // If activation or ingest forgets to refresh, the far zoom silently serves
    // the old data with nothing to indicate it.
    const { rows } = await pool.query<{ missing: string }>(`
      SELECT count(*)::text AS missing FROM (
        SELECT id FROM water.rivers_active WHERE stream_order = 5
        EXCEPT SELECT id FROM water.rivers_overview
      ) q
    `);
    expect(Number(rows[0].missing)).toBe(0);
  });

  it('has a spatial index, since the layer is queried by bbox like any other', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'water' AND tablename = 'rivers_overview'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- riverOverview`
Expected: FAIL — `relation "water.rivers_overview" does not exist`.

- [x] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000009_river-overview.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Lớp sông TỔNG QUAN cho các mức thu nhỏ.
 *
 * Vì sao cần: layer_rivers bị chặn tải dưới zoom 8,5 (1:1.570.934) — hợp lý, vì
 * tải cả mạng lưới tốn 17,6 MB, riêng sông chính đã 5,1 MB. Nhưng sau khi dải tỷ
 * lệ nới ra 1:12.800.000 thì có tới NĂM nấc không còn con sông nào, trong một
 * atlas tài nguyên nước.
 *
 * Vì sao rẻ: giá nằm ở SỐ ĐỈNH chứ không phải số đối tượng. Bucket 3 chỉ 1.723
 * đối tượng nhưng 223.052 đỉnh. Ở 1:12.800.000 một điểm ảnh bằng 3,39 km trên
 * thực địa, nên dung sai 0,01° (~1,1 km) nhỏ hơn một phần ba điểm ảnh — mắt
 * không thấy khác, mà còn 4.484 đỉnh / 104 kB, nhẹ đi 34 lần.
 *
 * Vì sao MATERIALIZED: chạy ST_SimplifyPreserveTopology tại chỗ mất 316 ms cho
 * cả bucket 3, mà chiến lược bbox gọi lại mỗi lần đổi khung nhìn.
 *
 * CẢNH BÁO: rivers_active là view CÓ PHIÊN BẢN. Bảng vật chất hoá này là một ảnh
 * chụp; kích hoạt phiên bản khác mà quên refresh thì mức thu nhỏ vẫn phục vụ dữ
 * liệu cũ trong im lặng. Xem refreshRiverOverview và ca kiểm thử đi kèm.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE MATERIALIZED VIEW water.rivers_overview AS
      SELECT id,
             name,
             stream_order,
             ST_SimplifyPreserveTopology(geom, 0.01) AS geom
        FROM water.rivers_active
       WHERE stream_order = 5
  `);
  pgm.sql(`CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`);
  // UNIQUE index là điều kiện để REFRESH ... CONCURRENTLY chạy được, nhờ đó lần
  // làm mới không khoá bảng với người đang xem bản đồ.
  pgm.sql(`CREATE UNIQUE INDEX rivers_overview_id_idx ON water.rivers_overview (id)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
};
```

- [x] **Step 4: Run the migration and the test**

```bash
npm run migrate:up -w @webatlas/api
npm run test -w @webatlas/api -- riverOverview
```
Expected: migration applies; all four tests pass.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/1000000000009_river-overview.cjs apps/api/src/db/riverOverview.test.ts
git commit -m "feat(api): khung nhìn tổng quan cho sông chính, đơn giản hoá hình học"
```

---

### Task 2: Publish it through GeoServer

**Files:**
- Modify: `apps/api/src/geoserver/publish.ts`

**Interfaces:**
- Consumes: `water.rivers_overview` from Task 1.
- Produces: WFS layer `webatlas:rivers_overview`.

**Note on the naming convention:** `ensureLayer(table)` publishes `nativeName` as `${table}_active`. The overview is already a concrete relation with no `_active` twin, so it needs a publish path that uses its own name. Read `ensureLayer` before editing — do not simply add `rivers_overview` to `TABLES` or GeoServer will look for `rivers_overview_active` and the publish will fail with a confusing 500.

- [x] **Step 1: Write the failing test**

Append to `apps/api/src/geoserver/publish.test.ts`:

```ts
it('publishes the river overview under its own name, not a _active twin', () => {
  // ensureLayer maps table -> nativeName `${table}_active`, which is right for the
  // versioned layers and wrong for this one: rivers_overview IS the relation.
  expect(nativeNameFor('rivers_overview')).toBe('rivers_overview');
  expect(nativeNameFor('rivers')).toBe('rivers_active');
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- publish`
Expected: FAIL — `nativeNameFor` is not exported.

- [x] **Step 3: Extract and use the mapping**

In `apps/api/src/geoserver/publish.ts`, add and export:

```ts
/** Các lớp có phiên bản được phục vụ qua view `_active`; lớp dẫn xuất thì không.
 *  Tách ra thành hàm riêng để kiểm thử được, vì gọi nhầm sẽ khiến GeoServer đi
 *  tìm `rivers_overview_active` và trả lỗi 500 khó lần. */
export const DERIVED_TABLES = new Set(['rivers_overview']);

export function nativeNameFor(table: string): string {
  return DERIVED_TABLES.has(table) ? table : `${table}_active`;
}
```

Replace both uses of `` `${table}_active` `` inside `ensureLayer` with `nativeNameFor(table)`, and add `'rivers_overview'` to `TABLES`.

- [x] **Step 4: Verify**

```bash
npm run test -w @webatlas/api -- publish
npm run publish:geoserver -w @webatlas/api
curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:rivers_overview&outputFormat=application/json&count=1" | head -c 200
```
Expected: tests pass; the curl returns a GeoJSON FeatureCollection, not an exception.

- [x] **Step 5: Measure the payload, which is the whole point**

Run:
```bash
curl -s -o /dev/null -w "overview: %{time_total}s %{size_download} bytes\n" \
  "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:rivers_overview&outputFormat=application/json"
```
Expected: well under 500 kB and under 1s, against 5,1 MB / 3,6s for the unsimplified bucket 3. **If it is not, stop** — the simplification is not reaching the wire and the rest of the plan is pointless.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/geoserver/publish.ts apps/api/src/geoserver/publish.test.ts
git commit -m "feat(api): xuất bản lớp sông tổng quan qua WFS"
```

---

### Task 3: Keep the snapshot fresh

**Files:**
- Create: `apps/api/src/db/riverOverview.ts`
- Modify: `apps/api/src/db/seeds/ingestRivers.ts`
- Modify: the version-activation path (find with `grep -rn "is_active" apps/api/src/modules/versions/`)

**Interfaces:**
- Produces: `refreshRiverOverview(pool: Pool): Promise<void>`

- [x] **Step 1: Write the failing test**

Append to `apps/api/src/db/riverOverview.test.ts`:

```ts
import { refreshRiverOverview } from './riverOverview';

it('refreshes without locking readers', async () => {
  // CONCURRENTLY needs the unique index from the migration; if someone drops it
  // this throws rather than silently blocking every map request during a refresh.
  await expect(refreshRiverOverview(pool)).resolves.toBeUndefined();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- riverOverview`
Expected: FAIL — cannot resolve `./riverOverview`.

- [x] **Step 3: Write it**

Create `apps/api/src/db/riverOverview.ts`:

```ts
import type { Pool } from 'pg';

/**
 * Làm mới ảnh chụp sông tổng quan.
 *
 * PHẢI gọi ở HAI chỗ, vì rivers_active phụ thuộc phiên bản đang kích hoạt:
 *   1. sau khi nạp dữ liệu mới (ingest:rivers)
 *   2. sau khi kích hoạt một phiên bản khác
 * Quên chỗ nào thì bản đồ ở mức thu nhỏ vẫn vẽ mạng lưới cũ mà không báo gì.
 *
 * CONCURRENTLY để người đang xem bản đồ không bị khoá trong lúc làm mới; điều
 * kiện của nó là chỉ mục UNIQUE tạo trong migration 1000000000009.
 */
export async function refreshRiverOverview(pool: Pool): Promise<void> {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview');
}
```

- [x] **Step 4: Call it from both places**

In `apps/api/src/db/seeds/ingestRivers.ts`, after the ingest transaction commits:

```ts
await refreshRiverOverview(pool);
// eslint-disable-next-line no-console
console.log('refreshed water.rivers_overview');
```

Then find the activation path and add the same call after the `is_active` flip:

```bash
grep -rn "is_active" apps/api/src/modules/versions/
```

- [x] **Step 5: Verify the staleness test still passes end to end**

```bash
npm run ingest:rivers -w @webatlas/api
npm run test -w @webatlas/api -- riverOverview
```
Expected: the "same features as the active version" test passes after a real ingest.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/db/riverOverview.ts apps/api/src/db/riverOverview.test.ts apps/api/src/db/seeds/ingestRivers.ts apps/api/src/modules/versions
git commit -m "feat(api): làm mới ảnh chụp sông tổng quan sau ingest và sau khi đổi phiên bản"
```

---

### Task 4: The frontend layer and its mutual exclusion

**Files:**
- Create: `apps/web/src/features/map/model/riverOverview.ts`
- Create: `apps/web/src/features/map/model/riverOverview.test.ts`
- Modify: `apps/web/src/features/map/model/MapModel.ts`

**Interfaces:**
- Consumes: WFS layer `rivers_overview` from Task 2.
- Produces: `RIVER_OVERVIEW_MAX_ZOOM`, `riverOverviewVisibleAt(zoom): boolean`

- [x] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/riverOverview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { riverOverviewVisibleAt, RIVER_OVERVIEW_MAX_ZOOM } from './riverOverview';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';
import { MIN_ZOOM } from './zoomScale';

describe('riverOverviewVisibleAt', () => {
  it('hands over exactly where the full layer takes over', () => {
    // The two layers must never both draw: bucket 3 would render twice, at two
    // different simplifications, which reads as a doubled coastline.
    expect(RIVER_OVERVIEW_MAX_ZOOM).toBe(LAYER_DISPLAY.layer_rivers.minZoom);
  });

  it('is visible across the zoomed-out half, which had no rivers at all', () => {
    expect(riverOverviewVisibleAt(MIN_ZOOM)).toBe(true);
    expect(riverOverviewVisibleAt(7)).toBe(true);
    expect(riverOverviewVisibleAt(8.4)).toBe(true);
  });

  it('yields to the full layer at and above its gate', () => {
    expect(riverOverviewVisibleAt(8.5)).toBe(false);
    expect(riverOverviewVisibleAt(12)).toBe(false);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- riverOverview`
Expected: FAIL — cannot resolve `./riverOverview`.

- [x] **Step 3: Write it**

Create `apps/web/src/features/map/model/riverOverview.ts`:

```ts
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';

/**
 * Lớp sông tổng quan nhường chỗ ĐÚNG tại ngưỡng của lớp sông đầy đủ.
 *
 * Lấy thẳng từ LAYER_DISPLAY thay vì chép số 8,5: hai lớp mà chồng nhau dù chỉ
 * một chút thì bucket 3 bị vẽ hai lần ở hai mức đơn giản hoá khác nhau, trông
 * như đường bờ bị nhân đôi. Có ca kiểm thử giữ hai con số này bằng nhau.
 */
export const RIVER_OVERVIEW_MAX_ZOOM = LAYER_DISPLAY.layer_rivers.minZoom as number;

export function riverOverviewVisibleAt(zoom: number): boolean {
  return zoom < RIVER_OVERVIEW_MAX_ZOOM;
}
```

- [x] **Step 4: Add the layer in MapModel**

In `MapModel.ts`, beside `riversLayer`:

```ts
    // Sông tổng quan: chỉ sông chính, hình học đã đơn giản hoá sẵn, phục vụ đúng
    // phần dải tỷ lệ mà lớp sông đầy đủ chưa được phép tải.
    const riversOverviewLayer = new VectorLayer({
      source: createWfsVectorSource('rivers_overview'),
      style: riversStyle,
      properties: { id: 'layer_rivers_overview' },
    });
```

Add it to the layer array directly beneath `riversLayer`, and in the existing `moveend` visibility handler (`updateLayersVisibility`) set:

```ts
      riversOverviewLayer.setVisible(
        riverOverviewVisibleAt(zoom) && this.layerStates.find((l) => l.id === 'layer_rivers')?.visible !== false,
      );
```

so the overview follows the user's own **Mạng lưới sông ngòi** toggle rather than appearing as a second entry in the panel.

- [x] **Step 5: Verify**

```bash
npm run test -w @webatlas/web -- riverOverview
npm run test -w @webatlas/web
npm run build:web
```
Expected: all pass, build exits 0.

- [x] **Step 6: Check it in the browser**

Run the app; at 1:12.800.000 and 1:3.000.000 the main rivers must be visible. Then zoom past 1:1.570.934 and watch the handover: the network should gain detail, **not** visibly double up or flicker. A doubled shoreline at the boundary means the two layers overlap — check Step 3's constant.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/riverOverview.ts apps/web/src/features/map/model/riverOverview.test.ts apps/web/src/features/map/model/MapModel.ts
git commit -m "feat(web): sông chính hiện ở mức thu nhỏ qua lớp tổng quan"
```

---

## Risks

| Risk | Standing |
|---|---|
| Stale snapshot after a version is activated → far zoom shows a superseded network, silently | **The real risk.** Mitigated by refreshing in both paths (Task 3) and by the `EXCEPT` test that fails when they diverge |
| Both river layers draw at once → doubled geometry at two simplifications | Mitigated by deriving the handover from `LAYER_DISPLAY` and asserting the two constants are equal |
| 0,01° too coarse and a river visibly changes shape | Low: it is a third of a pixel at `MIN_SCALE`. One constant to change, in one migration |
| Simplification does not reach the wire | Task 2 Step 5 measures it and stops the plan if not |
| `REFRESH CONCURRENTLY` fails because the unique index was dropped | Surfaces as a thrown error in Task 3's test, not as a silent lock |

## Out of scope

- Buckets 0–2 at low zoom — `minRiverBucketAt` hides them above 1:1.000.000 regardless.
- Lakes, which share the `minZoom: 8.5` gate and have the same gap. Worth its own pass; the same technique applies.
- Any change to `minZoom: 8.5` itself.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-14-river-overview-layer.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute in this session with checkpoints.

---

## Execution notes (2026-09-14)

Four things differed from the plan as written:

1. **`rivers_active` has no `deleted` column** — the view already excludes deleted rows. The `AND NOT deleted` in the original draft would have failed.
2. **Simplification alone missed the payload bar.** 5,1 MB → 580 kB, against a target of under 500 kB. The remaining weight was not geometry: bucket 3 averages **2,6 vertices per feature** because OSM splits rivers into short segments, so per-feature JSON overhead (~336 B) dominated. Merging by name took 1.723 features → 279 and the payload to **146 kB / 0,35s**. The trade is losing per-segment ids, which is acceptable for a display-only layer and is recorded in the migration.
3. **There is no production activation path to hook.** `versionsRepository` only reads `is_active`; versions are activated by hand in SQL. So `refreshRiverOverview` is called from ingest only, and the requirement for manual activation is documented in the function itself. The name-based staleness test is the backstop.
4. **GeoServer caches a published relation's schema.** After the columns changed, WFS failed with `column "id" does not exist` — `ensureLayer` returns early when the layer exists and never re-reads columns. The featuretype must be deleted and re-published. Worth knowing for any future change to a published relation's shape.

Also fixed, because the change caused it: the layers panel claimed **"hiện từ mức 8,5"** for rivers while the overview was plainly drawing them. `layer_rivers` is now exempt from the gate hint, and the pre-existing gating test was repointed to `layer_lakes`, which really does disappear.

**Still gated and still blank when zoomed out: `layer_lakes`.** It shares the same `minZoom: 8.5` and the same technique would fix it. Out of scope here, noted for a follow-up.
