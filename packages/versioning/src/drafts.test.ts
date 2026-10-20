import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { openDraft, lockDraft, bumpRevision, discardDraft } from './drafts';
import { DraftNotEditableError, DraftRevisionError, ConflictError, NotFoundError } from './errors';
import { runStages } from './testLayerGuard';

const LAYER = 'dams';
const EMAILS = ['p2-drafts-owner@webatlas.test', 'p2-drafts-other@webatlas.test'];
const created: string[] = [];
const userIds: string[] = [];
let owner = '';
let other = '';
let activeId = '';

beforeAll(async () => {
  const pool = getPool();
  // CI's DB has no users: create our own throwaway ones (deleted in afterAll). A run that died
  // before its afterAll leaves them behind, so clear leftovers first.
  await pool.query(`DELETE FROM app.users WHERE email = ANY($1::text[])`, [EMAILS]);
  for (const email of EMAILS) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id`, [email]
    );
    userIds.push(u.rows[0].id);
  }
  [owner, other] = userIds;
  const act = await pool.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
  );
  activeId = act.rows[0].id;
});

afterAll(async () => {
  const pool = getPool();
  try {
    // Every stage runs even when an earlier one fails, so one failing delete leaks nothing else.
    // Only drafts were committed here (some later had their status cleared), never activated:
    // NOT is_active keeps this from ever removing the layer's active version.
    await runStages([
      () => pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]),
      () => pool.query(
        `DELETE FROM app.dataset_versions WHERE id = ANY($1::uuid[]) AND NOT is_active`, [created]
      ),
      () => pool.query(`DELETE FROM app.users WHERE email = ANY($1::text[])`, [EMAILS]),
    ]);
  } finally {
    await closePool();
  }
});

async function rollbackRelease(c: pg.PoolClient): Promise<void> {
  // A client released mid-transaction would keep its row locks and hang afterAll's DELETEs.
  await c.query('ROLLBACK').catch(() => {});
  c.release();
}

async function committedDraft(): Promise<string> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const d = await openDraft(c, LAYER, owner);
    created.push(d.id);
    await c.query('COMMIT');
    return d.id;
  } finally {
    await rollbackRelease(c);
  }
}

describe('draft lifecycle', () => {
  it('opens a personal draft on the active version', async () => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      const d = await openDraft(c, LAYER, owner);
      created.push(d.id);
      expect(d).toMatchObject({
        layerKey: LAYER, parentId: activeId, status: 'personal', revision: 0, ownerId: owner,
      });
      const { rows } = await c.query(
        `SELECT kind, source, label, is_active FROM app.dataset_versions WHERE id = $1`, [d.id]
      );
      expect(rows[0]).toMatchObject({ kind: 'edit', source: 'draft', is_active: false });
      expect(rows[0].label).toMatch(/^\d{4}-\d{2}-\d{2} nháp$/);
      await c.query('ROLLBACK');
    } finally {
      await rollbackRelease(c);
    }
  });

  it('a draft survives its transaction', async () => {
    const id = await committedDraft();
    const b = await getPool().connect();
    try {
      const d = await lockDraft(b, id, { ownerId: owner });
      expect(d.id).toBe(id);
    } finally {
      await rollbackRelease(b);
    }
  });

  it('refuses another owner', async () => {
    const id = await committedDraft();
    const b = await getPool().connect();
    try {
      await expect(lockDraft(b, id, { ownerId: other }))
        .rejects.toBeInstanceOf(NotFoundError);
      await expect(lockDraft(b, '22222222-2222-2222-2222-222222222222'))
        .rejects.toBeInstanceOf(NotFoundError);
      await expect(lockDraft(b, activeId)).rejects.toBeInstanceOf(NotFoundError);
      // A published edit (NULL status) is not a draft either.
      await getPool().query(`UPDATE app.dataset_versions SET draft_status = NULL WHERE id = $1`, [id]);
      await expect(lockDraft(b, id)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await rollbackRelease(b);
    }
  });

  it('refuses a stale revision', async () => {
    const id = await committedDraft();
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      expect(await bumpRevision(c, id)).toBe(1);
      await expect(lockDraft(c, id, { expectedRevision: 0 })).rejects.toBeInstanceOf(DraftRevisionError);
      expect((await lockDraft(c, id, { expectedRevision: 1 })).revision).toBe(1);
      await c.query('ROLLBACK');
    } finally {
      await rollbackRelease(c);
    }
  });

  it('refuses a draft that is not personal', async () => {
    const id = await committedDraft();
    await getPool().query(`UPDATE app.dataset_versions SET draft_status = 'submitted' WHERE id = $1`, [id]);
    const c = await getPool().connect();
    try {
      await expect(lockDraft(c, id, { requireStatus: 'personal' }))
        .rejects.toBeInstanceOf(DraftNotEditableError);
    } finally {
      await rollbackRelease(c);
    }
  });

  it('discard removes rows and version and refuses a published edit', async () => {
    const id = await committedDraft();
    const pool = getPool();
    await pool.query(
      `INSERT INTO water.dams (external_id, name, geom, dataset_version_id, province_codes, ward_codes)
       VALUES (900401, 'draft-test', ST_SetSRID(ST_MakePoint(108, 16), 4326), $1, '{}', '{}')`, [id]
    );
    const c = await pool.connect();
    try {
      await discardDraft(c, id);
    } finally {
      await rollbackRelease(c);
    }
    expect((await pool.query(`SELECT 1 FROM water.dams WHERE dataset_version_id = $1`, [id])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM app.dataset_versions WHERE id = $1`, [id])).rowCount).toBe(0);

    // A published edit (draft_status NULL) must never be discarded.
    const pub = await committedDraft();
    await pool.query(`UPDATE app.dataset_versions SET draft_status = NULL WHERE id = $1`, [pub]);
    const c2 = await pool.connect();
    try {
      await expect(discardDraft(c2, pub)).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await rollbackRelease(c2);
    }
    expect((await pool.query(`SELECT 1 FROM app.dataset_versions WHERE id = $1`, [pub])).rowCount).toBe(1);
  });

  it('two clients serialise on the draft lock', async () => {
    const id = await committedDraft();
    const a = await getPool().connect();
    const b = await getPool().connect();
    try {
      await a.query('BEGIN');
      await lockDraft(a, id);
      let bDone = false;
      const bLock = lockDraft(b, id).then((r) => { bDone = true; return r; });
      const winner = await Promise.race([
        bLock.then(() => 'b'),
        new Promise<string>((r) => setTimeout(() => r('timeout'), 300)),
      ]);
      expect(winner).toBe('timeout');
      expect(bDone).toBe(false);
      await a.query('COMMIT');
      expect((await bLock).id).toBe(id);
    } finally {
      await rollbackRelease(a);
      await rollbackRelease(b);
    }
  });
});
