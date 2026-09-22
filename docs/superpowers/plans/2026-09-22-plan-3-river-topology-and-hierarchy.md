# River Topology and Three-Level Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `water.rivers` a real entity model — named river (level 1) → HydroRIVERS reach (level 2) → OSM way (level 3) — with the reach network's `NEXT_DOWN` flow links preserved, so that one river is one searchable, selectable row instead of hundreds of fragments.

**Architecture:** `rivers.external_id` becomes prefixed text (`osm:`, `hyriv:`, `river:`, `edit:`) so three sources share one identity space. HydroRIVERS reaches load as a new ingest version through the existing versioning pipeline, carrying `flows_into_external_id` from `NEXT_DOWN`. A builder assigns each reach the name of the nearest named OSM way (majority vote over samples, with a recorded confidence), then groups reaches into level-1 rivers by **name plus connectivity**, deriving each river's geometry from its member OSM ways. Rendering, search and editing then each read the level they mean, and the `rivers_overview` materialised view — a snapshot that could go stale — is replaced by a plain view over level 1.

**Tech Stack:** PostgreSQL 16 / PostGIS 3.4, node-pg-migrate (CommonJS migrations), TypeScript + `pg`, Vitest (integration suites against the live dev DB), Python 3.13 + geopandas 1.1.4 for the HydroRIVERS prep, GeoServer 2.26 REST.

**Spec:** `docs/superpowers/specs/2026-09-18-entity-model-networks-and-roi-design.md` §1 and §2. This is piece 3 of 5 in that spec's §10 sequencing. Phase 1 (`d4a209f`) and Phase 2 (`2cae7a5`) are merged; branch from `main`.

---

## Global Constraints

- **PostgreSQL only.** No graph database, no second store (spec INV-1). All traversal is `WITH RECURSIVE` over an adjacency column.
- **Links key on `external_id`, never `id`.** An edit writes a new row with a new `id`; an `id` link points into superseded data the moment anyone edits the parent.
- **Every hierarchy walk runs *after* version resolution** — on `water.rivers_active` or an equivalent resolved set, never on the raw table.
- **Two separate link columns.** `parent_external_id` means "is part of"; `flows_into_external_id` means "water goes here". Never overload one.
- **Level-1 geometry is derived and has exactly one owner** — the builder in Task 6. No per-row trigger: a one-row edit must not re-cluster the layer.
- **Geometry is editable on level 3 only.** Level 1 is derived; level 2 comes from ingest. Attributes (notably `name`) stay editable at level 1.
- **`stream_order` stops lying.** Level 2 carries the true Strahler order (`ORD_STRA`); level 3 keeps the OSM waterway rank it always held; level 1 takes the maximum over its reaches.
- **Never invent a name or a relationship.** An unmatched reach stays unmatched and visibly so. Low-confidence matches are recorded with their confidence, not silently promoted.
- **Region of interest is the six working provinces**, codes `48, 51, 52, 56, 66, 68` from `REGION_PROVINCE_CODES` in `packages/shared/src/region.ts` — the single source of truth. Do not hardcode the list anywhere new.
- **`apps/api` has no `typecheck` script**, so TypeScript errors there are invisible to every automated gate. Run `npx tsc --noEmit` inside `apps/api` before every commit in this plan.

## Measured Baselines

Every number below was measured against the live dev DB and the real HydroRIVERS Asia shapefile on 2026-09-22, before this plan was written. They are facts, not estimates. Where an activation gate needs a pinned baseline (spec §2), these are the values to pin.

