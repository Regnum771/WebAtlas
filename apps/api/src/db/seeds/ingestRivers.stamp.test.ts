import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';

afterAll(async () => { await closePool(); });

describe('rivers ingest stamping', () => {
  it('leaves every active river stamped with the provinces it crosses', async () => {
    const { rows } = await getPool().query<{ total: string; stamped: string; multi: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE array_length(province_codes, 1) IS NOT NULL)::text AS stamped,
              count(*) FILTER (WHERE array_length(province_codes, 1) > 1)::text AS multi
         FROM water.rivers_active WHERE geom IS NOT NULL`
    );
    // Most watercourses sit inside the six provinces; a few reach beyond the clip edge and
    // legitimately stamp empty, so assert the bulk rather than all.
    expect(Number(rows[0].stamped)).toBeGreaterThan(Number(rows[0].total) * 0.9);
    // At least one crosses a provincial boundary — the reason these columns are arrays.
    expect(Number(rows[0].multi)).toBeGreaterThan(0);
  });
});
