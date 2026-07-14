import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

describe('database connectivity', () => {
  it('connects and PostGIS is available', async () => {
    const { rows } = await getPool().query('SELECT postgis_version() AS v');
    expect(rows[0].v).toContain('3.4');
  });

  it('has the app and water schemas from init.sql', async () => {
    const { rows } = await getPool().query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('app', 'water') ORDER BY schema_name`
    );
    expect(rows.map((r) => r.schema_name)).toEqual(['app', 'water']);
  });
});
