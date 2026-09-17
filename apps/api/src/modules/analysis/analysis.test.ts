import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { withAnalysisTimeout } from './db';

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
