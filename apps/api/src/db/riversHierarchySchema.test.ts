import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

const NEW_COLUMNS = ['feature_level', 'parent_external_id', 'flows_into_external_id', 'match_confidence'];

describe('rivers hierarchy schema', () => {
  it('adds the four hierarchy columns with the right types', async () => {
    const { rows } = await getPool().query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers' AND column_name = ANY($1)
        ORDER BY column_name`,
      [NEW_COLUMNS]
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'feature_level', 'flows_into_external_id', 'match_confidence', 'parent_external_id',
    ]);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.feature_level.data_type).toBe('smallint');
    expect(byName.feature_level.is_nullable).toBe('NO');
    expect(byName.parent_external_id.data_type).toBe('text');
    expect(byName.flows_into_external_id.data_type).toBe('text');
    expect(byName.match_confidence.data_type).toBe('real');
  });

  it('exposes the new columns through rivers_active', async () => {
    // A view's SELECT * is expanded at CREATE time, so the migration has to recreate
    // the view. Without that this passes nowhere and every later task reads NULLs it
    // cannot see.
    const { rows } = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'water' AND table_name = 'rivers_active' AND column_name = ANY($1)`,
      [NEW_COLUMNS]
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual([...NEW_COLUMNS].sort());
  });

  it('defaults existing and steward-created rows to level 3', async () => {
    // The real claim here is about the column's DEFAULT, not about today's row mix:
    // water.rivers_active now also holds level-2 HydroRIVERS reaches loaded into the
    // same dataset_version_id, so "every row is level 3" no longer holds. Prove the
    // DEFAULT directly instead, by inserting a row the way existing OSM-way inserts
    // and the steward edit path do -- without naming feature_level -- and checking
    // what comes out. Wrapped in a transaction that's rolled back so this leaves no
    // trace in the shared dev DB.
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ feature_level: number }>(
        `INSERT INTO water.rivers (external_id, geom, dataset_version_id)
         SELECT 'osm:zz-default-check',
                ST_Multi(ST_GeomFromText('LINESTRING(108 12, 108.01 12.01)', 4326)),
                id
           FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active
         RETURNING feature_level`
      );
      expect(rows[0].feature_level).toBe(3);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses a feature_level outside 1..3', async () => {
    await expect(
      getPool().query(
        `INSERT INTO water.rivers (external_id, feature_level, geom, dataset_version_id)
         SELECT 'osm:zz-level-check', 4,
                ST_Multi(ST_GeomFromText('LINESTRING(108 12, 108.01 12.01)', 4326)),
                id
           FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
      )
    ).rejects.toThrow(/rivers_feature_level_check/);
  });
});
