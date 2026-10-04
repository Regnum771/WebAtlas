import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { versionsService } from '@webatlas/versioning';
import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS, ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS } from '@webatlas/shared';
import { applyLoadGeojson, type ResolvedLoad } from './loadGeojson';
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
    layer: 'stations', versioned: true, source: `stations.geojson@sha256:${sha(sha(body))}`,
    files: [{ path, columns: (p) => ({ external_id: p.id, name: p.name }) }],
  };
}

async function inRollback<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const versionCount = async (c: pg.PoolClient, layer: string) =>
  Number((await c.query(`SELECT count(*)::text AS n FROM app.dataset_versions WHERE layer_key = $1`, [layer])).rows[0].n);
const active = async (c: pg.PoolClient, layer: string) =>
  (await c.query<{ id: string; kind: string; source: string; feature_count: number | null }>(
    `SELECT id, kind, source, feature_count FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer])).rows[0];

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
      expect(v).toMatchObject({ id: out.versionId, kind: 'ingest', source: load.source, feature_count: 2 });
      const { rows } = await c.query<{ p: string[] }>(
        `SELECT province_codes AS p FROM water.stations WHERE dataset_version_id = $1 ORDER BY external_id`, [v.id]);
      // Stamped by activate(): both points are inside the six provinces.
      expect(rows.every((r) => r.p.length === 1)).toBe(true);
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

  it('loads the two river files into one version; activation builds the hierarchy and passes the gates', async () => {
    await inRollback(async (c) => {
      const ways = resolveStageFile({ file: 'seeds/osm-rivers-region.geojson' });
      const reaches = resolveStageFile({ file: 'seeds/hydrorivers-region.geojson' });
      const out = await applyLoadGeojson(pool, c, {
        layer: 'rivers', versioned: true, source: 'osm-rivers-region.geojson+hydrorivers-region.geojson@sha256:test',
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
      const out = await applyLoadGeojson(pool, c, {
        layer: 'admin', versioned: false, source: 'unused',
        files: [
          { path: resolveStageFile({ file: 'apps/web/public/provinces-34.geojson', root: 'repo' }), columns: ADMIN_PROVINCE_COLUMNS, target: 'admin.provinces', multiPolygon: true },
          { path: resolveStageFile({ file: 'apps/web/public/wards-region.geojson', root: 'repo' }), columns: ADMIN_WARD_COLUMNS, target: 'admin.wards', multiPolygon: true },
        ],
      }, { supersedeEdits: false });
      expect(out.action).toBe('replaced');
      const p = await c.query<{ n: string; z: string }>(
        `SELECT count(*)::text AS n, count(*) FILTER (WHERE code = 'zz')::text AS z FROM admin.provinces`);
      expect([Number(p.rows[0].n), Number(p.rows[0].z)]).toEqual([34, 0]);
      const w = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM admin.wards`);
      expect(Number(w.rows[0].n)).toBeGreaterThan(0);
      expect(out.summary).toMatch(/admin\.provinces 34/);
    });
  }, 120_000);
});
