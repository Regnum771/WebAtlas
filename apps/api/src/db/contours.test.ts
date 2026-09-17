import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from './pool';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

describe('basemap.contours', () => {
  it('exists with the columns the generator and the styles both rely on', async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'basemap' AND table_name = 'contours'
        ORDER BY column_name`
    );
    const cols = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(Object.keys(cols).sort()).toEqual(['elevation_m', 'geom', 'id', 'interval_m', 'is_index']);
    expect(cols.interval_m).toBe('integer');
    expect(cols.is_index).toBe('boolean');
  });

  it('records where each reference dataset came from, and under what licence', async () => {
    // basemap mixes ODbL (OSM) with CC BY-NC-SA (FABDEM). Without this the only record of
    // which is which is a runbook, and the DEM has already been swapped once with no trace.
    const { rows } = await pool.query<{ name: string; licence: string }>(
      `SELECT name, licence FROM basemap.dataset_sources ORDER BY name`
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.licence]));
    expect(byName['dem_region']).toMatch(/CC BY-NC-SA/);
  });

  it('is indexed on geometry AND on interval', async () => {
    // Every tile request filters `interval_m = N` and then a bbox. Missing either index
    // turns each tile into a scan of the whole bucket, and there are three buckets.
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'basemap' AND tablename = 'contours'`
    );
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/USING gist \(geom\)/i);
    expect(defs).toMatch(/\(interval_m\)/i);
  });
});
