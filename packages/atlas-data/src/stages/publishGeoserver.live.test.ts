import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Pool } from 'pg';
import { executePublishGeoserver } from './publishGeoserver';
import { geoserverEnv } from '../geoserver';

const GS = process.env.GEOSERVER_URL;
const DB = process.env.DATABASE_URL;
const ctx = { datasetId: '__atlasdata_test__', forced: false, log: () => {} };
const VIEW = '__atlasdata_test__view';
const LAYER = '__atlasdata_test__layer';

/**
 * Publishes a view this test owns, never a real layer (Plan A final review): the view lives in the
 * `water` schema the webatlas_water datastore reads, and both it and its featuretype are removed in
 * afterAll.
 */
describe.skipIf(!GS || !DB)('publish-geoserver against the running GeoServer', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB });
    await pool.query(
      `CREATE OR REPLACE VIEW water.${VIEW} AS
         SELECT 1::int AS id, ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326)::geometry(Point, 4326) AS geom`
    );
  });

  afterAll(async () => {
    const gs = geoserverEnv();
    await fetch(
      `${gs.url}/rest/workspaces/${gs.workspace}/datastores/${gs.workspace}_water/featuretypes/${LAYER}?recurse=true`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64') },
      }
    );
    await pool.query(`DROP VIEW IF EXISTS water.${VIEW}`);
    await pool.end();
  });

  it('publishes a layer it owns, idempotently, and the layer serves WFS', async () => {
    const stage = { type: 'publish-geoserver' as const, layer: LAYER, nativeName: VIEW };
    const first = await executePublishGeoserver({} as Pool, stage, ctx);
    expect(first.summary).toMatch(new RegExp(`→ ${VIEW} \\((created|unchanged)\\)$`));
    const second = await executePublishGeoserver({} as Pool, stage, ctx);
    expect(second.summary).toMatch(/\(unchanged\)$/);

    const res = await fetch(
      `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:${LAYER}&outputFormat=application/json&count=1`
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { features: unknown[] }).features).toHaveLength(1);
  }, 60_000);

  it('fails when the backing relation does not exist', async () => {
    await expect(
      executePublishGeoserver(
        {} as Pool,
        { type: 'publish-geoserver', layer: '__atlasdata_test__missing', nativeName: '__atlasdata_test__no_such_view' },
        ctx
      )
    ).rejects.toThrow();
  }, 60_000);
});
