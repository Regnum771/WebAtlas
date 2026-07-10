# Plan 2 — Vector Schema, Seeds & GeoServer WFS Publication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the seven thematic water/hazard layers from static files into PostGIS via migrations + seeds, and publish them as read-only GeoServer WFS layers, so the data is served live from the database as GeoJSON.

**Architecture:** Introduce the `apps/api` workspace as the home of the database layer (migrations + seeds now; the Fastify server comes in Plan 4). `node-pg-migrate` creates the `app` schema (users, audit_log) and the `water` schema (seven tables with `geometry(…,4326)` + GiST indexes). A TypeScript seed runner loads the existing GeoJSON (dams, rivers) and converted mock datasets (five hazard/station layers) into those tables idempotently. A GeoServer provisioning script (REST, config-as-code per INV-2) creates a workspace + PostGIS datastore and publishes one WFS layer per table.

**Tech Stack:** Node.js + TypeScript, `pg`, `node-pg-migrate`, `tsx`, `dotenv`, Vitest; PostGIS 16-3.4; GeoServer 2.26 REST API.

## Global Constraints

- Node.js **22.x**, npm **10.x**; npm workspaces; new workspace is `@webatlas/api`.
- PostGIS is the single source of truth (INV-1). Schemas: `app`, `water` (created in Plan 1's `init.sql`; migrations create the tables).
- GeoServer layer publication is **config-as-code, never hand-edited in the UI** (INV-2). All GeoServer setup is via the REST provisioning script.
- Geometry SRID is **4326** for all stored geometry; GeoServer declares **EPSG:4326**.
- The seven canonical layer keys (from `@webatlas/shared`, INV-4) map to the seven `water.*` tables: `dams`, `rivers`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`.
- Seeds must be **idempotent** (re-running yields the same rows) via `external_id` upsert.
- DB connection (host → container): `postgres://webatlas:change_me_dev@localhost:5432/webatlas` (matches `infra/.env`). GeoServer → DB uses host `db` (Compose service name), port `5432`.
- This plan assumes Plan 1 is merged: the app lives in `apps/web`, GeoJSON at `apps/web/public/`, and the Docker stack (`infra/docker-compose.yml`) is running.

## Source → column mapping (authoritative for the seed step)

**`water.dams`** ← `apps/web/public/thuydienvietnam.geojson` (Point, 371 features)

| Source property | Column | Type |
|---|---|---|
| `ID` | `external_id` | integer (unique) |
| `Vietnamese` | `name` | text |
| `English_hy` | `name_en` | text |
| `Wattage_PL` | `wattage_mw` | numeric |
| `Quantity_(` | `annual_output` | numeric (source "Quantity_(…)"; store raw number) |
| `Year_of_la` | `year_launched` | text (e.g. "11/1979") |
| `Year_of_op` | `year_operational` | text |
| — | `status` | text null (admin-managed later) |
| geometry | `geom` | geometry(Point,4326) |

**`water.rivers`** ← `apps/web/public/thuyhe.geojson` (MultiLineString, 2013 features)

| Source property | Column | Type |
|---|---|---|
| `OBJECTID` | `external_id` | integer (unique) |
| `Ma` | `code` | text |
| `Ten` | `name` | text null |
| `Cap` | `stream_order` | integer |
| `Chieu_dai` | `length_m` | numeric |
| geometry | `geom` | geometry(MultiLineString,4326) |

**Five hazard/station layers** ← converted from `apps/web/src/data/mockData.ts` into seed GeoJSON files created in Task 4. Property `id` → `external_id` (text) for all.

- `water.stations` (Point): `name`, `type`→`station_type`, `status`, `value`
- `water.flood_zones` (MultiPolygon): `name`, `type`→`hazard_type`, `area`, `riskLevel`→`risk_level`
- `water.drought_points` (Point): `name`, `riskLevel`→`risk_level`, `status`, `surveyDate`→`survey_date` (date)
- `water.saltwater_intrusion` (Point): `name`, `salinity`, `riskLevel`→`risk_level`, `status`
- `water.flood_generation` (MultiPolygon): `name`, `riskLevel`→`risk_level`, `area`, `flowRate`→`flow_rate`

Polygons from the mock are single `Polygon`; store as `MultiPolygon` via `ST_Multi`.

---

### Task 1: Establish the `apps/api` workspace with DB connection + migration tooling

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/.env.example`
- Create: `apps/api/src/db/pool.ts`
- Create: `apps/api/src/db/ping.test.ts`
- Modify: root `package.json` (add api scripts)
- Modify: `.gitignore` (ignore `apps/api/.env`)

**Interfaces:**
- Produces: `@webatlas/api` workspace; `getPool()` returning a shared `pg.Pool` from `DATABASE_URL`; root scripts `migrate`, `seed`, `publish:geoserver`.

- [ ] **Step 1: Create the api package manifest**

Create `apps/api/package.json`:
```json
{
  "name": "@webatlas/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "migrate": "node-pg-migrate -m src/db/migrations --tsconfig tsconfig.json",
    "migrate:up": "node-pg-migrate up -m src/db/migrations",
    "migrate:down": "node-pg-migrate down -m src/db/migrations",
    "seed": "tsx src/db/seeds/run.ts",
    "publish:geoserver": "tsx src/geoserver/publish.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "node-pg-migrate": "^7.9.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create the api tsconfig**

Create `apps/api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create the api env template**

Create `apps/api/.env.example`:
```dotenv
# Database (host -> container). Matches infra/.env credentials.
DATABASE_URL=postgres://webatlas:change_me_dev@localhost:5432/webatlas

# GeoServer REST (host -> container)
GEOSERVER_URL=http://localhost:8080/geoserver
GEOSERVER_ADMIN_USER=admin
GEOSERVER_ADMIN_PASSWORD=change_me_dev

# How GeoServer reaches the DB (inside the compose network)
GEOSERVER_DB_HOST=db
GEOSERVER_DB_PORT=5432
GEOSERVER_DB_NAME=webatlas
GEOSERVER_DB_USER=webatlas
GEOSERVER_DB_PASSWORD=change_me_dev
GEOSERVER_WORKSPACE=webatlas
```

- [ ] **Step 4: Create the shared pool**

Create `apps/api/src/db/pool.ts`:
```ts
import 'dotenv/config';
import pg from 'pg';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```

- [ ] **Step 5: Write the failing connectivity test**

Create `apps/api/src/db/ping.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

describe('database connectivity', () => {
  it('connects and PostGIS is available', async () => {
    const { rows } = await getPool().query('SELECT postgis_version() AS v');
    expect(rows[0].v).toContain('3.4');
  });

  it('has the app and water schemas from init.sql', async () => {
    const { rows } = await getPool().query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('app', 'water') ORDER BY schema_name`
    );
    expect(rows.map((r) => r.schema_name)).toEqual(['app', 'water']);
  });
});
```

- [ ] **Step 6: Add root scripts and gitignore**

In root `package.json`, add to `"scripts"`:
```json
    "migrate": "npm run migrate:up -w @webatlas/api",
    "seed": "npm run seed -w @webatlas/api",
    "publish:geoserver": "npm run publish:geoserver -w @webatlas/api",
    "test:api": "npm run test -w @webatlas/api"
```

Append to `.gitignore`:
```
# API local env
apps/api/.env
```

- [ ] **Step 7: Install, create local env, run the test to verify it PASSES**

Run from repo root (the Docker stack from Plan 1 must be up):
```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run test:api
```
Expected: both tests PASS (connects, PostGIS 3.4, schemas `app`+`water` present). This test passes immediately because Plan 1's `init.sql` already created the schemas — it is a connectivity gate, not TDD-red.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add @webatlas/api workspace with db pool and connectivity test"
```

---

### Task 2: Migration — `app` schema (users, audit_log)

**Files:**
- Create: `apps/api/src/db/migrations/1000000000001_app-schema.cjs`
- Create: `apps/api/src/db/schema.test.ts`

**Interfaces:**
- Produces: `app.users` (uuid pk, citext email unique, role enum) and `app.audit_log`; enums `app.user_role`, `app.audit_action`. `water.*` FKs reference `app.users(id)`.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/db/migrations/1000000000001_app-schema.cjs`:
```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createType({ schema: 'app', name: 'user_role' }, ['admin', 'editor', 'viewer']);
  pgm.createType({ schema: 'app', name: 'audit_action' }, ['create', 'update', 'delete']);

  pgm.createTable(
    { schema: 'app', name: 'users' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      email: { type: 'citext', notNull: true, unique: true },
      password_hash: { type: 'text', notNull: true },
      full_name: { type: 'text' },
      role: { type: 'app.user_role', notNull: true, default: 'viewer' },
      is_active: { type: 'boolean', notNull: true, default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );

  pgm.createTable(
    { schema: 'app', name: 'audit_log' },
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
      action: { type: 'app.audit_action', notNull: true },
      table_name: { type: 'text', notNull: true },
      feature_id: { type: 'uuid' },
      before: { type: 'jsonb' },
      after: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
  pgm.createIndex({ schema: 'app', name: 'audit_log' }, 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'app', name: 'audit_log' });
  pgm.dropTable({ schema: 'app', name: 'users' });
  pgm.dropType({ schema: 'app', name: 'audit_action' });
  pgm.dropType({ schema: 'app', name: 'user_role' });
};
```

- [ ] **Step 2: Write the failing schema test (app portion)**

Create `apps/api/src/db/schema.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    [schema, table]
  );
  return rows.length === 1;
}

describe('app schema', () => {
  it('has users and audit_log tables', async () => {
    expect(await tableExists('app', 'users')).toBe(true);
    expect(await tableExists('app', 'audit_log')).toBe(true);
  });

  it('users.email is unique and citext', async () => {
    const { rows } = await getPool().query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema='app' AND table_name='users' AND column_name='email'`
    );
    expect(rows[0].data_type).toBe('USER-DEFINED'); // citext
  });
});
```

- [ ] **Step 3: Run the test to verify it FAILS**

Run: `npm run test:api`
Expected: FAIL — `app.users`/`app.audit_log` do not exist yet (migration not run).

- [ ] **Step 4: Run the migration**

Run from repo root:
```bash
npm run migrate
```
Expected: `node-pg-migrate` applies `1000000000001_app-schema` with no error.

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `npm run test:api`
Expected: PASS — app tables present, email is citext.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): migrate app schema (users, audit_log)"
```

---

### Task 3: Migration — `water` schema (seven tables)

**Files:**
- Create: `apps/api/src/db/migrations/1000000000002_water-schema.cjs`
- Modify: `apps/api/src/db/schema.test.ts` (add water assertions)

**Interfaces:**
- Produces: `water.dams`, `water.rivers`, `water.stations`, `water.flood_zones`, `water.drought_points`, `water.saltwater_intrusion`, `water.flood_generation` — each with `id` uuid pk, `external_id` unique, layer columns (per mapping table), `geom geometry(<Type>,4326) NOT NULL`, `created_at/updated_at`, `created_by/updated_by` FK → `app.users`, and a GiST index on `geom`.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/db/migrations/1000000000002_water-schema.cjs`:
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

function makeTable(pgm, name, geomType, columns) {
  pgm.createTable({ schema: 'water', name }, {
    ...COMMON(pgm),
    name: { type: 'text' },
    ...columns,
    geom: { type: `geometry(${geomType}, 4326)`, notNull: true },
  });
  pgm.createIndex({ schema: 'water', name }, 'geom', { method: 'gist' });
  pgm.createIndex({ schema: 'water', name }, 'external_id', { unique: true });
}

exports.up = (pgm) => {
  makeTable(pgm, 'dams', 'Point', {
    external_id: { type: 'integer' },
    name_en: { type: 'text' },
    wattage_mw: { type: 'numeric' },
    annual_output: { type: 'numeric' },
    year_launched: { type: 'text' },
    year_operational: { type: 'text' },
    status: { type: 'text' },
  });

  makeTable(pgm, 'rivers', 'MultiLineString', {
    external_id: { type: 'integer' },
    code: { type: 'text' },
    stream_order: { type: 'integer' },
    length_m: { type: 'numeric' },
  });

  makeTable(pgm, 'stations', 'Point', {
    external_id: { type: 'text' },
    station_type: { type: 'text' },
    status: { type: 'text' },
    value: { type: 'text' },
  });

  makeTable(pgm, 'flood_zones', 'MultiPolygon', {
    external_id: { type: 'text' },
    hazard_type: { type: 'text' },
    area: { type: 'text' },
    risk_level: { type: 'text' },
  });

  makeTable(pgm, 'drought_points', 'Point', {
    external_id: { type: 'text' },
    risk_level: { type: 'text' },
    status: { type: 'text' },
    survey_date: { type: 'date' },
  });

  makeTable(pgm, 'saltwater_intrusion', 'Point', {
    external_id: { type: 'text' },
    salinity: { type: 'text' },
    risk_level: { type: 'text' },
    status: { type: 'text' },
  });

  makeTable(pgm, 'flood_generation', 'MultiPolygon', {
    external_id: { type: 'text' },
    risk_level: { type: 'text' },
    area: { type: 'text' },
    flow_rate: { type: 'text' },
  });
};

exports.down = (pgm) => {
  for (const name of [
    'flood_generation', 'saltwater_intrusion', 'drought_points',
    'flood_zones', 'stations', 'rivers', 'dams',
  ]) {
    pgm.dropTable({ schema: 'water', name });
  }
};
```

- [ ] **Step 2: Add water assertions to the schema test**

In `apps/api/src/db/schema.test.ts`, append:
```ts
describe('water schema', () => {
  const tables = [
    'dams', 'rivers', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation',
  ];

  it('has all seven thematic tables', async () => {
    for (const t of tables) {
      expect(await tableExists('water', t)).toBe(true);
    }
  });

  it('every table has a 4326 geometry column', async () => {
    const { rows } = await getPool().query(
      `SELECT f_table_name, srid, type FROM geometry_columns WHERE f_table_schema='water'`
    );
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.srid).toBe(4326);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it FAILS**

Run: `npm run test:api`
Expected: FAIL — water tables not present yet.

- [ ] **Step 4: Run the migration**

Run: `npm run migrate`
Expected: `1000000000002_water-schema` applies cleanly.

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `npm run test:api`
Expected: PASS — seven tables, seven 4326 geometry columns.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): migrate water schema (seven thematic tables)"
```

---

### Task 4: Seed runner + `dams` & `rivers` from GeoJSON, plus mock seed files

**Files:**
- Create: `apps/api/src/db/seeds/run.ts`
- Create: `apps/api/src/db/seeds/registry.ts`
- Create: `apps/api/src/db/seeds/data/stations.geojson`
- Create: `apps/api/src/db/seeds/data/flood_zones.geojson`
- Create: `apps/api/src/db/seeds/data/drought_points.geojson`
- Create: `apps/api/src/db/seeds/data/saltwater_intrusion.geojson`
- Create: `apps/api/src/db/seeds/data/flood_generation.geojson`
- Create: `apps/api/src/db/seeds/seed.test.ts`

**Interfaces:**
- Consumes: migrations from Tasks 2–3; GeoJSON at `apps/web/public/{thuydienvietnam,thuyhe}.geojson`.
- Produces: `runSeeds()` populating all seven `water.*` tables idempotently via `ON CONFLICT (external_id)`.

- [ ] **Step 1: Create the five mock seed GeoJSON files**

These are the mock collections from `apps/web/src/data/mockData.ts` converted to GeoJSON files. Create each verbatim.

`apps/api/src/db/seeds/data/stations.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [108.07, 13.95] },
      "properties": { "id": "s1", "name": "Trạm Thủy văn An Khê", "type": "Đo mực nước", "status": "Hoạt động", "value": "Mực nước: 2.3m" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [108.44, 15.46] },
      "properties": { "id": "s2", "name": "Trạm Đo Mưa Phú Ninh", "type": "Đo lượng mưa", "status": "Hoạt động", "value": "Lượng mưa: 45mm/24h" } }
  ]
}
```

`apps/api/src/db/seeds/data/flood_zones.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[108.95,13.05],[109.15,13.05],[109.15,12.95],[108.95,12.95],[108.95,13.05]]] },
      "properties": { "id": "f1", "name": "Vùng ngập lụt Tuy Hòa", "type": "Nguy cơ ngập", "area": "15.4 km2", "riskLevel": "Trung bình" } },
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[108.40,15.58],[108.55,15.58],[108.55,15.48],[108.40,15.48],[108.40,15.58]]] },
      "properties": { "id": "f2", "name": "Vùng ngập lụt Tam Kỳ", "type": "Nguy cơ ngập", "area": "22.8 km2", "riskLevel": "Cao" } }
  ]
}
```

`apps/api/src/db/seeds/data/drought_points.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [108.01, 14.01] },
      "properties": { "id": "dr1", "name": "Trạm khảo sát hạn hán Pleiku", "riskLevel": "Cao", "status": "Đang thiếu nước nghiêm trọng", "surveyDate": "2026-06-15" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [108.80, 13.20] },
      "properties": { "id": "dr2", "name": "Điểm khảo sát hạn hán Sông Hinh", "riskLevel": "Trung bình", "status": "Nguồn nước ngầm suy giảm", "surveyDate": "2026-06-20" } }
  ]
}
```

`apps/api/src/db/seeds/data/saltwater_intrusion.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [109.28, 13.06] },
      "properties": { "id": "sw1", "name": "Cửa sông Đà Diễn (Sông Ba)", "salinity": "4.2 g/l", "riskLevel": "Cao", "status": "Xâm nhập sâu 5km vào nội đồng" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [109.18, 13.63] },
      "properties": { "id": "sw2", "name": "Đầm Thị Nại", "salinity": "3.1 g/l", "riskLevel": "Trung bình", "status": "Độ mặn tăng cao theo triều cường" } }
  ]
}
```

`apps/api/src/db/seeds/data/flood_generation.geojson`:
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[107.8,14.3],[108.1,14.3],[108.1,14.0],[107.8,14.0],[107.8,14.3]]] },
      "properties": { "id": "fg1", "name": "Lưu vực sinh lũ Thượng nguồn Sông Ba", "riskLevel": "Cao", "area": "120 km2", "flowRate": "Rất lớn khi mưa lớn" } },
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[107.5,14.8],[107.9,14.8],[107.9,14.5],[107.5,14.5],[107.5,14.8]]] },
      "properties": { "id": "fg2", "name": "Vùng sinh lũ Sa Thầy", "riskLevel": "Trung bình", "area": "85 km2", "flowRate": "Độ dốc cao, lũ quét nhanh" } }
  ]
}
```

- [ ] **Step 2: Create the seed registry (source → SQL mapping)**

Create `apps/api/src/db/seeds/registry.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db/seeds -> repo root is five levels up
const repoRoot = resolve(here, '../../../../..');
const webPublic = resolve(repoRoot, 'apps/web/public');
const seedData = resolve(here, 'data');

