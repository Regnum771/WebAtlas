import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPool, closePool } from './testPool';
import { loadFeatures, versionsService, type FeatureLoadSpec } from './index';

// Each test loads into a throwaway version inside a transaction it rolls back, so nothing is left.
const dir = mkdtempSync(join(tmpdir(), 'load-features-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});

function fixture(name: string, features: unknown[]): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
  return file;
}

describe('loadFeatures', () => {
  it('inserts every feature into the given version, mapping columns and storing NULL for a missing geometry', async () => {
    // dams is the one layer whose geometry may be NULL: 19 real dams have no source coordinates.
    const spec: FeatureLoadSpec = {
      table: 'dams',
      file: fixture('dams.geojson', [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { ID: 990001, name: 'A' } },
        { type: 'Feature', geometry: null, properties: { ID: 990002, name: 'B' } },
      ]),
      columns: (p, index) => ({ external_id: p.ID, name: `${String(p.name)}#${index}` }),
    };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await versionsService(pool).createIngestVersion(client, {
        layerKey: 'dams', source: 'loadFeatures.test', label: 'loadFeatures.test',
      });
      expect(await loadFeatures(client, spec, versionId)).toBe(2);
      const { rows } = await client.query<{ external_id: number; name: string; has_geom: boolean; srid: number | null }>(
        `SELECT external_id, name, geom IS NOT NULL AS has_geom, ST_SRID(geom) AS srid
           FROM water.dams WHERE dataset_version_id = $1 ORDER BY external_id`,
        [versionId]
      );
      expect(rows).toEqual([
        { external_id: 990001, name: 'A#0', has_geom: true, srid: 4326 },
        { external_id: 990002, name: 'B#1', has_geom: false, srid: null },
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('wraps a single polygon as a MultiPolygon when the spec asks for it', async () => {
    const square = [[[108, 12], [108.01, 12], [108.01, 12.01], [108, 12.01], [108, 12]]];
    const spec: FeatureLoadSpec = {
      table: 'flood_zones',
      multiPolygon: true,
      file: fixture('zones.geojson', [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: square }, properties: { id: 'lf-z1' } },
      ]),
      columns: (p) => ({ external_id: p.id, name: 'zone' }),
    };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await versionsService(pool).createIngestVersion(client, {
        layerKey: 'flood_zones', source: 'loadFeatures.test', label: 'loadFeatures.test',
      });
      await loadFeatures(client, spec, versionId);
      const { rows } = await client.query<{ t: string }>(
        `SELECT GeometryType(geom) AS t FROM water.flood_zones WHERE dataset_version_id = $1`, [versionId]
      );
      expect(rows).toEqual([{ t: 'MULTIPOLYGON' }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses a column map that returns something other than a column name', async () => {
    // Column names are written into the INSERT. The committed maps return literal keys; this keeps
    // a future map that spreads feature properties from turning data into SQL.
    const spec: FeatureLoadSpec = {
      table: 'stations',
      file: fixture('bad.geojson', [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { 'name) VALUES (1); --': 'x' } },
      ]),
      columns: (p) => ({ ...p }),
    };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await versionsService(pool).createIngestVersion(client, {
        layerKey: 'stations', source: 'loadFeatures.test', label: 'loadFeatures.test',
      });
      await expect(loadFeatures(client, spec, versionId)).rejects.toThrow(/is not a column name/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
