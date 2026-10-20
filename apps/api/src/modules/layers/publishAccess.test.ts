import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type pg from 'pg';
import type { UnitTree } from '@webatlas/shared';
import { listConflicts, lockDraft, refreshCurrentRows, resolveConflict, versionsService } from '@webatlas/versioning';
import { getPool, closePool } from '../../db/pool';
import errorHandler from '../../plugins/errorHandler';
import { getUnitTree } from '../../authz/unitTree';
import { loadGrants } from '../../authz/grants';
import { getLayer } from '../../layers/registry';
import type { CurrentUser } from '../../types/fastify';
import { draftEditor } from './draftEditor';
import { assertDraftPublishable } from './publishAccess';

const LAYER = 'dams';
const SOURCE = 'publishAccess.test';
const PIN = 'publishAccess.test';
const EMAIL = (who: string) => `p2-publish-access-${who}@webatlas.test`;
const GROUP_PREFIX = 'p2-publish-access-';
const FULL = ['feature.create', 'feature.update', 'feature.delete', 'submission.review'];
const WARD = '20194'; // a ward of province 48

// Synthetic dams, outside publish.test (9006xx), rebase.test (9005xx) and draftEditor.test (9007xx).
const DAMS = Array.from({ length: 12 }, (_, i) => 900801 + i);
const UNIT: Record<number, string> = {
  [DAMS[0]]: WARD, [DAMS[1]]: '48', [DAMS[2]]: '51', [DAMS[3]]: '48', [DAMS[4]]: '48', [DAMS[5]]: '51',
  [DAMS[6]]: '48', [DAMS[7]]: '48', [DAMS[8]]: '48', [DAMS[9]]: '51', [DAMS[10]]: '48', [DAMS[11]]: '48',
};

let root: string | null = null;
let priorActive: string | null = null;
let tree: UnitTree;
const users = new Map<string, CurrentUser>();
const user = (who: string) => users.get(who)!;
const unitName = new Map<string, string>();

const editor = () => draftEditor(getPool());
const def = () => getLayer(LAYER);
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

async function makeUser(who: string, role: 'viewer' | 'admin', groups: Array<{ units: string[]; permissions: string[] }>) {
  const pool = getPool();
  const email = EMAIL(who);
  await pool.query(`DELETE FROM app.users WHERE email = $1`, [email]);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', $2) RETURNING id`, [email, role]
  );
  const id = rows[0].id;
  for (const [i, g] of groups.entries()) {
    const group = await pool.query<{ id: string }>(
      `INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [`${GROUP_PREFIX}${who}-${i}`]
    );
    const groupId = group.rows[0].id;
    for (const u of g.units) {
      await pool.query(`INSERT INTO app.access_group_units (group_id, unit_code) VALUES ($1, $2)`, [groupId, u]);
    }
    for (const p of g.permissions) {
      await pool.query(`INSERT INTO app.access_group_permissions (group_id, permission) VALUES ($1, $2)`, [groupId, p]);
    }
    await pool.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [id, groupId]);
  }
  // The grants the authentication plugin would load for this user.
  users.set(who, { id, email, role, isAdmin: role === 'admin', grants: await loadGrants(pool, id) });
}

async function insertDam(c: pg.PoolClient, versionId: string, ext: number, name: string, unit: string): Promise<void> {
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, 16.1), 4326), $4, '{}', '{}', $5, false)`,
    [ext, name, 108 + (ext - 900800) * 0.001, versionId, unit]
  );
}

