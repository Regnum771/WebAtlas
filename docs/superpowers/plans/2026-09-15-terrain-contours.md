# Terrain Contours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Đường đồng mức** toggle in Quản lý dữ liệu that draws contour lines over street, satellite and dem alike, with interval and label sub-options.

**Architecture:** Contours are precomputed from `basemap.dem_region` into one `basemap.contours` table, bucketed by interval, and published as GWC-cached WMS tile layers — one per interval, two styles each (labelled / not). The browser draws a single `TileLayer` whose source is swapped when the interval or label setting changes. Raster tiles rather than WFS because contours cover every square kilometre: measured, the region holds ~1.8M vertices at 100 m and a zoomed-out viewport would ask for all of them at once.

**Tech Stack:** PostGIS (`ST_Contour`, `ST_SimplifyPreserveTopology`), node-pg-migrate, tsx, GeoServer WMS + SLD + GWC, OpenLayers `TileLayer`/`XYZ`, React, Vitest.

## Global Constraints

- **The DEM must be loaded first.** Everything here reads `basemap.dem_region`; on a box that has not run [the elevation runbook](../../runbooks/elevation-dem.md) the generator has nothing to contour.
- **Source is FABDEM V1-2 (bare earth), CC BY-NC-SA, non-commercial.** Contours inherit that licence and the attribution: *FABDEM is produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018.*
- **Ship 250 / 100 / 50 m.** The 20 m bucket is ~445,000 features and ~230 MB; decide it after seeing 50 m on screen.
- **UI strings and commit messages in Vietnamese**, matching the surrounding code.
- **No new npm dependencies.**
- **Never hand-copy a layer id.** Read from the shared constants, the rule `map-commands.ts` states and that the terrain/dem and legend-colour incidents exist because of.
- **Changing a style or a layer group does not invalidate cached tiles.** Truncate GWC or you will keep seeing the old render.

---

## The problem, measured

Measured 2026-09-15 on the loaded FABDEM DEM (98,646 km², 106.7M valid pixels). Full detail in [the handover, §6.5](../specs/2026-09-14-spatial-analysis-tools-handover.md).

Contour density at 100 m, six 750 km² blocks — the spread is why one sample would have misled:

| Block | Features | Vertices | Vertices/km² |
|---|---|---|---|
| coast Quy Nhơn | 215 | 33,719 | 45 |
| mountain Chu Yang Sin | 295 | 30,093 | 40 |
| plateau Gia Lai | 229 | 43,360 | 58 |
| coast Khánh Hoà | 311 | 66,401 | 88 |
| highland Lâm Đồng | 544 | 91,934 | 122 |
| mountain Quảng Nam | 825 | 157,759 | 213 |

Region totals, simplified at 0.0002° (~22 m, sub-pixel) — **measured from the Task 2 run**, not estimated:

| Interval | Features | Distinct levels | Vertices |
|---|---|---|---|
| 50 m | 103,672 | 52 (0–2,550 m) | 3,376,103 |
| 100 m | 50,760 | 26 (0–2,500 m) | 1,664,414 |
| 250 m | 19,275 | 11 (0–2,500 m) | 632,337 |

The pre-build estimates read ~160k / ~73k / ~41k and were wrong by design error: extrapolated from the Copernicus surface model and never rescaled for bare earth, which removes 27% of features. 250 m is lower still because at a coarse interval the count follows how many levels the terrain crosses — only 11 here. Two checks confirm the data: zero off-grid elevations, and the 50 m bucket's index contours (every 250 m) number exactly 19,275, matching the 250 m bucket from an independent pass.

**Why not WFS.** Per viewport, vector delivery is fine close in (~24 kB at 1:150.000), heavy at 1:1.000.000 (~1.1 MB), and impossible zoomed out, where the viewport exceeds the region and the answer is the whole bucket. The full river network was 17.6 MB and was judged too heavy below zoom 8.5; the *coarsest* contour bucket is larger than that. Tiles are the only thing that behaves across the range, and contours have no attributes worth clicking.

**Timing.** One 1° cell contours in 28 s, so a full pass is ~9 min per interval, ~30 min for three. Developer-run, like the DEM load.

**Two traps.** Contours must be generated from a **unioned block** — per-128×128-storage-tile contouring chops every line into fragments at the seams. And a 3×3 focal mean before contouring removes 32% of features (on the old surface model it was 43%); bare earth already did most of that work, so smoothing is a tuning knob here, not a prerequisite.

---

### Task 1: The contours table

**Files:**
- Create: `apps/api/src/db/migrations/1000000000011_contours.cjs`
- Create: `apps/api/src/db/contours.test.ts`

**Interfaces:**
- Produces: `basemap.contours` with columns `id`, `interval_m`, `elevation_m`, `is_index`, `geom`; GiST index `contours_geom_idx`; btree `contours_interval_idx`. Also `basemap.dataset_sources`.

**Why `dataset_sources` rides along here.** `basemap` now holds 664 MB from three sources
under three different licences — OSM/ODbL (roads, water, landuse, places), FABDEM/CC BY-NC-SA
(`dem_region`), and derived contours — and **nothing in the database records which is which**.
The DEM was swapped from Copernicus to FABDEM on 2026-09-15 and the database carries no trace
of it. That is a licence-compliance gap, not untidiness: a non-commercial dataset sits beside
ODbL ones and only a runbook says so. One table plus a few inserts is cheap now and
unbackfillable once nobody remembers which load produced what.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/contours.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from './pool';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

