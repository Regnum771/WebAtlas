import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';

let app: ReturnType<typeof buildApp>;
// app.close() also closes the pool (plugins/db.ts onClose).
beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

// Buon Ma Thuot at zoom 12 holds rivers and lakes; zoom 7 tile 102/59 covers it (both computed from 108.05 E, 12.68 N).
const BMT = { z: 12, x: 3277, y: 1902 };
const versions = async () => (await app.inject({ method: 'GET', url: '/api/tiles/versions' })).json();
const tile = (layer: string, z: number, x: number, y: number, v?: string) =>
  app.inject({ method: 'GET', url: `/api/tiles/${layer}/${z}/${x}/${y}.pbf${v ? `?v=${v}` : ''}` });
const decode = (body: Buffer, layer: string) => new VectorTile(new PbfReader(body)).layers[layer];

describe('GET /api/tiles/versions', () => {
  it('returns the active version ids of rivers and lakes', async () => {
    const { rows } = await getPool().query<{ layer_key: string; id: string }>(
      `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers','lakes')`);
    const want = Object.fromEntries(rows.map((r) => [r.layer_key, r.id]));
    expect(await versions()).toEqual(want);
  });
});

describe('GET /api/tiles/:layer/:z/:x/:y.pbf', () => {
  it('serves rivers with the ISO properties, id and layerKey, cached for good at the active version', async () => {
    const v = (await versions()).rivers;
    const res = await tile('rivers', BMT.z, BMT.x, BMT.y, v);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.mapbox-vector-tile');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const layer = decode(res.rawPayload, 'rivers');
    expect(layer.length).toBeGreaterThan(0);
    const props = layer.feature(0).properties;
    expect(props.layerKey).toBe('rivers');
    expect(typeof props.id).toBe('string');
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['localId', 'geographicalName', 'streamOrder']));
  });

  it('serves lakes the same way', async () => {
    const v = (await versions()).lakes;
    const res = await tile('lakes', BMT.z, BMT.x, BMT.y, v);
    expect(res.statusCode).toBe(200);
    const layer = decode(res.rawPayload, 'lakes');
    expect(layer.feature(0).properties.layerKey).toBe('lakes');
    // MVT omits null values, so one feature may lack a name (and area_km2 is null for every lake today): look across the whole tile.
    const keys = new Set(Array.from({ length: layer.length }, (_, i) => Object.keys(layer.feature(i).properties)).flat());
    expect([...keys]).toEqual(expect.arrayContaining(['id', 'localId', 'geographicalName', 'lakeType']));
  });

  it('serves the far-zoom river layer with the view columns', async () => {
    const res = await tile('rivers_overview', 7, 102, 59);
    expect(res.statusCode).toBe(200);
    const props = decode(res.rawPayload, 'rivers_overview').feature(0).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['name_key', 'stream_order']));
  });

  it('does not let a stale or missing version be cached', async () => {
    expect((await tile('rivers', BMT.z, BMT.x, BMT.y)).headers['cache-control']).toBe('no-cache');
    expect((await tile('rivers', BMT.z, BMT.x, BMT.y, '00000000-0000-0000-0000-000000000000')).headers['cache-control']).toBe('no-cache');
  });

  it('answers 204 for a tile with nothing in it', async () => {
    const res = await tile('lakes', 12, 0, 0);
    expect(res.statusCode).toBe(204);
    expect(res.rawPayload.length).toBe(0);
  });

  it('refuses unknown layers and impossible coordinates', async () => {
    expect((await tile('dams', 7, 102, 59)).statusCode).toBe(404);
    expect((await tile('rivers', 17, 0, 0)).statusCode).toBe(400);
    expect((await tile('rivers', 3, 8, 0)).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tiles/rivers/7/102/59.png' })).statusCode).toBe(400);
  });

  it('is not throttled by the global 100/min limit: a map view requests tiles in bursts', async () => {
    // Lakes, not the far-zoom rivers: that view takes ~2 s a tile, and 150 at once would exhaust the
    // pool's 5 s connection wait; this test is about the rate limit, not tile speed.
    const codes = await Promise.all(Array.from({ length: 150 }, () => tile('lakes', BMT.z, BMT.x, BMT.y)));
    expect(codes.every((r) => r.statusCode === 200)).toBe(true);
  });
});
