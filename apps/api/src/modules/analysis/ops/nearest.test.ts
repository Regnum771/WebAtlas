import { describe, it, expect } from 'vitest';
import { queryNearest } from './nearest';
import { getPool } from '../../../db/pool';

describe('queryNearest', () => {
  // The view holds one row per feature, so the over-fetch cannot be starved by older
  // versions' rows (the case the removed exact-query fallback used to cover).
  it('returns every active station when asked for more than exist (live DB)', async () => {
    const pool = getPool();
    const { rows: [{ n }] } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM water.stations_active');
    const rows = await queryNearest(pool, { layerKey: 'stations', lon: 108.44, lat: 15.46, limit: 3 });
    expect(rows).toHaveLength(Math.min(3, Number(n)));
  });
});
