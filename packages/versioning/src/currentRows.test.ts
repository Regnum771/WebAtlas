import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { loadFeatures, resolvedSql, versionsService } from './index';

// Every case runs on the real stations layer inside a transaction that is rolled back.
const dir = mkdtempSync(join(tmpdir(), 'current-rows-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});

const file = join(dir, 'stations.geojson');
writeFileSync(file, JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'cr-1', name: 'A' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: 'cr-2', name: 'B' } },
  ],
}));
const columns = (p: Record<string, unknown>) => ({ external_id: p.id, name: p.name });

async function inRollback(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    // Keep the layer's existing versions out of retention (Task 3), so only this test's rows move.
    await c.query(`INSERT INTO app.version_pins (version_id, holder) SELECT id, 'currentRows.test' FROM app.dataset_versions`);
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

async function ingest(c: pg.PoolClient): Promise<string> {
  const svc = versionsService(getPool());
  const id = await svc.createIngestVersion(c, { layerKey: 'stations', source: 'currentRows.test' });
  await loadFeatures(c, { table: 'stations', file, columns }, id);
  await svc.activate(c, 'stations', id);
  return id;
}

const sorted = (ids: string[]) => [...ids].sort();
const flagged = async (c: pg.PoolClient) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM water.stations WHERE is_current`)).rows.map((r) => r.id));
const viewed = async (c: pg.PoolClient) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM water.stations_active`)).rows.map((r) => r.id));
const resolved = async (c: pg.PoolClient, versionId: string) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM (${resolvedSql('stations')}) r`, [versionId])).rows.map((r) => r.id));

describe('the current flag follows activation', () => {
  it('an ingest: its rows are current, nothing else is, and the view serves exactly those', async () => {
    await inRollback(async (c) => {
      const v = await ingest(c);
      const ids = await resolved(c, v);
      expect(ids).toHaveLength(2);
      expect(await flagged(c)).toEqual(ids);
      expect(await viewed(c)).toEqual(ids);
    });
  });

  it('an edit commit: the changed row replaces its parent, a tombstone removes its feature', async () => {
    await inRollback(async (c) => {
      const base = await ingest(c);
      const svc = versionsService(getPool());
      const draft = await svc.openEditDraft(c, 'stations');
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id)
         SELECT external_id, 'A edited', geom, $1 FROM water.stations WHERE dataset_version_id = $2 AND external_id = 'cr-1'`,
        [draft, base]
      );
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id, deleted)
         SELECT external_id, name, geom, $1, true FROM water.stations WHERE dataset_version_id = $2 AND external_id = 'cr-2'`,
        [draft, base]
      );
      await svc.commitEditDraft(c, 'stations', draft);
      const ids = await resolved(c, draft);
      expect(await flagged(c)).toEqual(ids);
      expect(await viewed(c)).toEqual(ids);
      const { rows } = await c.query(`SELECT name FROM water.stations_active WHERE external_id IN ('cr-1', 'cr-2')`);
      expect(rows).toEqual([{ name: 'A edited' }]);
    });
  });

  it('a discarded draft changes no flag', async () => {
    await inRollback(async (c) => {
      await ingest(c);
      const before = await flagged(c);
      const svc = versionsService(getPool());
      const draft = await svc.openEditDraft(c, 'stations');
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id)
         VALUES ('cr-3', 'C', ST_SetSRID(ST_MakePoint(108.1, 12.7), 4326), $1)`,
        [draft]
      );
      await svc.discardEditDraft(c, 'stations', draft);
      expect(await flagged(c)).toEqual(before);
    });
  });

  it('a second ingest: only the new rows are current', async () => {
    await inRollback(async (c) => {
      const first = await ingest(c);
      const second = await ingest(c);
      expect(await flagged(c)).toEqual(await resolved(c, second));
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1 AND is_current`, [first]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('resolvedSql', () => {
  it('resolves an unknown version to nothing, not to every feature', async () => {
    const { rows } = await getPool().query(resolvedSql('stations'), ['00000000-0000-0000-0000-000000000000']);
    expect(rows).toEqual([]);
  });

  it('refuses a layer key that is not an identifier', () => {
    expect(() => resolvedSql('stations; DROP TABLE x')).toThrow(/not a layer key/);
  });
});
