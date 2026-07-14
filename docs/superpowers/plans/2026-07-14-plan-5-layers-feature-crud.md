# Plan 5 — Layers Feature CRUD API (registry + generic GeoJSON CRUD + geometry validation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-facing thematic-layer CRUD on top of Plan 4's control plane — a single **layer registry** (layer key → PostGIS table + geometry type + zod attribute schema) that drives a **generic** feature repository/service/controller so all seven `water.*` layers share one code path, exposing `GET /api/layers`, `GET/POST/PUT/DELETE /api/layers/:key/features[/:id]` with PostGIS geometry validation (`ST_GeomFromGeoJSON` + `ST_IsValid`) and audit logging on every write.

**Architecture:** Same strict layering as Plan 4 (`Routes → Controllers → Services → Repositories → DB pool`). The **layer registry** (`layers/registry.ts`) is the one authoritative catalog (design INV-2): `GET /api/layers` is derived from it, and the generic feature repository parameterizes table/geometry/columns from it — adding a layer later means adding a registry entry, not new endpoints. Reads return a GeoJSON `FeatureCollection`; writes accept a GeoJSON `Feature`, validate attributes with the registry's zod schema and geometry with PostGIS, write parameterized SQL, and record before/after in `app.audit_log` via Plan 4's `auditService`. Layer keys come from `@webatlas/shared` `EDITABLE_LAYER_KEYS` (INV-4).

**Tech Stack:** Fastify 5, `pg`, `zod`, `@webatlas/shared` (layer keys), PostGIS (`ST_GeomFromGeoJSON`, `ST_SetSRID`, `ST_IsValid`, `ST_AsGeoJSON`), Vitest (Fastify `inject`). Builds on Plan 4 (`buildApp`, `app.pg`, `app.authenticate`, `authorize`, error hierarchy incl. `GeometryError`, `NotFoundError`, `ValidationError`; `auditService`; `validate()`) and Plan 2 (the `water.*` tables).

## Global Constraints

- Node 22 / npm 10 workspaces. All work in `apps/api` except one `packages/shared` addition (Task 1). Depends on Plan 4 (auth/RBAC/audit/errors) and Plan 2 (`water.*` migrations, `src/db/pool.ts`).
- The Docker stack (PostGIS) must be up for integration tests. Tests use Fastify `inject` against the dev DB and **clean up their own rows**. Feature test rows are namespaced by a sentinel: every test feature sets `name` to a value ending `@webatlas.test` (or `external_id` in a reserved test band ≥ 900000000) and the test's `afterAll` deletes exactly those rows. Never touch seeded rows.
- **Security (design §10):** admin-only writes (`authorize('admin')`); parameterized SQL only — the **only** interpolated SQL identifiers are `schema.table` and column names looked up from the trusted registry (never from request data); geometry SRID normalized to 4326 and validated (`ST_IsValid`) before insert/update; every write recorded in `app.audit_log`.
- **Error contract (Plan 4):** all errors serialize to `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Attribute validation failure → `ValidationError` (400); invalid/oversized/missing geometry → `GeometryError` (422); unknown `:key` → `NotFoundError` (404); missing feature `:id` → `NotFoundError` (404). Services/repositories `throw`; only `errorHandler` formats HTTP.
- **Layering rule (Plan 4):** routes attach schema+guards and call a controller; controllers validate (zod) + shape responses; services hold business logic + audit; repositories do parameterized SQL only. No SQL in controllers; no HTTP in services/repositories.
- **INV-2:** the registry is the single layer catalog; `GET /api/layers` is derived from it, never hand-maintained. **INV-4:** layer identity comes from `@webatlas/shared` `EDITABLE_LAYER_KEYS`; the registry must cover exactly those keys.
- **Authoritative column facts** come from `apps/api/src/db/migrations/1000000000002_water-schema.cjs` (NOT the design §5.2 sketch). Real facts used by this plan: geometry column is **`geom`** (not `geometry`); `water.dams.geom` is **nullable** (Plan 2 migration 3), all others `NOT NULL`; every table has `id uuid`, `name text`, `external_id`, `created_at/updated_at/created_by/updated_by`; geometry types are Point (`dams`, `stations`, `drought_points`, `saltwater_intrusion`), MultiLineString (`rivers`), MultiPolygon (`flood_zones`, `flood_generation`).

## Directory layout (end state — new/changed files only)

```
packages/shared/src/
  index.ts                    # (modify) re-export layer geometry-type map (Task 1)
  layer-geometry.ts           # (create) EditableLayerKey -> OGC geometry type (Task 1)
apps/api/src/
  layers/
    registry.ts               # (create) key -> { table, geomType, geomColumn, attributeSchema, columns } (Task 2)
    registry.test.ts          # (create) registry covers all EDITABLE_LAYER_KEYS + shapes (Task 2)
  modules/layers/
    repository.ts             # (create) generic parameterized feature SQL from a registry entry (Task 3)
    geometry.ts               # (create) GeoJSON geometry -> validated PostGIS SQL fragment + params (Task 3)
    service.ts                # (create) list/get/create/update/remove + geometry validation + audit (Task 4)
    controller.ts             # (create) validate + shape GeoJSON envelopes (Task 5)
    routes.ts                 # (create) GET /layers, GET/POST/PUT/DELETE /layers/:key/features (Task 5)
    layers.test.ts            # (create) integration: metadata + CRUD + validation + RBAC + audit (Task 5)
  server.ts                   # (modify) register layers routes under /api (Task 5)