export interface SeedLayer {
  table: string;
  file: string;
  /** true if the source geometry is a single Polygon that must be wrapped as MultiPolygon */
  multiPolygon?: boolean;
  /** true if the source geometry is a single LineString/MultiLineString to normalise as MultiLineString */
  multiLine?: boolean;
  /** map a GeoJSON feature's properties to a { column: value } object (excluding geom) */
  columns: (props: Record<string, unknown>) => Record<string, unknown>;
}

export const SEED_LAYERS: SeedLayer[] = [
  {
    table: 'dams',
    file: resolve(webPublic, 'thuydienvietnam.geojson'),
    columns: (p) => ({
      external_id: p.ID,
      name: p.Vietnamese,
      name_en: p.English_hy,
      wattage_mw: p.Wattage_PL,
      annual_output: p['Quantity_('],
      year_launched: p.Year_of_la,
      year_operational: p.Year_of_op,
    }),
  },
  {
    table: 'rivers',
    file: resolve(webPublic, 'thuyhe.geojson'),
    multiLine: true,
    columns: (p) => ({
      external_id: p.OBJECTID,
      code: p.Ma,
      name: p.Ten,
      stream_order: p.Cap,
      length_m: p.Chieu_dai,
    }),
  },
  {
    table: 'stations',
    file: resolve(seedData, 'stations.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, station_type: p.type, status: p.status, value: p.value }),
  },
  {
    table: 'flood_zones',
    file: resolve(seedData, 'flood_zones.geojson'),
    multiPolygon: true,
    columns: (p) => ({ external_id: p.id, name: p.name, hazard_type: p.type, area: p.area, risk_level: p.riskLevel }),
  },
  {
    table: 'drought_points',
    file: resolve(seedData, 'drought_points.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, status: p.status, survey_date: p.surveyDate }),
  },
  {
    table: 'saltwater_intrusion',
    file: resolve(seedData, 'saltwater_intrusion.geojson'),
    columns: (p) => ({ external_id: p.id, name: p.name, salinity: p.salinity, risk_level: p.riskLevel, status: p.status }),
  },
  {
    table: 'flood_generation',
    file: resolve(seedData, 'flood_generation.geojson'),
    multiPolygon: true,
    columns: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, area: p.area, flow_rate: p.flowRate }),
  },
];
```

- [ ] **Step 3: Create the seed runner**

Create `apps/api/src/db/seeds/run.ts`:
```ts
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS, type SeedLayer } from './registry';

