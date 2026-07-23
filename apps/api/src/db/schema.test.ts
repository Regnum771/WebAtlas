import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

async function tableExists(schema: string, table: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2`,
    [schema, table]
  );
  return rows.length === 1;
}

describe('app schema', () => {
  it('has users and audit_log tables', async () => {
    expect(await tableExists('app', 'users')).toBe(true);
    expect(await tableExists('app', 'audit_log')).toBe(true);
  });

  it('users.email is unique and citext', async () => {
    const { rows } = await getPool().query(
      `SELECT udt_name FROM information_schema.columns
       WHERE table_schema='app' AND table_name='users' AND column_name='email'`
    );
    expect(rows[0].udt_name).toBe('citext');

    const { rows: uniq } = await getPool().query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname='app' AND tablename='users'
         AND indexdef ILIKE '%unique%' AND indexdef ILIKE '%(email)%'`
    );
    expect(uniq.length).toBeGreaterThan(0);
  });
});

describe('water schema', () => {
  const tables = [
    'dams', 'rivers', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation',
  ];

  it('has all seven thematic tables', async () => {
    for (const t of tables) {
      expect(await tableExists('water', t)).toBe(true);
    }
  });

  it('every table has a 4326 geometry column', async () => {
    // Restricted to base tables (relkind='r'): the water.*_active views (§5) also
    // expose geom and are correctly picked up by geometry_columns, but this check
    // is specifically about the underlying thematic tables.
    const { rows } = await getPool().query(
      `SELECT gc.f_table_name, gc.srid, gc.type
         FROM geometry_columns gc
         JOIN pg_class c ON c.relname = gc.f_table_name
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = gc.f_table_schema
        WHERE gc.f_table_schema='water' AND c.relkind='r'`
    );
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.srid).toBe(4326);
    }
  });
});

describe('active-version views (§5)', () => {
  const tables = [
    'dams', 'rivers', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation',
  ];

  it('has a <layer>_active view for every thematic layer', async () => {
    for (const t of tables) {
      const { rows } = await getPool().query(
        `SELECT 1 FROM information_schema.views WHERE table_schema='water' AND table_name=$1`,
        [`${t}_active`]
      );
      expect(rows.length, `${t}_active`).toBe(1);
    }
  });

  it('the active view returns the active version rows (matches the resolver)', async () => {
    // For a backfilled/seeded ingest-active layer, the view count equals live non-deleted rows.
    const { rows: viaView } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
    const { rows: active } = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'dams' AND is_active`
    );
    const { rows: direct } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.dams WHERE dataset_version_id = $1 AND NOT deleted`,
      [active[0].id]
    );
    expect(viaView[0].n).toBe(direct[0].n);
  });

  it('reflects an edit-version commit (new feature appears via the view)', async () => {
    const NAME = 'view-flow@webatlas.test';
    const { rows: b } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
    // Simulate a committed edit-version off the active ingest.
    const active = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key='dams' AND is_active`
    );
    let editId: string | undefined;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const edit = await client.query(
        `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label)
         VALUES ('dams','edit',$1,'edit session','view test') RETURNING id`, [active.rows[0].id]
      );
      editId = edit.rows[0].id;
      await client.query(
        `INSERT INTO water.dams (external_id, name, dataset_version_id, geom)
         VALUES (999999, $1, $2, ST_SetSRID(ST_MakePoint(105.8,21.0),4326))`,
        [NAME, edit.rows[0].id]
      );
      await client.query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='dams' AND is_active`);
      await client.query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [edit.rows[0].id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    try {
      const { rows: a } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
      expect(a[0].n).toBe(b[0].n + 1);
    } finally {
      // Restore active pointer and clean up so the suite is repeatable,
      // even if the assertion above failed.
      await getPool().query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='dams' AND is_active`);
      await getPool().query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [active.rows[0].id]);
      await getPool().query(`DELETE FROM water.dams WHERE name=$1`, [NAME]);
      if (editId) {
        await getPool().query(`DELETE FROM app.dataset_versions WHERE id=$1`, [editId]);
      }
    }
  });
});
