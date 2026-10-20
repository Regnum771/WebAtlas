import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type pg from 'pg';
import type { UnitTree } from '@webatlas/shared';
import { refreshCurrentRows, resolvedSql, versionsService } from '@webatlas/versioning';
import { getPool, closePool } from '../../db/pool';
import errorHandler from '../../plugins/errorHandler';
import { getUnitTree } from '../../authz/unitTree';
import type { CurrentUser } from '../../types/fastify';
import { ConflictError, GeometryError, NotFoundError } from '../../errors';
import { featuresService } from './service';
import { draftEditor } from './draftEditor';

// Direct writes (featuresService) and the durable drafts that replaced P1's edit session
// (draftEditor + publishDraft). Every dams version made here descends from this file's own
// synthetic root; drafts on other layers are listed in `otherDrafts` and discarded.
const LAYER = 'dams';
const SOURCE = 'service.test';
const PIN = 'service.test';
const ADMIN_EMAIL = 'svc-test-admin@webatlas.test';
const NAME = 'svc-test-dam@webatlas.test';
const STATION = 'svc-test-station@webatlas.test';

// Synthetic dams, outside publish.test (9006xx), rebase.test (9005xx), draftEditor.test (9007xx)
// and publishAccess.test (9008xx).
const DAMS = Array.from({ length: 10 }, (_, i) => 900901 + i);

let root: string | null = null;
let priorActive: string | null = null;
let admin: CurrentUser;
let tree: UnitTree;
const otherDrafts: Array<{ layer: string; id: string }> = [];

const svc = () => featuresService(getPool());
const editor = () => draftEditor(getPool());
const at = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

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

async function insertDam(c: pg.PoolClient, versionId: string, ext: number, name: string): Promise<void> {
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, 16.1), 4326), $4, '{}', '{}', '48', false)`,
    [ext, name, 108 + (ext - 900900) * 0.001, versionId]
  );
}

async function activeVersionId(): Promise<string> {
  return (await versionsService(getPool()).getActiveVersionId(LAYER))!;
}
async function resolvedIds(): Promise<string[]> {
  return versionsService(getPool()).resolveFeatureIds(LAYER, await activeVersionId());
}
/** Versions of `dams` this file's admin owns: every draft it opened, published or not. */
async function adminVersionCount(): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.dataset_versions WHERE layer_key = $1 AND ingested_by = $2`,
    [LAYER, admin.id]
  );
  return rows[0].n;
}
async function draftCount(): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app.dataset_versions WHERE layer_key = $1 AND draft_status IS NOT NULL`, [LAYER]
  );
  return rows[0].n;
}
async function activeRowId(ext: number): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(`SELECT id FROM water.dams_active WHERE external_id = $1`, [ext]);
  return rows[0].id;
}
/** The active state of the feature a row id belongs to. */
async function activeRow(id: string) {
  const { rows } = await getPool().query(
    `SELECT name, wattage_mw::float AS wattage_mw, status FROM water.dams_active
     WHERE external_id = (SELECT external_id FROM water.dams WHERE id = $1)`, [id]
  );
  return rows[0];
}

/** A new feature, published by a direct write; returns its row. */
async function createCommitted(name: string, props: Record<string, unknown>) {
  const { feature } = await svc().create(
    LAYER, { geometry: at(105.41, 20.61), properties: { name, ...props } }, admin, tree
  );
  return feature;
}

/** Publish an upstream change to one dam: a new edit version on the active one, activated. */
async function upstream(ext: number, props: { name?: string; status?: string }): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       SELECT $1, 'edit', id, $2, 'service-test upstream', false
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       RETURNING id`,
      [LAYER, SOURCE]
    );
    const id = rows[0].id;
    await c.query(
      `INSERT INTO water.dams (external_id, name, status, geom, dataset_version_id, managing_unit, deleted)
       SELECT external_id, coalesce($3, name), coalesce($4, status), geom, $2, managing_unit, false
         FROM water.dams_active WHERE external_id = $1`,
      [ext, id, props.name ?? null, props.status ?? null]
    );
    await versionsService(getPool()).activate(c, LAYER, id);
    return id;
  });
}

