import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { loadFeatures, versionsService } from '@webatlas/versioning';
import { adoptLegacySource } from './adoptLegacy';
import type { ResolvedLoad } from './stages/loadGeojson';

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
const load: ResolvedLoad = {
  layer: 'stations', versioned: true, source: 'stations.geojson@sha256:abc', mapping: 'mapping-1',
  legacySource: 'stations.geojson', files: [{ path, columns }],
};

/** An active ingest version as the OLD seed command left it: a legacy source, feature_count set. */
async function legacyVersion(c: pg.PoolClient, source: string, sourceVersion: string | null = null): Promise<string> {
  const svc = versionsService(pool);
  const id = await svc.createIngestVersion(c, { layerKey: 'stations', source, sourceVersion });
  await loadFeatures(c, { table: 'stations', file: path, columns }, id);
  await c.query(`UPDATE app.dataset_versions SET feature_count = 2 WHERE id = $1`, [id]);
  await svc.activate(c, 'stations', id);
  return id;
}

async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Keep the layer's existing versions out of retention, so version counts measure only this test.
    await c.query(`INSERT INTO app.version_pins (version_id, holder) SELECT id, 'test' FROM app.dataset_versions`);
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
      expect(await adoptLegacySource(c, load)).toEqual({ result: 'relabelled', versionId: id });
      const { rows } = await c.query(`SELECT source, source_version FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0]).toMatchObject({ source: 'stations.geojson@sha256:abc', source_version: 'mapping-1' });
      // And now it is current: a second adoption changes nothing.
      expect(await adoptLegacySource(c, load)).toEqual({ result: 'current', versionId: id });
    });
  });

  it('refuses when the rows do not match the file, and says why', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson');
      await c.query(`DELETE FROM water.stations WHERE dataset_version_id = $1 AND external_id = 'al-2'`, [id]);
      const r = await adoptLegacySource(c, load);
      expect(r.result).toBe('mismatch');
      expect((r as { detail: string }).detail).toMatch(/holds 1 rows, the files hold 2 features/);
      const { rows } = await c.query(`SELECT source FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0].source).toBe('stations.geojson');
    });
  });

  it('refuses a load from some other source', async () => {
    await inRollback(async (c) => {
      await legacyVersion(c, 'something-else.geojson');
      const r = await adoptLegacySource(c, load);
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
      expect(await adoptLegacySource(c, load)).toEqual({ result: 'relabelled', versionId: root });
      const { rows } = await c.query(`SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`);
      expect(rows[0].id).toBe(draft);
    });
  });

  it('refuses a layer with no active version', async () => {
    await inRollback(async (c) => {
      await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = 'stations'`);
      const r = await adoptLegacySource(c, load);
      expect(r).toEqual({ result: 'mismatch', detail: 'stations has no active version' });
    });
  });

  it('re-labels a version loaded from this content before mapping revisions were recorded', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson@sha256:abc', null);
      expect(await adoptLegacySource(c, load)).toEqual({ result: 'relabelled', versionId: id });
      const { rows } = await c.query(`SELECT source_version FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0].source_version).toBe('mapping-1');
    });
  });

  it('does not take the same file under another mapping revision for the same load', async () => {
    await inRollback(async (c) => {
      await legacyVersion(c, 'stations.geojson@sha256:abc', 'mapping-1');
      const r = await adoptLegacySource(c, { ...load, mapping: 'mapping-2' });
      expect(r.result).toBe('mismatch');
      expect((r as { detail: string }).detail).toMatch(/used mapping-1, the descriptor is at mapping-2/);
    });
  });

  it('does not re-label an unlabelled load once the mapping has moved on from its first revision', async () => {
    // Nobody can say which mapping an unlabelled version was loaded with, except that it was the first.
    await inRollback(async (c) => {
      await legacyVersion(c, 'stations.geojson');
      expect((await adoptLegacySource(c, { ...load, mapping: 'mapping-2' })).result).toBe('mismatch');
    });
    await inRollback(async (c) => {
      await legacyVersion(c, 'stations.geojson@sha256:abc', null);
      expect((await adoptLegacySource(c, { ...load, mapping: 'mapping-2' })).result).toBe('mismatch');
    });
  });
});
