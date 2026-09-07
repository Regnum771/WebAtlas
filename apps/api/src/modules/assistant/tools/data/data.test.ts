import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { featuresInViewTool } from './featuresInView';
import { nearestFeaturesTool } from './nearestFeatures';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

/** The Central Highlands / south-central coast working region. */
const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

function makeCtx(mapContext: MapContext = MAP_CONTEXT) {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool,
    mapContext,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

describe('features_in_view', () => {
  it('counts and lists dams inside the current viewport', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    const parsed = JSON.parse(text) as { count: number; rows: Array<{ lon: number; lat: number }> };
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows[0].lon).toBeGreaterThan(100);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: 'features_in_view', layerKey: 'dams' });
    expect(records[0].rowCount).toBe(parsed.count);
  });

  it('caps the listed rows without capping the count', async () => {
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(featuresInViewTool(ctx), { layerKey: 'rivers' })) as {
      count: number; rows: unknown[];
    };
    expect(parsed.rows.length).toBeLessThanOrEqual(25);
    expect(parsed.count).toBeGreaterThanOrEqual(parsed.rows.length);
  });

  it('reports no data rather than an empty structure when the viewport is empty', async () => {
    // A viewport in the South China Sea: valid, and genuinely contains nothing.
    const { ctx, records } = makeCtx({ ...MAP_CONTEXT, bbox: [115.0, 10.0, 116.0, 11.0] });
    const text = await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    expect(text).toContain('Không có dữ liệu');
    expect(records[0].rowCount).toBe(0);
  });

  it('records the active dataset version in provenance', async () => {
    const { ctx, records } = makeCtx();
    await run(featuresInViewTool(ctx), { layerKey: 'dams' });
    expect(typeof records[0].datasetVersion).toBe('string');
  });

  // Catches a rewrite that is fast but wrong: the tool's count now comes from
  // a candidate-then-resolve CTE chain (see helpers.ts's candidateCtes) built
  // to reach the geometry index, rather than the water.rivers_active view
  // directly. A plain count against that view is the ground truth it must
  // still agree with.
  it('counts the same as a plain scan of the active view', async () => {
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(featuresInViewTool(ctx), { layerKey: 'rivers' })) as { count: number };
    const { rows } = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM water.rivers_active WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)',
      MAP_CONTEXT.bbox
    );
    expect(parsed.count).toBe(Number(rows[0].n));
  });
});

describe('nearest_features', () => {
  it('returns features ordered by distance, in kilometres', async () => {
    const { ctx, records } = makeCtx();
    // Buôn Ma Thuột, roughly centre of the working region.
    const text = await run(nearestFeaturesTool(ctx), { layerKey: 'dams', lon: 108.05, lat: 12.68, limit: 5 });
    const parsed = JSON.parse(text) as { rows: Array<{ distanceKm: number }> };
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThanOrEqual(5);
    const distances = parsed.rows.map((r) => r.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(records[0]).toMatchObject({ tool: 'nearest_features', layerKey: 'dams' });
  });

  it('refuses coordinates outside Vietnam without querying', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(nearestFeaturesTool(ctx), { layerKey: 'dams', lon: 0, lat: 0, limit: 5 });
    expect(text).toContain('Toạ độ không hợp lệ');
    expect(records).toHaveLength(0);
  });

  // Catches a rewrite that is fast but wrong: the tool now finds nearest
  // candidates off the base table with planar `<->` (so the GiST index can
  // serve the KNN), resolves the version chain for just those, then
  // re-orders by true ::geography distance (see helpers.ts's candidateCtes
  // and NEAREST_OVERFETCH_FACTOR). The feature ids and order it returns must
  // still match a straightforward exact query against water.rivers_active
  // for the same point.
  it('returns the same feature ids in the same order as an exact query against the active view', async () => {
    const { ctx } = makeCtx();
    const point = { layerKey: 'rivers' as const, lon: 108.05, lat: 12.68, limit: 5 };
    const parsed = JSON.parse(await run(nearestFeaturesTool(ctx), point)) as {
      rows: Array<{ featureId: string }>;
    };
    const { rows: reference } = await pool.query<{ featureId: string }>(
      `SELECT id::text AS "featureId"
         FROM water.rivers_active
        ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        LIMIT $3`,
      [point.lon, point.lat, point.limit]
    );
    expect(parsed.rows.map((r) => r.featureId)).toEqual(reference.map((r) => r.featureId));
  });
});
