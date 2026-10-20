import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

// A layer key no real layer uses, so the probes never meet the one-active-version index of a
// real layer. Everything runs in a transaction that is always rolled back.
const LAYER = 'durable_drafts_test';

async function inRolledBackTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

async function ingest(c: pg.PoolClient): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.dataset_versions (layer_key, kind, source, label)
     VALUES ($1, 'ingest', 'durableDrafts.test', 'root') RETURNING id::text AS id`,
    [LAYER]
  );
  return rows[0].id;
}

async function draft(c: pg.PoolClient, parent: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, draft_status)
     VALUES ($1, 'edit', $2, 'durableDrafts.test', 'draft', 'personal') RETURNING id::text AS id`,
    [LAYER, parent]
  );
  return rows[0].id;
}

/** Runs `sql` under a savepoint and returns the error it raised. */
async function failure(c: pg.PoolClient, sql: string, params: unknown[]): Promise<{ code?: string; constraint?: string }> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe');
    return e as { code?: string; constraint?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT probe');
  throw new Error(`expected the statement to fail: ${sql}`);
}

describe('migration 26: durable drafts', () => {
  it('an ingest cannot carry a draft status', async () => {
    await inRolledBackTx(async (c) => {
      const err = await failure(
        c,
        `INSERT INTO app.dataset_versions (layer_key, kind, source, label, draft_status)
         VALUES ($1, 'ingest', 'durableDrafts.test', 'x', 'personal')`,
        [LAYER]
      );
      expect(err).toMatchObject({ code: '23514', constraint: 'dataset_versions_draft_shape' });
    });
  });

  it('an active version cannot be a draft', async () => {
    await inRolledBackTx(async (c) => {
      const root = await ingest(c);
      const err = await failure(
        c,
        `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active, draft_status)
         VALUES ($1, 'edit', $2, 'durableDrafts.test', 'x', true, 'personal')`,
        [LAYER, root]
      );
      expect(err).toMatchObject({ code: '23514', constraint: 'dataset_versions_draft_shape' });
      // Activating an open draft without clearing its status is refused the same way.
      const d = await draft(c, root);
      const err2 = await failure(c, `UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [d]);
      expect(err2).toMatchObject({ code: '23514', constraint: 'dataset_versions_draft_shape' });
    });
  });

  it('unknown status is refused', async () => {
    await inRolledBackTx(async (c) => {
      const root = await ingest(c);
      const err = await failure(
        c,
        `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, draft_status)
         VALUES ($1, 'edit', $2, 'durableDrafts.test', 'x', 'approved')`,
        [LAYER, root]
      );
      expect(err.code).toBe('23514');
      // Each accepted status is accepted.
      for (const status of ['personal', 'submitted', 'returned']) {
        await c.query(
          `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, draft_status)
           VALUES ($1, 'edit', $2, 'durableDrafts.test', 'x', $3)`,
          [LAYER, root, status]
        );
      }
    });
  });

  it('a new version starts at revision 0 with an updated_at', async () => {
    await inRolledBackTx(async (c) => {
      const root = await ingest(c);
      const d = await draft(c, root);
      const { rows } = await c.query<{ revision: number; has_updated_at: boolean; draft_status: string | null }>(
        `SELECT revision, updated_at IS NOT NULL AS has_updated_at, draft_status
           FROM app.dataset_versions WHERE id = ANY($1::uuid[]) ORDER BY kind`,
        [[root, d]]
      );
      expect(rows).toEqual([
        { revision: 0, has_updated_at: true, draft_status: null },
        { revision: 0, has_updated_at: true, draft_status: 'personal' },
      ]);
    });
  });

  it('resolutions cascade with their draft', async () => {
    await inRolledBackTx(async (c) => {
      const root = await ingest(c);
      const d = await draft(c, root);
      await c.query(
        `INSERT INTO app.draft_resolutions (draft_id, external_id, against_version_id, choice)
         VALUES ($1, 'f-1', $2, 'mine'), ($1, 'f-2', $2, 'theirs')`,
        [d, root]
      );
      const bad = await failure(
        c,
        `INSERT INTO app.draft_resolutions (draft_id, external_id, against_version_id, choice)
         VALUES ($1, 'f-3', $2, 'both')`,
        [d, root]
      );
      expect(bad.code).toBe('23514');
      const count = async () =>
        (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.draft_resolutions WHERE draft_id = $1`, [d])).rows[0].n;
      expect(await count()).toBe(2);
      await c.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [d]);
      expect(await count()).toBe(0);
    });
  });

  it('open drafts have a partial index by layer', async () => {
    const { rows } = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'dataset_versions_open_drafts_idx'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/\(layer_key\) WHERE \(draft_status IS NOT NULL\)/);
  });

  it('the assistant role cannot read draft resolutions', async () => {
    // Asked of the grants themselves: a SELECT as the role fails earlier, for want of USAGE on
    // schema app, and would pass even with a grant on the table.
    const { rows } = await getPool().query<{ tbl: boolean; col: boolean }>(
      `SELECT has_table_privilege('webatlas_assistant', 'app.draft_resolutions', 'SELECT') AS tbl,
              has_any_column_privilege('webatlas_assistant', 'app.draft_resolutions', 'SELECT') AS col`
    );
    expect(rows[0]).toEqual({ tbl: false, col: false });
  });
});