| Quantity | Measured |
|---|---|
| `water.rivers_active` rows today | 9,486 (1,327 named, 466 distinct names) |
| HydroRIVERS reaches intersecting the six provinces, all orders | **13,045**, every `HYRIV_ID` unique, every geometry a `LineString` |
| Their `ORD_STRA` distribution | 1:6,755 · 2:3,083 · 3:1,604 · 4:831 · 5:582 · 6:190 |
| Terminal reaches (`NEXT_DOWN = 0`) | 184 |
| Reaches whose `NEXT_DOWN` leaves the selection | 53 (they flow out of the region — legitimately dangling) |
| Committed seed size, 5-decimal rounding | **3.25 MB** for 13,045 reaches (today's file: 3.08 MB for 9,890) |
| Reaches with a named OSM way within 1 km | 7,446 |
| Reaches with a ≥3-of-5 majority name | 5,813 |
| Reaches assigned at this plan's threshold (≥3/5 **and** median ≤ 500 m) | **4,716** |
| Distinct names assigned at that threshold | **439** of 466 |
| **Level-1 rivers produced (name + connectivity)** | **631** |
| Names split across more than one connected component | 109 (max 15, for `Sông Cái` — literally "main river", genuinely many rivers) |
| Single-reach naming gaps that bridging would close | 38 (measured; deliberately **not** implemented — Deviation 4) |
| Total length, member ways vs member reaches | 13,483 km vs 11,961 km; median per-river ratio **1.11** |
| Name join through `rivers_active` vs a materialised copy | **>120 s (timed out) vs 10.9 s** |

## Deviations From the Spec, and Why

Five. Each is a measured correction, not a shortcut. A reviewer should check the measurement, not just the reasoning.

**1. Level-1 rivers group by name + connectivity, not one per connected reach set.** Spec §2 says "walk `flows_into` to obtain connected reach sets; take the majority name among each set's matched OSM ways; emit one level-1 row per set". Measured: the largest connected component carries **134 distinct OSM river names** — Sê San, Srêpốk, Krông Ana, Krông Nô, Đăk Bla and about 120 named suối are all one component, because they are one basin. Taken literally the spec emits one river for that basin and discards 133 names, which is worse than today. A connected component is a **basin**, not a river. So a level-1 river is one name plus one connected group, and disjoint same-name groups become separate entities — exactly Phase 2's proven pattern (`Thôn 3` is 147 different hamlets). Components are still computed, and still used, for `flows_into`. **User decision, 2026-09-22.**

**2. Unnamed reaches get no level-1 row and keep `parent_external_id` NULL.** Spec §2 says an unmatched set "gets a river row with no name". Measured: 8,329 of 13,045 reaches have no confident name — headwater streams HydroRIVERS maps and OSM has not named. Emitting a nameless entity for each would flood search and the ROI picker with thousands of unselectable rows. They stay level-2 rows, fully walkable via `flows_into`, simply not entities. **User decision, 2026-09-22.**

**3. Level-1 geometry derives from member OSM ways (level 3), not member reaches (level 2).** Spec §1 says "merged, **derived** from member reaches". Measured: per-river length between the two sources agrees to a median ratio of 1.11 (Sông Ba: 349 km of way vs 352 km of reach; Sông Đồng Nai: 248 vs 254) — so the extra 1.11x is vertex detail, not extra extent. Deriving from ways therefore costs nothing in coverage while giving finer geometry, the same shape the detailed layer already draws (so far-zoom rendering stays visually consistent), and independence from the spatial vote, so a bad match cannot deform a river. The reaches keep their real job: topology (`flows_into`) and true Strahler order. Note this does **not** widen which rivers exist: spec §2's gate "every level-1 river has at least one reach" still holds, so the 27 names that have OSM ways but no confidently matched reach get no river row — geometry source and entity existence are separate questions. **Planner's call — flag at final review.**

**4. Single-reach naming-gap bridging is deliberately not implemented.** A river can fragment because one middle reach failed the vote rather than because it is genuinely disjoint. Measured: only **38** reaches are single-reach gaps whose upstream and downstream carry the same name. Bridging them would infer a name the data does not state, for roughly a 6% reduction in fragmentation. YAGNI, and it would violate "never invent a relationship". Recorded here so nobody re-derives it. **Planner's call.**

**5. The reach ingest is a script registered as an atlas-data `run` escape hatch, not a `load-geojson` descriptor.** Spec §2 wants it "declared as a descriptor in `packages/atlas-data` rather than a sixteenth bespoke script". Checked: `packages/atlas-data/src/runner.ts:118-121` implements only the `sql` stage — `load-geojson` is declared in `types.ts` but unimplemented, and belongs to the dataset-registry track, not this one. The repo already has the right mechanism for this situation: a `run` stage with `promoteTo` and `promoteBy`, which `assertNoOverdueEscapeHatches` (`packages/atlas-data/src/debt.ts`) turns into a build failure once the deadline passes. So the ingest ships as a script and is registered as a dated escape hatch that cannot quietly become permanent. **Planner's call.**

## Verified Hazards

Four things that will bite an implementer who has not been told. Each was reproduced on the live stack on 2026-09-22.

1. **`ALTER COLUMN external_id TYPE text` is refused while the views exist.** Reproduced verbatim:
   `ERROR: cannot alter type of a column used by a view or rule` /
   `DETAIL: rule _RETURN on view water.rivers_active depends on column "external_id"`.
   The migration must drop `water.rivers_overview` (materialised, and it reads `rivers_active`) **and** `water.rivers_active`, alter the column, then recreate both. Postgres rebuilds the dependent unique index by itself; the views it does not.
2. **GeoServer caches the attribute schema.** `DescribeFeatureType` for `webatlas:rivers` currently advertises `external_id -> xsd:int`. `publishAll()` is a no-op once `nativeName` already matches, so it will **not** refresh this. `POST /geoserver/rest/reset` flushes the catalog cache without touching styling — verified available, returns 200. Note also that GeoServer already omits `name` (it collides with `gml:name`) and both `text[]` code columns, so their absence from `DescribeFeatureType` is pre-existing and not something this plan broke.
3. **`water.rivers_active` is an optimizer fence.** A predicate on top of the view cannot be pushed into its recursive version-resolution pipeline. The name join through the view **timed out past 120 s**; the same join against a materialised copy of the 1,327 named ways took **10.9 s**. Every builder in this plan must materialise its inputs first, the same way `modules/search/repository.ts` does and for the same reason.
4. **A cancelled psql client does not cancel its backend.** Killing the shell leaves the query running and holding `AccessShareLock` on `water.rivers`, which silently blocks the next `ALTER TABLE`. If a migration appears to hang, check `pg_stat_activity` and `pg_cancel_backend` before assuming the migration is at fault.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/api/src/db/migrations/1000000000018_rivers-external-id-text.cjs` | `external_id` integer → prefixed text; drops and recreates the view chain |
| `apps/api/src/db/migrations/1000000000019_rivers-hierarchy.cjs` | The four hierarchy columns, their check constraint and indexes |
| `apps/api/src/db/migrations/1000000000020_rivers-level-views.cjs` | `rivers_detail` (level 3) and `rivers_overview` as a plain view over level 1; drops the matview |
| `apps/api/src/db/seeds/data/hydrorivers-region.geojson` | Committed reach seed: 13,045 features carrying `NEXT_DOWN` (generated artifact) |
| `apps/api/src/db/seeds/ingestReaches.ts` | Loads the reach seed as a level-2 ingest version. One responsibility: get reaches into the table |
| `apps/api/src/db/riverHierarchy.ts` | Single writer of the derived hierarchy: name join, level-1 rows, links. Mirrors `db/referenceEntities.ts` |
| `apps/api/src/db/riverGates.ts` | The §2 activation gates as assertions over a resolved reach set, callable from the builder and its tests |
| `apps/api/src/scripts/buildRiverHierarchy.ts` | CLI wrapper, mirrors `scripts/buildReference.ts` |
| `packages/atlas-data/src/descriptors/hydrorivers.ts` | The dated `run` escape hatch declaring this ingest (Deviation 5) |
| `apps/api/src/db/riversIdentity.test.ts` | Task 1's contract: every `external_id` carries a known prefix |
| `apps/api/src/db/seeds/reachSeed.test.ts` | Task 3's data contract on the committed file |
| `apps/api/src/db/ingestReaches.test.ts` | Task 4 |
| `apps/api/src/db/riverHierarchy.test.ts` | Tasks 5, 6 and the gates |

**Modified**

| File | Change |
|---|---|
| `apps/api/scripts/prep_hydrosheds.py` | Keep `NEXT_DOWN`/`MAIN_RIV`; select whole reaches intersecting the region instead of `gpd.clip` at a bbox; round to 5 decimals |
| `apps/api/scripts/prep-hydrosheds.sh` | Output filename and the stale `ORD_STRA` note |
| `apps/api/src/layers/registry.ts` | `EXTERNAL_ID_TYPE.rivers` becomes `'text'` |
| `apps/api/src/db/seeds/ingestRivers.ts` | `external_id` gains the `osm:` prefix |
| `apps/api/src/modules/search/repository.ts` | Rivers are searched at level 1 only |
| `apps/api/src/modules/layers/repository.ts` | Refuse geometry edits above level 3; refuse deleting a parent with live children |
| `apps/api/src/geoserver/publish.ts` | `rivers` repoints to `rivers_detail`; add the catalog reset |
| `apps/api/src/db/riverOverview.ts` | Deleted — the matview it refreshed no longer exists |
| `apps/api/package.json` | `rivers:reaches` and `rivers:hierarchy` scripts |
| `docs/architecture/database-architecture.md` | §1/§2 markers designed → implemented |
| `docs/runbooks/README.md`, `docs/runbooks/self-hosted-basemap.md` | Rebuild ordering |

**Deliberately not touched: `apps/web`.** The frontend uses neither `external_id` (grep for it in `apps/web/src` returns zero hits) nor any new column, and `rivers_overview` keeps its name, WFS typename and column list, so `features/map/model/riverOverview.ts` and the LOD logic in `MapModel.ts` need no change. If a task finds itself editing `apps/web`, stop and re-read this line.

## Prerequisite (already done by the planner)

The HydroRIVERS Asia shapefile has been downloaded and extracted to the session scratchpad:

```
C:\Users\quock\AppData\Local\Temp\claude\c--Users-quock-Documents-Projects-webatlas\4b50c169-a355-41a6-b54f-3051ff782f5e\scratchpad\hydro\HydroRIVERS_v10_as_shp\HydroRIVERS_v10_as.shp
```

It is 207 MB of `.shp` plus a 147 MB `.dbf` and is **never committed** — only the 3.25 MB derived GeoJSON is. If the scratchpad has been cleaned, re-download from `https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip` (~90 MB, HydroSHEDS, CC BY 4.0). `geopandas 1.1.4` is already installed and importable; no system GDAL is needed or present.

---

### Task 1: `rivers.external_id` becomes prefixed text

Three sources will share this column, and `HYRIV_ID` values collide with OSM way ids, so identity has to carry its origin. Nothing else in this plan can land first: every link column added later stores values from this space.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000018_rivers-external-id-text.cjs`
- Create: `apps/api/src/db/riversIdentity.test.ts`
- Modify: `apps/api/src/layers/registry.ts` (the `EXTERNAL_ID_TYPE` map, ~line 58)
- Modify: `apps/api/src/db/seeds/ingestRivers.ts` (`RIVERS_HYDRO_LAYER.columns`, ~line 24)

Spec §1 lists `LAYER_ATTRIBUTE_MAP` among the consequences of this type change. **Checked: it needs none.** `packages/shared/src/layer-attributes.ts` maps column names to ISO 19103 attribute names (`external_id -> 'localId'`) and carries no types, so a text `external_id` changes nothing there. Do **not** add the four hierarchy columns to it either: `editableColumns()` excludes only `external_id`, so anything listed becomes editable in the attribute form, and `feature_level`, `parent_external_id`, `flows_into_external_id` and `match_confidence` are system-managed. Recorded here so a reviewer can see it was considered rather than missed.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the identity space every later task writes into — `osm:<osmWayId>` for ingested ways, `edit:<uuid>` for steward-created rows (minted by `mintExternalId` in `modules/layers/repository.ts`, which already returns `edit:${randomUUID()}` for text layers). Tasks 4 and 6 add `hyriv:<HYRIV_ID>` and `river:<n>`. `RIVERS_HYDRO_LAYER` becomes an exported const so its column map is unit-testable.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/riversIdentity.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { LAYER_REGISTRY } from '../layers/registry';
import { RIVERS_HYDRO_LAYER } from './seeds/ingestRivers';

afterAll(async () => { await closePool(); });

describe('rivers identity space', () => {
  it('holds external_id as text in the catalog', async () => {
    const { rows } = await getPool().query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers'
          AND column_name = 'external_id'`
    );
    expect(rows[0].data_type).toBe('text');
  });

  it('stores every active external_id with a known source prefix', async () => {
    const { rows } = await getPool().query<{ total: string; prefixed: string; bare: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE external_id ~ '^(osm|hyriv|river|edit):')::text AS prefixed,
              count(*) FILTER (WHERE external_id ~ '^[0-9]+$')::text AS bare
         FROM water.rivers_active`
    );
    // The seeded OSM waterways layer; asserted as a floor so a later ingest can grow it.
    expect(Number(rows[0].total)).toBeGreaterThan(9000);
    // Every row, not most: an unprefixed id is ambiguous against HydroRIVERS.
    expect(rows[0].prefixed).toBe(rows[0].total);
    expect(rows[0].bare).toBe('0');
  });

  it('declares rivers as a text-id layer so a minted id is a uuid string', () => {
    expect(LAYER_REGISTRY.rivers.externalIdType).toBe('text');
  });

  it('prefixes the id the OSM ingest writes', () => {
    const cols = RIVERS_HYDRO_LAYER.columns({ osmId: 12207485, name: 'Sông Thu Bồn' }, 0);
    expect(cols.external_id).toBe('osm:12207485');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/riversIdentity.test.ts`

Expected: FAIL. The first test reports `'integer'`, the second reports 9,486 bare ids and 0 prefixed, the third reports `'integer'`, the fourth fails to import `RIVERS_HYDRO_LAYER` (not yet exported).

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000018_rivers-external-id-text.cjs`. The view DDL is **copied**, not imported: a migration that imports a shared helper silently changes meaning when the helper changes.

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

// Verbatim copy of migration 1000000000005's generated view for `rivers`. A view's
// SELECT * is expanded at creation time, so this text is the view's real contract.
const RIVERS_ACTIVE = `
  CREATE VIEW water.rivers_active AS
  WITH RECURSIVE active AS (
    SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active
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
      FROM water.rivers t JOIN chain c ON t.dataset_version_id = c.id
      ORDER BY t.external_id, c.depth
  )
  SELECT * FROM resolved WHERE NOT deleted;
`;

// Verbatim copy of migration 1000000000009. Migration 20 replaces this with a plain
// view over level 1; it is recreated here so THIS migration is self-contained and
// reversible on its own.
const RIVERS_OVERVIEW = `
  CREATE MATERIALIZED VIEW water.rivers_overview AS
    SELECT COALESCE(name, '') AS name_key,
           name,
           5 AS stream_order,
           ST_LineMerge(ST_Collect(ST_SimplifyPreserveTopology(geom, 0.01))) AS geom
      FROM water.rivers_active
     WHERE stream_order = 5
     GROUP BY COALESCE(name, ''), name
`;
const OVERVIEW_INDEXES = [
  `CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`,
  `CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`,
];

exports.up = (pgm) => {
  // Postgres refuses the type change while any view depends on the column:
  //   ERROR:  cannot alter type of a column used by a view or rule
  //   DETAIL: rule _RETURN on view water.rivers_active depends on column "external_id"
  // rivers_overview reads rivers_active, so it goes first. The per-version unique
  // index on (dataset_version_id, external_id) is rebuilt by Postgres automatically.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.sql(`
    ALTER TABLE water.rivers
      ALTER COLUMN external_id TYPE text
      USING CASE WHEN external_id IS NULL THEN NULL
                 ELSE 'osm:' || external_id::text END
  `);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  // Refuse rather than silently destroy: an 'edit:<uuid>' id from a steward-created
  // river, or a 'hyriv:'/'river:' id from a later task, has no integer form. Losing a
  // feature to keep a down-migration tidy is the worse trade, so say so and stop.
  pgm.sql(`
    DO $$
    DECLARE n bigint;
    BEGIN
      SELECT count(*) INTO n FROM water.rivers
       WHERE external_id IS NOT NULL AND external_id !~ '^osm:[0-9]+$';
      IF n > 0 THEN
        RAISE EXCEPTION
          'cannot revert 1000000000018: % water.rivers rows have a non-osm external_id', n;
      END IF;
    END $$;
  `);
  pgm.sql(`
    ALTER TABLE water.rivers
      ALTER COLUMN external_id TYPE integer
      USING CASE WHEN external_id IS NULL THEN NULL
                 ELSE substring(external_id from 5)::integer END
  `);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
};
```

- [ ] **Step 4: Change the registry and the ingest column map**

In `apps/api/src/layers/registry.ts`, in the `EXTERNAL_ID_TYPE` map, change `rivers` and correct the comment above it (it currently says "dams/rivers/lakes carry a numeric upstream id"):

```ts
// Mirrors the live column types in migration 1000000000002_water-schema.cjs, as amended
// by 1000000000018: dams/lakes carry a numeric upstream id; rivers became prefixed text
// when HydroRIVERS reaches and derived rivers joined OSM ways in one identity space.
const EXTERNAL_ID_TYPE: Record<EditableLayerKey, 'integer' | 'text'> = {
  dams: 'integer',
  rivers: 'text',
  lakes: 'integer',
  stations: 'text',
  flood_zones: 'text',
  drought_points: 'text',
  saltwater_intrusion: 'text',
  flood_generation: 'text',
};
```

In `apps/api/src/db/seeds/ingestRivers.ts`, export the layer and prefix the id:

```ts
// Exported so the column map is unit-testable without a database: the 'osm:' prefix is
// a contract other sources depend on, not an implementation detail.
export const RIVERS_HYDRO_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/osm-rivers-region.geojson'),
  source: HYDRORIVERS_SOURCE,
  multiLine: true,
  columns: (p) => ({
    // 'osm:' so an OSM way id can never be mistaken for a HYRIV_ID (migration 18).
    external_id: `osm:${String(p.osmId)}`,
    code: p.waterway,
    name: p.name,
    stream_order: p.streamOrder,
    length_m: p.lengthM,
  }),
};
```

- [ ] **Step 5: Apply the migration and run the test**

```bash
npm run migrate:up -w @webatlas/api
npm run test -w @webatlas/api -- src/db/riversIdentity.test.ts
```

Expected: migration exits 0; 4/4 tests pass. The existing 9,486 rows are rewritten in place, so **no re-ingest is needed**.

- [ ] **Step 6: Prove the rewrite is load-bearing**

Temporarily change the migration's `USING` clause to `external_id::text` (dropping the prefix), then:

```bash
npm run migrate:down -w @webatlas/api && npm run migrate:up -w @webatlas/api
npm run test -w @webatlas/api -- src/db/riversIdentity.test.ts
```

Expected: FAIL with 9,486 bare ids. Restore the `'osm:' ||` clause, run the down/up cycle again, confirm 4/4 green. Record both outcomes in the ledger.

- [ ] **Step 7: Flush GeoServer's cached attribute schema**

GeoServer still advertises `external_id -> xsd:int`. `publishAll()` will not fix this — it is a no-op once `nativeName` matches.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -u admin:change_me_dev -X POST http://localhost:8080/geoserver/rest/reset
curl -s -u admin:change_me_dev "http://localhost:8080/geoserver/webatlas/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=webatlas:rivers" | grep -o 'name="external_id"[^/]*'
```

Expected: `200`, then `type="xsd:string"`. Then confirm the map layer still serves data:

```bash
curl -s -u admin:change_me_dev "http://localhost:8080/geoserver/webatlas/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=webatlas:rivers&maxFeatures=1&outputFormat=application/json" | head -c 300
```

Expected: a GeoJSON FeatureCollection, not an `ExceptionReport`.

- [ ] **Step 8: Run the full API suite and typecheck**

```bash
cd apps/api && npx tsc --noEmit && cd ../..
npm run test -w @webatlas/api
```

Expected: `tsc` exits 0. The suite's baseline at the start of this plan is **57 files / 417 tests**; expect 421 (the 4 new ones) and no failures. If anything fails, it is a real consequence of the type change — most likely a test asserting a numeric river `external_id`. Fix the test only after confirming the production code is right.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/migrations/1000000000018_rivers-external-id-text.cjs \
        apps/api/src/db/riversIdentity.test.ts \
        apps/api/src/layers/registry.ts \
        apps/api/src/db/seeds/ingestRivers.ts
git commit -m "feat(api): external_id của rivers thành text có tiền tố nguồn"
```

---

### Task 2: The four hierarchy columns

Structure before data. Nothing writes these columns yet, so this task is reviewable purely as a schema change — and it carries the plan's least obvious trap: `rivers_active` is `SELECT *`, expanded at creation, so adding a column to the table does **not** add it to the view.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000019_rivers-hierarchy.cjs`
- Create: `apps/api/src/db/riversHierarchySchema.test.ts`

**Interfaces:**
- Consumes: Task 1's text `external_id`.
- Produces: on `water.rivers` and on `water.rivers_active` — `feature_level smallint NOT NULL DEFAULT 3`, `parent_external_id text`, `flows_into_external_id text`, `match_confidence real`; a check constraint `rivers_feature_level_check` allowing only 1, 2, 3; btree indexes on each of the three new non-audit columns.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/riversHierarchySchema.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

const NEW_COLUMNS = ['feature_level', 'parent_external_id', 'flows_into_external_id', 'match_confidence'];

describe('rivers hierarchy schema', () => {
  it('adds the four hierarchy columns with the right types', async () => {
    const { rows } = await getPool().query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers' AND column_name = ANY($1)
        ORDER BY column_name`,
      [NEW_COLUMNS]
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'feature_level', 'flows_into_external_id', 'match_confidence', 'parent_external_id',
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.feature_level.data_type).toBe('smallint');
    expect(byName.feature_level.is_nullable).toBe('NO');
    expect(byName.parent_external_id.data_type).toBe('text');
    expect(byName.flows_into_external_id.data_type).toBe('text');
    expect(byName.match_confidence.data_type).toBe('real');
  });

  it('exposes the new columns through rivers_active', async () => {
    // A view's SELECT * is expanded at CREATE time, so the migration has to recreate
    // the view. Without that this passes nowhere and every later task reads NULLs it
    // cannot see.
    const { rows } = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers_active' AND column_name = ANY($1)`,
      [NEW_COLUMNS]
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual([...NEW_COLUMNS].sort());
  });

  it('defaults existing and steward-created rows to level 3', async () => {
    const { rows } = await getPool().query<{ total: string; three: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE feature_level = 3)::text AS three
         FROM water.rivers_active`
    );
    // Every row in the table today is an OSM way, which is exactly what level 3 means.
    expect(rows[0].three).toBe(rows[0].total);
  });

  it('refuses a feature_level outside 1..3', async () => {
    await expect(
      getPool().query(
        `INSERT INTO water.rivers (external_id, feature_level, geom, dataset_version_id)
         SELECT 'osm:zz-level-check', 4,
                ST_Multi(ST_GeomFromText('LINESTRING(108 12, 108.01 12.01)', 4326)),
                id
           FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
      )
    ).rejects.toThrow(/rivers_feature_level_check/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/riversHierarchySchema.test.ts`

Expected: FAIL — the first test returns an empty array (columns do not exist), and the fourth fails with `column "feature_level" of relation "rivers" does not exist` rather than the check-constraint message.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000019_rivers-hierarchy.cjs`. Copy the same two DDL constants from migration 18 into this file (again: copied, not imported).

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

const RIVERS_ACTIVE = `...verbatim copy from migration 1000000000018...`;
const RIVERS_OVERVIEW = `...verbatim copy from migration 1000000000018...`;
const OVERVIEW_INDEXES = [
  `CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`,
  `CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`,
];

const TBL = { schema: 'water', name: 'rivers' };

exports.up = (pgm) => {
  pgm.addColumns(TBL, {
    // DEFAULT 3 is deliberate and stays. insertIntoVersion (modules/layers/repository.ts)
    // builds its column list from the registry's attribute columns and never mentions
    // feature_level, so a NOT NULL column without a default would break every
    // steward-created river. The default also encodes the real editing rule: a steward
    // draws an OSM-style way, which IS level 3. Ingests and the level-1 builder set the
    // level explicitly.
    feature_level: { type: 'smallint', notNull: true, default: 3 },
    // Composition: "what is this part of". way -> river, reach -> river.
    parent_external_id: { type: 'text' },
    // Hydrology: "where does the water go". reach -> reach, river -> river.
    // Separate from parent_external_id so neither column's meaning depends on the row's
    // level, and no query has to know which sense it is reading.
    flows_into_external_id: { type: 'text' },
    // 0..1 for a computed parent link. A bad join stays visible instead of silent.
    match_confidence: { type: 'real' },
  });
  pgm.addConstraint(TBL, 'rivers_feature_level_check', { check: 'feature_level IN (1, 2, 3)' });
  pgm.createIndex(TBL, 'feature_level');
  pgm.createIndex(TBL, 'parent_external_id');
  pgm.createIndex(TBL, 'flows_into_external_id');

  // The view must be recreated or the new columns are invisible to every reader: a
  // view's SELECT * is expanded when the view is created, not when it is queried.
  // rivers_overview depends on rivers_active, so it is dropped first and rebuilt after.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
};

exports.down = (pgm) => {
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_active`);
  pgm.dropConstraint(TBL, 'rivers_feature_level_check');
  pgm.dropColumns(TBL, [
    'feature_level', 'parent_external_id', 'flows_into_external_id', 'match_confidence',
  ]);
  pgm.sql(RIVERS_ACTIVE);
  pgm.sql(RIVERS_OVERVIEW);
  for (const sql of OVERVIEW_INDEXES) pgm.sql(sql);
};
```

`pgm.dropColumns` removes the three indexes with their columns, so they need no explicit drop.

- [ ] **Step 4: Apply and run the test**

```bash
npm run migrate:up -w @webatlas/api
npm run test -w @webatlas/api -- src/db/riversHierarchySchema.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Prove the view recreation is load-bearing**

Comment out the four `pgm.sql` view lines at the end of `exports.up` (leave the two DROPs — otherwise `CREATE` fails), run `migrate:down` then `migrate:up`, and run the test.

Expected: the "exposes the new columns through rivers_active" test FAILS. Restore the lines, cycle down/up, confirm 4/4. This is the step that catches the plan's least obvious trap, so record the failure text in the ledger.

- [ ] **Step 6: Confirm the steward edit path still works**

The insert path never mentions `feature_level`, so the default has to carry it. Run the existing feature-CRUD suite:

```bash
npm run test -w @webatlas/api -- src/modules/layers
```

Expected: all green. If a create test fails with `null value in column "feature_level"`, the migration's `default: 3` was dropped — restore it rather than editing the insert path.

- [ ] **Step 7: Typecheck, full suite, commit**

```bash
cd apps/api && npx tsc --noEmit && cd ../..
npm run test -w @webatlas/api
git add apps/api/src/db/migrations/1000000000019_rivers-hierarchy.cjs \
        apps/api/src/db/riversHierarchySchema.test.ts
git commit -m "feat(api): thêm bốn cột phân cấp cho water.rivers"
```

Expected: `tsc` 0; suite 425 tests green (421 + 4).

---

### Task 3: HydroRIVERS prep keeps `NEXT_DOWN` and selects the region

The reason this whole phase exists is one column the existing prep throws away. This task regenerates the committed seed: `NEXT_DOWN` and `MAIN_RIV` kept, whole reaches selected against the six provinces instead of clipped at a bbox, all stream orders kept, coordinates rounded to 5 decimals.

**Files:**
- Modify: `apps/api/scripts/prep_hydrosheds.py` (`RIVER_FIELDS` ~line 29, `RIVER_MIN_ORD_STRA` ~line 34, `clip_rivers` ~line 43, `_write_geojson` ~line 51)
- Modify: `apps/api/scripts/prep-hydrosheds.sh` (the rivers invocation and its stale `ORD_STRA` note, ~lines 26-36)
- Create: `apps/api/src/db/seeds/data/hydrorivers-region.geojson` (generated, committed, 3.25 MB)
- Create: `apps/api/src/db/seeds/reachSeed.test.ts`

**Interfaces:**
- Consumes: `REGION_PROVINCE_CODES` from `@webatlas/shared` (for the test's drift guard only — Python cannot import TypeScript).
- Produces: the committed file `apps/api/src/db/seeds/data/hydrorivers-region.geojson` — a `FeatureCollection` of 13,045 `LineString` features whose properties are exactly `HYRIV_ID`, `NEXT_DOWN`, `MAIN_RIV`, `ORD_STRA`, `LENGTH_KM`. Task 4 loads it.

`hydrorivers-vn.geojson` is **kept**, not deleted: keeping the old seed in git was an explicit user decision during the region-scoping work. It is superseded and has no `NEXT_DOWN`; Task 8 says so in the runbook. Do not load it anywhere.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/seeds/reachSeed.test.ts`. Every number here was measured before this plan was written — **if a count differs, stop and report it rather than editing the expectation.**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';

const here = fileURLToPath(new URL('.', import.meta.url));
const SEED = resolvePath(here, 'data/hydrorivers-region.geojson');
const PREP = resolvePath(here, '../../../scripts/prep_hydrosheds.py');

interface Reach {
  geometry: { type: string; coordinates: [number, number][] };
  properties: { HYRIV_ID: number; NEXT_DOWN: number; MAIN_RIV: number; ORD_STRA: number; LENGTH_KM: number };
}

const fc = JSON.parse(readFileSync(SEED, 'utf8')) as { type: string; features: Reach[] };

describe('committed HydroRIVERS reach seed', () => {
  it('holds every reach intersecting the six provinces, at every stream order', () => {
    expect(fc.features).toHaveLength(13045);
    const orders = fc.features.map((f) => f.properties.ORD_STRA);
    // Order 1 present proves the ORD_STRA >= 3 threshold is gone. Without the low
    // orders the name join has no small streams to attach named OSM ways to.
    expect(Math.min(...orders)).toBe(1);
    expect(Math.max(...orders)).toBe(6);
  });

  it('carries the topology columns the ingest exists for', () => {
    for (const key of ['HYRIV_ID', 'NEXT_DOWN', 'MAIN_RIV', 'ORD_STRA', 'LENGTH_KM'] as const) {
      expect(Object.keys(fc.features[0].properties)).toContain(key);
    }
    // NEXT_DOWN must be a real distribution, not a column of zeroes.
    const terminal = fc.features.filter((f) => f.properties.NEXT_DOWN === 0);
    expect(terminal).toHaveLength(184);
  });

  it('keeps reaches whole, so HYRIV_ID stays one row per reach', () => {
    // gpd.clip would cut a reach at the provincial border, splitting one LineString
    // into several parts, invalidating LENGTH_KM and breaking the NEXT_DOWN links
    // that reference the reach as a whole.
    const types = new Set(fc.features.map((f) => f.geometry.type));
    expect([...types]).toEqual(['LineString']);
    const ids = new Set(fc.features.map((f) => f.properties.HYRIV_ID));
    expect(ids.size).toBe(fc.features.length);
  });

  it('leaves exactly the measured number of links dangling out of the region', () => {
    const ids = new Set(fc.features.map((f) => f.properties.HYRIV_ID));
    const dangling = fc.features.filter(
      (f) => f.properties.NEXT_DOWN !== 0 && !ids.has(f.properties.NEXT_DOWN)
    );
    // These flow out of the six provinces. Legitimately dangling, and Task 6's gate
    // must tolerate them rather than treat them as corruption.
    expect(dangling).toHaveLength(53);
  });

  it('rounds coordinates to 5 decimals', () => {
    // HydroRIVERS sits on a 15-arcsecond grid (~0.00417 deg), so 5 decimals is far
    // finer than the source. Full float text nearly doubles the committed file.
    const over = fc.features.flatMap((f) =>
      f.geometry.coordinates.filter(([x, y]) =>
        (String(x).split('.')[1]?.length ?? 0) > 5 || (String(y).split('.')[1]?.length ?? 0) > 5
      )
    );
    expect(over).toHaveLength(0);
  });

  it('keeps the prep script region codes in step with the shared constant', () => {
    // Python cannot import the TypeScript source of truth, so guard the duplication.
    const py = readFileSync(PREP, 'utf8');
    const block = /REGION_PROVINCE_CODES\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'prep_hydrosheds.py must define REGION_PROVINCE_CODES').not.toBeNull();
    const codes = [...block![1].matchAll(/"(\d+)"/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...REGION_PROVINCE_CODES].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/seeds/reachSeed.test.ts`

Expected: FAIL at module load — `ENOENT ... hydrorivers-region.geojson`. That is the correct RED for a data-contract suite: the artifact does not exist yet.

- [ ] **Step 3: Rewrite the rivers path in `prep_hydrosheds.py`**

Replace `RIVER_FIELDS`, delete `RIVER_MIN_ORD_STRA`, and replace `clip_rivers`:

```python
# NEXT_DOWN is the whole reason this ingest exists: it is HydroRIVERS' downstream
# adjacency, and the river network is nothing without it. MAIN_RIV is HydroRIVERS' own
# river-system (basin) id -- not loaded into the database by this plan, but kept in the
# file because regenerating it needs the 90 MB upstream shapefile again and a later
# basin-level entity would want it.
RIVER_FIELDS = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "LENGTH_KM"]

# Keep in step with REGION_PROVINCE_CODES in packages/shared/src/region.ts. Python
# cannot import the TypeScript source of truth, so reachSeed.test.ts guards the
# duplication. Same arrangement as scripts/clip-to-region.mjs.
REGION_PROVINCE_CODES = {"48", "51", "52", "56", "66", "68"}

# apps/api/scripts -> repo root is two levels up.
PROVINCES = Path(__file__).resolve().parents[2] / "apps/web/public/provinces-34.geojson"


def _region_polygon():
    """Union of the six working provinces, from the committed boundary file."""
    with open(PROVINCES, encoding="utf-8") as f:
        fc = json.load(f)
    geoms = [
        shape(ft["geometry"])
        for ft in fc["features"]
        if ft.get("properties", {}).get("code") in REGION_PROVINCE_CODES
    ]
    if len(geoms) != len(REGION_PROVINCE_CODES):
        raise SystemExit(
            f"expected {len(REGION_PROVINCE_CODES)} provinces in {PROVINCES}, found {len(geoms)}"
        )
    return unary_union(geoms)


def clip_rivers(src: str, dst: str) -> None:
    region = _region_polygon()
    # bbox is only a cheap prefilter on read; the region test below is what selects.
    # Note the six provinces include offshore islands, so this bbox reaches ~117.8E.
    gdf = gpd.read_file(src, bbox=region.bounds)
    gdf = gdf.to_crs(epsg=4326)
    # SELECT whole reaches, deliberately NOT gpd.clip. Clipping cuts a reach at the
    # border: one LineString becomes several parts, LENGTH_KM stops matching the
    # geometry, and HYRIV_ID stops being one row per reach -- which breaks NEXT_DOWN,
    # since every link references a reach as a whole. A reach flowing out of the
    # region simply keeps a NEXT_DOWN that is not in the file (53 of them, measured),
    # which is honest and which the activation gate tolerates.
    gdf = gdf[gdf.intersects(region)]
    # No ORD_STRA threshold. Region scoping already cuts the file to a committable
    # size (13,045 reaches, 3.25 MB), and dropping orders 1-2 would leave the small
    # streams most named OSM ways sit on with no reach to attach to.
    gdf = gdf[[c for c in RIVER_FIELDS if c in gdf.columns] + ["geometry"]]
    _write_geojson(gdf, dst, round_to=5)
```

Add the imports the new code needs, next to the existing ones:

```python
from pathlib import Path

from shapely.geometry import box, shape
from shapely.ops import unary_union
```

- [ ] **Step 4: Add opt-in rounding to `_write_geojson`**

Rounding is a parameter, not a behaviour change: `clip_lakes` shares this helper, and silently rewriting `hydrolakes-vn.geojson` is out of scope.

```python
def _write_geojson(gdf: "gpd.GeoDataFrame", dst: str, round_to: int | None = None) -> None:
    # Round-trip through geopandas' own GeoJSON writer, then re-serialize with compact
    # output so the committed file is diff-friendly and has no CRS member (GeoJSON is
    # implicitly WGS84 per RFC 7946), matching the other seed files in
    # apps/api/src/db/seeds/data/.
    raw = json.loads(gdf.to_json())
    features = raw["features"]
    if round_to is not None:
        def _round(coords):
            if coords and isinstance(coords[0], (int, float)):
                return [round(coords[0], round_to), round(coords[1], round_to)]
            return [_round(c) for c in coords]
        for ft in features:
            # geopandas emits a per-feature "id" that is just the dataframe index; it is
            # not a stable identifier and would churn the diff on every regeneration.
            ft.pop("id", None)
            ft["geometry"]["coordinates"] = _round(ft["geometry"]["coordinates"])
    fc = {"type": "FeatureCollection", "features": features}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {dst}: {len(fc['features'])} features")
```

- [ ] **Step 5: Regenerate the seed**

```bash
python apps/api/scripts/prep_hydrosheds.py rivers \
  "C:/Users/quock/AppData/Local/Temp/claude/c--Users-quock-Documents-Projects-webatlas/4b50c169-a355-41a6-b54f-3051ff782f5e/scratchpad/hydro/HydroRIVERS_v10_as_shp/HydroRIVERS_v10_as.shp" \
  apps/api/src/db/seeds/data/hydrorivers-region.geojson
```

Expected: `Wrote ...: 13045 features`, and the file is ~3.25 MB (`ls -la` to confirm; anything above 4 MB means the rounding did not apply).

- [ ] **Step 6: Run the test**

Run: `npm run test -w @webatlas/api -- src/db/seeds/reachSeed.test.ts`

Expected: 6/6 pass. A mismatch on 13,045 / 184 / 53 is a **signal, not a nuisance** — it means the selection differs from what was measured. Report the actual numbers and stop.

- [ ] **Step 7: Update `prep-hydrosheds.sh`**

Change the rivers invocation's output filename to `hydrorivers-region.geojson` and replace the stale note about raising `RIVER_MIN_ORD_STRA` (that constant no longer exists) with one sentence saying the rivers output is now selected against the six working provinces at every stream order, and that `prep_hydrosheds.py` reads `apps/web/public/provinces-34.geojson` to do it.

- [ ] **Step 8: Commit**

```bash
git add apps/api/scripts/prep_hydrosheds.py apps/api/scripts/prep-hydrosheds.sh \
        apps/api/src/db/seeds/data/hydrorivers-region.geojson \
        apps/api/src/db/seeds/reachSeed.test.ts
git commit -m "feat(api): prep HydroRIVERS giữ NEXT_DOWN và chọn theo vùng sáu tỉnh"
```

---

### Task 4: Reaches load as level-2 rows of the rivers ingest version

**Read this before writing any code.** Migration `1000000000004` carries the constraint
`(kind = 'ingest' AND parent_version_id IS NULL) OR (kind = 'edit' AND parent_version_id IS NOT NULL)`.
An ingest version therefore has **no parent**, so `rivers_active` resolves its chain to that version alone. A separate ingest version holding only reaches would make the 9,486 OSM ways **disappear from the map**. One ingest version is one complete snapshot of the layer, so the reaches load into the *same* version as the ways. The spec's "lands as a new ingest version" is satisfied — the version is new, it just contains both levels.

**Files:**
- Create: `apps/api/src/db/seeds/ingestReaches.ts`
- Create: `apps/api/src/db/ingestReaches.test.ts`
- Modify: `apps/api/src/db/seeds/ingestRivers.ts` (`HYDRORIVERS_SOURCE` ~line 15; the load body ~line 76)
- Modify: `apps/api/package.json` (nothing yet — the existing `ingest:rivers` script now does both)

**Interfaces:**
- Consumes: the committed seed from Task 3; `feature_level` from Task 2; the `osm:`/`hyriv:` prefixes from Task 1; `loadLayerFeatures` and the `SeedLayer` shape from `db/seeds/run.ts` and `db/seeds/registry.ts`.
- Produces: `REACHES_LAYER: SeedLayer` (exported), and an active rivers version holding **9,486 level-3 rows + 13,045 level-2 rows = 22,531** resolved rows. Level-2 rows carry `external_id = 'hyriv:<HYRIV_ID>'`, `flows_into_external_id = 'hyriv:<NEXT_DOWN>'` (NULL only when `NEXT_DOWN = 0`), `stream_order = ORD_STRA`, `name = NULL`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/ingestReaches.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

describe('HydroRIVERS reach ingest', () => {
  it('loads reaches and ways into ONE active version', async () => {
    const { rows } = await getPool().query<{ lvl: string; n: string; versions: string }>(
      `SELECT feature_level::text AS lvl, count(*)::text AS n,
              count(DISTINCT dataset_version_id)::text AS versions
         FROM water.rivers_active GROUP BY feature_level ORDER BY feature_level`
    );
    const byLevel = Object.fromEntries(rows.map((r) => [r.lvl, r]));
    expect(byLevel['2'].n).toBe('13045');
    expect(byLevel['3'].n).toBe('9486');
    // Both levels in the same version: an ingest version has no parent, so two
    // versions here would mean one level is invisible to rivers_active.
    expect(new Set(rows.map((r) => r.versions))).toEqual(new Set(['1']));
  });

  it('prefixes every reach id and never collides with an OSM way id', async () => {
    const { rows } = await getPool().query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM water.rivers_active
        WHERE (feature_level = 2 AND external_id !~ '^hyriv:[0-9]+$')
           OR (feature_level = 3 AND external_id !~ '^osm:[0-9]+$')`
    );
    expect(rows[0].bad).toBe('0');
  });

  it('carries NEXT_DOWN as flows_into, NULL only for a true terminal', async () => {
    const { rows } = await getPool().query<{ total: string; nulls: string; dangling: string }>(
      `WITH r AS (SELECT external_id, flows_into_external_id FROM water.rivers_active WHERE feature_level = 2)
       SELECT count(*)::text AS total,
              count(*) FILTER (WHERE flows_into_external_id IS NULL)::text AS nulls,
              count(*) FILTER (WHERE flows_into_external_id IS NOT NULL
                                 AND NOT EXISTS (SELECT 1 FROM r d
                                                  WHERE d.external_id = r.flows_into_external_id))::text AS dangling
         FROM r`
    );
    expect(rows[0].total).toBe('13045');
    // 184 terminal reaches (NEXT_DOWN = 0). Measured.
    expect(rows[0].nulls).toBe('184');
    // 53 reaches flow OUT of the six provinces. Their link is kept rather than nulled:
    // "water goes to a reach this dataset does not hold" is a different fact from
    // "this is the end of the network", and the gates must tell them apart.
    expect(rows[0].dangling).toBe('53');
  });

  it('gives level 2 the true Strahler order and leaves reaches unnamed', async () => {
    const { rows } = await getPool().query<{ lo: string; hi: string; named: string }>(
      `SELECT min(stream_order)::text AS lo, max(stream_order)::text AS hi,
              count(*) FILTER (WHERE name IS NOT NULL)::text AS named
         FROM water.rivers_active WHERE feature_level = 2`
    );
    expect(rows[0].lo).toBe('1');
    expect(rows[0].hi).toBe('6');
    // HydroRIVERS has no names. Any name here would be invented.
    expect(rows[0].named).toBe('0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/ingestReaches.test.ts`

Expected: FAIL — `byLevel['2']` is `undefined` (no level-2 rows exist).

- [ ] **Step 3: Write the reach layer**

Create `apps/api/src/db/seeds/ingestReaches.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type { SeedLayer } from './registry';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * HydroRIVERS reaches as LEVEL-2 rows of water.rivers.
 *
 * A reach row IS the network edge (spec §6): its geometry is the span and
 * flows_into_external_id is its single outgoing adjacency, so upstream and
 * downstream are WITH RECURSIVE walks over one column and there is no edge table.
 *
 * MAIN_RIV is present in the seed file but deliberately NOT loaded: no column in the
 * spec holds it, and overloading `code` (which carries the OSM waterway type at level 3)
 * would make a column's meaning depend on the row's level. It stays in the file because
 * regenerating the file needs the 90 MB upstream shapefile again, and a future
 * basin-level entity would want it.
 */
export const REACHES_LAYER: SeedLayer = {
  table: 'rivers',
  file: resolvePath(here, 'data/hydrorivers-region.geojson'),
  source: 'HydroRIVERS v10',
  multiLine: true,
  columns: (p) => ({
    external_id: `hyriv:${String(p.HYRIV_ID)}`,
    feature_level: 2,
    // HydroRIVERS writes 0 for a terminal reach -> NULL, meaning "end of the network".
    // A NEXT_DOWN that simply is not in this file (53 reaches leaving the region) keeps
    // its value: "the water goes somewhere we do not hold" is a different fact, and
    // collapsing both to NULL would hide it from the activation gates.
    flows_into_external_id: Number(p.NEXT_DOWN) === 0 ? null : `hyriv:${String(p.NEXT_DOWN)}`,
    // The TRUE Strahler order (ORD_STRA). Level 3 keeps the OSM waterway rank it has
    // always held -- the two are different measures and must not be compared.
    stream_order: p.ORD_STRA,
    length_m: Number(p.LENGTH_KM) * 1000,
    // HydroRIVERS has no names. Task 5 records the JOINED name on the link, never here.
    name: null,
  }),
};
```

- [ ] **Step 4: Load both files into the one version**

In `apps/api/src/db/seeds/ingestRivers.ts`, bump the source string — the existing comment above it already warns that leaving it unchanged reactivates the old version instead of loading new data, and that is exactly the failure mode here:

```ts
// Đổi chuỗi này mỗi khi nội dung file seed đổi: hàm ingest dưới đây idempotent
// THEO SOURCE, nên giữ nguyên chuỗi sẽ khiến nó kích hoạt lại version cũ thay vì
// nạp dữ liệu mới. Đổi lần này vì version giờ chứa CẢ đoạn sông HydroRIVERS (cấp 2),
// không chỉ đường OSM (cấp 3).
const HYDRORIVERS_SOURCE = 'OSM waterways + HydroRIVERS v10';
```

Then, in the block that loads features, load the reaches into the same version immediately after the ways, and sum both counts:

```ts
    const versionId = await svc.createIngestVersion(client, {
      layerKey: 'rivers',
      source: HYDRORIVERS_SOURCE,
    });
    // One ingest version is one COMPLETE snapshot of the layer: app.dataset_versions'
    // kind/parent constraint gives an ingest version no parent, so rivers_active
    // resolves its chain to this version alone. Loading the reaches into a separate
    // ingest version would make every OSM way vanish from the map.
    const ways = await loadLayerFeatures(client, RIVERS_HYDRO_LAYER, versionId);
    const reaches = await loadLayerFeatures(client, REACHES_LAYER, versionId);
    const count = ways + reaches;
```

Add the import: `import { REACHES_LAYER } from './ingestReaches';`

Leave the `feature_count` update, the `svc.activate` call and the `refreshRiverOverview` call exactly as they are. Update the function's doc comment to say it loads both levels.

- [ ] **Step 5: Run the ingest and the test**

```bash
npm run ingest:rivers -w @webatlas/api
npm run test -w @webatlas/api -- src/db/ingestReaches.test.ts
```

Expected: the script prints a version id and `22531 features`; 4/4 tests pass. If level-2 count is 0, the source string was not bumped — the ingest found the old version and reactivated it.

- [ ] **Step 6: Prove the shared-version requirement is load-bearing**

Temporarily give the reaches their own version (`createIngestVersion` a second time and load `REACHES_LAYER` into it, then `activate` it), re-run the ingest, and run the test.

Expected: the first test FAILS showing `byLevel['3']` undefined — the ways are gone, which is exactly the regression this step exists to make visible. Revert to the single-version form, re-run, confirm 4/4 green, and record the failure in the ledger.

- [ ] **Step 7: Confirm nothing downstream broke**

The layer tripled in size and now mixes levels. Run the suites that read it:

```bash
cd apps/api && npx tsc --noEmit && cd ../..
npm run test -w @webatlas/api
```

Expected: `tsc` 0. **Some failures here are expected and correct** — search now returns reach rows with NULL names, and analysis counts more rows. Record every failure; do **not** fix them here. Search is Task 8's job and the fix belongs there. If a failure is not explained by "the layer now contains reaches", investigate it now.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/seeds/ingestReaches.ts apps/api/src/db/seeds/ingestRivers.ts \
        apps/api/src/db/ingestReaches.test.ts
git commit -m "feat(api): nạp đoạn sông HydroRIVERS thành hàng cấp 2 của water.rivers"
```

---

### Task 5: Join reach to name, with a recorded confidence

HydroRIVERS has no names; 1,327 OSM ways do. This task gives each reach the name of the nearest named way, by majority vote over samples, and records how sure that vote was.

**The join direction is inverted from the spec, on purpose.** Spec §2 samples each *way* and finds its nearest *reach*. Measured: a named way spans 2.98 reaches on average (max 9 of 9 samples on distinct reaches), so only 414 of 1,327 ways hit exactly one reach — the question "which reach is this way on" is ill-posed. A reach is short, so "which named way is this reach under" is well-posed. Joining reach → way is the same evidence read the well-posed way round.

**Files:**
- Create: `apps/api/src/db/riverHierarchy.ts`
- Create: `apps/api/src/db/riverHierarchy.test.ts`

**Interfaces:**
- Consumes: a version holding level-2 and level-3 rows (Task 4).
- Produces, all exported from `db/riverHierarchy.ts`:
  - `MATCH_SAMPLES = 5`, `MATCH_MIN_VOTES = 3`, `MATCH_TOLERANCE_DEG = 0.01`, `MATCH_MAX_MEDIAN_M = 500`
  - `async function materialiseResolved(client: PoolClient, versionId: string): Promise<void>` — creates temp tables `res_rivers` (the version chain resolved to one row per `external_id`) and `res_named_ways` (level 3, `name IS NOT NULL`, GIST-indexed).
  - `async function assignReachNames(client: PoolClient, versionId: string): Promise<{ matched: number; names: number }>` — writes `parent_external_id` (temporarily the **name**, replaced by a river id in Task 6) and `match_confidence` onto level-2 rows of `versionId`.
  - Task 6 adds `buildRiverHierarchy(client, versionId)` which calls both.

`materialiseResolved` resolves the **given version's ancestor chain** rather than the active pointer, so its output is already correct for a draft version (chain = draft → parent → …). `assignReachNames`, by contrast, writes with `WHERE dataset_version_id = $1`, which is right for an ingest version (it holds every row) and **wrong for an edit draft** (which holds only the changed rows). Task 7 generalises that, and it is the reason Task 7 exists. Keep these signatures — Task 7 extends them, it does not replace them.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/riverHierarchy.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { MATCH_MIN_VOTES, MATCH_SAMPLES } from './riverHierarchy';

afterAll(async () => { await closePool(); });

describe('reach name join', () => {
  it('names the reaches the measured baseline says it should', async () => {
    const { rows } = await getPool().query<{ matched: string; names: string }>(
      `SELECT count(*)::text AS matched, count(DISTINCT parent_external_id)::text AS names
         FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id IS NOT NULL`
    );
    // Baseline pinned from the first real run (spec §2): 4,716 of 13,045 reaches,
    // carrying 439 of the 466 distinct OSM names. A LOWER number is a regression the
    // gate in Task 6 must refuse; a different number at all means the algorithm or the
    // data changed -- report it, do not edit these figures.
    expect(Number(rows[0].matched)).toBe(4716);
    expect(Number(rows[0].names)).toBe(439);
  });

  it('records a confidence for every match and none for a non-match', async () => {
    const { rows } = await getPool().query<{ bad: string; lo: string; hi: string }>(
      `SELECT count(*) FILTER (
                WHERE (parent_external_id IS NULL) <> (match_confidence IS NULL))::text AS bad,
              min(match_confidence)::text AS lo, max(match_confidence)::text AS hi
         FROM water.rivers_active WHERE feature_level = 2`
    );
    // A match without a confidence is a silent assertion; a confidence without a match
    // is meaningless. They travel together.
    expect(rows[0].bad).toBe('0');
    expect(Number(rows[0].lo)).toBeGreaterThanOrEqual(0.3);
    expect(Number(rows[0].hi)).toBeLessThanOrEqual(1);
  });

  it('assigns the real Sông Ba its measured reach count', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id = 'Sông Ba'`
    );
    // Measured: 131 reaches, ~352 km. The longest river in the working region, so it
    // exercises the vote over a long chain rather than a single reach.
    expect(rows[0].n).toBe('131');
  });

  it('leaves unmatched reaches visibly unmatched', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id IS NULL`
    );
    // 8,329 headwater reaches HydroRIVERS maps and OSM has not named. They stay
    // unnamed and walkable, never attached to a river the data does not claim.
    expect(rows[0].n).toBe('8329');
  });

  it('needs a real majority, not a plurality of one', () => {
    expect(MATCH_MIN_VOTES).toBeGreaterThan(MATCH_SAMPLES / 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/db/riverHierarchy.test.ts`

Expected: FAIL — the module does not exist, so the import throws.

- [ ] **Step 3: Write the materialisation**

Create `apps/api/src/db/riverHierarchy.ts`. The temp tables are not an optimisation, they are a correctness-of-runtime requirement: **the same join through `water.rivers_active` timed out past 120 s, and against a materialised copy took 10.9 s.** `rivers_active`'s recursive version resolution is an optimizer fence, the same one `modules/search/repository.ts` documents.

```ts
import type { PoolClient } from 'pg';

/** Sample points per reach, at 0.1, 0.3, 0.5, 0.7, 0.9 along its length. */
export const MATCH_SAMPLES = 5;
/** A strict majority of MATCH_SAMPLES. A plurality would let a 2-2-1 split decide. */
export const MATCH_MIN_VOTES = 3;
/** ST_DWithin prefilter, in degrees. ~1.1 km at this latitude. */
export const MATCH_TOLERANCE_DEG = 0.01;
/** Median sample-to-way distance above which a majority is still refused. */
export const MATCH_MAX_MEDIAN_M = 500;

/**
 * Resolve `versionId`'s chain into temp tables for the rest of the build.
 *
 * Why temp tables and not water.rivers_active: the view's WITH RECURSIVE + DISTINCT ON
 * pipeline is an optimizer fence, so no predicate reaches the index underneath it.
 * Measured 2026-09-22: the name join below timed out past 120s against the view and
 * took 10.9s against these tables. Same reasoning, same fix as search's repository.
 *
 * Resolution is keyed on the GIVEN version's ancestor chain, not on the active pointer,
 * so this works unchanged inside an ingest transaction (an ingest version has no parent,
 * so the chain is itself) and inside an edit-draft commit (draft -> parent -> ...).
 */
export async function materialiseResolved(client: PoolClient, versionId: string): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS res_rivers, res_named_ways`);
  await client.query(
    `CREATE TEMP TABLE res_rivers AS
     WITH RECURSIVE chain AS (
       SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = $1
       UNION ALL
       SELECT p.id, p.parent_version_id, c.depth + 1
         FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
     ),
     resolved AS (
       SELECT DISTINCT ON (t.external_id) t.*
         FROM water.rivers t JOIN chain c ON t.dataset_version_id = c.id
         ORDER BY t.external_id, c.depth
     )
     -- Every column Task 7's supersede step copies onto a new row, not just the ones the
     -- vote reads: a superseding row must carry the feature's full current state, and
     -- re-reading water.rivers for the rest would cross the optimizer fence again.
     SELECT external_id, feature_level, name, code, stream_order, length_m,
            parent_external_id, flows_into_external_id, match_confidence, geom
       FROM resolved WHERE NOT deleted`,
    [versionId]
  );
  await client.query(`CREATE INDEX ON res_rivers (external_id)`);
  await client.query(`CREATE INDEX ON res_rivers (feature_level)`);
  await client.query(`CREATE INDEX ON res_rivers USING GIST (geom)`);

  await client.query(
    `CREATE TEMP TABLE res_named_ways AS
       SELECT external_id, name, geom FROM res_rivers
        WHERE feature_level = 3 AND name IS NOT NULL AND geom IS NOT NULL`
  );
  await client.query(`CREATE INDEX ON res_named_ways USING GIST (geom)`);
  await client.query(`ANALYZE res_rivers`);
  await client.query(`ANALYZE res_named_ways`);
}
```

- [ ] **Step 4: Write the vote**

Append to `apps/api/src/db/riverHierarchy.ts`:

```ts
/**
 * Give each level-2 reach the name of the nearest named OSM way, by majority vote.
 *
 * parent_external_id temporarily holds the NAME. Task 6 replaces it with the id of the
 * level-1 river that name resolves to, once connectivity has split same-name groups.
 * The intermediate state never reaches an active version: the whole build runs inside
 * the ingest transaction, before activate().
 *
 * Confidence is the share of agreeing samples scaled by median distance (spec §2):
 *   (votes / MATCH_SAMPLES) * (1 - 0.5 * min(median, MAX) / MAX)
 * so an accepted match lands in [0.3, 1.0] -- a unanimous vote on top of the way scores
 * 1.0, a bare majority at the distance limit scores 0.3. Never 0, because a match that
 * was accepted is not no-confidence; a refused match stores NULL instead.
 */
export async function assignReachNames(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number }> {
  const { rows } = await client.query<{ matched: string; names: string }>(
    `WITH samples AS (
       SELECT r.external_id,
              ST_LineInterpolatePoint(ST_LineMerge(r.geom), (s.i * 2 - 1)::float / ($2 * 2)) AS pt
         FROM res_rivers r, generate_series(1, $2) AS s(i)
        WHERE r.feature_level = 2 AND r.geom IS NOT NULL
          AND ST_GeometryType(ST_LineMerge(r.geom)) = 'ST_LineString'
     ),
     nearest AS (
       SELECT s.external_id, w.name,
              ST_Distance(w.geom::geography, s.pt::geography) AS dist_m
         FROM samples s
         CROSS JOIN LATERAL (
           SELECT n.name, n.geom FROM res_named_ways n
            WHERE ST_DWithin(n.geom, s.pt, $3)
            ORDER BY n.geom <-> s.pt
            LIMIT 1
         ) w
     ),
     voted AS (
       SELECT external_id, name, count(*) AS votes,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dist_m) AS med_m
         FROM nearest GROUP BY external_id, name
     ),
     best AS (
       -- Ties break on the closer candidate, so the outcome does not depend on scan order.
       SELECT DISTINCT ON (external_id) external_id, name, votes, med_m
         FROM voted ORDER BY external_id, votes DESC, med_m ASC
     ),
     accepted AS (
       SELECT external_id, name,
              (votes::real / $2) * (1 - 0.5 * least(med_m, $4) / $4) AS confidence
         FROM best WHERE votes >= $5 AND med_m <= $4
     ),
     applied AS (
       UPDATE water.rivers t
          SET parent_external_id = a.name, match_confidence = a.confidence
         FROM accepted a
        WHERE t.dataset_version_id = $1 AND t.external_id = a.external_id
        RETURNING t.parent_external_id
     )
     SELECT count(*)::text AS matched, count(DISTINCT parent_external_id)::text AS names
       FROM applied`,
    [versionId, MATCH_SAMPLES, MATCH_TOLERANCE_DEG, MATCH_MAX_MEDIAN_M, MATCH_MIN_VOTES]
  );
  return { matched: Number(rows[0].matched), names: Number(rows[0].names) };
}
```

- [ ] **Step 5: Wire it into the ingest and run it**

In `ingestRivers.ts`, after both `loadLayerFeatures` calls and **before** `svc.activate`, call:

```ts
    await materialiseResolved(client, versionId);
    const named = await assignReachNames(client, versionId);
    console.log(`  named ${named.matched} reaches across ${named.names} rivers`);
```

Running the build inside the ingest transaction and before `activate()` is what makes the spec's "failure means the version is not activated" true by construction: a `ROLLBACK` erases the version entirely.

Then re-run the ingest. It is idempotent by source, so bump nothing — instead delete the version to force a fresh load:

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c \
  "DELETE FROM app.dataset_versions WHERE layer_key='rivers' AND source='OSM waterways + HydroRIVERS v10'"
npm run ingest:rivers -w @webatlas/api
npm run test -w @webatlas/api -- src/db/riverHierarchy.test.ts
```

Deleting the version cascades to its `water.rivers` rows (`onDelete: 'CASCADE'` on `dataset_version_id`), which is why this is safe. Expected: the ingest prints `named 4716 reaches across 439 rivers`; 5/5 tests pass.

- [ ] **Step 6: Prove the distance limit is load-bearing**

Raise `MATCH_MAX_MEDIAN_M` to `100000` and re-run the ingest and test.

Expected: the matched count rises well above 4,716 (measured: 5,813 reaches reach a majority with no distance limit) and the first test FAILS. Restore `500`, re-run, confirm 5/5. Record both counts.

- [ ] **Step 7: Typecheck and commit**

```bash
cd apps/api && npx tsc --noEmit && cd ../..
git add apps/api/src/db/riverHierarchy.ts apps/api/src/db/riverHierarchy.test.ts \
        apps/api/src/db/seeds/ingestRivers.ts
git commit -m "feat(api): gán tên cho đoạn sông theo bỏ phiếu, kèm độ tin cậy"
```

---

### Task 6: Level-1 rivers, their links, and the activation gates

One name plus one connected group is one river. This is where the headline defect dies: "thu" returns one Sông Thu Bồn, not two fragments.

**Files:**
- Modify: `apps/api/src/db/riverHierarchy.ts` (add the level-1 builder and `buildRiverHierarchy`)
- Create: `apps/api/src/db/riverGates.ts`
- Create: `apps/api/src/scripts/buildRiverHierarchy.ts`
- Modify: `apps/api/src/db/seeds/ingestRivers.ts` (call `buildRiverHierarchy` instead of `assignReachNames`)
- Modify: `apps/api/src/db/riverHierarchy.test.ts` (add the level-1 and gate cases)
- Modify: `apps/api/package.json` (add `"rivers:hierarchy": "tsx src/scripts/buildRiverHierarchy.ts"`)

**Interfaces:**
- Consumes: `materialiseResolved`, `assignReachNames` (Task 5).
- Produces:
  - `async function buildRiverHierarchy(client, versionId): Promise<{ matched: number; names: number; rivers: number }>` — the whole derived hierarchy for one version, gates included. **This is the single writer of level-1 rows.**
  - `async function assertRiverGates(client, versionId, baseline): Promise<void>` in `riverGates.ts`, throwing on the first violation.
  - `RIVER_BASELINE = { reaches: 4716, names: 439, rivers: 631 }` in `riverGates.ts` — the pinned first-real-run figures.
  - Level-1 rows: `external_id = 'river:<rootHyrivId>'`, `feature_level = 1`, `name`, geometry derived, `stream_order = max` over member reaches, `flows_into_external_id` to the downstream river.

**The river id is derived, not sequential.** Spec §1's example is `river:0012`. A sequence would renumber every river on each rebuild and break any saved ROI that referenced one. Each river's most-downstream same-name reach is unique to it — and carries its name, so no two rivers can share one — so `river:<rootHyrivId>` is unique and stable across rebuilds. Documented deviation.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/db/riverHierarchy.test.ts`:

```ts
describe('level-1 rivers', () => {
  it('emits one river per name plus connected group', async () => {
    const { rows } = await getPool().query<{ rivers: string; names: string }>(
      `SELECT count(*)::text AS rivers, count(DISTINCT name)::text AS names
         FROM water.rivers_active WHERE feature_level = 1`
    );
    // 631 rivers from 439 names. MORE rivers than names is CORRECT and must not be
    // "fixed": 109 names sit on more than one disconnected group. Sông Cái -- literally
    // "main river" -- is 15 genuinely different rivers, the same phenomenon as Phase 2's
    // 147 separate Thôn 3.
    expect(rows[0].rivers).toBe('631');
    expect(rows[0].names).toBe('439');
  });

  it('gives every river a stable derived id and a real name', async () => {
    const { rows } = await getPool().query<{ bad: string; nameless: string }>(
      `SELECT count(*) FILTER (WHERE external_id !~ '^river:[0-9]+$')::text AS bad,
              count(*) FILTER (WHERE name IS NULL)::text AS nameless
         FROM water.rivers_active WHERE feature_level = 1`
    );
    expect(rows[0].bad).toBe('0');
    // Per the 2026-09-22 decision: no nameless level-1 rows at all. An unnamed reach
    // stays a level-2 row rather than becoming an unselectable entity.
    expect(rows[0].nameless).toBe('0');
  });

  it('gives every river geometry and the max Strahler order of its reaches', async () => {
    const { rows } = await getPool().query<{ nogeom: string; mismatched: string }>(
      `WITH members AS (
         SELECT p.external_id, max(c.stream_order) AS max_order
           FROM water.rivers_active p
           JOIN water.rivers_active c ON c.parent_external_id = p.external_id AND c.feature_level = 2
          WHERE p.feature_level = 1 GROUP BY p.external_id)
       SELECT count(*) FILTER (WHERE p.geom IS NULL)::text AS nogeom,
              count(*) FILTER (WHERE p.stream_order <> m.max_order)::text AS mismatched
         FROM water.rivers_active p JOIN members m ON m.external_id = p.external_id
        WHERE p.feature_level = 1`
    );
    // geom is NOT NULL on water.rivers, so a river with no derivable geometry would
    // have failed the insert -- this asserts the fallback actually fires.
    expect(rows[0].nogeom).toBe('0');
    expect(rows[0].mismatched).toBe('0');
  });

  it('resolves Sông Thu Bồn to ONE searchable river', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 1 AND name = 'Sông Thu Bồn'`
    );
    // The defect in the spec's opening paragraph: searching "thu" returned two hits both
    // called Sông Thu Bồn, and picking one gave an arbitrary fragment.
    expect(rows[0].n).toBe('1');
  });

  it('points every reach at a river that exists', async () => {
    const { rows } = await getPool().query<{ orphan: string }>(
      `SELECT count(*)::text AS orphan FROM water.rivers_active c
        WHERE c.feature_level = 2 AND c.parent_external_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM water.rivers_active p
                           WHERE p.external_id = c.parent_external_id AND p.feature_level = 1)`
    );
    // Task 5 parks the NAME here; if Task 6 failed to replace it with a river id this is
    // 4,716 rather than 0.
    expect(rows[0].orphan).toBe('0');
  });
});

describe('activation gates', () => {
  it('finds no cycle and no Strahler decrease in the shipped network', async () => {
    const { rows } = await getPool().query<{ decreasing: string }>(
      `SELECT count(*)::text AS decreasing
         FROM water.rivers_active u
         JOIN water.rivers_active d ON d.external_id = u.flows_into_external_id
        WHERE u.feature_level = 2 AND d.feature_level = 2
          AND d.stream_order < u.stream_order`
    );
    // Verified against the raw shapefile before this plan was written: 0 violations and
    // 0 cycles in the 13,045-reach selection. A nonzero count means the ingest mangled
    // the links, not that HydroRIVERS is wrong.
    expect(rows[0].decreasing).toBe('0');
  });

  it('gives every river at least one reach', async () => {
    const { rows } = await getPool().query<{ childless: string }>(
      `SELECT count(*)::text AS childless FROM water.rivers_active p
        WHERE p.feature_level = 1
          AND NOT EXISTS (SELECT 1 FROM water.rivers_active c
                           WHERE c.parent_external_id = p.external_id AND c.feature_level = 2)`
    );
    expect(rows[0].childless).toBe('0');
  });

  it('refuses a version that regresses below the pinned match rate', async () => {
    const { assertRiverGates, RIVER_BASELINE } = await import('./riverGates');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
      );
      // Unname a third of the reaches inside a transaction that is rolled back.
      await client.query(
        `UPDATE water.rivers SET parent_external_id = NULL, match_confidence = NULL
          WHERE dataset_version_id = $1 AND feature_level = 2
            AND external_id IN (SELECT external_id FROM water.rivers
                                 WHERE dataset_version_id = $1 AND feature_level = 2
                                   AND parent_external_id IS NOT NULL LIMIT 1600)`,
        [rows[0].id]
      );
      await expect(assertRiverGates(client, rows[0].id, RIVER_BASELINE)).rejects.toThrow(/match rate/i);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @webatlas/api -- src/db/riverHierarchy.test.ts`

Expected: the five level-1 tests report `'0'` rivers (none exist); "points every reach at a river that exists" reports `4716` orphans, because Task 5 left names in that column; the gate test fails to import `./riverGates`.

- [ ] **Step 3: Write the level-1 builder**

Append to `apps/api/src/db/riverHierarchy.ts`:

```ts
/**
 * Build the level-1 rivers for `versionId`, and rewrite the level-2 link that
 * assignReachNames parked as a bare name into the id of the river it resolves to.
 *
 * A river is ONE NAME PLUS ONE CONNECTED GROUP, not one connected component. Spec §2
 * says one river per connected reach set, but a component is a BASIN: measured, the
 * largest one carries 134 distinct OSM names (Sê San, Srêpốk, Krông Ana, Đăk Bla and
 * ~120 named suối), so one-river-per-component would emit a single river and discard 133
 * names. Grouping by name and letting connectivity split disjoint same-name groups is
 * Phase 2's pattern, and it is why 439 names yield 631 rivers.
 *
 * The component root is found by walking DOWNSTREAM while the next reach carries the
 * same name. flows_into is a tree (one outgoing link per reach), so a maximal connected
 * same-name subgraph is a subtree with exactly one most-downstream member -- which makes
 * that member a canonical, stable component id with no union-find needed.
 */
async function buildLevelOne(client: PoolClient, versionId: string): Promise<number> {
  // Reach -> (name, root reach). Roots are computed over the version's own level-2 rows.
  await client.query(`DROP TABLE IF EXISTS reach_river`);
  await client.query(
    `CREATE TEMP TABLE reach_river AS
     WITH RECURSIVE named AS (
       SELECT external_id, parent_external_id AS name, flows_into_external_id AS nd
         FROM water.rivers
        WHERE dataset_version_id = $1 AND feature_level = 2 AND parent_external_id IS NOT NULL
     ),
     edges AS (
       SELECT n.external_id, n.name,
              d.external_id AS same_name_down
         FROM named n LEFT JOIN named d ON d.external_id = n.nd AND d.name = n.name
     ),
     walk AS (
       SELECT external_id AS start_id, name, external_id AS cur, same_name_down AS nxt, 0 AS d
         FROM edges
       UNION ALL
       SELECT w.start_id, w.name, e.external_id, e.same_name_down, w.d + 1
         FROM walk w JOIN edges e ON e.external_id = w.nxt
     )
     SELECT DISTINCT ON (start_id)
            start_id AS reach_external_id, name,
            'river:' || substring(cur from 7) AS river_external_id
       FROM walk WHERE nxt IS NULL
      ORDER BY start_id, d DESC`,
    [versionId]
  );
  await client.query(`CREATE INDEX ON reach_river (reach_external_id)`);
  await client.query(`CREATE INDEX ON reach_river (river_external_id)`);

  // Each named way joins the same-name river whose reaches lie nearest to it. A name with
  // several disjoint rivers (Sông Cái has 15) must not give all its ways to one of them.
  await client.query(`DROP TABLE IF EXISTS way_river`);
  await client.query(
    `CREATE TEMP TABLE way_river AS
     SELECT w.external_id AS way_external_id, best.river_external_id
       FROM res_named_ways w
       CROSS JOIN LATERAL (
         SELECT rr.river_external_id
           FROM reach_river rr JOIN res_rivers r ON r.external_id = rr.reach_external_id
          WHERE rr.name = w.name
          ORDER BY r.geom <-> w.geom
          LIMIT 1
       ) best`
  );
  await client.query(`CREATE INDEX ON way_river (river_external_id)`);

  // The level-1 rows. Geometry derives from the member OSM WAYS, not the member reaches:
  // measured, the two agree to a median length ratio of 1.11 (Sông Ba 349 km of way vs
  // 352 km of reach), so ways cost nothing in extent while giving finer geometry, the
  // same shape the detailed layer already draws, and independence from the spatial vote --
  // a bad match cannot deform a river. Reaches keep their real job: topology and order.
  // COALESCE to the reach geometry because water.rivers.geom is NOT NULL and a river with
  // no surviving member way would otherwise fail the insert.
  const { rows } = await client.query<{ n: string }>(
    `WITH ways AS (
       SELECT wr.river_external_id,
              ST_Collect(r.geom) AS geom
         FROM way_river wr JOIN res_rivers r ON r.external_id = wr.way_external_id
        GROUP BY wr.river_external_id
     ),
     reaches AS (
       SELECT rr.river_external_id, min(rr.name) AS name,
              max(r.stream_order) AS max_order, ST_Collect(r.geom) AS geom
         FROM reach_river rr JOIN res_rivers r ON r.external_id = rr.reach_external_id
        GROUP BY rr.river_external_id
     ),
     built AS (
       SELECT c.river_external_id, c.name, c.max_order,
              ST_Multi(ST_LineMerge(COALESCE(w.geom, c.geom))) AS geom
         FROM reaches c LEFT JOIN ways w ON w.river_external_id = c.river_external_id
     ),
     inserted AS (
       INSERT INTO water.rivers
         (external_id, feature_level, name, stream_order, length_m, geom, dataset_version_id)
       SELECT b.river_external_id, 1, b.name, b.max_order,
              ST_Length(b.geom::geography), b.geom, $1
         FROM built b
       RETURNING 1
     )
     SELECT count(*)::text AS n FROM inserted`,
    [versionId]
  );

  // Replace the parked NAME with the river id, on both levels.
  await client.query(
    `UPDATE water.rivers t SET parent_external_id = rr.river_external_id
       FROM reach_river rr
      WHERE t.dataset_version_id = $1 AND t.feature_level = 2
        AND t.external_id = rr.reach_external_id`,
    [versionId]
  );
  await client.query(
    `UPDATE water.rivers t SET parent_external_id = wr.river_external_id
       FROM way_river wr
      WHERE t.dataset_version_id = $1 AND t.feature_level = 3
        AND t.external_id = wr.way_external_id`,
    [versionId]
  );

  // River A flows into river B when A's outlet reach's NEXT_DOWN lands in B (spec §2).
  // The outlet reach IS the component root, which is encoded in the river's own id.
  await client.query(
    `UPDATE water.rivers t SET flows_into_external_id = down.river_external_id
       FROM (
         SELECT rr.river_external_id AS river,
                drr.river_external_id
           FROM reach_river rr
           JOIN water.rivers root ON root.dataset_version_id = $1
                                 AND root.feature_level = 2
                                 AND root.external_id = 'hyriv:' || substring(rr.river_external_id from 7)
           JOIN reach_river drr ON drr.reach_external_id = root.flows_into_external_id
          WHERE drr.river_external_id <> rr.river_external_id
       ) down
      WHERE t.dataset_version_id = $1 AND t.feature_level = 1
        AND t.external_id = down.river`,
    [versionId]
  );

  return Number(rows[0].n);
}

/**
 * The single writer of the derived river hierarchy. Runs inside the caller's
 * transaction, BEFORE the version is activated, so a failed gate rolls the version away
 * entirely -- which is what spec §2's "failure means the version is not activated" means.
 */
export async function buildRiverHierarchy(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number; rivers: number }> {
  await materialiseResolved(client, versionId);
  const named = await assignReachNames(client, versionId);
  const rivers = await buildLevelOne(client, versionId);
  return { ...named, rivers };
}
```

- [ ] **Step 4: Write the gates**

Create `apps/api/src/db/riverGates.ts`:

```ts
import type { PoolClient } from 'pg';

/**
 * The first real run's figures, pinned per spec §2 so a later re-ingest cannot silently
 * regress. Measured 2026-09-22 against HydroRIVERS v10 and the committed OSM waterways.
 * Raising these is a deliberate act; a build that falls below them does not activate.
 */
export const RIVER_BASELINE = { reaches: 4716, names: 439, rivers: 631 } as const;

export type RiverBaseline = typeof RIVER_BASELINE;

/**
 * Spec §2's activation gates, as assertions over ONE version's own rows. Called from
 * inside the ingest transaction before activate(), so throwing aborts the version.
 *
 * "No reach with two parents" is structural rather than checked: parent_external_id is a
 * single column, so a reach cannot hold two composition parents, and NEXT_DOWN gives one
 * outgoing flow link. A reach legitimately RECEIVES up to 4 (measured) -- that is a
 * confluence, not a defect, so nothing here counts incoming links.
 */
export async function assertRiverGates(
  client: PoolClient,
  versionId: string,
  baseline: RiverBaseline
): Promise<void> {
  const { rows } = await client.query<Record<string, string>>(
    `WITH v AS (SELECT * FROM water.rivers WHERE dataset_version_id = $1 AND NOT deleted)
     SELECT
       (SELECT count(*) FROM v WHERE feature_level = 2 AND parent_external_id IS NOT NULL)::text AS reaches,
       (SELECT count(DISTINCT name) FROM v WHERE feature_level = 1)::text AS names,
       (SELECT count(*) FROM v WHERE feature_level = 1)::text AS rivers,
       (SELECT count(*) FROM v u JOIN v d ON d.external_id = u.flows_into_external_id
         WHERE u.feature_level = 2 AND d.feature_level = 2
           AND d.stream_order < u.stream_order)::text AS decreasing,
       (SELECT count(*) FROM v p WHERE p.feature_level = 1
          AND NOT EXISTS (SELECT 1 FROM v c
                           WHERE c.parent_external_id = p.external_id AND c.feature_level = 2))::text AS childless,
       (SELECT count(*) FROM v c WHERE c.parent_external_id IS NOT NULL AND c.feature_level IN (2, 3)
          AND NOT EXISTS (SELECT 1 FROM v p
                           WHERE p.external_id = c.parent_external_id AND p.feature_level = 1))::text AS orphaned
      `,
    [versionId]
  );
  const r = rows[0];
  const fail = (msg: string): never => {
    throw new Error(`river hierarchy gate failed: ${msg}`);
  };

  if (Number(r.decreasing) > 0) {
    fail(`Strahler order decreases downstream on ${r.decreasing} reach pairs`);
  }
  if (Number(r.childless) > 0) {
    fail(`${r.childless} level-1 rivers have no reach`);
  }
  if (Number(r.orphaned) > 0) {
    fail(`${r.orphaned} rows point at a parent that is not a level-1 river`);
  }
  // Cycles: a walk bounded by the longest possible chain. A cycle makes the walk exceed
  // it, which is cheaper to detect than carrying a visited-array through the recursion.
  const cyc = await client.query<{ deepest: string }>(
    `WITH RECURSIVE v AS (
       SELECT external_id, flows_into_external_id FROM water.rivers
        WHERE dataset_version_id = $1 AND feature_level = 2 AND NOT deleted
     ),
     walk AS (
       SELECT external_id AS start_id, flows_into_external_id AS nxt, 1 AS depth FROM v
       UNION ALL
       SELECT w.start_id, n.flows_into_external_id, w.depth + 1
         FROM walk w JOIN v n ON n.external_id = w.nxt
        WHERE w.depth < 20000
     )
     SELECT coalesce(max(depth), 0)::text AS deepest FROM walk`,
    [versionId]
  );
  if (Number(cyc.rows[0].deepest) >= 20000) {
    fail('flows_into contains a cycle (walk exceeded 20000 hops)');
  }
  if (Number(r.reaches) < baseline.reaches) {
    fail(`match rate regressed: ${r.reaches} named reaches, baseline ${baseline.reaches}`);
  }
  if (Number(r.names) < baseline.names) {
    fail(`match rate regressed: ${r.names} distinct river names, baseline ${baseline.names}`);
  }
  if (Number(r.rivers) < baseline.rivers) {
    fail(`match rate regressed: ${r.rivers} level-1 rivers, baseline ${baseline.rivers}`);
  }
}
```

- [ ] **Step 5: Call the builder and the gates from the ingest**

In `ingestRivers.ts`, replace the Task 5 `assignReachNames` call with:

```ts
    const built = await buildRiverHierarchy(client, versionId);
    await assertRiverGates(client, versionId, RIVER_BASELINE);
    console.log(
      `  ${built.rivers} rivers from ${built.names} names over ${built.matched} named reaches`
    );
```

`feature_count` must be recomputed *after* the build, since level-1 rows are inserted by it. Change the count update to read the version's real row count:

```ts
    const { rows: fc } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1`,
      [versionId]
    );
    await client.query(`UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
      [Number(fc[0].n), versionId]);
```

- [ ] **Step 6: Write the CLI wrapper**

Create `apps/api/src/scripts/buildRiverHierarchy.ts`, mirroring `scripts/buildReference.ts`: load `dotenv/config`, get the pool, open a client, `BEGIN`, resolve the active rivers version id, call `buildRiverHierarchy` then `assertRiverGates`, print the counts, and — because level-1 rows already exist in that version — `ROLLBACK` with a message saying a rebuild means re-running `ingest:rivers`. The wrapper exists to **verify and report** on the live version without mutating it; the ingest is the only writer. State that in its doc comment so nobody "fixes" it into an in-place rebuild.

Add to `apps/api/package.json`: `"rivers:hierarchy": "tsx src/scripts/buildRiverHierarchy.ts"`.

- [ ] **Step 7: Rebuild and run the tests**

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c \
  "DELETE FROM app.dataset_versions WHERE layer_key='rivers' AND source='OSM waterways + HydroRIVERS v10'"
npm run ingest:rivers -w @webatlas/api
npm run test -w @webatlas/api -- src/db/riverHierarchy.test.ts
```

Expected: `631 rivers from 439 names over 4716 named reaches`; 13/13 tests pass (5 from Task 5 + 5 level-1 + 3 gates). `rivers_active` now holds 23,162 rows (9,486 ways + 13,045 reaches + 631 rivers).

- [ ] **Step 8: Prove the connectivity split is load-bearing**

In `buildLevelOne`, temporarily drop `AND d.name = n.name` from the `edges` join, so the walk follows the network regardless of name. Re-run the ingest.

Expected: the river count collapses far below 631 (names merge across a whole basin) and the gate **refuses to activate the version** with `match rate regressed: ... level-1 rivers, baseline 631`. This proves the gate and the split at once. Restore the clause, re-run, confirm 13/13 and a clean activation. Record the refused count.

- [ ] **Step 9: Typecheck and commit**

```bash
cd apps/api && npx tsc --noEmit && cd ../..
git add apps/api/src/db/riverHierarchy.ts apps/api/src/db/riverGates.ts \
        apps/api/src/scripts/buildRiverHierarchy.ts apps/api/src/db/riverHierarchy.test.ts \
        apps/api/src/db/seeds/ingestRivers.ts apps/api/package.json
git commit -m "feat(api): dựng sông cấp 1 theo tên và liên thông, kèm cổng kích hoạt"
```

---

### Task 7: The hierarchy is maintained at the one chokepoint

Spec §1: level-1 geometry is rebuilt "on commit of any edit session that touched a member row — the same commit-time hook that maintains §3's stamped codes". That hook is `versionsService.activate()`, and its own comment says why it lives there: *"That's exactly how rivers_overview went stale for two days — its refresh sat in a single call site a programmatic caller didn't traverse."* This task moves the build to that chokepoint and makes it correct for a draft version.

**Files:**
- Modify: `apps/api/src/db/riverHierarchy.ts` (split the vote from its application; reimplement `buildRiverHierarchy` as a diff)
- Modify: `apps/api/src/modules/versions/service.ts` (`activate`, ~line 52)
- Modify: `apps/api/src/db/seeds/ingestRivers.ts` (drop the now-duplicated explicit call)
- Create: `apps/api/src/modules/versions/riverHierarchy-hook.test.ts`

**Interfaces:**
- Consumes: `assertRiverGates`, `RIVER_BASELINE`, and Task 5/6's internals.
- Produces: **the same exported name and signature** `buildRiverHierarchy(client, versionId)`, reimplemented to be correct for any version and returning one extra field: `Promise<{ matched: number; names: number; rivers: number; superseded: number }>`. Task 6's tests and `scripts/buildRiverHierarchy.ts` keep working unchanged, which is this task's regression guard.

**Keep one exported writer, not two.** Do not add a second function beside `buildRiverHierarchy`. The global constraint is that level-1 rows have exactly one owner; two entry points that both write them is the same defect in a new shape. Replace the body, keep the name.

**Why a diff and not a wholesale rewrite.** An edit draft could simply re-insert all 13,045 reaches and 631 rivers, which is always correct and trivially simple. Do not: the version chain deepens by one per commit and `rivers_active`'s resolution walks it, so a hundred edit sessions would mean a hundred-deep chain over 1.37M rows. Superseding rows are written **only where a value actually changed** — for a one-way geometry edit that is typically a handful of reaches and one or two rivers.

**Ordering inside `activate()` is load-bearing.** The rebuild inserts brand-new level-1 rows, and those rows need `province_codes`/`ward_codes` like any other feature. `stampAdminCodes` stamps every row of the version in one `UPDATE`, so the rebuild must run **before** it — otherwise every river ships with empty code arrays and `features_in_admin_unit` silently misses all 631 of them. Task 9's doc must state this ordering too.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/versions/riverHierarchy-hook.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';

afterAll(async () => { await closePool(); });

/** The way carrying this name is long enough that moving it changes reach assignments. */
const SUBJECT = 'Sông Thu Bồn';

describe('activate() maintains the river hierarchy', () => {
  it('rebuilds level-1 geometry when an edit session moves a member way', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query<{ external_id: string; len: string }>(
        `SELECT external_id, ST_Length(geom::geography)::text AS len
           FROM water.rivers_active WHERE feature_level = 1 AND name = $1`,
        [SUBJECT]
      );
      expect(before.rows).toHaveLength(1);
      const riverId = before.rows[0].external_id;

      const draftId = await svc.openEditDraft(client, 'rivers', null);
      // Supersede one member way with a visibly different geometry: same external_id,
      // new row in the draft. This is how every edit works -- never an in-place update.
      await client.query(
        `INSERT INTO water.rivers
           (external_id, feature_level, name, code, stream_order, geom, dataset_version_id)
         SELECT w.external_id, 3, w.name, w.code, w.stream_order,
                ST_Multi(ST_Translate(ST_LineMerge(w.geom), 0.02, 0.02)), $2
           FROM water.rivers_active w
          WHERE w.feature_level = 3 AND w.parent_external_id = $1
          ORDER BY ST_Length(w.geom) DESC LIMIT 1`,
        [riverId, draftId]
      );
      await svc.commitEditDraft(client, 'rivers', draftId);

      const after = await client.query<{ len: string; version: string }>(
        `SELECT ST_Length(geom::geography)::text AS len, dataset_version_id::text AS version
           FROM water.rivers_active WHERE feature_level = 1 AND external_id = $1`,
        [riverId]
      );
      // The river's DERIVED geometry followed its member. Without the hook the level-1
      // row is still the parent version's, unchanged, and silently stale -- exactly the
      // rivers_overview failure the hook exists to prevent.
      expect(after.rows[0].version).toBe(draftId);
      expect(Number(after.rows[0].len)).not.toBeCloseTo(Number(before.rows[0].len), 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 120_000);

  it('writes superseding rows only where something changed', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draftId = await svc.openEditDraft(client, 'rivers', null);
      await svc.commitEditDraft(client, 'rivers', draftId);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1`,
        [draftId]
      );
      // An empty edit changes nothing, so the diff writes nothing. A wholesale rewrite
      // would put 13,676 rows here and deepen the chain on every no-op commit.
      expect(rows[0].n).toBe('0');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 120_000);

  it('does not run the river build for other layers', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draftId = await svc.openEditDraft(client, 'dams', null);
      // Must not throw: the hook is scoped to rivers, and water.dams has no
      // feature_level column at all.
      await expect(svc.commitEditDraft(client, 'dams', draftId)).resolves.toBeUndefined();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @webatlas/api -- src/modules/versions/riverHierarchy-hook.test.ts`

Expected: the first test FAILS on `after.rows[0].version` — it is the ingest version, not the draft, because nothing rebuilt the river. The second and third pass already (vacuously, since no hook runs); note that in the ledger so the mutation checks in Step 7 are the real proof for them.

- [ ] **Step 3: Split the vote from its application**

In `riverHierarchy.ts`, change `assignReachNames` so the vote lands in a temp table and the write is a separate step. The vote SQL is unchanged apart from its target; only the final `UPDATE ... applied` CTE moves out.

Take the SQL body from Task 5 Step 4 **verbatim** (the `samples`, `nearest`, `voted` and `best` CTEs are unchanged, including the `res_rivers` / `res_named_ways` sources they already read) and make exactly three changes: the statement becomes a `CREATE TEMP TABLE`, the trailing `applied` CTE with its `UPDATE` is deleted, and the parameter list loses `versionId` so the numbering shifts down by one.

```ts
/**
 * Run the vote and leave the result in temp table `new_reach_name(external_id, name,
 * confidence)` instead of writing it. Reads res_rivers/res_named_ways, so it sees the
 * RESOLVED picture and is correct for an ingest version and an edit draft alike.
 */
async function voteReachNames(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS new_reach_name`);
  await client.query(
    `CREATE TEMP TABLE new_reach_name AS
     WITH samples AS (
       SELECT r.external_id,
              ST_LineInterpolatePoint(ST_LineMerge(r.geom), (s.i * 2 - 1)::float / ($1 * 2)) AS pt
         FROM res_rivers r, generate_series(1, $1) AS s(i)
        WHERE r.feature_level = 2 AND r.geom IS NOT NULL
          AND ST_GeometryType(ST_LineMerge(r.geom)) = 'ST_LineString'
     ),
     nearest AS (
       SELECT s.external_id, w.name, ST_Distance(w.geom::geography, s.pt::geography) AS dist_m
         FROM samples s
         CROSS JOIN LATERAL (
           SELECT n.name, n.geom FROM res_named_ways n
            WHERE ST_DWithin(n.geom, s.pt, $2)
            ORDER BY n.geom <-> s.pt LIMIT 1
         ) w
     ),
     voted AS (
       SELECT external_id, name, count(*) AS votes,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dist_m) AS med_m
         FROM nearest GROUP BY external_id, name
     ),
     best AS (
       SELECT DISTINCT ON (external_id) external_id, name, votes, med_m
         FROM voted ORDER BY external_id, votes DESC, med_m ASC
     )
     SELECT external_id, name,
            (votes::real / $1) * (1 - 0.5 * least(med_m, $3) / $3) AS confidence
       FROM best WHERE votes >= $4 AND med_m <= $3`,
    [MATCH_SAMPLES, MATCH_TOLERANCE_DEG, MATCH_MAX_MEDIAN_M, MATCH_MIN_VOTES]
  );
  await client.query(`CREATE INDEX ON new_reach_name (external_id)`);
}
```

Keep the exported `assignReachNames(client, versionId)` as the ingest-path applier: call `voteReachNames`, then `UPDATE water.rivers t SET parent_external_id = n.name, match_confidence = n.confidence FROM new_reach_name n WHERE t.dataset_version_id = $1 AND t.external_id = n.external_id`, returning the same counts. Task 5's tests must stay green unchanged — that is the regression guard on this refactor.

Then extract the two temp-table halves of Task 6's `buildLevelOne` into `computeRiverGrouping(client)`, which fills `reach_river` and `way_river` exactly as Task 6 wrote them, with one change: the `named` CTE reads the resolved set rather than the version's own rows, because a draft holds no reaches.

```ts
/** reach_river + way_river from the resolved set. No writes to water.rivers. */
async function computeRiverGrouping(client: PoolClient): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS reach_river, way_river`);
  await client.query(
    `CREATE TEMP TABLE reach_river AS
     WITH RECURSIVE named AS (
       -- The only change from Task 6: the reach set and its names come from the resolved
       -- picture (res_rivers joined to this run's vote), not from one version's rows. An
       -- edit draft holds no reaches at all, so reading by version yields zero rivers and
       -- the gate then refuses a version that is in fact fine.
       SELECT r.external_id, n.name, r.flows_into_external_id AS nd
         FROM res_rivers r JOIN new_reach_name n ON n.external_id = r.external_id
        WHERE r.feature_level = 2
     ),
     edges AS (
       SELECT n.external_id, n.name, d.external_id AS same_name_down
         FROM named n LEFT JOIN named d ON d.external_id = n.nd AND d.name = n.name
     ),
     walk AS (
       SELECT external_id AS start_id, name, external_id AS cur, same_name_down AS nxt, 0 AS d
         FROM edges
       UNION ALL
       SELECT w.start_id, w.name, e.external_id, e.same_name_down, w.d + 1
         FROM walk w JOIN edges e ON e.external_id = w.nxt
     )
     SELECT DISTINCT ON (start_id)
            start_id AS reach_external_id, name,
            'river:' || substring(cur from 7) AS river_external_id
       FROM walk WHERE nxt IS NULL
      ORDER BY start_id, d DESC`
  );
  await client.query(`CREATE INDEX ON reach_river (reach_external_id)`);
  await client.query(`CREATE INDEX ON reach_river (river_external_id)`);
  // way_river is unchanged from Task 6 Step 3 -- it already reads res_named_ways and
  // reach_river, both of which are resolved. Each named way joins the same-name river
  // whose reaches lie nearest to it, so a name with several disjoint rivers (Sông Cái has
  // 15) does not give all its ways to one of them.
  await client.query(
    `CREATE TEMP TABLE way_river AS
     SELECT w.external_id AS way_external_id, best.river_external_id
       FROM res_named_ways w
       CROSS JOIN LATERAL (
         SELECT rr.river_external_id
           FROM reach_river rr JOIN res_rivers r ON r.external_id = rr.reach_external_id
          WHERE rr.name = w.name
          ORDER BY r.geom <-> w.geom
          LIMIT 1
       ) best`
  );
  await client.query(`CREATE INDEX ON way_river (river_external_id)`);
}
```

- [ ] **Step 4: Reimplement `buildRiverHierarchy` as a diff**

Replace the body written in Task 6. Same exported name, same signature, one extra return field:

```ts
/**
 * THE single writer of the derived river hierarchy, for ANY version.
 *
 * Correct on an ingest version (which holds every row) and on an edit draft (which holds
 * only the edited ones), because every read goes through the resolved temp tables and
 * every write is an INSERT of a superseding row into versionId -- the same mechanism an
 * ordinary edit uses. Nothing is ever updated in place in an ancestor version.
 *
 * Only DIFFERENCES are written. A wholesale rewrite would be simpler and always correct,
 * but it would add 13,676 rows and one chain level per commit, and rivers_active resolves
 * that chain on every read.
 */
export async function buildRiverHierarchy(
  client: PoolClient,
  versionId: string
): Promise<{ matched: number; names: number; rivers: number; superseded: number }> {
  await materialiseResolved(client, versionId);
  await voteReachNames(client);
  await computeRiverGrouping(client);
  await buildLevelOneGeometry(client);   // temp table new_river(external_id, name, max_order, geom)
  const superseded = await supersedeChangedRows(client, versionId);
  const { rows } = await client.query<{ matched: string; names: string; rivers: string }>(
    `SELECT (SELECT count(*) FROM reach_river)::text AS matched,
            (SELECT count(DISTINCT name) FROM reach_river)::text AS names,
            (SELECT count(*) FROM new_river)::text AS rivers`
  );
  return {
    matched: Number(rows[0].matched),
    names: Number(rows[0].names),
    rivers: Number(rows[0].rivers),
    superseded,
  };
}
```

`buildLevelOneGeometry` is Task 6's `built` CTE, landed in a temp table instead of inserted — the `ways`/`reaches`/`built` CTEs verbatim, ending in `CREATE TEMP TABLE new_river AS SELECT river_external_id AS external_id, name, max_order, geom FROM built`.

- [ ] **Step 5: Write the four supersede statements**

```ts
/** Insert a superseding row for each value that actually changed. Returns the row count. */
async function supersedeChangedRows(client: PoolClient, versionId: string): Promise<number> {
  const COLS = `external_id, feature_level, name, code, stream_order, length_m,
                parent_external_id, flows_into_external_id, match_confidence, geom,
                dataset_version_id`;
  let n = 0;

  // 1. Level-2 reaches whose river link or confidence moved. `IS DISTINCT FROM` and not
  //    `<>`, so a NULL on either side counts as a difference -- a reach that just lost its
  //    match must be superseded too, and `<>` would return NULL and skip it.
  const reaches = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT r.external_id, r.feature_level, r.name, r.code, r.stream_order, r.length_m,
            n.river_external_id, r.flows_into_external_id, nn.confidence, r.geom, $1
       FROM res_rivers r
       LEFT JOIN reach_river n ON n.reach_external_id = r.external_id
       LEFT JOIN new_reach_name nn ON nn.external_id = r.external_id
      WHERE r.feature_level = 2
        AND (r.parent_external_id IS DISTINCT FROM n.river_external_id
             OR r.match_confidence IS DISTINCT FROM nn.confidence)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET parent_external_id = EXCLUDED.parent_external_id,
            match_confidence   = EXCLUDED.match_confidence`,
    [versionId]
  );
  n += reaches.rowCount ?? 0;

  // 2. Level-3 ways whose river link moved. Geometry and attributes are copied from the
  //    resolved row, so a way edited in this very draft keeps the steward's new geometry.
  const ways = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT r.external_id, r.feature_level, r.name, r.code, r.stream_order, r.length_m,
            w.river_external_id, r.flows_into_external_id, r.match_confidence, r.geom, $1
       FROM res_rivers r LEFT JOIN way_river w ON w.way_external_id = r.external_id
      WHERE r.feature_level = 3
        AND r.parent_external_id IS DISTINCT FROM w.river_external_id
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET parent_external_id = EXCLUDED.parent_external_id`,
    [versionId]
  );
  n += ways.rowCount ?? 0;

  // 3. Level-1 rivers that are new, or whose name/order/geometry changed. ST_Equals and
  //    not `=`: the geometry operator `=` compares bounding boxes, so two genuinely
  //    different rivers sharing an envelope would compare equal and never be superseded.
  const rivers = await client.query(
    `INSERT INTO water.rivers (${COLS})
     SELECT b.external_id, 1, b.name, NULL, b.max_order,
            ST_Length(b.geom::geography), NULL, NULL, NULL, b.geom, $1
       FROM new_river b LEFT JOIN res_rivers r
            ON r.external_id = b.external_id AND r.feature_level = 1
      WHERE r.external_id IS NULL
         OR r.name IS DISTINCT FROM b.name
         OR r.stream_order IS DISTINCT FROM b.max_order
         OR NOT ST_Equals(r.geom, b.geom)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE
        SET name = EXCLUDED.name, stream_order = EXCLUDED.stream_order,
            length_m = EXCLUDED.length_m, geom = EXCLUDED.geom`,
    [versionId]
  );
  n += rivers.rowCount ?? 0;

  // 4. Tombstone a river whose last named reach is gone. Without this it keeps resolving
  //    from the ancestor version -- a river that no longer exists, still searchable.
  const gone = await client.query(
    `INSERT INTO water.rivers (${COLS}, deleted)
     SELECT r.external_id, 1, r.name, NULL, r.stream_order, r.length_m,
            NULL, NULL, NULL, r.geom, $1, true
       FROM res_rivers r
      WHERE r.feature_level = 1
        AND NOT EXISTS (SELECT 1 FROM new_river b WHERE b.external_id = r.external_id)
     ON CONFLICT (dataset_version_id, external_id) DO UPDATE SET deleted = true`,
    [versionId]
  );
  n += gone.rowCount ?? 0;

  return n;
}
```

`flows_into_external_id` for level-1 rivers is then set by the same statement Task 6 Step 3 ends with, run after these four — it reads `reach_river` and the version's own level-1 rows, both of which now exist.

- [ ] **Step 6: Move the call into `activate()`, ahead of the stamping**

In `apps/api/src/modules/versions/service.ts`, inside `activate`, **before** the existing `stampAdminCodes` block and before the `is_active` flip:

```ts
      // The river hierarchy is derived data with an owner, and this is that owner: the one
      // contract every path to "active" passes through -- ingest, edit commit and a
      // timeline rollback alike. Leaving it in the ingest script instead is precisely how
      // rivers_overview went stale for two days (see the comment below).
      //
      // BEFORE stampAdminCodes, not after: the rebuild INSERTS new level-1 rows, and
      // stampAdminCodes stamps every row of the version in one UPDATE. Reversed, all 631
      // rivers ship with empty province_codes and features_in_admin_unit misses every one.
      //
      // Gates run before the pointer moves, so a version that fails them is never
      // activated: the caller's transaction rolls back with the version still inactive.
      if (layerKey === 'rivers') {
        await buildRiverHierarchy(client, versionId);
        await assertRiverGates(client, versionId, RIVER_BASELINE);
      }
```

Then delete the explicit `buildRiverHierarchy` + `assertRiverGates` calls from `ingestRivers.ts`, and move its `feature_count` recount to **after** `activate` so it counts the rows the rebuild added.

Add a test for the ordering, in the hook suite:

```ts
  it('stamps the admin codes of the rivers it just created', async () => {
    const { rows } = await getPool().query<{ unstamped: string }>(
      `SELECT count(*)::text AS unstamped FROM water.rivers_active
        WHERE feature_level = 1 AND coalesce(array_length(province_codes, 1), 0) = 0`
    );
    // Level-1 rows are inserted by the rebuild, so they are only stamped if the rebuild
    // runs BEFORE stampAdminCodes. Swap the two and this is 631.
    expect(rows[0].unstamped).toBe('0');
  });
```

- [ ] **Step 7: Run the tests, then prove the hook is load-bearing**

```bash
npm run test -w @webatlas/api -- src/modules/versions/riverHierarchy-hook.test.ts
npm run test -w @webatlas/api -- src/db/riverHierarchy.test.ts
```

Expected: 4/4 and 13/13. Then comment out the `if (layerKey === 'rivers')` block and re-run: the first hook test must FAIL on the stale version id, and the geometry assertion must FAIL too. Restore it.

Then prove the diff: change `supersedeChangedRows` to drop its `WHERE <differs>` predicates, re-run the second test, and confirm it FAILS reporting 13,676 rather than 0. Restore. Record both numbers.

- [ ] **Step 8: Re-ingest from scratch and confirm the whole pipeline still lands**

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -c \
  "DELETE FROM app.dataset_versions WHERE layer_key='rivers' AND source='OSM waterways + HydroRIVERS v10'"
npm run ingest:rivers -w @webatlas/api
npm run rivers:hierarchy -w @webatlas/api
```

Expected: the ingest activates cleanly and `rivers:hierarchy` reports `631 rivers from 439 names over 4716 named reaches` — identical figures via the hook as via the explicit call in Task 6. A difference here means the resolved-set refactor changed the algorithm, which it must not.

- [ ] **Step 9: Typecheck and commit**

```bash
cd apps/api && npx tsc --noEmit && cd ../..
git add apps/api/src/db/riverHierarchy.ts apps/api/src/modules/versions/service.ts \
        apps/api/src/db/seeds/ingestRivers.ts \
        apps/api/src/modules/versions/riverHierarchy-hook.test.ts
git commit -m "feat(api): dựng lại phân cấp sông tại activate(), diff theo thay đổi"
```

---

### Task 8: Rendering, search and the editing rules

Three levels now live in one table, so every consumer has to say which level it means. Until this task lands the map draws each river twice and search returns reaches with no name — both regressions introduced by Task 4 and fixed here.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000020_rivers-level-views.cjs`
- Delete: `apps/api/src/db/riverOverview.ts` and `apps/api/src/db/riverOverview.test.ts`
- Modify: `apps/api/src/geoserver/publish.ts` (`TABLES`, `DERIVED_TABLES`, `nativeNameFor`, `publishAll`)
- Modify: `apps/api/src/modules/search/repository.ts` (`layerCtes`/`layerSelect` for rivers)
- Modify: `apps/api/src/modules/layers/repository.ts` (`insertIntoVersion`, `updateOnClient`, the delete path)
- Modify: `apps/api/src/db/seeds/ingestRivers.ts` (drop the `refreshRiverOverview` import and call)
- Modify: `apps/api/src/modules/search/search.test.ts`, `apps/api/src/geoserver/publish.test.ts`
- Create: `apps/api/src/db/riversLevelViews.test.ts`

**Interfaces:**
- Consumes: level-1 rows (Task 6).
- Produces:
  - `water.rivers_detail` — `rivers_active WHERE feature_level = 3`. What GeoServer's `rivers` featuretype points at, so today's map is unchanged.
  - `water.rivers_overview` — **now a plain view**, `SELECT COALESCE(name,'') AS name_key, name, stream_order, geom FROM water.rivers_active WHERE feature_level = 1`. Same name, same WFS typename, same column list as the materialised view it replaces, so `apps/web` needs no change.
  - Search returns rivers at level 1 only.

**Why `rivers_overview` keeps its name.** It is a plain view over live data, so the snapshot-staleness class of bug disappears with it: no `REFRESH`, no `refreshRiverOverview`, no obligation for a caller to remember. Keeping the name means `features/map/model/riverOverview.ts`, `MapModel.ts`'s `riverOverviewVisibleAt` LOD logic and `publish.ts`'s `DERIVED_TABLES` all keep working. The far-zoom layer also gets *better*: it was name-grouped simplified fragments filtered to `stream_order = 5`; it is now the actual river entities.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/riversLevelViews.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

describe('per-level river views', () => {
  it('rivers_detail is exactly the OSM ways', async () => {
    const { rows } = await getPool().query<{ n: string; lvls: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT feature_level)::text AS lvls
         FROM water.rivers_detail`
    );
    expect(rows[0].n).toBe('9486');
    expect(rows[0].lvls).toBe('1');
  });

  it('rivers_overview is a plain view over the level-1 entities', async () => {
    const kind = await getPool().query<{ relkind: string }>(
      `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'water' AND c.relname = 'rivers_overview'`
    );
    // 'v' = view, 'm' = materialised view. A matview is a snapshot that goes stale
    // silently; that is the bug class this replacement removes.
    expect(kind.rows[0].relkind).toBe('v');
    const { rows } = await getPool().query<{ n: string; nulls: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE name IS NULL)::text AS nulls
         FROM water.rivers_overview`
    );
    expect(rows[0].n).toBe('631');
    expect(rows[0].nulls).toBe('0');
  });

  it('keeps the column list the frontend already consumes', async () => {
    const { rows } = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers_overview' ORDER BY column_name`
    );
    // apps/web reads name_key/name/stream_order/geom off webatlas:rivers_overview. The
    // replacement is only safe because this list is unchanged.
    expect(rows.map((r) => r.column_name)).toEqual(['geom', 'name', 'name_key', 'stream_order']);
  });

  it('no longer carries a river overview refresher', async () => {
    await expect(import('./riverOverview')).rejects.toThrow();
  });
});
```

And add to `apps/api/src/modules/search/search.test.ts`:

```ts
  it('returns one hit per named river, not one per fragment', async () => {
    const res = await request(app).get('/api/search').query({ q: 'Thu Bồn', sources: 'rivers' });
    expect(res.status).toBe(200);
    const riverHits = res.body.results.filter((h: { layerKey: string }) => h.layerKey === 'rivers');
    // The defect this whole phase exists to kill: two hits both called Sông Thu Bồn.
    expect(riverHits).toHaveLength(1);
    expect(riverHits[0].name).toBe('Sông Thu Bồn');
  });

  it('never returns an unnamed reach', async () => {
    const res = await request(app).get('/api/search').query({ q: 'song', sources: 'rivers' });
    expect(res.status).toBe(200);
    for (const hit of res.body.results) expect(hit.name).toBeTruthy();
  });
