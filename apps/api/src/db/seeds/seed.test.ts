import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../pool';
import { runSeeds } from './run';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';

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

  it('stores only valid 4326 geometry (ignoring rows with no geometry)', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS bad FROM water.dams
       WHERE geom IS NOT NULL AND (NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326)`
    );
    expect(rows[0].bad).toBe(0);
  });

  it('stores NULL geometry for the 19 dams with no source coordinates', async () => {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.dams WHERE geom IS NULL`
    );
    expect(rows[0].n).toBe(19);
  });

  it('is idempotent (re-running does not duplicate rows)', async () => {
    const before = await count('flood_zones');
    await runSeeds();
    expect(await count('flood_zones')).toBe(before);
  });

  it('assigns every dam a valid status slug (not null)', async () => {
    const { rows } = await getPool().query(
      `SELECT DISTINCT status FROM water.dams`
    );
    const statuses = rows.map((r) => r.status);
    // no nulls
    expect(statuses.includes(null)).toBe(false);
    // every distinct value is a known slug
    for (const s of statuses) {
      expect(DAM_STATUS_SLUGS).toContain(s);
    }
    // variety: more than one distinct status present across 371 dams
    expect(statuses.length).toBeGreaterThan(1);
  });
});