function geomExpr(layer: SeedLayer): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (layer.multiPolygon) return `ST_Multi(${base})`;
  if (layer.multiLine) return `ST_Multi(${base})`;
  return base;
}

export async function seedLayer(client: pg.PoolClient, layer: SeedLayer): Promise<number> {
  const fc = JSON.parse(readFileSync(layer.file, 'utf8'));
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = fc.features;
  let count = 0;

  for (const f of features) {
    const cols = layer.columns(f.properties);
    const colNames = Object.keys(cols);
    const values = Object.values(cols);
    // Placeholders: $1..$n for columns, then geometry as the last param
    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = geomExpr(layer).replace('$GEOM', `$${geomParamIndex}`);

    const updateSet = colNames
      .filter((c) => c !== 'external_id')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .concat(`geom = EXCLUDED.geom`, `updated_at = now()`)
      .join(', ');

    const sql = `
      INSERT INTO water.${layer.table} (${colNames.join(', ')}, geom)
      VALUES (${colPlaceholders.join(', ')}, ${geomSql})
      ON CONFLICT (external_id) DO UPDATE SET ${updateSet}
    `;
    await client.query(sql, [...values, JSON.stringify(f.geometry)]);
    count++;
  }
  return count;
}

export async function runSeeds(): Promise<Record<string, number>> {
  const pool = getPool();
  const client = await pool.connect();
  const result: Record<string, number> = {};
  try {
    for (const layer of SEED_LAYERS) {
      await client.query('BEGIN');
      result[layer.table] = await seedLayer(client, layer);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded water.${layer.table}: ${result[layer.table]} features`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return result;
}

// Run when invoked directly (npm run seed)
runSeeds()
  .then(() => closePool())
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
    return closePool();
  });
```

- [ ] **Step 4: Write the failing seed test**

Create `apps/api/src/db/seeds/seed.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';
import { runSeeds } from './run';

beforeAll(async () => {
  await runSeeds();
});
afterAll(async () => {
  await closePool();
});

async function count(table: string): Promise<number> {
  const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM water.${table}`);
  return rows[0].n;
}

describe('seeds', () => {
  it('loads dams and rivers from the source GeoJSON', async () => {
    expect(await count('dams')).toBe(371);
    expect(await count('rivers')).toBe(2013);
  });

  it('loads the five mock layers (2 features each)', async () => {
    for (const t of ['stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(await count(t)).toBe(2);
    }
  });

  it('stores only valid 4326 geometry', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS bad FROM water.dams WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326`
    );
    expect(rows[0].bad).toBe(0);
  });

  it('is idempotent (re-running does not duplicate rows)', async () => {
    const before = await count('flood_zones');
    await runSeeds();
    expect(await count('flood_zones')).toBe(before);
  });
});
```

- [ ] **Step 5: Run the test to verify it FAILS**

Run: `npm run test:api`
Expected: FAIL — seeding not yet run against a fresh checkout OR counts are 0 before the runner works (the `run.ts` and data files are what make it pass). If `run.ts` has an error, fix it before proceeding.

> Note: the `ping`/`schema` tests still run in this suite and should stay green.

- [ ] **Step 6: Run the seed and the test to verify PASS**

Run from repo root:
```bash
npm run seed
npm run test:api
```
Expected: seed prints per-table counts (dams 371, rivers 2013, five layers 2 each); tests PASS including idempotency.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): seed water tables from GeoJSON + mock (idempotent)"
```

---

### Task 5: GeoServer publication (workspace + PostGIS datastore + seven WFS layers)

**Files:**
- Create: `apps/api/src/geoserver/client.ts`
- Create: `apps/api/src/geoserver/publish.ts`
- Create: `apps/api/src/geoserver/publish.test.ts`

**Interfaces:**
- Consumes: env from `apps/api/.env` (GEOSERVER_*), the seeded `water.*` tables.
- Produces: a `webatlas` GeoServer workspace, a `webatlas_water` PostGIS datastore (schema `water`), and one published feature-type layer per table, queryable via WFS as GeoJSON. Idempotent (safe to re-run).

- [ ] **Step 1: Create a minimal GeoServer REST client**

Create `apps/api/src/geoserver/client.ts`:
```ts
import 'dotenv/config';

const base = () => {
  const url = process.env.GEOSERVER_URL;
  if (!url) throw new Error('GEOSERVER_URL is not set');
  return `${url.replace(/\/$/, '')}/rest`;
};

function authHeader(): string {
  const user = process.env.GEOSERVER_ADMIN_USER ?? 'admin';
  const pass = process.env.GEOSERVER_ADMIN_PASSWORD ?? '';
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export async function gsRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** true if a GET on the path returns 200 (resource exists) */
export async function gsExists(path: string): Promise<boolean> {
  const res = await gsRequest('GET', path);
  return res.status === 200;
}
```

- [ ] **Step 2: Create the publication script**

Create `apps/api/src/geoserver/publish.ts`:
```ts
import 'dotenv/config';
import { gsRequest, gsExists } from './client';

const WS = process.env.GEOSERVER_WORKSPACE ?? 'webatlas';
const STORE = `${WS}_water`;
const TABLES = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

async function ensureWorkspace(): Promise<void> {
  if (await gsExists(`/workspaces/${WS}`)) return;
  const res = await gsRequest('POST', '/workspaces', { workspace: { name: WS } });
  if (!res.ok) throw new Error(`create workspace failed: ${res.status} ${await res.text()}`);
}

async function ensureDatastore(): Promise<void> {
  if (await gsExists(`/workspaces/${WS}/datastores/${STORE}`)) return;
  const body = {
    dataStore: {
      name: STORE,
      connectionParameters: {
        entry: [
          { '@key': 'dbtype', $: 'postgis' },
          { '@key': 'host', $: process.env.GEOSERVER_DB_HOST ?? 'db' },
          { '@key': 'port', $: process.env.GEOSERVER_DB_PORT ?? '5432' },
          { '@key': 'database', $: process.env.GEOSERVER_DB_NAME ?? 'webatlas' },
          { '@key': 'schema', $: 'water' },
          { '@key': 'user', $: process.env.GEOSERVER_DB_USER ?? 'webatlas' },
          { '@key': 'passwd', $: process.env.GEOSERVER_DB_PASSWORD ?? '' },
          { '@key': 'Expose primary keys', $: 'true' },
        ],
      },
    },
  };
  const res = await gsRequest('POST', `/workspaces/${WS}/datastores`, body);
  if (!res.ok) throw new Error(`create datastore failed: ${res.status} ${await res.text()}`);
}

async function ensureLayer(table: string): Promise<void> {
  const ftPath = `/workspaces/${WS}/datastores/${STORE}/featuretypes`;
  if (await gsExists(`${ftPath}/${table}`)) return;
  const body = {
    featureType: {
      name: table,
      nativeName: table,
      srs: 'EPSG:4326',
      enabled: true,
    },
  };
  const res = await gsRequest('POST', ftPath, body);
  if (!res.ok) throw new Error(`publish ${table} failed: ${res.status} ${await res.text()}`);
}

export async function publishAll(): Promise<void> {
  await ensureWorkspace();
  await ensureDatastore();
  for (const t of TABLES) {
    await ensureLayer(t);
    // eslint-disable-next-line no-console
    console.log(`published layer ${WS}:${t}`);
  }
}

publishAll().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Write the failing WFS test**

Create `apps/api/src/geoserver/publish.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

const GS = process.env.GEOSERVER_URL ?? 'http://localhost:8080/geoserver';

async function wfsCount(layer: string): Promise<number> {
  const url =
    `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=webatlas:${layer}&outputFormat=application/json&count=5`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { features: unknown[]; type: string };
  expect(json.type).toBe('FeatureCollection');
  return json.features.length;
}

describe('WFS publication', () => {
  it('serves dams as GeoJSON', async () => {
    expect(await wfsCount('dams')).toBeGreaterThan(0);
  });

  it('serves all seven layers as GeoJSON', async () => {
    for (const l of ['dams', 'rivers', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(await wfsCount(l)).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it FAILS**

Run: `npm run test:api`
Expected: the `publish.test.ts` cases FAIL — layers not yet published (WFS returns an exception/404), while earlier `ping`/`schema`/`seed` tests stay green.

- [ ] **Step 5: Run the publication script**

Run from repo root (stack up, tables seeded):
```bash
npm run publish:geoserver
```
Expected: prints `published layer webatlas:<table>` for all seven; no errors.

- [ ] **Step 6: Run the test to verify it PASSES**

Run: `npm run test:api`
Expected: PASS — every layer returns a non-empty GeoJSON FeatureCollection over WFS.

- [ ] **Step 7: Manual spot-check (optional but recommended)**

```bash
curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:dams&outputFormat=application/json&count=1" | head -c 300
```
Expected: a GeoJSON `FeatureCollection` with one dam feature and its mapped properties.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(geoserver): publish water layers as WFS via REST (config-as-code)"
```

---

## Self-Review

**1. Spec coverage (design §5, §13 step 2–3, INV-1/INV-2/INV-4):**
- `app` schema (users, audit_log) → Task 2 ✓
- `water` seven tables with 4326 geometry + GiST + common columns + FKs → Task 3 ✓
- Seeds from existing GeoJSON + mock, idempotent → Tasks 4 ✓
- GeoServer publication as config-as-code (REST, not hand-edited, INV-2) → Task 5 ✓
- Canonical keys ↔ tables (INV-4) → mapping table + `@webatlas/shared` keys ✓
- Migrations owned by `apps/api` (design §6.5) → Task 1 establishes the workspace ✓
- **Deferred (correct, not gaps):** `updated_at` triggers and RBAC-enforced writes belong to Plan 5; auth logic to Plan 4; frontend WFS swap to Plan 3.

**2. Placeholder scan:** No TBD/TODO; full SQL, seed code, GeoJSON, and REST bodies are provided. ✓

**3. Type/name consistency:** Column names in the migration (`wattage_mw`, `annual_output`, `stream_order`, `length_m`, `station_type`, `hazard_type`, `risk_level`, `survey_date`, `flow_rate`) match exactly the keys returned by `registry.ts` `columns()` mappers and the mapping table. Table list is identical across Task 3, `registry.ts`, `publish.ts`, and both test files (seven names, same spelling). `external_id` is the conflict target in both the migration (unique index) and the seed upsert. ✓

**4. Known risks flagged for the implementer:**
- The mock `flood_zones`/`flood_generation` source geometry is `Polygon`; the seed wraps it via `ST_Multi` to satisfy the `MultiPolygon` column — verify no feature is already a `MultiPolygon` (none are, per the mock).
- `annual_output`/`year_*` mapping for dams is a best-effort interpretation of the source keys `Quantity_(`, `Year_of_la`, `Year_of_op`; if a value is non-numeric where a numeric column is declared, the seed will error — the implementer should report such rows rather than silently coercing.

---

## Follow-on

- **Plan 3** — point the frontend thematic layers at these WFS endpoints and refactor to MVP/FSD. Note (carried from Plan 1 final review): frontend layer IDs (`layer_dams`, `layer_flood`, `layer_drought_survey`, …) do **not** map 1:1 to these table/layer keys — Plan 3 must introduce an explicit `layerId → webatlas:<table>` mapping.