/**
 * Run `write` (one direct write) with the layer moved on by `move` after the write opened its
 * draft and before it publishes: `move` runs, on its own connection, right before the write's
 * transaction locks the active row.
 */
async function withLayerMovedBeforePublish<T>(move: () => Promise<unknown>, write: () => Promise<T>): Promise<T> {
  const pool: any = getPool();
  const realConnect = pool.connect.bind(pool);
  let taken = false;
  let intercepted: any;
  pool.connect = (...args: unknown[]) => {
    // pool.query checks clients out through connect(callback): leave those alone. Only the
    // write's own client (the first promise-style checkout) is intercepted; `move` and everything
    // after it get ordinary clients.
    if (args.length > 0 || taken) return realConnect(...args);
    taken = true;
    return (async () => {
      const client = await realConnect();
      intercepted = client;
      const realQuery = client.query.bind(client);
      let moved = false;
      client.query = async (sql: unknown, ...rest: unknown[]) => {
        if (!moved && typeof sql === 'string' && sql.includes('FOR NO KEY UPDATE')) {
          moved = true;
          await move();
        }
        return realQuery(sql, ...rest);
      };
      return client;
    })();
  };
  try {
    return await write();
  } finally {
    delete pool.connect; // restore the prototype method
    if (intercepted) delete intercepted.query;
  }
}

