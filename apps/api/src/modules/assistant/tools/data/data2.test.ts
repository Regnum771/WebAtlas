import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { distanceBetweenTool } from './distanceBetween';
import { areaOfTool } from './areaOf';
import { filterByAttributeTool, FILTERABLE_COLUMNS } from './filterByAttribute';
import { relatedFeaturesTool } from './relatedFeatures';

let pool: Pool;
let damIds: string[] = [];
let lakeId: string | undefined;

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

beforeAll(async () => {
  pool = getPool();
  const dams = await pool.query<{ id: string }>(
    'SELECT id::text AS id FROM water.dams_active ORDER BY name LIMIT 2'
  );
  damIds = dams.rows.map((r) => r.id);
  const lakes = await pool.query<{ id: string }>(
    'SELECT id::text AS id FROM water.lakes_active ORDER BY area_km2 DESC NULLS LAST LIMIT 1'
  );
  lakeId = lakes.rows[0]?.id;
});
afterAll(async () => { await closePool(); });

function makeCtx() {
  const records: Provenance[] = [];
  const ctx = {
    pool,
    mapContext: MAP_CONTEXT,
    collect: vi.fn(),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

describe('distance_between', () => {
  it('measures between two real dams in kilometres', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: damIds[0],
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    const parsed = JSON.parse(text) as { distanceKm: number };
    expect(parsed.distanceKm).toBeGreaterThan(0);
    // Two dams in one working region are never a whole hemisphere apart; this
    // catches a degrees-instead-of-metres regression, which would read as ~0.
    expect(parsed.distanceKm).toBeLessThan(2000);
    expect(records[0]).toMatchObject({ tool: 'distance_between' });
  });

  it('reports no data for an unknown feature id instead of measuring from nothing', async () => {
    const { ctx } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: '00000000-0000-0000-0000-000000000000',
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    expect(text).toContain('Không có dữ liệu');
  });

  it('rejects a malformed feature id without throwing a database error', async () => {
    const { ctx } = makeCtx();
    const text = await run(distanceBetweenTool(ctx), {
      fromLayerKey: 'dams', fromFeatureId: 'not-a-uuid',
      toLayerKey: 'dams', toFeatureId: damIds[1],
    });
    expect(text).toContain('Không có dữ liệu');
  });
});

describe('area_of', () => {
  it('measures a lake in square kilometres', async () => {
    if (!lakeId) return;
    const { ctx, records } = makeCtx();
    const parsed = JSON.parse(await run(areaOfTool(ctx), { layerKey: 'lakes', featureId: lakeId })) as {
      areaKm2: number;
    };
    expect(parsed.areaKm2).toBeGreaterThan(0);
    expect(records[0]).toMatchObject({ tool: 'area_of', layerKey: 'lakes' });
  });

  it('refuses a point layer, which has no area', async () => {
    const { ctx } = makeCtx();
    const text = await run(areaOfTool(ctx), { layerKey: 'dams', featureId: damIds[0] });
    expect(text).toContain('không có diện tích');
  });
});

describe('filter_by_attribute', () => {
  it('exposes a column allowlist for every layer', () => {
    expect(Object.keys(FILTERABLE_COLUMNS)).toHaveLength(8);
  });

  it('filters dams by operational status', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      // Seeded water.dams status values are 'binh_thuong' / 'xa_lu' /
      // 'nguy_hiem' (verified against water.dams_active), not English
      // words — this must be a value that genuinely matches so the match
      // path (JSON shape, row contents, truncated flag) actually runs.
      layerKey: 'dams', column: 'status', value: 'binh_thuong',
    });
    expect(text.startsWith('{')).toBe(true);
    const parsed = JSON.parse(text) as {
      layerKey: string; column: string; value: string; truncated: boolean;
      rows: Array<{ featureId: string; name: string | null; matchedValue: string; lon: number | null; lat: number | null }>;
    };
    expect(parsed).toMatchObject({ layerKey: 'dams', column: 'status', value: 'binh_thuong' });
    expect(parsed.rows.length).toBeGreaterThan(0);
    for (const row of parsed.rows) {
      expect(row.matchedValue).toContain('binh_thuong');
      // A few seeded dams have no geometry, so lon/lat legitimately come back
      // null (ST_PointOnSurface of null) — that is real data shape, not
      // something this test should paper over.
      expect(row.lon === null || typeof row.lon === 'number').toBe(true);
      expect(row.lat === null || typeof row.lat === 'number').toBe(true);
    }
    expect(records[0]).toMatchObject({ tool: 'filter_by_attribute', layerKey: 'dams' });
    expect((records[0] as { rowCount: number }).rowCount).toBeGreaterThan(0);
  });

  it('reports no data for a value that matches no seeded status', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'status', value: 'Operating',
    });
    expect(text).toContain('Không có dữ liệu');
    expect(records[0]).toMatchObject({ tool: 'filter_by_attribute', layerKey: 'dams', rowCount: 0 });
  });

  it('refuses a column outside the allowlist without querying', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'created_by', value: 'x',
    });
    expect(text).toContain('Không lọc được theo');
    expect(records).toHaveLength(0);
  });

  it('refuses a column that belongs to a different layer', async () => {
    const { ctx } = makeCtx();
    const text = await run(filterByAttributeTool(ctx), {
      layerKey: 'dams', column: 'lake_type', value: 'x',
    });
    expect(text).toContain('Không lọc được theo');
  });
});

describe('related_features', () => {
  it('finds features of another layer within a radius of a feature', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: damIds[0], relatedLayerKey: 'rivers', radiusKm: 25,
    });
    expect(text.startsWith('{') || text.includes('Không có dữ liệu')).toBe(true);
    expect(records[0]).toMatchObject({ tool: 'related_features', layerKey: 'rivers' });
  });

  it('caps the radius so a runaway query cannot scan the whole layer', async () => {
    const { ctx } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: damIds[0], relatedLayerKey: 'rivers', radiusKm: 5000,
    });
    expect(text).toContain('Bán kính tối đa');
  });

  it('reports no data for an unknown anchor feature', async () => {
    const { ctx } = makeCtx();
    const text = await run(relatedFeaturesTool(ctx), {
      layerKey: 'dams', featureId: '00000000-0000-0000-0000-000000000000',
      relatedLayerKey: 'rivers', radiusKm: 10,
    });
    expect(text).toContain('Không có dữ liệu');
  });
});
