import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { openDraft, lockDraft, bumpRevision, discardDraft } from './drafts';
import { DraftNotEditableError, DraftRevisionError, ConflictError, NotFoundError } from './errors';

const LAYER = 'dams';
const created: string[] = [];
let owner = '';
let activeId = '';

beforeAll(async () => {
  const pool = getPool();
  const users = await pool.query<{ id: string }>(`SELECT id FROM app.users ORDER BY id LIMIT 2`);
  owner = users.rows[0].id;
  const act = await pool.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
  );
  activeId = act.rows[0].id;
});

afterAll(async () => {
  const pool = getPool();
  for (const id of created) {
    await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = $1`, [id]);
    await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
  }
  await closePool();
});

async function committedDraft(): Promise<string> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const d = await openDraft(c, LAYER, owner);
    await c.query('COMMIT');
    created.push(d.id);
    return d.id;
  } finally {
    c.release();
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
      created.pop();
    } finally {
      c.release();
    }
  });

  it('a draft survives its transaction', async () => {
    const id = await committedDraft();
    const b = await getPool().connect();
    try {
      const d = await lockDraft(b, id, { ownerId: owner });
      expect(d.id).toBe(id);
    } finally {
      b.release();
    }
  });

  it('refuses another owner', async () => {
    const id = await committedDraft();
    const b = await getPool().connect();
    try {
      await expect(lockDraft(b, id, { ownerId: '11111111-1111-1111-1111-111111111111' }))
        .rejects.toBeInstanceOf(NotFoundError);
      await expect(lockDraft(b, '22222222-2222-2222-2222-222222222222'))
        .rejects.toBeInstanceOf(NotFoundError);
      await expect(lockDraft(b, activeId)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      b.release();
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
      c.release();
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
      c.release();
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
      c.release();
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
      c2.release();
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
      a.release();
      b.release();
    }
  });
});
