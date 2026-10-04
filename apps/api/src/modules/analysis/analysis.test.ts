import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { buildReferenceEntities } from '../../db/referenceEntities';
import { withAnalysisTimeout } from './db';
import { demAvailable } from './dem';
import { getAnalysisPool, closeAnalysisPool } from './pool';
import { MAX_SOURCE_ENTITY_VERTICES, MAX_SOURCE_ENTITY_PARTS } from './area';
import { featuresInAdminUnitTool } from '../assistant/tools/data/featuresInAdminUnit';
import type { ToolContext } from '../assistant/tools/types';
import { LAYER_LABELS } from '../assistant/tools/data/helpers';

let app: ReturnType<typeof buildApp>;
let dam: { id: string; lon: number; lat: number };
let riverId: string;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  const pool = getPool();
  ({ rows: [dam] } = await pool.query(
    `SELECT id::text, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM water.dams_active WHERE geom IS NOT NULL LIMIT 1`
  ));
  ({ rows: [{ id: riverId }] } = await pool.query(`SELECT id::text FROM water.rivers_active LIMIT 1`));
});
afterAll(async () => {
  await app.close();
  await closeAnalysisPool();
});

const post = (op: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/analysis/${op}`, payload: payload as object });

const square = (lon: number, lat: number, d: number) => ({
  type: 'Polygon',
  coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]],
});

describe('POST /api/analysis/buffer', () => {
  it('buffers a point by 1 km to roughly π km²', async () => {
    const res = await post('buffer', { geometry: { type: 'Point', coordinates: [108.05, 12.68] }, radiusKm: 1 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.op).toBe('buffer');
    expect(body.summary['Diện tích vùng đệm (km²)']).toBeGreaterThan(3.0);
    expect(body.summary['Diện tích vùng đệm (km²)']).toBeLessThan(3.2);
    expect(body.geometries.map((g: { role: string }) => g.role)).toEqual(['result', 'input']);
    expect(body.geometries[0].geometry.type).toBe('Polygon');
  });

  it('buffers a feature reference', async () => {
    const res = await post('buffer', { feature: { layerKey: 'rivers', featureId: riverId }, radiusKm: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary['Bán kính (km)']).toBe(2);
  });

  it('rejects bad radii, both inputs at once, and coordinates outside Vietnam', async () => {
    const point = { type: 'Point', coordinates: [108.05, 12.68] };
    expect((await post('buffer', { geometry: point, radiusKm: 0 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: point, radiusKm: 101 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: point, feature: { layerKey: 'rivers', featureId: riverId }, radiusKm: 1 })).statusCode).toBe(400);
    expect((await post('buffer', { geometry: { type: 'Point', coordinates: [2.35, 48.85] }, radiusKm: 1 })).statusCode).toBe(400);
  });

  it('404s a feature reference that does not exist', async () => {
    const res = await post('buffer', { feature: { layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000' }, radiusKm: 1 });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/analysis/select_within', () => {
  it('finds the dam inside a small square around it, and draws the area as input', async () => {
    const res = await post('select_within', { roi: { source: 'drawn', geometry: square(dam.lon, dam.lat, 0.02) }, layerKeys: ['dams'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary['đập & hồ chứa']).toBeGreaterThanOrEqual(1);
    expect(body.summary['Tổng số']).toBeGreaterThanOrEqual(1);
    expect(body.rows.some((r: { featureId: string }) => r.featureId === dam.id)).toBe(true);
    expect(body.geometries[0].role).toBe('input');
  });

  it('accepts a line feature with a buffer distance', async () => {
    const res = await post('select_within', { roi: { source: 'feature', layerKey: 'rivers', featureId: riverId, radiusKm: 5 }, layerKeys: ['dams', 'lakes'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toHaveProperty('Tổng số');
  });

  it('rejects a point area without a buffer distance', async () => {
    const res = await post('select_within', { roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [dam.lon, dam.lat] } }, layerKeys: ['dams'] });
    expect(res.statusCode).toBe(400);
    const lineNoBuffer = await post('select_within', { roi: { source: 'feature', layerKey: 'rivers', featureId: riverId }, layerKeys: ['dams'] });
    expect(lineNoBuffer.statusCode).toBe(400);
  });
});

describe('POST /api/analysis/select_within over an admin unit', () => {
  const inProvince = (code: string, layerKeys: string[]) =>
    post('select_within', { roi: { source: 'admin', level: 'province', code }, layerKeys });

  it('counts by the stamped codes: the same answer as the assistant, and says so', async () => {
    const ctx = {
      pool: getPool(), collect: () => undefined, provenance: () => undefined, role: 'viewer',
      mapContext: { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' },
    } as unknown as ToolContext;
    const tool = featuresInAdminUnitTool(ctx) as unknown as { run: (i: unknown) => Promise<string> };
    for (const layerKey of ['dams', 'rivers', 'lakes'] as const) {
      const res = await inProvince('66', [layerKey]);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary['Cách đếm']).toBe('Theo mã hành chính đã gán');
      const { count } = JSON.parse(await tool.run({ layerKey, code: '66' })) as { count: number };
      expect(body.summary[LAYER_LABELS[layerKey]]).toBe(count);
    }
  }, 60_000);

  it('stays inside the budget over the largest province, all four layers', async () => {
    const started = Date.now();
    const res = await inProvince('68', ['dams', 'rivers', 'lakes', 'stations']);
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stays inside the budget over the longest river + 10 km, geometrically', async () => {
    const { rows: [river] } = await getPool().query<{ id: string }>(
      `SELECT id::text FROM water.rivers_active WHERE feature_level = 1
        ORDER BY ST_Length(geom::geography) DESC LIMIT 1`
    );
    const started = Date.now();
    const res = await post('select_within', {
      roi: { source: 'feature', layerKey: 'rivers', featureId: river.id, radiusKm: 10 },
      layerKeys: ['dams', 'rivers', 'lakes', 'stations'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary['Cách đếm']).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('analysis route', () => {
  it('400s an unknown operation', async () => {
    expect((await post('teleport', {})).statusCode).toBe(400);
  });
});

describe('POST /api/analysis/nearest', () => {
  it('returns k rows in ascending distance with connector lines', async () => {
    const res = await post('nearest', { roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] } }, layerKey: 'dams', k: 3 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(3);
    const d = body.rows.map((r: { distanceKm: number }) => r.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(body.geometries.filter((g: { role: string }) => g.role === 'result')).toHaveLength(3);
  });

  it('rejects k above 25', async () => {
    expect((await post('nearest', { roi: { source: 'drawn', geometry: { type: 'Point', coordinates: [108.05, 12.68] } }, layerKey: 'dams', k: 26 })).statusCode).toBe(400);
  });

  it('excludes the ROI itself when it is a feature of the searched layer', async () => {
    const res = await post('nearest', {
      roi: { source: 'feature', layerKey: 'dams', featureId: dam.id }, layerKey: 'dams', k: 3,
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().rows.map((r: { featureId: string }) => r.featureId);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(dam.id);
  });

  it('measures from the centroid of a line or area, and says so', async () => {
    const res = await post('nearest', {
      roi: { source: 'drawn', geometry: square(108.05, 12.68, 0.05) }, layerKey: 'dams', k: 1,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary['Tính từ']).toMatch(/^Trọng tâm của /);
    expect(body.geometries.some((g: { label?: string }) => g.label === 'Trọng tâm vùng phân tích')).toBe(true);
  });
});

describe('DEM operations', () => {
  const line = { type: 'LineString', coordinates: [[108.05, 12.68], [108.25, 12.68]] };

  it('completes a ~6 km line at the default 100 samples within the analysis timeout', async () => {
    // Regression test for the 504 ANALYSIS_TIMEOUT a ~5-6 km line at the default
    // sample count used to hit: the per-sample raster lookup did a correlated
    // subquery filtered on `ST_Intersects(rast, point)`, which isn't indexable and
    // fell back to a sequential scan of every DEM tile (~7,200 rows) for each of
    // the 100 samples. This test runs inside the real 5s statement_timeout (no
    // override), so the slow path fails it with a 504 rather than a slow pass.
    const sixKmLine = { type: 'LineString', coordinates: [[108.05, 12.68], [108.1052, 12.68]] };
    const res = await post('elevation_profile', { roi: { source: 'drawn', geometry: sixKmLine } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (!(await demAvailable(getPool()))) {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
      return;
    }
    expect(body.profile).toHaveLength(100);
    expect(body.summary['Chiều dài (km)']).toBeGreaterThan(5.9);
    expect(body.summary['Chiều dài (km)']).toBeLessThan(6.1);
    expect(body.attribution).toContain('FABDEM');
  });

  it('elevation_profile samples along the line, or reports an unloaded DEM', async () => {
    const res = await post('elevation_profile', { roi: { source: 'drawn', geometry: line }, samples: 50 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (!(await demAvailable(getPool()))) {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
      return;
    }
    expect(body.profile).toHaveLength(50);
    expect(body.summary['Chiều dài (km)']).toBeGreaterThan(21);
    expect(body.summary['Chiều dài (km)']).toBeLessThan(22.5);
    expect(body.summary['Cao nhất (m)']).toBeGreaterThan(body.summary['Thấp nhất (m)']);
    expect(body.attribution).toContain('FABDEM');
  });

  it('zonal_elevation summarises the DEM inside a polygon, or reports an unloaded DEM', async () => {
    const res = await post('zonal_elevation', { roi: { source: 'drawn', geometry: square(108.05, 12.68, 0.02) } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    if (!(await demAvailable(getPool()))) {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
      return;
    }
    expect(body.summary['Trung bình (m)']).toBeGreaterThan(300);
    expect(body.summary['Trung bình (m)']).toBeLessThan(700);
    expect(body.summary['Số điểm ảnh']).toBeGreaterThan(1000);
  });

  it('zonal_elevation refuses an area over the cap', async () => {
    const res = await post('zonal_elevation', { roi: { source: 'drawn', geometry: square(108.0, 13.0, 0.5) } });
    expect(res.statusCode).toBe(400);
  });
});

describe('withAnalysisTimeout', () => {
  it('turns a statement timeout into a 504 ANALYSIS_TIMEOUT', async () => {
    await expect(
      withAnalysisTimeout(getPool(), (db) => db.query('SELECT pg_sleep(1)'), 50)
    ).rejects.toMatchObject({ statusCode: 504, code: 'ANALYSIS_TIMEOUT' });
  });

  it('runs read-only', async () => {
    await expect(
      withAnalysisTimeout(getPool(), (db) => db.query('CREATE TEMP TABLE nope (x int)'))
    ).rejects.toMatchObject({ code: '25006' });
  });
});

// Finding: POST /api/analysis/:op is unauthenticated and each request held a
// client from the APP's own pool (max 10, no connectionTimeoutMillis) for up to
// 5s — a few parallel toolbar calls could occupy every client and hang every
// other route instead of erroring. controller.ts now runs analyses on this
// separate, small pool instead (same isolation as modules/assistant/sql/pool.ts).
describe('analysis pool', () => {
  it('is bounded well below the app pool default, with its own connection timeout', () => {
    const pool = getAnalysisPool();
    expect(pool.options.max).toBe(3);
    expect(pool.options.connectionTimeoutMillis).toBe(3000);
  });

  it('fails fast with a clean 503 instead of hanging once every client is checked out', async () => {
    const pool = getAnalysisPool();
    const max = pool.options.max!;
    const held = await Promise.all(Array.from({ length: max }, () => pool.connect()));
    try {
      const start = Date.now();
      await expect(
        withAnalysisTimeout(pool, (db) => db.query('SELECT 1'))
      ).rejects.toMatchObject({ statusCode: 503, code: 'ANALYSIS_BUSY' });
      // Must fail at roughly connectionTimeoutMillis (3s), not hang indefinitely.
      expect(Date.now() - start).toBeLessThan(pool.options.connectionTimeoutMillis! + 2000);
    } finally {
      held.forEach((c) => c.release());
    }
  });

  it('POST /api/analysis/:op returns the same clean 503 when the pool is exhausted', async () => {
    const pool = getAnalysisPool();
    const max = pool.options.max!;
    const held = await Promise.all(Array.from({ length: max }, () => pool.connect()));
    try {
      const res = await post('buffer', { geometry: { type: 'Point', coordinates: [108.05, 12.68] }, radiusKm: 1 });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ANALYSIS_BUSY');
    } finally {
      held.forEach((c) => c.release());
    }
  });
});

describe('analysis with a reference-entity ROI', () => {
  let roadEntityId: string;
  let bigRoadEntityId: string;
  let waterEntityId: string;

  beforeAll(async () => {
    await buildReferenceEntities(getPool(), ['roads', 'water']);

    // A real but modest road: a handful of members, not the hundreds-to-thousands
    // that share one ref/name on a busy highway. The busiest entities (e.g. the
    // Hoài Nhơn-Quy Nhơn expressway, 1,726 disjoint OSM segments under one name)
    // are unions of that many separately-capped LineStrings, so ST_Buffer alone
    // produces 10,000+ vertices before any clipping -- past MAX_INPUT_VERTICES
    // from a 1 km buffer alone. `ORDER BY member_count DESC` picks exactly that
    // worst case, so this orders ASC instead, over a small band that excludes both
    // single-stub segments and multi-hundred-member highways. Measured for the
    // entity this resolves to: ~48-53 vertices at a 1-2 km buffer.
    const { rows } = await getPool().query<{ entity_id: string }>(
      `SELECT entity_id FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND member_count BETWEEN 2 AND 20
        ORDER BY member_count ASC, entity_id LIMIT 1`
    );
    roadEntityId = rows[0].entity_id;

    // Đường tỉnh 699D: a single-segment (member_count = 1) ~18 km provincial road,
    // which keeps ST_Buffer cheap (no multi-part seam explosion) while still being
    // long and centrally placed enough that its 100 km buffer, clipped to the six
    // working-region provinces, genuinely exceeds MAX_ROI_AREA_KM2. Measured
    // 2026-09-22: 31,937 km² (see task-7-report.md) -- a real, honest trip of the
    // area limit, not a name/count heuristic that happened to be big enough.
    bigRoadEntityId = 'roads:82ccce28b3c34d80ee4f3e80fd438e39:1';

    // The single largest water entity by raw area (Hồ Đồng Nai 3) is a 12,242-
    // vertex polygon on its own -- over MAX_INPUT_VERTICES with no buffering at
    // all, which would make this fixture accidentally test the vertex limit
    // instead of the "no radius needed" path it's meant to cover. Filtering out
    // entities that complex before ranking by area picks a real lake that stays
    // under the ceiling.
    const water = await getPool().query<{ entity_id: string }>(
      `SELECT entity_id FROM basemap.reference_entities
        WHERE layer_key = 'water' AND ST_NPoints(geom) < 4000
        ORDER BY ST_Area(geom) DESC LIMIT 1`
    );
    waterEntityId = water.rows[0].entity_id;
  }, 300_000);

  it('buffers a road entity into an area', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 }, radiusKm: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary['Diện tích vùng đệm (km²)']).toBeGreaterThan(0);
  });

  it('uses a water polygon entity directly, with no radius', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/zonal_elevation',
      payload: { roi: { source: 'reference', referenceLayer: 'water', entityId: waterEntityId } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a line entity with no radius on an area operation, naming the radius as the reason', async () => {
    // select_within needs an area; a road with no radius resolves to a line.
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/select_within',
      payload: { roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId }, layerKeys: ['dams'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/bán kính/i);
  });

  it('buffers a line entity that has no radius of its own (Deviation 1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: { reference: { referenceLayer: 'roads', entityId: roadEntityId }, radiusKm: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('produces a real elevation profile for a line-kind reference entity (a reference on elevation_profile once 500ed)', async () => {
    // Selected dynamically by point count, not reused from roadEntityId above
    // (which was picked for the buffer-guard tests): only needs to resolve, after
    // clipping to the working region, to something safely under MAX_INPUT_VERTICES
    // so this exercises the success path.
    const { rows: [modest] } = await getPool().query<{ entity_id: string; npoints: number }>(
      `SELECT entity_id, ST_NPoints(geom) AS npoints
         FROM basemap.reference_entities
        WHERE layer_key = 'roads' AND ST_NPoints(geom) BETWEEN 5 AND 500
        ORDER BY ST_NPoints(geom) ASC LIMIT 1`
    );
    expect(modest).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/elevation_profile',
      payload: { roi: { source: 'reference', referenceLayer: 'roads', entityId: modest.entity_id }, samples: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // What comes back regardless of DEM availability is the line itself (pure PostGIS on
    // the input, see elevationProfileOp's comment on why it runs first). The length and the
    // per-sample data need a loaded DEM; without one the op says so. Until demAvailable meant
    // "has rows" this asserted the length unconditionally, which only held because an empty
    // DEM table counted as loaded.
    expect(body.geometries.length).toBeGreaterThan(0);
    if (await demAvailable(getPool())) {
      expect(body.summary['Chiều dài (km)']).toBeGreaterThan(0);
      expect(Array.isArray(body.profile)).toBe(true);
      expect(body.profile.length).toBe(10);
    } else {
      expect(body.summary['Trạng thái']).toBe('Chưa nạp dữ liệu độ cao');
    }
  });

  it('refuses an area-kind reference entity on elevation_profile with a "not a path" message, not a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/elevation_profile',
      payload: { roi: { source: 'reference', referenceLayer: 'water', entityId: waterEntityId } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/không phải là một tuyến đường/i);
  });

  it('refuses a radius on an elevation_profile path request instead of silently ignoring it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/elevation_profile',
      payload: { roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/bán kính/i);
  });

  it('refuses an ROI past the area limit, and says it was the area limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        reference: { referenceLayer: 'roads', entityId: bigRoadEntityId, radiusKm: 100 },
        radiusKm: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/diện tích/i);
  });

  it('refuses a pathologically complex entity before buffering it, naming the source-entity limit', async () => {
    // Picked by complexity, not a hardcoded id, so this survives a basemap
    // reload: the single roads entity with the most vertices. In the dev DB
    // this resolves to the same 22,662-point entity that OOM-killed a Postgres
    // backend (signal 9) when buffered by 100 km during development of this
    // guard -- this test proves it is rejected instead, using only radiusKm: 1
    // (any radius triggers the guard; a small one keeps the test itself safe).
    const { rows: [complex] } = await getPool().query<{ entity_id: string; npoints: number }>(
      `SELECT entity_id, ST_NPoints(geom) AS npoints
         FROM basemap.reference_entities
        WHERE layer_key = 'roads'
        ORDER BY ST_NPoints(geom) DESC LIMIT 1`
    );
    expect(complex.npoints).toBeGreaterThan(MAX_SOURCE_ENTITY_VERTICES);

    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        reference: { referenceLayer: 'roads', entityId: complex.entity_id, radiusKm: 1 },
        radiusKm: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    const message = res.json().error.message as string;
    // Names this limit specifically -- distinguishable from the area limit
    // ("diện tích") and the post-clip vertex limit's own wording ("Vùng quan
    // tâm quá phức tạp"), so this test cannot pass on the wrong error.
    expect(message).toMatch(/thực thể quá phức tạp/i);
    expect(message).toMatch(new RegExp(MAX_SOURCE_ENTITY_VERTICES.toLocaleString('vi-VN')));
    expect(message).not.toMatch(/diện tích/i);
    expect(message).not.toMatch(/vùng quan tâm quá phức tạp/i);
  });

  it('refuses a fragmented entity that is under the vertex ceiling but over the parts ceiling, naming the parts limit', async () => {
    // The vertex-only guard has a hole: a MultiLineString with many disjoint
    // parts can stay well under MAX_SOURCE_ENTITY_VERTICES on point count alone
    // while still generating enormous offset-curve geometry when buffered (each
    // part contributes its own two round end caps and its own disc to union).
    // Picked by complexity, not a hardcoded id, so this survives a basemap
    // reload: among entities under the vertex ceiling, the one with the most
    // parts. In the dev DB this resolves to the Hoài Nhơn-Quy Nhơn expressway
    // (9,050 points / 1,726 parts under one name/ref) -- exactly the entity
    // this ceiling exists to close off.
    const { rows: [fragmented] } = await getPool().query<{
      entity_id: string; layer_key: string; npoints: number; nparts: number;
    }>(
      `SELECT entity_id, layer_key, ST_NPoints(geom) AS npoints, ST_NumGeometries(geom) AS nparts
         FROM basemap.reference_entities
        WHERE ST_NPoints(geom) <= ${MAX_SOURCE_ENTITY_VERTICES}
        ORDER BY ST_NumGeometries(geom) DESC LIMIT 1`
    );
    expect(fragmented.npoints).toBeLessThanOrEqual(MAX_SOURCE_ENTITY_VERTICES);
    expect(fragmented.nparts).toBeGreaterThan(MAX_SOURCE_ENTITY_PARTS);

    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        reference: { referenceLayer: fragmented.layer_key, entityId: fragmented.entity_id, radiusKm: 1 },
        radiusKm: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    const message = res.json().error.message as string;
    // Names the complexity limit and specifically the PARTS dimension --
    // distinguishable from the area limit, the post-clip vertex limit, and
    // (since this entity is under the vertex ceiling) from the vertex term of
    // this very check, so the test cannot pass on the wrong reason.
    expect(message).toMatch(/thực thể quá phức tạp/i);
    expect(message).toMatch(/phần rời rạc/i);
    expect(message).toMatch(new RegExp(MAX_SOURCE_ENTITY_PARTS.toLocaleString('vi-VN')));
    expect(message).not.toMatch(new RegExp(MAX_SOURCE_ENTITY_VERTICES.toLocaleString('vi-VN')));
    expect(message).not.toMatch(/diện tích/i);
    expect(message).not.toMatch(/vùng quan tâm quá phức tạp/i);
  });

  it('does not gate the unbuffered path: an over-the-source-limit entity with no radius is not rejected by the new check', async () => {
    // The source-entity guard is only meaningful ahead of ST_Buffer -- without a
    // radius there is no buffer and thus no OOM risk from this path, so a large
    // unbuffered polygon (e.g. the water layer's largest entity, 15,134 points
    // per the measured data) must not be refused by THIS check. It may still be
    // refused downstream by the pre-existing, unrelated MAX_INPUT_VERTICES
    // post-clip check -- this test only asserts the new check's message never
    // appears, not that the request necessarily succeeds.
    const { rows: [bigWater] } = await getPool().query<{ entity_id: string; npoints: number }>(
      `SELECT entity_id, ST_NPoints(geom) AS npoints
         FROM basemap.reference_entities
        WHERE layer_key = 'water'
        ORDER BY ST_NPoints(geom) DESC LIMIT 1`
    );
    expect(bigWater.npoints).toBeGreaterThan(MAX_SOURCE_ENTITY_VERTICES);

    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/zonal_elevation',
      payload: { roi: { source: 'reference', referenceLayer: 'water', entityId: bigWater.entity_id } },
    });
    if (res.statusCode !== 200) {
      expect(res.json().error.message as string).not.toMatch(/thực thể quá phức tạp/i);
    }
  });

  it('404s on an unknown entity id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analysis/buffer',
      payload: {
        reference: { referenceLayer: 'roads', entityId: 'roads:' + '0'.repeat(32) + ':0', radiusKm: 1 },
        radiusKm: 1,
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
        roi: { source: 'reference', referenceLayer: 'roads', entityId: roadEntityId, radiusKm: 2 },
        layerKeys: ['dams'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('400s a malformed drawn shape on an operation instead of 500 (self-crossing, unclosed ring)', async () => {
    const bowtie = { type: 'Polygon', coordinates: [[[109.0, 12.0], [109.6, 12.5], [109.6, 12.0], [109.0, 12.5], [109.0, 12.0]]] };
    const unclosed = { type: 'Polygon', coordinates: [[[108.0, 12.0], [108.1, 12.0], [108.1, 12.1], [108.0, 12.1]]] };
    const a = await post('select_within', { roi: { source: 'drawn', geometry: bowtie }, layerKeys: ['dams'] });
    expect(a.statusCode).toBe(400);
    expect(a.json().error.message).toBe('Vùng tự cắt nhau — hãy vẽ lại');
    expect((await post('select_within', { roi: { source: 'drawn', geometry: unclosed }, layerKeys: ['dams'] })).statusCode).toBe(400);
  });
});
