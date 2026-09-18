# Phase 1 — Administrative Boundaries and Stamping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put province and ward polygons in the database, stamp every feature with the administrative units it intersects, and make "bao nhiêu đập trong tỉnh Đắk Lắk" an indexed query rather than an unanswerable question.

**Architecture:** A new `admin` schema holds boundaries, seeded from the GeoJSON already committed to the repo so a fresh clone works offline. Each thematic feature carries `province_codes text[]` / `ward_codes text[]` with GIN indexes, computed at ingest and recomputed when an edit session commits. Query surfaces are an HTTP filter, an assistant tool, and a boundary-extent endpoint that retires the hardcoded browser centroids.

**Tech Stack:** PostgreSQL 16 + PostGIS 3.4, node-pg-migrate (`.cjs`), Fastify + Zod, Vitest against the live dev database, React 19 + OpenLayers on the web side.

**Spec:** [docs/superpowers/specs/2026-09-18-entity-model-networks-and-roi-design.md](../specs/2026-09-18-entity-model-networks-and-roi-design.md) §3, §6.2–§6.4, §9.
**Architecture doc to update when done:** [docs/architecture/database-architecture.md](../../architecture/database-architecture.md) §3, §6.2, §6.3.

## Global Constraints

- Branch: `feat/entity-model-roi` (already checked out; the spec and architecture doc are committed there).
- Commit after each task. Vietnamese commit subjects (repo convention), with the `Co-Authored-By:` trailer the session's attribution reminder specifies.
- User-facing strings are Vietnamese.
- The Docker stack must be up: `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`. API tests hit the live database.
- Commands: `npm run migrate`, `npm run seed`, `npm run test -w @webatlas/api -- <path>`, `npm run test -w @webatlas/web -- <path>`, `npm run build:web`, `npm run build:shared`, `npm run test:shared`.
- **`packages/shared/dist` trap:** after editing `packages/shared/src`, run `npm run build:shared` and commit `dist`. A NEW `src/foo.ts` needs `git add -f packages/shared/dist/foo.js packages/shared/dist/foo.d.ts`; verify with `git status --ignored packages/shared/dist`.
- Migrations create structure; the pipeline populates it. Latest existing migration is `1000000000014_audit-source.cjs`, so this plan adds `…015` and `…016`.
- The layer key is the only value ever interpolated into SQL, and only after an `EDITABLE_LAYER_KEYS` allowlist check. Everything else is a bind parameter.
- Boundary geometry is simplified to ~11 m (`fetch-boundaries.mjs`: 0.0001° tolerance, 5-decimal rounding). Stamping near a border may attribute a feature to the neighbour. Say so in comments; do not pretend otherwise.
- Only `admin` writes features; `CAN_WRITE_FEATURES = ['admin']` is unchanged by this plan.
- Assistant tools import `z` from `'zod/v4'`, are appended to `FACTORIES` (never inserted), emit `ctx.provenance(...)` on every path, and start empty results with `Không có dữ liệu:`.

## File map

| File | Responsibility |
|---|---|
| `apps/api/src/db/migrations/1000000000015_admin-boundaries.cjs` | `admin` schema, `provinces`, `wards`, indexes |
| `apps/api/src/db/migrations/1000000000016_admin-stamping.cjs` | `province_codes` / `ward_codes` + GIN on the 8 water tables |
| `apps/api/src/db/seeds/adminBoundaries.ts` | Load both GeoJSON files into `admin.*` (idempotent) |
| `apps/api/src/db/seeds/adminBoundaries.test.ts` | Counts, validity, a known point in Đắk Lắk |
| `apps/api/src/db/adminStamp.ts` | `stampAdminCodes(client, layerKey, versionId)` |
| `apps/api/src/db/adminStamp.test.ts` | Stamping correctness, including a border case |
| `apps/api/src/db/seeds/run.ts` | Load boundaries first; stamp each layer after load |
| `apps/api/src/modules/layers/{repository,controller}.ts` | Active-version listing + `?province=`/`?ward=` filter |
| `apps/api/src/modules/admin-units/{routes,controller,repository}.ts` | `GET /api/admin-units` with extents |
| `apps/api/src/modules/assistant/tools/data/featuresInAdminUnit.ts` | Assistant tool |
| `apps/web/src/features/map/model/mapCommands.ts`, `provinceCentroids.ts` | Zoom to a province by real extent |
| `docs/architecture/database-architecture.md` | Flip §3/§6.2/§6.3 from Designed to Implemented |

---

### Task 1: `admin` schema and boundary tables

**Files:**
- Create: `apps/api/src/db/migrations/1000000000015_admin-boundaries.cjs`
- Test: `apps/api/src/db/schema.test.ts` (extend the existing file)

**Interfaces:**
- Produces: `admin.provinces(code PK, name, name_en, full_name, area_km2, geom MultiPolygon 4326)`; `admin.wards(code PK, province_code FK → provinces, name, name_en, full_name, area_km2, geom MultiPolygon 4326)`; GiST on both geometries; btree on `wards.province_code`.

- [ ] **Step 1: Read the existing schema test to match its style**

Run: `sed -n 1,40p apps/api/src/db/schema.test.ts`
It asserts tables and columns exist against the live database. Follow that shape.

- [ ] **Step 2: Write the failing test**

Append to `apps/api/src/db/schema.test.ts`:

```ts
describe('admin schema', () => {
  it('has provinces and wards with geometry and keys', async () => {
    const { rows } = await getPool().query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'admin' ORDER BY table_name, column_name`
    );
    const cols = (t: string) => rows.filter((r) => r.table_name === t).map((r) => r.column_name);
    expect(cols('provinces')).toEqual(['area_km2', 'code', 'full_name', 'geom', 'name', 'name_en']);
    expect(cols('wards')).toEqual(['area_km2', 'code', 'full_name', 'geom', 'name', 'name_en', 'province_code']);
  });

  it('indexes both boundary geometries for spatial lookup', async () => {
    const { rows } = await getPool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'admin'`
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('provinces_geom_index');
    expect(names).toContain('wards_geom_index');
    expect(names).toContain('wards_province_code_index');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: FAIL — `cols('provinces')` is `[]`, because the schema does not exist.

- [ ] **Step 4: Write the migration**

`apps/api/src/db/migrations/1000000000015_admin-boundaries.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Ranh giới hành chính (tỉnh, xã/phường) theo đơn vị sau sáp nhập 01/7/2025.
 *
 * Vì sao có schema riêng `admin`, không nhét vào `basemap`: đây là dữ liệu có thẩm quyền —
 * dùng để đóng dấu mã hành chính lên từng đối tượng và để trả lời "bao nhiêu đập ở Đắk Lắk".
 * `basemap` là dữ liệu tham chiếu nhập từ OSM, do script nạp, không ai coi là căn cứ.
 *
 * Không đánh phiên bản: ranh giới đổi rất hiếm, và khi đổi thì đi qua sổ đăng ký dữ liệu
 * (packages/atlas-data) chứ không sửa tay. Bảng rỗng sau khi migrate; `npm run seed` nạp
 * từ hai tệp GeoJSON đã commit trong apps/web/public (xem db/seeds/adminBoundaries.ts).
 *
 * ĐỘ CHÍNH XÁC: hình học đã được giản lược ~11 m (fetch-boundaries.mjs: dung sai 0,0001°,
 * làm tròn 5 chữ số). Đối tượng nằm sát ranh giới có thể bị gán sang đơn vị kế bên. Đủ dùng
 * để đếm và lọc; KHÔNG dùng cho mục đích pháp lý hay đo đạc theo ranh giới.
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS admin');

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS admin.provinces (
      code      text PRIMARY KEY,
      name      text NOT NULL,
      name_en   text,
      full_name text,
      area_km2  numeric,
      geom      geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  // ON DELETE RESTRICT: xoá một tỉnh khi còn xã tham chiếu tới là lỗi dữ liệu, không phải
  // thao tác hợp lệ — cùng quy ước với app.dataset_lineage_step.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS admin.wards (
      code          text PRIMARY KEY,
      province_code text NOT NULL REFERENCES admin.provinces(code) ON DELETE RESTRICT,
      name          text NOT NULL,
      name_en       text,
      full_name     text,
      area_km2      numeric,
      geom          geometry(MultiPolygon, 4326) NOT NULL
    )
  `);

  pgm.sql('CREATE INDEX IF NOT EXISTS provinces_geom_index ON admin.provinces USING gist (geom)');
  pgm.sql('CREATE INDEX IF NOT EXISTS wards_geom_index ON admin.wards USING gist (geom)');
  pgm.sql('CREATE INDEX IF NOT EXISTS wards_province_code_index ON admin.wards (province_code)');
};

exports.down = (pgm) => {
  pgm.sql('DROP SCHEMA IF EXISTS admin CASCADE');
};
```

- [ ] **Step 5: Apply and verify the test passes**

Run: `npm run migrate` then `npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: migration reports `1000000000015_admin-boundaries`; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/1000000000015_admin-boundaries.cjs apps/api/src/db/schema.test.ts
git commit -m "feat(api): lược đồ admin cho ranh giới tỉnh và xã

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Seed the boundaries from the committed GeoJSON

**Files:**
- Create: `apps/api/src/db/seeds/adminBoundaries.ts`
- Create: `apps/api/src/db/seeds/adminBoundaries.test.ts`
- Modify: `apps/api/src/db/seeds/run.ts`

**Interfaces:**
- Consumes: Task 1's tables.
- Produces: `loadAdminBoundaries(client: pg.PoolClient): Promise<{ provinces: number; wards: number }>` — deletes and reloads both tables inside the caller's transaction; `PROVINCES_FILE`, `WARDS_FILE` path constants.

Source properties (verified): provinces — `code`, `name`, `nameEn`, `fullName`, `areaKm2` (34 features, national); wards — the same plus `provinceCode` (616 features, working region only).

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/seeds/adminBoundaries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';
import { loadAdminBoundaries } from './adminBoundaries';

beforeAll(async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await loadAdminBoundaries(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
afterAll(async () => { await closePool(); });

describe('loadAdminBoundaries', () => {
  it('loads all 34 provinces and the 616 wards of the working region', async () => {
    const { rows } = await getPool().query<{ p: string; w: string }>(
      `SELECT (SELECT count(*) FROM admin.provinces)::text AS p,
              (SELECT count(*) FROM admin.wards)::text AS w`
    );
    expect(rows[0].p).toBe('34');
    expect(rows[0].w).toBe('616');
  });

  it('stores valid MultiPolygon geometry in EPSG:4326', async () => {
    const { rows } = await getPool().query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM admin.provinces
        WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326 OR GeometryType(geom) <> 'MULTIPOLYGON'`
    );
    expect(rows[0].bad).toBe('0');
  });

  it('places Buôn Ma Thuột inside Đắk Lắk (code 66)', async () => {
    const { rows } = await getPool().query<{ code: string }>(
      `SELECT code FROM admin.provinces
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326))`
    );
    expect(rows.map((r) => r.code)).toEqual(['66']);
  });

  it('every ward references a province that exists', async () => {
    const { rows } = await getPool().query<{ orphans: string }>(
      `SELECT count(*)::text AS orphans FROM admin.wards w
        LEFT JOIN admin.provinces p ON p.code = w.province_code WHERE p.code IS NULL`
    );
    expect(rows[0].orphans).toBe('0');
  });

  it('is idempotent — loading twice leaves the same counts', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const second = await loadAdminBoundaries(client);
      await client.query('COMMIT');
      expect(second).toEqual({ provinces: 34, wards: 616 });
    } finally {
      client.release();
    }
    const { rows } = await getPool().query<{ p: string }>(
      `SELECT count(*)::text AS p FROM admin.provinces`
    );
    expect(rows[0].p).toBe('34');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/seeds/adminBoundaries.test.ts`
Expected: FAIL — cannot resolve `./adminBoundaries`.

- [ ] **Step 3: Implement the loader**

`apps/api/src/db/seeds/adminBoundaries.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db/seeds -> repo root is five levels up (same derivation as registry.ts)
const repoRoot = resolve(here, '../../../../..');
const webPublic = resolve(repoRoot, 'apps/web/public');

/**
 * Nạp từ chính hai tệp trình duyệt đang dùng, đã commit trong repo: một bản sao mới clone
 * chạy được mà không cần mạng. Hệ quả đã biết: hình học giản lược ~11 m (xem migration
 * 1000000000015) nên đối tượng sát ranh giới có thể bị gán sang đơn vị kế bên.
 */
export const PROVINCES_FILE = resolve(webPublic, 'provinces-34.geojson');
export const WARDS_FILE = resolve(webPublic, 'wards-region.geojson');

interface Feature {
  geometry: unknown;
  properties: Record<string, unknown>;
}

function featuresOf(file: string): Feature[] {
  const fc = JSON.parse(readFileSync(file, 'utf8')) as { features: Feature[] };
  return fc.features;
}

/**
 * Thay toàn bộ nội dung hai bảng trong giao dịch của người gọi. Thay vì UPSERT: ranh giới
 * là một tập đóng — một đơn vị bị bỏ khỏi nguồn phải biến mất, chứ không nằm lại mãi mãi.
 * Xoá xã trước tỉnh vì khoá ngoại là ON DELETE RESTRICT.
 */
