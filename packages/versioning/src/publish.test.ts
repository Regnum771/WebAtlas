import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { versionsService } from './service';
import { refreshCurrentRows } from './currentRows';
import { openDraft } from './drafts';
import { DraftConflictError, StaleDraftError } from './errors';

const LAYER = 'dams';
const SOURCE = 'publish.test';
const PIN = 'publish.test';
const EMAIL = 'p2-publish-owner@webatlas.test';

// Synthetic dams, outside rebase.test.ts's range, one or two per test.
const DAMS = Array.from({ length: 10 }, (_, i) => 900601 + i);

const created: string[] = [];
let priorActive: string | null = null;
let owner = '';

const svc = () => versionsService(getPool());
const noGuard = async () => {};

async function rollbackRelease(c: pg.PoolClient): Promise<void> {
  // A client released mid-transaction would keep its row locks and hang afterAll's DELETEs.
  await c.query('ROLLBACK').catch(() => {});
  c.release();
}

/** Run fn in a committed transaction on its own client. */
async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } finally {
    await rollbackRelease(c);
  }
}

/** Run fn in a transaction that is always rolled back. */
async function rolledBack<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await rollbackRelease(c);
  }
}

async function insertDam(c: pg.PoolClient, versionId: string, ext: number, name: string): Promise<void> {
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint(108 + ($1 - 900600) * 0.001, 16.1), 4326), $3, '{}', '{}', '48', false)`,
    [ext, name, versionId]
  );
}

async function activeId(c: pg.Pool | pg.PoolClient = getPool()): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
  );
  return rows[0].id;
}

/** Publish an upstream change: a new edit version on the active one, activated. */
async function upstream(changes: Array<{ ext: number; name: string }>): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       SELECT $1, 'edit', id, $2, 'publish-test upstream', false
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       RETURNING id`,
      [LAYER, SOURCE]
    );
    const id = rows[0].id;
    created.push(id);
    for (const ch of changes) await insertDam(c, id, ch.ext, ch.name);
    await svc().activate(c, LAYER, id);
    return id;
  });
}

/** A committed personal draft on the active version, holding the given changes. */
async function draft(changes: Array<{ ext: number; name: string }>): Promise<string> {
  return tx(async (c) => {
    const d = await openDraft(c, LAYER, owner);
    created.push(d.id);
    for (const ch of changes) await insertDam(c, d.id, ch.ext, ch.name);
    return d.id;
  });
}

async function draftState(id: string) {
  const { rows } = await getPool().query<{
    parent: string; status: string | null; revision: number; feature_count: number | null; is_active: boolean;
  }>(
    `SELECT parent_version_id AS parent, draft_status AS status, revision, feature_count, is_active
       FROM app.dataset_versions WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function activeName(ext: number): Promise<string | null> {
  const { rows } = await getPool().query<{ name: string }>(
    `SELECT name FROM water.dams_active WHERE external_id = $1`, [ext]
  );
  return rows[0]?.name ?? null;
}

beforeAll(async () => {
  const pool = getPool();
  // CI's DB has no users: create our own throwaway one (deleted in afterAll).
  await pool.query(`DELETE FROM app.users WHERE email = $1`, [EMAIL]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id`, [EMAIL]
  );
  owner = u.rows[0].id;
  priorActive = await svc().getActiveVersionId(LAYER);
  // Activations here move the layer's real version out of the active chain: pin it so
  // retention cannot prune it while this file runs.
  if (priorActive) {
    await pool.query(
      `INSERT INTO app.version_pins (version_id, holder) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [priorActive, PIN]
    );
  }
  // Our own synthetic root: the layer's active state for the duration of this file.
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'publish-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) await insertDam(c, rows[0].id, ext, `dam-${ext}`);
    await svc().activate(c, LAYER, rows[0].id);
  });
});

afterAll(async () => {
  const pool = getPool();
  try {
    try {
      // Deactivate the test versions before restoring the prior one (one active per layer).
      for (const id of created) {
        await pool.query(`UPDATE app.dataset_versions SET is_active = false WHERE id = $1`, [id]);
      }
      if (priorActive) {
        await pool.query(`UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [priorActive]);
        const c = await pool.connect();
        try {
          await refreshCurrentRows(c, LAYER, priorActive);
        } finally {
          c.release();
        }
      }
    } finally {
      // Always drop the pin: its FK is ON DELETE RESTRICT, so a leftover would block deleting
      // the real version later.
      if (priorActive) {
        await pool.query(`DELETE FROM app.version_pins WHERE version_id = $1 AND holder = $2`, [priorActive, PIN]);
      }
    }
    await pool.query(`DELETE FROM app.draft_resolutions WHERE draft_id = ANY($1::uuid[])`, [created]);
    // Rows first (no cascade from the version), then versions, children before parents.
    await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]);
    for (const id of [...created].reverse()) {
      await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
    }
    await pool.query(`DELETE FROM app.users WHERE email = $1`, [EMAIL]);
  } finally {
    await closePool();
  }
});

