# Reference Layers, Named Entities and Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the unversioned `basemap` reference layers (roads, railways, water, landuse, places) a read-only API path, a dissolved named-entity table, trigram search, and the ability to act as an analysis ROI.

**Architecture:** A reference registry (`src/reference/registry.ts`) mirrors `src/layers/registry.ts` as the only place a reference layer key becomes SQL. A migration owns `basemap.reference_entities`; an idempotent builder script dissolves each layer by `coalesce(ref, name)` plus a DBSCAN spatial cluster and repopulates it. Search and the analysis ROI both read the dissolved entity table, never the raw 527k-row segment tables.

**Tech Stack:** TypeScript, Fastify, PostGIS 3.4, node-pg-migrate, Zod, Vitest (API integration tests hit the live dev DB), React + Vitest (web).

## Global Constraints

Copied from `docs/superpowers/specs/2026-09-18-entity-model-networks-and-roi-design.md` §4 and the project's standing invariants:

- In scope: `roads_region`, `railways_vn`, `water_region`, `landuse_region`, `places_region`. **Out:** `dem_region`, `contours`, and the `*_vn` national duplicates `roads_vn` / `places_vn`.
- The reference registry is the **only** place a reference layer key becomes SQL — same rule as `layerTable()`.
- Reference layers are **read-only**. No edit path, no versioning, no `external_id`, no `deleted` column. Their geometry column is `geometry`, not `geom`.
- `basemap.reference_entities` has **exactly one writer** (the builder) and is rebuilt whenever the loader runs.
- The `webatlas_assistant` SQL role gains **nothing**. `run_sql` must still not see `basemap`, as migration 8 intended. Assistant access to reference layers is by typed tools on the app pool only (typed tools land in Phase 5, not here).
- ROI from a reference entity is **clipped to the working region** and refused past a size limit, with a message that says **which** limit was hit.
- Named-entity dissolve only. **No road noding, no routing, no pgRouting** (§6 defers it).
- Vietnamese user-facing error messages, matching the existing `ValidationError` / `NotFoundError` copy. Commit messages in Vietnamese; code comments and docs in English.
- Analysis stays inside the existing 5-second `ANALYSIS_TIMEOUT_MS` budget and the small analysis pool.

### Two deliberate deviations from the spec's letter

Both are refinements the spec's own goals imply; record them in the architecture doc (Task 8).

1. **No trigram indexes on the raw `basemap` tables.** §4 calls for trigram indexes on `roads_region.name`/`.ref`, `landuse_region.name`, `water_region.name`, `railways_vn.name`, `places_region.name`. But `load_basemap.py` writes with `GeoPandas.to_postgis(..., if_exists="replace")`, which **drops and recreates** each table — a migration-created index on them silently disappears on the next basemap load. Searching the *dissolved* entity table is also strictly better behaviour: "Quốc lộ 14" should be one hit, not 3,000 segment hits. So the trigram index lives on `basemap.reference_entities.name`/`.ref`, which the migration owns and the loader never touches. The builder reads the raw tables with a one-off sequential scan (measured: 1.15s on roads), which needs no index.
2. **`places` is dissolved but rarely merges.** Places are points with 6,075 names over 4,025 distinct keys; DBSCAN still applies so duplicates of the same settlement name in one cluster collapse, and `population` is summed into `attrs`.
3. **OSM `ref` is multi-valued and must be unnested.** §4 says to group by `coalesce(ref, name)`, but the live data makes a literal reading wrong — see the next section.

### The `ref` column is semicolon-separated (measured, not assumed)

`basemap.roads_region.ref` does not hold one route number per row. Measured 2026-09-22: **930 rows carry a compound ref** across **39 distinct compound values**, out of 348 distinct ref values in total. The format also uses a dot — `QL.14`, not `QL14`.

```
 ref         |  n
-------------+------
 QL.1        | 1612
 CT.01       | 1504
 QL.14;HCM   |  513
 QL.40B      |  237
 CT.01;CT.02 |  151
```

`QL.14;HCM` means that stretch of road carries **both** Quốc lộ 14 and the Hồ Chí Minh route. Grouping on the raw string would split Quốc lộ 14 into one entity for `QL.14` and another for `QL.14;HCM` — an artefact of OSM tagging, not a fact about the road, and exactly the "one river is many rows" failure §4 exists to fix.

So the builder **unnests** `ref` on `;`, trims each token, and treats each token as its own entity key. A segment may therefore be a member of more than one entity, which is correct: it really does carry both routes.

Verified with the unnest in place:

```
 entity_key | cluster_id |  n  |  km
------------+------------+-----+-------
 QL.14      |          0 | 621 | 997.7
 HCM        |          0 | 552 | 856.0
 QL.26      |          0 |  91 | 169.4
 HCM        |          1 |  13 |  47.4
```

Quốc lộ 14 comes out as a single ~998 km entity, matching the real road; the Hồ Chí Minh route gets its own, sharing the 513 overlapping segments; and DBSCAN correctly splits off a disjoint 47 km stretch of HCM rather than welding it on.

### Measured ground truth (dev DB, 2026-09-22)

Use these as the expected orders of magnitude in tests; do not hardcode exact counts, because a basemap reload changes them.

| Table | Rows | Named | Distinct `coalesce(ref,name)` |
|---|---|---|---|
| `basemap.roads_region` | 527,215 | 32,864 | 8,882 |
| `basemap.railways_vn` | 3,736 | 2,282 | 138 |
| `basemap.water_region` | 5,848 | 676 | 572 |
| `basemap.landuse_region` | 12,075 | 788 | 759 |
| `basemap.places_region` | 6,145 | 6,075 | 4,025 |

The last column is **not** the entity count. With the ref unnest and the DBSCAN split, `roads` actually produces **13,354 entities over 34,190 member rows** — more than the distinct-key count, because spatially disjoint groups sharing a name become separate entities. There are hundreds of unrelated streets called "Đường số 1" in different towns, and they *should* be separate. Expect entity counts of this order:

Actual entity counts, measured from a real build on 2026-09-22:

| Layer | Entities | Distinct keys | Split off by DBSCAN |
|---|---|---|---|
| `roads` | 13,354 | 8,848 | 4,506 |
| `railways` | 203 | 138 | 65 |
| `water` | 597 | 572 | 25 |
| `landuse` | 770 | 759 | 11 |
| `places` | 5,989 | 4,025 | 1,964 |

Every layer produces **more** entities than distinct keys, and that is the design working. The clearest case is `places`: the key `Thôn 3` ("Hamlet 3") forms **147 separate clusters** — 147 genuinely different hamlets in different communes, which must not be welded into one entity. Do not "fix" a count that exceeds its distinct-key count.

Full build wall time: **5.6s** for all five layers.

All five tables today have only `idx_<table>_geometry` (GiST) and `<table>_fclass_idx` (btree). `pg_trgm` is installed. `roads_region` columns: `osm_id text, code integer, fclass text, name text, ref text, oneway text, maxspeed integer, bridge text, tunnel text, geometry geometry(LineString,4326)`. `places_region` carries `population bigint`. `water_region` and `landuse_region` are `geometry(Geometry,4326)`.

## File Structure

**Create:**
- `apps/api/src/reference/registry.ts` — the reference registry. One responsibility: key → table/columns/kind. No DB access.
- `apps/api/src/reference/registry.test.ts` — pure unit tests.
- `apps/api/src/db/migrations/1000000000017_reference-entities.cjs` — creates `basemap.reference_entities` and its indexes.
- `apps/api/src/db/referenceEntities.ts` — the dissolve builder. The single writer of that table.
- `apps/api/src/db/referenceEntities.test.ts` — integration tests against the live dev DB.
- `apps/api/src/scripts/buildReference.ts` — CLI entry for `npm run reference:build`.
- `apps/api/src/modules/reference/repository.ts` — reads of `reference_entities`.
- `apps/api/src/modules/reference/controller.ts` — request validation + shaping.
- `apps/api/src/modules/reference/routes.ts` — route registration.
- `apps/api/src/modules/reference/reference.test.ts` — API integration tests.

**Modify:**
- `apps/api/src/server.ts` — register `referenceRoutes`.
- `apps/api/package.json` — add the `reference:build` script.
- `apps/api/src/modules/search/repository.ts` — add reference sources to the union.
- `apps/api/src/modules/search/service.ts`, `controller.ts` — accept and pass `sources`.
- `apps/api/src/modules/analysis/schemas.ts` — `ReferenceRef` and the three-way exclusive input.
- `apps/api/src/modules/analysis/area.ts` — resolve a reference entity into a geometry, clipped and limited.
- `apps/web/src/features/search/api/search.api.ts` — `source` on `SearchHit`, pass `sources`.
- `apps/web/src/features/search/ui/SearchBox.view.tsx` — render the source badge.
- `apps/web/src/features/search/index.tsx` — zoom-only behaviour for reference hits.
- `docs/architecture/database-architecture.md`, `docs/runbooks/README.md`, API docs — Task 8.

---

### Task 1: Reference registry

Pure TypeScript, no database. This is the choke point every later task imports, so it lands first and alone.

**Files:**
- Create: `apps/api/src/reference/registry.ts`
- Test: `apps/api/src/reference/registry.test.ts`

