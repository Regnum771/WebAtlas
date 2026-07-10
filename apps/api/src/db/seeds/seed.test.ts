import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';
import { runSeeds } from './run';

beforeAll(async () => {
  await runSeeds();
});
afterAll(async () => {
  await closePool();
});

async function count(table: string): Promise<number> {
  const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM water.${table}`);
  return rows[0].n;
}

describe('seeds', () => {
  it('loads dams and rivers from the source GeoJSON', async () => {
    expect(await count('dams')).toBe(371);
    expect(await count('rivers')).toBe(2013);
  });

  it('loads the five mock layers (2 features each)', async () => {
    for (const t of ['stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(await count(t)).toBe(2);
    }
  });

  it('stores only valid 4326 geometry', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS bad FROM water.dams WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326`
    );
    expect(rows[0].bad).toBe(0);
  });

  it('is idempotent (re-running does not duplicate rows)', async () => {
    const before = await count('flood_zones');
    await runSeeds();
    expect(await count('flood_zones')).toBe(before);
  });
});