beforeAll(async () => {
  const pool = getPool();
  // CI's DB has no users: create our own (deleted in afterAll). A real row, because created_by,
  // audit_log.user_id and a draft's owner reference it. Admin passes every publish check, which
  // publishAccess.test.ts and jurisdiction.test.ts cover.
  await pool.query(`DELETE FROM app.users WHERE email = $1`, [ADMIN_EMAIL]);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, full_name, role) VALUES ($1, 'x', 'svc-test', 'admin') RETURNING id`,
    [ADMIN_EMAIL]
  );
  admin = { id: rows[0].id, email: ADMIN_EMAIL, role: 'admin', isAdmin: true, grants: [] };
  tree = await getUnitTree(pool);

  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits activations on dams: pin every existing version of the layer so retention
  // cannot prune a real ingest while it runs.
  await pool.query(
    `INSERT INTO app.version_pins (version_id, holder)
     SELECT id, $2 FROM app.dataset_versions WHERE layer_key = $1
     ON CONFLICT DO NOTHING`,
    [LAYER, PIN]
  );
  await tx(async (c) => {
    const { rows: made } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'service-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    root = made[0].id;
    for (const ext of DAMS) await insertDam(c, root, ext, `dam-${ext}`);
    await versionsService(pool).activate(c, LAYER, root);
  });
});

afterAll(async () => {
  const pool = getPool();
  let ours: string[] = [];
  // Until the prior version is active again, one of ours is the active version of dams: deleting
  // our versions then would leave the layer with none.
  let restored = priorActive === null;
  try {
    await runStages([
      // Put the prior active version back in one transaction.
      async () => {
        if (!priorActive) return;
        await tx(async (c) => {
          await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = $1 AND is_active`, [LAYER]);
          const flipped = await c.query(`UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [priorActive]);
          // A vanished prior version would otherwise commit the layer with no active version.
          if (flipped.rowCount !== 1) throw new Error(`prior active version ${priorActive} is gone`);
          await refreshCurrentRows(c, LAYER, priorActive!);
        });
        restored = true;
      },
      // The pin's FK is ON DELETE RESTRICT: a leftover would block deleting a real version later.
      () => pool.query(`DELETE FROM app.version_pins WHERE holder = $1`, [PIN]),
      async () => {
        if (!root || !restored) return;
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
      // Rows first (no cascade from the version), then the versions.
      () => pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [ours]),
      () => pool.query(`DELETE FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [ours]),
      // Drafts on other layers: normally discarded by their test already.
      async () => {
        for (const d of otherDrafts) {
          await pool.query(`DELETE FROM water.${d.layer} WHERE dataset_version_id = $1`, [d.id]);
          await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1 AND draft_status IS NOT NULL`, [d.id]);
        }
      },
      // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their user.
      () => pool.query(`DELETE FROM app.audit_log WHERE user_id = $1`, [admin?.id]),
      () => pool.query(`DELETE FROM app.users WHERE email = $1`, [ADMIN_EMAIL]),
    ]);
  } finally {
    await closePool();
  }
});

describe('featuresService direct writes', () => {
  it('rejects an unknown layer key with NotFoundError', async () => {
    await expect(svc().list('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a refused direct write leaves no draft behind', async () => {
    const before = await adminVersionCount();
    await expect(svc().create(LAYER, {
      geometry: { type: 'LineString', coordinates: [[105, 21], [106, 22]] }, properties: { name: NAME },
    }, admin, tree)).rejects.toBeInstanceOf(GeometryError);
    await expect(svc().update(
      LAYER, '00000000-0000-0000-0000-000000000000', { properties: { name: NAME } }, admin, tree
    )).rejects.toBeInstanceOf(NotFoundError);
    expect(await adminVersionCount()).toBe(before);
  });

  it('publishes exactly one labelled edit-version and makes the new feature resolve', async () => {
    const beforeCount = (await resolvedIds()).length;
    const before = await adminVersionCount();
    const parent = await activeVersionId();

    const { feature, warnings } = await svc().create(
      LAYER, { geometry: at(105.8, 21.0), properties: { name: NAME } }, admin, tree
    );
    expect(warnings).toEqual([]);

    expect(await resolvedIds()).toContain(feature.id);
    expect((await resolvedIds()).length).toBe(beforeCount + 1);
    expect(await adminVersionCount()).toBe(before + 1);
    const { rows } = await getPool().query(
      `SELECT kind, source, label, parent_version_id, feature_count, is_active, draft_status, ingested_by
       FROM app.dataset_versions WHERE id = $1`, [await activeVersionId()]
    );
    expect(rows[0]).toMatchObject({
      kind: 'edit', source: 'edit session', parent_version_id: parent, feature_count: 1, is_active: true,
      draft_status: null, ingested_by: admin.id,
    });
    expect(rows[0].label).toMatch(/^\d{4}-\d{2}-\d{2} edits$/);

    // And the edit is audited.
    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1`, [feature.id]
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['create']);
  });

  // Copy-on-write: editing an inherited feature must not touch the parent's row.
  it('an update copies the inherited feature into a new version, leaving the parent row intact', async () => {
    const ext = DAMS[0];
    const original = await activeRowId(ext);
    const parentVersion = await activeVersionId();

    const { feature } = await svc().update(LAYER, original, { properties: { status: 'decommissioned' } }, admin, tree);

    expect(feature.id).not.toBe(original);
    expect(feature.properties.status).toBe('decommissioned');
    const parentRow = await getPool().query(
      `SELECT status, dataset_version_id FROM water.dams WHERE id = $1`, [original]
    );
    expect(parentRow.rows[0]).toEqual({ status: null, dataset_version_id: root });
    expect(await activeVersionId()).not.toBe(parentVersion);
    const ids = await resolvedIds();
    expect(ids).toContain(feature.id);
    expect(ids).not.toContain(original);
  });

  // A delete is a tombstone, not a physical removal: the parent keeps its row.
  it('a remove tombstones and drops the feature from the resolved set', async () => {
    const ext = DAMS[1];
    const original = await activeRowId(ext);
    const beforeCount = (await resolvedIds()).length;

    await svc().remove(LAYER, original, admin, tree);

    expect((await resolvedIds()).length).toBe(beforeCount - 1);
    expect(await resolvedIds()).not.toContain(original);
    const still = await getPool().query(`SELECT deleted FROM water.dams WHERE id = $1`, [original]);
    expect(still.rows[0].deleted).toBe(false);
  });

  // The client must go back to the pool on every path, a failing COMMIT included, or the pool
  // runs dry and the API deadlocks.
  it('returns the client to the pool when COMMIT itself fails', async () => {
    const pool = getPool();
    const before = await adminVersionCount();
    const realConnect = pool.connect.bind(pool);
    // Intercept the one client the write checks out and make its COMMIT reject, leaving every
    // other query intact. pool.query checks out through connect(callback): passed through as is.
    let intercepted: any;
    (pool as any).connect = (...args: unknown[]) => {
      if (args.length > 0 || intercepted) return (realConnect as any)(...args);
      return (async () => {
        const client: any = await realConnect();
        intercepted = client;
        const realQuery = client.query.bind(client);
        client.query = (sql: any, ...rest: any[]) => {
          if (typeof sql === 'string' && sql.trim().toUpperCase() === 'COMMIT') {
            return Promise.reject(new Error('injected COMMIT failure'));
          }
          return realQuery(sql, ...rest);
        };
        return client;
      })();
    };

    const idleBefore = pool.idleCount;
    const totalBefore = pool.totalCount;
    try {
      await expect(svc().create(
        LAYER, { geometry: at(105.3, 20.5), properties: { name: NAME } }, admin, tree
      )).rejects.toThrow('injected COMMIT failure');
    } finally {
      delete (pool as any).connect; // restore the prototype method
      if (intercepted) delete intercepted.query;
    }

    // The client came back: the pool holds no more connections than it did, and the one it
    // took out is idle again rather than checked out forever.
    expect(pool.totalCount).toBe(totalBefore + (totalBefore === 0 ? 1 : 0));
    expect(pool.idleCount).toBeGreaterThanOrEqual(Math.min(idleBefore, 1));
    expect(pool.totalCount - pool.idleCount).toBe(totalBefore - idleBefore);

    // The transaction never committed, so nothing it wrote survives: no row, no draft.
    const orphan = await pool.query(`SELECT count(*)::int AS n FROM water.dams WHERE ST_X(geom) = 105.3`);
    expect(orphan.rows[0].n).toBe(0);
    expect(await adminVersionCount()).toBe(before);
  });

  // ---- Edits apply on the feature's CURRENT state, not on the row the request names ----

  it("a stale-id partial update keeps the other user's change and audits the current state as before", async () => {
    const name = 'svc-test-stale-update@webatlas.test';
    const f = await createCommitted(name, { wattage_mw: 10, status: 'planned' });
    // Another write changes field A (status), superseding F's original row.
    await svc().update(LAYER, f.id, { properties: { status: 'built' } }, admin, tree);
    expect(await activeRow(f.id)).toMatchObject({ status: 'built', wattage_mw: 10 });

    // A client still holding the ORIGINAL row id sends only field B.
    await svc().update(LAYER, f.id, { properties: { wattage_mw: 20 } }, admin, tree);
    expect(await activeRow(f.id)).toMatchObject({ name, status: 'built', wattage_mw: 20 });

    const audit = await getPool().query(
      `SELECT before, after FROM app.audit_log WHERE feature_id = $1 AND action = 'update'`, [f.id]
    );
    const second = audit.rows.find((r) => Number(r.after.properties.wattage_mw) === 20);
    expect(second).toBeDefined();
    expect(second.before.properties.status).toBe('built');
    expect(Number(second.before.properties.wattage_mw)).toBe(10);
  });

  it('a stale-id delete removes the feature from the active view', async () => {
    const f = await createCommitted('svc-test-stale-delete@webatlas.test', { status: 'planned' });
    await svc().update(LAYER, f.id, { properties: { status: 'built' } }, admin, tree);
    await svc().remove(LAYER, f.id, admin, tree);
    expect(await activeRow(f.id)).toBeUndefined();
    const del = await getPool().query(
      `SELECT before FROM app.audit_log WHERE feature_id = $1 AND action = 'delete'`, [f.id]
    );
    expect(del.rows).toHaveLength(1);
    expect(del.rows[0].before.properties.status).toBe('built');
  });

  it('an update naming the original row of a feature deleted meanwhile is a NotFoundError', async () => {
    const f = await createCommitted('svc-test-deleted-meanwhile@webatlas.test', {});
    await svc().remove(LAYER, f.id, admin, tree);
    await expect(svc().update(LAYER, f.id, { properties: { status: 'x' } }, admin, tree))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('a remove naming the original row of a feature deleted meanwhile is a NotFoundError', async () => {
    const f = await createCommitted('svc-test-remove-deleted@webatlas.test', {});
    await svc().remove(LAYER, f.id, admin, tree);
    await expect(svc().remove(LAYER, f.id, admin, tree)).rejects.toBeInstanceOf(NotFoundError);
  });

  // P1 refused a direct write whose layer moved on as stale and retried it; it is now rebased.
  it('a direct write whose layer moved on meanwhile is rebased onto it', async () => {
    const [mine, theirs] = [DAMS[2], DAMS[3]];
    let up = '';
    const { feature } = await withLayerMovedBeforePublish(
      async () => { up = await upstream(theirs, { name: 'svc-theirs' }); },
      async () => svc().update(LAYER, await activeRowId(mine), { properties: { name: 'svc-mine' } }, admin, tree)
    );

    expect(up).not.toBe('');
    const active = await activeVersionId();
    const { rows } = await getPool().query(
      `SELECT parent_version_id, draft_status FROM app.dataset_versions WHERE id = $1`, [active]
    );
    expect(rows[0]).toEqual({ parent_version_id: up, draft_status: null });
    expect(await activeRow(feature.id)).toMatchObject({ name: 'svc-mine' });
    expect((await getPool().query(`SELECT name FROM water.dams_active WHERE external_id = $1`, [theirs])).rows[0].name)
      .toBe('svc-theirs');
  });

  it('a direct write that collides with a concurrent change to the same feature is refused with 409 STALE_EDIT', async () => {
    const ext = DAMS[4];
    const before = await adminVersionCount();
    let up = '';
    const err = await httpError(() => withLayerMovedBeforePublish(
      async () => { up = await upstream(ext, { status: 'built' }); },
      async () => svc().update(LAYER, await activeRowId(ext), { properties: { wattage_mw: 20 } }, admin, tree)
    ));

    expect(err).toEqual({
      status: 409,
      error: {
        code: 'STALE_EDIT',
        message: 'Bản nháp xung đột với dữ liệu đã xuất bản ở 1 đối tượng.',
        details: { conflicts: [String(ext)] },
      },
    });
    // The concurrent change stands, and the refused write left no draft.
    expect(await activeVersionId()).toBe(up);
    expect(await activeRow(await activeRowId(ext))).toMatchObject({ status: 'built', wattage_mw: null });
    expect(await adminVersionCount()).toBe(before);
  });
});