```

- [ ] **Step 2: Run both to verify they fail**

```bash
npm run test -w @webatlas/api -- src/db/riversLevelViews.test.ts
npm run test -w @webatlas/api -- src/modules/search/search.test.ts
```

Expected: `rivers_detail` does not exist; `relkind` is `'m'`; the `riverOverview` import resolves instead of throwing; the search test returns more than one Thu Bồn hit.

- [ ] **Step 3: Write the views migration**

Create `apps/api/src/db/migrations/1000000000020_rivers-level-views.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // The materialised view goes, and with it refreshRiverOverview and the standing
  // obligation to remember it. Migration 1000000000009's own comment warns that
  // activating a version without refreshing leaves the far-zoom map serving old data
  // in silence; a plain view cannot have that bug.
  pgm.sql(`DROP MATERIALIZED VIEW IF EXISTS water.rivers_overview`);

  // Level 3 only: what the detailed map layer and the editor mean by "a river".
  pgm.sql(`
    CREATE VIEW water.rivers_detail AS
      SELECT * FROM water.rivers_active WHERE feature_level = 3
  `);

  // Same name, same columns, same WFS typename as the matview it replaces, so apps/web
  // needs no change -- but now the real level-1 entities rather than name-grouped,
  // simplified stream_order = 5 fragments. No ST_Simplify: 631 merged rivers are a far
  // smaller payload than the 1,723 fragments that made simplification necessary.
  pgm.sql(`
    CREATE VIEW water.rivers_overview AS
      SELECT COALESCE(name, '') AS name_key, name, stream_order, geom
        FROM water.rivers_active WHERE feature_level = 1
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_overview`);
  pgm.sql(`DROP VIEW IF EXISTS water.rivers_detail`);
  pgm.sql(`
    CREATE MATERIALIZED VIEW water.rivers_overview AS
      SELECT COALESCE(name, '') AS name_key, name, 5 AS stream_order,
             ST_LineMerge(ST_Collect(ST_SimplifyPreserveTopology(geom, 0.01))) AS geom
        FROM water.rivers_active
       WHERE stream_order = 5
       GROUP BY COALESCE(name, ''), name
  `);
  pgm.sql(`CREATE INDEX rivers_overview_geom_idx ON water.rivers_overview USING GIST (geom)`);
  pgm.sql(`CREATE UNIQUE INDEX rivers_overview_name_idx ON water.rivers_overview (name_key)`);
};
```

**Check the payload before trusting the "no simplification needed" comment.** After applying, measure it and keep the measurement in the ledger:

```bash
curl -s -u admin:change_me_dev "http://localhost:8080/geoserver/webatlas/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=webatlas:rivers_overview&outputFormat=application/json" | wc -c
```

Migration 9 recorded 104 kB for the simplified matview and 580 kB unsimplified. If the new view exceeds roughly 600 kB, add `ST_SimplifyPreserveTopology(geom, 0.01)` to the view and say so in the ledger.

- [ ] **Step 4: Delete the refresher and repoint GeoServer**

Delete `apps/api/src/db/riverOverview.ts` and `apps/api/src/db/riverOverview.test.ts`. Remove the import and the `await refreshRiverOverview(pool)` call from `ingestRivers.ts`, replacing the long comment there with one line saying `water.rivers_overview` is now a plain view and needs no refresh.

In `apps/api/src/geoserver/publish.ts`:

```ts
const TABLES = [
  'dams', 'rivers', 'lakes', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
  'rivers_overview',
];