**Interfaces:**
- Consumes: `NotFoundError` from `apps/api/src/errors`.
- Produces:
  - `REFERENCE_LAYER_KEYS: readonly ['roads','railways','water','landuse','places']`
  - `type ReferenceLayerKey`
  - `interface ReferenceLayerDef { key, table, geomColumn, idColumn, nameColumn, refColumn, classColumn, summable, geomKind }`
  - `REFERENCE_REGISTRY: Record<ReferenceLayerKey, ReferenceLayerDef>`
  - `getReferenceLayer(key: string): ReferenceLayerDef` — throws `NotFoundError`
  - `listReferenceMetadata(): Array<{ key, geomKind, classColumn, summable }>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/reference/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../errors';
import {
  REFERENCE_LAYER_KEYS,
  REFERENCE_REGISTRY,
  getReferenceLayer,
  listReferenceMetadata,
} from './registry';

describe('reference registry', () => {
  it('covers exactly the five in-scope layers', () => {
    expect([...REFERENCE_LAYER_KEYS].sort()).toEqual(
      ['landuse', 'places', 'railways', 'roads', 'water']
    );
  });

  it('maps every key to a basemap table with the basemap column names', () => {
    for (const key of REFERENCE_LAYER_KEYS) {
      const def = REFERENCE_REGISTRY[key];
      expect(def.key).toBe(key);
      expect(def.table).toMatch(/^basemap\.[a-z_]+$/);
      // basemap tables name the geometry column `geometry`, not `geom`.
      expect(def.geomColumn).toBe('geometry');
      expect(def.idColumn).toBe('osm_id');
      expect(def.nameColumn).toBe('name');
      expect(def.classColumn).toBe('fclass');
    }
  });

  it('excludes the national duplicates and the raster/derived layers', () => {
    const tables = REFERENCE_LAYER_KEYS.map((k) => REFERENCE_REGISTRY[k].table);
    expect(tables).not.toContain('basemap.roads_vn');
    expect(tables).not.toContain('basemap.places_vn');
    expect(tables).not.toContain('basemap.dem_region');
    expect(tables).not.toContain('basemap.contours');
  });

  it('uses the region tables, except railways which has no region variant', () => {
    expect(REFERENCE_REGISTRY.roads.table).toBe('basemap.roads_region');
    expect(REFERENCE_REGISTRY.water.table).toBe('basemap.water_region');
    expect(REFERENCE_REGISTRY.landuse.table).toBe('basemap.landuse_region');
    expect(REFERENCE_REGISTRY.places.table).toBe('basemap.places_region');
    expect(REFERENCE_REGISTRY.railways.table).toBe('basemap.railways_vn');
  });

  it('declares ref only where the column exists', () => {
    // Only the roads shapefile carries `ref` (route numbers like QL14).
    expect(REFERENCE_REGISTRY.roads.refColumn).toBe('ref');
    expect(REFERENCE_REGISTRY.railways.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.water.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.landuse.refColumn).toBeUndefined();
    expect(REFERENCE_REGISTRY.places.refColumn).toBeUndefined();
  });

  it('declares population summable on places only', () => {
    expect(REFERENCE_REGISTRY.places.summable).toEqual(['population']);
    for (const key of ['roads', 'railways', 'water', 'landuse'] as const) {
      expect(REFERENCE_REGISTRY[key].summable).toEqual([]);
    }
  });

  it('declares the geometry kind, which decides whether an ROI needs a radius', () => {
    expect(REFERENCE_REGISTRY.roads.geomKind).toBe('line');
    expect(REFERENCE_REGISTRY.railways.geomKind).toBe('line');
    expect(REFERENCE_REGISTRY.places.geomKind).toBe('point');
    expect(REFERENCE_REGISTRY.water.geomKind).toBe('area');
    expect(REFERENCE_REGISTRY.landuse.geomKind).toBe('area');
  });

  it('getReferenceLayer rejects an unknown key', () => {
    expect(() => getReferenceLayer('dams')).toThrow(NotFoundError);
    expect(() => getReferenceLayer('roads_vn')).toThrow(NotFoundError);
    expect(getReferenceLayer('roads').table).toBe('basemap.roads_region');
  });

  it('listReferenceMetadata returns one entry per key', () => {
    const meta = listReferenceMetadata();
    expect(meta).toHaveLength(REFERENCE_LAYER_KEYS.length);
    expect(meta.map((m) => m.key).sort()).toEqual([...REFERENCE_LAYER_KEYS].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/reference/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/reference/registry.ts`:

```ts
import { NotFoundError } from '../errors';

/**
 * The `basemap` reference layers, per spec §4.
 *
 * These are NOT the editable water layers. They are unversioned, have no
 * `external_id` and no `deleted` column, name their geometry column `geometry`
 * rather than `geom`, and are created by `apps/api/scripts/basemap/load_basemap.py`
 * rather than by a migration. They get their own read-only path, and this file is
 * the only place a reference layer key becomes SQL — the same rule `layerTable()`
 * follows for water.
 *
 * Out of scope on purpose: `dem_region` and `contours` (raster/derived, already
 * served by the elevation ops), and the `*_vn` national duplicates `roads_vn` /
 * `places_vn`, which would confuse a region-scoped atlas. `railways_vn` IS in
 * scope despite the `_vn` suffix because the loader builds no region variant of it.
 */
export const REFERENCE_LAYER_KEYS = ['roads', 'railways', 'water', 'landuse', 'places'] as const;
export type ReferenceLayerKey = (typeof REFERENCE_LAYER_KEYS)[number];

/** Decides whether an ROI built from this layer needs a radius to become an area. */
export type ReferenceGeomKind = 'line' | 'point' | 'area';

export interface ReferenceLayerDef {
  key: ReferenceLayerKey;
  /** Schema-qualified; always `basemap.*`. */
  table: string;
  /** basemap tables name it `geometry`; water names it `geom`. */
  geomColumn: 'geometry';
  idColumn: 'osm_id';
  nameColumn: 'name';
  /** Only roads carry OSM `ref` (route numbers such as QL14). */
  refColumn?: 'ref';
  /** Classification column every loader table has; SLD rules filter on it. */
  classColumn: 'fclass';
  /** Numeric columns an aggregate may sum over the members of an entity. */
  summable: string[];
  geomKind: ReferenceGeomKind;
}

function def(
  key: ReferenceLayerKey,
  table: string,
  geomKind: ReferenceGeomKind,
  extra: { refColumn?: 'ref'; summable?: string[] } = {}
): ReferenceLayerDef {
  return {
    key,
    table,
    geomColumn: 'geometry',
    idColumn: 'osm_id',
    nameColumn: 'name',
    classColumn: 'fclass',
    summable: extra.summable ?? [],
    geomKind,
    ...(extra.refColumn ? { refColumn: extra.refColumn } : {}),
  };
}

export const REFERENCE_REGISTRY: Record<ReferenceLayerKey, ReferenceLayerDef> = {
  roads: def('roads', 'basemap.roads_region', 'line', { refColumn: 'ref' }),
  railways: def('railways', 'basemap.railways_vn', 'line'),
  water: def('water', 'basemap.water_region', 'area'),
  landuse: def('landuse', 'basemap.landuse_region', 'area'),
  places: def('places', 'basemap.places_region', 'point', { summable: ['population'] }),
};

export function getReferenceLayer(key: string): ReferenceLayerDef {
  const found = (REFERENCE_REGISTRY as Record<string, ReferenceLayerDef | undefined>)[key];
  if (!found) throw new NotFoundError('Không có lớp tham chiếu này');
  return found;
}

export function listReferenceMetadata(): Array<{
  key: ReferenceLayerKey;
  geomKind: ReferenceGeomKind;
  classColumn: string;
  summable: string[];
}> {
  return REFERENCE_LAYER_KEYS.map((key) => {
    const d = REFERENCE_REGISTRY[key];
    return { key, geomKind: d.geomKind, classColumn: d.classColumn, summable: d.summable };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/reference/registry.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reference/registry.ts apps/api/src/reference/registry.test.ts
git commit -m "feat(api): sổ đăng ký lớp tham chiếu basemap"
```

---

### Task 2: Migration for `basemap.reference_entities`

Schema only — no population. A migration owns this table (not the loader) because the loader replaces only its own seven tables, so `reference_entities` survives a basemap reload; that also makes it the safe home for the trigram index.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000017_reference-entities.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (migration files are plain CommonJS, outside the TS build).
- Produces: table `basemap.reference_entities` with columns
  `entity_id text PK, layer_key text, entity_key text, cluster_id integer, name text, ref text, fclass text, member_ids text[], member_count integer, attrs jsonb, geom geometry(Geometry,4326), built_at timestamptz`.
  Task 3 populates it; Tasks 4–7 read it.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/db/migrations/1000000000017_reference-entities.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * basemap.reference_entities — the dissolved named entities of spec §4.
 *
 * WHY A MIGRATION OWNS THIS TABLE, NOT THE LOADER
 * `scripts/basemap/load_basemap.py` writes with GeoPandas
 * `to_postgis(..., if_exists="replace")`, which DROPS and recreates each table it
 * loads. Anything created on those tables by a migration — a trigram index, a
 * constraint — silently disappears on the next basemap load. This table is not one
 * the loader writes, so it survives, which makes it the only safe home for the
 * trigram index that search depends on.
 *
 * It also means search should hit the dissolved entities rather than the raw
 * segments: "Quốc lộ 14" is one entity over ~3k road rows, and one hit is the
 * useful answer. So there is deliberately NO trigram index on basemap.roads_region
 * and friends; the builder's one-off sequential scan needs none.
 *
 * ONE WRITER: apps/api/src/db/referenceEntities.ts. Unlike the water layers there
 * is no edit path, so the derived table has exactly one writer and is rebuilt whole
 * per layer.
 *
 * NO GRANT to webatlas_assistant. Migration 8 deliberately withholds USAGE on the
 * basemap schema so `run_sql` cannot reach it; this table stays behind that line,
 * and assistant access to reference layers is by typed tools on the app pool.
 */