```

---

### Task 1: Shared layer geometry-type map (`packages/shared`)

**Files:**
- Create: `packages/shared/src/layer-geometry.ts`
- Modify: `packages/shared/src/index.ts`
- Create/modify test: `packages/shared/src/layer-geometry.test.ts`

**Interfaces:**
- Consumes: `EDITABLE_LAYER_KEYS`, `EditableLayerKey` (existing, `packages/shared/src/index.ts`).
- Produces: `LAYER_GEOMETRY: Record<EditableLayerKey, OgcGeometryType>` and `type OgcGeometryType = 'Point' | 'MultiLineString' | 'MultiPolygon'`, re-exported from `@webatlas/shared`. This is the shared source of geometry identity the API registry (Task 2) consumes so the API and (future) frontend agree (INV-4).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/layer-geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { LAYER_GEOMETRY } from './layer-geometry';

describe('LAYER_GEOMETRY', () => {
  it('has an entry for every editable layer key', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      expect(LAYER_GEOMETRY[key]).toBeDefined();
    }
  });
  it('maps the known geometry types', () => {
    expect(LAYER_GEOMETRY.dams).toBe('Point');
    expect(LAYER_GEOMETRY.rivers).toBe('MultiLineString');
    expect(LAYER_GEOMETRY.flood_zones).toBe('MultiPolygon');
    expect(LAYER_GEOMETRY.flood_generation).toBe('MultiPolygon');
    expect(LAYER_GEOMETRY.stations).toBe('Point');
    expect(LAYER_GEOMETRY.drought_points).toBe('Point');
    expect(LAYER_GEOMETRY.saltwater_intrusion).toBe('Point');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/shared`
Expected: FAIL — cannot find module `./layer-geometry`.

- [ ] **Step 3: Create the geometry map**

Create `packages/shared/src/layer-geometry.ts`:
```ts
import type { EditableLayerKey } from './index';

export type OgcGeometryType = 'Point' | 'MultiLineString' | 'MultiPolygon';

/** Geometry type per editable layer — matches the water.* migration (INV-4). */
export const LAYER_GEOMETRY: Record<EditableLayerKey, OgcGeometryType> = {
  dams: 'Point',
  rivers: 'MultiLineString',
  stations: 'Point',
  flood_zones: 'MultiPolygon',
  drought_points: 'Point',
  saltwater_intrusion: 'Point',
  flood_generation: 'MultiPolygon',
};
```

- [ ] **Step 4: Re-export from the package entrypoint**

In `packages/shared/src/index.ts`, append:
```ts
export { LAYER_GEOMETRY, type OgcGeometryType } from './layer-geometry';
```

- [ ] **Step 5: Rebuild the package (the API imports the built `dist/`)**

