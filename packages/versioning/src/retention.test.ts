import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { assertPrunable, EARLIER_LOADS_KEPT, loadFeatures, versionsService } from './index';

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
      const { rows } = await c.query(`SELECT name FROM water.stations_active WHERE external_id = 'rt-1'`);
      expect(rows).toEqual([{ name: 'R' }]);
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
