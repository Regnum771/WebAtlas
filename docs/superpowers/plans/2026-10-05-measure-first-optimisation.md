# Measure-First Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the measured slow spots: water layers as API vector tiles, a seeded tile cache after builds, a fast "river + radius" area, faster test suites, and a basemap rebuild that never stalls tiles.

**Architecture:** A new API module serves Mapbox Vector Tiles (PostGIS `ST_AsMVT`) for rivers, lakes and the far-zoom river layer, keyed by the layer's active version so browsers cache them for good. The web app draws those three layers as OpenLayers `VectorTileLayer`s. The atlas-data build seeds GeoServer's tile cache after it truncates it. The ROI resolver simplifies before buffering and reads a stored working region. The basemap loader swaps tables in with a rename.

**Tech Stack:** Fastify + `pg` (apps/api), PostGIS 3.4, node-pg-migrate (`.cjs`), OpenLayers 10 (`ol/layer/VectorTile`, `ol/source/VectorTile`, `ol/format/MVT`), React 19, Vitest, bash + curl (GeoServer REST), Python 3 / geopandas (atlas-tools image), puppeteer-core (measurement only).

**Spec:** `docs/superpowers/specs/2026-10-05-measure-first-optimisation-design.md`

## Global Constraints

- Tile endpoint: `GET /api/tiles/:layer/:z/:x/:y` where `:y` is `<number>.pbf`; `:layer` ∈ {`rivers`, `lakes`, `rivers_overview`}, anything else 404; `z` > 16 or `x`/`y` outside `0 … 2^z−1` → 400; empty tile → 204 with no body.
- `GET /api/tiles/versions` → `{ "rivers": "<uuid>", "lakes": "<uuid>" }` (active version ids). Tile URLs carry `?v=<versionId>`; `rivers_overview` uses the `rivers` version.
- Tile response with `v` equal to the active version: `Cache-Control: public, max-age=31536000, immutable`; stale or missing `v`: `Cache-Control: no-cache`. Content type `application/vnd.mapbox-vector-tile`.
- Tile features carry the same properties the web app reads today: for `rivers` and `lakes` the ISO names from `LAYER_ATTRIBUTE_MAP` (`@webatlas/shared`) plus `id` (uuid text) and `layerKey`; for `rivers_overview` the view's own columns (`name_key`, `name`, `stream_order`).
- `dams` and the five small thematic layers stay on WFS.
- A tile geometry is never edited: selecting a river or lake fetches the full geometry from `GET /api/features/:layerKey/:id/geometry` first.
- Tile-cache seed: working region 106.5–110.0 E, 10.5–16.6 N; basemap groups `basemap`, `basemap_roads`, `bm_water`, `bm_landuse`, `bm_railways` at zooms 5–12; contours `contours_250` zooms 5–8, `contours_100` 9–10, `contours_50` 11–12 (the app's `contourIntervalFor`: < 9 → 250, < 11 → 100, else 50); gridset `EPSG:900913`, format `image/png`, two threads, background (the build never waits).
- ROI buffer: simplify the source by 1 % of the radius before `ST_Buffer`; source-complexity guards apply to the original source.
- Working region: materialised view `admin.working_region` (one row, `g geometry`), the union of provinces `48, 51, 52, 56, 66, 68` (`REGION_PROVINCE_CODES`).
- Never print `DATABASE_URL` or any password. Non-browser HTTP clients use `127.0.0.1`, not `localhost` (Windows resolves `localhost` to IPv6 first; the API listens on IPv4).
- Code comments in English; translate Vietnamese comments in any file you edit. User-facing strings stay as they are.
- Commit messages: Vietnamese Conventional Commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `perf/measure-first` (exists, holds the spec commit).

## File Structure

| File | Responsibility |
|---|---|
| `tools/perf/README.md`, `tools/perf/wfs.py`, `tools/perf/tiles.py`, `tools/perf/api.py`, `tools/perf/page.mjs` (new) | The measurement method, committed so before/after are comparable |
| `apps/api/src/modules/tiles/{routes,controller,repository}.ts`, `tiles.test.ts` (new) | Vector tiles and active versions |
| `apps/api/src/server.ts` | Registers the tiles routes |
| `apps/web/src/features/map/model/waterTiles.ts`, `waterTiles.test.ts` (new) | Vector-tile layers for rivers, lakes, overview; version-keyed URLs |
| `apps/web/src/features/map/model/MapModel.ts` | Uses the tile layers; drops the water zoom gate; refresh by version |
| `apps/web/src/features/map/model/SelectController.ts` (+ test) | Selecting a tile feature fetches its full geometry |
| `apps/web/src/features/map/model/riverOverview.ts` | Loses its WFS source factory |
| `packages/atlas-data/tools/lib/geoserver.sh`, `tools/basemap/publish-basemap.sh`, `tools/contours/publish-contours.sh`, `src/descriptors/{basemap,contours}.ts` | Seed after truncate |
| `apps/api/src/db/migrations/1000000000023_working-region.cjs` (new), `apps/api/src/modules/analysis/area.ts`, `apps/api/src/modules/roi/resolve.ts`, `packages/atlas-data/src/stages/loadGeojson.ts` | Fast river + radius |
| `packages/versioning/src/riverHierarchy.test.ts`, `apps/api/vitest.config.ts` and what profiling points to | Test speed |
| `packages/atlas-data/tools/basemap/load_basemap.py`, `test_load_basemap.py` | Load into `__new`, swap with a rename |

---

### Task 1: Commit the measurement method

**Files:**
- Create: `tools/perf/README.md`, `tools/perf/wfs.py`, `tools/perf/tiles.py`, `tools/perf/api.py`, `tools/perf/page.mjs`

**Interfaces:** Produces the four scripts later tasks and Task 8 run.

- [ ] **Step 1: Copy the scripts used for the spec's measurements**

The controller's scratchpad holds the exact scripts behind the spec's numbers: `measure_wfs.py`, `measure_tiles.py`, `measure_api.py`, `measure_page.mjs` in `C:\Users\quock\AppData\Local\Temp\claude\c--Users-quock-Documents-Projects-webatlas\4931fec2-1f8f-4e5d-8b3e-9993255194b1\scratchpad\`. Copy them to `tools/perf/` as `wfs.py`, `tiles.py`, `api.py`, `page.mjs`, then:
- in every script, read the base URLs from environment variables with these defaults: `WEBATLAS_GEOSERVER` = `http://127.0.0.1:8080/geoserver`, `WEBATLAS_API` = `http://127.0.0.1:3001/api`, `WEBATLAS_WEB` = `http://127.0.0.1:4173/`;
- in `api.py`, look the three feature ids up at start instead of hard-coding them: run `docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "<query>"` through `subprocess` (with `MSYS_NO_PATHCONV=1` in the env) for `SELECT id FROM water.dams_active WHERE geom IS NOT NULL ORDER BY external_id LIMIT 1`, the longest level-1 river (`ORDER BY ST_Length(geom::geography) DESC LIMIT 1`), the largest lake (`ORDER BY area_km2 DESC NULLS LAST LIMIT 1`), and the biggest roads reference entity (`basemap.reference_entities WHERE layer_key='roads' ORDER BY member_count DESC LIMIT 1`);
- in `page.mjs`, keep the `createRequire('<repo>/package.json')` trick, but derive the repo path from `import.meta.url` (`new URL('../../package.json', import.meta.url)`);
- give each script a module docstring/comment saying what it measures and how to read its columns.

- [ ] **Step 2: Write `tools/perf/README.md`**

It describes how to run each script on the dev stack:
- API: `npm run dev -w @webatlas/api`.
- Web, production build: `npm run build -w @webatlas/web` then `cd apps/web && npx vite preview --host 127.0.0.1 --port 4173`.
- `python3 tools/perf/wfs.py`, `python3 tools/perf/tiles.py`, `python3 tools/perf/api.py`, `node tools/perf/page.mjs`.

It also covers the `127.0.0.1` rule and why. Finally it reproduces the spec's "Why" table as the baseline (2026-10-05).

- [ ] **Step 3: Run each script once against the dev stack and check that the output columns match the README.** Expected: numbers in the same range as the spec's table (the water layers are still WFS at this point).

- [ ] **Step 4: Commit**

```bash
git add tools/perf
git commit -F - <<'EOF'
chore(perf): công cụ đo trước/sau cho nhóm tối ưu (WFS, tile, API, tải trang)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Vector tiles from the API

**Files:**
- Create: `apps/api/src/modules/tiles/repository.ts`, `apps/api/src/modules/tiles/controller.ts`, `apps/api/src/modules/tiles/routes.ts`, `apps/api/src/modules/tiles/tiles.test.ts`
- Modify: `apps/api/src/server.ts` (register `tilesRoutes` with prefix `/api`, next to the other modules)

**Interfaces:**
- Produces: `GET /api/tiles/versions` → `{ rivers: string, lakes: string }`; `GET /api/tiles/:layer/:z/:x/:y` (`:y` = `<n>.pbf`), as in Global Constraints.
- `repository.ts` exports `TILE_LAYERS = ['rivers', 'lakes', 'rivers_overview'] as const`, `type TileLayer`, `tileSql(layer: TileLayer): string`, `activeVersions(db): Promise<{ rivers: string | null; lakes: string | null }>`.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/modules/tiles/tiles.test.ts`)

