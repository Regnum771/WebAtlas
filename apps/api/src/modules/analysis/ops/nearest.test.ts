import { describe, it, expect } from 'vitest';
import { queryNearest, type NearestRow } from './nearest';
import { getPool } from '../../../db/pool';
import type { Queryable } from '../../assistant/tools/data/helpers';

const row = (featureId: string, distanceKm: number): NearestRow => ({ featureId, name: featureId, lon: 108, lat: 15, distanceKm });

/** Answers the three queries queryNearest may issue, in order: over-fetch, count, exact. */
function fakeDb(fast: NearestRow[], count: number, exact: NearestRow[]): Queryable & { calls: number } {
  const replies = [{ rows: fast }, { rows: [{ n: String(count) }] }, { rows: exact }];
  const db = {
    calls: 0,
    query: async () => replies[db.calls++],
  };
  return db as unknown as Queryable & { calls: number };
}

describe('queryNearest fallback', () => {
  // A layer with fewer active features than `limit`, each carried by many edit-versions:
  // the over-fetch fills up on one feature's versions and misses the others. The layer
  // having fewer than `limit` features does not make that short answer right.
  it('falls back to the exact query when the over-fetch misses features of a small layer', async () => {
    const db = fakeDb([row('a', 1)], 2, [row('a', 1), row('b', 170)]);
    const rows = await queryNearest(db, { layerKey: 'stations', lon: 108, lat: 15, limit: 5 });
    expect(rows.map((r) => r.featureId)).toEqual(['a', 'b']);
  });

  it('keeps the over-fetch answer when it already holds every feature of a small layer', async () => {
    const db = fakeDb([row('a', 1), row('b', 170)], 2, []);
    const rows = await queryNearest(db, { layerKey: 'stations', lon: 108, lat: 15, limit: 5 });
    expect(rows.map((r) => r.featureId)).toEqual(['a', 'b']);
    expect(db.calls).toBe(2);
  });

  // On a dev DB that has re-seeded many times, each station has many versions, so the
  // over-fetch (limit × 20 rows) from beside Phú Ninh holds only Phú Ninh's own versions.
  it('returns every active station when asked for more than exist (live DB)', async () => {
    const pool = getPool();
    const { rows: [{ n }] } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM water.stations_active');
    const rows = await queryNearest(pool, { layerKey: 'stations', lon: 108.44, lat: 15.46, limit: 3 });
    expect(rows).toHaveLength(Math.min(3, Number(n)));
  });
});
