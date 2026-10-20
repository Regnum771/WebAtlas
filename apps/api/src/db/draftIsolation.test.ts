import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import { refreshCurrentRows } from '@webatlas/versioning';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

// Spec, "Isolation": no `_active` view returns a row of any draft version, whatever its status,
// and the assistant role never sees a draft row. Everything here runs on the real layers inside a
// transaction that is always rolled back, so nothing is committed and no cleanup is needed.

const ASSISTANT = 'webatlas_assistant'; // migration 1000000000008
const STATUSES = ['personal', 'submitted', 'returned'] as const;
// Marks every copied draft row, so a view that leaked one would show it by name.
const MARK = `p2-isolation-${randomUUID().slice(0, 8)}`;

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

async function activeVersion(c: pg.PoolClient, layer: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT id::text AS id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer]
  );
  expect(rows, `${layer} has an active version`).toHaveLength(1);
  return rows[0].id;
}

/** The layer's columns a copied row keeps: all but identity, version, the flag, the name. */
async function copyColumns(c: pg.PoolClient, layer: string): Promise<string[]> {
  const { rows } = await c.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'water' AND table_name = $1
        AND column_name NOT IN ('id', 'dataset_version_id', 'is_current', 'name', 'created_at', 'updated_at')
      ORDER BY ordinal_position`,
    [layer]
  );
  return rows.map((r) => r.column_name);
}

/**
 * One draft per status on the layer's active version, each holding copies of current rows
 * (renamed to MARK), with is_current left at its column default. For rivers the copies are a
 * level-1 river that rivers_overview shows and a level-3 order-5 reach, so both level views
 * would pick them up if they read draft rows. Returns the draft ids.
 */
async function makeDrafts(c: pg.PoolClient, layer: EditableLayerKey, owner: string): Promise<string[]> {
  const parent = await activeVersion(c, layer);
  const cols = (await copyColumns(c, layer)).join(', ');
  const sources =
    layer === 'rivers'
      ? [
          `is_current AND feature_level = 1 AND external_id IN (
             SELECT parent_external_id FROM water.rivers WHERE is_current AND feature_level = 3 AND stream_order = 5)`,
          `is_current AND feature_level = 3 AND stream_order = 5`,
        ]
      : ['is_current'];
  const drafts: string[] = [];
  for (const status of STATUSES) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, ingested_by, draft_status)
       VALUES ($1, 'edit', $2, 'draftIsolation.test', 'isolation probe', $3, $4) RETURNING id::text AS id`,
      [layer, parent, owner, status]
    );
    const draft = rows[0].id;
    drafts.push(draft);
    for (const where of sources) {
      const copied = await c.query(
        `INSERT INTO water.${layer} (${cols}, name, dataset_version_id)
         SELECT ${cols}, $1, $2 FROM water.${layer} WHERE ${where} ORDER BY id LIMIT 1`,
        [MARK, draft]
      );
      expect(copied.rowCount, `${layer}: a current row to copy (${where})`).toBe(1);
    }
  }
  // The copies really are there, and not current: the views are what must keep them out.
  const { rows } = await c.query<{ n: number; current: number }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE is_current)::int AS current
       FROM water.${layer} WHERE dataset_version_id = ANY($1::uuid[])`,
    [drafts]
  );
  expect(rows[0]).toEqual({ n: STATUSES.length * sources.length, current: 0 });
  return drafts;
}

async function owner(c: pg.PoolClient): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id::text AS id`,
    [`p2-isolation-${randomUUID()}@webatlas.test`]
  );
  return rows[0].id;
}

/**
 * Rows of `view` that belong to the given draft versions, or carry the probe's name.
 * rivers_overview has no dataset_version_id, so it is checked by name only.
 */
async function leaked(c: pg.PoolClient, view: string, drafts: string[]): Promise<number> {
  const { rows } = view === 'rivers_overview'
    ? await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.rivers_overview WHERE name = $1`, [MARK])
    : await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM water.${view} WHERE dataset_version_id = ANY($1::uuid[]) OR name = $2`,
      [drafts, MARK]
    );
  return rows[0].n;
}

