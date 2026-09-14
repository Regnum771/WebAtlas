# HydroSHEDS Hydrology Data (Lakes Layer + Rivers Replacement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully-editable HydroLAKES `lakes` polygon layer and replace the coarse `thuyhe` rivers data with HydroRIVERS ingested as a new active version, so lakes render as real bright-blue water bodies and rivers trace real watercourses.

**Architecture:** Both datasets are prepared offline (`ogr2ogr` clip → committed clipped GeoJSON) and loaded through the *existing* versioned seed/ingest pipeline. `lakes` is a new `water.lakes` table wired through every "add a layer" seam (shared keys → migration → registry → seed → GeoServer publish → frontend style). Rivers replacement uses the already-built `versionsService` to ingest HydroRIVERS as `rivers` version 2 and flip it active; `thuyhe` stays as addressable version 1. GeoServer's `<layer>_active` views mean WFS consumers see the new rivers with no republish.

**Tech Stack:** Node.js + TypeScript (Fastify API), `node-pg-migrate`, PostGIS, GeoServer WFS, `pg`, zod, Vitest; React 19 + OpenLayers 10 frontend; `ogr2ogr` (offline prep only).

## Global Constraints

- **INV-2 — the API layer registry is the one authoritative layer catalog.** The frontend layer panel is derived from `GET /api/layers`; never hand-maintained. Adding `lakes` to `EDITABLE_LAYER_KEYS` is what drives the panel and CRUD.
- **INV-4 — attribute schema has one definition.** `packages/shared` is the single source for each layer's keys/geometry; migrations, the API registry, and frontend forms all consume it.
- **Versioning (spec `2026-07-22-map-versioning-foundation`):** re-ingest creates a **new full standalone version**, never overwrites. Feature tables carry `dataset_version_id uuid notNull`, `deleted boolean notNull default false`, and `unique (dataset_version_id, external_id)`. GeoServer serves the `<layer>_active` view.
- **All new tables get a GiST index on `geom`** and follow the `COMMON(pgm)` audit-column pattern (`id`, `created_at`, `updated_at`, `created_by`, `updated_by`).
- **Migrations are ordered by numeric prefix.** The next migration file is `1000000000006_*`.
- **Raw HydroSHEDS data is never committed.** Only the small clipped GeoJSON seed inputs are committed; the prep script documents regeneration from upstream (source URLs + versions recorded).
- **TDD:** every task writes a failing test first, watches it fail for the right reason, then implements. Frequent commits.

---

## File Structure

**Created:**
- `apps/api/scripts/prep-hydrosheds.sh` — documented offline `ogr2ogr` prep (clip/normalize → clipped GeoJSON). Not run in CI.
- `apps/api/src/db/seeds/data/hydrolakes-vn.geojson` — committed clipped HydroLAKES seed input (Task 2).
- `apps/api/src/db/seeds/data/hydrorivers-vn.geojson` — committed clipped HydroRIVERS ingest input (Task 2).
- `apps/api/src/db/migrations/1000000000006_lakes-schema.cjs` — `water.lakes` table (with versioning columns) + `lakes_active` view.
- `apps/api/src/db/seeds/ingestRivers.ts` — one-off script: ingest HydroRIVERS as `rivers` v2 and activate (idempotent).
- `apps/api/src/db/seeds/lakeType.ts` — HydroLAKES `Lake_type` code → label lookup.

**Modified:**
- `packages/shared/src/index.ts` — add `'lakes'` to `EDITABLE_LAYER_KEYS` + `LAYER_GEOMETRY`.
- `packages/shared/src/layers.test.ts` — length 7 → 8, add `lakes` assertions.
- `apps/api/src/layers/registry.ts` — `lakes` ATTRS + `EXTERNAL_ID_TYPE`.
- `apps/api/src/db/seeds/registry.ts` — `lakes` `SeedLayer` entry.
- `apps/api/src/geoserver/publish.ts` — add `'lakes'` to `TABLES`.
- `apps/web/src/features/map/model/styles.ts` — `lakesStyle`; re-tuned `RIVER_WIDTHS`/`riverBucket()` for Strahler order.
- `apps/web/src/features/map/model/MapModel.ts` — wire the `lakes` WFS layer.
- Test files: `db/schema.test.ts`, `db/seeds/seed.test.ts`, `layers/registry.test.ts`, `modules/versions/integration.test.ts`, `geoserver/publish.test.ts`, `modules/map/model/styles.test.ts`.

---