Use the API test conventions (`buildServer` + `app.inject`, as in `apps/api/src/modules/analysis/analysis.test.ts`; look at its first 40 lines for the setup and teardown). Decode tiles with `@mapbox/vector-tile` + `pbf` if they are already in node_modules (`ls node_modules/@mapbox/vector-tile node_modules/pbf`); otherwise add them as **devDependencies of apps/api** (`npm i -D @mapbox/vector-tile pbf -w @webatlas/api`).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { buildServer } from '../../server';
import { getPool, closePool } from '../../db/pool';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
beforeAll(async () => { app = await buildServer(); await app.ready(); });
afterAll(async () => { await app.close(); await closePool(); });

// Buon Ma Thuot at zoom 12 holds rivers and lakes; zoom 7 tile 102/59 covers it (both computed from 108.05 E, 12.68 N).
const BMT = { z: 12, x: 3277, y: 1902 };
const versions = async () => (await app.inject({ method: 'GET', url: '/api/tiles/versions' })).json();
const tile = (layer: string, z: number, x: number, y: number, v?: string) =>
  app.inject({ method: 'GET', url: `/api/tiles/${layer}/${z}/${x}/${y}.pbf${v ? `?v=${v}` : ''}` });
const decode = (body: Buffer, layer: string) => new VectorTile(new Pbf(body)).layers[layer];

describe('GET /api/tiles/versions', () => {
  it('returns the active version ids of rivers and lakes', async () => {
    const { rows } = await getPool().query<{ layer_key: string; id: string }>(
      `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers','lakes')`);
    const want = Object.fromEntries(rows.map((r) => [r.layer_key, r.id]));
    expect(await versions()).toEqual(want);
  });
});

