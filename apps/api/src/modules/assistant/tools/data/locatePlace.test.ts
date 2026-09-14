import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import { getPool, closePool } from '../../../../db/pool';
import type { ToolContext } from '../types';
import { locatePlaceTool } from './locatePlace';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: ['layer_dams'],
  basemap: 'street',
};

function makeCtx() {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool,
    mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
  } satisfies ToolContext;
  return { ctx, commands, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

type LocateResult = {
  rows: Array<{ name: string; fclass: string; population: number | null; lon: number; lat: number }>;
};

describe('locate_place', () => {
  it('resolves a place name to its real coordinates', async () => {
    // The regression this tool exists for: asked "5 đập gần Buôn Ma Thuột nhất?",
    // the model supplied 107.00/12.05, 107.98/12.07 and 107.30/12.67 on three
    // consecutive runs — all wrong, and each produced a different ranked answer
    // that still carried a provenance chip. The city is at 108.0447, 12.6797.
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(locatePlaceTool(ctx), { name: 'Buôn Ma Thuột' })) as LocateResult;
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows[0].lon).toBeCloseTo(108.04, 1);
    expect(parsed.rows[0].lat).toBeCloseTo(12.68, 1);
  });

  it('records provenance with no layer key, because this is not a thematic layer', async () => {
    const { ctx, records } = makeCtx();
    await run(locatePlaceTool(ctx), { name: 'Buôn Ma Thuột' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: 'locate_place', layerKey: null });
    expect(records[0].rowCount).toBeGreaterThan(0);
  });

  it('ranks the most populous match first when one name repeats', async () => {
    // places_region holds Buôn Ma Thuột twice: the city (465.392) and a suburb
    // (169.596). The city is what a user naming it means.
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(locatePlaceTool(ctx), { name: 'Buôn Ma Thuột' })) as LocateResult;
    expect(parsed.rows[0].fclass).toBe('city');
    expect(parsed.rows[0].population).toBe(465392);
  });

  it('matches case-insensitively', async () => {
    const { ctx } = makeCtx();
    const parsed = JSON.parse(await run(locatePlaceTool(ctx), { name: 'buôn ma thuột' })) as LocateResult;
    expect(parsed.rows[0].lon).toBeCloseTo(108.04, 1);
  });

  it('tolerates an administrative prefix the model may add', async () => {
    // "thành phố X" / "huyện X" are how the model tends to write place names in
    // Vietnamese prose; the gazetteer stores the bare name.
    const { ctx } = makeCtx();
    const parsed = JSON.parse(
      await run(locatePlaceTool(ctx), { name: 'thành phố Buôn Ma Thuột' })
    ) as LocateResult;
    expect(parsed.rows[0].lon).toBeCloseTo(108.04, 1);
  });

  it('reports no match instead of coordinates for a place it does not hold', async () => {
    // The whole point: an unlocatable name must come back as a refusal the model
    // can relay, never as something it can substitute a remembered guess for.
    const { ctx, records } = makeCtx();
    const text = await run(locatePlaceTool(ctx), { name: 'Khonesavath' });
    expect(text).not.toMatch(/\d+\.\d+/);
    expect(text).toMatch(/không/i);
    expect(records[0].rowCount).toBe(0);
  });
});
