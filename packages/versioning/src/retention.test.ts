import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { assertPrunable, EARLIER_LOADS_KEPT, loadFeatures, openDraft, pruneVersions, versionsService } from './index';
import { DraftConflictError } from './errors';

// The real stations layer, inside transactions that are rolled back. Unlike the other suites,
// existing versions are NOT pinned here: pruning them inside the transaction is the point.
const dir = mkdtempSync(join(tmpdir(), 'retention-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});
const file = join(dir, 'stations.geojson');
writeFileSync(file, JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'rt-1', name: 'R' } }],
}));

async function inRollback(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

const svc = () => versionsService(getPool());

async function load(c: pg.PoolClient, label: string): Promise<string> {
  const id = await svc().createIngestVersion(c, { layerKey: 'stations', source: 'retention.test', label });
  await loadFeatures(c, { table: 'stations', file, columns: (p) => ({ external_id: p.id, name: p.name }) }, id);
  await svc().activate(c, 'stations', id);
  return id;
}

/** A throwaway draft owner, created inside the test's rolled-back transaction (CI seeds no users). */
async function draftOwner(c: pg.PoolClient): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id`,
    [`p2-retention-${randomUUID()}@webatlas.test`]
  );
  return rows[0].id;
}

const noGuard = async () => {};

async function edit(c: pg.PoolClient): Promise<string> {
  const { id: draft } = await openDraft(c, 'stations', await draftOwner(c));
  await svc().publishDraft(c, 'stations', draft, noGuard);
  return draft;
}

const stationVersions = async (c: pg.PoolClient) =>
  (await c.query<{ id: string }>(`SELECT id::text AS id FROM app.dataset_versions WHERE layer_key = 'stations'`)).rows
    .map((r) => r.id).sort();
const rowsOf = async (c: pg.PoolClient, versionId: string) =>
  (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1`, [versionId])).rows[0].n;

describe('retention', () => {
  it('keeps the active chain and the two most recent earlier loads with their edits, and removes the rest with their rows', async () => {
    expect(EARLIER_LOADS_KEPT).toBe(2);
    await inRollback(async (c) => {
      const l1 = await load(c, 'L1');
      const e1 = await edit(c); // on L1
      const l2 = await load(c, 'L2');
      const e2 = await edit(c); // on L2
      const l3 = await load(c, 'L3');
      const l4 = await load(c, 'L4');
      // Active chain: L4. Earlier loads, newest first: L3, L2 (with E2). L1 and E1 go, and so
      // does every version this layer had before the test.
      expect(await stationVersions(c)).toEqual([l2, e2, l3, l4].sort());
      expect(await rowsOf(c, l1)).toBe(0);
      expect(await rowsOf(c, e1)).toBe(0);
      expect(await rowsOf(c, l2)).toBe(1);
    });
  });

  it('keeps a pinned version and its chain to the root, however old', async () => {
    await inRollback(async (c) => {
      const l1 = await load(c, 'L1');
      const e1 = await edit(c);
      await c.query(`INSERT INTO app.version_pins (version_id, holder) VALUES ($1, 'scenario:test')`, [e1]);
      await load(c, 'L2');
      await load(c, 'L3');
      await load(c, 'L4');
      const kept = await stationVersions(c);
      expect(kept).toContain(e1);
      expect(kept).toContain(l1);
      expect(await rowsOf(c, l1)).toBe(1);
    });
  });

  it('the active state is unchanged by pruning', async () => {
    await inRollback(async (c) => {
      for (const label of ['L1', 'L2', 'L3', 'L4']) await load(c, label);
      // Unactivated loads add versions retention would remove; the active view must not move.
      const extra = [await svc().createIngestVersion(c, { layerKey: 'stations', source: 'retention.test', label: 'X1' }),
        await svc().createIngestVersion(c, { layerKey: 'stations', source: 'retention.test', label: 'X2' }),
        await svc().createIngestVersion(c, { layerKey: 'stations', source: 'retention.test', label: 'X3' })];
      const activeIds = async () =>
        (await c.query<{ id: string }>(`SELECT id::text AS id FROM water.stations_active ORDER BY id`)).rows.map((r) => r.id);
      const before = await activeIds();
      expect(before.length).toBeGreaterThan(0);
      const pruned = await pruneVersions(c, 'stations');
      expect(pruned.versions).toBeGreaterThan(0);
      // Retention keeps the two newest unactivated loads and drops the oldest.
      const kept = await stationVersions(c);
      expect(kept).not.toContain(extra[0]);
      expect(kept).toContain(extra[1]);
      expect(kept).toContain(extra[2]);
      expect(await activeIds()).toEqual(before);
      const { rows } = await c.query(`SELECT name FROM water.stations_active WHERE external_id = 'rt-1'`);
      expect(rows).toEqual([{ name: 'R' }]);
    });
  });

  it('keeps an open draft and its parent chain across activations', async () => {
    await inRollback(async (c) => {
      const a1 = await load(c, 'A1');
      // Draft D opens on A1 and stays open (draft_status set, never activated).
      const { id: d } = await openDraft(c, 'stations', await draftOwner(c));
      // Another edit E is published on A1 and becomes active; its activation prunes.
      const e = await edit(c);
      expect(await stationVersions(c)).toContain(d);
      // Newer ingests push A1 out of the active chain and then out of the EARLIER_LOADS_KEPT
      // window of earlier loads.
      const newer: string[] = [];
      for (let i = 0; i <= EARLIER_LOADS_KEPT; i++) newer.push(await load(c, `N${i}`));
      const kept = await stationVersions(c);
      // E is neither a draft nor an ancestor of one, so it goes with A1's tree.
      expect(kept).not.toContain(e);
      expect(kept).toContain(d);
      // D's whole ancestor chain is still there, with its rows.
      const { rows: chain } = await c.query<{ id: string }>(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_version_id FROM app.dataset_versions WHERE id = $1
           UNION ALL
           SELECT p.id, p.parent_version_id FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
         )
         SELECT id::text AS id FROM chain`,
        [d]
      );
      expect(chain.map((r) => r.id).sort()).toEqual([a1, d].sort());
      expect(await rowsOf(c, a1)).toBe(1);
    });
  });

  it('a layer with no active version is left alone', async () => {
    await inRollback(async (c) => {
      for (const label of ['L1', 'L2', 'L3', 'L4']) await load(c, label);
      await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = 'stations'`);
      const before = await stationVersions(c);
      expect(await pruneVersions(c, 'stations')).toEqual({ versions: 0, rows: 0 });
      expect(await stationVersions(c)).toEqual(before);
    });
  });
});

