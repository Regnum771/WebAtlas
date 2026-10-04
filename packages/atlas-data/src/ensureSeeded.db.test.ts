import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureSeeded } from './ensureSeeded';
import { ALL_DATASETS } from './registry';

/**
 * ensureSeeded commits, so these tests work on the real layers of a seeded database and assert
 * that it changes nothing there. The loading and re-labelling paths themselves are covered under
 * rollback by loadGeojson.db.test.ts and adoptLegacy.db.test.ts.
 */
const DB = process.env.DATABASE_URL;
let pool: pg.Pool;
beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => { await pool?.end(); });

const versions = async () =>
  Number((await pool.query(`SELECT count(*)::text AS n FROM app.dataset_versions`)).rows[0].n);
const activeIds = async () =>
  (await pool.query<{ layer_key: string; id: string }>(
    `SELECT layer_key, id FROM app.dataset_versions WHERE is_active ORDER BY layer_key`)).rows;

describe.skipIf(!DB)('ensureSeeded', () => {
  it('covers admin_boundaries, the seven layers and rivers, boundaries first', async () => {
    const out = await ensureSeeded(pool);
    expect(out.map((o) => o.id)).toEqual([
      'admin_boundaries', 'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion',
      'flood_generation', 'lakes', 'rivers',
    ]);
  }, 600_000);

  it('on a seeded database it creates no version, moves no active pointer, and says unchanged', async () => {
    await ensureSeeded(pool); // whatever the first call had to do is done
    const before = { n: await versions(), active: await activeIds() };
    const out = await ensureSeeded(pool);
    expect(out.every((o) => o.action === 'unchanged'), JSON.stringify(out)).toBe(true);
    expect(await versions()).toBe(before.n);
    expect(await activeIds()).toEqual(before.active);
  }, 600_000);

  it('leaves every layer resting on its committed content, whatever was on top', async () => {
    await ensureSeeded(pool);
    const { rows } = await pool.query<{ layer_key: string; source: string }>(
      `WITH RECURSIVE chain AS (
         SELECT layer_key, id, kind, source, parent_version_id FROM app.dataset_versions WHERE is_active
         UNION ALL
         SELECT v.layer_key, v.id, v.kind, v.source, v.parent_version_id
           FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
       )
       SELECT layer_key, source FROM chain WHERE kind = 'ingest' ORDER BY layer_key`);
    for (const r of rows) expect(r.source, r.layer_key).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(rows.map((r) => r.layer_key)).toEqual(
      ['dams', 'drought_points', 'flood_generation', 'flood_zones', 'lakes', 'rivers', 'saltwater_intrusion', 'stations']);
  }, 600_000);

  it('writes no build state: it is not a build', async () => {
    const count = async () =>
      Number((await pool.query(`SELECT count(*)::text AS n FROM app.dataset_stage_state`)).rows[0].n);
    const before = await count();
    await ensureSeeded(pool);
    expect(await count()).toBe(before);
  }, 600_000);

  it('ignores datasets with no load-geojson stage', async () => {
    const out = await ensureSeeded(pool, ALL_DATASETS.filter((d) => ['demo', 'basemap', 'dem'].includes(d.id)));
    expect(out).toEqual([]);
  });
});
