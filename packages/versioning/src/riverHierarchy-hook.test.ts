import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { versionsService } from './service';
import { openDraft } from './drafts';

afterAll(async () => { await closePool(); });

/** A throwaway draft owner, created inside the test's rolled-back transaction (CI seeds no users). */
async function draftOwner(c: pg.PoolClient): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id`,
    [`p2-river-hook-${randomUUID()}@webatlas.test`]
  );
  return rows[0].id;
}

/** A personal draft on the layer's active version, owned by a throwaway user. */
async function openTestDraft(c: pg.PoolClient, layerKey: string): Promise<string> {
  return (await openDraft(c, layerKey, await draftOwner(c))).id;
}

const noGuard = async () => {};

/** The way carrying this name is long enough that moving it changes reach assignments. */
const SUBJECT = 'Sông Thu Bồn';

describe('activate() maintains the river hierarchy', () => {
  it('rebuilds level-1 geometry when an edit session moves a member way', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query<{ external_id: string; len: string }>(
        `SELECT external_id, ST_Length(geom::geography)::text AS len
           FROM water.rivers_active WHERE feature_level = 1 AND name = $1`,
        [SUBJECT]
      );
      expect(before.rows).toHaveLength(1);
      const riverId = before.rows[0].external_id;

      const draftId = await openTestDraft(client, 'rivers');
      // Supersede one member way with a visibly different geometry: same external_id,
      // new row in the draft. This is how every edit works -- never an in-place update.
      // Total order on the pick so the test is the same on every machine.
      await client.query(
        `INSERT INTO water.rivers
           (external_id, feature_level, name, code, stream_order, geom, dataset_version_id)
         SELECT w.external_id, 3, w.name, w.code, w.stream_order,
                ST_Multi(ST_Translate(ST_LineMerge(w.geom), 0.02, 0.02)), $2
           FROM water.rivers_active w
          WHERE w.feature_level = 3 AND w.parent_external_id = $1
          ORDER BY ST_Length(w.geom) DESC, w.external_id LIMIT 1`,
        [riverId, draftId]
      );
      await svc.publishDraft(client, 'rivers', draftId, noGuard);

      const after = await client.query<{ len: string; version: string; provinces: string }>(
        `SELECT ST_Length(geom::geography)::text AS len, dataset_version_id::text AS version,
                coalesce(array_length(province_codes, 1), 0)::text AS provinces
           FROM water.rivers_active WHERE feature_level = 1 AND external_id = $1`,
        [riverId]
      );
      // The river's DERIVED geometry followed its member. Without the hook the level-1
      // row is still the parent version's, unchanged, and silently stale -- exactly the
      // rivers_overview failure the hook exists to prevent.
      expect(after.rows[0].version).toBe(draftId);
      expect(Number(after.rows[0].len)).not.toBeCloseTo(Number(before.rows[0].len), 0);
      // The rebuild INSERTS this row, so it only carries admin codes if the rebuild runs
      // BEFORE stampAdminCodes inside activate(). Reversed, it ships with none and
      // features_in_admin_unit silently misses it.
      expect(Number(after.rows[0].provinces)).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 180_000);

  it('writes superseding rows only where something changed', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draftId = await openTestDraft(client, 'rivers');
      await svc.publishDraft(client, 'rivers', draftId, noGuard);
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1`,
        [draftId]
      );
      // An empty edit changes nothing, so the diff writes nothing. A wholesale rewrite
      // would put every reach, way and river here and deepen the chain on every no-op
      // commit.
      expect(rows[0].n).toBe('0');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 180_000);

  it('tombstones a river whose ways an edit removed, without the ingest match-rate floor', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A river that is the only one carrying its name, so removing that name's ways
      // leaves no same-name way anywhere for its reaches to vote for.
      const { rows: pick } = await client.query<{ external_id: string; name: string }>(
        // One pass with GROUP BY: rivers_active is an optimizer fence, so a correlated
        // per-row count against it re-resolves the view per river (~45 s, measured).
        `SELECT min(external_id) AS external_id, name FROM water.rivers_active
          WHERE feature_level = 1
          GROUP BY name HAVING count(*) = 1
          ORDER BY min(external_id) LIMIT 1`
      );
      expect(pick).toHaveLength(1);

      const draftId = await openTestDraft(client, 'rivers');
      await client.query(
        `INSERT INTO water.rivers
           (external_id, feature_level, name, code, stream_order, geom, dataset_version_id, deleted)
         SELECT external_id, 3, name, code, stream_order, geom, $2, true
           FROM water.rivers_active WHERE feature_level = 3 AND name = $1`,
        [pick[0].name, draftId]
      );
      // The edit drops named reaches below RIVER_BASELINE. That floor guards a re-ingest
      // against a silent algorithm or data regression (spec §2); a steward deleting a
      // way is neither, and must not be refused for it.
      await expect(svc.publishDraft(client, 'rivers', draftId, noGuard)).resolves.toBeUndefined();

      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM water.rivers_active WHERE external_id = $1`,
        [pick[0].external_id]
      );
      // Without the tombstone the river keeps resolving from the parent version: a river
      // that no longer exists, still drawn and still searchable.
      expect(rows[0].n).toBe('0');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }, 180_000);

  it('does not run the river build for other layers', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draftId = await openTestDraft(client, 'dams');
      // Must not throw: the hook is scoped to rivers, and water.dams has no
      // feature_level column at all.
      await expect(svc.publishDraft(client, 'dams', draftId, noGuard)).resolves.toBeUndefined();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
