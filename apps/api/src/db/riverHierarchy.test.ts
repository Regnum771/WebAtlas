import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';
import { MATCH_MIN_VOTES, MATCH_SAMPLES } from './riverHierarchy';

afterAll(async () => { await closePool(); });

describe('reach name join', () => {
  it('names the reaches the measured baseline says it should', async () => {
    const { rows } = await getPool().query<{ matched: string; names: string }>(
      `SELECT count(*)::text AS matched, count(DISTINCT parent_external_id)::text AS names
         FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id IS NOT NULL`
    );
    // Baseline pinned from the first real run (spec §2): 4,716 of 13,045 reaches,
    // carrying 439 of the 466 distinct OSM names. A LOWER number is a regression the
    // gate in Task 6 must refuse; a different number at all means the algorithm or the
    // data changed -- report it, do not edit these figures.
    expect(Number(rows[0].matched)).toBe(4716);
    expect(Number(rows[0].names)).toBe(439);
  });

  it('records a confidence for every match and none for a non-match', async () => {
    const { rows } = await getPool().query<{ bad: string; lo: string; hi: string }>(
      `SELECT count(*) FILTER (
                WHERE (parent_external_id IS NULL) <> (match_confidence IS NULL))::text AS bad,
              min(match_confidence)::text AS lo, max(match_confidence)::text AS hi
         FROM water.rivers_active WHERE feature_level = 2`
    );
    // A match without a confidence is a silent assertion; a confidence without a match
    // is meaningless. They travel together.
    expect(rows[0].bad).toBe('0');
    expect(Number(rows[0].lo)).toBeGreaterThanOrEqual(0.3);
    expect(Number(rows[0].hi)).toBeLessThanOrEqual(1);
  });

  it('assigns the real Sông Ba its measured reach count', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id = 'Sông Ba'`
    );
    // Measured: 131 reaches, ~352 km. The longest river in the working region, so it
    // exercises the vote over a long chain rather than a single reach.
    expect(rows[0].n).toBe('131');
  });

  it('leaves unmatched reaches visibly unmatched', async () => {
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM water.rivers_active
        WHERE feature_level = 2 AND parent_external_id IS NULL`
    );
    // 8,329 headwater reaches HydroRIVERS maps and OSM has not named. They stay
    // unnamed and walkable, never attached to a river the data does not claim.
    expect(rows[0].n).toBe('8329');
  });

  it('needs a real majority, not a plurality of one', () => {
    expect(MATCH_MIN_VOTES).toBeGreaterThan(MATCH_SAMPLES / 2);
  });
});