/**
 * Các lớp DẪN XUẤT không có view `_active` đi kèm — bản thân chúng đã là quan hệ cuối
 * cùng. `rivers` cũng nằm ở đây: nó trỏ tới rivers_detail (chỉ cấp 3), vì water.rivers
 * giờ chứa cả ba cấp và rivers_active sẽ vẽ mỗi con sông hai lần.
 */
const DERIVED_TABLES = new Set(['rivers_overview']);
const EXPLICIT_NATIVE_NAME = new Map([['rivers', 'rivers_detail']]);

export function nativeNameFor(table: string): string {
  const explicit = EXPLICIT_NATIVE_NAME.get(table);
  if (explicit) return explicit;
  return DERIVED_TABLES.has(table) ? table : `${table}_active`;
}
```

`ensureLayer` already PUTs when the cached `nativeName` differs, so it repoints `rivers` by itself. At the end of `publishAll`, flush the attribute cache — the columns behind both `rivers` and `rivers_overview` have changed:

```ts
  // Repointing a featuretype does not invalidate GeoServer's cached attribute schema:
  // it still advertises the old columns and types until the catalog is reset.
  const reset = await gsRequest('POST', '/reset');
  if (!reset.ok) throw new Error(`catalog reset failed: ${reset.status} ${await reset.text()}`);
