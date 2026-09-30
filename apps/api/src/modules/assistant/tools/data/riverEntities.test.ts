import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import { closeAnalysisPool } from '../../../analysis/pool';
import { selectWithinOp } from '../../../analysis/ops/selectWithin';
import { queryNearest } from '../../../analysis/ops/nearest';
import { featuresRepository } from '../../../layers/repository';
import { getLayer } from '../../../../layers/registry';
import type { ToolContext } from '../types';
import { featuresInAdminUnitTool } from './featuresInAdminUnit';
import { filterByAttributeTool } from './filterByAttribute';
import { relatedFeaturesTool } from './relatedFeatures';
import { runSqlTool } from './runSql';

/**
 * water.rivers holds three levels since the topology ingest -- 1 = named river, 2 =
 * HydroRIVERS reach, 3 = OSM way -- and every query that counts, lists or searches
 * "rivers" means the level-1 entity. Found 2026-09-30: select_within over Đắk Lắk
 * reported 2,991 "sông ngòi" (142 rivers + 2,202 reaches + 647 ways).
 */

let pool: Pool;
let damId: string;

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5], zoom: 8, visibleLayerStateIds: ['layer_rivers'], basemap: 'street',
};

beforeAll(async () => {
  pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM water.dams_active WHERE province_codes && ARRAY['66'] ORDER BY name LIMIT 1`
  );
  damId = rows[0].id;
});
afterAll(async () => { await closePool(); await closeAnalysisPool(); });

function makeCtx() {
  const ctx = {
    pool, mapContext: MAP_CONTEXT, collect: vi.fn(),
    provenance: vi.fn((_p: Provenance) => undefined), role: 'viewer',
  } satisfies ToolContext;
  return ctx;
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

/** The feature_level of each id, so a test can assert on the set. */
async function levelsOf(ids: string[]): Promise<number[]> {
  const { rows } = await pool.query<{ feature_level: number }>(
    `SELECT DISTINCT feature_level FROM water.rivers WHERE id = ANY($1::uuid[]) ORDER BY 1`, [ids]
  );
  return rows.map((r) => r.feature_level);
}

describe('rivers mean the level-1 entity in every collection query', () => {
  it('select_within counts and lists rivers, not their reaches and ways', async () => {
    const { rows: [province] } = await pool.query<{ g: unknown }>(
      `SELECT ST_AsGeoJSON(geom, 6)::json AS g FROM admin.provinces WHERE code = '66'`
    );
    const r = await selectWithinOp(pool, { roi: { source: 'drawn', geometry: province.g }, layerKeys: ['rivers'] } as never);
    const { rows: [expected] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active r, admin.provinces p
        WHERE p.code = '66' AND r.feature_level = 1 AND ST_Intersects(r.geom, p.geom)`
    );
    expect(r.summary['sông ngòi']).toBe(Number(expected.n));
    const ids = (r.rows ?? []).map((row) => row.featureId!).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    expect(await levelsOf(ids)).toEqual([1]);
  }, 60_000);

  it('nearest returns k rivers', async () => {
    const rows = await queryNearest(pool, { layerKey: 'rivers', lon: 108.05, lat: 12.68, limit: 5 });
    expect(rows).toHaveLength(5);
    expect(await levelsOf(rows.map((r) => r.featureId))).toEqual([1]);
  });

  it('features_in_admin_unit counts the rivers stamped into the province', async () => {
    const parsed = JSON.parse(await run(featuresInAdminUnitTool(makeCtx()), { layerKey: 'rivers', code: '66' })) as {
      count: number; rows: Array<{ featureId: string }>;
    };
    const { rows: [expected] } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 1 AND province_codes && ARRAY['66']`
    );
    expect(parsed.count).toBe(Number(expected.n));
    expect(await levelsOf(parsed.rows.map((r) => r.featureId))).toEqual([1]);
  });

  it('filter_by_attribute finds a river once, not once per way', async () => {
    const parsed = JSON.parse(
      await run(filterByAttributeTool(makeCtx()), { layerKey: 'rivers', column: 'name', value: 'Sông Thu Bồn' })
    ) as { rows: Array<{ featureId: string }> };
    expect(parsed.rows).toHaveLength(1);
    expect(await levelsOf(parsed.rows.map((r) => r.featureId))).toEqual([1]);
  });

  it('related_features returns rivers near a dam', async () => {
    const parsed = JSON.parse(
      await run(relatedFeaturesTool(makeCtx()), {
        layerKey: 'dams', featureId: damId, relatedLayerKey: 'rivers', radiusKm: 20,
      })
    ) as { rows: Array<{ featureId: string }> };
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(await levelsOf(parsed.rows.map((r) => r.featureId))).toEqual([1]);
  });

  it('run_sql tells the model which level is the river', () => {
    // The model writes the SQL itself, so the tool description is the only place the
    // level rule can reach it.
    const description = (runSqlTool(makeCtx()) as unknown as { description: string }).description;
    expect(description).toMatch(/feature_level/);
  });
});

describe('the layer list API lists what stewards edit', () => {
  it('lists river ways (level 3), the rows the map draws and the editor accepts', async () => {
    const rows = await featuresRepository(pool).list(getLayer('rivers')!, { province: '66' });
    expect(rows.length).toBeGreaterThan(0);
    expect(await levelsOf(rows.map((r) => r.id))).toEqual([3]);
  }, 60_000);
});
