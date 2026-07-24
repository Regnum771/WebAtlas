import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';
import { loadLayerFeatures } from '../../db/seeds/run';
import { SEED_LAYERS } from '../../db/seeds/registry';

afterAll(async () => { await closePool(); });

describe('versioning integration (§6 rollback + addressability)', () => {
  it('a mid-ingest failure rolls back, leaving the previously-active version active and served', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const stations = SEED_LAYERS.find((l) => l.table === 'stations')!;

    const activeBefore = await svc.getActiveVersionId('stations');
    const { rows: servedBefore } = await pool.query(`SELECT count(*)::int AS n FROM water.stations_active`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v = await svc.createIngestVersion(client, { layerKey: 'stations', source: 'test', label: 'doomed' });
      await loadLayerFeatures(client, stations, v);
      // Simulate a failure after partial load, before activate.
      throw new Error('boom');
    } catch (e) {
      await client.query('ROLLBACK');
      expect((e as Error).message).toBe('boom');
    } finally {
      client.release();
    }

    // Active pointer never moved; the doomed version left no committed rows.
    expect(await svc.getActiveVersionId('stations')).toBe(activeBefore);
    const { rows: servedAfter } = await pool.query(`SELECT count(*)::int AS n FROM water.stations_active`);
    expect(servedAfter[0].n).toBe(servedBefore[0].n);
    const { rows: doomed } = await pool.query(
      `SELECT count(*)::int AS n FROM app.dataset_versions WHERE label = 'doomed'`
    );
    expect(doomed[0].n).toBe(0);
  });

  it('a prior version stays directly resolvable after a new ingest supersedes it', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const priorActive = await svc.getActiveVersionId('stations');
    const priorIds = await svc.resolveFeatureIds('stations', priorActive!);

    // New successful ingest of the same layer.
    const stations = SEED_LAYERS.find((l) => l.table === 'stations')!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v = await svc.createIngestVersion(client, { layerKey: 'stations', source: 'test', label: 'superseder' });
      await loadLayerFeatures(client, stations, v);
      await svc.activate(client, 'stations', v);
      await client.query('COMMIT');
    } finally { client.release(); }

    // Prior version still addressable with its original feature set.
    const stillThere = await svc.resolveFeatureIds('stations', priorActive!);
    expect(new Set(stillThere)).toEqual(new Set(priorIds));

    // Cleanup: restore prior active, drop the superseder.
    const superseder = await pool.query(
      `SELECT id FROM app.dataset_versions WHERE label = 'superseder' AND layer_key = 'stations'`
    );
    const supId = superseder.rows[0].id;
    await pool.query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='stations' AND is_active`);
    await pool.query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [priorActive]);
    await pool.query(`DELETE FROM water.stations WHERE dataset_version_id=$1`, [supId]);
    await pool.query(`DELETE FROM app.dataset_versions WHERE id=$1`, [supId]);
  });
});
