import { describe, it, expect, afterAll } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

/** Runs `fn` in a transaction that is always rolled back, so role switches and probes leave nothing behind. */
async function inRolledBackTx<T>(fn: (q: (sql: string) => Promise<unknown>) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    return await fn((sql) => client.query(sql));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('migration 25: managing unit, unit tree, access groups', () => {
  it.each([
    [['48'], ['20194'], '20194'],
    [['48'], ['20194', '20200'], '48'],
    [['48', '51'], ['20194'], 'VN'],
    [[], [], 'VN'],
    [['48'], [], '48'],
  ])('the rule picks the smallest containing unit: (%j, %j) -> %s', async (provinces, wards, expected) => {
    const { rows } = await getPool().query<{ unit: string }>(
      `SELECT admin.managing_unit_for($1::text[], $2::text[]) AS unit`, [provinces, wards]
    );
    expect(rows[0].unit).toBe(expected);
  });

  it.each(EDITABLE_LAYER_KEYS)('%s: no current row lacks a managing unit', async (layer) => {
    const { rows } = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM water.${layer} WHERE is_current AND managing_unit IS NULL`
    );
    expect(rows[0].n).toBe(0);
  });

  it('the active views and rivers_detail expose managing_unit', async () => {
    await expect(getPool().query('SELECT managing_unit FROM water.dams_active LIMIT 1')).resolves.toBeTruthy();
    await expect(getPool().query('SELECT managing_unit FROM water.rivers_detail LIMIT 1')).resolves.toBeTruthy();
  });

  it('the assistant role reads managing_unit through the views but not the group tables', async () => {
    await inRolledBackTx(async (q) => {
      await q('SET LOCAL ROLE webatlas_assistant');
      await expect(q('SELECT managing_unit FROM water.lakes_active LIMIT 1')).resolves.toBeTruthy();
      await q('SAVEPOINT probe');
      await expect(q('SELECT * FROM app.access_groups')).rejects.toMatchObject({
        code: '42501',
        message: expect.stringMatching(/permission denied/),
      });
      await q('ROLLBACK TO SAVEPOINT probe');
    });
  });

  it('unit_tree has one VN root and parents that exist', async () => {
    const roots = await getPool().query<{ code: string; level: string; name: string }>(
      `SELECT code, level, name FROM admin.unit_tree WHERE parent IS NULL`
    );
    expect(roots.rows).toEqual([{ code: 'VN', level: 'country', name: 'Toàn quốc' }]);

    const orphans = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin.unit_tree t
        WHERE t.parent IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM admin.unit_tree p WHERE p.code = t.parent)`
    );
    expect(orphans.rows[0].n).toBe(0);

    const levels = await getPool().query<{ level: string }>(
      `SELECT DISTINCT level FROM admin.unit_tree ORDER BY level`
    );
    expect(levels.rows.map((r) => r.level)).toEqual(['country', 'province', 'ward']);
  });

  it('editor is gone', async () => {
    const { rows } = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.users WHERE role = 'editor'`
    );
    expect(rows[0].n).toBe(0);

    await inRolledBackTx(async (q) => {
      await expect(
        q(`INSERT INTO app.users (email, password_hash, role) VALUES ('editor-probe@webatlas.test', 'x', 'editor')`)
      ).rejects.toMatchObject({ constraint: 'users_role_not_editor' });
    });
  });
});