export async function loadAdminBoundaries(
  client: pg.PoolClient
): Promise<{ provinces: number; wards: number }> {
  await client.query('DELETE FROM admin.wards');
  await client.query('DELETE FROM admin.provinces');

  const provinces = featuresOf(PROVINCES_FILE);
  for (const f of provinces) {
    await client.query(
      `INSERT INTO admin.provinces (code, name, name_en, full_name, area_km2, geom)
       VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)))`,
      [
        String(f.properties.code),
        String(f.properties.name),
        f.properties.nameEn ?? null,
        f.properties.fullName ?? null,
        f.properties.areaKm2 ?? null,
        JSON.stringify(f.geometry),
      ]
    );
  }

  const wards = featuresOf(WARDS_FILE);
  for (const f of wards) {
    await client.query(
      `INSERT INTO admin.wards (code, province_code, name, name_en, full_name, area_km2, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)))`,
      [
        String(f.properties.code),
        String(f.properties.provinceCode),
        String(f.properties.name),
        f.properties.nameEn ?? null,
        f.properties.fullName ?? null,
        f.properties.areaKm2 ?? null,
        JSON.stringify(f.geometry),
      ]
    );
  }

  return { provinces: provinces.length, wards: wards.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/db/seeds/adminBoundaries.test.ts`
Expected: PASS (5 tests).

If the Buôn Ma Thuột assertion returns more than one province, the source file contains overlapping polygons — report that rather than relaxing the assertion; the whole stamping design assumes provinces do not overlap.

- [ ] **Step 5: Wire it into the seed run**

In `apps/api/src/db/seeds/run.ts`, add the import and load boundaries before the layer loop, in their own transaction:

```ts
import { loadAdminBoundaries } from './adminBoundaries';
```

Inside `runSeeds()`, immediately after `const result: Record<string, number> = {};`:

```ts
  // Ranh giới trước dữ liệu chuyên đề: bước đóng dấu mã hành chính (db/adminStamp.ts)
  // chạy ngay sau khi nạp từng lớp và cần hai bảng này đã có dữ liệu.
  await client.query('BEGIN');
  try {
    const admin = await loadAdminBoundaries(client);
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`seeded admin boundaries: ${admin.provinces} provinces, ${admin.wards} wards`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
```

- [ ] **Step 6: Run the seed end to end**

Run: `npm run seed`
Expected: first line reads `seeded admin boundaries: 34 provinces, 616 wards`, followed by the existing per-layer lines.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/seeds/adminBoundaries.ts apps/api/src/db/seeds/adminBoundaries.test.ts apps/api/src/db/seeds/run.ts
git commit -m "feat(api): nạp ranh giới tỉnh/xã từ GeoJSON đã commit trong repo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Stamping columns on the eight thematic layers

**Files:**
- Create: `apps/api/src/db/migrations/1000000000016_admin-stamping.cjs`
- Modify: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Produces: on each of `water.dams|rivers|lakes|stations|flood_zones|drought_points|saltwater_intrusion|flood_generation`: `province_codes text[] NOT NULL DEFAULT '{}'`, `ward_codes text[] NOT NULL DEFAULT '{}'`, each with a GIN index named `<table>_province_codes_index` / `<table>_ward_codes_index`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/db/schema.test.ts`:

```ts
describe('administrative stamping columns', () => {
  const LAYERS = ['dams', 'rivers', 'lakes', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation'];

  it('every thematic layer carries indexed province and ward code arrays', async () => {
    const { rows } = await getPool().query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'water' AND column_name IN ('province_codes', 'ward_codes')`
    );
    for (const layer of LAYERS) {
      const cols = rows.filter((r) => r.table_name === layer);
      expect(cols.map((c) => c.column_name).sort()).toEqual(['province_codes', 'ward_codes']);
      expect(cols.every((c) => c.data_type === 'ARRAY')).toBe(true);
    }

    const { rows: idx } = await getPool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'water'`
    );
    const names = idx.map((r) => r.indexname);
    for (const layer of LAYERS) {
      expect(names).toContain(`${layer}_province_codes_index`);
      expect(names).toContain(`${layer}_ward_codes_index`);
    }
  });

  it('defaults to an empty array rather than NULL', async () => {
    const { rows } = await getPool().query<{ nulls: string }>(
      `SELECT count(*)::text AS nulls FROM water.dams
        WHERE province_codes IS NULL OR ward_codes IS NULL`
    );
    expect(rows[0].nulls).toBe('0');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: FAIL — the columns do not exist.

- [ ] **Step 3: Write the migration**

`apps/api/src/db/migrations/1000000000016_admin-stamping.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

const LAYERS = [
  'dams', 'rivers', 'lakes', 'stations',
  'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation',
];

/**
 * Đóng dấu đơn vị hành chính lên từng đối tượng.
 *
 * MẢNG chứ không phải một mã: một con sông chảy qua nhiều tỉnh. Cột vô hướng không trả lời
 * được "những sông nào chảy qua Đắk Lắk" — mà đó chính là câu hỏi hay gặp nhất.
 *
 * Đây là phi chuẩn hoá có chủ ý. Quan hệ "đối tượng nằm trong tỉnh nào" là cố định; tính
 * lại bằng phép giao hình học ở mỗi lần hỏi là trả giá lặp đi lặp lại cho một sự thật không
 * đổi. Vùng bất kỳ do người dùng vẽ thì đi đường khác (ROI), không dùng cột này.
 *
 * Giá trị do db/adminStamp.ts tính: khi nạp dữ liệu, và khi một phiên biên tập được ghi.
 * Mặc định '{}' để không bao giờ phải phân biệt NULL với "không thuộc đơn vị nào".
 */
exports.up = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`
      ALTER TABLE water.${layer}
        ADD COLUMN IF NOT EXISTS province_codes text[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS ward_codes     text[] NOT NULL DEFAULT '{}'
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS ${layer}_province_codes_index ON water.${layer} USING gin (province_codes)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS ${layer}_ward_codes_index ON water.${layer} USING gin (ward_codes)`);
  }
};