describe('GET /api/tiles/:layer/:z/:x/:y.pbf', () => {
  it('serves rivers with the ISO properties, id and layerKey, cached for good at the active version', async () => {
    const v = (await versions()).rivers;
    const res = await tile('rivers', BMT.z, BMT.x, BMT.y, v);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const layer = decode(res.rawPayload, 'rivers');
    expect(layer.length).toBeGreaterThan(0);
    const props = layer.feature(0).properties;
    expect(props.layerKey).toBe('rivers');
    expect(typeof props.id).toBe('string');
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['localId', 'geographicalName', 'streamOrder']));
  });

  it('serves lakes the same way', async () => {
    const v = (await versions()).lakes;
    const res = await tile('lakes', BMT.z, BMT.x, BMT.y, v);
    expect(res.statusCode).toBe(200);
    const props = decode(res.rawPayload, 'lakes').feature(0).properties;
    expect(props.layerKey).toBe('lakes');
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['localId', 'geographicalName', 'area']));
  });

  it('serves the far-zoom river layer with the view columns', async () => {
    const res = await tile('rivers_overview', 7, 102, 59);
    expect(res.statusCode).toBe(200);
    const props = decode(res.rawPayload, 'rivers_overview').feature(0).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['name_key', 'stream_order']));
  });

  it('does not let a stale or missing version be cached', async () => {
    expect((await tile('rivers', BMT.z, BMT.x, BMT.y)).headers['cache-control']).toBe('no-cache');
    expect((await tile('rivers', BMT.z, BMT.x, BMT.y, '00000000-0000-0000-0000-000000000000')).headers['cache-control']).toBe('no-cache');
  });

  it('answers 204 for a tile with nothing in it', async () => {
    const res = await tile('lakes', 12, 0, 0);
    expect(res.statusCode).toBe(204);
    expect(res.rawPayload.length).toBe(0);
  });

  it('refuses unknown layers and impossible coordinates', async () => {
    expect((await tile('dams', 7, 102, 59)).statusCode).toBe(404);
    expect((await tile('rivers', 17, 0, 0)).statusCode).toBe(400);
    expect((await tile('rivers', 3, 8, 0)).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tiles/rivers/7/102/59.png' })).statusCode).toBe(400);
  });

  it('is not throttled by the global 100/min limit: a map view requests tiles in bursts', async () => {
    const codes = await Promise.all(Array.from({ length: 150 }, () => tile('rivers_overview', 7, 102, 59)));
    expect(codes.every((r) => r.statusCode === 200)).toBe(true);
  });
});
```

Check the coordinates before relying on them: `BMT` must be the zoom-12 tile containing 108.05 E, 12.68 N (x = floor((lon+180)/360·2^z), y = floor((1 − asinh(tan(lat))/π)/2·2^z)), and 7/102/59 must contain it. Fix the constants if the formula gives other values.

- [ ] **Step 2: Run them and see them fail.** Run `cd apps/api && npx vitest run src/modules/tiles/tiles.test.ts`. Expected: FAIL, with 404 on every route.

- [ ] **Step 3: Write `repository.ts`**

```ts
import type { Pool } from 'pg';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

export const TILE_LAYERS = ['rivers', 'lakes', 'rivers_overview'] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];

/** Where each tile layer's rows come from: the active-state views (S1), so the partial indexes serve the tile envelope. */
const SOURCE: Record<TileLayer, string> = {
  rivers: 'water.rivers_detail',
  lakes: 'water.lakes_active',
  rivers_overview: 'water.rivers_overview',
};

/** The properties each tile feature carries: what the web app's styles, popups and ROI candidates read. */
function propertiesSql(layer: TileLayer): string {
  if (layer === 'rivers_overview') return 't.name_key, t.name, t.stream_order';
  const iso = Object.entries(LAYER_ATTRIBUTE_MAP[layer].attributes).map(([db, name]) => `t.${db} AS "${name}"`);
  return [`t.id::text AS id`, `'${layer}'::text AS "layerKey"`, ...iso].join(', ');
}

/**
 * One tile: $1 z, $2 x, $3 y. ST_AsMVTGeom clips to the tile (64-unit buffer, so line joins and
 * polygon edges do not show seams) and simplifies to its 4096-unit grid. The bounding-box test is
 * on the stored 4326 geometry, so the views' partial GiST index (migration 22) serves it.
 */
export function tileSql(layer: TileLayer): string {
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    features AS (
      SELECT ST_AsMVTGeom(ST_Transform(t.geom, 3857), bounds.b, 4096, 64, true) AS geom, ${propertiesSql(layer)}
        FROM ${SOURCE[layer]} t, bounds
       WHERE t.geom && ST_Transform(bounds.b, 4326)
    )
    SELECT ST_AsMVT(features.*, '${layer}', 4096, 'geom') AS tile FROM features WHERE geom IS NOT NULL`;
}

export async function activeVersions(db: Pool): Promise<{ rivers: string | null; lakes: string | null }> {
  const { rows } = await db.query<{ layer_key: 'rivers' | 'lakes'; id: string }>(
    `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers', 'lakes')`
  );
  const out = { rivers: null as string | null, lakes: null as string | null };
  for (const r of rows) out[r.layer_key] = r.id;
  return out;
}
```

- [ ] **Step 4: Write `controller.ts` and `routes.ts`**

`controller.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { activeVersions, tileSql, TILE_LAYERS, type TileLayer } from './repository';

const MAX_ZOOM = 16;

export async function versions(req: FastifyRequest, reply: FastifyReply) {
  reply.header('Cache-Control', 'no-cache').send(await activeVersions(req.server.pg));
}

