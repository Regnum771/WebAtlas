import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type pg from 'pg';
import type { UnitTree } from '@webatlas/shared';
import { lockDraft, rebaseDraft, refreshCurrentRows, versionsService } from '@webatlas/versioning';
import { getPool, closePool } from '../../db/pool';
import errorHandler from '../../plugins/errorHandler';
import { getUnitTree } from '../../authz/unitTree';
import type { CurrentUser } from '../../types/fastify';
import { draftEditor } from './draftEditor';

const LAYER = 'dams';
const SOURCE = 'draftEditor.test';
const PIN = 'draftEditor.test';
const OWNER_EMAIL = 'p2-draft-editor-owner@webatlas.test';
const OTHER_EMAIL = 'p2-draft-editor-other@webatlas.test';

// Synthetic dams, outside publish.test.ts (9006xx) and rebase.test.ts (9005xx). The first one
// sits in province 51 and is managed by it; the rest are managed by 48.
const DAMS = Array.from({ length: 10 }, (_, i) => 900701 + i);
const IN_51 = DAMS[0];

/** Versions this file created, in creation order (children after their parents). */
const created: string[] = [];
let priorActive: string | null = null;
let owner: CurrentUser;
let other: CurrentUser;
let tree: UnitTree;
let point51: { type: 'Point'; coordinates: [number, number] };

const editor = () => draftEditor(getPool());
const point48 = { type: 'Point', coordinates: [108.05, 16.1] };

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

/** Run every cleanup stage even when an earlier one fails; rethrow the first failure. */
async function runStages(stages: Array<() => Promise<unknown>>): Promise<void> {
  let failure: unknown = null;
  for (const stage of stages) {
    try {
      await stage();
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure !== null) throw failure;
}

/** The HTTP error the API's error handler answers for what `fn` throws. */
async function httpError(fn: () => Promise<unknown>): Promise<{ status: number; error: Record<string, unknown> }> {
  const app = Fastify({ logger: false });
  try {
    await app.register(errorHandler);
    app.get('/probe', async () => { await fn(); return { ok: true }; });
    const res = await app.inject({ method: 'GET', url: '/probe' });
    return { status: res.statusCode, error: res.json().error };
  } finally {
    await app.close();
  }
}

async function insertDam(
  c: pg.PoolClient, versionId: string, ext: number, name: string, unit = '48'
): Promise<void> {
  const [x, y] = unit === '51' ? point51.coordinates : [108 + (ext - 900700) * 0.001, 16.1];
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, '{}', '{}', $6, false)`,
    [ext, name, x, y, versionId, unit]
  );
}

async function makeUser(email: string): Promise<CurrentUser> {
  await getPool().query(`DELETE FROM app.users WHERE email = $1`, [email]);
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id`, [email]
  );
  // A viewer with no group: no permission anywhere.
  return { id: rows[0].id, email, role: 'viewer', isAdmin: false, grants: [] };
}

/** Open a draft and remember it for cleanup. */
async function open(actor: CurrentUser = owner) {
  const d = await editor().open(LAYER, actor);
  created.push(d.draftId);
  return d;
}

async function activeRowId(ext: number): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM water.dams_active WHERE external_id = $1`, [ext]
  );
  return rows[0].id;
}

async function revisionOf(draftId: string): Promise<number | null> {
  const { rows } = await getPool().query<{ revision: number }>(
    `SELECT revision FROM app.dataset_versions WHERE id = $1`, [draftId]
  );
  return rows[0]?.revision ?? null;
}

async function draftRows(draftId: string) {
  const { rows } = await getPool().query<{ id: string; external_id: string; name: string | null; deleted: boolean }>(
    `SELECT id, external_id::text, name, deleted FROM water.dams WHERE dataset_version_id = $1 ORDER BY external_id`,
    [draftId]
  );
  return rows;
}

/** Publish an upstream change: a new edit version on the active one, activated. */
async function upstream(ext: number, name: string): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       SELECT $1, 'edit', id, $2, 'draftEditor-test upstream', false
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       RETURNING id`,
      [LAYER, SOURCE]
    );
    const id = rows[0].id;
    created.push(id);
    await insertDam(c, id, ext, name);
    await versionsService(getPool()).activate(c, LAYER, id);
    return id;
  });
}