exports.down = (pgm) => {
  for (const layer of LAYERS) {
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_province_codes_index`);
    pgm.sql(`DROP INDEX IF EXISTS water.${layer}_ward_codes_index`);
    pgm.sql(`ALTER TABLE water.${layer} DROP COLUMN IF EXISTS province_codes, DROP COLUMN IF EXISTS ward_codes`);
  }
};
```

- [ ] **Step 4: Apply and verify**

Run: `npm run migrate` then `npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Recreate the resolution views so they expose the new columns**

This step is mandatory, not a check. The `water.<layer>_active` views are defined with `SELECT *` (migration
`1000000000005`, `viewSql()`), and **PostgreSQL expands `*` at view-creation time** — a column added to the base table
afterwards never appears in the existing view. Without this step, every consumer that reads the resolution view (the
API filter in Task 7, the assistant tool in Task 9, GeoServer) would be unable to see the stamped codes, and the
failure would look like "stamping didn't run".

Add to the same migration, after the column loop, reusing the exact body from migration `1000000000005` — note that
`lakes` has its view from migration `1000000000006` and is included here too:

```js
function viewSql(layer) {
  return `
    CREATE OR REPLACE VIEW water.${layer}_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${layer}' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      -- Nearest version in the chain wins per external_id (lowest depth first).
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layer} t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    -- Tombstone check happens *after* DISTINCT ON picks the nearest row, so a
    -- tombstone in a nearer version suppresses an ancestor's stale row rather
    -- than letting it resurface.
    SELECT * FROM resolved WHERE NOT deleted;
  `;
}

// Cột mới nằm ở CUỐI bảng nên CREATE OR REPLACE hợp lệ (Postgres chỉ cho phép thêm cột vào
// cuối danh sách chiếu). Nếu Postgres từ chối, DROP VIEW rồi CREATE lại — nhưng khi đó phải
// publish lại GeoServer vì kiểu đối tượng bám theo view.
for (const layer of LAYERS) {
  pgm.sql(viewSql(layer));
}
```

Then verify:

Run: `docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='water' AND table_name='dams_active' AND column_name IN ('province_codes','ward_codes')"`
Expected: `2`. Repeat the check for `rivers_active` and `lakes_active`.

If `CREATE OR REPLACE VIEW` is refused (`cannot change name of view column`), fall back to `DROP VIEW … CASCADE` +
`CREATE VIEW` in the migration, and re-run `npm run publish:geoserver -w @webatlas/api` afterwards, noting it in your
report — GeoServer's published feature types are bound to those views.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/1000000000016_admin-stamping.cjs apps/api/src/db/schema.test.ts
git commit -m "feat(api): cột mã tỉnh/xã kèm chỉ mục GIN trên tám lớp chuyên đề

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `stampAdminCodes` — compute the codes

**Files:**
- Create: `apps/api/src/db/adminStamp.ts`
- Create: `apps/api/src/db/adminStamp.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `stampAdminCodes(client: pg.PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<number>` — updates every row of that version, returns the row count. Rows with no geometry or no intersecting unit get `'{}'`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/db/adminStamp.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { stampAdminCodes } from './adminStamp';

let versionId: string;

// A throwaway ingest version of `dams` with three known points, so the assertions do not
// depend on whatever the seed happens to contain.
const FIXTURES = [
  { external_id: 900001, name: 'stamp-bmt', lon: 108.05, lat: 12.68 },   // Buôn Ma Thuột, Đắk Lắk (66)
  { external_id: 900002, name: 'stamp-sea', lon: 112.5, lat: 10.5 },     // open sea, no unit
];

beforeAll(async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ('dams', 'ingest', 'adminStamp.test', 'stamp-test', false) RETURNING id`
    );
    versionId = rows[0].id;
    for (const f of FIXTURES) {
      await client.query(
        `INSERT INTO water.dams (external_id, name, geom, dataset_version_id)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)`,
        [f.external_id, f.name, f.lon, f.lat, versionId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await getPool().query('DELETE FROM water.dams WHERE dataset_version_id = $1', [versionId]);
  await getPool().query('DELETE FROM app.dataset_versions WHERE id = $1', [versionId]);
  await closePool();
});

async function codes(name: string) {
  const { rows } = await getPool().query<{ province_codes: string[]; ward_codes: string[] }>(
    `SELECT province_codes, ward_codes FROM water.dams WHERE name = $1 AND dataset_version_id = $2`,
    [name, versionId]
  );
  return rows[0];
}

describe('stampAdminCodes', () => {
  it('stamps the province and ward containing a point, and reports the rows touched', async () => {
    const client = await getPool().connect();
    let touched = 0;
    try {
      await client.query('BEGIN');
      touched = await stampAdminCodes(client, 'dams', versionId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(touched).toBe(FIXTURES.length);

    const bmt = await codes('stamp-bmt');
    expect(bmt.province_codes).toEqual(['66']);
    expect(bmt.ward_codes).toHaveLength(1);
  });

  it('gives an empty array — never null — to a feature outside every unit', async () => {
    const sea = await codes('stamp-sea');
    expect(sea.province_codes).toEqual([]);
    expect(sea.ward_codes).toEqual([]);
  });

  it('is idempotent: stamping twice yields the same codes', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await stampAdminCodes(client, 'dams', versionId);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect((await codes('stamp-bmt')).province_codes).toEqual(['66']);
  });

  it('refuses a layer key outside the allowlist rather than interpolating it', async () => {
    const client = await getPool().connect();
    try {
      await expect(
        stampAdminCodes(client, 'users; DROP TABLE app.users' as never, versionId)
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/adminStamp.test.ts`
Expected: FAIL — cannot resolve `./adminStamp`.

- [ ] **Step 3: Implement**

`apps/api/src/db/adminStamp.ts`:

```ts
import type pg from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';

/**
 * Khoá lớp là giá trị DUY NHẤT được nội suy vào SQL ở đây, và chỉ sau khi qua danh sách
 * cho phép. Mọi thứ khác là tham số ràng buộc.
 */
function assertKnownLayer(layerKey: EditableLayerKey): void {
  if (!(EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
    throw new Error(`Unknown layer key: ${String(layerKey)}`);
  }
}

/**
 * Tính lại mã tỉnh/xã cho toàn bộ hàng thuộc một phiên bản.
 *
 * Chạy trong giao dịch của người gọi: khi nạp dữ liệu thì cùng giao dịch với phiên bản
 * ingest, khi biên tập thì cùng giao dịch với bản nháp — nên không bao giờ tồn tại trạng
 * thái "đã có đối tượng nhưng chưa có mã".
 *
 * Truy vấn con tương quan chứ không JOIN gộp: mỗi hàng tra chỉ mục GiST của
 * admin.provinces/admin.wards một lần, và mảng giữ được thứ tự ổn định nhờ ORDER BY.
 */
export async function stampAdminCodes(
  client: pg.PoolClient,
  layerKey: EditableLayerKey,
  versionId: string
): Promise<number> {
  assertKnownLayer(layerKey);
  const result = await client.query(
    `UPDATE water.${layerKey} t
        SET province_codes = coalesce((
              SELECT array_agg(p.code ORDER BY p.code)
                FROM admin.provinces p
               WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, p.geom)), '{}'),
            ward_codes = coalesce((
              SELECT array_agg(w.code ORDER BY w.code)
                FROM admin.wards w
               WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, w.geom)), '{}')
      WHERE t.dataset_version_id = $1`,
    [versionId]
  );
  return result.rowCount ?? 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @webatlas/api -- src/db/adminStamp.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Measure the cost on the largest layer**

Stamping runs inside an ingest transaction, so its cost matters. Time it against the seeded rivers version:

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c "\timing on" -c "
EXPLAIN (ANALYZE, BUFFERS) UPDATE water.rivers t
   SET province_codes = coalesce((SELECT array_agg(p.code ORDER BY p.code) FROM admin.provinces p
        WHERE t.geom IS NOT NULL AND ST_Intersects(t.geom, p.geom)), '{}')
 WHERE t.dataset_version_id = (SELECT id FROM app.dataset_versions WHERE layer_key='rivers' AND is_active)"
```

Record the time and whether the plan shows an index scan on `provinces_geom_index`. Expected: an index scan and well under 30 s for 9,486 rows. If it shows a sequential scan over `admin.provinces`, stop and report — the predicate is not matching the index, which is the defect class that cost a factor of nineteen in the elevation profile.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/adminStamp.ts apps/api/src/db/adminStamp.test.ts
git commit -m "feat(api): tính mã tỉnh/xã cho từng đối tượng theo phiên bản

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Stamp during seeding

**Files:**
- Modify: `apps/api/src/db/seeds/run.ts`
- Modify: `apps/api/src/db/seeds/seed.test.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `loadAdminBoundaries` (Task 2), `stampAdminCodes` (Task 4).
- Produces: after `npm run seed`, every feature of every layer carries its administrative codes.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/db/seeds/seed.test.ts` (it already runs `runSeeds()`; reuse its setup rather than re-seeding):

```ts
describe('administrative stamping during seed', () => {
  it('stamps dams with the province they fall in', async () => {
    const { rows } = await getPool().query<{ stamped: string; total: string }>(
      `SELECT count(*) FILTER (WHERE array_length(province_codes, 1) IS NOT NULL)::text AS stamped,
              count(*)::text AS total
         FROM water.dams_active WHERE geom IS NOT NULL`
    );
    // Every dam in the working region sits inside a province; a handful outside the six
    // provinces legitimately stamp empty, so this asserts the bulk rather than all.
    expect(Number(rows[0].stamped)).toBeGreaterThan(Number(rows[0].total) * 0.9);
  });

  it('stamps a river with every province it crosses', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT max(array_length(province_codes, 1))::text AS n FROM water.rivers_active`
    );
    // At least one watercourse crosses a provincial boundary; a scalar column could not
    // represent this, which is why the columns are arrays.
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/seeds/seed.test.ts`
Expected: FAIL — codes are all empty because nothing stamps them yet.

- [ ] **Step 3: Wire stamping into the seed loop**

In `apps/api/src/db/seeds/run.ts`, add the import:

```ts
import { stampAdminCodes } from '../adminStamp';
import type { EditableLayerKey } from '@webatlas/shared';
```

Inside the per-layer transaction, immediately after the `UPDATE app.dataset_versions SET feature_count` statement and
before `versions.activate(...)`:

```ts
      // Đóng dấu trước khi kích hoạt: một phiên bản đã active mà chưa có mã hành chính sẽ
      // khiến truy vấn theo tỉnh trả về thiếu, và không có gì báo cho ta biết.
      await stampAdminCodes(client, layer.table as EditableLayerKey, versionId);
```

- [ ] **Step 4: Re-seed and verify**

Run: `npm run seed` then `npm run test -w @webatlas/api -- src/db/seeds/seed.test.ts`
Expected: PASS. The seed log is unchanged apart from the boundary line added in Task 2.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/seeds/run.ts apps/api/src/db/seeds/seed.test.ts
git commit -m "feat(api): đóng dấu mã hành chính ngay khi nạp dữ liệu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Re-stamp when an edit session commits

**Files:**
- Modify: `apps/api/src/modules/layers/service.ts` (the `commit()` method of `editSession`)
- Modify: `apps/api/src/modules/layers/layers.test.ts`

**Interfaces:**
- Consumes: `stampAdminCodes` (Task 4).
- Produces: a feature created or moved through the API carries correct codes as soon as its edit version is committed.

This is the maintenance contract from the architecture document §9: a derived value is rebuilt by the same commit path
that writes the change, never by a caller that has to remember.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/layers/layers.test.ts`, inside the `describe('feature CRUD (admin only)')` block:

```ts
  it('stamps administrative codes when the edit session commits, and re-stamps on a move', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    // Buôn Ma Thuột — Đắk Lắk, province code 66.
    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().feature.id;

    const stamped = await getPool().query<{ province_codes: string[] }>(
      `SELECT province_codes FROM water.dams_active WHERE id = $1`, [id]
    );
    expect(stamped.rows[0].province_codes).toEqual(['66']);

    // Move it into Lâm Đồng (province code 68): Đà Lạt, 108.44 / 11.94.
    const moved = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [108.44, 11.94] } },
    });
    expect(moved.statusCode).toBe(200);

    const restamped = await getPool().query<{ province_codes: string[] }>(
      `SELECT province_codes FROM water.dams_active WHERE id = $1`, [moved.json().feature.id]
    );
    expect(restamped.rows[0].province_codes).toEqual(['68']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/layers/layers.test.ts`
Expected: FAIL — `province_codes` is `[]` after create, because nothing stamps the draft version.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/layers/service.ts`, add the import:

```ts
import { stampAdminCodes } from '../../db/adminStamp';
import type { EditableLayerKey } from '@webatlas/shared';
```

In the session's `commit()`, stamp the draft's rows before publishing it — inside the same transaction, so a feature is
never visible without its codes:

```ts
      async commit(): Promise<void> {
        assertOpen();
        settled = true;
        try {
          // Giá trị dẫn xuất được dựng lại bởi chính đường ghi (tài liệu kiến trúc §9):
          // đóng dấu hàng của bản nháp TRƯỚC khi công bố, trong cùng giao dịch.
          await stampAdminCodes(client, def.key as EditableLayerKey, draftId);
          await versions.commitEditDraft(client, def.key, draftId);
          await client.query('COMMIT');
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch { /* transaction already ended */ }
          throw e;
        } finally {
          release();
        }
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/layers/layers.test.ts`
Expected: PASS, including the pre-existing CRUD and audit tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/layers/service.ts apps/api/src/modules/layers/layers.test.ts
git commit -m "feat(api): đóng dấu lại mã hành chính khi phiên biên tập được ghi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Feature listing reads the active version and filters by administrative unit

**Files:**
- Modify: `apps/api/src/modules/layers/repository.ts`
- Modify: `apps/api/src/modules/layers/service.ts` (`list`)
- Modify: `apps/api/src/modules/layers/controller.ts` (`listFeatures`)
- Modify: `apps/api/src/modules/layers/layers.test.ts`

**Interfaces:**
- Produces: `GET /api/layers/:key/features?province=66&ward=…` returns only active-version features, optionally filtered. `repo.list(def, filter?: { province?: string; ward?: string })`.

**Defect fixed here.** `repo.list` selects from `def.table` — the *base* table — so the endpoint currently returns every
version's rows: 604 rows for 151 real dams at the time of writing. Adding a filter on top of that would filter the wrong
set, so the listing moves to the resolution view in the same change.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/layers/layers.test.ts`:

```ts
describe('feature listing', () => {
  it('returns one row per feature, not one per version', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'GET', url: '/api/layers/dams/features',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().features.map((f: { id: string }) => f.id);
    expect(new Set(ids).size).toBe(ids.length);

    const active = await getPool().query<{ n: string }>(`SELECT count(*)::text AS n FROM water.dams_active`);
    expect(ids).toHaveLength(Number(active.rows[0].n));
  });

  it('filters by province and by ward', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    const all = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: auth });
    const inDakLak = await app.inject({ method: 'GET', url: '/api/layers/dams/features?province=66', headers: auth });
    expect(inDakLak.statusCode).toBe(200);

    const total = all.json().features.length;
    const subset = inDakLak.json().features.length;
    expect(subset).toBeGreaterThan(0);
    expect(subset).toBeLessThan(total);

    const { rows } = await getPool().query<{ code: string }>(
      `SELECT ward_codes[1] AS code FROM water.dams_active
        WHERE array_length(ward_codes, 1) IS NOT NULL LIMIT 1`
    );
    const byWard = await app.inject({
      method: 'GET', url: `/api/layers/dams/features?ward=${rows[0].code}`, headers: auth,
    });
    expect(byWard.json().features.length).toBeGreaterThan(0);
    expect(byWard.json().features.length).toBeLessThanOrEqual(subset);
  });

  it('rejects a malformed unit code rather than ignoring it', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({
      method: 'GET', url: '/api/layers/dams/features?province=' + 'x'.repeat(20),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/layers/layers.test.ts`
Expected: FAIL — duplicate ids (base table) and `?province=` ignored (200 with the full set).

- [ ] **Step 3: Repository — read the view, accept a filter**

In `apps/api/src/modules/layers/repository.ts`, add above `featuresRepository`:

```ts
export interface FeatureFilter {
  province?: string;
  ward?: string;
}

/**
 * Đọc từ view phiên bản đang hoạt động, KHÔNG phải bảng gốc: bảng gốc chứa mọi phiên bản,
 * nên liệt kê từ đó trả về cả những hàng đã bị thay thế (604 hàng cho 151 cái đập, đo lúc
 * viết). Ghi thì vẫn nhắm vào bảng gốc theo phiên bản nháp — chỉ phần đọc đổi.
 */
function activeRelation(def: LayerDef): string {
  return `${def.table}_active`;
}
```

Change `selectSql` to take the relation, and `list` to filter:

```ts
function selectSql(def: LayerDef, relation: string): string {
  const attrs = def.attributeColumns.map((c) => `'${c}', t.${c}`).join(', ');
  return `SELECT t.id,
                 CASE WHEN t.${def.geomColumn} IS NULL THEN NULL
                      ELSE ST_AsGeoJSON(t.${def.geomColumn})::jsonb END AS geometry,
                 jsonb_build_object(${attrs}) AS properties
          FROM ${relation} t`;
}
```

Update the three existing call sites to pass the relation they need — `list` uses `activeRelation(def)`; `findById`
and `findByIdOnClient` keep `def.table`, because an edit session must see its own uncommitted rows:

```ts
    async list(def: LayerDef, filter: FeatureFilter = {}): Promise<FeatureRow[]> {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.province) {
        params.push(filter.province);
        where.push(`t.province_codes && ARRAY[$${params.length}]`);
      }
      if (filter.ward) {
        params.push(filter.ward);
        where.push(`t.ward_codes && ARRAY[$${params.length}]`);
      }
      const sql = `${selectSql(def, activeRelation(def))}
                   ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY t.created_at DESC`;
      const { rows } = await pg.query(sql, params);
      return rows;
    },
```

- [ ] **Step 4: Service and controller**

`apps/api/src/modules/layers/service.ts`:

```ts
    async list(key: string, filter: FeatureFilter = {}): Promise<FeatureRow[]> {
      return repo.list(getLayer(key), filter);
    },
```

(import `type FeatureFilter` from `./repository`).

`apps/api/src/modules/layers/controller.ts` — add the query schema and use it:

```ts
// Mã đơn vị hành chính là chuỗi số ngắn ('66', '66123'); giới hạn độ dài để một tham số
// rác bị từ chối ở biên chứ không lặng lẽ khớp không ra gì.
const FeatureQuery = z.object({
  province: z.string().regex(/^\d{1,6}$/, 'Mã tỉnh không hợp lệ').optional(),
  ward: z.string().regex(/^\d{1,8}$/, 'Mã xã/phường không hợp lệ').optional(),
});

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const filter = validate(FeatureQuery, req.query);
  const rows = await featuresService(req.server.pg).list(key, filter);
  reply.send({ type: 'FeatureCollection', features: rows.map(toFeature) });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/layers/layers.test.ts`
Expected: PASS. If a pre-existing test asserted the old duplicate-including count, update it to the active-version
count and note the change in your report — that count was a symptom of the defect.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/layers
git commit -m "fix(api): liệt kê đối tượng theo phiên bản đang hoạt động, lọc theo tỉnh/xã

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `GET /api/admin-units` — list units with their extents

**Files:**
- Create: `apps/api/src/modules/admin-units/repository.ts`, `controller.ts`, `routes.ts`
- Create: `apps/api/src/modules/admin-units/adminUnits.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: `GET /api/admin-units?level=province|ward&province=<code>` →
  `{ units: [{ code, name, fullName, level, bbox: [west, south, east, north] }] }`. Public, like `/api/search`.
  Wards require a `province` filter (616 rows is too many to hand the client unasked).

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/admin-units/adminUnits.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe('GET /api/admin-units', () => {
  it('lists all 34 provinces with a usable extent, without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin-units?level=province' });
    expect(res.statusCode).toBe(200);
    const units = res.json().units as Array<{ code: string; name: string; bbox: number[] }>;
    expect(units).toHaveLength(34);

    const dakLak = units.find((u) => u.code === '66')!;
    expect(dakLak.name).toContain('Đắk Lắk');
    const [west, south, east, north] = dakLak.bbox;
    expect(west).toBeGreaterThan(107);
    expect(east).toBeLessThan(110);
    expect(south).toBeLessThan(north);
  });

  it('lists the wards of one province', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin-units?level=ward&province=66' });
    expect(res.statusCode).toBe(200);
    const units = res.json().units as Array<{ code: string }>;
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((u) => u.code.startsWith('66') || u.code.length > 2)).toBe(true);
  });

  it('refuses a ward listing without a province, and an unknown level', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin-units?level=ward' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/admin-units?level=commune' })).statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/admin-units`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Repository**

`apps/api/src/modules/admin-units/repository.ts`:

```ts
import type { Pool } from 'pg';

export interface AdminUnit {
  code: string;
  name: string;
  fullName: string | null;
  level: 'province' | 'ward';
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
}

interface Row {
  code: string;
  name: string;
  fullName: string | null;
  west: number; south: number; east: number; north: number;
}

const BBOX_SQL = `ST_XMin(ST_Envelope(geom)) AS west, ST_YMin(ST_Envelope(geom)) AS south,
                  ST_XMax(ST_Envelope(geom)) AS east, ST_YMax(ST_Envelope(geom)) AS north`;

function toUnit(level: AdminUnit['level']) {
  return (r: Row): AdminUnit => ({
    code: r.code, name: r.name, fullName: r.fullName, level,
    bbox: [r.west, r.south, r.east, r.north],
  });
}

export async function listProvinces(pool: Pool): Promise<AdminUnit[]> {
  const { rows } = await pool.query<Row>(
    `SELECT code, name, full_name AS "fullName", ${BBOX_SQL} FROM admin.provinces ORDER BY code`
  );
  return rows.map(toUnit('province'));
}

export async function listWards(pool: Pool, provinceCode: string): Promise<AdminUnit[]> {
  const { rows } = await pool.query<Row>(
    `SELECT code, name, full_name AS "fullName", ${BBOX_SQL} FROM admin.wards
      WHERE province_code = $1 ORDER BY code`,
    [provinceCode]
  );
  return rows.map(toUnit('ward'));
}
```

- [ ] **Step 4: Controller and route**

`apps/api/src/modules/admin-units/controller.ts`:

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { listProvinces, listWards } from './repository';

const Query = z
  .object({
    level: z.enum(['province', 'ward']),
    province: z.string().regex(/^\d{1,6}$/, 'Mã tỉnh không hợp lệ').optional(),
  })
  // 616 xã là quá nhiều để trả về khi không ai hỏi; buộc phải khoanh theo tỉnh.
  .refine((q) => q.level === 'province' || q.province !== undefined, {
    message: 'Liệt kê xã/phường phải kèm mã tỉnh',
  });

export async function adminUnits(req: FastifyRequest, reply: FastifyReply) {
  const q = validate(Query, req.query);
  const units = q.level === 'province'
    ? await listProvinces(req.server.pg)
    : await listWards(req.server.pg, q.province!);
  reply.send({ units });
}
```

`apps/api/src/modules/admin-units/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { adminUnits } from './controller';

/** Công khai như /api/search: ranh giới hành chính không phải dữ liệu nhạy cảm. */
export default async function adminUnitsRoutes(app: FastifyInstance) {
  app.get('/admin-units', adminUnits);
}
```

`apps/api/src/server.ts`: `import adminUnitsRoutes from './modules/admin-units/routes';` and
`app.register(adminUnitsRoutes, { prefix: '/api' });` after the geometry routes.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/admin-units`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin-units apps/api/src/server.ts
git commit -m "feat(api): tuyến liệt kê đơn vị hành chính kèm khung bao

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Assistant tool `features_in_admin_unit`

**Files:**
- Create: `apps/api/src/modules/assistant/tools/data/featuresInAdminUnit.ts`
- Create: `apps/api/src/modules/assistant/tools/data/featuresInAdminUnit.test.ts`
- Modify: `apps/api/src/modules/assistant/tools/registry.ts`

**Interfaces:**
- Consumes: stamped codes (Tasks 4–6); `LAYER_LABELS`, `ROW_LIMIT`, `activeVersionLabel`, `layerView` from
  `tools/data/helpers`.
- Produces: tool `features_in_admin_unit` with input `{ layerKey, code }`, appended to `FACTORIES` after
  `zonalElevationTool`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/assistant/tools/data/featuresInAdminUnit.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { featuresInAdminUnitTool } from './featuresInAdminUnit';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street',
};

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool, role: 'viewer', mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, records };
}

const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('features_in_admin_unit', () => {
  it('counts dams in Đắk Lắk and names the unit in Vietnamese', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'dams', code: '66' });
    const parsed = JSON.parse(text) as { unit: string; count: number; rows: unknown[] };
    expect(parsed.unit).toContain('Đắk Lắk');
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThanOrEqual(25);
    expect(records[0]).toMatchObject({ tool: 'features_in_admin_unit', layerKey: 'dams' });
    expect(records[0].rowCount).toBe(parsed.count);
  });

  it('reports no data for a unit code that does not exist, and still emits provenance', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'dams', code: '999999' });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].rowCount).toBe(0);
  });

  it('reports no data when the unit exists but the layer has nothing in it', async () => {
    // Pick a province that genuinely holds no station, so the assertion is deterministic
    // rather than dependent on which placeholder rows the seed happens to contain.
    const { rows } = await pool.query<{ code: string }>(
      `SELECT p.code FROM admin.provinces p
        WHERE NOT EXISTS (
          SELECT 1 FROM water.stations_active s WHERE s.province_codes && ARRAY[p.code])
        ORDER BY p.code LIMIT 1`
    );
    expect(rows).toHaveLength(1);

    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'stations', code: rows[0].code });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records[0].rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/assistant/tools/data/featuresInAdminUnit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

`apps/api/src/modules/assistant/tools/data/featuresInAdminUnit.ts`:

```ts
// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, POINT_SQL, ROW_LIMIT, activeVersionLabel, layerView } from './helpers';

/**
 * Truy vấn quan hệ, không phải phép toán hình học: mã hành chính đã được đóng dấu sẵn lên
 * từng đối tượng (db/adminStamp.ts) và có chỉ mục GIN, nên câu hỏi "bao nhiêu đập ở Đắk Lắk"
 * là một lần tra chỉ mục — không chạm tới ngân sách 5 giây của nhóm công cụ phân tích.
 */
export const featuresInAdminUnitTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'features_in_admin_unit',
    description:
      'Count and list the features of one layer inside an administrative unit (province or ward), by its official code. Use for "ở tỉnh X", "trong xã Y". The code comes from the user or from another tool, never invented.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      code: z.string().regex(/^\d{1,8}$/, 'Mã đơn vị hành chính gồm 1-8 chữ số'),
    }),
    run: async (input) => {
      const view = layerView(input.layerKey);
      const [{ rows: unitRows }, datasetVersion] = await Promise.all([
        ctx.pool.query<{ name: string; level: string }>(
          `SELECT name, 'tỉnh' AS level FROM admin.provinces WHERE code = $1
           UNION ALL
           SELECT name, 'xã/phường' AS level FROM admin.wards WHERE code = $1`,
          [input.code]
        ),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);

      if (unitRows.length === 0) {
        ctx.provenance({ tool: 'features_in_admin_unit', layerKey: input.layerKey, rowCount: 0, datasetVersion });
        return `Không có dữ liệu: không có đơn vị hành chính nào mang mã ${input.code}.`;
      }

      const unit = `${unitRows[0].level} ${unitRows[0].name}`;
      const column = unitRows[0].level === 'tỉnh' ? 'province_codes' : 'ward_codes';
      const { rows } = await ctx.pool.query<{ featureId: string; name: string | null; lon: number; lat: number; total: string }>(
        `SELECT id::text AS "featureId", name, ${POINT_SQL}, count(*) OVER () AS total
           FROM ${view}
          WHERE ${column} && ARRAY[$1]
          ORDER BY name NULLS LAST
          LIMIT $2`,
        [input.code, ROW_LIMIT]
      );

      const count = rows.length > 0 ? Number(rows[0].total) : 0;
      ctx.provenance({ tool: 'features_in_admin_unit', layerKey: input.layerKey, rowCount: count, datasetVersion });

      if (count === 0) {
        return `Không có dữ liệu: ${unit} không có đối tượng nào thuộc lớp ${LAYER_LABELS[input.layerKey]}.`;
      }
      return JSON.stringify({
        layerKey: input.layerKey,
        unit,
        count,
        rows: rows.map((r) => ({ featureId: r.featureId, name: r.name, lon: r.lon, lat: r.lat })),
      });
    },
  });
```

- [ ] **Step 4: Register it**

In `apps/api/src/modules/assistant/tools/registry.ts`, import it and append after `zonalElevationTool` in `FACTORIES`:

```ts
  // Đóng dấu sẵn mã hành chính nên đây là tra chỉ mục, không phải phép giao hình học.
  featuresInAdminUnitTool,
```

- [ ] **Step 5: Run the assistant suite**

Run: `npm run test -w @webatlas/api -- src/modules/assistant`
Expected: PASS, including `registry.test.ts` (its assertions are on uniqueness and stable order, both still true).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/assistant/tools
git commit -m "feat(assistant): công cụ đếm đối tượng theo đơn vị hành chính

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Zoom to a province by its real extent

**Files:**
- Create: `apps/web/src/entities/admin-unit/adminUnits.api.ts`, `adminUnits.store.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.ts`
- Modify: `apps/web/src/features/map/model/mapCommands.test.ts`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: `GET /api/admin-units` (Task 8).
- Produces: `fetchAdminUnits(level, province?)`, `primeAdminUnits()`, `getProvinceBbox(code): [number,number,number,number] | null`; `zoomToRegion` fits the real extent when loaded.

The command executor is synchronous, so extents are fetched once at start-up into a module store and read
synchronously. `PROVINCE_CENTROIDS` stays only as the bootstrap fallback for the window before the fetch resolves.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/map/model/mapCommands.test.ts`:

```ts
import { setProvinceBboxes } from '../../../entities/admin-unit/adminUnits.store';

describe('zoomToRegion uses real extents when they are loaded', () => {
  it('fits the province extent rather than a fixed zoom on a centroid', () => {
    setProvinceBboxes({ '66': [107.5, 12.0, 109.0, 13.5] });
    const deps = makeDeps();
    const fit = vi.fn();
    (deps.map as unknown as { getView: () => unknown }).getView = () => ({
      fit, animate: deps.animate, getMinZoom: () => undefined, getMaxZoom: () => undefined,
    });

    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });

    expect(fit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới Đắk Lắk.' });
  });

  it('falls back to the bundled centroid before the extents have loaded', () => {
    setProvinceBboxes({});
    const deps = makeDeps();
    const result = createCommandExecutor(deps)({ kind: 'zoomToRegion', provinceCode: '66' });
    expect(deps.animate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'Đã phóng to tới Đắk Lắk.' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/mapCommands.test.ts`
Expected: FAIL — cannot resolve the store module.

- [ ] **Step 3: API client and store**

`apps/web/src/entities/admin-unit/adminUnits.api.ts`:

```ts
import { apiRequest } from '../../shared/api/apiClient';

export interface AdminUnit {
  code: string;
  name: string;
  fullName: string | null;
  level: 'province' | 'ward';
  bbox: [number, number, number, number];
}

export async function fetchAdminUnits(
  level: 'province' | 'ward',
  province?: string
): Promise<AdminUnit[]> {
  const query = province ? `?level=${level}&province=${encodeURIComponent(province)}` : `?level=${level}`;
  const body = await apiRequest<{ units: AdminUnit[] }>(`/api/admin-units${query}`);
  return body.units;
}
```

`apps/web/src/entities/admin-unit/adminUnits.store.ts`:

```ts
import { fetchAdminUnits } from './adminUnits.api';

/**
 * Khung bao các tỉnh, nạp một lần lúc khởi động. Bộ thực thi lệnh là hàm đồng bộ, nên nó
 * đọc từ đây chứ không tự gọi mạng; trước khi nạp xong thì zoomToRegion lùi về toạ độ tâm
 * đóng gói sẵn (provinceCentroids.ts) — chỉ dùng cho khoảnh khắc khởi động đó.
 */
let bboxes: Record<string, [number, number, number, number]> = {};

export function setProvinceBboxes(next: Record<string, [number, number, number, number]>): void {
  bboxes = next;
}

export function getProvinceBbox(code: string): [number, number, number, number] | null {
  return bboxes[code] ?? null;
}

export async function primeAdminUnits(): Promise<void> {
  try {
    const units = await fetchAdminUnits('province');
    setProvinceBboxes(Object.fromEntries(units.map((u) => [u.code, u.bbox])));
  } catch {
    // Giữ nguyên bản rỗng: zoomToRegion vẫn chạy được bằng toạ độ tâm đóng gói sẵn.
  }
}
```

- [ ] **Step 4: Executor**

In `apps/web/src/features/map/model/mapCommands.ts`, import the store and replace the `zoomToRegion` case:

```ts
import { getProvinceBbox } from '../../../entities/admin-unit/adminUnits.store';
import { transformExtent } from 'ol/proj';
```

```ts
      case 'zoomToRegion': {
        if (!deps.map) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        const name = REGION_PROVINCE_NAMES[cmd.provinceCode];
        const bbox = getProvinceBbox(cmd.provinceCode);
        if (bbox) {
          // Khung bao thật: một tỉnh dài không còn bị cắt cụt như khi phóng cố định mức 9.
          deps.map.getView().fit(transformExtent(bbox, 'EPSG:4326', 'EPSG:3857'), {
            padding: [40, 40, 40, 40], duration: ANIMATE_MS,
          });
          return { ok: true, text: `Đã phóng to tới ${name}.` };
        }
        const centre = PROVINCE_CENTROIDS[cmd.provinceCode];
        if (!centre) return { ok: false, reason: 'Không có toạ độ cho tỉnh này.' };
        if (!animateTo(centre, PROVINCE_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: `Đã phóng to tới ${name}.` };
      }
```

In `apps/web/src/features/map/model/provinceCentroids.ts`, add a comment at the top:

```ts
// Chỉ còn là phương án dự phòng lúc khởi động: khung bao thật đến từ GET /api/admin-units
// (entities/admin-unit/adminUnits.store.ts). Đừng thêm tỉnh mới vào đây.
```

- [ ] **Step 5: Prime at start-up**

In `apps/web/src/app/App.tsx`, inside `RailAndFlyout`, add:

```tsx
import { primeAdminUnits } from '../entities/admin-unit/adminUnits.store';
```

```tsx
  useEffect(() => { void primeAdminUnits(); }, []);
```

- [ ] **Step 6: Run tests, type-check, lint**

Run: `npm run test -w @webatlas/web -- src/features/map/model src/entities` then `npm run build:web` then `npm run lint:web`
Expected: PASS; build succeeds; lint exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/entities/admin-unit apps/web/src/features/map/model apps/web/src/app/App.tsx
git commit -m "feat(web): phóng tới tỉnh theo khung bao thật thay cho toạ độ tâm cứng

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation and phase verification

**Files:**
- Modify: `docs/architecture/database-architecture.md`
- Modify: `README.md`
- Modify: `docs/runbooks/README.md`

- [ ] **Step 1: Update the architecture document**

In `docs/architecture/database-architecture.md`:
- §3 table: change the `admin` row's Status from **Designed** to Implemented.
- §6.2 and §6.3: drop the "(designed)" qualifier from both headings.
- §11 index table: drop "(designed)" from the GIN row.
- Bump the revision line to `**Revision:** 1.1 — <today's date>` and add one line under it:
  `Phase 1 (administrative boundaries and stamping) implemented; see docs/superpowers/plans/2026-09-18-plan-1-admin-boundaries-and-stamping.md.`

Leave every other Designed marker alone — the entity hierarchy, networks, ROI and link table are still unbuilt.

- [ ] **Step 2: Update the API surface in the README**

In `README.md`, under the API surface block, add:

```
GET    /api/admin-units?level=province|ward&province= → administrative units with extents (public)
GET    /api/layers/:key/features?province=&ward=      → features of the ACTIVE version, filtered   [auth]
```

- [ ] **Step 3: Note the seed dependency in the runbook**

In `docs/runbooks/README.md`, in the step that describes `npm run seed`, add:

> `npm run seed` now also loads `admin.provinces` / `admin.wards` from the GeoJSON committed in `apps/web/public`, and
> stamps `province_codes` / `ward_codes` onto every feature. No network access is required.

- [ ] **Step 4: Full verification**

Run each, and paste the summary lines into your report:

```bash
npm run build:shared && npm run test:shared
npm run test:api
npm run test:web
npm run build:web
npm run lint:web
```

Expected: all green.

- [ ] **Step 5: Verify the end-to-end question the phase exists to answer**

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "
SELECT 'đập ở Đắk Lắk: '||count(*) FROM water.dams_active WHERE province_codes && ARRAY['66'];
SELECT 'sông chảy qua Đắk Lắk: '||count(*) FROM water.rivers_active WHERE province_codes && ARRAY['66'];
SELECT 'sông qua nhiều tỉnh: '||count(*) FROM water.rivers_active WHERE array_length(province_codes,1) > 1;"
```

Expected: three non-zero counts. The third is the one that proves the array design was necessary — record the numbers in
your report.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/database-architecture.md README.md docs/runbooks/README.md
git commit -m "docs: cập nhật kiến trúc, API và runbook cho ranh giới hành chính

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| §3 boundaries in the base database | 1, 2 |
| §3 / §6.3 stamping, arrays, recompute on commit | 3, 4, 5, 6 |
| §3 query surface (HTTP filter, assistant tool, centroid retirement) | 7, 8, 9, 10 |
| §6.4 accuracy limitation stated | 1 (migration comment), 2 (loader comment), 11 (architecture doc) |
| §10 verification: "a feature moved across a border restamps" | 6 |
| §1, §2, §4, §5, §7 (entity hierarchy, topology, reference layers, ROI, links) | **Not this plan** — later phases |

## Not in this plan

Phases 2–5 of the spec follow as their own plans: reference-layer access and named entities; the HydroRIVERS topology
ingest and the three-level river hierarchy; the ROI object and toolbar; and the remaining assistant tools
(`resolve_entity`, `upstream_of`, `related_entities`). Nothing here depends on them, and they each depend on this one
only for the stamped codes.