```

Update `publish.test.ts`'s `nativeNameFor` cases: `rivers` → `rivers_detail`, `rivers_overview` → `rivers_overview`, `dams` → `dams_active`.

- [ ] **Step 5: Search rivers at level 1**

In `apps/api/src/modules/search/repository.ts`, the rivers arm must filter on level. Both the candidate CTE and the final select need it — the candidate CTE is the one that matters for performance, since it is what the trigram index serves:

```ts
// Rivers carry three levels since the topology ingest. Search means the ENTITY: a
// level-1 row is one river, which is the whole point -- searching "thu" used to return
// two rows both called Sông Thu Bồn, each an arbitrary fragment. Reaches (level 2) have
// no name at all and would return nothing but noise.
const LEVEL_FILTER: Record<string, string> = { rivers: 'AND feature_level = 1' };
```

Apply it inside `candidates_${key}` (`WHERE name % $1 ${LEVEL_FILTER[key] ?? ''}`) and in `layerSelect`'s `WHERE`. Keep the optimizer-fence comment above `layerCtes` untouched.

- [ ] **Step 6: Enforce the editing rules**

In `apps/api/src/modules/layers/repository.ts`:

- `insertIntoVersion` — unchanged. `feature_level` defaults to 3, which is exactly what a steward drawing a new watercourse creates.
- `updateOnClient` — when `input.geometryJson !== undefined` and the target row's `feature_level <> 3`, throw `new ConflictError('Chỉ sửa được hình học ở cấp 3 (đường OSM); cấp 1 là hình dẫn xuất, cấp 2 do nhập liệu')`. Attribute-only updates stay allowed at every level, because `name` is editable at level 1 by design.
- the delete path — refuse while live children reference the row:
  ```sql
  SELECT 1 FROM water.rivers_active c
   WHERE c.parent_external_id = $1 AND NOT c.deleted LIMIT 1
  ```
  and on a hit throw `new ConflictError('Không xoá được: vẫn còn đối tượng con tham chiếu tới đối tượng này')`.

Guard all three on the rivers layer only (`def.key === 'rivers'`); no other layer has these columns.

Add focused tests to the existing feature-CRUD suite: a geometry edit on a level-1 river 409s, an attribute-only edit on the same row succeeds, a delete of a river with reaches 409s, and a geometry edit on a level-3 way still succeeds.

- [ ] **Step 7: Run everything**

```bash
npm run migrate:up -w @webatlas/api
npm run publish:geoserver -w @webatlas/api
cd apps/api && npx tsc --noEmit && cd ../..
npm run test -w @webatlas/api
npm run test -w @webatlas/web
npm run build:web
```

Expected: `tsc` 0; the API suite fully green (every failure recorded in Task 4 Step 7 should now be resolved — if one is not, it was not caused by the reach ingest and needs its own diagnosis); web suite 450 green **untouched**, which is the evidence that keeping `rivers_overview`'s name and columns was the right call; `build:web` exits 0 with only the pre-existing chunk-size warning.

- [ ] **Step 8: Look at the map**

Run the app and confirm with your eyes, because no test here proves a pixel:

- at far zoom the river network draws, and each river draws **once**;
- zooming in past the overview threshold swaps to the detailed layer with no double-drawn rivers;
- clicking a river selects one feature.

Use the `run` skill for the launch. Record what you saw.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/migrations/1000000000020_rivers-level-views.cjs \
        apps/api/src/db/riversLevelViews.test.ts apps/api/src/geoserver/publish.ts \
        apps/api/src/geoserver/publish.test.ts apps/api/src/modules/search/repository.ts \
        apps/api/src/modules/search/search.test.ts \
        apps/api/src/modules/layers/repository.ts apps/api/src/db/seeds/ingestRivers.ts
git rm apps/api/src/db/riverOverview.ts apps/api/src/db/riverOverview.test.ts
git commit -m "feat(api): view theo cấp, tìm kiếm ở cấp 1 và quy tắc biên tập"
```