beforeAll(async () => {
  const pool = getPool();
  // CI's DB has no users: create our own throwaway ones (deleted in afterAll).
  owner = await makeUser(OWNER_EMAIL);
  other = await makeUser(OTHER_EMAIL);
  tree = await getUnitTree(pool);
  const p = await pool.query<{ x: number; y: number }>(
    `SELECT ST_X(p) AS x, ST_Y(p) AS y FROM (SELECT ST_PointOnSurface(geom) AS p FROM admin.provinces WHERE code = '51') s`
  );
  point51 = { type: 'Point', coordinates: [p.rows[0].x, p.rows[0].y] };

  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits activations on dams: pin every existing version of the layer so retention
  // cannot prune a real ingest while it runs.
  await pool.query(
    `INSERT INTO app.version_pins (version_id, holder)
     SELECT id, $2 FROM app.dataset_versions WHERE layer_key = $1
     ON CONFLICT DO NOTHING`,
    [LAYER, PIN]
  );
  // Our own synthetic root: the layer's active state for the duration of this file.
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'draftEditor-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) await insertDam(c, rows[0].id, ext, `dam-${ext}`, ext === IN_51 ? '51' : '48');
    await versionsService(pool).activate(c, LAYER, rows[0].id);
  });
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [owner?.id, other?.id].filter((x): x is string => typeof x === 'string');
  try {
    await runStages([
      // Deactivate the test versions before restoring the prior one (one active per layer).
      async () => {
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
      },
      // The pin's FK is ON DELETE RESTRICT: a leftover would block deleting a real version later.
      () => pool.query(`DELETE FROM app.version_pins WHERE holder = $1`, [PIN]),
      () => pool.query(`DELETE FROM app.draft_resolutions WHERE draft_id = ANY($1::uuid[])`, [created]),
      // Rows first (no cascade from the version), then versions, children before parents.
      () => pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]),
      async () => {
        for (const id of [...created].reverse()) {
          await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
        }
      },
      // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
      () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
      () => pool.query(`DELETE FROM app.users WHERE email = ANY($1::text[])`, [[OWNER_EMAIL, OTHER_EMAIL]]),
    ]);
  } finally {
    await closePool();
  }
});

