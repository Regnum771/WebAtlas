import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { loadFeatures, versionsService } from '@webatlas/versioning';
import { adoptLegacySource } from './adoptLegacy';
import type { ResolvedLoad } from './stages/loadGeojson';
import type { Stage } from './types';

/** Against the real database, on a real layer, inside transactions that are always rolled back. */
const DB = process.env.DATABASE_URL;
const dir = mkdtempSync(join(tmpdir(), 'adopt-legacy-'));
let pool: pg.Pool;
beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await pool?.end();
});

const path = join(dir, 'stations.geojson');
writeFileSync(path, JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'al-1', name: 'A' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: 'al-2', name: 'B' } },
  ],
}));
const columns = (p: Record<string, unknown>) => ({ external_id: p.id, name: p.name });
const stage = {
  type: 'load-geojson', layer: 'stations', versioned: true, legacySource: 'stations.geojson',
  files: [{ file: 'seeds/stations.geojson', columns }],
} as Extract<Stage, { type: 'load-geojson' }>;
const load: ResolvedLoad = {
  layer: 'stations', versioned: true, source: 'stations.geojson@sha256:abc', files: [{ path, columns }],
};

/** An active ingest version as the OLD seed command left it: a legacy source, feature_count set. */
async function legacyVersion(c: pg.PoolClient, source: string): Promise<string> {
  const svc = versionsService(pool);
  const id = await svc.createIngestVersion(c, { layerKey: 'stations', source });
  await loadFeatures(c, { table: 'stations', file: path, columns }, id);
  await c.query(`UPDATE app.dataset_versions SET feature_count = 2 WHERE id = $1`, [id]);
  await svc.activate(c, 'stations', id);
  return id;
}

async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

describe.skipIf(!DB)('adopting a version the old seed command loaded', () => {
  it('re-labels the active ingest version when its legacy source and row count match the file', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson');
      expect(await adoptLegacySource(c, stage, load)).toEqual({ result: 'relabelled', versionId: id });
      const { rows } = await c.query(`SELECT source FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0].source).toBe('stations.geojson@sha256:abc');
      // And now it is current: a second adoption changes nothing.
      expect(await adoptLegacySource(c, stage, load)).toEqual({ result: 'current' });
    });
  });

  it('refuses when the rows do not match the file, and says why', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson');
      await c.query(`DELETE FROM water.stations WHERE dataset_version_id = $1 AND external_id = 'al-2'`, [id]);
      const r = await adoptLegacySource(c, stage, load);
      expect(r.result).toBe('mismatch');
      expect((r as { detail: string }).detail).toMatch(/holds 1 rows, the files hold 2 features/);
      const { rows } = await c.query(`SELECT source FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0].source).toBe('stations.geojson');
    });
  });

  it('refuses a load from some other source', async () => {
    await inRollback(async (c) => {
      await legacyVersion(c, 'something-else.geojson');
      const r = await adoptLegacySource(c, stage, load);
      expect(r.result).toBe('mismatch');
      expect((r as { detail: string }).detail).toContain('something-else.geojson');
    });
  });

  it('re-labels the root under steward edits, leaving the edits active', async () => {
    await inRollback(async (c) => {
      const root = await legacyVersion(c, 'stations.geojson');
      const svc = versionsService(pool);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      expect(await adoptLegacySource(c, stage, load)).toEqual({ result: 'relabelled', versionId: root });
      const { rows } = await c.query(`SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`);
      expect(rows[0].id).toBe(draft);
    });
  });

  it('refuses a layer with no active version', async () => {
    await inRollback(async (c) => {
      await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = 'stations'`);
      const r = await adoptLegacySource(c, stage, load);
      expect(r).toEqual({ result: 'mismatch', detail: 'stations has no active version' });
    });
  });
});