describe('durable drafts in place of the edit session (draftEditor + publishDraft)', () => {
  const publish = (draftId: string) =>
    tx((c) => versionsService(getPool()).publishDraft(c, LAYER, draftId, async () => {}));

  it('edits in a draft do not change what the active version resolves; discard leaves nothing', async () => {
    const beforeIds = await resolvedIds();
    const drafts = await draftCount();
    const { draftId } = await editor().open(LAYER, admin);
    await editor().create(LAYER, draftId, { geometry: at(105.8, 21.0), properties: { name: NAME } }, admin, tree);

    expect(await resolvedIds()).toEqual(beforeIds);

    await editor().discard(LAYER, draftId, admin);
    expect(await resolvedIds()).toEqual(beforeIds);
    expect(await draftCount()).toBe(drafts);
  });

  // The resolver keys on external_id with DISTINCT ON, which collapses all NULL-external_id rows
  // into one. Two steward-created features must therefore each get a distinct synthetic
  // external_id, in the column's own type.
  it('gives each created feature a distinct external_id on an integer-typed layer (dams)', async () => {
    const beforeCount = (await resolvedIds()).length;
    const { draftId } = await editor().open(LAYER, admin);
    const a = await editor().create(LAYER, draftId, { geometry: at(105.7, 20.9), properties: { name: NAME } }, admin, tree);
    const b = await editor().create(LAYER, draftId, { geometry: at(105.6, 20.8), properties: { name: NAME } }, admin, tree);
    await publish(draftId);

    const ids = await resolvedIds();
    expect(ids).toContain(a.feature.id);
    expect(ids).toContain(b.feature.id);
    expect(ids.length).toBe(beforeCount + 2);
    const ext = await getPool().query(`SELECT external_id FROM water.dams WHERE id = ANY($1)`, [[a.feature.id, b.feature.id]]);
    const values = ext.rows.map((r) => r.external_id);
    expect(new Set(values).size).toBe(2);
    // Allocated above the upstream range so a later ingest cannot collide.
    for (const v of values) expect(Number(v)).toBeGreaterThan(1_000_000);
  });

  it('gives each created feature a distinct external_id on a text-typed layer (stations)', async () => {
    const { draftId } = await editor().open('stations', admin);
    otherDrafts.push({ layer: 'stations', id: draftId });
    const parent = (await getPool().query(`SELECT parent_version_id AS p FROM app.dataset_versions WHERE id = $1`, [draftId])).rows[0].p;
    const a = await editor().create('stations', draftId, { geometry: at(105.7, 20.9), properties: { name: STATION } }, admin, tree);
    const b = await editor().create('stations', draftId, { geometry: at(105.6, 20.8), properties: { name: STATION } }, admin, tree);

    // What the draft resolves to: its parent's features plus both new ones.
    const count = async (v: string) => (await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${resolvedSql('stations')}) r`, [v]
    )).rows[0].n;
    const resolved = await getPool().query<{ id: string }>(`${resolvedSql('stations')}`, [draftId]);
    expect(resolved.rows.map((r) => r.id)).toEqual(expect.arrayContaining([a.feature.id, b.feature.id]));
    expect(await count(draftId)).toBe(await count(parent) + 2);
    const ext = await getPool().query(`SELECT external_id FROM water.stations WHERE id = ANY($1)`, [[a.feature.id, b.feature.id]]);
    const values = ext.rows.map((r) => r.external_id as string);
    expect(new Set(values).size).toBe(2);
    for (const v of values) expect(v).toMatch(/^edit:/);

    await editor().discard('stations', draftId, admin);
  });

  // P1 refused the second of two concurrent sessions as stale; its draft is now rebased.
  it('two drafts on one layer: the second publishes after the first by rebasing onto it', async () => {
    const [x, y] = [DAMS[5], DAMS[6]];
    const a = await editor().open(LAYER, admin);
    const b = await editor().open(LAYER, admin);
    await editor().update(LAYER, a.draftId, await activeRowId(x), { properties: { name: 'svc-a' } }, admin, tree);
    await editor().update(LAYER, b.draftId, await activeRowId(y), { properties: { name: 'svc-b' } }, admin, tree);

    await publish(a.draftId);
    await publish(b.draftId);

    expect(await activeVersionId()).toBe(b.draftId);
    const parent = await getPool().query(`SELECT parent_version_id AS p FROM app.dataset_versions WHERE id = $1`, [b.draftId]);
    expect(parent.rows[0].p).toBe(a.draftId);
    const names = await getPool().query<{ external_id: number; name: string }>(
      `SELECT external_id, name FROM water.dams_active WHERE external_id = ANY($1) ORDER BY external_id`, [[x, y]]
    );
    expect(names.rows.map((r) => r.name)).toEqual(['svc-a', 'svc-b']);
  });

  it('two drafts changing the same feature: the second is refused with 409 STALE_EDIT naming it', async () => {
    const ext = DAMS[7];
    const a = await editor().open(LAYER, admin);
    const b = await editor().open(LAYER, admin);
    await editor().update(LAYER, a.draftId, await activeRowId(ext), { properties: { status: 'built' } }, admin, tree);
    await editor().update(LAYER, b.draftId, await activeRowId(ext), { properties: { wattage_mw: 20 } }, admin, tree);

    await publish(a.draftId);
    const err = await httpError(() => publish(b.draftId));

    expect(err.status).toBe(409);
    expect(err.error.code).toBe('STALE_EDIT');
    expect(err.error.details).toEqual({ conflicts: [String(ext)] });
    expect(await activeVersionId()).toBe(a.draftId);
    expect(await activeRow(await activeRowId(ext))).toMatchObject({ status: 'built', wattage_mw: null });
    await editor().discard(LAYER, b.draftId, admin);
  });

  it('two updates naming the original row in one draft produce a single draft row with both changes', async () => {
    const f = await createCommitted('svc-test-two-updates@webatlas.test', { wattage_mw: 10, status: 'planned' });
    const { draftId } = await editor().open(LAYER, admin);
    await editor().update(LAYER, draftId, f.id, { properties: { status: 'built' } }, admin, tree);
    await editor().update(LAYER, draftId, f.id, { properties: { wattage_mw: 20 } }, admin, tree);
    await publish(draftId);

    expect(await activeRow(f.id)).toMatchObject({ status: 'built', wattage_mw: 20 });
    const rows = await getPool().query(`SELECT count(*)::int AS n FROM water.dams WHERE dataset_version_id = $1`, [draftId]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('editing a feature deleted earlier in the same draft is a NotFoundError', async () => {
    const { draftId } = await editor().open(LAYER, admin);
    const row = await activeRowId(DAMS[8]);
    await editor().remove(LAYER, draftId, row, admin);
    await expect(editor().update(LAYER, draftId, row, { properties: { status: 'x' } }, admin, tree))
      .rejects.toBeInstanceOf(NotFoundError);
    await editor().discard(LAYER, draftId, admin);
  });

  // Rivers: only level-3 OSM ways are edited by hand (user decision 2026-09-29). Every case
  // below discards its draft -- publishing rivers runs the whole hierarchy rebuild.
  async function riverRowAt(level: number): Promise<{ id: string; geometry: unknown }> {
    const { rows } = await getPool().query<{ id: string; geometry: unknown }>(
      `SELECT id, ST_AsGeoJSON(geom)::jsonb AS geometry FROM water.rivers_active
        WHERE feature_level = $1 AND name IS NOT NULL ORDER BY external_id LIMIT 1`,
      [level]
    );
    return rows[0];
  }
  async function openRivers(): Promise<string> {
    const { draftId } = await editor().open('rivers', admin);
    otherDrafts.push({ layer: 'rivers', id: draftId });
    return draftId;
  }

  it('refuses any edit to a level-1 river, attribute-only included', async () => {
    // A level-1 river's name and geometry are rebuilt from its ways on every publish, so an
    // edit here would be silently reverted in the same publish.
    const river = await riverRowAt(1);
    const draftId = await openRivers();
    await expect(editor().update('rivers', draftId, river.id, { properties: { name: 'Sông Đổi Tên' } }, admin, tree))
      .rejects.toBeInstanceOf(ConflictError);
    await editor().discard('rivers', draftId, admin);
  });

  it('refuses deleting a level-1 river or a level-2 reach', async () => {
    const draftId = await openRivers();
    for (const level of [1, 2]) {
      const row = level === 2
        ? (await getPool().query<{ id: string }>(
            `SELECT id FROM water.rivers_active WHERE feature_level = 2 ORDER BY external_id LIMIT 1`
          )).rows[0]
        : await riverRowAt(1);
      await expect(editor().remove('rivers', draftId, row.id, admin), `level ${level}`).rejects.toBeInstanceOf(ConflictError);
    }
    await editor().discard('rivers', draftId, admin);
  });

  it('still lets a steward edit a level-3 way', async () => {
    const way = await riverRowAt(3);
    const draftId = await openRivers();
    const after = await editor().update('rivers', draftId, way.id, {
      geometry: way.geometry as never, properties: { name: 'Sông Đổi Tên' },
    }, admin, tree);
    expect(after.feature.properties.name).toBe('Sông Đổi Tên');
    await editor().discard('rivers', draftId, admin);
  });
});