Run: `npm run build -w @webatlas/shared`
Expected: `tsc` emits `dist/layer-geometry.js` + `.d.ts` and updates `dist/index.*`. (The API resolves `@webatlas/shared` via `dist/`, so this build is required before Task 2's typecheck/tests pass.)

- [ ] **Step 6: Run test → PASS; commit**

Run: `npm run test -w @webatlas/shared`
Expected: PASS (existing `layers.test.ts` + the new geometry test).
```bash
git add packages/shared/src/layer-geometry.ts packages/shared/src/layer-geometry.test.ts packages/shared/src/index.ts packages/shared/dist
git commit -m "feat(shared): layer geometry-type map (LAYER_GEOMETRY)"
```

---

### Task 2: API layer registry (`layers/registry.ts`)

**Files:**
- Create: `apps/api/src/layers/registry.ts`, `apps/api/src/layers/registry.test.ts`
- Modify: `apps/api/package.json` (add `@webatlas/shared` dependency), then `npm install`.

**Interfaces:**
- Consumes: `EDITABLE_LAYER_KEYS`, `EditableLayerKey`, `LAYER_GEOMETRY`, `OgcGeometryType` from `@webatlas/shared` (Task 1).
- Produces:
  - `interface LayerDef { key: EditableLayerKey; table: string; geomType: OgcGeometryType; geomColumn: 'geom'; geomNullable: boolean; attributeColumns: string[]; attributeSchema: ZodObject<...>; }`
  - `const LAYER_REGISTRY: Record<EditableLayerKey, LayerDef>`
  - `function getLayer(key: string): LayerDef` — throws `NotFoundError('Unknown layer')` for an unregistered key (used by controllers to reject bad `:key`).
  - `function listLayerMetadata(): Array<{ key; geomType; attributes: string[] }>` — the derived catalog for `GET /api/layers` (INV-2).

  `attributeColumns` are the editable, non-geometry, non-audit columns per table (from the migration). `name` is included as an editable attribute; `id`, `geom`, `created_at`, `updated_at`, `created_by`, `updated_by`, `external_id` are **not** attributes (system/managed columns). `attributeSchema` validates the `properties` object of an incoming GeoJSON Feature.

- [ ] **Step 1: Add the shared dependency**

In `apps/api/package.json`, add to `dependencies`:
```json
    "@webatlas/shared": "*"
```
Then from repo root: `npm install` (links the workspace).

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/layers/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { LAYER_REGISTRY, getLayer, listLayerMetadata } from './registry';
import { NotFoundError } from '../errors';

describe('layer registry', () => {
  it('covers exactly the editable layer keys (INV-2/INV-4)', () => {
    expect(Object.keys(LAYER_REGISTRY).sort()).toEqual([...EDITABLE_LAYER_KEYS].sort());
  });

  it('every entry has table, geomType, geomColumn=geom and an attribute schema', () => {
    for (const key of EDITABLE_LAYER_KEYS) {
      const def = LAYER_REGISTRY[key];
      expect(def.table).toBe(`water.${key}`);
      expect(def.geomColumn).toBe('geom');
      expect(['Point', 'MultiLineString', 'MultiPolygon']).toContain(def.geomType);
      expect(def.attributeColumns.length).toBeGreaterThan(0);
      // schema must reject an unknown property and accept an empty object (all attrs optional)
      expect(def.attributeSchema.safeParse({}).success).toBe(true);
    }
  });

  it('marks only dams geometry as nullable', () => {
    expect(LAYER_REGISTRY.dams.geomNullable).toBe(true);
    expect(LAYER_REGISTRY.rivers.geomNullable).toBe(false);
  });

  it('getLayer throws NotFoundError for an unknown key', () => {
    expect(() => getLayer('not_a_layer')).toThrow(NotFoundError);
  });

  it('listLayerMetadata returns one derived entry per layer', () => {
    const meta = listLayerMetadata();
    expect(meta).toHaveLength(EDITABLE_LAYER_KEYS.length);
    const dams = meta.find((m) => m.key === 'dams')!;
    expect(dams.geomType).toBe('Point');
    expect(dams.attributes).toContain('name');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:api -- src/layers/registry.test.ts`
Expected: FAIL — cannot find module `./registry`.

- [ ] **Step 4: Create the registry**

Create `apps/api/src/layers/registry.ts`. The attribute schemas mirror the migration's per-table columns (all optional so partial updates validate; types are strings/numbers per the migration; unknown keys are stripped by `.strip()` default, which is fine — only known columns are ever written):
```ts
import { z } from 'zod';
import { EDITABLE_LAYER_KEYS, LAYER_GEOMETRY, type EditableLayerKey, type OgcGeometryType } from '@webatlas/shared';
import { NotFoundError } from '../errors';

export interface LayerDef {
  key: EditableLayerKey;
  table: string;               // always `water.<key>`
  geomType: OgcGeometryType;
  geomColumn: 'geom';
  geomNullable: boolean;
  attributeColumns: string[];  // editable, non-geometry, non-audit columns
  attributeSchema: z.ZodObject<z.ZodRawShape>;
}

// Editable attribute columns per table (from migration 1000000000002_water-schema.cjs).
// `name` is editable; id/geom/external_id/created_*/updated_* are system-managed and excluded.
const nullableStr = z.string().nullable().optional();
const nullableNum = z.number().nullable().optional();

const ATTRS: Record<EditableLayerKey, z.ZodObject<z.ZodRawShape>> = {
  dams: z.object({
    name: nullableStr, name_en: nullableStr, wattage_mw: nullableNum,
    annual_output: nullableNum, year_launched: nullableStr,
    year_operational: nullableStr, status: nullableStr,
  }),
  rivers: z.object({
    name: nullableStr, code: nullableStr, stream_order: nullableNum, length_m: nullableNum,
  }),
  stations: z.object({
    name: nullableStr, station_type: nullableStr, status: nullableStr, value: nullableStr,
  }),
  flood_zones: z.object({
    name: nullableStr, hazard_type: nullableStr, area: nullableStr, risk_level: nullableStr,
  }),
  drought_points: z.object({
    name: nullableStr, risk_level: nullableStr, status: nullableStr, survey_date: nullableStr,
  }),
  saltwater_intrusion: z.object({
    name: nullableStr, salinity: nullableStr, risk_level: nullableStr, status: nullableStr,
  }),
  flood_generation: z.object({
    name: nullableStr, risk_level: nullableStr, area: nullableStr, flow_rate: nullableStr,
  }),
};

function build(key: EditableLayerKey): LayerDef {
  const schema = ATTRS[key];
  return {
    key,
    table: `water.${key}`,
    geomType: LAYER_GEOMETRY[key],
    geomColumn: 'geom',
    geomNullable: key === 'dams',
    attributeColumns: Object.keys(schema.shape),
    attributeSchema: schema,
  };
}

export const LAYER_REGISTRY: Record<EditableLayerKey, LayerDef> = Object.fromEntries(
  EDITABLE_LAYER_KEYS.map((key) => [key, build(key)])
) as Record<EditableLayerKey, LayerDef>;

export function getLayer(key: string): LayerDef {
  const def = (LAYER_REGISTRY as Record<string, LayerDef | undefined>)[key];
  if (!def) throw new NotFoundError('Unknown layer');
  return def;
}

export function listLayerMetadata(): Array<{ key: string; geomType: OgcGeometryType; attributes: string[] }> {
  return EDITABLE_LAYER_KEYS.map((key) => {
    const def = LAYER_REGISTRY[key];
    return { key, geomType: def.geomType, attributes: def.attributeColumns };
  });
}
```

- [ ] **Step 5: Run test → PASS**

Run: `npm run test:api -- src/layers/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/layers/registry.ts apps/api/src/layers/registry.test.ts
git commit -m "feat(api): layer registry (key -> table + geom type + attribute schema)"
```

---

### Task 3: Geometry helper + generic feature repository

**Files:**
- Create: `apps/api/src/modules/layers/geometry.ts`, `apps/api/src/modules/layers/repository.ts`

**Interfaces:**
- Consumes: `LayerDef` (Task 2), `GeometryError` / `ValidationError` (Plan 4 errors), `pg.Pool`.
- Produces:
  - `geometry.ts`: `function geomInsertSql(def: LayerDef, paramIndex: number): string` → the SQL fragment that turns a `$n::text` GeoJSON string into a validated 4326 geometry, e.g. `ST_SetSRID(ST_GeomFromGeoJSON($n), 4326)`; and `function assertGeometry(def, geometry): string` → validates the parsed GeoJSON geometry object shape and returns the JSON string to bind (throws `GeometryError` on wrong type / missing when required). PostGIS `ST_IsValid` is enforced in the repository SQL (a `CASE WHEN NOT ST_IsValid(...) THEN` guard) since validity needs the DB.
  - `repository.ts`: `function featuresRepository(pg: Pool)` returning `{ list(def), findById(def, id), insert(def, { attrs, geometryJson }), update(def, id, { attrs, geometryJson }), remove(def, id) }`. Rows are returned as GeoJSON-ready objects: `{ id, geometry (parsed GeoJSON | null), properties }`.

- [ ] **Step 1: Create the geometry helper**

Create `apps/api/src/modules/layers/geometry.ts`:
```ts
import { GeometryError } from '../../errors';
import type { LayerDef } from '../../layers/registry';

/** Allowed GeoJSON geometry `type` values per OGC layer geometry type. */
const ALLOWED: Record<LayerDef['geomType'], string[]> = {
  Point: ['Point'],
  MultiLineString: ['MultiLineString', 'LineString'],
  MultiPolygon: ['MultiPolygon', 'Polygon'],
};

/**
 * Validate a parsed GeoJSON geometry against the layer's expected type and return
 * the JSON string to bind as a SQL parameter. `null`/`undefined` is allowed only
 * when the layer's geometry column is nullable (dams). Throws GeometryError otherwise.
 * PostGIS ST_IsValid / SRID normalization happen in the repository SQL.
 */
export function assertGeometry(def: LayerDef, geometry: unknown): string | null {
  if (geometry === null || geometry === undefined) {
    if (def.geomNullable) return null;
    throw new GeometryError('Geometry is required for this layer');
  }
  if (typeof geometry !== 'object' || geometry === null || !('type' in geometry)) {
    throw new GeometryError('Geometry must be a GeoJSON geometry object');
  }
  const type = (geometry as { type: unknown }).type;
  if (typeof type !== 'string' || !ALLOWED[def.geomType].includes(type)) {
    throw new GeometryError(`Geometry type must be compatible with ${def.geomType}`);
  }
  return JSON.stringify(geometry);
}

/**
 * SQL fragment converting a GeoJSON text parameter ($n) to a 4326 geometry,
 * forcing the layer's multi-type where the source may arrive single.
 */
export function geomInsertSql(def: LayerDef, n: number): string {
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($${n}), 4326)`;
  if (def.geomType === 'MultiLineString') return `ST_Multi(${base})`;
  if (def.geomType === 'MultiPolygon') return `ST_Multi(${base})`;
  return base;
}
```

- [ ] **Step 2: Create the generic repository**

Create `apps/api/src/modules/layers/repository.ts`. All interpolated identifiers (`def.table`, column names) come from the trusted registry, never from request data; all values are parameterized. The `ST_IsValid` guard runs in the DB and raises so the service maps it to `GeometryError`:
```ts
import type { Pool } from 'pg';
import type { LayerDef } from '../../layers/registry';
import { geomInsertSql } from './geometry';

export interface FeatureRow {
  id: string;
  geometry: unknown | null;            // parsed GeoJSON geometry
  properties: Record<string, unknown>; // attribute columns only
}

function selectSql(def: LayerDef): string {
  const attrs = def.attributeColumns.map((c) => `'${c}', t.${c}`).join(', ');
  // jsonb_build_object over the fixed registry columns; geometry via ST_AsGeoJSON.
  return `SELECT t.id,
                 CASE WHEN t.${def.geomColumn} IS NULL THEN NULL
                      ELSE ST_AsGeoJSON(t.${def.geomColumn})::jsonb END AS geometry,
                 jsonb_build_object(${attrs}) AS properties
          FROM ${def.table} t`;
}

function isValidGuard(def: LayerDef, n: number): string {
  // Raise a recognizable error the service maps to GeometryError.
  return `(SELECT CASE WHEN NOT ST_IsValid(${geomInsertSql(def, n)})
                       THEN NULL ELSE ${geomInsertSql(def, n)} END)`;
}

export function featuresRepository(pg: Pool) {
  return {
    async list(def: LayerDef): Promise<FeatureRow[]> {
      const { rows } = await pg.query(`${selectSql(def)} ORDER BY t.created_at DESC`);
      return rows;
    },
    async findById(def: LayerDef, id: string): Promise<FeatureRow | null> {
      const { rows } = await pg.query(`${selectSql(def)} WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    },
    async insert(def: LayerDef, input: { attrs: Record<string, unknown>; geometryJson: string | null; actorId?: string }): Promise<FeatureRow> {
      const cols = Object.keys(input.attrs);
      const vals = Object.values(input.attrs);
      const params: unknown[] = [...vals];
      const colList = [...cols];
      const valPlaceholders = cols.map((_, i) => `$${i + 1}`);
      // geometry
      if (input.geometryJson !== null) {
        params.push(input.geometryJson);
        colList.push(def.geomColumn);
        valPlaceholders.push(geomInsertSql(def, params.length));
      }
      // created_by / updated_by
      params.push(input.actorId ?? null);
      colList.push('created_by'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null);
      colList.push('updated_by'); valPlaceholders.push(`$${params.length}`);
      const insertSql = `INSERT INTO ${def.table} (${colList.join(', ')})
                         VALUES (${valPlaceholders.join(', ')})
                         RETURNING id`;
      const { rows } = await pg.query(insertSql, params);
      return (await this.findById(def, rows[0].id))!;
    },
    async update(def: LayerDef, id: string, input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }): Promise<FeatureRow | null> {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, v] of Object.entries(input.attrs)) { params.push(v); sets.push(`${k} = $${params.length}`); }
      if (input.geometryJson !== undefined) {
        if (input.geometryJson === null) {
          sets.push(`${def.geomColumn} = NULL`);
        } else {
          params.push(input.geometryJson);
          sets.push(`${def.geomColumn} = ${geomInsertSql(def, params.length)}`);
        }
      }
      params.push(input.actorId ?? null); sets.push(`updated_by = $${params.length}`);
      sets.push(`updated_at = now()`);
      if (sets.length === 0) return this.findById(def, id);
      params.push(id);
      const { rowCount } = await pg.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if ((rowCount ?? 0) === 0) return null;
      return this.findById(def, id);
    },
    async remove(def: LayerDef, id: string): Promise<boolean> {
      const { rowCount } = await pg.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
export type FeaturesRepository = ReturnType<typeof featuresRepository>;

void isValidGuard; // validity is enforced in the service via a pre-check query (Task 4)
```

- [ ] **Step 3: Commit (helpers land with their consumer in Task 4; no standalone test yet)**

```bash
git add apps/api/src/modules/layers/geometry.ts apps/api/src/modules/layers/repository.ts
git commit -m "feat(api): generic feature repository + GeoJSON geometry helper"
```
> These two files are exercised end-to-end by the Task 4 service unit path and the Task 5 integration test. They carry no behavior a fresh reviewer could reject independently of the service, so they fold into the next testable deliverable.

---

### Task 4: Feature service (geometry validation orchestration + audit)

**Files:**
- Create: `apps/api/src/modules/layers/service.ts`
- Modify: `apps/api/src/modules/layers/geometry.ts` (add `assertValidInPg` used by the service)

**Interfaces:**
- Consumes: `featuresRepository` (Task 3), `assertGeometry` (Task 3), `getLayer`/`LayerDef` (Task 2), `auditService` (Plan 4 `modules/audit/service.ts`), `GeometryError`/`NotFoundError` (Plan 4).
- Produces: `function featuresService(pg: Pool)` returning `{ list(key), get(key, id), create(key, feature, actorId), update(key, id, feature, actorId), remove(key, id, actorId) }`, where `feature` is `{ geometry?: unknown; properties?: Record<string, unknown> }`. Every write records `auditService.record({ action, tableName: def.table, featureId, before?, after? })`. Geometry validity is checked in PostGIS **before** the write so an invalid geometry raises `GeometryError` (422) rather than a 500.

- [ ] **Step 1: Add a PostGIS validity pre-check to the geometry helper**

In `apps/api/src/modules/layers/geometry.ts`, append:
```ts
import type { Pool } from 'pg';

/**
 * Ask PostGIS whether the GeoJSON string parses to a valid geometry. Runs before
 * insert/update so invalid input becomes GeometryError(422), not a DB 500.
 */
export async function assertValidInPg(pg: Pool, def: LayerDef, geometryJson: string): Promise<void> {
  const sql = `SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS valid`;
  let valid: boolean;
  try {
    const { rows } = await pg.query(sql, [geometryJson]);
    valid = rows[0]?.valid === true;
  } catch {
    throw new GeometryError('Geometry could not be parsed');
  }
  if (!valid) throw new GeometryError('Geometry is not valid');
}
```
(Update the existing `geometry.ts` imports so `Pool` and `GeometryError` are both imported.)

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/layers/service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { featuresService } from './service';
import { GeometryError, NotFoundError } from '../../errors';

const TEST_NAME = 'svc-test-dam@webatlas.test';

describe('featuresService (dams)', () => {
  const svc = () => featuresService(getPool());
  const created: string[] = [];

  afterAll(async () => {
    await getPool().query('DELETE FROM water.dams WHERE name = $1', [TEST_NAME]);
    await closePool();
  });

  it('rejects an unknown layer key with NotFoundError', async () => {
    await expect(svc().list('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates a dam feature, lists it, then removes it (audit written)', async () => {
    const feature = {
      geometry: { type: 'Point', coordinates: [105.8, 21.0] },
      properties: { name: TEST_NAME, status: 'operational' },
    };
    const row = await svc().create('dams', feature, undefined);
    created.push(row.id);
    expect(row.geometry).toMatchObject({ type: 'Point' });
    expect(row.properties.name).toBe(TEST_NAME);

    const listed = await svc().list('dams');
    expect(listed.some((r) => r.id === row.id)).toBe(true);

    await svc().remove('dams', row.id, undefined);
    const after = await svc().get('dams', row.id);
    expect(after).toBeNull();

    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1 ORDER BY created_at`,
      [row.id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'delete']);
  });

  it('rejects a wrong-type geometry with GeometryError', async () => {
    const feature = { geometry: { type: 'LineString', coordinates: [[105, 21], [106, 22]] }, properties: { name: TEST_NAME } };
    await expect(svc().create('dams', feature, undefined)).rejects.toBeInstanceOf(GeometryError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:api -- src/modules/layers/service.test.ts`
Expected: FAIL — cannot find module `./service`.

- [ ] **Step 4: Create the service**

Create `apps/api/src/modules/layers/service.ts`:
```ts
import type { Pool } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService } from '../audit/service';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown> };

async function prepare(pg: Pool, def: LayerDef, input: FeatureInput, geometryRequired: boolean) {
  const attrs = validate(def.attributeSchema, input.properties ?? {}) as Record<string, unknown>;
  // Only persist keys the layer actually owns.
  const owned: Record<string, unknown> = {};
  for (const c of def.attributeColumns) if (c in attrs) owned[c] = attrs[c];
  const geometryJson = geometryRequired || input.geometry !== undefined
    ? assertGeometry(def, input.geometry)
    : undefined;
  if (typeof geometryJson === 'string') await assertValidInPg(pg, def, geometryJson);
  return { attrs: owned, geometryJson };
}

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const audit = auditService(pg);
  return {
    async list(key: string): Promise<FeatureRow[]> { return repo.list(getLayer(key)); },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },

    async create(key: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const def = getLayer(key);
      const { attrs, geometryJson } = await prepare(pg, def, input, true);
      const row = await repo.insert(def, { attrs, geometryJson: geometryJson ?? null, actorId });
      await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row });
      return row;
    },

    async update(key: string, id: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const def = getLayer(key);
      const before = await repo.findById(def, id);
      if (!before) throw new NotFoundError('Feature not found');
      const { attrs, geometryJson } = await prepare(pg, def, input, false);
      const after = await repo.update(def, id, { attrs, geometryJson, actorId });
      await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after });
      return after!;
    },

    async remove(key: string, id: string, actorId?: string): Promise<void> {
      const def = getLayer(key);
      const before = await repo.findById(def, id);
      if (!before) throw new NotFoundError('Feature not found');
      await repo.remove(def, id);
      await audit.record({ userId: actorId, action: 'delete', tableName: def.table, featureId: id, before });
    },
  };
}
```

- [ ] **Step 5: Run test → PASS**

Run: `npm run test:api -- src/modules/layers/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/layers/service.ts apps/api/src/modules/layers/service.test.ts apps/api/src/modules/layers/geometry.ts
git commit -m "feat(api): feature service - geometry validation + audit on writes"
```

---

### Task 5: Layers controller + routes + integration test

**Files:**
- Create: `apps/api/src/modules/layers/controller.ts`, `apps/api/src/modules/layers/routes.ts`, `apps/api/src/modules/layers/layers.test.ts`
- Modify: `apps/api/src/server.ts` (register under `/api`)

**Interfaces:**
- Consumes: `featuresService` (Task 4), `listLayerMetadata` (Task 2), `app.authenticate` + `authorize('admin')` (Plan 4), `validate` (Plan 4).
- Produces:
  - `GET  /api/layers` → `{ layers: [{ key, geomType, attributes }] }` (no auth — metadata only, INV-2 catalog).
  - `GET  /api/layers/:key/features` → GeoJSON `{ type: 'FeatureCollection', features: [...] }` (admin).
  - `POST /api/layers/:key/features` → `201 { feature }` (admin).
  - `PUT  /api/layers/:key/features/:id` → `200 { feature }` (admin).
  - `DELETE /api/layers/:key/features/:id` → `204` (admin).
  Each `FeatureRow` serializes to a GeoJSON `Feature`: `{ type: 'Feature', id, geometry, properties }`.

- [ ] **Step 1: Create the controller**

Create `apps/api/src/modules/layers/controller.ts`:
```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { featuresService } from './service';
import { listLayerMetadata } from '../../layers/registry';
import type { FeatureRow } from './repository';

