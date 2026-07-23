import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';

const LAYER = 'zz_svc_dams'; // synthetic layer key; no real table needed for active-flip test
const LAYER_B = 'zz_svc_bridges'; // second synthetic layer key for cross-layer guard test
const LAYER_LABELS = 'zz_svc_labels'; // synthetic layer key for sequential-label derivation test

afterAll(async () => {
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = $1`, [LAYER]);
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = $1`, [LAYER_B]);
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = $1`, [LAYER_LABELS]);
  await closePool();
});

describe('versionsService ingest lifecycle', () => {
  it('creates an inactive ingest version, then activates it, clearing any prior active', async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const svc = versionsService(pool);

      const v1 = await svc.createIngestVersion(client, { layerKey: LAYER, source: 'seed', label: 'v1' });
      await svc.activate(client, LAYER, v1);

      const v2 = await svc.createIngestVersion(client, { layerKey: LAYER, source: 'seed', label: 'v2' });
      // Before activation, v1 is still the only active one.
      const mid = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
      );
      expect(mid.rows.map((r) => r.id)).toEqual([v1]);

      await svc.activate(client, LAYER, v2);
      const after = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
      );
      expect(after.rows.map((r) => r.id)).toEqual([v2]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('rejects activation of a nonexistent version id and leaves the current active version untouched', async () => {
    const pool = getPool();
    const svc = versionsService(pool);

    // Establish a known-active version outside the transaction under test.
    const setupClient = await pool.connect();
    let v1: string;
    try {
      await setupClient.query('BEGIN');
      v1 = await svc.createIngestVersion(setupClient, { layerKey: LAYER, source: 'seed', label: 'v1-nonexistent-test' });
      await svc.activate(setupClient, LAYER, v1);
      await setupClient.query('COMMIT');
    } catch (e) {
      await setupClient.query('ROLLBACK');
      throw e;
    } finally {
      setupClient.release();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        svc.activate(client, LAYER, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const after = await pool.query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
    );
    expect(after.rows.map((r) => r.id)).toEqual([v1]);
  });

  it('rejects activation of a version id belonging to a different layer', async () => {
    const pool = getPool();
    const svc = versionsService(pool);

    const setupClient = await pool.connect();
    let vA: string;
    try {
      await setupClient.query('BEGIN');
      vA = await svc.createIngestVersion(setupClient, { layerKey: LAYER, source: 'seed', label: 'vA-cross-layer-test' });
      await svc.activate(setupClient, LAYER, vA);
      await setupClient.query('COMMIT');
    } catch (e) {
      await setupClient.query('ROLLBACK');
      throw e;
    } finally {
      setupClient.release();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(svc.activate(client, LAYER_B, vA)).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const afterA = await pool.query(
      `SELECT is_active FROM app.dataset_versions WHERE id = $1`, [vA]
    );
    expect(afterA.rows[0].is_active).toBe(true);

    const afterB = await pool.query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER_B]
    );
    expect(afterB.rows).toHaveLength(0);
  });

  it('derives sequential, distinct labels for successive ingest versions of the same layer', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v1 = await svc.createIngestVersion(client, { layerKey: LAYER_LABELS, source: 'seed' });
      const v2 = await svc.createIngestVersion(client, { layerKey: LAYER_LABELS, source: 'seed' });
      const v3 = await svc.createIngestVersion(client, { layerKey: LAYER_LABELS, source: 'seed' });

      const { rows } = await client.query(
        `SELECT id, label FROM app.dataset_versions WHERE id = ANY($1) ORDER BY ingested_at`,
        [[v1, v2, v3]]
      );
      expect(rows.map((r) => r.label)).toEqual(['version 1', 'version 2', 'version 3']);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  it('honors an explicitly-passed label verbatim instead of deriving one', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await svc.createIngestVersion(client, {
        layerKey: LAYER_LABELS,
        source: 'seed',
        label: 'HydroLAKES v10',
      });
      const { rows } = await client.query(
        `SELECT label FROM app.dataset_versions WHERE id = $1`,
        [versionId]
      );
      expect(rows[0].label).toBe('HydroLAKES v10');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