describe('basemap.contours', () => {
  it('exists with the columns the generator and the styles both rely on', async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'basemap' AND table_name = 'contours'
        ORDER BY column_name`
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(Object.keys(cols).sort()).toEqual(['elevation_m', 'geom', 'id', 'interval_m', 'is_index']);
    expect(cols.interval_m).toBe('integer');
    expect(cols.is_index).toBe('boolean');
  });

  it('records where each reference dataset came from, and under what licence', async () => {
    // basemap mixes ODbL (OSM) with CC BY-NC-SA (FABDEM). Without this the only record of
    // which is which is a runbook, and the DEM has already been swapped once with no trace.
    const { rows } = await pool.query<{ name: string; licence: string }>(
      `SELECT name, licence FROM basemap.dataset_sources ORDER BY name`
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.licence]));
    expect(byName['dem_region']).toMatch(/CC BY-NC-SA/);
  });

  it('is indexed on geometry AND on interval', async () => {
    // Every tile request filters `interval_m = N` and then a bbox. Missing either index
    // turns each tile into a scan of the whole bucket, and there are three buckets.
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'basemap' AND tablename = 'contours'`
    );
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/USING gist \(geom\)/i);
    expect(defs).toMatch(/\(interval_m\)/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- contours`
Expected: FAIL — the column list comes back empty because the table does not exist.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000011_contours.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Đường đồng mức, dẫn xuất từ basemap.dem_region.
 *
 * Vì sao là BẢNG chứ không phải view: ST_Contour trên một ô 1 độ mất 28 giây, mà lớp này
 * được phục vụ theo từng tile. Tính lại mỗi lần vẽ là không tưởng.
 *
 * Vì sao nằm ở `basemap`: đây là dữ liệu tham chiếu, không có phiên bản, không sửa tay —
 * giống dem_region, khác hẳn các lớp chuyên đề trong `water`.
 *
 * Bảng rỗng sau khi migrate. Dữ liệu do `npm run contours:generate -w @webatlas/api` sinh
 * ra, và cần DEM đã nạp trước (xem docs/runbooks/elevation-dem.md).
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS basemap');
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS basemap.contours (
      id          bigserial PRIMARY KEY,
      interval_m  integer NOT NULL,
      elevation_m real    NOT NULL,
      -- Đường cái: cứ 5 đường thì 1, vẽ đậm hơn và là đường duy nhất được ghi nhãn.
      -- Tính sẵn ở đây chứ không tính trong SLD: biểu thức modulo trong bộ lọc SLD
      -- chạy lại cho từng đối tượng ở mỗi tile.
      is_index    boolean NOT NULL,
      geom        geometry(MultiLineString, 4326) NOT NULL
    )
  `);
  // Xuất xứ dữ liệu tham chiếu. water.* có app.dataset_versions; basemap.* trước nay
  // không có gì — không nguồn, không giấy phép, không ngày nạp. Với FABDEM (phi thương
  // mại) nằm cạnh dữ liệu OSM (ODbL) trong cùng một schema, đây là vấn đề tuân thủ giấy
  // phép chứ không phải chuyện gọn gàng.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS basemap.dataset_sources (
      name       text PRIMARY KEY,
      source     text NOT NULL,
      licence    text NOT NULL,
      url        text,
      script     text,
      loaded_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    INSERT INTO basemap.dataset_sources (name, source, licence, url, script) VALUES
      ('dem_region', 'FABDEM V1-2 (Copernicus GLO-30, bare earth)', 'CC BY-NC-SA 4.0 (phi thương mại)',
       'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn', 'scripts/prep_dem.py + scripts/load-dem.sh'),
      ('contours', 'Dẫn xuất từ basemap.dem_region', 'CC BY-NC-SA 4.0 (kế thừa từ FABDEM)',
       NULL, 'src/scripts/generateContours.ts')
    ON CONFLICT (name) DO UPDATE
       SET source = EXCLUDED.source, licence = EXCLUDED.licence,
           url = EXCLUDED.url, script = EXCLUDED.script, loaded_at = now()
  `);

  pgm.sql('CREATE INDEX IF NOT EXISTS contours_geom_idx ON basemap.contours USING GIST (geom)');
  // Mỗi yêu cầu tile đều lọc theo interval_m trước rồi mới tới bbox.
  pgm.sql('CREATE INDEX IF NOT EXISTS contours_interval_idx ON basemap.contours (interval_m)');
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS basemap.contours');
  // dataset_sources được giữ lại: nó mô tả cả dem_region, vốn không thuộc migration này.
  pgm.sql("DELETE FROM basemap.dataset_sources WHERE name = 'contours'");
};
```

- [ ] **Step 4: Apply and verify**

```bash
npm run migrate:up -w @webatlas/api
npm run test -w @webatlas/api -- contours
```
Expected: migration reports complete; both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/1000000000011_contours.cjs apps/api/src/db/contours.test.ts
git commit -m "feat(api): bảng đường đồng mức"
```

---

### Task 2: Generate the contours

**Files:**
- Create: `packages/shared/src/contours.ts`
- Modify: `packages/shared/src/index.ts` (re-export it)
- Create: `apps/api/src/scripts/generateContours.ts`
- Create: `apps/api/src/scripts/generateContours.test.ts`
- Modify: `apps/api/package.json` (add the `contours:generate` script)

**Interfaces:**
- Consumes: `basemap.dem_region` (Task 1's sibling, loaded by the elevation runbook), `basemap.contours` from Task 1.
- Produces: `CONTOUR_INTERVALS = [250, 100, 50]` **in `packages/shared`**, `cellsCovering(bounds)`, `isIndexContour(elevation, interval)`; a populated `basemap.contours`.

**Why the interval list lives in `packages/shared`:** the generator writes those buckets, the
publish script names layers after them, and the browser asks for them by name. Three copies of
`[250, 100, 50]` across two workspaces is the drift that produced the terrain/dem and
legend-colour incidents this repo still carries comments about.

- [ ] **Step 1: Put the interval list in `packages/shared`**

Create `packages/shared/src/contours.ts`:

```ts
/**
 * Các khoảng cao đều đã xuất bản, từ thô tới mịn.
 *
 * Dùng chung giữa ba nơi: script sinh dữ liệu ghi đúng các bucket này, script xuất bản đặt
 * tên lớp theo chúng, và trình duyệt yêu cầu lớp theo tên đó. Chép tay danh sách này lần
 * thứ hai là cách chắc chắn để hai bên lệch nhau.
 *
 * Chưa có 20 m: ~445.000 đối tượng, ~230 MB — quyết định sau khi nhìn thấy lớp 50 m trên
 * màn hình.
 */
export const CONTOUR_INTERVALS = [250, 100, 50] as const;
export type ContourInterval = (typeof CONTOUR_INTERVALS)[number];
```

Re-export it from `packages/shared/src/index.ts` alongside the other modules, then
`npm run build:shared` (the `dist` is git-tracked).

- [ ] **Step 2: Write the failing test for the pure helpers**

Create `apps/api/src/scripts/generateContours.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CONTOUR_INTERVALS } from '@webatlas/shared';
import { cellsCovering, isIndexContour } from './generateContours';

