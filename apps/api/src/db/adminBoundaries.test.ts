import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

// Loaded by the admin_boundaries dataset; here, by the global setup (src/test/globalSetup.ts).
// That the load REPLACES the two tables is tested in packages/atlas-data (loadGeojson.db.test.ts).
afterAll(async () => { await closePool(); });

describe('the administrative boundaries', () => {
  it('loads all 34 provinces and the 616 wards of the working region', async () => {
    const { rows } = await getPool().query<{ p: string; w: string }>(
      `SELECT (SELECT count(*) FROM admin.provinces)::text AS p,
              (SELECT count(*) FROM admin.wards)::text AS w`
    );
    expect(rows[0].p).toBe('34');
    expect(rows[0].w).toBe('616');
  });

  it('stores valid MultiPolygon geometry in EPSG:4326', async () => {
    const { rows } = await getPool().query<{ bad: string }>(
      `SELECT count(*)::text AS bad FROM admin.provinces
        WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326 OR GeometryType(geom) <> 'MULTIPOLYGON'`
    );
    expect(rows[0].bad).toBe('0');
  });

  it('places Buôn Ma Thuột inside Đắk Lắk (code 66)', async () => {
    const { rows } = await getPool().query<{ code: string }>(
      `SELECT code FROM admin.provinces
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326))`
    );
    expect(rows.map((r) => r.code)).toEqual(['66']);
  });

  it('every ward references a province that exists', async () => {
    const { rows } = await getPool().query<{ orphans: string }>(
      `SELECT count(*)::text AS orphans FROM admin.wards w
        LEFT JOIN admin.provinces p ON p.code = w.province_code WHERE p.code IS NULL`
    );
    expect(rows[0].orphans).toBe('0');
  });
});
