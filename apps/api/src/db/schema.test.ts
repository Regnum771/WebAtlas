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
