import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './testPool';
import { versionsService } from './service';
import { refreshCurrentRows } from './currentRows';

// Regression guard for the failure mode recorded in docs/architecture/database-architecture.md
// §9: a derived value whose refresh obligation lives in a call site rather than in a contract
// eventually goes stale. adminStamp.ts used to be that call site for every ingest/edit path;
// this test proves the obligation now lives inside versionsService.activate() itself, so a
// future caller cannot forget it the way `rivers_overview`'s refresh once was forgotten.
const LAYER = 'dams';
const TEST_SOURCE = 'activate-stamping.test';

// Held in outer scope so cleanup can run from afterAll. Cleanup MUST NOT sit after the
// assertions: this test activates a throwaway version of a real layer, so a failing
// assertion — precisely the regression this test exists to catch — would otherwise skip
// cleanup and leave `dams` pointing at an unstamped test version for every later suite on
// this shared dev database.
let versionId: string | null = null;
let priorActive: string | null = null;

afterAll(async () => {
  const pool = getPool();
  if (versionId) {
    // Deactivate before restoring the prior version: the partial unique index allows only
    // one active row per layer_key at a time.
    await pool.query(`UPDATE app.dataset_versions SET is_active = false WHERE id = $1`, [versionId]);
    if (priorActive) {
      await pool.query(`UPDATE app.dataset_versions SET is_active = true WHERE id = $1`, [priorActive]);
      // Raw flip instead of activate(): move the current flag with it.
      const client = await pool.connect();
      try {
        await refreshCurrentRows(client, LAYER, priorActive);
      } finally {
        client.release();
      }
    }
    await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = $1`, [versionId]);
    await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [versionId]);
  }
  await closePool();
});

describe('versionsService.activate stamps administrative codes as part of the contract', () => {
  it('stamps a thematic layer on activation even when the caller never calls stampAdminCodes', async () => {
    const pool = getPool();
    const svc = versionsService(pool);

    // Whatever is active for 'dams' right now (seeded data), so we can restore it afterwards.
    priorActive = await svc.getActiveVersionId(LAYER);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
         VALUES ($1, 'ingest', $2, 'activate-stamping-test', false) RETURNING id`,
        [LAYER, TEST_SOURCE]
      );
      versionId = rows[0].id;
      // Buôn Ma Thuột, Đắk Lắk (code 66) — same fixture point as adminStamp.test.ts.
      // Codes start explicitly empty: nothing stamps this row before activate() runs.
      await client.query(
        `INSERT INTO water.dams (external_id, name, geom, dataset_version_id, province_codes, ward_codes)
         VALUES (900101, 'activate-stamp-test', ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326), $1, '{}', '{}')`,
        [versionId]
      );

      // No stampAdminCodes() call here — that is the point of the test.
      await svc.activate(client, LAYER, versionId);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const { rows: after } = await pool.query<{ province_codes: string[]; ward_codes: string[] }>(
      `SELECT province_codes, ward_codes FROM water.dams WHERE dataset_version_id = $1`,
      [versionId]
    );
    expect(after[0].province_codes).toEqual(['66']);
    expect(after[0].ward_codes).toHaveLength(1);
    // Cleanup lives in afterAll — see the comment on `versionId` above.
  });
});
