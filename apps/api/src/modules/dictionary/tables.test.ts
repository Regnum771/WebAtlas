import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';

afterAll(async () => { await closePool(); });

// Runs fn in a transaction that is always rolled back.
async function rolledBack(fn: (q: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<void>): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('the data dictionary tables', () => {
  it('the dictionary tables exist with their checks', async () => {
    const { rows } = await getPool().query<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = 'app' AND table_name LIKE 'dictionary\_%' ORDER BY 1`);
    expect(rows.map((r) => r.t)).toEqual([
      'dictionary_attributes', 'dictionary_feature_types', 'dictionary_history', 'dictionary_unit_periods', 'dictionary_values',
    ]);
    await rolledBack(async (q) => {
      await q(`INSERT INTO app.dictionary_feature_types
                 (key, kind, name, definition, crs, geometry_meaning, valid_from, synced_at)
               VALUES ('dd-t5-ok', 'vector', 'n', 'd', 4326, 'exact', '2026-01-01', now())`);
      await q('SAVEPOINT bad');
      await expect(q(`INSERT INTO app.dictionary_feature_types
                        (key, kind, name, definition, crs, geometry_meaning, valid_from, synced_at)
                      VALUES ('dd-t5-bad', 'mesh', 'n', 'd', 4326, 'exact', '2026-01-01', now())`))
        .rejects.toThrow(/check/i);
    });
  });

  it('the assistant run_sql role cannot read the dictionary tables', async () => {
    // Migration 8 keeps webatlas_assistant out of schema app; the assistant's tools read labels in
    // application code instead. No table grant either: it could not be used without schema USAGE.
    const { rows } = await getPool().query<{ t: string; ok: boolean }>(
      `SELECT t, has_table_privilege('webatlas_assistant', 'app.' || t, 'SELECT') AS ok
         FROM unnest(ARRAY['dictionary_feature_types','dictionary_attributes','dictionary_values','dictionary_history','dictionary_unit_periods']) AS t`);
    expect(rows.filter((r) => r.ok).map((r) => r.t)).toEqual([]);
    for (const t of ['dictionary_feature_types', 'dictionary_attributes', 'dictionary_values', 'dictionary_history', 'dictionary_unit_periods']) {
      await rolledBack(async (q) => {
        await q('SET LOCAL ROLE webatlas_assistant');
        await expect(q(`SELECT 1 FROM app.${t} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
          message: expect.stringMatching(/permission denied/),
        });
      });
    }
  });

  it('an access group can be granted dictionary.manage', async () => {
    await rolledBack(async (q) => {
      await q(`INSERT INTO app.access_groups (id, name) VALUES ('00000000-0000-4000-8000-0000000000d5', 'dd-t5-group')`);
      await q(`INSERT INTO app.access_group_permissions (group_id, permission)
               VALUES ('00000000-0000-4000-8000-0000000000d5', 'dictionary.manage')`);
    });
  });
});