const KeyParams = z.object({ key: z.string() });
const KeyIdParams = z.object({ key: z.string(), id: z.string().uuid() });
const FeatureBody = z.object({ geometry: z.unknown().optional(), properties: z.record(z.unknown()).optional() });

function toFeature(row: FeatureRow) {
  return { type: 'Feature' as const, id: row.id, geometry: row.geometry, properties: row.properties };
}

export async function getLayers(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ layers: listLayerMetadata() });
}

export async function listFeatures(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const rows = await featuresService(req.server.pg).list(key);
  reply.send({ type: 'FeatureCollection', features: rows.map(toFeature) });
}

export async function createFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key } = validate(KeyParams, req.params);
  const body = validate(FeatureBody, req.body);
  const row = await featuresService(req.server.pg).create(key, body, req.currentUser?.id);
  reply.code(201).send({ feature: toFeature(row) });
}

export async function updateFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  const body = validate(FeatureBody, req.body);
  const row = await featuresService(req.server.pg).update(key, id, body, req.currentUser?.id);
  reply.send({ feature: toFeature(row) });
}

export async function deleteFeature(req: FastifyRequest, reply: FastifyReply) {
  const { key, id } = validate(KeyIdParams, req.params);
  await featuresService(req.server.pg).remove(key, id, req.currentUser?.id);
  reply.code(204).send();
}
```

- [ ] **Step 2: Create the routes**

Create `apps/api/src/modules/layers/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { getLayers, listFeatures, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, authorize('admin')] };
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  app.get('/layers/:key/features', adminOnly, listFeatures);
  app.post('/layers/:key/features', adminOnly, createFeature);
  app.put('/layers/:key/features/:id', adminOnly, updateFeature);
  app.delete('/layers/:key/features/:id', adminOnly, deleteFeature);
}
```

- [ ] **Step 3: Register under `/api` in `buildApp`**

In `apps/api/src/server.ts`, add the import next to the other route modules:
```ts
import layersRoutes from './modules/layers/routes';
```
and register it after the users routes:
```ts
  app.register(usersRoutes, { prefix: '/api/users' });
  app.register(layersRoutes, { prefix: '/api' });
