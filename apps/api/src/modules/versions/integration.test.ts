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

  // HydroRIVERS is ~26.9k features, inserted row-by-row through the same seed
  // pipeline as the rest of the suite; a first-time ingest alone runs well past
  // the shared 30s integration-suite budget, so this test gets a longer local
  // timeout rather than raising the global one for every other (much smaller) test.
  it('ingests OSM waterways as the rivers version and flips it active (no thuyhe seed layer precedes it)', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const { ingestHydroRivers } = await import('../../db/seeds/ingestRivers');

    // thuyhe.geojson was removed from SEED_LAYERS (Finding 2): runSeeds() in this
    // suite's beforeAll no longer creates/activates a 'rivers' version at all. So
    // whatever is active for 'rivers' right now is either nothing (fresh DB) or a
    // prior OSM ingest already sitting active in this persistent dev DB — never a
    // freshly-seeded thuyhe version.
    const beforeActiveId = await svc.getActiveVersionId('rivers');
    if (beforeActiveId) {
      const beforeVersion = await svc.getVersion(beforeActiveId);
      expect(beforeVersion?.source).not.toBe('thuyhe.geojson');
    }

    const { versionId } = await ingestHydroRivers();

    // New version is active + ingest-kind.
    const active = await svc.getActiveVersionId('rivers');
    expect(active).toBe(versionId);
    const v = await svc.getVersion(versionId);
    expect(v).toMatchObject({ kind: 'ingest', source: 'OSM waterways', isActive: true });

    // rivers_active resolves to the OSM rows.
    const newIds = await svc.resolveFeatureIds('rivers', versionId);
    expect(newIds.length).toBeGreaterThan(0);

    // Idempotent: a second ingest doesn't create a duplicate active v2.
    const second = await ingestHydroRivers();
    expect(second.versionId).toBe(versionId);
  }, 180_000);
});
