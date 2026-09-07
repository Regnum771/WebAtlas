/**
 * Adversarial tests for the SQL escape hatch.
 *
 * The assertions that matter here fail at the DATABASE PRIVILEGE level, not in
 * the parser: each one runs SQL that the guard would have rejected, directly on
 * the assistant pool, and requires Postgres itself to refuse it. A guard that
 * silently stopped working must still leave these failing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { getAssistantPool, closeAssistantPool } from './pool';

let pool: Pool | null;
beforeAll(() => { pool = getAssistantPool(); });
afterAll(async () => { await closeAssistantPool(); });

const maybe = process.env.ASSISTANT_DATABASE_URL ? describe : describe.skip;

/** Postgres SQLSTATE for insufficient_privilege. */
const INSUFFICIENT_PRIVILEGE = '42501';

async function expectDenied(sql: string, code = INSUFFICIENT_PRIVILEGE) {
  await expect(pool!.query(sql)).rejects.toMatchObject({ code });
}

maybe('webatlas_assistant database privileges', () => {
  it('can read the active-version views', async () => {
    const { rows } = await pool!.query('SELECT count(*)::int AS n FROM water.dams_active');
    expect(rows[0].n).toBeGreaterThanOrEqual(0);
  });

  it('cannot read app.users — the argon2 hashes are unreachable by privilege', async () => {
    await expectDenied('SELECT * FROM app.users');
  });

  it('cannot read app.audit_log', async () => {
    await expectDenied('SELECT * FROM app.audit_log');
  });

  it('cannot read app.dataset_versions directly, only through the views', async () => {
    await expectDenied('SELECT * FROM app.dataset_versions');
  });

  it('cannot read the water base tables, only the active views', async () => {
    await expectDenied('SELECT * FROM water.dams');
  });

  it('cannot write to a water table', async () => {
    await expectDenied("INSERT INTO water.dams (name, geom) VALUES ('x', ST_MakePoint(0,0))");
  });

  it('cannot create a table', async () => {
    // CREATE in the public schema is revoked from PUBLIC since Postgres 15.
    await expect(pool!.query('CREATE TABLE assistant_probe (a int)')).rejects.toBeTruthy();
  });

  it('cannot grant itself more privilege', async () => {
    await expect(pool!.query('GRANT SELECT ON app.users TO webatlas_assistant')).rejects.toBeTruthy();
  });
});
