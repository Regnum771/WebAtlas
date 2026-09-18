import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { isMapCommand, type MapCommand, type MapContext, type Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { bufferFeatureTool } from './bufferFeature';
import { selectWithinTool } from './selectWithin';
import { elevationProfileTool } from './elevationProfile';
import { zonalElevationTool } from './zonalElevation';

let pool: Pool;
let damId: string;
let riverId: string;
beforeAll(async () => {
  pool = getPool();
  ({ rows: [{ id: damId }] } = await pool.query(`SELECT id::text FROM water.dams_active WHERE geom IS NOT NULL LIMIT 1`));
  ({ rows: [{ id: riverId }] } = await pool.query(`SELECT id::text FROM water.rivers_active ORDER BY length_m DESC NULLS LAST LIMIT 1`));
});
afterAll(async () => { await closePool(); });

const MAP_CONTEXT: MapContext = { bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street' };

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool, role: 'viewer', mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}
const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('analysis tools', () => {
  it('buffer_feature draws the buffer and reports its area', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(bufferFeatureTool(ctx), { layerKey: 'rivers', featureId: riverId, radiusKm: 2 });
    expect(JSON.parse(text).summary['Diện tích vùng đệm (km²)']).toBeGreaterThan(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ kind: 'showGeometries', fit: true });
    expect(commands.every(isMapCommand)).toBe(true);
    expect(records[0]).toMatchObject({ tool: 'buffer_feature', layerKey: 'rivers' });
  });

  it('select_within counts dams within 10 km of a dam (at least itself)', async () => {
    const { ctx, commands } = makeCtx();
    const text = await run(selectWithinTool(ctx), {
      layerKeys: ['dams'], area: { layerKey: 'dams', featureId: damId, radiusKm: 10 },
    });
    expect(JSON.parse(text).summary['Tổng số']).toBeGreaterThanOrEqual(1);
    expect(commands[0]).toMatchObject({ kind: 'showGeometries' });
  });

  it('refuses a point area without a radius, with provenance and no command', async () => {
    const { ctx, commands, records } = makeCtx();
    const text = await run(zonalElevationTool(ctx), { layerKey: 'dams', featureId: damId });
    expect(text.startsWith('Không thực hiện được:')).toBe(true);
    expect(commands).toEqual([]);
    expect(records).toHaveLength(1);
  });

  it('reports no data for an unknown feature', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(bufferFeatureTool(ctx), {
      layerKey: 'rivers', featureId: '00000000-0000-0000-0000-000000000000', radiusKm: 1,
    });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records[0].rowCount).toBe(0);
  });

  it('elevation_profile answers with a summary, never the full sample array', async () => {
    const { ctx } = makeCtx();
    const text = await run(elevationProfileTool(ctx), { layerKey: 'rivers', featureId: riverId });
    if (text.startsWith('Không có dữ liệu:')) return; // DEM not loaded on this box
    const parsed = JSON.parse(text);
    expect(parsed.summary['Chiều dài (km)']).toBeGreaterThan(0);
    expect(parsed).not.toHaveProperty('profile');
  });
});