exports.up = (pgm) => {
  pgm.sql('CREATE SCHEMA IF NOT EXISTS basemap;');

  pgm.sql(`
    CREATE TABLE basemap.reference_entities (
      -- '<layer_key>:<md5(entity_key)>:<cluster_id>' — deterministic, so an entity
      -- keeps its id across rebuilds as long as its name/ref and cluster hold.
      entity_id    text PRIMARY KEY,
      layer_key    text NOT NULL,
      -- coalesce(ref, name): the dissolve key.
      entity_key   text NOT NULL,
      -- ST_ClusterDBSCAN group within entity_key: two roads sharing a ref but far
      -- apart are two entities, not one sprawling multipart geometry.
      cluster_id   integer NOT NULL,
      name         text,
      ref          text,
      fclass       text,
      member_ids   text[] NOT NULL,
      member_count integer NOT NULL,
      -- Summed values for the registry's summable columns, e.g. {"population": 51234}.
      attrs        jsonb NOT NULL DEFAULT '{}'::jsonb,
      geom         geometry(Geometry, 4326) NOT NULL,
      built_at     timestamptz NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    ALTER TABLE basemap.reference_entities
      ADD CONSTRAINT reference_entities_natural_key UNIQUE (layer_key, entity_key, cluster_id);
  `);

  pgm.sql('CREATE INDEX reference_entities_geom_idx ON basemap.reference_entities USING GIST (geom);');
  pgm.sql('CREATE INDEX reference_entities_layer_idx ON basemap.reference_entities (layer_key);');
  pgm.sql('CREATE INDEX reference_entities_fclass_idx ON basemap.reference_entities (layer_key, fclass);');

  // The search path. pg_trgm is installed by migration 7.
  pgm.sql(`
    CREATE INDEX reference_entities_name_trgm_idx
      ON basemap.reference_entities USING GIN (name gin_trgm_ops);
  `);
  pgm.sql(`
    CREATE INDEX reference_entities_ref_trgm_idx
      ON basemap.reference_entities USING GIN (ref gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS basemap.reference_entities;');
  // The basemap schema itself is not dropped: load_basemap.py's tables live there
  // and this migration did not create them.
};
```

- [ ] **Step 2: Run the migration up and verify the shape**

Run:
```bash
npm run migrate:up -w @webatlas/api
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c "\d basemap.reference_entities"
```
Expected: the table exists with all twelve columns, the `reference_entities_natural_key` unique constraint, and five indexes including the two `gin_trgm_ops` ones.

- [ ] **Step 3: Verify the down path really works**

A broken `down` is a defect this project has shipped twice before (migration 16 needed two fixes). Prove it now, on the dev DB.

Run:
```bash
npm run migrate:down -w @webatlas/api
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c "\dt basemap.reference_entities"
npm run migrate:up -w @webatlas/api
```
Expected: `migrate:down` exits 0; `\dt` prints `Did not find any relation named "basemap.reference_entities"`; `migrate:up` re-creates it cleanly.

- [ ] **Step 4: Confirm the assistant role still cannot see basemap**

Run:
```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c "SELECT has_schema_privilege('webatlas_assistant','basemap','USAGE') AS can_use_basemap;"
```
Expected: `can_use_basemap | f`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/1000000000017_reference-entities.cjs
git commit -m "feat(api): lược đồ bảng thực thể tham chiếu đã gộp"
```

---

### Task 3: The dissolve builder

The single writer of `reference_entities`. Rebuilds one layer at a time inside a transaction.

**Files:**
- Create: `apps/api/src/db/referenceEntities.ts`
- Create: `apps/api/src/db/referenceEntities.test.ts`
- Create: `apps/api/src/scripts/buildReference.ts`
- Modify: `apps/api/package.json` (add `reference:build`)

**Interfaces:**
- Consumes: `REFERENCE_LAYER_KEYS`, `REFERENCE_REGISTRY`, `getReferenceLayer`, `type ReferenceLayerKey` from Task 1; `basemap.reference_entities` from Task 2.
- Produces:
  - `CLUSTER_EPS_DEGREES: number` (0.02)
  - `buildReferenceLayer(pool: Pool, key: ReferenceLayerKey): Promise<number>` — returns rows written
  - `buildReferenceEntities(pool: Pool, keys?: readonly ReferenceLayerKey[]): Promise<Record<ReferenceLayerKey, number>>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/referenceEntities.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPool, closePool } from './pool';
import { buildReferenceEntities, buildReferenceLayer } from './referenceEntities';

const pool = getPool();

// The builder rewrites the whole table, which is also what a real run does; there
// is no other writer, so no cleanup is owed beyond leaving it populated.
beforeAll(async () => {
  await buildReferenceEntities(pool);
}, 300_000);

afterAll(async () => {
  await closePool();
});

describe('reference entity dissolve', () => {
  it('writes entities for every in-scope layer', async () => {
    const { rows } = await pool.query<{ layer_key: string; n: string }>(
      'SELECT layer_key, count(*)::text AS n FROM basemap.reference_entities GROUP BY layer_key'
    );
    const byLayer = Object.fromEntries(rows.map((r) => [r.layer_key, Number(r.n)]));
    for (const key of ['roads', 'railways', 'water', 'landuse', 'places']) {
      expect(byLayer[key], `expected entities for ${key}`).toBeGreaterThan(0);
    }
  });

  it('collapses many segments into fewer entities', async () => {
    const { rows } = await pool.query<{ entities: string; members: string }>(
      `SELECT count(*)::text AS entities, sum(member_count)::text AS members
         FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    const entities = Number(rows[0].entities);
    const members = Number(rows[0].members);
    // Measured 2026-09-22: 13,354 entities over 34,190 member rows.
    //
    // Deliberately a weak ratio. The entity count is NOT simply the count of
    // distinct names: DBSCAN splits spatially disjoint groups sharing a name, and
    // there are hundreds of separate streets called "Đường số 1" in different
    // towns — correctly separate entities. The real proof of the dissolve is the
    // QL.14 test below, not this ratio.
    expect(members).toBeGreaterThan(entities);
  });

  it('never writes an entity with no name and no ref', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE coalesce(ref, name) IS NULL`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('gives every entity a deterministic id and a non-empty member list', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE entity_id !~ '^[a-z]+:[0-9a-f]{32}:[0-9]+$'
           OR array_length(member_ids, 1) IS NULL
           OR member_count <> array_length(member_ids, 1)`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('dissolves a multi-segment national road into one entity per cluster', async () => {
    // Quốc lộ 14 runs the length of the Central Highlands: many OSM ways, one ref.
    // Note the dot — the live values are 'QL.14', not 'QL14'.
    const { rows } = await pool.query<{ entity_key: string; member_count: number; km: number }>(
      `SELECT entity_key, member_count,
              (ST_Length(geom::geography) / 1000)::float8 AS km
         FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND entity_key = 'QL.14'
        ORDER BY member_count DESC`
    );
    expect(rows.length).toBeGreaterThan(0);
    // Measured 2026-09-22: one cluster, 621 members, ~998 km — the real road.
    expect(rows[0].member_count).toBeGreaterThan(100);
    expect(rows[0].km).toBeGreaterThan(500);
  });

  it('unnests a compound ref so a shared segment joins both routes', async () => {
    // 513 road rows are tagged 'QL.14;HCM': that stretch carries Quốc lộ 14 AND
    // the Hồ Chí Minh route, so it must be a member of both entities.
    const { rows } = await pool.query<{ entity_key: string }>(
      `SELECT entity_key FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND entity_key IN ('QL.14', 'HCM')`
    );
    const keys = new Set(rows.map((r) => r.entity_key));
    expect(keys.has('QL.14')).toBe(true);
    expect(keys.has('HCM')).toBe(true);
    // And no entity key still carries the raw compound string.
    const { rows: compound } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE entity_key LIKE '%;%'`
    );
    expect(Number(compound[0].n)).toBe(0);
  });

  it('sums the registry summable columns into attrs for places', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE layer_key = 'places' AND attrs ? 'population'`
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it('leaves attrs empty for layers with no summable columns', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE layer_key <> 'places' AND attrs <> '{}'::jsonb`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('stores valid 4326 geometry for every entity', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities
        WHERE geom IS NULL OR ST_SRID(geom) <> 4326 OR NOT ST_IsValid(geom)`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('is idempotent: rebuilding one layer replaces rather than duplicates', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'railways'`
    );
    await buildReferenceLayer(pool, 'railways');
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'railways'`
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 120_000);

  it('rebuilding one layer does not touch another', async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    await buildReferenceLayer(pool, 'railways');
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = 'roads'`
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 120_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/referenceEntities.test.ts`
Expected: FAIL — `Cannot find module './referenceEntities'`.

- [ ] **Step 3: Write the builder**

Create `apps/api/src/db/referenceEntities.ts`:

```ts
import type { Pool } from 'pg';
import {
  REFERENCE_LAYER_KEYS,
  getReferenceLayer,
  type ReferenceLayerKey,
} from '../reference/registry';

/**
 * DBSCAN neighbourhood, in degrees, used to split one name/ref into separate
 * entities. ~0.02deg is ~2.2 km at this latitude: two stretches of road sharing a
 * ref but lying further apart than that are genuinely different objects on the
 * map, and unioning them would produce a sprawling multipart geometry whose
 * bounding box is useless as an ROI. minpoints = 1 so a lone segment still forms
 * its own cluster rather than being discarded as noise.
 */
export const CLUSTER_EPS_DEGREES = 0.02;

/**
 * Rebuilds the dissolved entities for ONE reference layer.
 *
 * This module is the single writer of basemap.reference_entities (spec §4: unlike
 * the water layers there is no edit path, so the derived table has exactly one
 * writer). Delete + insert per layer inside one transaction, so a reader never
 * sees a half-built layer and a failure leaves the previous build intact.
 *
 * The scan is sequential by design — see the migration's comment on why the raw
 * basemap tables carry no trigram index. Measured 2026-09-22 on the dev DB:
 * clustering roads_region (527k rows, 33k named) takes ~1.2s.
 */
export async function buildReferenceLayer(pool: Pool, key: ReferenceLayerKey): Promise<number> {
  const def = getReferenceLayer(key);

  // Every identifier below comes from the registry, never from a request.
  //
  // OSM `ref` is multi-valued: 930 road rows carry something like 'QL.14;HCM',
  // meaning that stretch belongs to BOTH Quốc lộ 14 and the Hồ Chí Minh route.
  // Grouping on the raw string would split QL.14 into two entities over a tagging
  // artefact, so each token becomes its own entity key and a segment may be a
  // member of more than one entity. Verified: with the unnest, QL.14 dissolves to
  // one ~998 km entity over 621 segments; without it, into several fragments.
  //
  // The LEFT JOIN LATERAL yields one row per ref token, or a single NULL row when
  // `ref` is absent — which is what makes the coalesce fall back to `name`.
  const refJoin = def.refColumn
    ? `LEFT JOIN LATERAL (
         SELECT nullif(btrim(x), '') AS tok
           FROM unnest(string_to_array(coalesce(t.${def.refColumn}, ''), ';')) AS x
       ) k ON true`
    : '';
  const refExpr = def.refColumn ? 'k.tok' : 'NULL::text';
  const entityKeyExpr = `coalesce(${refExpr}, t.${def.nameColumn})`;

  // Summable columns become a single jsonb object of sums, e.g. {"population": N}.
  const attrsExpr = def.summable.length
    ? `jsonb_build_object(${def.summable
        .map((c) => `'${c}', coalesce(sum(c.${c}), 0)`)
        .join(', ')})`
    : `'{}'::jsonb`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM basemap.reference_entities WHERE layer_key = $1', [key]);

    const { rowCount } = await client.query(
      `
      WITH src AS (
        SELECT t.${def.idColumn}::text  AS osm_id,
               t.${def.nameColumn}      AS name,
               ${refExpr}               AS ref,
               t.${def.classColumn}     AS fclass,
               t.${def.geomColumn}      AS geometry,
               ${entityKeyExpr}         AS entity_key
               ${def.summable.length ? ',' + def.summable.map((c) => `t.${c}`).join(', ') : ''}
          FROM ${def.table} t
          ${refJoin}
         WHERE ${entityKeyExpr} IS NOT NULL
           AND t.${def.geomColumn} IS NOT NULL
      ),
      c AS (
        SELECT src.*,
               ST_ClusterDBSCAN(geometry, $2, 1) OVER (PARTITION BY entity_key) AS cluster_id
          FROM src
      )
      INSERT INTO basemap.reference_entities
        (entity_id, layer_key, entity_key, cluster_id, name, ref, fclass,
         member_ids, member_count, attrs, geom)
      SELECT $1 || ':' || md5(c.entity_key) || ':' || c.cluster_id,
             $1,
             c.entity_key,
             c.cluster_id,
             -- The commonest spelling among the members; segments of one road
             -- occasionally disagree on capitalisation or diacritics.
             mode() WITHIN GROUP (ORDER BY c.name),
             mode() WITHIN GROUP (ORDER BY c.ref),
             mode() WITHIN GROUP (ORDER BY c.fclass),
             array_agg(c.osm_id ORDER BY c.osm_id),
             count(*)::int,
             ${attrsExpr},
             ST_Multi(ST_UnaryUnion(ST_Collect(c.geometry)))
        FROM c
       GROUP BY c.entity_key, c.cluster_id
      `,
      [key, CLUSTER_EPS_DEGREES]
    );

    await client.query('COMMIT');
    return rowCount ?? 0;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* transaction already ended */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Rebuilds every reference layer (or the named subset), returning rows per layer. */
export async function buildReferenceEntities(
  pool: Pool,
  keys: readonly ReferenceLayerKey[] = REFERENCE_LAYER_KEYS
): Promise<Record<ReferenceLayerKey, number>> {
  const counts = {} as Record<ReferenceLayerKey, number>;
  for (const key of keys) {
    counts[key] = await buildReferenceLayer(pool, key);
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/db/referenceEntities.test.ts`
Expected: PASS, 11 tests. The `beforeAll` full build is the slow part; if it exceeds the 300s hook budget, report the real timing rather than raising the number blindly.

- [ ] **Step 5: Add the CLI script**

Create `apps/api/src/scripts/buildReference.ts`:

```ts
import 'dotenv/config';
import { closePool, getPool } from '../db/pool';
import { buildReferenceEntities } from '../db/referenceEntities';
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '../reference/registry';

/**
 * Rebuilds basemap.reference_entities.
 *
 * RUN THIS AFTER scripts/basemap/load_basemap.py. The loader replaces its own
 * tables wholesale, so every entity here is stale the moment it finishes.
 *
 * Usage:
 *   npm run reference:build -w @webatlas/api            # all layers
 *   npm run reference:build -w @webatlas/api -- roads   # one or more layers
 */
async function main(): Promise<void> {
  const requested = process.argv.slice(2) as ReferenceLayerKey[];
  const unknown = requested.filter((k) => !(REFERENCE_LAYER_KEYS as readonly string[]).includes(k));
  if (unknown.length) {
    console.error(`Unknown reference layer(s): ${unknown.join(', ')}`);
    console.error(`Known: ${REFERENCE_LAYER_KEYS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  try {
    const started = Date.now();
    const counts = await buildReferenceEntities(pool, requested.length ? requested : undefined);
    for (const [key, n] of Object.entries(counts)) {
      console.log(`  basemap.reference_entities  ${key.padEnd(10)} ${String(n).padStart(8)} entities`);
    }
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Modify `apps/api/package.json` — add after the `ingest:rivers` line:

```json
    "reference:build": "tsx src/scripts/buildReference.ts",
```

- [ ] **Step 6: Run the script for real**

Run: `npm run reference:build -w @webatlas/api`
Expected: five lines of counts in the orders of magnitude from the expected-entities table above (roads ~13k, railways ~140, water ~600, landuse ~800, places ~4k), then a `done in Ns` line. Record the real wall time in the progress ledger.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/referenceEntities.ts apps/api/src/db/referenceEntities.test.ts \
        apps/api/src/scripts/buildReference.ts apps/api/package.json
git commit -m "feat(api): gộp thực thể có tên cho các lớp tham chiếu"
```

---

### Task 4: Reference read API

**Files:**
- Create: `apps/api/src/modules/reference/repository.ts`
- Create: `apps/api/src/modules/reference/controller.ts`
- Create: `apps/api/src/modules/reference/routes.ts`
- Create: `apps/api/src/modules/reference/reference.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: registry from Task 1; `reference_entities` populated by Task 3; `validate` from `src/lib/validate`; `NotFoundError` from `src/errors`; `simplifiedGeoJsonSql` from `src/lib/resultGeometry`.
- Produces:
  - `interface ReferenceEntity { entityId, layerKey, name, ref, fclass, memberCount, attrs, bbox }`
  - `listEntities(pool, key, opts): Promise<ReferenceEntity[]>`
  - `getEntity(pool, key, entityId): Promise<ReferenceEntity & { geometry: GeoJsonGeometry }>` — used by Task 7's ROI resolver
  - Routes `GET /api/reference/layers`, `GET /api/reference/:layer/entities`, `GET /api/reference/:layer/entities/:entityId`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/reference/reference.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../server';
import { closePool, getPool } from '../../db/pool';
import { buildReferenceLayer } from '../../db/referenceEntities';

// Matches the house pattern in modules/admin-units/adminUnits.test.ts.
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  // Cheapest layer to build; guarantees the table is populated even if this file
  // runs before the builder's own suite.
  await buildReferenceLayer(getPool(), 'railways');
}, 120_000);

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/reference/layers', () => {
  it('lists the five in-scope layers with their metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/layers' });
    expect(res.statusCode).toBe(200);
    const { layers } = res.json();
    expect(layers.map((l: { key: string }) => l.key).sort()).toEqual(
      ['landuse', 'places', 'railways', 'roads', 'water']
    );
    const places = layers.find((l: { key: string }) => l.key === 'places');
    expect(places.summable).toEqual(['population']);
    expect(places.geomKind).toBe('point');
  });
});

describe('GET /api/reference/:layer/entities', () => {
  it('returns entities without geometry, newest-irrelevant order by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=5' });
    expect(res.statusCode).toBe(200);
    const { entities } = res.json();
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.length).toBeLessThanOrEqual(5);
    expect(entities[0]).toHaveProperty('entityId');
    expect(entities[0]).toHaveProperty('memberCount');
    expect(entities[0]).toHaveProperty('bbox');
    // The list endpoint stays light: no geometry.
    expect(entities[0]).not.toHaveProperty('geometry');
  });

  it('filters by trigram query', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=50' });
    const first = all.json().entities.find((e: { name: string | null }) => e.name)?.name as string;
    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/railways/entities?q=${encodeURIComponent(first.slice(0, 6))}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entities.length).toBeGreaterThan(0);
  });

  it('rejects an unknown layer with 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/dams/entities' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a national duplicate as an unknown layer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/roads_vn/entities' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a limit outside the allowed range', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=5000' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/reference/:layer/entities/:entityId', () => {
  it('returns one entity with its geometry', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=1' });
    const { entityId } = list.json().entities[0];

    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/railways/entities/${encodeURIComponent(entityId)}`,
    });
    expect(res.statusCode).toBe(200);
    const { entity } = res.json();
    expect(entity.entityId).toBe(entityId);
    expect(entity.geometry).toBeTruthy();
    expect(entity.geometry.type).toMatch(/LineString/);
  });

  it('404s on an unknown entity id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reference/railways/entities/railways:00000000000000000000000000000000:0',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the id belongs to another layer', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=1' });
    const { entityId } = list.json().entities[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/reference/water/entities/${encodeURIComponent(entityId)}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/reference/reference.test.ts`
Expected: FAIL — all requests 404 because the routes are not registered yet.

- [ ] **Step 3: Write the repository**

Create `apps/api/src/modules/reference/repository.ts`:

```ts
import type { Pool } from 'pg';
import type { GeoJsonGeometry } from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../lib/resultGeometry';
import { getReferenceLayer, type ReferenceLayerKey } from '../../reference/registry';

export interface ReferenceEntity {
  entityId: string;
  layerKey: ReferenceLayerKey;
  name: string | null;
  ref: string | null;
  fclass: string | null;
  memberCount: number;
  attrs: Record<string, number>;
  /** [west, south, east, north] in EPSG:4326. */
  bbox: [number, number, number, number];
}

export interface ReferenceEntityWithGeometry extends ReferenceEntity {
  geometry: GeoJsonGeometry;
}

const BBOX_SQL = `ST_XMin(ST_Envelope(geom)) AS west, ST_YMin(ST_Envelope(geom)) AS south,
                  ST_XMax(ST_Envelope(geom)) AS east, ST_YMax(ST_Envelope(geom)) AS north`;

const BASE_COLUMNS = `entity_id AS "entityId", layer_key AS "layerKey", name, ref, fclass,
                      member_count AS "memberCount", attrs, ${BBOX_SQL}`;

interface Row {
  entityId: string;
  layerKey: ReferenceLayerKey;
  name: string | null;
  ref: string | null;
  fclass: string | null;
  memberCount: number;
  attrs: Record<string, number>;
  west: number; south: number; east: number; north: number;
  geometry?: GeoJsonGeometry;
}

function toEntity(r: Row): ReferenceEntity {
  return {
    entityId: r.entityId,
    layerKey: r.layerKey,
    name: r.name,
    ref: r.ref,
    fclass: r.fclass,
    memberCount: Number(r.memberCount),
    attrs: r.attrs ?? {},
    bbox: [r.west, r.south, r.east, r.north],
  };
}

export interface ListOptions {
  q?: string;
  fclass?: string;
  limit: number;
}

/** Entities of one layer, optionally trigram-filtered. No geometry — the list stays light. */
export async function listEntities(
  pool: Pool,
  key: ReferenceLayerKey,
  { q, fclass, limit }: ListOptions
): Promise<ReferenceEntity[]> {
  // Validates the key and keeps the registry the only path from key to SQL, even
  // though this table is keyed by layer_key rather than named per layer.
  getReferenceLayer(key);

  const where: string[] = ['layer_key = $1'];
  const params: unknown[] = [key];

  if (q) {
    params.push(q);
    // Both trigram indexes are usable here; ref carries QL14-style route numbers.
    where.push(`(name % $${params.length} OR ref % $${params.length})`);
  }
  if (fclass) {
    params.push(fclass);
    where.push(`fclass = $${params.length}`);
  }
  params.push(limit);

  const order = q
    ? `GREATEST(coalesce(similarity(name, $2), 0), coalesce(similarity(ref, $2), 0)) DESC, name ASC`
    : `member_count DESC, name ASC`;

  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS} FROM basemap.reference_entities
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params
  );
  return rows.map(toEntity);
}

/** One entity with a display-simplified geometry, or null. */
export async function getEntity(
  pool: Pool,
  key: ReferenceLayerKey,
  entityId: string
): Promise<ReferenceEntityWithGeometry | null> {
  getReferenceLayer(key);
  const { rows } = await pool.query<Row>(
    `SELECT ${BASE_COLUMNS}, ${simplifiedGeoJsonSql('geom')} AS geometry
       FROM basemap.reference_entities
      WHERE layer_key = $1 AND entity_id = $2`,
    [key, entityId]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toEntity(row), geometry: row.geometry as GeoJsonGeometry };
}
```

- [ ] **Step 4: Write the controller and routes**

Create `apps/api/src/modules/reference/controller.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { validate } from '../../lib/validate';
import {
  REFERENCE_LAYER_KEYS,
  listReferenceMetadata,
  type ReferenceLayerKey,
} from '../../reference/registry';
import { getEntity, listEntities } from './repository';

const LayerParam = z.object({ layer: z.enum(REFERENCE_LAYER_KEYS) });
const EntityParam = LayerParam.extend({ entityId: z.string().min(1) });

const ListQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự').optional(),
  fclass: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** A Zod enum failure on the path means "no such layer", not "bad request". */
function layerOf(params: unknown): ReferenceLayerKey {
  const parsed = LayerParam.safeParse(params);
  if (!parsed.success) throw new NotFoundError('Không có lớp tham chiếu này');
  return parsed.data.layer;
}

export async function referenceLayers(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ layers: listReferenceMetadata() });
}

export async function referenceEntities(req: FastifyRequest, reply: FastifyReply) {
  const layer = layerOf(req.params);
  const { q, fclass, limit } = validate(ListQuery, req.query);
  const entities = await listEntities(req.server.pg, layer, {
    limit,
    ...(q ? { q } : {}),
    ...(fclass ? { fclass } : {}),
  });
  reply.send({ entities });
}

export async function referenceEntity(req: FastifyRequest, reply: FastifyReply) {
  const layer = layerOf(req.params);
  const parsed = EntityParam.safeParse(req.params);
  if (!parsed.success) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  const entity = await getEntity(req.server.pg, layer, parsed.data.entityId);
  if (!entity) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');
  reply.send({ entity });
}
```

Create `apps/api/src/modules/reference/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { referenceEntities, referenceEntity, referenceLayers } from './controller';

/** Công khai như /api/search và /api/admin-units: nền bản đồ không phải dữ liệu nhạy cảm. */
export default async function referenceRoutes(app: FastifyInstance) {
  app.get('/reference/layers', referenceLayers);
  app.get('/reference/:layer/entities', referenceEntities);
  app.get('/reference/:layer/entities/:entityId', referenceEntity);
}
```

- [ ] **Step 5: Register the routes**

Modify `apps/api/src/server.ts` — add the import beside the other module imports (after the `adminUnitsRoutes` line, line 11):

```ts
import referenceRoutes from './modules/reference/routes';
```

and the registration after the `adminUnitsRoutes` registration (line 41):

```ts
  app.register(referenceRoutes, { prefix: '/api' });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/reference/reference.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/reference apps/api/src/server.ts
git commit -m "feat(api): tuyến đọc lớp tham chiếu và thực thể"
```

---

### Task 5: Search source filter (API)

`/api/search` gains an optional `sources` filter so reference entities are findable alongside the water layers.

**Files:**
- Modify: `apps/api/src/modules/search/repository.ts`
- Modify: `apps/api/src/modules/search/service.ts`
- Modify: `apps/api/src/modules/search/controller.ts`
- Modify: `apps/api/src/modules/search/search.test.ts`

**Interfaces:**
- Consumes: `REFERENCE_LAYER_KEYS` from Task 1; `basemap.reference_entities` from Tasks 2–3.
- Produces:
  - `SearchHit` gains `source: 'layer' | 'reference'` and `featureId` holds the `entity_id` for reference hits.
  - `SEARCH_SOURCES: readonly string[]` — `['dams','lakes','rivers','stations','ref:roads','ref:railways','ref:water','ref:landuse','ref:places']`
  - `searchByName(pool, q, limit, sources?)`
  - Task 6 (web) consumes the `source` field.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/search/search.test.ts` (keep the existing describes; add this one):

```ts
describe('GET /api/search with sources', () => {
  it('returns only water-layer hits by default, unchanged from before', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song' });
    expect(res.statusCode).toBe(200);
    for (const hit of res.json().results) {
      expect(hit.source).toBe('layer');
    }
  });

  it('returns reference hits when a ref: source is asked for', async () => {
    await buildReferenceLayer(getPool(), 'railways');
    const list = await app.inject({ method: 'GET', url: '/api/reference/railways/entities?limit=50' });
    const named = list.json().entities.find((e: { name: string | null }) => e.name);
    const term = (named.name as string).slice(0, 6);

    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(term)}&sources=ref:railways`,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect(hit.source).toBe('reference');
      expect(hit.layerKey).toBe('railways');
      // A reference hit is navigable: featureId is the entity id.
      expect(hit.featureId).toMatch(/^railways:[0-9a-f]{32}:\d+$/);
      expect(hit.lonLat).toHaveLength(2);
    }
  });

  it('mixes sources when both kinds are asked for', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=song&sources=rivers,ref:water',
    });
    expect(res.statusCode).toBe(200);
    for (const hit of res.json().results) {
      expect(['layer', 'reference']).toContain(hit.source);
    }
  });

  it('rejects an unknown source', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song&sources=ref:roads_vn' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a water layer that has no searchable name column', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=song&sources=flood_zones' });
    expect(res.statusCode).toBe(400);
  });
});
```

Add these imports at the top of the file if absent:

```ts
import { getPool } from '../../db/pool';
import { buildReferenceLayer } from '../../db/referenceEntities';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/search/search.test.ts`
Expected: FAIL — `hit.source` is `undefined`, and `sources=` is ignored so the unknown-source case returns 200.

- [ ] **Step 3: Extend the repository**

Modify `apps/api/src/modules/search/repository.ts`. Keep `layerCtes` and `layerSelect` exactly as they are — the optimizer-fence comment above them still applies and must not be disturbed. Add below them:

```ts
import { REFERENCE_LAYER_KEYS, type ReferenceLayerKey } from '../../reference/registry';

