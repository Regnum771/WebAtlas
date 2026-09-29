import { existsSync } from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

describe('per-level river views', () => {
  it('rivers_detail is exactly the OSM ways', async () => {
    const { rows } = await getPool().query<{ n: string; lvls: string }>(
      `SELECT count(*)::text AS n, string_agg(DISTINCT feature_level::text, ',') AS lvls
         FROM water.rivers_detail`
    );
    expect(rows[0].n).toBe('9486');
    expect(rows[0].lvls).toBe('3');
  });

  it('rivers_overview is a plain view over the level-1 entities', async () => {
    const kind = await getPool().query<{ relkind: string }>(
      `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'water' AND c.relname = 'rivers_overview'`
    );
    // 'v' = view, 'm' = materialised view. A matview is a snapshot that goes stale
    // silently; that is the bug class this replacement removes.
    expect(kind.rows[0].relkind).toBe('v');
    const { rows } = await getPool().query<{ n: string; nulls: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE name IS NULL)::text AS nulls
         FROM water.rivers_overview`
    );
    // The rivers with at least one waterway=river way: what the detailed layer also draws
    // at far scales, so zooming in past the handoff does not make rivers vanish.
    expect(rows[0].n).toBe('324');
    expect(rows[0].nulls).toBe('0');
  });

  it('keeps the column list the frontend already consumes', async () => {
    const { rows } = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers_overview' ORDER BY column_name`
    );
    // apps/web reads name_key/name/stream_order/geom off webatlas:rivers_overview. The
    // replacement is only safe because this list is unchanged.
    expect(rows.map((r) => r.column_name)).toEqual(['geom', 'name', 'name_key', 'stream_order']);
  });

  it('lets the assistant role read both views', async () => {
    // Migrations 16, 18 and 19 each documented that a recreated view starts with no
    // privileges. The assistant reads rivers through these, so a missing GRANT is a
    // silent loss of access, not an error anyone sees.
    const { rows } = await getPool().query<{ detail: boolean; overview: boolean }>(
      `SELECT has_table_privilege('webatlas_assistant', 'water.rivers_detail', 'SELECT') AS detail,
              has_table_privilege('webatlas_assistant', 'water.rivers_overview', 'SELECT') AS overview`
    );
    expect(rows[0]).toEqual({ detail: true, overview: true });
  });

  it('no longer carries a river overview refresher', () => {
    // A plain view has nothing to refresh; a surviving refresher would be a live REFRESH
    // MATERIALIZED VIEW against a relation that is no longer materialised.
    expect(existsSync(new URL('./riverOverview.ts', import.meta.url))).toBe(false);
  });
});