---

### Task 9: Documentation

The architecture doc carries `(designed)` markers that this phase makes false, and three runbooks describe an ordering that no longer produces a correct database.

**Files:**
- Modify: `docs/architecture/database-architecture.md`
- Modify: `docs/runbooks/README.md`, `docs/runbooks/self-hosted-basemap.md`
- Modify: `README.md` (the `prep-hydrosheds.sh` step)
- Modify: `packages/atlas-data/src/descriptors/hydrorivers.ts` + `descriptors/index.ts` (Deviation 5)

- [ ] **Step 1: Register the escape hatch**

Create `packages/atlas-data/src/descriptors/hydrorivers.ts` declaring the ingest as a `run` stage, and add it to `DESCRIPTORS` in `descriptors/index.ts`:

```ts
import { defineDataset } from '../schema';

/**
 * HydroRIVERS reaches + the derived river hierarchy.
 *
 * Declared as a `run` escape hatch, not a `load-geojson` stage, because runner.ts
 * implements only the `sql` stage today — `load-geojson` is declared in types.ts and
 * owned by the dataset-registry track. assertNoOverdueEscapeHatches turns promoteBy into
 * a build failure, so this cannot quietly become permanent.
 */
export const hydrorivers = defineDataset({
  id: 'hydrorivers',
  kind: 'vector',
  editable: true,
  lineage: {
    statement:
      'Đoạn sông HydroRIVERS v10 chọn theo sáu tỉnh vùng công tác, nối tên từ đường thuỷ OSM, ' +
      'dựng thành phân cấp sông ba cấp.',
    licence: 'CC-BY-4.0',
    sources: [
      {
        citation: 'HydroSHEDS HydroRIVERS v1.0 (Asia)',
        licence: 'CC-BY-4.0',
        uri: 'https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip',
        resolution: '15 arc-seconds',
      },
      { citation: 'OpenStreetMap waterways', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' },
    ],
  },
  stages: [
    {
      type: 'run',
      command: 'npm run ingest:rivers -w @webatlas/api',
      produces: 'water.rivers (levels 1-3) + app.dataset_versions row',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
    },
  ],
});
```

