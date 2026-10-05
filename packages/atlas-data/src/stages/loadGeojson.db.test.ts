import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { versionsService } from '@webatlas/versioning';
import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS, ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS } from '@webatlas/shared';
import { loadFeatures } from '@webatlas/versioning';
import { applyLoadGeojson, resolveLoad, type ResolvedLoad } from './loadGeojson';
import { ALL_DATASETS } from '../registry';
import { resolveStageFile } from '../paths';

/**
 * The loader against a real database, on real layers. Every test runs the core inside a
 * transaction and ROLLS IT BACK, so no version, feature or boundary row outlives it. (The spec
 * asks for synthetic `__atlasdata_test__` layers; the loader stamps through @webatlas/versioning,
 * which accepts real layer keys only, so rollback is the isolation instead.)
 */
const DB = process.env.DATABASE_URL;
const dir = mkdtempSync(join(tmpdir(), 'load-geojson-'));
let pool: pg.Pool;

beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await pool?.end();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A two-station load whose content, and so whose source, is determined by `tag`. */
function stations(tag: string): ResolvedLoad {
  const body = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: `${tag}-1`, name: 'Buôn Ma Thuột' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: `${tag}-2`, name: 'Đà Lạt' } },
    ],
  });
  const path = join(dir, `stations-${tag}.geojson`);
  writeFileSync(path, body);
  return {
    layer: 'stations', versioned: true, source: `stations.geojson@sha256:${sha(sha(body))}`, mapping: 'mapping-1',
    files: [{ path, columns: (p) => ({ external_id: p.id, name: p.name }) }],
  };
}

async function inRollback<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Keep the layer's existing versions out of retention, so version counts measure only this test.
    await client.query(`INSERT INTO app.version_pins (version_id, holder) SELECT id, 'test' FROM app.dataset_versions FOR KEY SHARE`);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const versionCount = async (c: pg.PoolClient, layer: string) =>
  Number((await c.query(`SELECT count(*)::text AS n FROM app.dataset_versions WHERE layer_key = $1`, [layer])).rows[0].n);