## Task 1: Add `lakes` to the shared layer catalog

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/layers.test.ts`, `packages/shared/src/layer-geometry.test.ts` (already iterate `EDITABLE_LAYER_KEYS`)

**Interfaces:**
- Produces: `EDITABLE_LAYER_KEYS` now includes `'lakes'`; `LAYER_GEOMETRY['lakes'] === 'MultiPolygon'`; `EditableLayerKey` union includes `'lakes'`. All later API/frontend tasks depend on this.

- [ ] **Step 1: Update the failing length/containment test**

In `packages/shared/src/layers.test.ts`, change the length expectation and add a `lakes` containment assertion:

```ts
it('has 8 editable layers', () => {
  expect(EDITABLE_LAYER_KEYS).toHaveLength(8);
});

it('contains lakes', () => {
  expect(EDITABLE_LAYER_KEYS).toContain('lakes');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/shared -- src/layers.test.ts`
Expected: FAIL — length is 7, does not contain `lakes`.

- [ ] **Step 3: Add `lakes` to the catalog**

In `packages/shared/src/index.ts`, add `'lakes'` to the `EDITABLE_LAYER_KEYS` array (place it after `'rivers'`, keeping the water/hydro layers together), and add a `lakes` entry to `LAYER_GEOMETRY`:

```ts
lakes: 'MultiPolygon',
```

(Match the exact object/array style already in the file. `EditableLayerKey` and any `LAYER_GEOMETRY` typing derive automatically.)

- [ ] **Step 4: Run the shared suite to verify green**

Run: `npm run test -w @webatlas/shared`
Expected: PASS — includes the geometry round-trip test now covering `lakes: 'MultiPolygon'`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/layers.test.ts
git commit -m "feat(shared): add lakes to the editable-layer catalog"
```

---

## Task 2: Offline data prep script + committed clipped GeoJSON

**Files:**
- Create: `apps/api/scripts/prep-hydrosheds.sh`
- Create: `apps/api/src/db/seeds/data/hydrolakes-vn.geojson` (generated artifact, committed)
- Create: `apps/api/src/db/seeds/data/hydrorivers-vn.geojson` (generated artifact, committed)
- Modify: `README.md` (or `apps/api/README.md` if one exists) — a "Regenerating HydroSHEDS seed data" section

**Interfaces:**
- Produces: two clipped GeoJSON files at the paths above, EPSG:4326, carrying the HydroLAKES fields (`Hylak_id`, `Lake_name`, `Lake_type`, `Lake_area`, `Vol_total`, `Shore_len`) and HydroRIVERS fields (`HYRIV_ID`, `ORD_STRA`, `LENGTH_KM`) that Tasks 5 and 7 map from.

> **Note:** this task has no unit test — it produces committed data artifacts and a documented dev script. Its correctness is verified by the seed/ingest tests in later tasks (which fail loudly if the fields or geometry are wrong) and by `/run`.

- [ ] **Step 1: Write the prep script**

Create `apps/api/scripts/prep-hydrosheds.sh`. It documents the upstream source and produces the clipped files. Vietnam clip bbox: `102 8 110 24` (minX minY maxX maxY, lon/lat).

```bash
#!/usr/bin/env bash
# Regenerate the clipped HydroSHEDS seed inputs from upstream global downloads.
# Run once by a developer; NOT run in CI. Requires GDAL (ogr2ogr).
#
# Upstream (record the exact version you downloaded):
#   HydroLAKES  v1.0 polygons  — https://www.hydrosheds.org/products/hydrolakes
#   HydroRIVERS v1.0 (Asia)    — https://www.hydrosheds.org/products/hydrorivers
#
# Usage:
#   ./prep-hydrosheds.sh /path/to/HydroLAKES_polys_v10.shp /path/to/HydroRIVERS_v10_as.shp
set -euo pipefail

LAKES_SRC="${1:?path to HydroLAKES polygons shapefile}"
RIVERS_SRC="${2:?path to HydroRIVERS shapefile}"
OUT="$(dirname "$0")/../src/db/seeds/data"
BBOX="102 8 110 24"   # Vietnam extent (minX minY maxX maxY, lon/lat, EPSG:4326)

echo "Clipping HydroLAKES -> hydrolakes-vn.geojson"
ogr2ogr -f GeoJSON "$OUT/hydrolakes-vn.geojson" "$LAKES_SRC" \
  -t_srs EPSG:4326 -clipdst $BBOX \
  -select "Hylak_id,Lake_name,Lake_type,Lake_area,Vol_total,Shore_len"

# ORD_STRA filter keeps the file lean; raise the threshold if the clip is still too large.
echo "Clipping HydroRIVERS -> hydrorivers-vn.geojson"
ogr2ogr -f GeoJSON "$OUT/hydrorivers-vn.geojson" "$RIVERS_SRC" \
  -t_srs EPSG:4326 -clipdst $BBOX \
  -where "ORD_STRA >= 3" \
  -select "HYRIV_ID,ORD_STRA,LENGTH_KM"

echo "Done. Verify file sizes are reasonable before committing."
```

Make it executable: `chmod +x apps/api/scripts/prep-hydrosheds.sh`.

- [ ] **Step 2: Generate the clipped GeoJSON**

Run the script against the upstream downloads to produce the two files in `apps/api/src/db/seeds/data/`. Confirm each is valid GeoJSON with the expected properties and reasonable size (if `hydrorivers-vn.geojson` is still very large, raise the `ORD_STRA` threshold in the `-where` clause and re-run).

Sanity check (feature count + first feature's properties):
```bash
node -e "const fc=require('./apps/api/src/db/seeds/data/hydrolakes-vn.geojson');console.log(fc.features.length, Object.keys(fc.features[0].properties))"
node -e "const fc=require('./apps/api/src/db/seeds/data/hydrorivers-vn.geojson');console.log(fc.features.length, Object.keys(fc.features[0].properties))"
```
Expected: lake props include `Hylak_id, Lake_name, Lake_type, Lake_area, Vol_total, Shore_len`; river props include `HYRIV_ID, ORD_STRA, LENGTH_KM`.

- [ ] **Step 3: Document regeneration**

Add a short "Regenerating HydroSHEDS seed data" section to the README noting: the datasets (HydroLAKES v1.0, HydroRIVERS v1.0), where to download them, and `apps/api/scripts/prep-hydrosheds.sh <lakes.shp> <rivers.shp>`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/prep-hydrosheds.sh apps/api/src/db/seeds/data/hydrolakes-vn.geojson apps/api/src/db/seeds/data/hydrorivers-vn.geojson README.md
git commit -m "chore(api): clipped HydroLAKES/HydroRIVERS seed inputs + prep script"
```

---

## Task 3: `water.lakes` migration (table + versioning columns + active view)

**Files:**
- Create: `apps/api/src/db/migrations/1000000000006_lakes-schema.cjs`
- Test: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Produces: table `water.lakes` with `geom geometry(MultiPolygon,4326)`, GiST index, audit columns, `external_id integer`, attributes `lake_type text, area_km2 numeric, volume_mcm numeric, shore_len_km numeric`, `dataset_version_id uuid notNull → app.dataset_versions`, `deleted boolean notNull default false`, `unique (dataset_version_id, external_id)`, and view `water.lakes_active`. Tasks 4–8 depend on this table/view existing.

- [ ] **Step 1: Write the failing schema test**

In `apps/api/src/db/schema.test.ts`, add (match the file's existing pool/query style):

```ts
it('water.lakes exists with MultiPolygon/4326 geom and versioning columns', async () => {
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'water' AND table_name = 'lakes'
  `);
  const cols = rows.map((r) => r.column_name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'name', 'external_id', 'lake_type', 'area_km2', 'volume_mcm',
    'shore_len_km', 'geom', 'dataset_version_id', 'deleted',
  ]));

  const { rows: geo } = await pool.query(`
    SELECT type, srid FROM geometry_columns
    WHERE f_table_schema = 'water' AND f_table_name = 'lakes'
  `);
  expect(geo[0]).toMatchObject({ type: 'MULTIPOLYGON', srid: 4326 });
});

it('water.lakes_active view resolves', async () => {
  await expect(pool.query('SELECT count(*) FROM water.lakes_active')).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: FAIL — relation `water.lakes` / `water.lakes_active` does not exist.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000006_lakes-schema.cjs`. The table is created **already carrying** the versioning columns (it starts empty; the seed fills `dataset_version_id`), so no backfill DO-block is needed.

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

const COMMON = (pgm) => ({
  id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
  created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  created_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
  updated_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
});

exports.up = (pgm) => {
  const tbl = { schema: 'water', name: 'lakes' };
  pgm.createTable(tbl, {
    ...COMMON(pgm),
    name: { type: 'text' },
    external_id: { type: 'integer' },
    lake_type: { type: 'text' },
    area_km2: { type: 'numeric' },
    volume_mcm: { type: 'numeric' },
    shore_len_km: { type: 'numeric' },
    geom: { type: 'geometry(MultiPolygon, 4326)', notNull: true },
    dataset_version_id: {
      type: 'uuid', notNull: true,
      references: { schema: 'app', name: 'dataset_versions' },
    },
    deleted: { type: 'boolean', notNull: true, default: false },
  });
  pgm.createIndex(tbl, 'geom', { method: 'gist' });
  pgm.createIndex(tbl, 'dataset_version_id');
  pgm.createIndex(tbl, ['dataset_version_id', 'external_id'], { unique: true });

  pgm.sql(`
    CREATE VIEW water.lakes_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = 'lakes' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.lakes t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    SELECT * FROM resolved WHERE NOT deleted;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS water.lakes_active;');
  pgm.dropTable({ schema: 'water', name: 'lakes' });
};
```

- [ ] **Step 4: Run migrations, then the schema test**

Run: `npm run migrate -w @webatlas/api` (or the project's migrate-up command), then
`npm run test -w @webatlas/api -- src/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/1000000000006_lakes-schema.cjs apps/api/src/db/schema.test.ts
git commit -m "feat(api): water.lakes table + lakes_active view (versioned)"
```

---

## Task 4: Register `lakes` in the API layer registry

**Files:**
- Modify: `apps/api/src/layers/registry.ts`
- Test: `apps/api/src/layers/registry.test.ts`

**Interfaces:**
- Consumes: `EDITABLE_LAYER_KEYS`/`LAYER_GEOMETRY` from Task 1.
- Produces: `LAYER_REGISTRY['lakes']` with `table: 'water.lakes'`, `geomType: 'MultiPolygon'`, `attributeColumns: ['name','lake_type','area_km2','volume_mcm','shore_len_km']`, `externalIdType: 'integer'`, `geomNullable: false`. CRUD/validation is then generic for lakes.

- [ ] **Step 1: Write the failing registry test**

In `apps/api/src/layers/registry.test.ts`:

```ts
it('registers lakes with numeric external_id and its attribute columns', () => {
  const def = getLayer('lakes');
  expect(def.table).toBe('water.lakes');
  expect(def.geomType).toBe('MultiPolygon');
  expect(def.externalIdType).toBe('integer');
  expect(def.geomNullable).toBe(false);
  expect(def.attributeColumns).toEqual(
    expect.arrayContaining(['name', 'lake_type', 'area_km2', 'volume_mcm', 'shore_len_km'])
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/layers/registry.test.ts`
Expected: FAIL — `getLayer('lakes')` throws `NotFoundError` (not yet in `ATTRS`/`EXTERNAL_ID_TYPE`).

- [ ] **Step 3: Add the `lakes` registry entries**

In `apps/api/src/layers/registry.ts`, add to the `ATTRS` object:

```ts
lakes: z.object({
  name: nullableStr, lake_type: nullableStr, area_km2: nullableNum,
  volume_mcm: nullableNum, shore_len_km: nullableNum,
}),
```

and to `EXTERNAL_ID_TYPE`:

```ts
lakes: 'integer',
```

`build()` already sets `geomNullable: key === 'dams'`, so lakes is `false` automatically. No other change needed — `LAYER_REGISTRY` is built from `EDITABLE_LAYER_KEYS`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w @webatlas/api -- src/layers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/layers/registry.ts apps/api/src/layers/registry.test.ts
git commit -m "feat(api): register lakes in the layer registry (generic CRUD)"
```

---

## Task 5: Seed `lakes` as version 1 from HydroLAKES

**Files:**
- Create: `apps/api/src/db/seeds/lakeType.ts`
- Modify: `apps/api/src/db/seeds/registry.ts`
- Test: `apps/api/src/db/seeds/seed.test.ts`

**Interfaces:**
- Consumes: the clipped `hydrolakes-vn.geojson` (Task 2), the `water.lakes` table (Task 3).
- Produces: a `lakes` entry in `SEED_LAYERS`; after `runSeeds()`, `water.lakes` holds HydroLAKES rows under an active `lakes` "version 1" (`source: 'HydroLAKES v10'`).

- [ ] **Step 1: Write the `Lake_type` lookup**

Create `apps/api/src/db/seeds/lakeType.ts`:

```ts
// HydroLAKES Lake_type is a coded integer; map it to a human label.
// 1 = Lake, 2 = Reservoir, 3 = Lake control (regulated lake/reservoir).
const LAKE_TYPE_LABEL: Record<number, string> = {
  1: 'Lake',
  2: 'Reservoir',
  3: 'Lake control',
};

export function lakeTypeLabel(code: unknown): string | null {
  return typeof code === 'number' ? (LAKE_TYPE_LABEL[code] ?? null) : null;
}
```

- [ ] **Step 2: Write the failing seed test**

In `apps/api/src/db/seeds/seed.test.ts`, add (match the file's existing structure — it runs `runSeeds()` / uses a pool):

```ts
it('seeds lakes as an active version 1 from HydroLAKES', async () => {
  const { rows: feat } = await pool.query('SELECT count(*)::int AS n FROM water.lakes_active');
  expect(feat[0].n).toBeGreaterThan(0);

  const { rows: ver } = await pool.query(`
    SELECT source, label, is_active FROM app.dataset_versions
    WHERE layer_key = 'lakes' AND is_active
  `);
  expect(ver[0]).toMatchObject({ source: 'HydroLAKES v10', label: 'version 1', is_active: true });

  // Attribute mapping landed: at least one lake has a mapped type + area.
  const { rows: sample } = await pool.query(`
    SELECT lake_type, area_km2 FROM water.lakes_active WHERE lake_type IS NOT NULL LIMIT 1
  `);
  expect(sample[0].area_km2).not.toBeNull();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/seeds/seed.test.ts`
Expected: FAIL — no `lakes` version exists yet (seed registry has no `lakes` entry).

- [ ] **Step 4: Add the `lakes` seed entry**

In `apps/api/src/db/seeds/registry.ts`, import the lookup at the top:

```ts
import { lakeTypeLabel } from './lakeType';
```

and add to `SEED_LAYERS`:

```ts
{
  table: 'lakes',
  file: resolve(seedData, 'hydrolakes-vn.geojson'),
  source: 'HydroLAKES v10',
  multiPolygon: true,
  columns: (p) => ({
    external_id: p.Hylak_id,
    name: p.Lake_name,
    lake_type: lakeTypeLabel(p.Lake_type),
    area_km2: p.Lake_area,
    volume_mcm: p.Vol_total,
    shore_len_km: p.Shore_len,
  }),
},
```

- [ ] **Step 5: Re-run the seed, then the test**

Run the seed (`npm run seed -w @webatlas/api`), then
`npm run test -w @webatlas/api -- src/db/seeds/seed.test.ts`
Expected: PASS. (If the test harness seeds automatically per its setup, just run the test.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/seeds/lakeType.ts apps/api/src/db/seeds/registry.ts apps/api/src/db/seeds/seed.test.ts
git commit -m "feat(api): seed lakes v1 from clipped HydroLAKES"
```

---

## Task 6: Publish `lakes` to GeoServer

**Files:**
- Modify: `apps/api/src/geoserver/publish.ts`
- Test: `apps/api/src/geoserver/publish.test.ts`

**Interfaces:**
- Consumes: `water.lakes_active` view (Task 3).
- Produces: `webatlas:lakes` featuretype pointed at `lakes_active`.

- [ ] **Step 1: Write the failing publish test**

In `apps/api/src/geoserver/publish.test.ts`, extend the existing coverage so `lakes` is among the published tables pointing at its `_active` view. Match the file's existing assertion style; for example, if it asserts the `TABLES` set or the published nativeName:

```ts
it('includes lakes pointed at the lakes_active view', () => {
  expect(PUBLISHED_TABLES).toContain('lakes'); // or the file's equivalent assertion
});
```

(If `publish.test.ts` mocks `gsRequest` and asserts calls, add a `lakes` expectation in the same shape as the existing `rivers`/`dams` assertions, expecting `nativeName: 'lakes_active'`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/geoserver/publish.test.ts`
Expected: FAIL — `lakes` not in the published set.

- [ ] **Step 3: Add `lakes` to `TABLES`**

In `apps/api/src/geoserver/publish.ts`, add `'lakes'` to the `TABLES` array:

```ts
const TABLES = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];
```

`ensureLayer('lakes')` already points the featuretype at `lakes_active` (it derives `view = ${table}_active`). No other change.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w @webatlas/api -- src/geoserver/publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/geoserver/publish.ts apps/api/src/geoserver/publish.test.ts
git commit -m "feat(api): publish webatlas:lakes (active-version view)"
```

---

## Task 7: Ingest HydroRIVERS as `rivers` version 2 and activate

**Files:**
- Create: `apps/api/src/db/seeds/ingestRivers.ts`
- Test: `apps/api/src/modules/versions/integration.test.ts`

**Interfaces:**
- Consumes: `versionsService` (`createIngestVersion`, `activate`, `getActiveVersionId`, `resolveFeatureIds`), `loadLayerFeatures` (from `db/seeds/run.ts`), the clipped `hydrorivers-vn.geojson` (Task 2).
- Produces: an exported `ingestHydroRivers(): Promise<{ versionId: string; count: number }>` that, run against a DB already holding `rivers` v1 (thuyhe), creates an **ingest**-kind `rivers` version from HydroRIVERS, activates it, and is idempotent (a second run detects the existing HydroRIVERS version by source and no-ops).

- [ ] **Step 1: Write the failing integration test**

In `apps/api/src/modules/versions/integration.test.ts`, add:

```ts
it('ingests HydroRIVERS as rivers v2, flips active, leaves thuyhe v1 addressable', async () => {
  const pool = getPool();
  const svc = versionsService(pool);
  const { ingestHydroRivers } = await import('../../db/seeds/ingestRivers');

  const thuyheV1 = await svc.getActiveVersionId('rivers');
  expect(thuyheV1).not.toBeNull();
  const thuyheIds = await svc.resolveFeatureIds('rivers', thuyheV1!);

  const { versionId } = await ingestHydroRivers();

  // New version is active + ingest-kind.
  const active = await svc.getActiveVersionId('rivers');
  expect(active).toBe(versionId);
  const v = await svc.getVersion(versionId);
  expect(v).toMatchObject({ kind: 'ingest', source: 'HydroRIVERS v10', is_active: true });

  // rivers_active now resolves to HydroRIVERS rows, not the old thuyhe set.
  const newIds = await svc.resolveFeatureIds('rivers', versionId);
  expect(newIds.length).toBeGreaterThan(0);

  // thuyhe v1 still addressable with its original feature set.
  expect(await svc.resolveFeatureIds('rivers', thuyheV1!)).toEqual(thuyheIds);

  // Idempotent: a second ingest doesn't create a duplicate active v2.
  const second = await ingestHydroRivers();
  expect(second.versionId).toBe(versionId);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/versions/integration.test.ts`
Expected: FAIL — module `../../db/seeds/ingestRivers` not found.

- [ ] **Step 3: Write the ingest script**

Create `apps/api/src/db/seeds/ingestRivers.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { getPool, closePool } from '../pool';
import { versionsService } from '../../modules/versions/service';
import { loadLayerFeatures } from './run';
import type { SeedLayer } from './registry';

const here = fileURLToPath(new URL('.', import.meta.url));
const HYDRORIVERS_SOURCE = 'HydroRIVERS v10';

// HydroRIVERS → the existing `rivers` columns. No per-segment names in the source.
const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/hydrorivers-vn.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    external_id: p.HYRIV_ID,
    code: null,
    name: null,
    stream_order: p.ORD_STRA,
    length_m: typeof p.LENGTH_KM === 'number' ? p.LENGTH_KM * 1000 : null,
  }),
};

/**
 * Ingest HydroRIVERS as a new active `rivers` version, off the versioning foundation.
 * Idempotent: if a HydroRIVERS ingest version already exists, return it without
 * creating a duplicate (so re-running is safe).
 */
export async function ingestHydroRivers(): Promise<{ versionId: string; count: number }> {
  const pool = getPool();
  const svc = versionsService(pool);

  const existing = await pool.query(
    `SELECT id, feature_count FROM app.dataset_versions
     WHERE layer_key = 'rivers' AND source = $1 AND kind = 'ingest'
     ORDER BY ingested_at DESC LIMIT 1`,
    [HYDRORIVERS_SOURCE]
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id as string;
    // Ensure it's the active version, then return it.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await svc.activate(client, 'rivers', id);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { versionId: id, count: existing.rows[0].feature_count ?? 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const versionId = await svc.createIngestVersion(client, {
      layerKey: 'rivers',
      source: HYDRORIVERS_SOURCE,
    });
    const count = await loadLayerFeatures(client, RIVERS_HYDRO_LAYER, versionId);
    await client.query(
      `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
      [count, versionId]
    );
    await svc.activate(client, 'rivers', versionId);
    await client.query('COMMIT');
    return { versionId, count };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Run directly (npm run ingest:rivers), not when imported.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  ingestHydroRivers()
    .then((r) => { console.log(`rivers HydroRIVERS version ${r.versionId}: ${r.count} features`); return closePool(); })
    .catch((err) => { console.error(err); process.exitCode = 1; return closePool(); });
}
```

Add an `ingest:rivers` script to `apps/api/package.json` mirroring the existing `seed` script's runner (e.g. `"ingest:rivers": "tsx src/db/seeds/ingestRivers.ts"` — match the exact runner the `seed` script uses).

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/versions/integration.test.ts`
Expected: PASS.

> **Note on `getVersion` shape:** the test asserts `kind`, `source`, `is_active` on `svc.getVersion(...)`. If `getVersion` returns snake_case columns, adjust the `toMatchObject` keys to match the repository's actual return shape (check `versions/repository.ts`); keep the three asserted facts.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/seeds/ingestRivers.ts apps/api/package.json apps/api/src/modules/versions/integration.test.ts
git commit -m "feat(api): ingest HydroRIVERS as active rivers v2 (thuyhe stays v1)"
```

---

## Task 8: Lakes style + rivers stream-order re-tuning (frontend)

**Files:**
- Modify: `apps/web/src/features/map/model/styles.ts`
- Test: `apps/web/src/features/map/model/styles.test.ts`

**Interfaces:**
- Produces: exported `lakesStyle` (a `Style` with both Fill and Stroke); re-tuned `RIVER_WIDTHS`/`riverBucket()` so higher Strahler order → wider stroke. `MapModel` (Task 9) imports `lakesStyle`.

- [ ] **Step 1: Write the failing style tests**

In `apps/web/src/features/map/model/styles.test.ts`, add:

```ts
import { lakesStyle, riversStyle } from './styles';
import { Fill, Stroke } from 'ol/style';

it('lakesStyle has a blue fill and a stroke', () => {
  expect(lakesStyle.getFill()).toBeInstanceOf(Fill);
  expect(lakesStyle.getStroke()).toBeInstanceOf(Stroke);
});

it('rivers get wider as Strahler order increases', () => {
  const widthFor = (order: number) => {
    const styles = riversStyle({ get: (k: string) => (k === 'streamOrder' ? order : undefined) });
    // main (core) stroke is the last style in the paired array
    return styles[styles.length - 1].getStroke().getWidth();
  };
  expect(widthFor(8)).toBeGreaterThan(widthFor(2));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/map/model/styles.test.ts`
Expected: FAIL — `lakesStyle` is not exported; and with the current `riverBucket`, order 8 falls into the thin default bucket, so `widthFor(8) > widthFor(2)` is false.

- [ ] **Step 3: Add `lakesStyle` and re-tune river widths**

In `apps/web/src/features/map/model/styles.ts`:

Add the lakes style (near the other static styles like `floodStyle`):

```ts
export const lakesStyle = new Style({
  fill: new Fill({ color: 'rgba(56, 189, 248, 0.35)' }),  // sky-400, translucent water
  stroke: new Stroke({ color: '#0284c7', width: 1 }),      // sky-600 shoreline
});
```

Re-tune the river order→width mapping for Strahler order (higher = wider). Replace `RIVER_WIDTHS` and `riverBucket`:

```ts
// Strahler stream-order -> [border width, core width]. Higher order = larger river = wider.
// Bucket 0 is the "everything else / headwaters" thin default.
const RIVER_WIDTHS: Record<number, [number, number]> = {
  3: [7, 3.5],   // major rivers (order >= 6)
  2: [5, 2.2],   // order 4–5
  1: [3, 1.2],   // order 3
  0: [1.5, 0.5], // order <= 2 / unknown
};

function riverBucket(order: number): 0 | 1 | 2 | 3 {
  if (order >= 6) return 3;
  if (order >= 4) return 2;
  if (order === 3) return 1;
  return 0;
}
```

The `RIVER_STYLES` and `RIVER_SELECT_STYLES` precompute loops already iterate `[0,1,2,3]` and read `RIVER_WIDTHS[b]`, so they pick up the new widths with no other change. `riversStyle`/`makeRiverSelectStyle` still read `feature.get('streamOrder')` and call `riverBucket()`.

> Note: the WFS attribute is `stream_order`; the frontend reads it as `streamOrder`. This mapping already exists for thuyhe and is unchanged — HydroRIVERS populates the same `stream_order` column, so no wiring change is needed here.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w @webatlas/web -- src/features/map/model/styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/styles.ts apps/web/src/features/map/model/styles.test.ts
git commit -m "feat(web): lakesStyle + Strahler-order river widths"
```

---

## Task 9: Wire the `lakes` WFS layer into the map

**Files:**
- Modify: `apps/web/src/features/map/model/MapModel.ts`

**Interfaces:**
- Consumes: `lakesStyle` (Task 8), `createWfsVectorSource('lakes')` (the WFS source keys off the layer key; `lakes` is a valid key via Task 1), `webatlas:lakes` published (Task 6).
- Produces: a `layer_lakes` VectorLayer in the map, drawn **below** rivers.

- [ ] **Step 1: Add the import**

In `apps/web/src/features/map/model/MapModel.ts`, add `lakesStyle` to the existing style import block:

```ts
import {
  provincesStyle,
  wardsStyle,
  riversStyle,
  lakesStyle,
  stationsStyle,
  // …rest unchanged
} from './styles';
```

- [ ] **Step 2: Create the lakes layer**

In `init()`, alongside the other `mkWfs(...)` calls (after `riversLayer` is created, before/near the other thematic layers):

```ts
const lakesLayer = mkWfs('layer_lakes', 'lakes', lakesStyle);
```

- [ ] **Step 3: Add it to the map's layer array below rivers**

In the `new Map({ layers: [...] })` array, insert `lakesLayer` **immediately before** `riversLayer` so river lines draw on top of lake fills:

```ts
layers: [
  initialBasemap,
  provincesLayer,
  wardsLayer,
  floodLayer,
  lakesLayer,
  riversLayer,
  damsLayer,
  stationsLayer,
  droughtSurveyLayer,
  saltwaterIntrusionLayer,
  floodGenerationLayer
],
```

- [ ] **Step 4: Verify the web build + full web suite**

Run: `npm run build:web` — Expected: clean (`tsc -b && vite build`).
Run: `npm run test -w @webatlas/web` — Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/map/model/MapModel.ts
git commit -m "feat(web): render the lakes WFS layer below rivers"
```

---

## Task 10: Full-suite verification + manual `/run`

**Files:** none (verification only).

- [ ] **Step 1: Run the full API suite**

Run: `npm run test -w @webatlas/api`
Expected: all green (schema, seed, registry, versions integration, publish).

- [ ] **Step 2: Run the full web suite + build**

Run: `npm run test -w @webatlas/web` and `npm run build:web`
Expected: all green; build clean.

- [ ] **Step 3: Run lint**

Run: `npm run lint:web` and the API lint command.
Expected: exit 0 (no new error-level issues).

- [ ] **Step 4: Manual `/run` against real data (required — the exit criterion)**

Bring up the stack (`docker compose up` for PostGIS + GeoServer + API), seed, ingest rivers (`npm run ingest:rivers -w @webatlas/api`), publish (`npm run publish:geoserver -w @webatlas/api`), and launch the web app (`npm run dev:web`). Confirm visually:

1. **Lakes** render as **bright-blue filled water bodies** over the basemap (not the basemap's faint fill), appear in the layer panel, and show attribute popups on click.
2. **HydroRIVERS** traces **real watercourses**, with **major rivers visibly wider** than headwater streams (Strahler-order widths working).
3. The rivers-highlight click still works and the map's other layers are unaffected.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: hydrosheds hydrology data verification"
```

---

## Self-Review

**Spec coverage:**
- §2 offline prep → Task 2. ✅
- §3 lakes end-to-end: shared keys (Task 1), migration + versioning cols + view (Task 3), registry (Task 4), seed v1 (Task 5), GeoServer publish (Task 6). ✅
- §4 rivers replacement as new active ingest version, thuyhe stays v1, attribute mapping, Strahler style re-tuning, idempotent invoke (Task 7 + Task 8). ✅
- §5 frontend: `lakesStyle` (Task 8), layer wiring below rivers (Task 9), rivers re-tuning (Task 8). ✅
- §6 testing: schema/seed/registry/versions/publish API tests (Tasks 3–7), style unit test (Task 8), manual `/run` (Task 10). ✅
- §7 exit criteria → Task 10 Step 4. ✅
- Out-of-scope (#4 relationships, timeline UI) — no tasks, correct. ✅

**Type consistency:** `ingestHydroRivers()` return `{ versionId, count }` used consistently (Task 7). `lakesStyle` exported (Task 8) and imported (Task 9). `SeedLayer` shape matches `registry.ts` (`table`, `file`, `source`, `multiPolygon`/`multiLine`, `columns`). Registry `attributeColumns` derived from the `ATTRS` zod object keys — matches the migration column names (`lake_type`, `area_km2`, `volume_mcm`, `shore_len_km`). `stream_order` (DB) ↔ `streamOrder` (frontend feature prop) mapping noted as pre-existing/unchanged.

**Placeholder scan:** no TBD/TODO; every code step shows real code; test bodies are concrete. Two "match the file's existing style" notes (publish.test.ts assertion shape, getVersion return shape) are genuine adaptation points with the required facts specified, not deferrals.