Run `npm run test -w @webatlas/atlas-data` and confirm the registry and debt suites stay green; the lineage schema is validated by `schema.test.ts`, so a malformed descriptor fails there.

- [ ] **Step 2: Update the architecture doc**

Bump the revision number. Flip §1's and §2's `(designed)` markers to implemented and rewrite both to describe what shipped, not what was planned. Cover, with the measured figures from this plan:

- the three levels and their row counts (9,486 ways / 13,045 reaches / 631 rivers);
- the prefixed identity space, the four prefixes, and the view-dependency hazard that makes the type change a drop-and-recreate;
- **all five deviations**, each with its measurement — a reader comparing doc to spec will otherwise think the code is wrong;
- that `activate()` is the hierarchy's owner, alongside `stampAdminCodes`, and why (the `rivers_overview` scar);
- the activation gates and the pinned baseline, and that falling below it refuses activation;
- `river:<rootHyrivId>` being derived rather than sequential, and why (stable across rebuilds);
- the retirement of the `rivers_overview` matview and of `refreshRiverOverview`, which removes a whole class of staleness bug;
- that `rivers_active` still returns all three levels and that filtering is each consumer's job, naming `rivers_detail`, `rivers_overview` and the search filter as the three consumers.

Also update §8's ROI footnote (a named river is now a usable ROI target) and the §14 evolution ordering.