async function activeRowId(ext: number): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM water.dams_active WHERE external_id = $1`, [ext]
  );
  return rows[0].id;
}

async function active(ext: number): Promise<{ name: string; status: string | null; managing_unit: string } | null> {
  const { rows } = await getPool().query(
    `SELECT name, status, managing_unit FROM water.dams_active WHERE external_id = $1`, [ext]
  );
  return rows[0] ?? null;
}

async function activeVersionId(): Promise<string> {
  return (await versionsService(getPool()).getActiveVersionId(LAYER))!;
}

async function draftStatus(draftId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ draft_status: string | null }>(
    `SELECT draft_status FROM app.dataset_versions WHERE id = $1`, [draftId]
  );
  return rows[0].draft_status;
}

/** Publish `draftId` as `actor` would: publishDraft with the API's publish guard. */
function publish(draftId: string, actor: CurrentUser): Promise<void> {
  return tx((c) => versionsService(getPool()).publishDraft(
    c, LAYER, draftId, (g) => assertDraftPublishable(g, def(), draftId, { user: actor, tree })
  ));
}

const outOf = (unit: string, permission: string, allowed: string[]) => ({
  code: 'OUT_OF_JURISDICTION',
  message: `Đối tượng thuộc ${unitName.get(unit)}; nhóm của anh/chị chỉ có quyền trong ${allowed.map((u) => unitName.get(u)).join(', ')}.`,
  details: { unit, permission, allowed },
});

beforeAll(async () => {
  const pool = getPool();
  // CI's DB has no users or groups: create our own (deleted in afterAll).
  await pool.query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await makeUser('p', 'viewer', [{ units: ['48'], permissions: FULL }]);
  await makeUser('e', 'viewer', [{ units: ['48'], permissions: ['feature.update', 'submission.review'] }]);
  await makeUser('q', 'viewer', [{ units: ['51'], permissions: FULL }]);
  await makeUser('b', 'viewer', [{ units: ['48', '51'], permissions: FULL }]);
  await makeUser('admin', 'admin', []);
  tree = await getUnitTree(pool);
  const names = await pool.query<{ code: string; name: string }>(
    `SELECT code, name FROM admin.unit_tree WHERE code = ANY($1)`, [['48', '51', WARD, 'VN']]
  );
  for (const r of names.rows) unitName.set(r.code, r.name);

  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits activations on dams: pin every existing version of the layer so retention
  // cannot prune a real ingest while it runs.
  await pool.query(
    `INSERT INTO app.version_pins (version_id, holder)
     SELECT id, $2 FROM app.dataset_versions WHERE layer_key = $1
     ON CONFLICT DO NOTHING`,
    [LAYER, PIN]
  );
  // Our own synthetic root: the layer's active state for the duration of this file. Every
  // version the tests make descends from it, which is how afterAll finds them.
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'publishAccess-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    root = rows[0].id;
    for (const ext of DAMS) await insertDam(c, root, ext, `dam-${ext}`, UNIT[ext]);
    await versionsService(pool).activate(c, LAYER, root);
  });
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...users.values()].map((u) => u.id);
  let ours: string[] = [];
  try {
    await runStages([
      // Put the prior active version back in one transaction: there is never a moment with two
      // active versions, or none.
      async () => {
        if (!priorActive) return;
        await tx(async (c) => {
          await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = $1 AND is_active`, [LAYER]);
          await c.query(`UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [priorActive]);
          await refreshCurrentRows(c, LAYER, priorActive!);
        });
      },
      // The pin's FK is ON DELETE RESTRICT: a leftover would block deleting a real version later.
      () => pool.query(`DELETE FROM app.version_pins WHERE holder = $1`, [PIN]),
      async () => {
        if (!root) return;
        const { rows } = await pool.query<{ id: string }>(
          `WITH RECURSIVE d AS (
             SELECT id FROM app.dataset_versions WHERE id = $1
             UNION ALL
             SELECT v.id FROM app.dataset_versions v JOIN d ON v.parent_version_id = d.id)
           SELECT id FROM d`,
          [root]
        );
        ours = rows.map((r) => r.id);
      },
      () => pool.query(`DELETE FROM app.draft_resolutions WHERE draft_id = ANY($1::uuid[])`, [ours]),
      // Rows first (no cascade from the version); the root's delete cascades to its descendants.
      () => pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [ours]),
      () => pool.query(`DELETE FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [ours]),
      // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
      () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
      () => pool.query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']),
      () => pool.query(`DELETE FROM app.users WHERE email LIKE $1`, [EMAIL('%')]),
    ]);
  } finally {
    await closePool();
  }
});

