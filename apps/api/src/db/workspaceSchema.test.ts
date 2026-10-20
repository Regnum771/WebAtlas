import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { openDraft, discardDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

// Schema-level checks for migration 27 (workspace.*). All but the cascade test run inside a
// transaction that is always rolled back.

const ASSISTANT = 'webatlas_assistant';
const TABLES = ['maps', 'map_layers', 'features', 'map_shares'] as const;
const email = (who: string) => `p3a-workspace-schema-${who}@webatlas.test`;

async function inRolledBackTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

async function insertUser(c: pg.Pool | pg.PoolClient, who: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id::text AS id`,
    [email(who)]
  );
  return rows[0].id;
}

async function insertMap(c: pg.Pool | pg.PoolClient, owner: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, 'probe') RETURNING id::text AS id`,
    [owner]
  );
  return rows[0].id;
}

/** Runs `sql` under a savepoint and returns the error it raised. */
async function failure(c: pg.PoolClient, sql: string, params: unknown[]): Promise<{ code?: string }> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe');
    return e as { code?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT probe');
  throw new Error(`expected the statement to fail: ${sql}`);
}

describe('migration 27: workspace schema', () => {
  it('workspace tables exist with their checks', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'checks');
      const map = await insertMap(c, owner);
      const edit = await failure(
        c,
        `INSERT INTO workspace.map_layers (map_id, kind, title, position) VALUES ($1, 'edit_copy', 't', 0)`,
        [map]
      );
      expect(edit.code).toBe('23514');
      const { rows: grp } = await c.query<{ id: string }>(
        `INSERT INTO app.access_groups (name) VALUES ('p3a-workspace-schema-group') RETURNING id::text AS id`
      );
      const share = await failure(
        c,
        `INSERT INTO workspace.map_shares (map_id, user_id, group_id) VALUES ($1, $2, $3)`,
        [map, owner, grp[0].id]
      );
      expect(share.code).toBe('23514');
    });
  });

  it('deleting a user cascades to their maps, layers and features', async () => {
    const pool = getPool();
    try {
      const owner = await insertUser(pool, 'cascade');
      const map = await insertMap(pool, owner);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type)
         VALUES ($1, 'free', 'l', 0, 'point') RETURNING id::text AS id`,
        [map]
      );
      await pool.query(
        `INSERT INTO workspace.features (layer_id, geom) VALUES ($1, ST_SetSRID(ST_MakePoint(105, 21), 4326))`,
        [rows[0].id]
      );
      await pool.query(`DELETE FROM app.users WHERE id = $1`, [owner]);
      const gone = await pool.query<{ maps: number; layers: number; feats: number }>(
        `SELECT (SELECT count(*) FROM workspace.maps WHERE id = $1)::int AS maps,
                (SELECT count(*) FROM workspace.map_layers WHERE id = $2)::int AS layers,
                (SELECT count(*) FROM workspace.features WHERE layer_id = $2)::int AS feats`,
        [map, rows[0].id]
      );
      expect(gone.rows[0]).toEqual({ maps: 0, layers: 0, feats: 0 });
    } finally {
      await runStages([
        async () => {
          await pool.query(`DELETE FROM app.users WHERE email = $1`, [email('cascade')]);
        },
      ]);
    }
  });

  it('a discarded draft leaves the layer with draft_id NULL', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'draft');
      const map = await insertMap(c, owner);
      const draft = await openDraft(c, 'dams', owner);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO workspace.map_layers (map_id, kind, title, position, layer_key, draft_id)
         VALUES ($1, 'edit_copy', 'e', 0, 'dams', $2) RETURNING id::text AS id`,
        [map, draft.id]
      );
      await discardDraft(c, draft.id);
      const after = await c.query<{ draft_id: string | null }>(
        `SELECT draft_id FROM workspace.map_layers WHERE id = $1`, [rows[0].id]
      );
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].draft_id).toBeNull();
    });
  });

  it('the assistant role cannot reach workspace', async () => {
    const { rows } = await getPool().query<{ usage: boolean }>(
      `SELECT has_schema_privilege($1, 'workspace', 'USAGE') AS usage`, [ASSISTANT]
    );
    expect(rows[0].usage).toBe(false);
    for (const t of TABLES) {
      const r = await getPool().query<{ ok: boolean }>(
        `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [ASSISTANT, `workspace.${t}`]
      );
      expect(r.rows[0].ok, t).toBe(false);
    }
  });
});