- [ ] **Step 3: Update the runbooks**

- `docs/runbooks/README.md`: the ordering table gains the rivers ingest in the right place — it must run **after** admin boundaries are seeded, because `activate()` stamps codes. Renumber, and note that `ingest:rivers` now also builds the hierarchy and runs the gates, so a failure there means the version was not activated and the previous one is still live.
- `docs/runbooks/self-hosted-basemap.md`: leave the reference-entity section alone; add a line that the rivers ingest is independent of the basemap loader, so the two orderings do not interact.
- `README.md`: the `prep-hydrosheds.sh` step now writes `hydrorivers-region.geojson`; state that `hydrorivers-vn.geojson` is a superseded artifact kept for history, has no `NEXT_DOWN`, and is loaded by nothing.

- [ ] **Step 4: Verify and commit**

Re-read every section after writing it, and check each number against this plan's measured table rather than from memory.

```bash
npm run test -w @webatlas/atlas-data
git add docs/ README.md packages/atlas-data/src/descriptors/
git commit -m "docs: phân cấp sông ba cấp và thứ tự dựng dữ liệu"
```

---

## Final Verification

Run before any merge, on a database rebuilt from nothing — the point is to prove a fresh clone works, which is the claim a runbook makes and nothing else checks.

```bash
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
npm run migrate:up -w @webatlas/api
npm run seed -w @webatlas/api
npm run ingest:rivers -w @webatlas/api
npm run publish:geoserver -w @webatlas/api
npm run test -w @webatlas/shared
npm run test -w @webatlas/atlas-data
npm run test -w @webatlas/api
npm run test -w @webatlas/web
npm run build:web
cd apps/api && npx tsc --noEmit
```

Expected: every command exits 0. Reference figures — `631 rivers from 439 names over 4716 named reaches`; `water.rivers_active` 23,162 rows; shared 101 tests; web 450 tests; API 417 at the start of this plan plus roughly 40 added here.

Migration round-trip, to prove the three new migrations are reversible:

```bash
npm run migrate:down -w @webatlas/api   # x3, back past 1000000000018
npm run migrate:up -w @webatlas/api
```

The `1000000000018` down migration **refuses** if any non-`osm:` `external_id` exists — which after a full ingest it will, because reaches and rivers are present. That is deliberate (losing a feature to keep a down-migration tidy is the worse trade), so run the round-trip on a database seeded but **not** river-ingested, and record that constraint in the ledger.

## What spec §10's verification list leaves to later phases

So a reviewer can tell deferred from missed. Of §10's six verification items, this plan covers four: the ingest gates (Task 6), the commit-time rebuild of level-1 geometry and stamped codes (Task 7), the per-level read paths (Task 8), and the migration round-trip (above). Two are **not** in this phase and must not be added to it:

- **"computed links update on commit" and "a steward-set link survives a recompute"** need `feature_links` (spec §7), which is Phase 5. `flows_into_external_id` is a column on the row, not a link-table entry, so nothing here has a `source='steward'` to preserve yet.
- **ROI contract tests per source kind, and `upstream_of` inside the 5-second budget**, are Phase 4 and Phase 5. The data supports the walk — `assertRiverGates` runs a bounded recursive walk over all 13,045 reaches inside the ingest transaction — but the tool and its budget belong with the tool.

## Definition of Done

- Searching "thu" returns **one** Sông Thu Bồn.
- A named river is one row, with geometry covering the whole river.
- `upstream_of` / `downstream_of` are answerable from `flows_into_external_id` by `WITH RECURSIVE` — the walk itself is Phase 5, but the data supports it, proven by the gate queries.
- The far-zoom map draws each river once, and nothing refreshes a snapshot to keep it true.
- A steward cannot edit derived geometry, and cannot delete a parent out from under its children.
- A re-ingest that matches fewer rivers than the pinned baseline does not activate.