/** The water layers worth matching, unchanged: hazard-zone layers have no names. */
const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

const REFERENCE_PREFIX = 'ref:';

/** Every token /api/search accepts in `sources`. */
export const SEARCH_SOURCES: readonly string[] = [
  ...SEARCHABLE,
  ...REFERENCE_LAYER_KEYS.map((k) => `${REFERENCE_PREFIX}${k}`),
];

/**
 * Reference entities are already dissolved, so one row is one answer — "Quốc lộ 14"
 * rather than 3,000 segments. They need none of the dataset-version machinery the
 * water layers need: basemap is unversioned, and the trigram indexes live on
 * basemap.reference_entities (see migration 17 for why not on the raw tables).
 */
function referenceSelect(keys: ReferenceLayerKey[]): string {
  return `
      SELECT layer_key AS layer_key, entity_id AS feature_id, name,
             'reference'::text AS source,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             GREATEST(coalesce(similarity(name, $1), 0), coalesce(similarity(ref, $1), 0)) AS sim
      FROM basemap.reference_entities
      WHERE layer_key = ANY(ARRAY[${keys.map((k) => `'${k}'`).join(',')}])
        AND (name % $1 OR ref % $1)`;
}
```

Then replace `searchByName` with:

```ts
/** Trigram search across the requested sources, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(
  pool: Pool,
  q: string,
  limit: number,
  sources: readonly string[] = SEARCHABLE
): Promise<SearchHit[]> {
  const layerKeys = sources.filter((s) => !s.startsWith(REFERENCE_PREFIX)) as EditableLayerKey[];
  const referenceKeys = sources
    .filter((s) => s.startsWith(REFERENCE_PREFIX))
    .map((s) => s.slice(REFERENCE_PREFIX.length)) as ReferenceLayerKey[];

  const selects: string[] = [];
  const ctes = layerKeys.map(layerCtes).join(',\n');
  for (const key of layerKeys) {
    // 'layer'::text keeps the UNION ALL arms column-compatible with the reference arm.
    selects.push(layerSelect(key).replace('AS layer_key,', "AS layer_key, 'layer'::text AS source,"));
  }
  if (referenceKeys.length) selects.push(referenceSelect(referenceKeys));

  if (!selects.length) return [];

  const prelude = ctes ? `WITH RECURSIVE ${ctes}` : '';
  const { rows } = await pool.query(
    `${prelude} ${selects.join(' UNION ALL ')} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as EditableLayerKey | ReferenceLayerKey,
    featureId: r.feature_id,
    name: r.name,
    source: r.source as 'layer' | 'reference',
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
```

And widen the exported type:

```ts
export interface SearchHit {
  layerKey: EditableLayerKey | ReferenceLayerKey;
  featureId: string;
  name: string;
  /** 'layer' = an editable water feature; 'reference' = a dissolved basemap entity. */
  source: 'layer' | 'reference';
  lonLat: [number, number];
}
```

> **Careful with the `layerSelect` rewrite.** The `.replace()` above depends on `layerSelect` emitting the exact substring `AS layer_key,`. If that ever drifts, the UNION arms stop matching. Prefer editing `layerSelect` directly to emit `'layer'::text AS source,` after `AS layer_key,` and drop the `.replace()` — do that if the string is not an exact match when you run it.

- [ ] **Step 4: Thread `sources` through service and controller**

Modify `apps/api/src/modules/search/service.ts`:

```ts
import type { Pool } from 'pg';
import { searchByName, type SearchHit } from './repository';

