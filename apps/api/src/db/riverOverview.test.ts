import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getPool, closePool } from './pool';
import { refreshRiverOverview } from './riverOverview';

let pool: Pool;
beforeAll(() => { pool = getPool(); });
afterAll(async () => { await closePool(); });

describe('water.rivers_overview', () => {
  it('carries only the main trunks — the other buckets are hidden at these scales anyway', async () => {
    const { rows } = await pool.query<{ stream_order: number }>(
      'SELECT DISTINCT stream_order FROM water.rivers_overview',
    );
    expect(rows.map((r) => r.stream_order)).toEqual([5]);
  });

  it('is simplified far below one pixel at the far zoom', async () => {
    // At 1:12.800.000 one pixel is 3,39 km; the 0,01° tolerance is ~1,1 km, so
    // the shape a user sees is unchanged while the payload drops ~34x.
    const { rows } = await pool.query<{ overview: string; full: string }>(`
      SELECT (SELECT sum(ST_NPoints(geom)) FROM water.rivers_overview)::text AS overview,
             (SELECT sum(ST_NPoints(geom)) FROM water.rivers_active WHERE stream_order = 5)::text AS full
    `);
    expect(Number(rows[0].overview)).toBeLessThan(Number(rows[0].full) / 10);
  });

  it('covers every named trunk in the active version — a stale snapshot shows a superseded network', async () => {
    // rivers_active is version-aware; this materialized view is a snapshot of it.
    // If activation or ingest forgets to refresh, the far zoom silently serves
    // the old data with nothing to indicate it.
    //
    // The check is on NAMES, not per-segment ids, because the overview merges
    // segments by name. That catches a trunk being added, removed or renamed —
    // it does NOT catch a pure geometry edit to an existing trunk. Accepted: the
    // refresh hooks are the real defence, this is the backstop, and at
    // 1:12.800.000 one pixel is 3,39 km so a moved riverbank is invisible anyway.
    const { rows } = await pool.query<{ missing: string }>(`
      SELECT count(*)::text AS missing FROM (
        SELECT DISTINCT COALESCE(name, '') AS k FROM water.rivers_active WHERE stream_order = 5
        EXCEPT SELECT name_key FROM water.rivers_overview
      ) q
    `);
    expect(Number(rows[0].missing)).toBe(0);
  });

  it('merges segments by name, which is what makes the payload small', async () => {
    // 1.723 short OSM segments -> 279 merged trunks. Per-feature JSON overhead
    // dominates once the geometry is simplified, so this is the bigger win.
    const { rows } = await pool.query<{ overview: string; segments: string }>(`
      SELECT (SELECT count(*) FROM water.rivers_overview)::text AS overview,
             (SELECT count(*) FROM water.rivers_active WHERE stream_order = 5)::text AS segments
    `);
    expect(Number(rows[0].overview)).toBeLessThan(Number(rows[0].segments) / 4);
  });

  it('has a spatial index, since the layer is queried by bbox like any other', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'water' AND tablename = 'rivers_overview'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refreshes without locking readers', async () => {
    // CONCURRENTLY needs the UNIQUE index from the migration. If someone drops
    // it this throws, rather than silently blocking every map request mid-refresh.
    await expect(refreshRiverOverview(pool)).resolves.toBeUndefined();
  });
});
