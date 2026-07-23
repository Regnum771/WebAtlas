import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { featuresService } from './service';
import { versionsService } from '../versions/service';
import { versionsRepository } from '../versions/repository';
import { ConflictError, GeometryError, NotFoundError } from '../../errors';

const TEST_NAME = 'svc-test-dam@webatlas.test';
const TEST_STATION = 'svc-test-station@webatlas.test';

async function activeVersionId(layer: string): Promise<string> {
  const { rows } = await getPool().query(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer]
  );
  return rows[0].id;
}
async function resolvedIds(layer: string): Promise<string[]> {
  return versionsService(getPool()).resolveFeatureIds(layer, await activeVersionId(layer));
}
async function resolvedCount(layer: string): Promise<number> {
  return (await resolvedIds(layer)).length;
}
async function editVersionCount(layer: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM app.dataset_versions WHERE layer_key = $1 AND kind = 'edit'`, [layer]
  );
  return rows[0].n;
}

describe('featuresService edit sessions (§7)', () => {
  const svc = () => featuresService(getPool());

  afterAll(async () => {
    // Drop the edit-versions these tests published, restoring the seeded ingest
    // version as active so the suite leaves the database as it found it. Feature
    // rows cascade away with their version; the tombstones do too.
    for (const layer of ['dams', 'stations']) {
      await getPool().query(
        `DELETE FROM water.${layer} WHERE dataset_version_id IN
           (SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND kind = 'edit')`,
        [layer]
      );
      await getPool().query(
        `DELETE FROM app.dataset_versions WHERE layer_key = $1 AND kind = 'edit'`, [layer]
      );
      await getPool().query(
        `UPDATE app.dataset_versions SET is_active = true
         WHERE id = (SELECT id FROM app.dataset_versions
                     WHERE layer_key = $1 AND kind = 'ingest'
                     ORDER BY ingested_at DESC LIMIT 1)`,
        [layer]
      );
    }
    await getPool().query(`DELETE FROM water.dams WHERE name = $1`, [TEST_NAME]);
    await getPool().query(`DELETE FROM water.stations WHERE name = $1`, [TEST_STATION]);
    await closePool();
  });

  it('rejects an unknown layer key with NotFoundError', async () => {
    await expect(svc().list('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a wrong-type geometry with GeometryError', async () => {
    const feature = {
      geometry: { type: 'LineString', coordinates: [[105, 21], [106, 22]] },
      properties: { name: TEST_NAME },
    };
    const beforeVersions = await editVersionCount('dams');
    const s = await svc().editSession('dams');
    await expect(s.create(feature)).rejects.toBeInstanceOf(GeometryError);
    // The failure already rolled the session back; discard must not touch the
    // now-released client.
    await s.discard();
    expect(s.isSettled()).toBe(true);
    // The rollback took the draft edit-version with it — no orphan left behind.
    expect(await editVersionCount('dams')).toBe(beforeVersions);
  });

  it('refuses further edits once a session has ended', async () => {
    const s = await svc().editSession('dams');
    await s.discard();
    await expect(
      s.create({ geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: TEST_NAME } })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('edits before commit do not change what the active version resolves', async () => {
    const beforeCount = await resolvedCount('dams');
    const beforeVersions = await editVersionCount('dams');
    const s = await svc().editSession('dams');
    await s.create({ geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: TEST_NAME } });

    // Active version unchanged until commit.
    expect(await resolvedCount('dams')).toBe(beforeCount);

    await s.discard();
    // Discard leaves no trace: no resolved feature, and no version row either.
    expect(await resolvedCount('dams')).toBe(beforeCount);
    expect(await editVersionCount('dams')).toBe(beforeVersions);
  });

  it('commit publishes exactly one labeled edit-version and makes the new feature resolve', async () => {
    const beforeCount = await resolvedCount('dams');
    const beforeVersions = await editVersionCount('dams');
    const parent = await activeVersionId('dams');

    const s = await svc().editSession('dams');
    const row = await s.create({
      geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: TEST_NAME },
    });
    await s.commit();

    expect(await resolvedCount('dams')).toBe(beforeCount + 1);
    expect(await editVersionCount('dams')).toBe(beforeVersions + 1);
    expect(await resolvedIds('dams')).toContain(row.id);

    const active = await getPool().query(
      `SELECT kind, label, parent_version_id, feature_count, is_active
       FROM app.dataset_versions WHERE id = $1`, [await activeVersionId('dams')]
    );
    expect(active.rows[0].kind).toBe('edit');
    expect(active.rows[0].label).toMatch(/^\d{4}-\d{2}-\d{2} edits$/);
    // Branched off what was active, and stores only the one changed feature.
    expect(active.rows[0].parent_version_id).toBe(parent);
    expect(active.rows[0].feature_count).toBe(1);
  });

  it('records each edit in audit_log even though rows go to the draft version', async () => {
    const s = await svc().editSession('dams');
    const row = await s.create({
      geometry: { type: 'Point', coordinates: [105.9, 21.1] }, properties: { name: TEST_NAME },
    });
    await s.commit();
    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1`, [row.id]
    );
    expect(audit.rows.map((r) => r.action)).toContain('create');
  });

  // The resolver keys on external_id with DISTINCT ON, which collapses all
  // NULL-external_id rows into one. Two steward-created features must therefore each
  // get a distinct synthetic external_id, in the column's own type.
  it('gives each created feature a distinct external_id on an integer-typed layer (dams)', async () => {
    const beforeCount = await resolvedCount('dams');
    const s = await svc().editSession('dams');
    const a = await s.create({ geometry: { type: 'Point', coordinates: [105.7, 20.9] }, properties: { name: TEST_NAME } });
    const b = await s.create({ geometry: { type: 'Point', coordinates: [105.6, 20.8] }, properties: { name: TEST_NAME } });
    await s.commit();

    const ids = await resolvedIds('dams');
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids.length).toBe(beforeCount + 2);

    const ext = await getPool().query(
      `SELECT external_id FROM water.dams WHERE id = ANY($1)`, [[a.id, b.id]]
    );
    const values = ext.rows.map((r) => r.external_id);
    expect(new Set(values).size).toBe(2);
    // Allocated above the upstream range so a later ingest cannot collide.
    for (const v of values) expect(Number(v)).toBeGreaterThan(1_000_000);
  });

  it('gives each created feature a distinct external_id on a text-typed layer (stations)', async () => {
    const beforeCount = await resolvedCount('stations');
    const s = await svc().editSession('stations');
    const a = await s.create({ geometry: { type: 'Point', coordinates: [105.7, 20.9] }, properties: { name: TEST_STATION } });
    const b = await s.create({ geometry: { type: 'Point', coordinates: [105.6, 20.8] }, properties: { name: TEST_STATION } });
    await s.commit();

    const ids = await resolvedIds('stations');
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids.length).toBe(beforeCount + 2);

    const ext = await getPool().query(
      `SELECT external_id FROM water.stations WHERE id = ANY($1)`, [[a.id, b.id]]
    );
    const values = ext.rows.map((r) => r.external_id as string);
    expect(new Set(values).size).toBe(2);
    for (const v of values) expect(v).toMatch(/^edit:/);
  });

  // Copy-on-write: editing an inherited feature must not touch the parent's row.
  it('an update copies the inherited feature into the draft, leaving the parent row intact', async () => {
    const seed = await svc().editSession('dams');
    const original = await seed.create({
      geometry: { type: 'Point', coordinates: [105.5, 20.7] },
      properties: { name: TEST_NAME, status: 'operational' },
    });
    await seed.commit();
    const parentVersion = await activeVersionId('dams');

    const s = await svc().editSession('dams');
    const changed = await s.update(original.id, { properties: { status: 'decommissioned' } });
    await s.commit();

    // A new row in the new version carries the change...
    expect(changed.id).not.toBe(original.id);
    expect(changed.properties.status).toBe('decommissioned');
    // ...and the parent version's row still reads as it did.
    const parentRow = await getPool().query(
      `SELECT status, dataset_version_id FROM water.dams WHERE id = $1`, [original.id]
    );
    expect(parentRow.rows[0].status).toBe('operational');
    expect(parentRow.rows[0].dataset_version_id).toBe(parentVersion);
    // The feature resolves once, to the edited copy.
    const ids = await resolvedIds('dams');
    expect(ids).toContain(changed.id);
    expect(ids).not.toContain(original.id);
  });

  // A delete is a tombstone, not a physical removal: the parent keeps its row.
  it('a remove tombstones in the draft and drops the feature from the resolved set', async () => {
    const seed = await svc().editSession('dams');
    const original = await seed.create({
      geometry: { type: 'Point', coordinates: [105.4, 20.6] }, properties: { name: TEST_NAME },
    });
    await seed.commit();
    const beforeCount = await resolvedCount('dams');

    const s = await svc().editSession('dams');
    await s.remove(original.id);
    await s.commit();

    expect(await resolvedCount('dams')).toBe(beforeCount - 1);
    expect(await resolvedIds('dams')).not.toContain(original.id);
    // The parent's row survives physically — it is the history.
    const still = await getPool().query(`SELECT deleted FROM water.dams WHERE id = $1`, [original.id]);
    expect(still.rows[0].deleted).toBe(false);
  });

  // Regression: commit() used to set `settled = true` before awaiting COMMIT, so a
  // COMMIT that threw fell into fail(), which skipped release() because the session
  // already looked settled. The client was never returned to the pool — enough of
  // those and the pool is exhausted and the API deadlocks.
  it('returns the client to the pool when COMMIT itself fails', async () => {
    const pool = getPool();
    const realConnect = pool.connect.bind(pool);
    // Intercept the one client this session checks out and make its COMMIT reject,
    // leaving every other query (BEGIN, the draft insert, the feature insert) intact.
    let intercepted: any;
    (pool as any).connect = async (...args: unknown[]) => {
      const client: any = await (realConnect as any)(...args);
      if (!intercepted) {
        intercepted = client;
        const realQuery = client.query.bind(client);
        client.query = (sql: any, ...rest: any[]) => {
          if (typeof sql === 'string' && sql.trim().toUpperCase() === 'COMMIT') {
            return Promise.reject(new Error('injected COMMIT failure'));
          }
          return realQuery(sql, ...rest);
        };
      }
      return client;
    };

    const idleBefore = pool.idleCount;
    const totalBefore = pool.totalCount;
    try {
      const s = await svc().editSession('dams');
      await s.create({
        geometry: { type: 'Point', coordinates: [105.3, 20.5] }, properties: { name: TEST_NAME },
      });
      await expect(s.commit()).rejects.toThrow('injected COMMIT failure');
      expect(s.isSettled()).toBe(true);
      // discard() after a settled session is a no-op and must not double-release.
      await s.discard();
    } finally {
      (pool as any).connect = realConnect;
      if (intercepted) delete intercepted.query; // restore the prototype method
    }

    // The client came back: the pool holds no more connections than it did, and the
    // one it took out is idle again rather than checked out forever.
    expect(pool.totalCount).toBe(totalBefore + (totalBefore === 0 ? 1 : 0));
    expect(pool.idleCount).toBeGreaterThanOrEqual(Math.min(idleBefore, 1));
    expect(pool.totalCount - pool.idleCount).toBe(totalBefore - idleBefore);

    // The transaction never committed, so nothing it wrote survives.
    const orphan = await pool.query(
      `SELECT count(*)::int AS n FROM water.dams WHERE ST_X(geom) = 105.3`
    );
    expect(orphan.rows[0].n).toBe(0);
  });

  // Two sessions minting concurrently must not land on the same external_id: they write
  // into different draft versions, so the per-version unique index cannot catch a
  // duplicate, and the resolver's DISTINCT ON would later collapse the pair.
  it('two concurrent sessions on an integer-typed layer cannot mint the same external_id', async () => {
    const a = await svc().editSession('dams');
    const b = await svc().editSession('dams');

    const rowA = await a.create({
      geometry: { type: 'Point', coordinates: [105.21, 20.41] }, properties: { name: TEST_NAME },
    });
    // b's mint runs while a's transaction is still open and holding the advisory lock,
    // so it blocks until a commits and then scans a max that includes a's row.
    const rowBPromise = b.create({
      geometry: { type: 'Point', coordinates: [105.22, 20.42] }, properties: { name: TEST_NAME },
    });
    await a.commit();
    const rowB = await rowBPromise;
    await b.commit();

    const ext = await getPool().query(
      `SELECT id, external_id FROM water.dams WHERE id = ANY($1)`, [[rowA.id, rowB.id]]
    );
    expect(ext.rows).toHaveLength(2);
    const values = ext.rows.map((r) => Number(r.external_id));
    expect(new Set(values).size).toBe(2);

    // Distinct ids mean the resolver can keep both. (b branched off the version that
    // was active when it opened, so a's version is not in b's chain — that is ordinary
    // branch semantics, not id collision. Resolve over a chain containing both drafts
    // to prove DISTINCT ON keeps two rows rather than collapsing them into one.)
    const both = await getPool().query(
      versionsRepository(getPool()).resolvedSql('dams', [
        (await getPool().query(`SELECT dataset_version_id FROM water.dams WHERE id = $1`, [rowB.id])).rows[0].dataset_version_id,
        (await getPool().query(`SELECT dataset_version_id FROM water.dams WHERE id = $1`, [rowA.id])).rows[0].dataset_version_id,
      ])
    );
    const resolved = both.rows.map((r) => r.id as string);
    expect(resolved).toContain(rowA.id);
    expect(resolved).toContain(rowB.id);
  });

  it('rejects an update to a feature that does not exist', async () => {
    const s = await svc().editSession('dams');
    await expect(
      s.update('00000000-0000-0000-0000-000000000000', { properties: { name: TEST_NAME } })
    ).rejects.toBeInstanceOf(NotFoundError);
    await s.discard();
  });
});