describe('assertDraftPublishable', () => {
  it('publish checks the managing unit current at publish time', async () => {
    const d = DAMS[0];
    const p = user('p');
    const { draftId } = await editor().open(LAYER, p);
    await editor().update(LAYER, draftId, await activeRowId(d), { properties: { status: 'operational' } }, p, tree);

    // Meanwhile the admin moves the dam to province 51 and publishes.
    const admin = user('admin');
    const moved = await editor().open(LAYER, admin);
    await editor().update(LAYER, moved.draftId, await activeRowId(d), { properties: { managing_unit: '51' } }, admin, tree);
    await publish(moved.draftId, admin);
    expect((await active(d))?.managing_unit).toBe('51');

    // P's draft touched the same dam: publishing it is a conflict first.
    const stale = await httpError(() => publish(draftId, p));
    expect(stale.status).toBe(409);
    expect(stale.error.code).toBe('STALE_EDIT');
    expect(stale.error.details).toEqual({ conflicts: [String(d)] });

    // P keeps their change, against the active version the listing showed.
    await tx(async (c) => {
      await lockDraft(c, draftId, { ownerId: p.id });
      const { activeId, conflicts } = await listConflicts(c, LAYER, draftId);
      expect(conflicts.map((x) => x.externalId)).toEqual([String(d)]);
      await resolveConflict(c, LAYER, draftId, String(d), 'mine', activeId);
    });

    // Now the unit that counts is the one the dam has at publish time, 51: out of P's reach.
    const refused = await httpError(() => publish(draftId, p));
    expect(refused).toEqual({ status: 403, error: outOf('51', 'feature.update', ['48']) });
    expect(await draftStatus(draftId)).toBe('personal');
    expect(await active(d)).toMatchObject({ managing_unit: '51', status: null });
  });

  it('a multi-feature draft is refused whole when one feature is out of reach', async () => {
    const [in48, in51] = [DAMS[1], DAMS[2]];
    const p = user('p');
    const { draftId } = await editor().open(LAYER, p);
    await editor().update(LAYER, draftId, await activeRowId(in48), { properties: { name: 'pa-48' } }, p, tree);
    await editor().update(LAYER, draftId, await activeRowId(in51), { properties: { name: 'pa-51' } }, p, tree);
    const before = await activeVersionId();

    const refused = await httpError(() => publish(draftId, p));
    expect(refused).toEqual({ status: 403, error: outOf('51', 'feature.update', ['48']) });

    expect(await activeVersionId()).toBe(before);
    expect((await active(in48))?.name).toBe(`dam-${in48}`);
    expect((await active(in51))?.name).toBe(`dam-${in51}`);
    expect(await draftStatus(draftId)).toBe('personal');
  });

  it('create, update and delete map to their permissions', async () => {
    // E holds feature.update and submission.review on 48, nothing else.
    const e = user('e');

    const creates = await editor().open(LAYER, e);
    await editor().create(
      LAYER, creates.draftId, { geometry: point48, properties: { name: 'pa-new', managing_unit: '48' } }, e, tree
    );
    const create = await httpError(() => publish(creates.draftId, e));
    expect(create).toEqual({
      status: 403,
      error: { code: 'NO_PERMISSION', message: 'Anh/chị chưa có quyền thêm đối tượng ở đơn vị nào.' },
    });

    const deletes = await editor().open(LAYER, e);
    await editor().remove(LAYER, deletes.draftId, await activeRowId(DAMS[3]), e);
    const remove = await httpError(() => publish(deletes.draftId, e));
    expect(remove).toEqual({
      status: 403,
      error: { code: 'NO_PERMISSION', message: 'Anh/chị chưa có quyền xoá đối tượng ở đơn vị nào.' },
    });
    expect(await active(DAMS[3])).not.toBeNull();

    const updates = await editor().open(LAYER, e);
    await editor().update(LAYER, updates.draftId, await activeRowId(DAMS[4]), { properties: { status: 'built' } }, e, tree);
    await publish(updates.draftId, e);
    expect((await active(DAMS[4]))?.status).toBe('built');

    // P holds every right on 48: the same create and delete go through.
    const p = user('p');
    const both = await editor().open(LAYER, p);
    const made = await editor().create(
      LAYER, both.draftId, { geometry: point48, properties: { name: 'pa-new-p', managing_unit: '48' } }, p, tree
    );
    await editor().remove(LAYER, both.draftId, await activeRowId(DAMS[3]), p);
    await publish(both.draftId, p);
    expect(await active(DAMS[3])).toBeNull();
    const { rows } = await getPool().query(`SELECT name FROM water.dams_active WHERE id = $1`, [made.feature.id]);
    expect(rows[0]?.name).toBe('pa-new-p');
  });

  it('changing the unit needs both units', async () => {
    const d = DAMS[6]; // managed by 48
    const move = async (who: string) => {
      const actor = user(who);
      const { draftId } = await editor().open(LAYER, actor);
      await editor().update(LAYER, draftId, await activeRowId(d), { properties: { managing_unit: '51' } }, actor, tree);
      return () => publish(draftId, actor);
    };

    // P may update in 48 but not in 51, the new unit.
    expect(await httpError(await move('p'))).toEqual({ status: 403, error: outOf('51', 'feature.update', ['48']) });
    // Q may update in 51 but not in 48, the current unit.
    expect(await httpError(await move('q'))).toEqual({ status: 403, error: outOf('48', 'feature.update', ['51']) });
    expect((await active(d))?.managing_unit).toBe('48');

    // B holds both.
    await (await move('b'))();
    expect((await active(d))?.managing_unit).toBe('51');
  });

  it('a feature created and deleted inside the draft is not checked: it changes nothing published', async () => {
    const p = user('p');
    const { draftId } = await editor().open(LAYER, p);
    // Created at the national level, out of P's reach, then deleted again in the same draft.
    const made = await editor().create(
      LAYER, draftId, { properties: { name: 'pa-transient', managing_unit: 'VN' } }, p, tree
    );
    await editor().remove(LAYER, draftId, made.feature.id, p);
    // And one real edit within reach.
    await editor().update(LAYER, draftId, await activeRowId(DAMS[8]), { properties: { name: 'pa-kept' } }, p, tree);

    await publish(draftId, p);

    expect(await activeVersionId()).toBe(draftId);
    expect((await active(DAMS[8]))?.name).toBe('pa-kept');
    const { rows } = await getPool().query(`SELECT 1 FROM water.dams_active WHERE name = 'pa-transient'`);
    expect(rows).toHaveLength(0);
  });

  it('admin publishes anything', async () => {
    const admin = user('admin');
    const { draftId } = await editor().open(LAYER, admin);
    await editor().update(LAYER, draftId, await activeRowId(DAMS[9]), { properties: { name: 'pa-admin-51' } }, admin, tree);
    await editor().update(
      LAYER, draftId, await activeRowId(DAMS[10]), { properties: { managing_unit: '51' } }, admin, tree
    );
    await editor().remove(LAYER, draftId, await activeRowId(DAMS[11]), admin);
    const made = await editor().create(
      LAYER, draftId, { properties: { name: 'pa-admin-vn', managing_unit: 'VN' } }, admin, tree
    );

    await publish(draftId, admin);

    expect(await activeVersionId()).toBe(draftId);
    expect((await active(DAMS[9]))?.name).toBe('pa-admin-51');
    expect((await active(DAMS[10]))?.managing_unit).toBe('51');
    expect(await active(DAMS[11])).toBeNull();
    const { rows } = await getPool().query(`SELECT managing_unit FROM water.dams_active WHERE id = $1`, [made.feature.id]);
    expect(rows[0]?.managing_unit).toBe('VN');
  });
});
