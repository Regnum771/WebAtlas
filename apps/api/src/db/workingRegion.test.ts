import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGION_PROVINCE_CODES } from '@webatlas/shared';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

describe('admin.working_region', () => {
  it('has one row whose geometry is the union of the region provinces', async () => {
    const { rows } = await getPool().query<{ n: string; same: boolean }>(
      `SELECT (SELECT count(*) FROM admin.working_region)::text AS n,
              ST_Equals((SELECT g FROM admin.working_region),
                        (SELECT ST_Union(geom) FROM admin.provinces WHERE code = ANY($1))) AS same`,
      [[...REGION_PROVINCE_CODES]]
    );
    expect(rows[0].n).toBe('1');
    expect(rows[0].same).toBe(true);
  });

  it('the migration lists exactly REGION_PROVINCE_CODES', () => {
    const text = readFileSync(join(__dirname, 'migrations', '1000000000024_working-region.cjs'), 'utf8');
    const list = /code = ANY\(ARRAY\[([^\]]*)\]\)/.exec(text)![1];
    const codes = [...list.matchAll(/'(\d+)'/g)].map((m) => m[1]);
    expect(codes.sort()).toEqual([...REGION_PROVINCE_CODES].sort());
  });
});