describe('draftEditor', () => {
  it('edits persist across connections and bump the revision', async () => {
    const { draftId, revision } = await open();
    expect(revision).toBe(0);

    const made = await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-new', managing_unit: '48' } }, owner, tree,
      { expectedRevision: 0 }
    );
    expect(made.revision).toBe(1);
    expect(made.feature.properties.name).toBe('de-new');
    expect(made.warnings).toEqual([]);

    const named = await activeRowId(DAMS[1]);
    const changed = await editor().update(
      LAYER, draftId, named, { properties: { name: 'de-renamed' } }, owner, tree, { expectedRevision: 1 }
    );
    expect(changed.revision).toBe(2);
    expect(changed.feature.properties.name).toBe('de-renamed');

    // A fresh connection sees what each operation committed.
    const c = await getPool().connect();
    try {
      const v = await c.query(`SELECT revision, draft_status FROM app.dataset_versions WHERE id = $1`, [draftId]);
      expect(v.rows[0]).toEqual({ revision: 2, draft_status: 'personal' });
      const rows = await c.query<{ name: string }>(
        `SELECT name FROM water.dams WHERE dataset_version_id = $1 ORDER BY name`, [draftId]
      );
      expect(rows.rows.map((r) => r.name)).toEqual(['de-new', 'de-renamed']);
      // Audit rows as the edit session writes them: feature_id is the id the request named.
      const audit = await c.query<{ action: string; feature_id: string }>(
        `SELECT action, feature_id FROM app.audit_log WHERE user_id = $1 AND feature_id = ANY($2::uuid[]) ORDER BY id`,
        [owner.id, [made.feature.id, named]]
      );
      expect(audit.rows).toEqual([
        { action: 'create', feature_id: made.feature.id },
        { action: 'update', feature_id: named },
      ]);
    } finally {
      c.release();
    }
  });

  it('a refused operation leaves the draft and its revision untouched', async () => {
    const { draftId } = await open();
    const made = await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-kept', managing_unit: '48' } }, owner, tree
    );
    const before = await draftRows(draftId);

    // PostGIS cannot parse it: the failing statement aborts the operation's transaction.
    const err = await httpError(async () => editor().update(
      LAYER, draftId, await activeRowId(DAMS[2]), { geometry: { type: 'Point', coordinates: [108] } },
      owner, tree, { expectedRevision: 1 }
    ));
    expect(err).toEqual({ status: 422, error: { code: 'GEOMETRY_ERROR', message: 'Geometry could not be parsed' } });
    expect(await revisionOf(draftId)).toBe(1);
    expect(await draftRows(draftId)).toEqual(before);

    // The draft still takes the next edit.
    const next = await editor().update(
      LAYER, draftId, made.feature.id, { properties: { name: 'de-kept-2' } }, owner, tree, { expectedRevision: 1 }
    );
    expect(next.revision).toBe(2);
  });

  it('a stale expectedRevision is refused with DRAFT_CHANGED', async () => {
    const { draftId } = await open();
    await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-stale', managing_unit: '48' } }, owner, tree,
      { expectedRevision: 0 }
    );
    const err = await httpError(async () => editor().update(
      LAYER, draftId, await activeRowId(DAMS[3]), { properties: { name: 'late' } }, owner, tree, { expectedRevision: 0 }
    ));
    expect(err).toEqual({ status: 409, error: { code: 'DRAFT_CHANGED', message: 'Bản đồ đã thay đổi ở nơi khác.' } });
    expect(await revisionOf(draftId)).toBe(1);
  });

  it("another user's draft is not found", async () => {
    const { draftId } = await open();
    const input = { geometry: point48, properties: { name: 'de-intruder', managing_unit: '48' } };

    const create = await httpError(() => editor().create(LAYER, draftId, input, other, tree));
    expect(create.status).toBe(404);
    expect(create.error.code).toBe('NOT_FOUND');
    const discard = await httpError(() => editor().discard(LAYER, draftId, other));
    expect(discard.status).toBe(404);
    // Nor is the owner's own draft under another layer's key.
    const wrongLayer = await httpError(() => editor().create('stations', draftId, input, owner, tree));
    expect(wrongLayer.status).toBe(404);
    expect(wrongLayer.error.code).toBe('NOT_FOUND');

    expect(await revisionOf(draftId)).toBe(0);
    expect(await draftRows(draftId)).toEqual([]);
  });

  it('a submitted draft refuses edits with DRAFT_NOT_EDITABLE', async () => {
    const { draftId } = await open();
    // P4 adds the transition; set the status directly.
    await getPool().query(`UPDATE app.dataset_versions SET draft_status = 'submitted' WHERE id = $1`, [draftId]);

    const err = await httpError(async () => editor().update(
      LAYER, draftId, await activeRowId(DAMS[4]), { properties: { name: 'too late' } }, owner, tree
    ));
    expect(err).toEqual({
      status: 409,
      error: { code: 'DRAFT_NOT_EDITABLE', message: 'Bản nháp đã được nộp, không sửa được nữa.' },
    });
    expect(await draftRows(draftId)).toEqual([]);
  });

  it('personal drafts are not checked against jurisdiction', async () => {
    // `owner` is a viewer in no group: no permission on any unit.
    const { draftId } = await open();

    const changed = await editor().update(
      LAYER, draftId, await activeRowId(IN_51), { properties: { status: 'operational' } }, owner, tree
    );
    expect(changed.feature.properties).toMatchObject({ managing_unit: '51', status: 'operational' });
    const made = await editor().create(
      LAYER, draftId, { geometry: point51, properties: { name: 'de-51', managing_unit: '51' } }, owner, tree
    );
    expect(made.feature.properties.managing_unit).toBe('51');
    const removed = await editor().remove(LAYER, draftId, await activeRowId(DAMS[5]), owner);
    expect(removed.revision).toBe(3);

    expect((await draftRows(draftId)).map((r) => [r.name, r.deleted])).toEqual(
      expect.arrayContaining([[`dam-${IN_51}`, false], ['de-51', false], [null, true]])
    );
  });

  it('still validates: an unknown unit, and no unit without a geometry, are refused', async () => {
    const { draftId } = await open();
    const unknown = await httpError(() => editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-x', managing_unit: '99999' } }, owner, tree
    ));
    expect(unknown.status).toBe(400);
    expect(unknown.error.details).toEqual({ formErrors: [], fieldErrors: { managing_unit: ['Mã đơn vị không hợp lệ'] } });
    const unplaced = await httpError(() => editor().create(
      LAYER, draftId, { properties: { name: 'de-nowhere' } }, owner, tree
    ));
    expect(unplaced.status).toBe(400);
    expect(unplaced.error.details).toEqual({ formErrors: [], fieldErrors: { managing_unit: ['Chọn đơn vị chủ quản'] } });
    expect(await revisionOf(draftId)).toBe(0);
  });

  it("editing a feature not yet in the draft copies it from the draft's own state, not the newer active one", async () => {
    const ext = DAMS[6];
    const { draftId } = await open();
    const baseRow = await activeRowId(ext);
    await upstream(ext, 'theirs');

    const res = await editor().update(LAYER, draftId, baseRow, { properties: { status: 'repaired' } }, owner, tree);
    expect(res.feature.properties).toMatchObject({ name: `dam-${ext}`, status: 'repaired' });

    // The draft and the upstream change touched the same dam: the rebase reports it.
    const rebase = await rolledBack(async (c) => {
      await lockDraft(c, draftId, {});
      return rebaseDraft(c, LAYER, draftId);
    });
    expect(rebase.rebased).toBe(false);
    expect(rebase.conflicts.map((x) => x.externalId)).toEqual([String(ext)]);

    // And publishing it answers 409 STALE_EDIT naming the conflicting feature.
    const err = await httpError(() => rolledBack((c) =>
      versionsService(getPool()).publishDraft(c, LAYER, draftId, async () => {})
    ));
    expect(err).toEqual({
      status: 409,
      error: {
        code: 'STALE_EDIT',
        message: 'Bản nháp xung đột với dữ liệu đã xuất bản ở 1 đối tượng.',
        details: { conflicts: [String(ext)] },
      },
    });
  });

  it('a submitted draft refuses discard with DRAFT_NOT_EDITABLE', async () => {
    const { draftId } = await open();
    await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-submitted', managing_unit: '48' } }, owner, tree
    );
    // P4 adds the transition; set the status directly.
    await getPool().query(`UPDATE app.dataset_versions SET draft_status = 'submitted' WHERE id = $1`, [draftId]);

    const err = await httpError(() => editor().discard(LAYER, draftId, owner));
    expect(err).toEqual({
      status: 409,
      error: { code: 'DRAFT_NOT_EDITABLE', message: 'Bản nháp đã được nộp, không sửa được nữa.' },
    });
    // Still there, rows and all.
    expect(await revisionOf(draftId)).toBe(1);
    expect(await draftRows(draftId)).toHaveLength(1);
  });

  it('discarding a draft keeps the audit rows of the edits committed to it', async () => {
    const { draftId } = await open();
    const made = await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-audited', managing_unit: '48' } }, owner, tree
    );
    await editor().update(LAYER, draftId, made.feature.id, { properties: { name: 'de-audited-2' } }, owner, tree);
    const auditRows = async () => (await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.audit_log WHERE feature_id = $1`, [made.feature.id]
    )).rows[0].n;
    expect(await auditRows()).toBe(2);

    await editor().discard(LAYER, draftId, owner);

    expect(await revisionOf(draftId)).toBeNull();
    expect(await auditRows()).toBe(2);
  });

  it('discard removes the draft', async () => {
    const { draftId } = await open();
    await editor().create(
      LAYER, draftId, { geometry: point48, properties: { name: 'de-gone', managing_unit: '48' } }, owner, tree
    );
    expect(await draftRows(draftId)).toHaveLength(1);

    await editor().discard(LAYER, draftId, owner);

    expect(await revisionOf(draftId)).toBeNull();
    expect(await draftRows(draftId)).toEqual([]);
  });
});
