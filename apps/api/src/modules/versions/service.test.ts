import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';

const LAYER = 'zz_svc_dams'; // synthetic layer key; no real table needed for active-flip test

afterAll(async () => {
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = $1`, [LAYER]);
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
});