describe('publishDraft', () => {
  it('publishes a clean draft and clears its status', async () => {
    const [a] = DAMS;
    const d = await draft([{ ext: a, name: 'pub-1' }]);
    const parent = (await draftState(d)).parent;
    // A leftover resolution: publishing drops the draft's resolutions whatever they are.
    await getPool().query(
      `INSERT INTO app.draft_resolutions (draft_id, external_id, against_version_id, choice)
       VALUES ($1, $2, $3, 'mine')`,
      [d, String(a), parent]
    );

    await tx((c) => svc().publishDraft(c, LAYER, d, noGuard));

    expect(await activeId()).toBe(d);
    expect(await draftState(d)).toMatchObject({ parent, status: null, is_active: true, feature_count: 1 });
    expect(await activeName(a)).toBe('pub-1');
    const left = await getPool().query(`SELECT 1 FROM app.draft_resolutions WHERE draft_id = $1`, [d]);
    expect(left.rowCount).toBe(0);
  });

  it('rebases before publishing when the layer moved on', async () => {
    const [, a, b] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-2' }]);
    const up = await upstream([{ ext: b, name: 'theirs-2' }]);

    await tx((c) => svc().publishDraft(c, LAYER, d, noGuard));

    expect(await activeId()).toBe(d);
    expect(await draftState(d)).toMatchObject({ parent: up, status: null, is_active: true });
    // The upstream change is kept under the draft's own.
    expect(await activeName(a)).toBe('mine-2');
    expect(await activeName(b)).toBe('theirs-2');
  });

  it('refuses with DraftConflictError listing the conflicts and activates nothing', async () => {
    const [, , , a] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-3' }]);
    const up = await upstream([{ ext: a, name: 'theirs-3' }]);
    const before = await draftState(d);
    let guarded = 0;

    const err = await tx((c) => svc().publishDraft(c, LAYER, d, async () => { guarded += 1; }))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DraftConflictError);
    // The API maps StaleDraftError to 409 STALE_EDIT, and singleChange retries on it.
    expect(err).toBeInstanceOf(StaleDraftError);
    const conflict = err as DraftConflictError;
    expect(conflict.message).toBe('Bản nháp xung đột với dữ liệu đã xuất bản ở 1 đối tượng.');
    expect(conflict.conflicts.map((x) => x.externalId)).toEqual([String(a)]);
    expect(conflict.conflicts[0].current?.name).toBe('theirs-3');
    expect(guarded).toBe(0);
    expect(await activeId()).toBe(up);
    expect(await draftState(d)).toEqual(before);
    expect(before.status).toBe('personal');
  });

  it('a throwing guard activates nothing and keeps the draft personal', async () => {
    const [, , , , a, b] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-4' }]);
    const up = await upstream([{ ext: b, name: 'theirs-4' }]);
    const before = await draftState(d);

    await rolledBack(async (c) => {
      await expect(
        svc().publishDraft(c, LAYER, d, async () => { throw new Error('not allowed'); })
      ).rejects.toThrow('not allowed');
      // Inside the publish transaction too: the guard ran before anything was activated.
      expect(await activeId(c)).toBe(up);
      const { rows } = await c.query(`SELECT draft_status FROM app.dataset_versions WHERE id = $1`, [d]);
      expect(rows[0].draft_status).toBe('personal');
    });

    expect(await activeId()).toBe(up);
    expect(await draftState(d)).toEqual(before);
    expect(await activeName(a)).toBe(`dam-${a}`);
  });

  it('the guard sees the rebased draft', async () => {
    const [, , , , , , a, b] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-5' }]);
    const up = await upstream([{ ext: b, name: 'theirs-5' }]);
    let seen: { parent: string; active: string; status: string | null } | undefined;

    await tx((c) => svc().publishDraft(c, LAYER, d, async (client) => {
      const { rows } = await client.query<{ parent: string; status: string | null }>(
        `SELECT parent_version_id AS parent, draft_status AS status FROM app.dataset_versions WHERE id = $1`, [d]
      );
      seen = { ...rows[0], active: await activeId(client) };
    }));

    expect(seen).toEqual({ parent: up, active: up, status: 'personal' });
    expect(await activeId()).toBe(d);
  });

  it('requires a guard', () => {
    // Type-level only (tsc checks it); never called.
    const untyped = (c: pg.PoolClient) =>
      // @ts-expect-error guard is a required parameter
      svc().publishDraft(c, LAYER, 'x');
    expect(typeof untyped).toBe('function');
  });
});
