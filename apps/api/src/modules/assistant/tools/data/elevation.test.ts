import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
import type { ToolContext } from '../types';
import { elevationAtPointTool } from './elevationAtPoint';

/**
 * These use a stub pool rather than the live database its siblings in data.test.ts
 * use, for one reason: the DEM is the only dataset that does NOT arrive with a
 * checkout (see migration 1000000000010), so a live-database test here would assert
 * against an empty table on every machine and CI run, and would therefore only ever
 * exercise the "no data" branch. The stub covers all four branches instead. The
 * real query is exercised by the runbook's verification step, which samples a known
 * summit after the load.
 */
const MAP_CONTEXT: MapContext = {
  bbox: [106.5, 10.5, 110.0, 16.5],
  zoom: 8,
  visibleLayerStateIds: [],
  basemap: 'street',
};

function makeCtx(query: Pool['query']) {
  const commands: MapCommand[] = [];
  const records: Provenance[] = [];
  const ctx = {
    pool: { query } as unknown as Pool,
    mapContext: MAP_CONTEXT,
    collect: vi.fn((c: MapCommand) => commands.push(c)),
    provenance: vi.fn((p: Provenance) => records.push(p)),
    role: 'viewer',
  } satisfies ToolContext;
  return { ctx, records };
}

function run(tool: { run: (input: never) => unknown }, input: unknown): Promise<string> {
  return Promise.resolve(tool.run(input as never)) as Promise<string>;
}

/** Chu Yang Sin, the high point of Đắk Lắk — the DEM's own summit pixel, the same
 *  coordinate load-dem.sh verifies against. A published summit coordinate 2 km out lands
 *  on the flank and reads ~400 m low. */
const SUMMIT = { lon: 108.4244, lat: 12.4061 };

describe('elevation_at_point', () => {
  it('reports the elevation and credits the source', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ elevationM: 2442.3 }] });
    const { ctx, records } = makeCtx(query as unknown as Pool['query']);

    const parsed = JSON.parse(await run(elevationAtPointTool(ctx), SUMMIT)) as {
      elevationM: number;
      source: string;
    };

    expect(parsed.elevationM).toBe(2442.3);
    // The licence requires the source to be credited wherever the number surfaces;
    // the provenance chip renders datasetVersion, so this assertion is the licence
    // condition, not cosmetics.
    expect(parsed.source).toBe('FABDEM V1-2');
    expect(records).toEqual([
      { tool: 'elevation_at_point', layerKey: null, rowCount: 1, datasetVersion: 'FABDEM V1-2' },
    ]);
    // Bound as parameters, never interpolated.
    expect(query.mock.calls[0][1]).toEqual([SUMMIT.lon, SUMMIT.lat]);
  });

  it('treats a nodata pixel as no data, not as zero metres', async () => {
    // ST_Value returns NULL outside the clipped coverage. Reporting that as 0 would
    // put a mountain village at sea level with a straight face.
    const query = vi.fn().mockResolvedValue({ rows: [{ elevationM: null }] });
    const { ctx, records } = makeCtx(query as unknown as Pool['query']);

    const text = await run(elevationAtPointTool(ctx), SUMMIT);

    expect(text).toContain('Không có dữ liệu');
    expect(records[0]).toMatchObject({ rowCount: 0, datasetVersion: null });
  });

  it('says so plainly when the DEM has never been loaded on this deployment', async () => {
    const undefinedTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const query = vi.fn().mockRejectedValue(undefinedTable);
    const { ctx, records } = makeCtx(query as unknown as Pool['query']);

    const text = await run(elevationAtPointTool(ctx), SUMMIT);

    expect(text).toContain('Không có dữ liệu');
    expect(text).toContain('độ cao');
    // Provenance is still recorded on the failure path: a turn that consulted the
    // DEM and found nothing must look different from one that never asked.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tool: 'elevation_at_point', rowCount: 0 });
  });

  it('rethrows a real database error instead of reporting it as missing data', async () => {
    // guardToolErrors in the registry turns this into a message for the model; what
    // must not happen is a connection failure masquerading as "no elevation here".
    const query = vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' }));
    const { ctx } = makeCtx(query as unknown as Pool['query']);

    await expect(run(elevationAtPointTool(ctx), SUMMIT)).rejects.toThrow('boom');
  });

  it('refuses a coordinate outside Vietnam without touching the database', async () => {
    const query = vi.fn();
    const { ctx, records } = makeCtx(query as unknown as Pool['query']);

    const text = await run(elevationAtPointTool(ctx), { lon: 2.35, lat: 48.86 });

    expect(text).toContain('Toạ độ không hợp lệ');
    expect(query).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
});