export async function tile(req: FastifyRequest, reply: FastifyReply) {
  const p = req.params as { layer: string; z: string; x: string; y: string };
  if (!(TILE_LAYERS as readonly string[]).includes(p.layer)) {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No tile layer "${p.layer}"` } });
  }
  const layer = p.layer as TileLayer;
  const yMatch = /^(\d+)\.pbf$/.exec(p.y);
  const z = Number(p.z), x = Number(p.x), y = yMatch ? Number(yMatch[1]) : NaN;
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > MAX_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tile coordinates' } });
  }
  // A tile is immutable at a given active version: a URL that names it is cached for good, and the
  // next activation changes the version, so the next URL is new. Anything else must be revalidated.
  const wanted = (req.query as { v?: string }).v;
  const active = await activeVersions(req.server.pg);
  const current = active[layer === 'lakes' ? 'lakes' : 'rivers'];
  const cacheable = wanted !== undefined && wanted === current;
  const { rows } = await req.server.pg.query<{ tile: Buffer | null }>(tileSql(layer), [z, x, y]);
  const body = rows[0]?.tile;
  reply.header('Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (!body || body.length === 0) return reply.code(204).send();
  return reply.header('Content-Type', 'application/vnd.mapbox-vector-tile').send(body);
}
```

`routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { tile, versions } from './controller';

/**
 * Public, like the WFS they replace. Tiles get their own ceiling: one map view requests dozens at
 * once, and the global 100/min limit (plugins/security.ts) would starve the map.
 */
export default async function tilesRoutes(app: FastifyInstance) {
  app.get('/tiles/versions', versions);
  app.get('/tiles/:layer/:z/:x/:y', { config: { rateLimit: { max: 6000, timeWindow: '1 minute' } } }, tile);
}
```

Register in `apps/api/src/server.ts`: `import tilesRoutes from './modules/tiles/routes';` and `app.register(tilesRoutes, { prefix: '/api' });` next to `elevationRoutes`. Check how `req.server.pg` is typed in this codebase (`apps/api/src/types/fastify.d.ts`) and how other controllers read the pool; follow that.

- [ ] **Step 5: Run the tests.** Run `cd apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run src/modules/tiles/tiles.test.ts`. Expected: tsc clean, 8 PASS. Then time one tile from the shell: `curl -s -o /dev/null -w "%{time_total}\n" "http://127.0.0.1:3001/api/tiles/rivers_overview/7/102/59.pbf"` with the API running. Expected: under 0.1 s, the spec's criterion for the far-zoom layer.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/tiles apps/api/src/server.ts apps/api/package.json package-lock.json
git commit -F - <<'EOF'
feat(api): tile vector cho sông, hồ và sông tổng quan, khoá theo phiên bản đang hoạt động

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The web app draws the water layers from tiles

**Files:**
- Create: `apps/web/src/features/map/model/waterTiles.ts`, `apps/web/src/features/map/model/waterTiles.test.ts`
- Modify: `apps/web/src/features/map/model/MapModel.ts`, `apps/web/src/features/map/model/SelectController.ts` (+ its test if one exists, otherwise create `SelectController.test.ts`), `apps/web/src/features/map/model/riverOverview.ts`, and any test that referenced the removed water zoom gate or `createRiverOverviewSource`

**Interfaces:**
- Consumes: Task 2's endpoints.
- Produces:
  - `createWaterTileLayer(layer: WaterTileLayer, stateId: string, style: StyleLike | StyleFunction): VectorTileLayer`;
  - `waterTileUrl(layer: WaterTileLayer, version: string | null): string`;
  - `fetchWaterVersions(): Promise<{ rivers: string | null; lakes: string | null }>`;
  - `applyWaterVersions(layers: Partial<Record<WaterTileLayer, VectorTileLayer>>, v: { rivers: string | null; lakes: string | null }): void`;
  - with `type WaterTileLayer = 'rivers' | 'lakes' | 'rivers_overview'`.

- [ ] **Step 1: Failing tests for `waterTiles.ts`** (`waterTiles.test.ts`, Vitest + jsdom as the other map-model tests use)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyWaterVersions, createWaterTileLayer, fetchWaterVersions, waterTileUrl } from './waterTiles';
import { API_BASE_URL } from '../../../shared/config';

afterEach(() => vi.unstubAllGlobals());

describe('waterTileUrl', () => {
  it('names the layer and carries the version so the browser can cache the tile for good', () => {
    expect(waterTileUrl('rivers', 'abc')).toBe(`${API_BASE_URL}/api/tiles/rivers/{z}/{x}/{y}.pbf?v=abc`);
    expect(waterTileUrl('lakes', null)).toBe(`${API_BASE_URL}/api/tiles/lakes/{z}/{x}/{y}.pbf`);
  });
});

describe('applyWaterVersions', () => {
  it('points rivers and the overview at the rivers version, lakes at the lakes version', () => {
    const rivers = createWaterTileLayer('rivers', 'layer_rivers', () => undefined);
    const overview = createWaterTileLayer('rivers_overview', 'layer_rivers_overview', () => undefined);
    const lakes = createWaterTileLayer('lakes', 'layer_lakes', () => undefined);
    applyWaterVersions({ rivers, rivers_overview: overview, lakes }, { rivers: 'r1', lakes: 'l1' });
    expect(rivers.getSource()!.getUrls()).toEqual([waterTileUrl('rivers', 'r1')]);
    expect(overview.getSource()!.getUrls()).toEqual([waterTileUrl('rivers_overview', 'r1')]);
    expect(lakes.getSource()!.getUrls()).toEqual([waterTileUrl('lakes', 'l1')]);
  });

  it('leaves a layer alone when its version did not change, so nothing reloads', () => {
    const lakes = createWaterTileLayer('lakes', 'layer_lakes', () => undefined);
    applyWaterVersions({ lakes }, { rivers: null, lakes: 'l1' });
    const setUrl = vi.spyOn(lakes.getSource()!, 'setUrl');
    applyWaterVersions({ lakes }, { rivers: null, lakes: 'l1' });
    expect(setUrl).not.toHaveBeenCalled();
  });
});

describe('fetchWaterVersions', () => {
  it('reads /api/tiles/versions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rivers: 'r1', lakes: 'l1' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchWaterVersions()).toEqual({ rivers: 'r1', lakes: 'l1' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE_URL}/api/tiles/versions`);
  });
});
```

Check the exported name of the API base URL in `apps/web/src/shared/config.ts` (line 4–5) and use it. The tests assume `API_BASE_URL`.

- [ ] **Step 2: Run them and see them fail** (`cd apps/web && npx vitest run src/features/map/model/waterTiles.test.ts`: module not found).

- [ ] **Step 3: Write `waterTiles.ts`**

```ts
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import type { StyleFunction, StyleLike } from 'ol/style/Style';
import { API_BASE_URL } from '../../../shared/config';
import { apiRequest } from '../../../shared/api/apiClient';