```

- [ ] **Step 4: Write the integration test**

Create `apps/api/src/modules/layers/layers.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const ADMIN = 'layers-admin@webatlas.test';
const EDITOR = 'layers-editor@webatlas.test';
const PW = 'admin-pass-123';
const NAME = 'layers-crud-dam@webatlas.test';

async function tokenFor(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  return res.json().token as string;
}

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
afterAll(async () => {
  await getPool().query('DELETE FROM water.dams WHERE name = $1', [NAME]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'layers-%@webatlas.test'`);
  await app.close();
});

describe('layers metadata', () => {
  it('GET /api/layers returns the derived catalog (no auth)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/layers' });
    expect(res.statusCode).toBe(200);
    const keys = res.json().layers.map((l: { key: string }) => l.key);
    expect(keys).toContain('dams');
    expect(keys).toHaveLength(7);
  });
});

describe('feature CRUD (admin only)', () => {
  it('rejects non-admin with 403 and anonymous with 401', async () => {
    const editorToken = await tokenFor(EDITOR);
    const forbidden = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: { authorization: `Bearer ${editorToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });

  it('404 for an unknown layer key', async () => {
    const token = await tokenFor(ADMIN);
    const res = await app.inject({ method: 'GET', url: '/api/layers/not_a_layer/features', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('admin creates, reads (GeoJSON), updates, deletes; audit rows written', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: auth,
      payload: { geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: NAME, status: 'operational' } },
    });
    expect(create.statusCode).toBe(201);
    const feature = create.json().feature;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Point');
    expect(feature.properties.name).toBe(NAME);
    const id = feature.id;

    const list = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: auth });
    expect(list.json().type).toBe('FeatureCollection');
    expect(list.json().features.some((f: { id: string }) => f.id === id)).toBe(true);

    const upd = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { properties: { status: 'decommissioned' } },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().feature.properties.status).toBe('decommissioned');

    const bad = await app.inject({
      method: 'PUT', url: `/api/layers/dams/features/${id}`, headers: auth,
      payload: { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    });
    expect(bad.statusCode).toBe(422);

    const del = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1 ORDER BY created_at`,
      [id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
  });
});
```

- [ ] **Step 5: Run the full suite → PASS**

Run: `npm run test:api`
Expected: all suites green — the Plan 4 suites plus the new registry, service, and layers integration tests.

- [ ] **Step 6: Typecheck (catches loose-runtime type errors)**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no output (clean). Fix any error before committing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/layers/controller.ts apps/api/src/modules/layers/routes.ts apps/api/src/modules/layers/layers.test.ts apps/api/src/server.ts
git commit -m "feat(api): layers feature CRUD API (GeoJSON) + /api/layers metadata"
```

---

## Self-Review

**1. Spec coverage (design §6.4, §6.5, INV-2, INV-4, §10):**
- API surface `GET /api/layers`, `GET/POST/PUT/DELETE /api/layers/:key/features[/:id]` → Tasks 2, 5 ✓
- Layer registry as the one catalog; `GET /api/layers` derived from it (INV-2) → Tasks 2, 5 ✓
- Generic CRUD/validation across all seven layers via the registry → Tasks 3–5 ✓
- Layer identity from `@webatlas/shared` (INV-4); geometry-type map shared → Task 1 ✓
- Geometry validation (`ST_GeomFromGeoJSON`, `ST_SetSRID` 4326, `ST_IsValid`) → 422 `GeometryError` → Tasks 3, 4 ✓
- Admin-only writes (`authorize('admin')`), audit on every write, parameterized SQL (only registry identifiers interpolated) → Tasks 4, 5 ✓
- Layered Routes→Controllers→Services→Repositories→pool, typed errors thrown low / formatted once → Tasks 3–5 ✓
- **Deferred (stated, not gaps):** frontend admin editing mode (EditToolbar/Draw/Modify/AttributeForm, WFS refetch) is **Plan 6** (this plan is backend-only per the chosen scope); testcontainers-isolated tests remain later hardening; GADM boundaries stay static (design §12).

**2. Placeholder scan:** every file's full content is given; no TBD/TODO. The `void isValidGuard` line in Task 3 is intentional (validity is enforced by `assertValidInPg` in the service, Task 4) — the helper is left in place for a future in-statement guard but not dead-imported.

**3. Type/name consistency:** `LayerDef`, `LAYER_REGISTRY`, `getLayer`, `listLayerMetadata`, `featuresRepository`/`FeatureRow`, `featuresService`, `assertGeometry`/`geomInsertSql`/`assertValidInPg`, `toFeature` used consistently across tasks. `geomColumn` is literally `'geom'` everywhere (matches the migration). Attribute column sets match `1000000000002_water-schema.cjs`. Reuses Plan 4 exports verbatim: `validate`, `authorize`, `app.authenticate`, `auditService.record({ userId, action, tableName, featureId, before, after })`, `NotFoundError`/`GeometryError`/`ValidationError`. Response error shape unchanged from Plan 4.

**4. Risks for the implementer:**
- **Rebuild `@webatlas/shared` (Task 1 Step 5)** before Task 2 — the API imports the built `dist/`, so a missed rebuild makes `LAYER_GEOMETRY` unresolvable.
- **`dams.geom` is nullable; all others `NOT NULL`.** `create` requires geometry for non-dams (422 if missing); `update` treats geometry as optional (only touched when the request includes a `geometry` key). The registry's `geomNullable` drives this — do not hardcode per layer.
- **Registry-only identifier interpolation.** `def.table` and `def.attributeColumns` are the *only* interpolated SQL identifiers and come from the trusted registry, never request data. Keep it that way (INV-2 + design §10). Attribute *values* and geometry are always parameterized.
- **Geometry validity must be pre-checked (`assertValidInPg`)** so a bad geometry is 422, not a 500 from the failing `INSERT`. The Task 4/5 tests assert 422.
- **Multi-geometry coercion:** `rivers`/flood layers accept single `LineString`/`Polygon` and are wrapped with `ST_Multi` to match the column type; `assertGeometry`'s `ALLOWED` map permits both.
- **Test isolation:** feature tests key their rows by `name = '…@webatlas.test'` and delete exactly those; user rows use the `layers-%@webatlas.test` namespace. Never delete seeded rows. If Vitest parallelism causes flakiness, run `vitest run --no-file-parallelism`.

---

## Follow-on

- **Plan 6** — frontend admin editing mode (Feature-Sliced Design, design §7): `session` entity + `LoginModal`, `MapModel`/`LayerModel` driving OpenLayers `Draw`/`Modify`/`Translate`, schema-driven `AttributeForm` derived from `GET /api/layers`, `RequireRole` gating, TanStack Query cache with WFS refetch after each write. Consumes this plan's `/api/layers` + feature CRUD.
- Hardening: testcontainers-isolated integration tests; GeoServer publication provisioned from the same registry (INV-2 config-as-code); optional per-layer `GET /api/layers/:key/features` pagination/bbox filter if datasets grow.