export function searchService(pool: Pool) {
  return {
    search: (q: string, limit: number, sources?: readonly string[]): Promise<SearchHit[]> =>
      searchByName(pool, q, limit, sources),
  };
}
```

Modify `apps/api/src/modules/search/controller.ts`:

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { SEARCH_SOURCES } from './repository';
import { searchService } from './service';

const SearchQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // Comma-separated. Omitted = the four water layers, which is the behaviour every
  // existing caller already depends on.
  sources: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((t) => t.trim()).filter(Boolean) : undefined))
    .refine(
      (list) => list === undefined || list.every((t) => SEARCH_SOURCES.includes(t)),
      { message: `Nguồn tìm kiếm không hợp lệ; hợp lệ: ${SEARCH_SOURCES.join(', ')}` }
    ),
});

export async function search(req: FastifyRequest, reply: FastifyReply) {
  const { q, limit, sources } = validate(SearchQuery, req.query);
  const results = await searchService(req.server.pg).search(q, limit, sources);
  reply.send({ results });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/search/search.test.ts`
Expected: PASS — the new describe plus every pre-existing search test still green (the default path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/search
git commit -m "feat(api): lọc nguồn cho tìm kiếm, tìm được thực thể tham chiếu"
```

---

### Task 6: Reference hits in the web search box

**Files:**
- Modify: `apps/web/src/features/search/api/search.api.ts`
- Modify: `apps/web/src/features/search/ui/SearchBox.view.tsx`
- Modify: `apps/web/src/features/search/index.tsx`
- Modify: `apps/web/src/features/search/index.test.tsx`

**Interfaces:**
- Consumes: the `source` field from Task 5.
- Produces: no new exports; behaviour only.

- [ ] **Step 1: Read the three files before editing**

Run:
```bash
sed -n '1,60p' apps/web/src/features/search/api/search.api.ts
sed -n '1,80p' apps/web/src/features/search/ui/SearchBox.view.tsx
sed -n '1,80p' apps/web/src/features/search/index.tsx
```
These files are short but their exact shape decides the edits below; do not guess at them.

- [ ] **Step 2: Write the failing test**

Append to `apps/web/src/features/search/index.test.tsx`, inside the existing top-level `describe`:

```tsx
it('labels a reference hit and zooms without selecting a feature', async () => {
  const onSelectFeature = vi.fn();
  vi.spyOn(api, 'fetchSearch').mockResolvedValue([
    {
      layerKey: 'roads',
      featureId: 'roads:0123456789abcdef0123456789abcdef:0',
      name: 'Quốc lộ 14',
      source: 'reference',
      lonLat: [108.05, 12.67],
    },
  ]);

  render(<SearchBox onSelectFeature={onSelectFeature} />);
  await userEvent.type(screen.getByRole('searchbox'), 'Quốc lộ');
  const hit = await screen.findByText('Quốc lộ 14');

  // The badge tells the user this is basemap reference data, not an editable feature.
  expect(screen.getByText('Nền bản đồ')).toBeInTheDocument();

  await userEvent.click(hit);
  // Reference entities are not editable features; clicking one must not try to
  // select it in the editor.
  expect(onSelectFeature).not.toHaveBeenCalled();
});
```

Adjust the render/props to match the real `SearchBox` signature you read in Step 1 — the assertions are the point, not the exact props.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/search/index.test.tsx`
Expected: FAIL — no `Nền bản đồ` badge in the DOM.

- [ ] **Step 4: Add `source` to the API type and request reference sources**

In `apps/web/src/features/search/api/search.api.ts`, add to the `SearchHit` interface:

```ts
  /** 'layer' = an editable water feature; 'reference' = a dissolved basemap entity. */
  source: 'layer' | 'reference';
```

and include the reference sources in the request URL:

```ts
const SOURCES = [
  'dams', 'lakes', 'rivers', 'stations',
  'ref:roads', 'ref:railways', 'ref:water', 'ref:landuse', 'ref:places',
].join(',');

const body = await apiRequest<{ results: SearchHit[] }>(
  `/api/search?q=${encodeURIComponent(q)}&sources=${encodeURIComponent(SOURCES)}`
);
```

- [ ] **Step 5: Render the badge and branch the click**

In `SearchBox.view.tsx`, inside the result row, after the name:

```tsx
{hit.source === 'reference' && <span className="search-hit__badge">Nền bản đồ</span>}
```

In `index.tsx`, branch the click handler so a reference hit only moves the map:

```tsx
// A reference entity is basemap data with no edit path and no feature id in the
// water layers — zoom to it, but never hand it to the editor as a selection.
if (hit.source === 'reference') {
  zoomTo(hit.lonLat);
  return;
}
```

Match `zoomTo` to whatever the file already calls for navigation (read it in Step 1); do not introduce a second navigation path.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w @webatlas/web -- src/features/search/index.test.tsx`
Expected: PASS.

- [ ] **Step 7: Type-check the web build**

Run: `npm run build:web`
Expected: exit 0. vitest uses esbuild and skips type-checking, so this step is the one that catches a `SearchHit` shape mismatch.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/search
git commit -m "feat(web): hiện thực thể nền bản đồ trong ô tìm kiếm"
```

---

### Task 7: Reference entity as an analysis ROI

**Files:**
- Modify: `apps/api/src/modules/analysis/schemas.ts`
- Modify: `apps/api/src/modules/analysis/area.ts`
- Modify: `apps/api/src/modules/analysis/analysis.test.ts`

**Interfaces:**
- Consumes: registry (Task 1), `reference_entities` (Tasks 2–3).
- Produces:
  - `ReferenceRef` Zod schema: `{ referenceLayer: ReferenceLayerKey; entityId: string; radiusKm?: number }`
  - `MAX_ROI_AREA_KM2 = 25_000`
  - `inputGeometry` accepts `{ geometry } | { feature } | { reference }` — which extends all five ops at once, because every one of them resolves its input through this single function.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/analysis/analysis.test.ts`:

```ts
describe('analysis with a reference-entity ROI', () => {
  let roadEntityId: string;
  let waterEntityId: string;

  beforeAll(async () => {
    await buildReferenceEntities(getPool(), ['roads', 'water']);
    const { rows } = await getPool().query<{ entity_id: string }>(
      `SELECT entity_id FROM basemap.reference_entities
        WHERE layer_key = 'roads' ORDER BY member_count DESC LIMIT 1`
    );
    roadEntityId = rows[0].entity_id;
    const water = await getPool().query<{ entity_id: string }>(
      `SELECT entity_id FROM basemap.reference_entities
        WHERE layer_key = 'water' ORDER BY ST_Area(geom) DESC LIMIT 1`
    );
    waterEntityId = water.rows[0].entity_id;
  }, 300_000);

  it('buffers a road entity into an area', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.areaKm2).toBeGreaterThan(0);
  });

  it('uses a water polygon entity directly, with no radius', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/zonal_elevation',
      payload: { reference: { referenceLayer: 'water', entityId: waterEntityId } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a line entity with no radius, naming the radius as the reason', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/zonal_elevation',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/bán kính/i);
  });

  it('refuses an ROI past the area limit, and says it was the area limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 100 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/diện tích/i);
  });

  it('404s on an unknown entity id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        reference: { referenceLayer: 'roads', entityId: 'roads:' + '0'.repeat(32) + ':0', radiusKm: 1 },
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects more than one input family at once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        geometry: { type: 'Point', coordinates: [108.05, 12.67] },
        reference: { referenceLayer: 'roads', entityId: roadEntityId },
        radiusKm: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stays inside the analysis timeout budget', async () => {
    const started = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/select_within',
      payload: {
        reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 2 },
        layerKeys: ['dams'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
```

Add the imports this describe needs at the top of the file:

```ts
import { getPool } from '../../db/pool';
import { buildReferenceEntities } from '../../db/referenceEntities';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/analysis/analysis.test.ts`
Expected: FAIL — every `reference:` payload is rejected 400 by the existing `exactlyOne` refinement.

- [ ] **Step 3: Extend the schemas**

Modify `apps/api/src/modules/analysis/schemas.ts`. Add the import:

```ts
import { REFERENCE_LAYER_KEYS } from '../../reference/registry';
```

Add after `FeatureRef`:

```ts
/**
 * A dissolved basemap entity as an ROI (spec §4/§5). Lines and points need a
 * radius to become an area; `area.ts` enforces that, because whether a radius is
 * required depends on the entity's own geometry, not just its layer.
 */
export const ReferenceRef = z.object({
  referenceLayer: z.enum(REFERENCE_LAYER_KEYS),
  entityId: z.string().min(1, 'Thiếu mã thực thể'),
  radiusKm: radiusKm.optional(),
});
export type ReferenceRefInput = z.infer<typeof ReferenceRef>;
```

Note `radiusKm` is declared above `FeatureRef` in the current file; move the `const radiusKm = ...` line above `ReferenceRef` if it is not already, so it is defined before use.

Replace the `exactlyOne` helper and constant with a three-way version:

```ts
const exactlyOne = (v: { geometry?: unknown; feature?: unknown; reference?: unknown }) =>
  [v.geometry, v.feature, v.reference].filter((x) => x !== undefined).length === 1;
const EXACTLY_ONE =
  'Cần đúng một trong ba: geometry (hình vẽ), feature (đối tượng) hoặc reference (thực thể nền bản đồ)';
```

Then add `reference: ReferenceRef.optional()` to each of the four object schemas that already carry `feature`: `BufferInput`, `SelectWithinInput`, `ProfileInput`, `ZonalInput`. `NearestInput` takes a point, not an ROI, and is left alone. For example:

```ts
export const BufferInput = z
  .object({
    geometry: geometryInput(ALL_TYPES).optional(),
    feature: FeatureRef.optional(),
    reference: ReferenceRef.optional(),
    radiusKm,
  })
  .refine(exactlyOne, EXACTLY_ONE);
export type BufferInput = z.infer<typeof BufferInput>;
```

- [ ] **Step 4: Resolve the reference entity in `area.ts`**

Modify `apps/api/src/modules/analysis/area.ts`. Add imports:

```ts
import { REGION_PROVINCE_CODES } from '@webatlas/shared';
import { getReferenceLayer } from '../../reference/registry';
import type { ReferenceRefInput } from './schemas';
```

Add above `inputGeometry`:

```ts
/**
 * The ceiling on an ROI's area, in km2.
 *
 * Quốc lộ 14 dissolved end to end is ~1,000 km of line; at the 100 km maximum
 * radius its buffer would cover most of the country and put every downstream op
 * past the 5s analysis budget. The six working-region provinces together are on
 * the order of 50,000 km2, so this permits a genuinely large ROI while refusing
 * the runaway ones. The message must name WHICH limit was hit (spec §4).
 */
export const MAX_ROI_AREA_KM2 = 25_000;

/** Union of the six working-region provinces; an ROI is clipped to it. */
const REGION_SQL = `
  SELECT ST_Union(geom) AS g FROM admin.provinces
   WHERE code = ANY(ARRAY[${REGION_PROVINCE_CODES.map((c) => `'${c}'`).join(',')}])`;

/**
 * A reference entity's geometry, buffered if a radius was given, clipped to the
 * working region, and refused if it is too big to analyse.
 */
async function referenceGeometry(
  db: Queryable,
  ref: ReferenceRefInput
): Promise<{ geojson: string; label?: string }> {
  const def = getReferenceLayer(ref.referenceLayer);

  // Checked before the query: it depends only on the layer's geometry kind and the
  // caller's input, so there is nothing to look up. Lines and points have no area
  // of their own — the panel should have asked for a radius (spec §5's radius
  // prompt). Say which input is missing rather than failing obscurely later.
  if (ref.radiusKm === undefined && def.geomKind !== 'area') {
    throw new ValidationError(
      'Thực thể dạng đường hoặc điểm cần bán kính (radiusKm) để thành vùng.'
    );
  }

  const { rows } = await db.query<{ geojson: string | null; name: string | null; type: string; areaKm2: number; vertices: number }>(
    `WITH region AS (${REGION_SQL}),
          e AS (
            SELECT name, ref, geom FROM basemap.reference_entities
             WHERE layer_key = $1 AND entity_id = $2
          ),
          shaped AS (
            SELECT coalesce(e.ref, e.name) AS name,
                   CASE WHEN $3::float8 IS NULL THEN e.geom
                        ELSE ST_Buffer(e.geom::geography, $3 * 1000)::geometry END AS g
              FROM e
          ),
          clipped AS (
            SELECT s.name, ST_Intersection(s.g, r.g) AS g
              FROM shaped s CROSS JOIN region r
          )
     SELECT ST_AsGeoJSON(g, 7) AS geojson, name,
            GeometryType(g) AS type,
            (ST_Area(g::geography) / 1e6)::float8 AS "areaKm2",
            ST_NPoints(g) AS vertices
       FROM clipped`,
    [ref.referenceLayer, ref.entityId, ref.radiusKm ?? null]
  );

  const row = rows[0];
  if (!row) throw new NotFoundError('Không tìm thấy thực thể tham chiếu');

  // An entity that lies wholly outside the working region clips to empty.
  if (!row.geojson || row.vertices === 0) {
    throw new ValidationError('Thực thể này nằm ngoài vùng làm việc.');
  }

  if (row.areaKm2 > MAX_ROI_AREA_KM2) {
    throw new ValidationError(
      `Vùng quan tâm quá lớn: ${Math.round(row.areaKm2).toLocaleString('vi-VN')} km² ` +
        `vượt giới hạn diện tích ${MAX_ROI_AREA_KM2.toLocaleString('vi-VN')} km². ` +
        `Hãy giảm bán kính hoặc chọn thực thể nhỏ hơn.`
    );
  }

  if (row.vertices > MAX_INPUT_VERTICES) {
    throw new ValidationError(
      `Vùng quan tâm quá phức tạp: ${row.vertices.toLocaleString('vi-VN')} điểm ` +
        `vượt giới hạn ${MAX_INPUT_VERTICES.toLocaleString('vi-VN')} điểm.`
    );
  }

  return { geojson: row.geojson, ...(row.name ? { label: row.name } : {}) };
}
```

Add the `MAX_INPUT_VERTICES` import from `./schemas` alongside the existing type import, then extend `inputGeometry`:

```ts
/** A drawn geometry as-is, a feature's full-precision geometry, or a reference entity. */
export async function inputGeometry(
  db: Queryable,
  input: { geometry?: GeoJsonGeometry; feature?: FeatureRefInput; reference?: ReferenceRefInput }
): Promise<{ geojson: string; label?: string }> {
  if (input.geometry) return { geojson: JSON.stringify(input.geometry) };
  if (input.reference) return referenceGeometry(db, input.reference);
  const ref = input.feature!;
  const f = await resolveFeature(db, ref.layerKey, ref.featureId, { simplify: false });
  if (!f) throw new NotFoundError('Không tìm thấy đối tượng');
  return { geojson: JSON.stringify(f.geometry), ...(f.name ? { label: f.name } : {}) };
}
```

Widen `areaGeometry`'s input type the same way:

```ts
export async function areaGeometry(
  db: Queryable,
  input: {
    geometry?: GeoJsonGeometry;
    feature?: FeatureRefInput;
    reference?: ReferenceRefInput;
    bufferKm?: number;
  }
): Promise<{ geojson: string; display: GeoJsonGeometry; label?: string; areaKm2: number }> {
```

Its body needs no other change: it already calls `inputGeometry` first.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @webatlas/api -- src/modules/analysis/analysis.test.ts`
Expected: PASS — the new describe plus every pre-existing analysis test.

If the "area limit" test does not trip at radius 100, the chosen entity is smaller than assumed. Do **not** lower `MAX_ROI_AREA_KM2` to make the test pass — pick a longer entity, or assert on a computed expectation instead.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/analysis
git commit -m "feat(api): dùng thực thể nền bản đồ làm vùng quan tâm cho phân tích"
```

---

### Task 8: Documentation and full verification

**Files:**
- Modify: `docs/architecture/database-architecture.md`
- Modify: `docs/runbooks/README.md`
- Modify: the API reference doc (find it: `ls docs/architecture/` and `grep -rln "api/admin-units" docs/`)
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Flip the architecture doc's phase markers**

In `docs/architecture/database-architecture.md`, find the Designed/Implemented markers for the reference-layer material and flip Phase 2 to Implemented. Add a subsection covering:
- `basemap.reference_entities`: purpose, columns, the `entity_id` format, the single-writer rule.
- **Why the trigram indexes are on the dissolved table, not the raw tables** — the `to_postgis(if_exists="replace")` hazard. This is the single most surprising thing a future reader needs; state it plainly.
- The `CLUSTER_EPS_DEGREES` choice and what it means for an entity's identity.
- That `webatlas_assistant` still holds nothing on `basemap`.

- [ ] **Step 2: Add the runbook ordering**

In `docs/runbooks/README.md`, wherever the basemap load is documented, add the follow-up step and the reason:

```markdown
3. Rebuild the dissolved reference entities — the loader replaces its tables
   wholesale, so every entity is stale once it finishes:

       npm run reference:build -w @webatlas/api
```

- [ ] **Step 3: Document the new and changed routes**

Add `GET /api/reference/layers`, `GET /api/reference/:layer/entities`, `GET /api/reference/:layer/entities/:entityId`, the `sources` parameter on `GET /api/search` (with the full token list and the default), and the `reference` input accepted by `POST /api/analysis/:op`.

- [ ] **Step 4: Full verification**

Run each, separately, with **no other agent using the dev DB** — concurrent suites against the shared database produced spurious failures throughout Phase 1:

```bash
npm run test -w @webatlas/shared
npm run test -w @webatlas/api
npm run test -w @webatlas/web
npm run build:web
npm run lint:web
```

Expected: shared 101; api 373 + the new tests; web 448 + the new test; `build:web` exit 0; `lint:web` 0 errors. Record the real numbers — if a count is lower than expected, find out why before calling it done.

- [ ] **Step 5: Verify the migration round-trips one more time on the finished branch**

```bash
npm run migrate:down -w @webatlas/api
npm run migrate:up -w @webatlas/api
npm run reference:build -w @webatlas/api
npm run test -w @webatlas/api -- src/modules/reference/reference.test.ts
```
Expected: all four exit 0. Migration 16's down path broke twice in Phase 1 for exactly this reason; prove it before merging.

- [ ] **Step 6: Update the progress ledger**

Record in `.superpowers/sdd/progress.md`: the measured build time per layer, the real entity counts, the verification numbers, and anything deferred.

- [ ] **Step 7: Commit**

```bash
git add docs .superpowers/sdd/progress.md
git commit -m "docs: cập nhật kiến trúc, API và runbook cho lớp tham chiếu"
```

---

## Self-Review

**Spec §4 coverage:**

| §4 requirement | Task |
|---|---|
| Reference registry mirroring `layers/registry.ts`, sole key→SQL path | 1 |
| Declares key, table, geom column, id column, name column, optional ref, `fclass`, summable attrs | 1 |
| In scope: the five layers; out: `dem_region`, `contours`, `*_vn` duplicates | 1 (asserted in tests) |
| `basemap.reference_entities` built by `coalesce(ref,name)` + `ST_ClusterDBSCAN`, merged geometry + member `osm_id`s | 2, 3 — with `ref` unnested on `;` first; deviation 3 above says why a literal reading fragments QL.14 |
| Rebuilt whenever the loader runs | 3 (script), 8 (runbook ordering) |
| Exactly one writer | 3 (documented and enforced by having one module write it) |
| Trigram indexes for search | 2 — on the dissolved table; deviation documented above and in Task 8 |
| `/api/search` optional source filter so roads and landuse are findable | 5, 6 |
| ROI: `{ referenceLayer, entityId, radiusKm? }` | 7 |
| Lines and points require a radius | 7 |
| Clipped to the working region | 7 |
| Refused past a size limit, message naming which limit | 7 (area and vertex limits, separate messages) |
| Assistant access by typed tools; `webatlas_assistant` gains nothing | 2 (verified), 8 — typed tools themselves are Phase 5 |

**Deliberately out of scope here:** the `resolve_entity` / `upstream_of` / `related_entities` assistant tools (§9, Phase 5), the ROI object and toolbar redesign (§5, Phase 4), and road noding/routing (§6, deferred indefinitely). Task 7 gives the analysis ops a reference-entity input; it does not build the first-class ROI object.

**Type consistency check:** `ReferenceLayerKey` (Task 1) is the enum in `ReferenceRef` (Task 7) and in `SEARCH_SOURCES` (Task 5). `entity_id` (Task 2) is `entityId` across the API (Task 4), the search `featureId` (Task 5) and `ReferenceRef.entityId` (Task 7) — one format, `<layer>:<md5>:<cluster>`, asserted in Tasks 3, 5 and 7. `buildReferenceLayer` / `buildReferenceEntities` (Task 3) are called by the script (Task 3) and three test files (Tasks 3, 5, 7) under those exact names. `inputGeometry` and `areaGeometry` (Task 7) keep their existing names and gain one optional field.

**Known risk to watch:** Task 5's `.replace('AS layer_key,', ...)` couples the reference UNION arm to the exact text `layerSelect` emits. Step 3 flags it; prefer editing `layerSelect` directly.