/** Every water view that exposes dataset_version_id: the eight `_active` views and rivers_detail. */
async function versionedViews(c: pg.PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ table_name: string }>(
    `SELECT v.table_name FROM information_schema.views v
      WHERE v.table_schema = 'water'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                     WHERE col.table_schema = 'water' AND col.table_name = v.table_name
                       AND col.column_name = 'dataset_version_id')
      ORDER BY 1`
  );
  return rows.map((r) => r.table_name);
}

describe('draft isolation', () => {
  it('no _active view returns a row of any draft version, whatever its status', async () => {
    await inRolledBackTx(async (c) => {
      const who = await owner(c);
      const drafts = new Map<EditableLayerKey, string[]>();
      for (const layer of EDITABLE_LAYER_KEYS) drafts.set(layer, await makeDrafts(c, layer, who));
      const all = [...drafts.values()].flat();

      const check = async () => {
        for (const layer of EDITABLE_LAYER_KEYS) {
          expect(await leaked(c, `${layer}_active`, drafts.get(layer)!), `${layer}_active`).toBe(0);
        }
        expect(await leaked(c, 'rivers_detail', drafts.get('rivers')!), 'rivers_detail').toBe(0);
        expect(await leaked(c, 'rivers_overview', []), 'rivers_overview').toBe(0);
        // Generic: no view row, in any view that carries a version id, belongs to any draft
        // (ours or one already in the database).
        const views = await versionedViews(c);
        expect(views).toEqual(expect.arrayContaining([...EDITABLE_LAYER_KEYS.map((l) => `${l}_active`), 'rivers_detail']));
        for (const view of views) {
          const { rows } = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM water.${view} t
               JOIN app.dataset_versions d ON d.id = t.dataset_version_id
              WHERE d.draft_status IS NOT NULL`
          );
          expect(rows[0].n, view).toBe(0);
        }
        expect(all).toHaveLength(EDITABLE_LAYER_KEYS.length * STATUSES.length);
      };
      await check();

      // What activation does to the current flags, re-run on each layer's active version, must
      // not pick the draft rows up either: they are not in any active chain.
      for (const layer of EDITABLE_LAYER_KEYS) await refreshCurrentRows(c, layer, await activeVersion(c, layer));
      await check();
    });
  }, 120_000);

  it('the assistant role reads the active views but no draft row in them', async () => {
    await inRolledBackTx(async (c) => {
      const who = await owner(c);
      const dams = await makeDrafts(c, 'dams', who);
      const rivers = await makeDrafts(c, 'rivers', who);
      await c.query(`SET LOCAL ROLE ${ASSISTANT}`);
      const total = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.dams_active`);
      // The role can read the view at all, so the zeros below are not for want of access.
      expect(total.rows[0].n).toBeGreaterThan(0);
      expect(await leaked(c, 'dams_active', dams)).toBe(0);
      expect(await leaked(c, 'rivers_active', rivers)).toBe(0);
      expect(await leaked(c, 'rivers_detail', rivers)).toBe(0);
      expect(await leaked(c, 'rivers_overview', [])).toBe(0);
    });
  });

  it('the assistant role has no privilege on the base tables, the versions or the resolutions', async () => {
    const tables = [
      ...EDITABLE_LAYER_KEYS.map((l) => `water.${l}`),
      'app.dataset_versions', 'app.draft_resolutions', 'app.version_pins',
    ];
    const { rows } = await getPool().query<{ t: string; tbl: boolean; col: boolean }>(
      `SELECT t, has_table_privilege($1, t, 'SELECT') AS tbl, has_any_column_privilege($1, t, 'SELECT') AS col
         FROM unnest($2::text[]) AS t`,
      [ASSISTANT, tables]
    );
    expect(rows).toEqual(tables.map((t) => ({ t, tbl: false, col: false })));
    // Control: the same check does see the grant the role does have.
    const view = await getPool().query<{ ok: boolean }>(
      `SELECT has_table_privilege($1, 'water.dams_active', 'SELECT') AS ok`, [ASSISTANT]
    );
    expect(view.rows[0].ok).toBe(true);
  });
});
