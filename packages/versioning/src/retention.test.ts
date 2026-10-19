import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { assertPrunable, EARLIER_LOADS_KEPT, loadFeatures, pruneVersions, versionsService } from './index';
import { ConflictError } from './errors';

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

async function edit(c: pg.PoolClient): Promise<string> {
  const draft = await svc().openEditDraft(c, 'stations');
  await svc().commitEditDraft(c, 'stations', draft);
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
      const d = await svc().openEditDraft(c, 'stations');
      await c.query(`UPDATE app.dataset_versions SET draft_status = 'personal' WHERE id = $1`, [d]);
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

describe('commitEditDraft on a stale draft', () => {
  it('refuses the second of two drafts opened on the same version and keeps the first active', async () => {
    await inRollback(async (c) => {
      await load(c, 'L1');
      const a = await svc().openEditDraft(c, 'stations');
      const b = await svc().openEditDraft(c, 'stations');
      // Real sessions run in separate transactions, so a's prune cannot see b's uncommitted draft;
      // here both share one, so pin b to keep it out of a's prune.
      await c.query(`INSERT INTO app.version_pins (version_id, holder) VALUES ($1, 'stale-draft:test')`, [b]);
      await svc().commitEditDraft(c, 'stations', a);
      await c.query('SAVEPOINT stale');
      await expect(svc().commitEditDraft(c, 'stations', b)).rejects.toThrow(ConflictError);
      await c.query('ROLLBACK TO SAVEPOINT stale');
      const active = await c.query<{ id: string }>(
        `SELECT id::text AS id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
      );
      expect(active.rows.map((r) => r.id)).toEqual([a]);
      const cur = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM water.stations_active WHERE external_id = 'rt-1'`
      );
      expect(cur.rows[0].n).toBe(1);
      // The first draft's version still exists: nothing was pruned away by the refused commit.
      expect(await stationVersions(c)).toContain(a);
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