describe('cellsCovering', () => {
  it('returns whole-degree cells covering the bounds, inclusive of partial edges', () => {
    // The DEM extent is 107.20-109.46 E, 10.57-16.22 N: partial cells at every edge
    // must still be generated or the contours stop short of the region boundary.
    const cells = cellsCovering({ west: 107.2, south: 10.57, east: 109.46, north: 12.2 });
    expect(cells).toContainEqual({ lon: 107, lat: 10 });
    expect(cells).toContainEqual({ lon: 109, lat: 12 });
    expect(cells).toHaveLength(3 * 3);
  });
});

describe('isIndexContour', () => {
  it('marks every fifth contour, which is the one that gets a label', () => {
    expect(isIndexContour(500, 100)).toBe(true);
    expect(isIndexContour(400, 100)).toBe(false);
    expect(isIndexContour(1250, 250)).toBe(true);
  });

  it('is not fooled by floating point, because ST_Contour returns float elevations', () => {
    // 1500.0000001 is the same contour as 1500 as far as a reader is concerned.
    expect(isIndexContour(1500.0000001, 100)).toBe(true);
  });

  it('treats sea level as an index contour', () => {
    expect(isIndexContour(0, 50)).toBe(true);
  });
});

describe('CONTOUR_INTERVALS', () => {
  it('ships coarse-to-fine, and does not include 20 m yet', () => {
    // 20 m is ~445,000 features and ~230 MB region-wide: decided after 50 m is on screen.
    expect(CONTOUR_INTERVALS).toEqual([250, 100, 50]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- generateContours`
Expected: FAIL — cannot resolve `./generateContours`.

- [ ] **Step 4: Write the generator**

Create `apps/api/src/scripts/generateContours.ts`:

```ts
import { CONTOUR_INTERVALS } from '@webatlas/shared';
import { getPool, closePool } from '../db/pool';

/**
 * Sinh đường đồng mức từ basemap.dem_region vào basemap.contours.
 *
 * Chạy một lần bởi lập trình viên, KHÔNG chạy trong CI:
 *   npm run contours:generate -w @webatlas/api
 *
 * Cần DEM đã nạp trước (docs/runbooks/elevation-dem.md). Mất khoảng 30 phút cho cả ba
 * khoảng cao đều — 28 giây mỗi ô 1 độ mỗi khoảng, 19 ô.
 */

/** Dung sai đơn giản hoá: 0,0002 độ ~ 22 m, NHỎ HƠN một ô lưới DEM 30 m, nên hình dạng
 *  không đổi mà số đỉnh giảm 5,9 lần. */
const SIMPLIFY_TOLERANCE_DEG = 0.0002;

/** Phần đệm quanh mỗi ô khi cắt DEM. ST_Contour chạy trên từng ô rời nhau sẽ để lại khe
 *  hở tại đường ghép; cắt rộng ra rồi cắt đường trở lại đúng ranh ô thì hai bên gặp nhau.
 *  0,01 độ ~ 1,1 km, thừa sức so với bước lưới. */
const CELL_OVERLAP_DEG = 0.01;

export interface Cell {
  lon: number;
  lat: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Các ô 1 độ phủ hết bounds, kể cả ô chỉ bị cắt một phần ở rìa. */
export function cellsCovering(b: Bounds): Cell[] {
  const cells: Cell[] = [];
  for (let lat = Math.floor(b.south); lat < Math.ceil(b.north); lat++) {
    for (let lon = Math.floor(b.west); lon < Math.ceil(b.east); lon++) {
      cells.push({ lon, lat });
    }
  }
  return cells;
}

/**
 * Đường cái: cứ 5 đường thì 1. So sánh có sai số vì ST_Contour trả về số thực — dùng
 * modulo trực tiếp thì 1500,0000001 không còn là đường cái, dù người đọc thấy nó là 1500.
 */
export function isIndexContour(elevationM: number, intervalM: number): boolean {
  const step = intervalM * 5;
  const r = Math.abs(elevationM) % step;
  return r < 0.001 || step - r < 0.001;
}

async function main(): Promise<void> {
  const pool = getPool();
  const { rows: extent } = await pool.query<Bounds & { n: string }>(`
    SELECT count(*)::text AS n,
           ST_XMin(ST_Union(ST_ConvexHull(rast))) AS west,
           ST_YMin(ST_Union(ST_ConvexHull(rast))) AS south,
           ST_XMax(ST_Union(ST_ConvexHull(rast))) AS east,
           ST_YMax(ST_Union(ST_ConvexHull(rast))) AS north
      FROM basemap.dem_region
  `);
  if (Number(extent[0].n) === 0) {
    throw new Error(
      'basemap.dem_region rỗng — nạp DEM trước: xem docs/runbooks/elevation-dem.md'
    );
  }
  const cells = cellsCovering(extent[0]);
  console.log(`DEM: ${extent[0].n} tile, ${cells.length} ô 1 độ`);

  await pool.query('TRUNCATE basemap.contours');

  for (const intervalM of CONTOUR_INTERVALS) {
    const started = Date.now();
    let inserted = 0;
    for (const { lon, lat } of cells) {
      const { rowCount } = await pool.query(
        `WITH padded AS (
           SELECT ST_Union(rast) AS rast
             FROM basemap.dem_region
            -- Ép kiểu ::float8 là BẮT BUỘC: hai tham số không kiểu đứng cạnh nhau khiến
            -- Postgres từ chối với "operator is not unique: unknown - unknown".
            WHERE ST_Intersects(rast, ST_MakeEnvelope($1::float8 - $5::float8, $2::float8 - $5::float8,
                                                      $1::float8 + 1 + $5::float8, $2::float8 + 1 + $5::float8, 4326))
         ),
         lines AS (
           SELECT (ST_Contour(rast, 1, $3::float8)).*
             FROM padded WHERE rast IS NOT NULL
         ),
         clipped AS (
           -- Cắt trở lại ĐÚNG ô: phần đệm chỉ để hai ô cạnh nhau gặp nhau, giữ lại thì
           -- mỗi đường biên bị chèn hai lần.
           SELECT value AS elevation_m,
                  ST_Intersection(geom, ST_MakeEnvelope($1, $2, $1 + 1, $2 + 1, 4326)) AS geom
             FROM lines
         )
         INSERT INTO basemap.contours (interval_m, elevation_m, is_index, geom)
         SELECT $3, elevation_m,
                abs(mod(abs(elevation_m)::numeric, ($3 * 5)::numeric)) < 0.001
                  OR ($3 * 5) - abs(mod(abs(elevation_m)::numeric, ($3 * 5)::numeric)) < 0.001,
                ST_Multi(ST_SimplifyPreserveTopology(geom, $4))
           FROM clipped
          WHERE NOT ST_IsEmpty(geom) AND ST_GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString')`,
        [lon, lat, intervalM, SIMPLIFY_TOLERANCE_DEG, CELL_OVERLAP_DEG]
      );
      inserted += rowCount ?? 0;
      process.stdout.write(`\r  ${intervalM} m: ${inserted} đường`);
    }
    console.log(`\r  ${intervalM} m: ${inserted} đường (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  const { rows: summary } = await pool.query<{ interval_m: number; features: string; vertices: string }>(
    `SELECT interval_m, count(*)::text AS features, sum(ST_NPoints(geom))::text AS vertices
       FROM basemap.contours GROUP BY interval_m ORDER BY interval_m DESC`
  );
  console.table(summary);
  await closePool();
}

// Chỉ chạy khi gọi trực tiếp, để test import được các hàm thuần ở trên.
if (process.argv[1]?.includes('generateContours')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npm run test -w @webatlas/api -- generateContours`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the npm script**

In `apps/api/package.json`, alongside `"ingest:rivers"`:

```json
"contours:generate": "tsx src/scripts/generateContours.ts",
```

- [ ] **Step 7: Generate, and check the numbers against the estimate**

```bash
npm run contours:generate -w @webatlas/api
```
Expected: roughly 30 minutes, ending in a table close to the measured estimates — ~41,000 features at 250 m, ~73,000 at 100 m, ~160,000 at 50 m, within about 2×.

**If a bucket is wildly off, stop and find out why before publishing.** Ten times too many features usually means the overlap clip did not apply and every cell boundary is duplicated; far too few means the DEM did not load for those cells.

- [ ] **Step 8: Verify the seams actually joined**

```bash
docker compose -f infra/docker-compose.yml exec -T db psql -U webatlas -d webatlas -c "
SELECT count(*) AS lines_touching_a_cell_edge
  FROM basemap.contours
 WHERE interval_m = 100
   AND ST_Intersects(geom, ST_SetSRID(ST_MakeLine(ST_MakePoint(108,10.5), ST_MakePoint(108,16.3)), 4326));"
```
Expected: a non-zero count. Zero means contours stop dead at longitude 108 — the overlap is not working and the map will show a visible vertical gap.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src packages/shared/dist apps/api/src/scripts apps/api/package.json
git commit -m "feat(api): sinh đường đồng mức từ DEM"
```

---

### Task 3: Publish through GeoServer

**Files:**
- Create: `apps/api/scripts/contours/styles.py`
- Create: `apps/api/scripts/contours/publish-contours.sh`

**Interfaces:**
- Consumes: `basemap.contours` from Task 2.
- Produces: GWC layers `webatlas:contours_250`, `webatlas:contours_100`, `webatlas:contours_50`, each with styles `contours_plain` and `contours_labelled`.

**Read first:** `apps/api/scripts/basemap/publish-basemap.sh` and `styles.py`. This task copies their shape — SLD upload, then feature-type publish, then GWC truncate, in that order. Styles before publish, or the layer references a style that does not exist yet.

- [ ] **Step 1: Write the SLD generator**

Create `apps/api/scripts/contours/styles.py`. One SLD pair per interval; `interval_m` is filtered server-side so each published layer shows only its own bucket:

```python
#!/usr/bin/env python3
"""Generate and upload the contour SLDs. Companion to publish-contours.sh.

Two styles per interval: plain, and labelled. Labels are a separate STYLE rather than a
toggle inside one style because GWC caches per style - a labelled and an unlabelled tile
are two cache entries, and switching is then free at the client.

Colour is chosen per basemap by the client (it requests a different style), so these are
neutral browns that read on both street and satellite.

Usage: python styles.py <geoserver-admin-password>
"""
import sys
import requests

GS = "http://localhost:8080/geoserver/rest"
WS = "webatlas"
INTERVALS = [250, 100, 50]

PLAIN = """<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0">
 <NamedLayer><Name>contours_plain</Name><UserStyle><FeatureTypeStyle>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>false</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#9C7A4F</CssParameter>
     <CssParameter name="stroke-width">0.5</CssParameter>
     <CssParameter name="stroke-opacity">0.7</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#8A6534</CssParameter>
     <CssParameter name="stroke-width">1.1</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>
"""

# Nhan CHI tren duong cai: ghi nhan moi duong thi ban do thanh mot bai chu.
LABELLED = PLAIN.replace("<Name>contours_plain</Name>", "<Name>contours_labelled</Name>").replace(
    "</FeatureTypeStyle></UserStyle></NamedLayer>",
    """<Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <TextSymbolizer>
    <Label><PropertyName>elevation_m</PropertyName></Label>
    <Font><CssParameter name="font-size">10</CssParameter></Font>
    <LabelPlacement><LinePlacement/></LabelPlacement>
    <Fill><CssParameter name="fill">#6B4E26</CssParameter></Fill>
    <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo>
    <VendorOption name="group">yes</VendorOption>
    <VendorOption name="followLine">true</VendorOption>
    <VendorOption name="repeat">300</VendorOption>
    <VendorOption name="maxDisplacement">50</VendorOption>
   </TextSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>""",
)


def upload(name: str, body: str, pw: str) -> None:
    auth = ("admin", pw)
    r = requests.post(
        f"{GS}/workspaces/{WS}/styles",
        params={"name": name},
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/vnd.ogc.sld+xml"},
        auth=auth,
    )
    if r.status_code == 409:  # already there: replace it
        r = requests.put(
            f"{GS}/workspaces/{WS}/styles/{name}",
            data=body.encode("utf-8"),
            headers={"Content-Type": "application/vnd.ogc.sld+xml"},
            auth=auth,
        )
    print(f"  {name}: {r.status_code}")
    r.raise_for_status()


if __name__ == "__main__":
    password = sys.argv[1]
    upload("contours_plain", PLAIN, password)
    upload("contours_labelled", LABELLED, password)
```

- [ ] **Step 2: Upload the styles**

```bash
pip install requests   # already present if you ran the basemap loader
python apps/api/scripts/contours/styles.py "$GEOSERVER_ADMIN_PASSWORD"
```
Expected: two lines ending `201` (or `200` on re-run).

- [ ] **Step 3: Write the publish script**

Create `apps/api/scripts/contours/publish-contours.sh`. One SQL-view feature type per interval, so GeoServer filters the bucket rather than the client:

```bash
#!/usr/bin/env bash
# Publish one feature type per contour interval, each a SQL view over basemap.contours
# filtered to its own interval_m, then truncate the tile cache.
#
# Run after `npm run contours:generate -w @webatlas/api`. Styles first: styles.py.
set -euo pipefail

GS="${GEOSERVER_URL:-http://localhost:8080/geoserver}/rest"
WS=webatlas
STORE="${CONTOUR_STORE:-webatlas-postgis}"
AUTH="admin:${GEOSERVER_ADMIN_PASSWORD:?set GEOSERVER_ADMIN_PASSWORD}"

for INTERVAL in 250 100 50; do
  NAME="contours_${INTERVAL}"
  echo "== ${NAME}"
  # A SQL view, not the whole table: each published layer serves one bucket, so the
  # client never has to pass a filter and GWC can cache the result.
  BODY=$(cat <<XML
<featureType>
  <name>${NAME}</name>
  <nativeName>${NAME}</nativeName>
  <srs>EPSG:4326</srs>
  <metadata>
    <entry key="JDBC_VIRTUAL_TABLE">
      <virtualTable>
        <name>${NAME}</name>
        <sql>SELECT id, elevation_m, is_index, geom FROM basemap.contours WHERE interval_m = ${INTERVAL}</sql>
        <keyColumn>id</keyColumn>
        <geometry>
          <name>geom</name>
          <type>MultiLineString</type>
          <srid>4326</srid>
        </geometry>
      </virtualTable>
    </entry>
  </metadata>
</featureType>
XML
)
  code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPOST -H "Content-Type: text/xml" \
    "$GS/workspaces/$WS/datastores/$STORE/featuretypes" -d "$BODY" || true)
  if [ "$code" = "500" ] || [ "$code" = "409" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -XPUT -H "Content-Type: text/xml" \
      "$GS/workspaces/$WS/datastores/$STORE/featuretypes/$NAME" -d "$BODY")
  fi
  echo "   featuretype: $code"

  # Default style plain; labelled offered as an alternate so GWC caches both.
  curl -s -o /dev/null -w "   style: %{http_code}\n" -u "$AUTH" -XPUT -H "Content-Type: text/xml" \
    "$GS/layers/$WS:$NAME" -d \
    "<layer><defaultStyle><name>contours_plain</name></defaultStyle>
       <styles><style><name>contours_labelled</name></style></styles></layer>"

  curl -s -o /dev/null -w "   truncate: %{http_code}\n" -u "$AUTH" -XPOST -H "Content-Type: text/xml" \
    --data "<truncateLayer><layerName>$WS:$NAME</layerName></truncateLayer>" \
    "${GEOSERVER_URL:-http://localhost:8080/geoserver}/gwc/rest/masstruncate"
done
echo "Done."
```

- [ ] **Step 4: Find the datastore name, then publish**

```bash
curl -s -u "admin:$GEOSERVER_ADMIN_PASSWORD" \
  "http://localhost:8080/geoserver/rest/workspaces/webatlas/datastores.json" | head -c 400
```
Take the PostGIS store name from that listing and pass it if it is not `webatlas-postgis`:

```bash
CONTOUR_STORE=<name> GEOSERVER_ADMIN_PASSWORD=... bash apps/api/scripts/contours/publish-contours.sh
```
Expected: `featuretype: 201`, `style: 200`, `truncate: 200` for each of the three.

- [ ] **Step 5: Prove a tile renders, in both styles**

```bash
for STYLE in contours_plain contours_labelled; do
  curl -s -o "/tmp/$STYLE.png" -w "$STYLE %{http_code} %{size_download} bytes\n" \
    "http://localhost:8080/geoserver/webatlas/wms?service=WMS&version=1.1.1&request=GetMap\
&layers=webatlas:contours_100&styles=$STYLE&srs=EPSG:4326&format=image/png&transparent=true\
&bbox=108.3,12.3,108.5,12.5&width=512&height=512"
done
```
Expected: both `200` with a few kB of PNG, not 200 with ~100 bytes (an empty tile). Open them — `contours_labelled` must show elevation numbers along the heavier lines. **If the labelled tile is identical to the plain one**, the alternate style did not attach; re-check Step 3's layer PUT.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/contours/
git commit -m "feat(api): xuất bản lớp đường đồng mức qua GeoServer"
```

---

### Task 4: The shared contract and the panel row

**Files:**
- Modify: `packages/shared/src/map-commands.ts`
- Modify: `packages/shared/src/map-commands.test.ts`
- Modify: `apps/web/src/entities/layer/layerDisplay.ts`
- Modify: `apps/web/src/entities/layer/layerDisplay.test.ts`

**Interfaces:**
- Produces: `TERRAIN_LAYER_STATE_IDS = ['layer_contours']`, included in `LAYER_STATE_IDS`; a `LAYER_DISPLAY` entry under group `Địa hình`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/map-commands.test.ts`:

```ts
it('accepts the contour layer as a command target, so the assistant can toggle it', () => {
  expect(isMapCommand({ kind: 'setLayerVisible', layerStateId: 'layer_contours', visible: true })).toBe(true);
  expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'layer_contours', opacity: 0.4 })).toBe(true);
});
```

Append to `apps/web/src/entities/layer/layerDisplay.test.ts`:

```ts
it('puts contours in their own terrain group, read from the shared constant', () => {
  const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
  expect(LAYER_DISPLAY[CONTOURS]).toMatchObject({ group: 'Địa hình', defaultVisible: false });
});
```

Add `TERRAIN_LAYER_STATE_IDS` to that file's import from `@webatlas/shared`.

- [ ] **Step 2: Run them to verify they fail**

```bash
npm run test:shared
npm run test:web -- layerDisplay
```
Expected: shared FAILs (`layer_contours` is not a known id); web FAILs (`TERRAIN_LAYER_STATE_IDS` is not exported).

- [ ] **Step 3: Extend the shared contract**

In `packages/shared/src/map-commands.ts`, after `BASEMAP_CONTEXT_LAYER_STATE_IDS`:

```ts
/**
 * Lớp địa hình dẫn xuất từ DEM. Tách khỏi BASEMAP_CONTEXT_* vì đây không phải ngữ cảnh
 * nền OSM: nó sinh ra từ basemap.dem_region, và hàng xóm tương lai của nó là lớp đổ bóng
 * địa hình, không phải đường sá.
 *
 * Là mục tiêu lệnh hợp lệ, nên trợ lý bật/tắt được khi người dùng yêu cầu.
 */
export const TERRAIN_LAYER_STATE_IDS = ['layer_contours'] as const;
```

Add it to `LAYER_STATE_IDS`:

```ts
export const LAYER_STATE_IDS: readonly string[] = [
  ...Object.values(LAYER_ATTRIBUTE_MAP).map((info) => info.layerStateId),
  ...ADMIN_BOUNDARY_LAYER_STATE_IDS,
  ...BASEMAP_CONTEXT_LAYER_STATE_IDS,
  ...TERRAIN_LAYER_STATE_IDS,
];
```

- [ ] **Step 4: Add the display metadata**

In `apps/web/src/entities/layer/layerDisplay.ts`, import the constant next to the others and add:

```ts
const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
```

then the entry, above the admin boundaries:

```ts
  // Đường đồng mức dựng từ DEM (FABDEM, bare earth). Vẽ chồng lên CẢ BA nền — nền là một
  // lớp duy nhất đổi source, còn lớp này nằm trên nó như các lớp ngữ cảnh khác.
  // Mặc định TẮT: hữu ích khi cần, nhưng bật sẵn thì làm rối nền đường phố.
  [CONTOURS]: { name: 'Đường đồng mức', group: 'Địa hình', defaultVisible: false, opacity: 0.8 },
```

- [ ] **Step 5: Rebuild shared and verify**

`packages/shared/dist` is git-tracked; a stale `dist` makes the web build fail on an export that exists in source.

```bash
npm run build:shared
npm run test:shared
npm run test:web -- layerDisplay
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src packages/shared/dist apps/web/src/entities/layer
git commit -m "feat(shared): lớp đường đồng mức trong hợp đồng lớp bản đồ"
```

---

### Task 5: Draw it on the map

**Files:**
- Create: `apps/web/src/features/map/model/contours.ts`
- Create: `apps/web/src/features/map/model/contours.test.ts`
- Modify: `apps/web/src/features/map/model/MapModel.ts`

**Interfaces:**
- Consumes: `TERRAIN_LAYER_STATE_IDS` (Task 4), the published GWC layers (Task 3).
- Consumes: `CONTOUR_INTERVALS`, `ContourInterval` from `@webatlas/shared` (Task 2).
- Produces: `contourIntervalFor(zoom)`, `contourGwcLayer(intervalM)`, `contourStyle(labels)`, `ContourSettings`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/map/model/contours.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CONTOUR_INTERVALS } from '@webatlas/shared';
import { contourGwcLayer, contourIntervalFor, contourStyle } from './contours';

describe('contourIntervalFor', () => {
  it('is coarse when zoomed out and fine when zoomed in', () => {
    expect(contourIntervalFor(6)).toBe(250);
    expect(contourIntervalFor(9.5)).toBe(100);
    expect(contourIntervalFor(13)).toBe(50);
  });

  it('never returns an interval that was not published', () => {
    // A value outside CONTOUR_INTERVALS means a request for a GWC layer that does not
    // exist, which GeoServer answers with an exception image rather than an error.
    for (const z of [0, 5.47, 8.99, 9, 10.99, 11, 20]) {
      expect(CONTOUR_INTERVALS).toContain(contourIntervalFor(z));
    }
  });
});

describe('contourGwcLayer', () => {
  it('names the published layer for an interval', () => {
    expect(contourGwcLayer(100)).toBe('webatlas:contours_100');
  });
});

describe('contourStyle', () => {
  it('picks the labelled style only when labels are on', () => {
    expect(contourStyle(true)).toBe('webatlas:contours_labelled');
    expect(contourStyle(false)).toBe('webatlas:contours_plain');
  });

  it('qualifies the style with the workspace, which GWC WMTS requires', () => {
    // Measured against the live GeoServer: STYLE=contours_plain returns
    // 400 InvalidParameterValue; only STYLE=webatlas:contours_plain renders.
    // A bare name fails silently at the map — GeoServer answers with an exception
    // tile, not an error the browser surfaces.
    expect(contourStyle(false)).toMatch(/^webatlas:/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web -- contours`
Expected: FAIL — cannot resolve `./contours`.

- [ ] **Step 3: Write the module**

Create `apps/web/src/features/map/model/contours.ts`:

```ts
/**
 * Đường đồng mức: chọn khoảng cao đều theo mức thu phóng, và tên lớp/kiểu đã xuất bản.
 *
 * Giữ riêng khỏi MapModel để kiểm thử được mà không cần dựng bản đồ — cùng lý do
 * riverOverview.ts tồn tại.
 */

import type { ContourInterval } from '@webatlas/shared';

/**
 * Cài đặt của lớp đường đồng mức.
 *
 * CỐ Ý không nhét vào LayerState ({id, visible, opacity}): hình dạng đó là một phần hợp
 * đồng MapCommand, và một lớp đặc biệt thì không đáng để nới rộng nó. Kiểu này ở đây chứ
 * không ở trong component bảng điều khiển, để provider không phải import ngược từ UI.
 */
export interface ContourSettings {
  /** 'auto' theo mức thu phóng, hoặc một khoảng cố định người dùng chọn. */
  interval: 'auto' | ContourInterval;
  labels: boolean;
}

/**
 * Mức thu phóng -> khoảng cao đều, cho chế độ "Tự động".
 *
 * Ngưỡng theo tỷ lệ chứ không theo cảm tính: dưới zoom 9 (~1:1.100.000) đường 100 m đã dày
 * thành mảng nâu; từ zoom 11 (~1:270.000) đường 50 m mới đủ thưa để đọc.
 */
export function contourIntervalFor(zoom: number): ContourInterval {
  if (zoom < 9) return 250;
  if (zoom < 11) return 100;
  return 50;
}

export function contourGwcLayer(intervalM: ContourInterval | number): string {
  return `webatlas:contours_${intervalM}`;
}

/**
 * Tên kiểu PHẢI kèm workspace. GWC WMTS từ chối tên trần: `STYLE=contours_plain` trả về
 * 400 InvalidParameterValue, chỉ `STYLE=webatlas:contours_plain` mới vẽ được — đo trên
 * GeoServer thật. Sai ở đây thì bản đồ nhận ảnh báo lỗi chứ không có lỗi nào hiện ra.
 */
export function contourStyle(labels: boolean): string {
  return labels ? 'webatlas:contours_labelled' : 'webatlas:contours_plain';
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:web -- contours`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into MapModel**

Read `gwcSource()` (around `MapModel.ts:53`) first — it builds a WMTS URL and currently takes only a layer name. Give it an optional style:

```ts
function gwcSource(layer: string, style = ''): XYZ {
```

and add `&STYLE=${style}` to the URL it builds (WMTS requires the parameter; empty means the layer default).

Then add the contour layer. Next to `contextLayers`:

```ts
  private contourLayer: TileLayer<XYZ> | null = null;
  /** Khoảng đang hiển thị, để không đặt lại source khi không cần. */
  private contourInterval: ContourInterval | null = null;
  /** Người dùng chọn cứng một khoảng; null nghĩa là để mức thu phóng quyết định. */
  private contourFixedInterval: ContourInterval | null = null;
  private contourLabels = true;
```

Create it during `init`, **above** the context layers and below the boundaries, and add it to the `layers` array between `...CONTEXT_LAYERS.map(...)` and `provincesLayer`:

```ts
    const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
    this.contourLayer = new TileLayer({
      source: gwcSource(contourGwcLayer(250), contourStyle(this.contourLabels)),
      visible: false,
      properties: { id: CONTOURS },
    });
    this.layers[CONTOURS] = this.contourLayer;
```

In the `moveend` handler that already recomputes `riversOverviewLayer` visibility, swap the source when the auto interval changes:

```ts
        // Chỉ đổi source khi khoảng cao đều thật sự đổi: đặt lại source đồng nghĩa vứt bỏ
        // toàn bộ tile đã tải, nên gọi mỗi lần di chuyển bản đồ sẽ nháy liên tục.
        const wanted = contourIntervalFor(zoom);
        if (this.contourLayer && wanted !== this.contourInterval) {
          this.contourInterval = wanted;
          this.contourLayer.setSource(gwcSource(contourGwcLayer(wanted), contourStyle(this.contourLabels)));
        }
```

- [ ] **Step 6: Verify in the browser**

```bash
npm run dev:web
```
Turn **Đường đồng mức** on in Quản lý dữ liệu. Expected: brown contour lines over the street basemap; switch to satellite and to dem — the lines stay. Zoom across 9 and 11 and watch the density change.

**If the lines vanish on satellite**, the layer was added to the wrong position in the `layers` array — it must be above the basemap layer, not inside the basemap swap.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/map/model/
git commit -m "feat(web): vẽ lớp đường đồng mức chồng lên mọi nền bản đồ"
```

---

### Task 6: Interval and label sub-options

**Files:**
- Modify: `apps/web/src/features/layers-panel/ui/LayersPanel.view.tsx`
- Modify: `apps/web/src/features/layers-panel/ui/LayersPanel.view.test.tsx`
- Modify: `apps/web/src/app/providers/MapProvider.tsx`
- Modify: `apps/web/src/features/map/ui/MapView.tsx`
- Modify: `apps/web/src/features/map/model/MapModel.ts`

**Interfaces:**
- Consumes: `ContourSettings`, `contourIntervalFor`, `contourGwcLayer`, `contourStyle` from Task 5; `CONTOUR_INTERVALS` from `@webatlas/shared`.
- Produces: `contourSettings` and `setContourSettings` on the map context; `MapModel#setContourSettings(settings: ContourSettings)`.

**Design note:** these two settings deliberately do **not** go into `LayerState` (`{id, visible, opacity}`). That shape is part of the `MapCommand` contract; one special layer should not widen it. Opacity needs no work — the existing row slider already drives it.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/layers-panel/ui/LayersPanel.view.test.tsx`:

```tsx
it('offers interval and label options only for the contour row, and only when it is on', () => {
  const groups = [{
    name: 'Địa hình',
    layers: [{ id: 'layer_contours', name: 'Đường đồng mức', visible: true, opacity: 0.8, gated: false }],
  }];
  render(
    <LayersPanelView
      groups={groups}
      missingDisplay={[]}
      onToggle={vi.fn()}
      onOpacity={vi.fn()}
      contourSettings={{ interval: 'auto', labels: true }}
      onContourSettings={vi.fn()}
    />
  );
  expect(screen.getByLabelText('Khoảng cao đều')).toBeInTheDocument();
  expect(screen.getByLabelText('Nhãn độ cao')).toBeInTheDocument();
});

it('hides those options when the contour layer is off, so the panel stays quiet', () => {
  const groups = [{
    name: 'Địa hình',
    layers: [{ id: 'layer_contours', name: 'Đường đồng mức', visible: false, opacity: 0.8, gated: false }],
  }];
  render(
    <LayersPanelView
      groups={groups}
      missingDisplay={[]}
      onToggle={vi.fn()}
      onOpacity={vi.fn()}
      contourSettings={{ interval: 'auto', labels: true }}
      onContourSettings={vi.fn()}
    />
  );
  expect(screen.queryByLabelText('Khoảng cao đều')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web -- LayersPanel`
Expected: FAIL — the component does not accept `contourSettings`.

- [ ] **Step 3: Render the sub-options**

In `LayersPanel.view.tsx`, extend `Props`:

```tsx
import type { ContourSettings } from '../../map/model/contours';

interface Props {
  // ...existing...
  contourSettings: ContourSettings;
  onContourSettings: (next: ContourSettings) => void;
}
```

and render, immediately after the opacity slider inside the row loop:

```tsx
              {layer.id === CONTOURS && layer.visible && (
                <div className="layer-suboptions">
                  <label>
                    <span>Khoảng cao đều</span>
                    <select
                      aria-label="Khoảng cao đều"
                      value={String(contourSettings.interval)}
                      onChange={(e) =>
                        onContourSettings({
                          ...contourSettings,
                          interval: e.target.value === 'auto' ? 'auto' : Number(e.target.value),
                        })
                      }
                    >
                      <option value="auto">Tự động theo mức thu phóng</option>
                      {CONTOUR_INTERVALS.map((m) => (
                        <option key={m} value={m}>{m} m</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Nhãn độ cao"
                      checked={contourSettings.labels}
                      onChange={(e) => onContourSettings({ ...contourSettings, labels: e.target.checked })}
                    />
                    <span>Nhãn độ cao</span>
                  </label>
                </div>
              )}
```

with, at the top of the file:

```tsx
import { CONTOUR_INTERVALS, TERRAIN_LAYER_STATE_IDS } from '@webatlas/shared';

const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
```

- [ ] **Step 4: Thread the state through**

In `MapProvider.tsx`, add alongside `basemap`:

```tsx
  const [contourSettings, setContourSettings] = useState<ContourSettings>({ interval: 'auto', labels: true });
```

and expose both on the context value. In `MapView.tsx`, apply them the way `basemap` is applied:

```tsx
  useEffect(() => { modelRef.current?.setContourSettings(contourSettings); }, [contourSettings]);
```

In `MapModel.ts`, add the method — a fixed interval overrides the zoom-driven one:

```ts
  setContourSettings(settings: ContourSettings): void {
    this.contourLabels = settings.labels;
    this.contourFixedInterval = settings.interval === 'auto' ? null : settings.interval;
    const zoom = this.map?.getView().getZoom() ?? 0;
    const wanted = this.contourFixedInterval ?? contourIntervalFor(zoom);
    this.contourInterval = wanted;
    this.contourLayer?.setSource(gwcSource(contourGwcLayer(wanted), contourStyle(settings.labels)));
  }
```

and make the `moveend` handler skip its swap when `this.contourFixedInterval !== null`.

- [ ] **Step 5: Style the sub-options**

In `apps/web/src/styles/main.css`, after `.layer-row`:

```css
/* Tuỳ chọn con: thụt vào để thấy rõ là thuộc về hàng bên trên, và chỉ hiện khi lớp bật. */
.layer-suboptions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-left: var(--space-4);
  font-size: 12px;
}
```

- [ ] **Step 6: Verify**

```bash
npm run test:web -- LayersPanel
npm run build:web
```
Expected: tests pass; build clean (`build:web` runs `tsc -b`, which vitest skips).

Then in the browser: switch the interval to 250 m while zoomed in — the lines must thin out immediately and stay coarse when you zoom. Turn labels off — the numbers disappear. Both should be instant on second use, because GWC has cached each combination.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): tuỳ chọn khoảng cao đều và nhãn cho lớp đường đồng mức"
```

---

### Task 7: Document it

**Files:**
- Create: `docs/runbooks/terrain-contours.md`
- Create: `docs/runbooks/README.md`
- Modify: `docs/superpowers/specs/2026-09-14-spatial-analysis-tools-handover.md` (§6.5 status)

**Why a runbooks README now.** As of the DEM load, a fresh clone no longer produces a working
app: ~1 GB of DEM and contours live outside git behind four runbooks that must run in a
particular order, and nothing states that order. Contours add the fourth. Ten minutes here
saves the next person an afternoon.

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/terrain-contours.md` covering, in this order: when to run it (contours missing or the DEM changed); the prerequisite that the DEM must be loaded first; `npm run contours:generate -w @webatlas/api` and its ~30 minute runtime; `styles.py` then `publish-contours.sh`, in that order and why; how to verify a tile in both styles; the measured feature counts per bucket so a future run can be compared; and the gotchas — **regenerating contours does not invalidate cached tiles** (truncate GWC), contours stop at the region boundary because the DEM does, and the 20 m bucket is deliberately not shipped.

Copy the licence block from [the elevation runbook](../../runbooks/elevation-dem.md): contours inherit FABDEM's CC BY-NC-SA terms and its attribution.

- [ ] **Step 2: Write the setup-order README**

Create `docs/runbooks/README.md`: a single ordered list from a fresh clone to a working app —
`docker compose up` → `npm run migrate:up` → `npm run seed` → `npm run ingest:rivers` →
self-hosted basemap → elevation DEM → terrain contours → `npm run publish:geoserver`, each
line linking its runbook and saying whether it is required or optional. Mark the DEM and
contour steps as **not in git** — the two datasets each machine must generate locally.

- [ ] **Step 3: Update the handover**

In §6.5, replace the planning language with what was built: the three published layers, the measured counts from Task 2 Step 6, and a pointer to the new runbook.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: sổ tay vận hành lớp đường đồng mức và thứ tự dựng môi trường"
```

---

## Deferred, deliberately

- **20 m bucket.** ~445,000 features, ~230 MB. Decide after 50 m has been on screen for a while.
- **Hillshade (`Đổ bóng địa hình`).** The natural sibling row in the same `Địa hình` group, from `ST_HillShade` on the same DEM. Together the pair is what would let the Esri hillshade basemap be dropped — which also removes the last third-party raster dependency, the one whose sibling (CARTO) already broke once.
- **Smoothing before contouring.** Worth 32% fewer features on bare earth. Tune it during the build if the 50 m bucket looks noisy in forest; it is no longer a prerequisite.
- **Line colour adapting to the basemap.** The design called for brown over street, white over
  satellite, grey over hillshade, chosen automatically. This plan ships one neutral brown pair
  that reads on both, because per-basemap colour means three style pairs instead of one and
  triples the tile cache before anyone has looked at the layer. Revisit once it is on screen:
  the client already picks a style per request, so it is an SLD addition plus one more argument
  to `contourStyle`, not a redesign.
- **Contours in the legend panel.** The legend is data-driven; a line-symbol entry needs its own work.