export type WaterTileLayer = 'rivers' | 'lakes' | 'rivers_overview';
type Versions = { rivers: string | null; lakes: string | null };

/** The rivers version also keys the overview: both are drawn from the rivers layer's active version. */
const VERSION_OF: Record<WaterTileLayer, keyof Versions> = { rivers: 'rivers', rivers_overview: 'rivers', lakes: 'lakes' };

export function waterTileUrl(layer: WaterTileLayer, version: string | null): string {
  const base = `${API_BASE_URL}/api/tiles/${layer}/{z}/{x}/{y}.pbf`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/**
 * A water layer drawn from the API's vector tiles (spec §1). Tiles hold clipped, simplified
 * geometry for drawing only: editing fetches the full geometry (SelectController).
 * renderMode 'hybrid' keeps hit detection exact for popups and selection.
 */
export function createWaterTileLayer(layer: WaterTileLayer, stateId: string, style: StyleLike | StyleFunction): VectorTileLayer {
  return new VectorTileLayer({
    source: new VectorTileSource({ format: new MVT(), url: waterTileUrl(layer, null), maxZoom: 16 }),
    style,
    renderMode: 'hybrid',
    declutter: false,
    properties: { id: stateId, waterTileLayer: layer },
  });
}

export async function fetchWaterVersions(): Promise<Versions> {
  return apiRequest<Versions>('/api/tiles/versions');
}

/** Point each layer at its active version; a layer whose URL would not change is not touched (no reload). */
export function applyWaterVersions(layers: Partial<Record<WaterTileLayer, VectorTileLayer>>, v: Versions): void {
  for (const [name, layer] of Object.entries(layers) as Array<[WaterTileLayer, VectorTileLayer | undefined]>) {
    const source = layer?.getSource();
    if (!source) continue;
    const url = waterTileUrl(name, v[VERSION_OF[name]]);
    if (source.getUrls()?.[0] !== url) source.setUrl(url);
  }
}
```

`apiRequest` sends JSON auth headers. If its signature differs from `apiRequest<T>(path)` (see `apiClient.ts`), adapt the call, not the test.

- [ ] **Step 4: Use the tile layers in `MapModel.ts`**

- Replace the WFS rivers layer, the overview WFS layer and the `mkWfs('layer_lakes', …)` lakes layer with `createWaterTileLayer('rivers', 'layer_rivers', riversStyle)`, `createWaterTileLayer('rivers_overview', 'layer_rivers_overview', riversStyle)` (still `visible: false` at start, still not in `this.layers`, kept in `this.riversOverviewLayer`), and `createWaterTileLayer('lakes', 'layer_lakes', lakesStyle)`.
- Remove the water zoom gate (`this.waterGate`, `createBboxLoadGate(WATER_MIN_ZOOM, …)` and its uses). Tiles load only what is visible. Keep the `zoomVisible = currentZoom >= WATER_MIN_ZOOM` rule in `recomputeVisibility` (it is also what the legend reads). Remove `WATER_MIN_ZOOM` imports only if nothing else uses them.
- Widen the `layers` record type to include `VectorTileLayer`, and `riversOverviewLayer`'s type likewise.
- After the map is created, call `fetchWaterVersions().then((v) => applyWaterVersions({ rivers, rivers_overview: overview, lakes }, v)).catch(() => {})` (a failed fetch leaves the unversioned URLs, which still work, uncached).
- `refreshLayer(layerStateId)`: for `layer_rivers` or `layer_lakes`, re-fetch the versions and apply them (the edit just committed changed the version), instead of `source.refresh()`. `pendingRefresh` is no longer needed for these two layers.
- Keep everything else (dams and the small layers stay WFS).

- [ ] **Step 5: Selection fetches the full geometry (`SelectController.ts`)**

The `Select` interaction does not select tile features. Keep it for the WFS layers, and add a click path for the tile layers:
- In `activate`, also listen for `singleclick` on the map. Use `map.forEachFeatureAtPixel(evt.pixel, cb, { layerFilter: (l) => l.get('waterTileLayer') && l.get('waterTileLayer') !== 'rivers_overview' && editableIds.has(l.get('id')) })` and take the first feature.
- Read `id` and `layerKey` from its properties. Fetch the geometry with the same call search uses, `apiRequest(\`/api/features/${layerKey}/${encodeURIComponent(id)}/geometry\`)` (see `features/search/api/search.api.ts:53` for the exact response shape, and reuse that function if it is exported).
- Then call `onSelect({ layerKey, featureId: id, geometry, isoProps })`, with `isoProps` the tile feature's properties minus `geometry`.
- Remove the listener in `deactivate`.
- A click whose fetch fails selects nothing. Log the error with `console.warn`, as the file does elsewhere.

Test (`SelectController.test.ts`): with a fake map whose `forEachFeatureAtPixel` yields a feature with properties `{ id: 'u1', layerKey: 'rivers', geographicalName: 'X' }`, and `fetch` stubbed to return a LineString, a `singleclick` calls `onSelect` with `featureId: 'u1'`, `layerKey: 'rivers'` and **the fetched geometry, not the tile's**. A failing fetch calls nothing.

- [ ] **Step 6: Clean up**

`riverOverview.ts` loses `createRiverOverviewSource` (and its imports); keep `RIVER_OVERVIEW_MAX_ZOOM` and `riverOverviewVisibleAt`. Snapping (`drawAids.ts` `snapSourcesOf`) only takes `VectorLayer`s, so rivers and lakes are no longer snap targets. Their tile geometry is simplified and would snap to the wrong place. Record this in the commit message as a deliberate consequence. Update or remove tests that referenced the removed gate or source factory; keep their intent where it still applies (e.g. the overview/full handoff at 8.5).

- [ ] **Step 7: Run the web checks.** Run `cd apps/web && npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/features/map && npm run build`. Expected: clean, all PASS, build OK. Then, with the API and a preview server running (README in `tools/perf`), run `node tools/perf/page.mjs`. Expected: the zoom 7 → 11 session settles in under 2 s, rivers and lakes appear as `api` requests, there are no `wfs(geoserver)` requests for rivers, lakes or the overview, and no long task over 100 ms. Record the numbers for Task 8.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -F - <<'EOF'
feat(web): sông, hồ và sông tổng quan vẽ từ tile vector của API; chọn để sửa thì tải hình học đầy đủ

Lớp sông/hồ không còn là đích bám dính khi vẽ: hình học trong tile đã đơn giản hoá.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Seed the tile cache after each build

**Files:**
- Modify: `packages/atlas-data/tools/lib/geoserver.sh` (add `gs_seed_region`), `packages/atlas-data/tools/basemap/publish-basemap.sh` (mode `seed`), `packages/atlas-data/tools/contours/publish-contours.sh` (mode `seed`), `packages/atlas-data/src/descriptors/basemap.ts` and `contours.ts` (a final `run` stage each), `packages/atlas-data/src/descriptors/descriptors.test.ts`
- Test: the bash tests that already exercise these scripts with a fake curl (find them: `grep -rln "publish-basemap.sh\|publish-contours.sh" packages/atlas-data/src packages/atlas-data/tools`) and extend them

**Interfaces:**
- Produces: `gs_seed_region <layer> <zoomStart> <zoomStop>`, which POSTs one seed request; `publish-basemap.sh seed`; `publish-contours.sh seed`.

- [ ] **Step 1: Failing tests**

Extend the existing fake-curl script tests:
- `publish-basemap.sh seed` makes exactly five POSTs to `$GEOSERVER_URL/gwc/rest/seed/webatlas:<group>.json`, one per group (`basemap`, `basemap_roads`, `bm_water`, `bm_landuse`, `bm_railways`). Each body has `"type":"seed"`, `"gridSetId":"EPSG:900913"`, `"format":"image/png"`, `"zoomStart":5`, `"zoomStop":12`, `"threadCount":2`, and bounds `[11855526,1175453,12245144,1874312]` (`"coords":{"double":[...]}`, the EPSG:3857 extent of 106.5–110.0 E / 10.5–16.6 N; compute and paste the exact rounded values).
- `publish-contours.sh seed` makes three: `contours_250` zooms 5–8, `contours_100` zooms 9–10, `contours_50` zooms 11–12.
- A non-2xx from GeoServer fails the script, as `require_2xx` does elsewhere.
- No password appears in argv (the existing helper takes it from the environment).

In `descriptors.test.ts`, assert that the last stage of `basemap` is `bash packages/atlas-data/tools/basemap/publish-basemap.sh seed` and the last stage of `contours` is `bash packages/atlas-data/tools/contours/publish-contours.sh seed`.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement**

`tools/lib/geoserver.sh`:

```bash
# EPSG:3857 extent of the six working provinces (106.5-110.0 E, 10.5-16.6 N), for GWC seeding.
REGION_BOUNDS_3857='[11855526,1175453,12245144,1874312]'

# Start GeoServer seeding one cached layer over the working region, in the background (GWC runs
# the task; this returns at once). Usage: gs_seed_region <layer> <zoomStart> <zoomStop>
gs_seed_region() {
  local layer="$1" z0="$2" z1="$3"
  require_2xx "seed $layer" "$(gs_curl -XPOST -H "Content-Type: application/json" \
    "$GEOSERVER_URL/gwc/rest/seed/$WS:$layer.json" \
    -d "{\"seedRequest\":{\"name\":\"$WS:$layer\",\"bounds\":{\"coords\":{\"double\":$REGION_BOUNDS_3857}},\"srs\":{\"number\":3857},\"gridSetId\":\"EPSG:900913\",\"zoomStart\":$z0,\"zoomStop\":$z1,\"format\":\"image/png\",\"type\":\"seed\",\"threadCount\":2}}")"
}
```

Check how `WS` and `gs_curl`/`require_2xx` are defined in that file and match them. The extent is computed from the region corners with the spherical Mercator formula.

`publish-basemap.sh`: accept `seed` as a third mode (update the usage text and header comment). It seeds every group in the script's group list at zooms 5–12 and does nothing else. `publish-contours.sh`: accept an optional first argument `seed`. Without it, behave as today. With it, seed the three intervals with their zoom ranges and exit. Header comments explain why seeding is separate from truncation and that the build does not wait.

`descriptors/basemap.ts` and `contours.ts`: append a stage that mirrors the existing ones:

```ts
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/basemap/publish-basemap.sh', 'seed'],
      produces: 'GeoWebCache seed tasks for the five basemap groups over the working region, zooms 5-12 (run in the background)',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
```

Do the same for contours, with its script and a `produces` naming the three layers and their zooms. Check whether the `group` stage in `basemap.ts` has `promoteTo`/`promoteBy` and follow the file's pattern exactly.

- [ ] **Step 4: Run.** Run `cd packages/atlas-data && npx tsc -p tsconfig.json --noEmit && npm test`. Expected: PASS. Then, live on the dev stack:
  1. Run `npm run atlas:build -- --only basemap` (only the new stage runs; the rest is up to date).
  2. Watch `curl -s -u <admin from infra/.env, read without printing> http://127.0.0.1:8080/geoserver/gwc/rest/seed.json` until the task list is empty.
  3. Run `python3 tools/perf/tiles.py`. Expected: zooms 9 and 11 all cache hits.

  Record how long seeding took.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data
git commit -F - <<'EOF'
feat(atlas-data): gieo bộ đệm tile cho vùng công tác sau mỗi lần dựng bản đồ nền và đường đồng mức

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: River + radius in under 0.35 s

**Files:**
- Create: `apps/api/src/db/migrations/1000000000023_working-region.cjs`
- Modify: `apps/api/src/modules/analysis/area.ts` (`REGION_SQL`), `apps/api/src/modules/roi/resolve.ts`, `packages/atlas-data/src/stages/loadGeojson.ts` (`loadReplacing` refreshes the view), tests next to each

**Interfaces:**
- Produces: `admin.working_region (g geometry)`, one row, refreshed by every replacement of `admin.provinces`.

- [ ] **Step 1: Measure where the time goes.** With the API running, run `python3 tools/perf/api.py` and keep the "roi/resolve longest river +10km" and "select_within river +10km" rows as the baseline. Then time each part of the resolve query separately in `psql`, using EXPLAIN ANALYZE on the longest river id that `api.py` prints:
- the source fetch (`resolveFeature` with `simplify: false`);
- the buffer;
- the region union;
- the clip;
- `simplifiedGeoJsonSql` on the result;
- `ST_Area`/`ST_Length` on geography.

Write the numbers in the plan's Execution notes.

- [ ] **Step 2: Failing tests**
  - `apps/api/src/db/workingRegion.test.ts`: the view exists, has one row, and its geometry equals `ST_Union` of the provinces in `REGION_PROVINCE_CODES` (`ST_Equals`).
  - In `packages/atlas-data/src/stages/loadGeojson.db.test.ts`'s non-versioned test: after replacing the boundaries, `admin.working_region` is refreshed. Check with a sentinel: inside the transaction, before the load, set the view's contents stale by deleting a region province's row. After the load, `ST_Equals(g, the union)` holds.
  - In `apps/api/src/modules/roi/resolve.test.ts`: resolving the longest river + 10 km gives an area within 1 % of the unsimplified buffer's area, computed in the test with the old SQL inline.

- [ ] **Step 3: Implement**
  - Migration 23: `CREATE MATERIALIZED VIEW admin.working_region AS SELECT ST_Union(geom) AS g FROM admin.provinces WHERE code = ANY(ARRAY['48','51','52','56','66','68'])`. The comment names `REGION_PROVINCE_CODES` as the source and the test that keeps them equal. Grant `SELECT` to `webatlas_assistant` as migrations 16–20 do for new relations. `down` drops it.
  - Add a test in `apps/api/src/db/workingRegion.test.ts` asserting the migration's code list equals `REGION_PROVINCE_CODES`. Read the migration file's text and compare the codes.
  - `REGION_SQL` becomes `SELECT g FROM admin.working_region`.
  - `loadReplacing` (atlas-data): after loading, if any target is `admin.provinces` and `to_regclass('admin.working_region')` is not null, run `REFRESH MATERIALIZED VIEW admin.working_region` in the same transaction.
  - `resolve.ts`: in the `shaped` CTE, buffer `ST_SimplifyPreserveTopology(g, <tolerance>)` instead of `g`. The tolerance is `$2 * 1000 * 0.01` metres converted to degrees at the source's latitude: `($2 * 10.0) / (111320.0 * cos(radians(ST_Y(ST_Centroid(g)))))`. Leave `npoints`/`nparts` computed on the original `g`, so the guards are unchanged. Comment why 1 %.
  - Then fix the largest remaining part found in Step 1. If it is the source fetch, request the geometry already simplified by the same tolerance when a radius is given. Record what you changed and why in the Execution notes.
- [ ] **Step 4: Run.** Run `cd apps/api && npx tsc -p tsconfig.json --noEmit && npm run migrate && npx vitest run src/db/workingRegion.test.ts src/modules/roi src/modules/analysis`. Also run atlas-data `npm run test:db` (with DATABASE_URL exported as the global constraints say). Then `python3 tools/perf/api.py`. Expected: resolve under 0.35 s, select-within under 0.5 s.
- [ ] **Step 5: Commit** (`perf(api): vùng ROI quanh sông dài nhanh hơn — đơn giản hoá trước khi tạo vùng đệm, vùng công tác lưu sẵn`).

---

### Task 6: Faster test suites

**Files:** `packages/versioning/src/riverHierarchy.test.ts`, `apps/api/vitest.config.ts`, `apps/api/src/test/globalSetup.ts` and whatever the profiling in Step 1 points to.

- [ ] **Step 1: Profile.**
  - Run `cd packages/versioning && npx vitest run --reporter=verbose` and `cd apps/api && npx vitest run --reporter=verbose`, and keep the per-test times.
  - For the API, also time the global setup (wrap `ensureSeeded` in `globalSetup.ts` with a timer printed to stderr, temporarily) and look at Vitest's `transform`, `collect`, `setup` and `environment` totals at the end of the run.
  - Write the top contributors in the Execution notes.
- [ ] **Step 2: River tests.** In `riverHierarchy.test.ts`, the idempotency test ("reproduces the committed hierarchy exactly") builds twice. Build once and compare with the committed state: the builder returns the rows it superseded, and 0 superseded rows is the idempotency proof. Any other test that rebuilds what an earlier test in the same file already built shares that build through a `beforeAll`. The tests in `riverHierarchy-hook.test.ts` each test a different activation and keep their own.
- [ ] **Step 3: API start-up.** Apply what Step 1 found. Candidates, in order:
  1. If `ensureSeeded` does real work every run, verify it is the idempotent "unchanged" path and why it is slow.
  2. Exclude heavy modules from transformation where Vitest allows it (`server.deps.inline` / `deps.optimizer`).
  3. Set `pool: 'forks'` with `isolate: false` only if the suites do not rely on module isolation. Check and say so.

  Change nothing whose effect you have not measured.
- [ ] **Step 4: Run both suites twice.** Expected: versioning under 45 s, API under 70 s, everything passing. If a target cannot be met without touching the river builder or the product code, stop and report the measured numbers and why. Do not weaken tests to get there.
- [ ] **Step 5: Commit** (`test: rút ngắn thời gian chạy kiểm thử versioning và API`).

---

### Task 7: The basemap rebuild never stalls tiles

**Files:** `packages/atlas-data/tools/basemap/load_basemap.py`, `packages/atlas-data/tools/basemap/test_load_basemap.py`

- [ ] **Step 1: Failing Python checks** (`test_load_basemap.py`, same fake engine as the existing write tests):
  - every chunk is written to `<table>__new` (first `replace`, then `append`);
  - after the chunks, in the same transaction:
    - the fclass index and `ANALYZE` run on `__new`;
    - then `DROP TABLE IF EXISTS basemap."<table>"`;
    - then `ALTER TABLE basemap."<table>__new" RENAME TO "<table>"`;
    - then the renames of `__new`'s indexes to the names the old table had (`idx_<table>_geometry`, `<table>_fclass_idx`);
  - a failing chunk leaves no DROP or RENAME executed;
  - an empty layer still exits before anything is written.
- [ ] **Step 2: Run them in the tools image** (`docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools python3 packages/atlas-data/tools/basemap/test_load_basemap.py`). Expected: FAIL.
- [ ] **Step 3: Implement** in `write()`.
  - Write to `f"{table}__new"`, then add the fclass index and `ANALYZE` on it.
  - Swap: `DROP TABLE IF EXISTS` the old table (no `CASCADE`: a dependent view must fail the load loudly), rename `__new`, then rename its geometry index (geopandas names it `idx_<table>__new_geometry`; confirm in a scratch run) and the fclass index.
  - Keep the column-type widening from the deferred-list work, applied to `__new`.
  - Comment why: the old table is locked only for the rename, so tile requests for it wait milliseconds instead of the whole load (about 4 min for `roads_region`).
- [ ] **Step 4: Run** the Python checks in the tools image. Then, live: run `npm run atlas:build -- --force basemap`. During the `load_basemap.py` stage, run a loop fetching an uncached `roads_region`-backed tile (`basemap_roads` at zoom 14 near Buon Ma Thuot, a new tile each time) and record the worst wait. Expected: under 1 s. Afterwards, `npm run atlas:verify` passes 50/50. Run the fixture build check from `packages/atlas-data/fixtures/basemap/README.md` too, if the column order changed: the fixture must still rebuild byte-identical (`BASEMAP_FIXTURE_DIR=<scratch> python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build`, then `cmp` each file).
- [ ] **Step 5: Commit** (`perf(atlas-data): nạp bảng nền vào bảng tạm rồi đổi tên, không khoá tile suốt lần nạp`).

---

### Task 8: Re-measure, document, open the PR

- [ ] **Step 1: All suites.** From the repo root:
  - `npm run test:versioning`, `npm run test:api`, `npm run test:shared`, `npm run test -w @webatlas/web`;
  - atlas-data `npm test` and `npm run test:db`;
  - `npm run build -w @webatlas/web`;
  - `npm run atlas:verify`.

  Expected: all PASS, verify 50/50.
- [ ] **Step 2: Re-measure** with the four `tools/perf` scripts on the dev stack, after the seed has finished. Fill the spec's "Why" table with an "After" column in `tools/perf/README.md`, and append an `## Execution notes` section to this plan with every success criterion: met or not, and the number.
- [ ] **Step 3: Docs.**
  - In `docs/architecture/database-architecture.md` (or the map/serving doc if one exists: `grep -rln "WFS" docs/architecture docs/runbooks`), describe that rivers, lakes and the far-zoom rivers are served as vector tiles by the API, keyed by the active version.
  - In `docs/runbooks/README.md`, note that basemap and contour builds start a background tile seed.
- [ ] **Step 4: Commit, push, PR** against `main`, with a Vietnamese description: summary, the before/after table, the behaviour changes (rivers and lakes are not snap targets; tile cache seeding), and how to measure. End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Watch CI until all four jobs pass. Do not merge.
