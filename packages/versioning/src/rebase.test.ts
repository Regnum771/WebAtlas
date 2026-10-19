import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { versionsService } from './service';
import { refreshCurrentRows } from './currentRows';
import { resolvedSql } from './resolve';
import { openDraft, lockDraft } from './drafts';
import { ConflictError } from './errors';
import {
  CONTENT_EXCLUDED_KEYS, STALE_RESOLUTION_MESSAGE, changedFeatures, touchedFeatures, listConflicts,
  resolveConflict, rebaseDraft,
} from './rebase';

const LAYER = 'dams';
const SOURCE = 'rebase.test';
const PIN = 'rebase.test';
const EMAIL = 'p2-rebase-owner@webatlas.test';

// Synthetic dams, one or two per test so the tests do not see each other's changes.
const DAMS = Array.from({ length: 11 }, (_, i) => 900501 + i);

const created: string[] = [];
let priorActive: string | null = null;
let owner = '';

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

// The content of a dam is fully determined by (external_id, name, deleted): geometry and the
// managing unit derive from the external_id, so equal names mean equal content.
async function insertDam(
  c: pg.PoolClient, versionId: string, ext: number, name: string, deleted = false
): Promise<void> {
  await c.query(
    `INSERT INTO water.dams
       (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint(108 + ($1 - 900500) * 0.001, 16), 4326), $3, '{}', '{}', '48', $4)`,
    [ext, name, versionId, deleted]
  );
}

async function activeId(): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
  );
  return rows[0].id;
}