const active = async (c: pg.PoolClient, layer: string) =>
  (await c.query<{ id: string; kind: string; source: string; source_version: string | null; feature_count: number | null }>(
    `SELECT id, kind, source, source_version, feature_count FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer])).rows[0];

describe.skipIf(!DB)('load-geojson against the database', () => {
  it('loads new content as one active ingest version, stamped and counted', async () => {
    await inRollback(async (c) => {
      const before = await versionCount(c, 'stations');
      const load = stations('a');
      const out = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(out.action).toBe('loaded');
      expect(out.summary).toMatch(/2 features/);
      expect(await versionCount(c, 'stations')).toBe(before + 1);
      const v = await active(c, 'stations');
      expect(v).toMatchObject({ id: out.versionId, kind: 'ingest', source: load.source, source_version: 'mapping-1', feature_count: 2 });
      const { rows } = await c.query<{ p: string[] }>(
        `SELECT province_codes AS p FROM water.stations WHERE dataset_version_id = $1 ORDER BY external_id`, [v.id]);
      // Stamped by activate(): both points are inside the six provinces.
      expect(rows.every((r) => r.p.length === 1)).toBe(true);
    });
  });

  it('analyses the table it filled, after activation, so the planner is not blind until autovacuum gets there', async () => {
    // Measured on rivers, loaded seconds earlier and never analysed: a self-join over the active
    // view took 72 s, and 11 s once the table had statistics. Autovacuum only gets to a new table
    // about a minute later, which is how a CI run timed out on a test that usually took 8 s.
    await inRollback(async (c) => {
      const spy = vi.spyOn(c, 'query');
      try {
        await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
        const sql = spy.mock.calls.map((call) => String(call[0]).trim());
        const counted = sql.findIndex((q) => q.startsWith('UPDATE app.dataset_versions SET feature_count'));
        expect(counted).toBeGreaterThan(-1);
        expect(sql.indexOf('ANALYZE water.stations')).toBeGreaterThan(counted);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('content idempotency: the same content creates no version and re-stamps the active chain', async () => {
    await inRollback(async (c) => {
      const load = stations('a');
      const first = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      const before = await versionCount(c, 'stations');
      // Wipe the codes so a re-stamp is observable.
      await c.query(`UPDATE water.stations SET province_codes = '{}' WHERE dataset_version_id = $1`, [first.versionId]);
      const again = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(again.action).toBe('restamped');
      expect(await versionCount(c, 'stations')).toBe(before);
      expect((await active(c, 'stations')).id).toBe(first.versionId);
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM water.stations WHERE dataset_version_id = $1 AND province_codes <> '{}'`, [first.versionId]);
      expect(Number(rows[0].n)).toBe(2);
    });
  });

  it('the edit guard: new content over steward edits fails, naming the flag', async () => {
    await inRollback(async (c) => {
      await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const svc = versionsService(pool);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      expect((await active(c, 'stations')).kind).toBe('edit');
      const before = await versionCount(c, 'stations');
      await expect(applyLoadGeojson(pool, c, stations('b'), { supersedeEdits: false })).rejects.toThrow(
        'stations has steward edits on top of its last load; loading new content would hide them. Re-run with --supersede-edits stations to proceed.'
      );
      expect(await versionCount(c, 'stations')).toBe(before);
      expect((await active(c, 'stations')).id).toBe(draft);
    });
  });

  it('unchanged content under steward edits re-stamps the whole chain and leaves the edits active', async () => {
    await inRollback(async (c) => {
      const load = stations('a');
      const root = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      const svc = versionsService(pool);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      const out = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      expect(out.summary).toMatch(/2 versions/);
      expect((await active(c, 'stations')).id).toBe(draft);
      expect(root.versionId).not.toBe(draft);
    });
  });

  it('--supersede-edits loads the new content over the edits', async () => {
    await inRollback(async (c) => {
      await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const svc = versionsService(pool);
      await svc.commitEditDraft(c, 'stations', await svc.openEditDraft(c, 'stations'));
      const next = stations('b');
      const out = await applyLoadGeojson(pool, c, next, { supersedeEdits: true });
      expect(out.action).toBe('loaded');
      expect(await active(c, 'stations')).toMatchObject({ kind: 'ingest', source: next.source });
    });
  });

  it('a new mapping revision loads the same file again as a new version', async () => {
    // A version is the content of its files AND the revision of the mapping that loaded it. Before
    // this, a changed column map re-ran the stage, found the file unchanged, re-stamped, and
    // reported success with the old columns still in the table.
    await inRollback(async (c) => {
      const first = await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const before = await versionCount(c, 'stations');
      const out = await applyLoadGeojson(pool, c, { ...stations('a'), mapping: 'mapping-2' }, { supersedeEdits: false });
      expect(out.action).toBe('loaded');
      expect(out.versionId).not.toBe(first.versionId);
      expect(await versionCount(c, 'stations')).toBe(before + 1);
      expect(await active(c, 'stations')).toMatchObject({ source: stations('a').source, source_version: 'mapping-2' });
    });
  });

  it('a new mapping revision over steward edits is refused like new content', async () => {
    await inRollback(async (c) => {
      await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const svc = versionsService(pool);
      await svc.commitEditDraft(c, 'stations', await svc.openEditDraft(c, 'stations'));
      await expect(
        applyLoadGeojson(pool, c, { ...stations('a'), mapping: 'mapping-2' }, { supersedeEdits: false })
      ).rejects.toThrow(/stations has steward edits on top of its last load/);
    });
  });

  it('a version the old seed command loaded is re-labelled by the build, not loaded again, even under edits', async () => {
    // A machine that never ran atlas:adopt. The content is identical, so there is nothing to load
    // and no reason to stop for the edits on top of it.
    await inRollback(async (c) => {
      const load = { ...stations('a'), legacySource: 'stations.geojson' };
      const svc = versionsService(pool);
      const legacy = await svc.createIngestVersion(c, { layerKey: 'stations', source: 'stations.geojson' });
      await loadFeatures(c, { table: 'stations', file: load.files[0].path, columns: load.files[0].columns }, legacy);
      await svc.activate(c, 'stations', legacy);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      const before = await versionCount(c, 'stations');

      const out = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      expect(out.summary).toMatch(/re-labelled/);
      expect(out.versionId).toBe(legacy);
      expect(await versionCount(c, 'stations')).toBe(before);
      expect((await active(c, 'stations')).id).toBe(draft);
      const { rows } = await c.query(`SELECT source, source_version FROM app.dataset_versions WHERE id = $1`, [legacy]);
      expect(rows[0]).toEqual({ source: load.source, source_version: 'mapping-1' });
    });
  });

  it('holds the layer\'s version rows for the whole load, so an edit cannot be committed under it', async () => {
    // Committing an edit flips the active pointer and so needs this row. Without the lock, an edit
    // committed while a load is running would be deactivated by the load, unseen by its guard.
    // The re-stamp path writes nothing to app.dataset_versions, so the lock here is the loader's own.
    const stage = ALL_DATASETS.find((d) => d.id === 'stations')!.stages.find((s) => s.type === 'load-geojson')!;
    if (stage.type !== 'load-geojson') throw new Error('unreachable');
    await inRollback(async (c) => {
      const out = await applyLoadGeojson(pool, c, resolveLoad(stage), { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      const other = await pool.connect();
      try {
        await expect(
          other.query(`SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active FOR UPDATE NOWAIT`)
        ).rejects.toThrow(/could not obtain lock/);
      } finally {
        other.release();
      }
    });
  });

  it('prunes a layer it finds unchanged, keeping the two most recent earlier loads', async () => {
    const stage = ALL_DATASETS.find((d) => d.id === 'stations')!.stages.find((s) => s.type === 'load-geojson')!;
    if (stage.type !== 'load-geojson') throw new Error('unreachable');
    await inRollback(async (c) => {
      // Three loads that were never activated, newer than every (pinned) existing version.
      const svc = versionsService(pool);
      const made: string[] = [];
      for (const label of ['old-1', 'old-2', 'old-3']) {
        made.push(await svc.createIngestVersion(c, { layerKey: 'stations', source: 'prune test', label }));
      }
      const out = await applyLoadGeojson(pool, c, resolveLoad(stage), { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      const { rows } = await c.query<{ id: string }>(
        `SELECT id::text AS id FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [made]
      );
      // The two newest earlier loads stay; the oldest of the three goes.
      expect(rows.map((r) => r.id).sort()).toEqual([made[1], made[2]].sort());
    });
  });

  it('refuses a column map that returns something other than a column name', async () => {
    await inRollback(async (c) => {
      await expect(
        applyLoadGeojson(pool, c, {
          layer: 'admin', versioned: false, source: 'unused', mapping: 'mapping-1',
          // Both tables, as the real stage has them: wards reference provinces, so they go first.
          files: [
            {
              path: resolveStageFile({ file: 'seeds/provinces-34.geojson' }),
              target: 'admin.provinces', multiPolygon: true,
              columns: () => ({ 'code) VALUES (1); --': 'x' }),
            },
            { path: resolveStageFile({ file: 'seeds/wards-region.geojson' }), columns: ADMIN_WARD_COLUMNS, target: 'admin.wards', multiPolygon: true },
          ],
        }, { supersedeEdits: false })
      ).rejects.toThrow(/is not a column name/);
    });
  });

  it('loads the two river files into one version; activation builds the hierarchy and passes the gates', async () => {
    await inRollback(async (c) => {
      const ways = resolveStageFile({ file: 'seeds/osm-rivers-region.geojson' });
      const reaches = resolveStageFile({ file: 'seeds/hydrorivers-region.geojson' });
      const out = await applyLoadGeojson(pool, c, {
        layer: 'rivers', versioned: true, source: 'osm-rivers-region.geojson+hydrorivers-region.geojson@sha256:test', mapping: 'mapping-1',
        files: [
          { path: ways, columns: RIVER_WAY_COLUMNS, multiLine: true },
          { path: reaches, columns: RIVER_REACH_COLUMNS, multiLine: true },
        ],
      }, { supersedeEdits: true });
      expect(out.action).toBe('loaded');
      const { rows } = await c.query<{ level: number; n: string }>(
        `SELECT feature_level AS level, count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1 GROUP BY 1 ORDER BY 1`,
        [out.versionId]);
      expect(rows.map((r) => [r.level, Number(r.n)])).toEqual([[1, 588], [2, 13045], [3, 9486]]);
      // feature_count is taken after activation, so it includes the derived level-1 rivers.
      expect((await active(c, 'rivers')).feature_count).toBe(588 + 13045 + 9486);
    });
  }, 600_000);

  it('non-versioned mode replaces the target tables', async () => {
    await inRollback(async (c) => {
      // A sentinel proves replacement, not upsert.
      await c.query(
        `INSERT INTO admin.provinces (code, name, geom)
         VALUES ('zz', 'sentinel', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,0 0))'), 4326)))`);
      const spy = vi.spyOn(c, 'query');
      const out = await applyLoadGeojson(pool, c, {
        layer: 'admin', versioned: false, source: 'unused', mapping: 'mapping-1',
        files: [
          { path: resolveStageFile({ file: 'seeds/provinces-34.geojson' }), columns: ADMIN_PROVINCE_COLUMNS, target: 'admin.provinces', multiPolygon: true },
          { path: resolveStageFile({ file: 'seeds/wards-region.geojson' }), columns: ADMIN_WARD_COLUMNS, target: 'admin.wards', multiPolygon: true },
        ],
      }, { supersedeEdits: false });
      expect(out.action).toBe('replaced');
      // Both tables analysed once they are full: every layer's stamping joins against them next.
      const sql = spy.mock.calls.map((call) => String(call[0]).trim());
      spy.mockRestore();
      expect(sql.slice(-2)).toEqual(['ANALYZE admin.provinces', 'ANALYZE admin.wards']);
      const p = await c.query<{ n: string; z: string }>(
        `SELECT count(*)::text AS n, count(*) FILTER (WHERE code = 'zz')::text AS z FROM admin.provinces`);
      expect([Number(p.rows[0].n), Number(p.rows[0].z)]).toEqual([34, 0]);
      const w = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM admin.wards`);
      expect(Number(w.rows[0].n)).toBeGreaterThan(0);
      expect(out.summary).toMatch(/admin\.provinces 34/);
    });
  }, 120_000);

  it('non-versioned mode refreshes admin.working_region', async () => {
    await inRollback(async (c) => {
      // Make the stored union stale: drop a region province, refresh, so the view lacks it.
      await c.query(`DELETE FROM admin.wards WHERE province_code = '66'`);
      await c.query(`DELETE FROM admin.provinces WHERE code = '66'`);
      await c.query(`REFRESH MATERIALIZED VIEW admin.working_region`);
      const before = await c.query<{ a: number }>(`SELECT ST_Area(g) AS a FROM admin.working_region`);
      await applyLoadGeojson(pool, c, {
        layer: 'admin', versioned: false, source: 'unused', mapping: 'mapping-1',
        files: [
          { path: resolveStageFile({ file: 'seeds/provinces-34.geojson' }), columns: ADMIN_PROVINCE_COLUMNS, target: 'admin.provinces', multiPolygon: true },
          { path: resolveStageFile({ file: 'seeds/wards-region.geojson' }), columns: ADMIN_WARD_COLUMNS, target: 'admin.wards', multiPolygon: true },
        ],
      }, { supersedeEdits: false });
      const { rows } = await c.query<{ same: boolean; grew: boolean }>(
        `SELECT ST_Equals(w.g, u.g) AS same, ST_Area(w.g) > $1 AS grew
           FROM admin.working_region w,
                (SELECT ST_Union(geom) AS g FROM admin.provinces
                  WHERE code = ANY(ARRAY['48','51','52','56','66','68'])) u`,
        [before.rows[0].a]);
      expect(rows[0]).toEqual({ same: true, grew: true });
    });
  }, 120_000);
});
