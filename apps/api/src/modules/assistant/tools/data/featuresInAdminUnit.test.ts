import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { featuresInAdminUnitTool } from './featuresInAdminUnit';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110, 16.5], zoom: 8, visibleLayerStateIds: [], basemap: 'street',
};

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool, role: 'viewer', mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, records };
}

const run = (tool: { run: (i: never) => unknown }, input: unknown) =>
  Promise.resolve(tool.run(input as never)) as Promise<string>;

describe('features_in_admin_unit', () => {
  it('describes the code parameter with at least one province code and its name, so the model can supply one without inventing it', () => {
    const { ctx } = makeCtx();
    const tool = featuresInAdminUnitTool(ctx) as unknown as {
      input_schema: { properties: { code: { description?: string } } };
    };
    const description = tool.input_schema.properties.code.description ?? '';
    expect(description).toContain('66');
    expect(description).toContain('Đắk Lắk');
  });

  it('counts dams in Đắk Lắk and names the unit in Vietnamese', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'dams', code: '66' });
    const parsed = JSON.parse(text) as { unit: string; count: number; rows: unknown[] };
    expect(parsed.unit).toContain('Đắk Lắk');
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThanOrEqual(25);
    expect(records[0]).toMatchObject({ tool: 'features_in_admin_unit', layerKey: 'dams' });
    expect(records[0].rowCount).toBe(parsed.count);
  });

  it('reports no data for a unit code that does not exist, and still emits provenance', async () => {
    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'dams', code: '999999' });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].rowCount).toBe(0);
  });

  it('reports no data when the unit exists but the layer has nothing in it', async () => {
    // Pick a province that genuinely holds no station, so the assertion is deterministic
    // rather than dependent on which placeholder rows the seed happens to contain.
    const { rows } = await pool.query<{ code: string }>(
      `SELECT p.code FROM admin.provinces p
        WHERE NOT EXISTS (
          SELECT 1 FROM water.stations_active s WHERE s.province_codes && ARRAY[p.code])
        ORDER BY p.code LIMIT 1`
    );
    expect(rows).toHaveLength(1);

    const { ctx, records } = makeCtx();
    const text = await run(featuresInAdminUnitTool(ctx), { layerKey: 'stations', code: rows[0].code });
    expect(text.startsWith('Không có dữ liệu:')).toBe(true);
    expect(records[0].rowCount).toBe(0);
  });
});