/** Publish an upstream change: a new edit version on the active one, activated. */
async function upstream(changes: Array<{ ext: number; name: string; deleted?: boolean }>): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       SELECT $1, 'edit', id, $2, 'rebase-test upstream', false
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       RETURNING id`,
      [LAYER, SOURCE]
    );
    const id = rows[0].id;
    created.push(id);
    for (const ch of changes) await insertDam(c, id, ch.ext, ch.name, ch.deleted ?? false);
    await versionsService(getPool()).activate(c, LAYER, id);
    return id;
  });
}

/** A committed personal draft on the active version, holding the given changes. */
async function draft(changes: Array<{ ext: number; name: string; deleted?: boolean }>): Promise<string> {
  return tx(async (c) => {
    const d = await openDraft(c, LAYER, owner);
    created.push(d.id);
    for (const ch of changes) await insertDam(c, d.id, ch.ext, ch.name, ch.deleted ?? false);
    return d.id;
  });
}

/** Lock the draft as a caller must, then rebase it, in one committed transaction. */
function rebase(draftId: string) {
  return tx(async (c) => {
    await lockDraft(c, draftId);
    return rebaseDraft(c, LAYER, draftId);
  });
}

/** Resolve as a client would: against the active version the conflict list was read under. */
async function resolve(draftId: string, ext: number, choice: 'mine' | 'theirs', against?: string) {
  const seen = against ?? (await listed(draftId)).activeId;
  return tx(async (c) => {
    await lockDraft(c, draftId);
    await resolveConflict(c, LAYER, draftId, String(ext), choice, seen);
  });
}

function listed(draftId: string) {
  return tx((c) => listConflicts(c, LAYER, draftId));
}

async function conflicts(draftId: string) {
  return (await listed(draftId)).conflicts;
}

async function draftState(draftId: string): Promise<{ parent: string; revision: number }> {
  const { rows } = await getPool().query<{ parent: string; revision: number }>(
    `SELECT parent_version_id AS parent, revision FROM app.dataset_versions WHERE id = $1`, [draftId]
  );
  return rows[0];
}

/** The name a version resolves dam `ext` to, or null when the feature is absent. */
async function resolvedName(versionId: string, ext: number): Promise<string | null> {
  const { rows } = await getPool().query<{ name: string }>(
    `SELECT name FROM (${resolvedSql(LAYER, 'external_id, name')}) r WHERE external_id = $2`,
    [versionId, ext]
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
  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // Activating our own ingest root moves the layer's real version out of the active chain, and
  // retention keeps only EARLIER_LOADS_KEPT earlier loads: pin it so no activation here prunes it.
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
       VALUES ($1, 'ingest', $2, 'rebase-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) await insertDam(c, rows[0].id, ext, `dam-${ext}`);
    await versionsService(pool).activate(c, LAYER, rows[0].id);
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

describe('content equality', () => {
  it('excludes exactly the nine bookkeeping keys', () => {
    expect([...CONTENT_EXCLUDED_KEYS]).toEqual([
      'id', 'dataset_version_id', 'is_current', 'created_at', 'updated_at',
      'created_by', 'updated_by', 'province_codes', 'ward_codes',
    ]);
  });
});

describe('rebaseDraft', () => {
  it('no upstream change: nothing to rebase', async () => {
    const [a] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-1' }]);
    const before = await draftState(d);
    expect(await tx((c) => touchedFeatures(c, LAYER, d))).toEqual(new Set([String(a)]));
    expect(await conflicts(d)).toEqual([]);
    expect(await rebase(d)).toEqual({ rebased: false, activeId: await activeId(), conflicts: [] });
    expect(await draftState(d)).toEqual(before);
    await expect(tx((c) => changedFeatures(c, 'x; DROP TABLE y', d, d))).rejects.toThrow();
  });

  it('an unrelated upstream edit rebases cleanly', async () => {
    const [, a, b] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-2' }]);
    const oldParent = (await draftState(d)).parent;
    const up = await upstream([{ ext: b, name: 'theirs-2' }]);
    expect(await tx((c) => changedFeatures(c, LAYER, oldParent, up))).toEqual(new Set([String(b)]));
    expect(await tx((c) => changedFeatures(c, LAYER, up, up))).toEqual(new Set());

    expect(await rebase(d)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await draftState(d)).toEqual({ parent: await activeId(), revision: 1 });
    // The draft now shows its own change on top of the upstream one.
    expect(await resolvedName(d, a)).toBe('mine-2');
    expect(await resolvedName(d, b)).toBe('theirs-2');
  });

  it('the same feature edited on both sides is a conflict with all three states', async () => {
    const [, , , a, other] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-3' }]);
    const before = await draftState(d);
    await upstream([{ ext: a, name: 'theirs-3' }]);

    const res = await rebase(d);
    expect(res.rebased).toBe(false);
    expect(res.activeId).toBe(await activeId());
    expect(res.conflicts).toHaveLength(1);
    const [cf] = res.conflicts;
    expect(cf.externalId).toBe(String(a));
    expect(cf.base?.name).toBe(`dam-${a}`);
    expect(cf.current?.name).toBe('theirs-3');
    expect(cf.draft.name).toBe('mine-3');
    expect(cf.draft.deleted).toBe(false);
    // Bookkeeping keys are not part of the content.
    for (const k of CONTENT_EXCLUDED_KEYS) expect(cf.draft).not.toHaveProperty(k);
    // A refused rebase changes nothing.
    expect(await draftState(d)).toEqual(before);
    // Only a feature in the current conflict list can be resolved.
    await expect(resolve(d, other, 'mine')).rejects.toBeInstanceOf(ConflictError);
  });

  it('theirs drops the draft change and the rebase then succeeds', async () => {
    const [, , , , a] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-4' }]);
    await upstream([{ ext: a, name: 'theirs-4' }]);
    expect((await conflicts(d)).map((x) => x.externalId)).toEqual([String(a)]);

    await resolve(d, a, 'theirs');
    // Dropping the row changed the draft.
    expect((await draftState(d)).revision).toBe(1);
    expect(await tx((c) => touchedFeatures(c, LAYER, d))).toEqual(new Set());
    expect(await conflicts(d)).toEqual([]);
    expect(await rebase(d)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await draftState(d)).toEqual({ parent: await activeId(), revision: 2 });
    expect(await resolvedName(d, a)).toBe('theirs-4');
  });

  it('mine is remembered against this active version only', async () => {
    const [, , , , , a] = DAMS;
    const d = await draft([{ ext: a, name: 'mine-5' }]);
    const first = await upstream([{ ext: a, name: 'theirs-5a' }]);
    await resolve(d, a, 'mine');
    expect((await draftState(d)).revision).toBe(1);
    expect(await conflicts(d)).toEqual([]);
    const { rows } = await getPool().query(
      `SELECT external_id, against_version_id, choice FROM app.draft_resolutions WHERE draft_id = $1`, [d]
    );
    expect(rows).toEqual([{ external_id: String(a), against_version_id: first, choice: 'mine' }]);

    // Upstream changes the feature again before the rebase: the choice no longer counts.
    await upstream([{ ext: a, name: 'theirs-5b' }]);
    const again = await rebase(d);
    expect(again.rebased).toBe(false);
    expect(again.conflicts.map((x) => [x.externalId, x.current?.name])).toEqual([[String(a), 'theirs-5b']]);
    // The refused rebase did not bump the revision.
    expect((await draftState(d)).revision).toBe(1);

    await resolve(d, a, 'mine', again.activeId);
    expect((await draftState(d)).revision).toBe(2);
    expect(await rebase(d)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await draftState(d)).toEqual({ parent: await activeId(), revision: 3 });
    expect(await resolvedName(d, a)).toBe('mine-5');
    // Resolutions belong to the old parent and are dropped by the rebase.
    const left = await getPool().query(`SELECT 1 FROM app.draft_resolutions WHERE draft_id = $1`, [d]);
    expect(left.rowCount).toBe(0);
  });

  it('a choice made against a replaced active version is refused', async () => {
    const a = DAMS[10];
    const d = await draft([{ ext: a, name: 'mine-11' }]);
    const a1 = await upstream([{ ext: a, name: 'theirs-11a' }]);
    const seen = await listed(d);
    expect(seen.activeId).toBe(a1);
    expect(seen.conflicts.map((x) => x.externalId)).toEqual([String(a)]);
    // Upstream publishes again before the user's choice arrives.
    await upstream([{ ext: a, name: 'theirs-11b' }]);

    for (const choice of ['mine', 'theirs'] as const) {
      const err = await resolve(d, a, choice, a1).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toBe(STALE_RESOLUTION_MESSAGE);
    }
    // Nothing was recorded or dropped, and the draft did not change.
    const res = await getPool().query(`SELECT 1 FROM app.draft_resolutions WHERE draft_id = $1`, [d]);
    expect(res.rowCount).toBe(0);
    expect(await tx((c) => touchedFeatures(c, LAYER, d))).toEqual(new Set([String(a)]));
    expect((await draftState(d)).revision).toBe(0);
    expect((await conflicts(d)).map((x) => x.current?.name)).toEqual(['theirs-11b']);
  });

  it('a feature deleted upstream conflicts; theirs drops it, mine restores it', async () => {
    const [, , , , , , dropped, kept, gone] = DAMS;
    const dTheirs = await draft([{ ext: dropped, name: 'mine-6' }]);
    const dMine = await draft([{ ext: kept, name: 'mine-7' }]);
    // The draft deletes a feature that upstream edits: the draft side is a tombstone.
    const dDelete = await draft([{ ext: gone, name: `dam-${gone}`, deleted: true }]);
    await upstream([
      { ext: dropped, name: `dam-${dropped}`, deleted: true },
      { ext: kept, name: `dam-${kept}`, deleted: true },
      { ext: gone, name: 'theirs-8' },
    ]);

    const [c6] = await conflicts(dTheirs);
    expect(c6).toMatchObject({ externalId: String(dropped), current: null });
    expect(c6.base?.name).toBe(`dam-${dropped}`);
    expect(c6.draft.name).toBe('mine-6');
    const [c8] = await conflicts(dDelete);
    expect(c8.current?.name).toBe('theirs-8');
    expect(c8.draft.deleted).toBe(true);

    await resolve(dTheirs, dropped, 'theirs');
    expect(await rebase(dTheirs)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await resolvedName(dTheirs, dropped)).toBeNull();

    await resolve(dMine, kept, 'mine');
    expect(await rebase(dMine)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await resolvedName(dMine, kept)).toBe('mine-7');
    // Publish it (R1: a draft's status is cleared before it is activated).
    await tx(async (c) => {
      await c.query(`UPDATE app.dataset_versions SET draft_status = NULL WHERE id = $1`, [dMine]);
      await versionsService(getPool()).activate(c, LAYER, dMine);
    });
    const { rows } = await getPool().query(
      `SELECT name FROM water.dams_active WHERE external_id = $1`, [kept]
    );
    expect(rows).toEqual([{ name: 'mine-7' }]);
  });

  it('rebases across a re-ingest by content, not row id', async () => {
    const [, , , , , , , , , b] = DAMS;
    const a = DAMS[1];
    const dA = await draft([{ ext: a, name: 'mine-9a' }]);
    const dB = await draft([{ ext: b, name: 'mine-9b' }]);
    const oldActive = await activeId();
    // A new ingest root: fresh rows holding the active content, except for b.
    const root = await tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
         VALUES ($1, 'ingest', $2, 'rebase-test re-ingest', false) RETURNING id`,
        [LAYER, SOURCE]
      );
      const id = rows[0].id;
      created.push(id);
      await c.query(
        `INSERT INTO water.dams
           (external_id, name, name_en, wattage_mw, annual_output, year_launched, year_operational,
            status, geom, managing_unit, deleted, dataset_version_id)
         SELECT external_id, CASE WHEN external_id = $3 THEN 'reingest-9b' ELSE name END, name_en,
                wattage_mw, annual_output, year_launched, year_operational, status, geom,
                managing_unit, false, $2
           FROM (${resolvedSql(LAYER, '*')}) r`,
        [oldActive, id, b]
      );
      await versionsService(getPool()).activate(c, LAYER, id);
      return id;
    });
    expect(await tx((c) => changedFeatures(c, LAYER, oldActive, root))).toEqual(new Set([String(b)]));

    expect(await rebase(dA)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect((await draftState(dA)).parent).toBe(root);
    const res = await rebase(dB);
    expect(res.rebased).toBe(false);
    expect(res.conflicts.map((x) => [x.externalId, x.base?.name, x.current?.name, x.draft.name]))
      .toEqual([[String(b), `dam-${b}`, 'reingest-9b', 'mine-9b']]);
  });

  it('creating different features on both sides does not conflict', async () => {
    const d = await draft([{ ext: 900520, name: 'mine-new' }]);
    await upstream([{ ext: 900521, name: 'theirs-new' }]);
    expect(await conflicts(d)).toEqual([]);
    expect(await rebase(d)).toEqual({ rebased: true, activeId: await activeId(), conflicts: [] });
    expect(await resolvedName(d, 900520)).toBe('mine-new');
    expect(await resolvedName(d, 900521)).toBe('theirs-new');
  });
});