describe('publishDraft on a draft whose layer moved on', () => {
  it('refuses the second of two drafts that change the same feature and keeps the first active', async () => {
    await inRollback(async (c) => {
      const l1 = await load(c, 'L1');
      const owner = await draftOwner(c);
      const { id: a } = await openDraft(c, 'stations', owner);
      const { id: b } = await openDraft(c, 'stations', owner);
      // Both drafts change rt-1, so once a is published b conflicts with it.
      for (const [draft, name] of [[a, 'R by a'], [b, 'R by b']]) {
        await c.query(
          `INSERT INTO water.stations (external_id, name, geom, dataset_version_id)
           SELECT external_id, $3, geom, $1 FROM water.stations WHERE dataset_version_id = $2 AND external_id = 'rt-1'`,
          [draft, l1, name]
        );
      }
      await svc().publishDraft(c, 'stations', a, noGuard);
      await c.query('SAVEPOINT stale');
      await expect(svc().publishDraft(c, 'stations', b, noGuard)).rejects.toThrow(DraftConflictError);
      await c.query('ROLLBACK TO SAVEPOINT stale');
      const active = await c.query<{ id: string }>(
        `SELECT id::text AS id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
      );
      expect(active.rows.map((r) => r.id)).toEqual([a]);
      const cur = await c.query<{ name: string }>(
        `SELECT name FROM water.stations_active WHERE external_id = 'rt-1'`
      );
      expect(cur.rows).toEqual([{ name: 'R by a' }]);
      // a's activation pruned nothing it needs: a is there, and b is still an open draft.
      const versions = await stationVersions(c);
      expect(versions).toContain(a);
      expect(versions).toContain(b);
    });
  });
});

describe('assertPrunable', () => {
  const versions = [
    { id: 'root', parent: null },
    { id: 'old-edit', parent: 'root' },
    { id: 'kept-edit', parent: 'old-edit' },
  ];

  it('passes when nothing kept descends from what is removed', () => {
    expect(() => assertPrunable(versions, new Set(['old-edit', 'kept-edit']), 'stations')).not.toThrow();
  });

  it('throws, removing nothing, when a kept version descends from a removed one (the cascade would take it)', () => {
    expect(() => assertPrunable(versions, new Set(['old-edit']), 'stations')).toThrow(
      /stations: kept version kept-edit descends from old-edit, which would be removed; nothing was removed/
    );
  });
});
