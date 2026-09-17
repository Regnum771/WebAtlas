import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { withAnalysisTimeout } from './db';
import { demAvailable } from './dem';

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
afterAll(async () => { await app.close(); });

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
    const res = await post('select_within', { geometry: square(dam.lon, dam.lat, 0.02), layerKeys: ['dams'] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary['đập & hồ chứa']).toBeGreaterThanOrEqual(1);
    expect(body.summary['Tổng số']).toBeGreaterThanOrEqual(1);
    expect(body.rows.some((r: { featureId: string }) => r.featureId === dam.id)).toBe(true);
    expect(body.geometries[0].role).toBe('input');
  });

  it('accepts a line feature with a buffer distance', async () => {
    const res = await post('select_within', { feature: { layerKey: 'rivers', featureId: riverId }, bufferKm: 5, layerKeys: ['dams', 'lakes'] });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toHaveProperty('Tổng số');
  });

  it('rejects a point area without a buffer distance', async () => {
    const res = await post('select_within', { geometry: { type: 'Point', coordinates: [dam.lon, dam.lat] }, layerKeys: ['dams'] });
    expect(res.statusCode).toBe(400);
    const lineNoBuffer = await post('select_within', { feature: { layerKey: 'rivers', featureId: riverId }, layerKeys: ['dams'] });
    expect(lineNoBuffer.statusCode).toBe(400);
  });
});

describe('analysis route', () => {
  it('400s an unknown operation', async () => {
    expect((await post('teleport', {})).statusCode).toBe(400);
  });
});

describe('POST /api/analysis/nearest', () => {
  it('returns k rows in ascending distance with connector lines', async () => {
    const res = await post('nearest', { lon: 108.05, lat: 12.68, layerKey: 'dams', k: 3 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(3);
    const d = body.rows.map((r: { distanceKm: number }) => r.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(body.geometries.filter((g: { role: string }) => g.role === 'result')).toHaveLength(3);
  });

  it('rejects k above 25', async () => {
    expect((await post('nearest', { lon: 108.05, lat: 12.68, layerKey: 'dams', k: 26 })).statusCode).toBe(400);
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
    const res = await post('elevation_profile', { geometry: sixKmLine });
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
    const res = await post('elevation_profile', { geometry: line, samples: 50 });
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
    const res = await post('zonal_elevation', { geometry: square(108.05, 12.68, 0.02) });
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
    const res = await post('zonal_elevation', { geometry: square(108.0, 13.0, 0.5) });
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
