import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { boundaryVersion, largestPartPointSql, resetBoundaryTokenCache } from './repository';
import { acceptsGzip } from './controller';

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
  it('returns the active version ids of rivers and lakes, and a token for wards and for provinces', async () => {
    const { rows } = await getPool().query<{ layer_key: string; id: string }>(
      `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers','lakes')`);
    const want = Object.fromEntries(rows.map((r) => [r.layer_key, r.id]));
    const got = await versions();
    expect({ rivers: got.rivers, lakes: got.lakes }).toEqual(want);
    expect(got.wards).toMatch(/^[0-9a-f]{32}$/);
    expect(got.provinces).toMatch(/^[0-9a-f]{32}$/);
    expect(got.provinces).not.toBe(got.wards);
  });

  it.each(['wards', 'provinces'] as const)(
    'changes the %s token when only the geometry of one row moves (rolled back afterwards)',
    async (layer) => {
      resetBoundaryTokenCache();
      const before = await boundaryVersion(getPool(), layer);
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        // Shift one row by about 0.1 m: the attributes stay the same, only the geometry changes.
        await client.query(`UPDATE admin.${layer} SET geom = ST_Translate(geom, 1e-6, 0) WHERE code = (SELECT min(code) FROM admin.${layer})`);
        resetBoundaryTokenCache();
        const inTx = await boundaryVersion(client as never, layer);
        expect(inTx).not.toBe(before);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        resetBoundaryTokenCache();
      }
      expect(await boundaryVersion(getPool(), layer)).toBe(before);
    },
  );

  it('changes the provinces token when only a name changes (rolled back afterwards)', async () => {
    resetBoundaryTokenCache();
    const before = await boundaryVersion(getPool(), 'provinces');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE admin.provinces SET name = name || ' (x)' WHERE code = (SELECT min(code) FROM admin.provinces)`);
      resetBoundaryTokenCache();
      expect(await boundaryVersion(client as never, 'provinces')).not.toBe(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      resetBoundaryTokenCache();
    }
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
    // MVT omits null values and a tile's feature order is not fixed, so the first feature may be an
    // unnamed river: look across the whole tile.
    const keys = new Set(Array.from({ length: layer.length }, (_, i) => Object.keys(layer.feature(i).properties)).flat());
    expect([...keys]).toEqual(expect.arrayContaining(['localId', 'geographicalName', 'streamOrder']));
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

  it('overview tile holds exactly the rivers the view has in the tile, by name', async () => {
    const res = await tile('rivers_overview', 7, 102, 59);
    const layer = decode(res.rawPayload, 'rivers_overview');
    const got = Array.from({ length: layer.length }, (_, i) => String(layer.feature(i).properties.name_key)).sort();
    // Same bounding-box rule on both sides (the tile applies it to the unsimplified geometry, like
    // the view's source rows); a sorted list keeps counts, so a missing or extra unnamed river shows.
    const { rows } = await getPool().query<{ k: string }>(
      `SELECT o.name_key AS k FROM water.rivers_overview o
        WHERE o.geom && ST_Transform(ST_TileEnvelope(7, 102, 59), 4326)`);
    const want = rows.map((r) => r.k).sort();
    expect(got.length).toBeGreaterThan(0);
    expect(got).toEqual(want);
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
    expect((await app.inject({ method: 'GET', url: '/api/tiles/rivers/1e1/0/0.pbf' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tiles/rivers/7/%205/0.pbf' })).statusCode).toBe(400);
  });

  it('is not throttled by the global 100/min limit: a map view requests tiles in bursts', async () => {
    // The point is the rate limit, not throughput. Requests go in waves of 10 (the pool size), so the
    // outcome does not depend on how many connections happen to be free; 15 waves = 150 > 100/min.
    const codes: number[] = [];
    for (let w = 0; w < 15; w++) {
      const wave = await Promise.all(Array.from({ length: 10 }, () => tile('lakes', BMT.z, BMT.x, BMT.y)));
      codes.push(...wave.map((r) => r.statusCode));
    }
    expect(codes).toHaveLength(150);
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});

describe('wards tiles', () => {
  const WARD_PROPS = ['code', 'provinceCode', 'name', 'nameEn', 'fullName', 'areaKm2'];

  it('decode to polygons with the ward properties and one label point per ward', async () => {
    const v = (await versions()).wards;
    const res = await tile('wards', BMT.z, BMT.x, BMT.y, v);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const wards = decode(res.rawPayload, 'wards');
    expect(wards.length).toBeGreaterThan(0);
    const keys = new Set(Array.from({ length: wards.length }, (_, i) => Object.keys(wards.feature(i).properties)).flat());
    expect([...keys]).toEqual(expect.arrayContaining(WARD_PROPS));
    const labels = decode(res.rawPayload, 'ward_labels');
    expect(labels.length).toBeGreaterThan(0);
    expect(Object.keys(labels.feature(0).properties).sort()).toEqual(['code', 'name']);
  });

  it('puts the label of a ward in exactly one of the four child tiles', async () => {
    const parent = decode((await tile('wards', BMT.z, BMT.x, BMT.y)).rawPayload, 'ward_labels');
    const parentCodes = Array.from({ length: parent.length }, (_, i) => String(parent.feature(i).properties.code));
    expect(parentCodes.length).toBeGreaterThan(0);
    const seen: string[] = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const res = await tile('wards', BMT.z + 1, BMT.x * 2 + dx, BMT.y * 2 + dy);
      if (res.statusCode !== 200) continue;
      const l = decode(res.rawPayload, 'ward_labels');
      if (l) for (let i = 0; i < l.length; i++) seen.push(String(l.feature(i).properties.code));
    }
    for (const code of parentCodes) expect(seen.filter((c) => c === code)).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('provinces tiles', () => {
  // Zoom 7 tile 102/59 covers Buon Ma Thuot and several provinces around it.
  const P = { z: 7, x: 102, y: 59 };
  const PROVINCE_PROPS = ['code', 'name', 'nameEn', 'fullName', 'areaKm2'];
  const codesOf = (layer: ReturnType<typeof decode> | undefined) =>
    layer ? Array.from({ length: layer.length }, (_, i) => String(layer.feature(i).properties.code)) : [];

  it('decode to polygons with the province properties and label points, cached for good at the token', async () => {
    const v = (await versions()).provinces;
    const res = await tile('provinces', P.z, P.x, P.y, v);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await tile('provinces', P.z, P.x, P.y)).headers['cache-control']).toBe('no-cache');
    const polys = decode(res.rawPayload, 'provinces');
    expect(polys.length).toBeGreaterThan(1);
    const keys = new Set(Array.from({ length: polys.length }, (_, i) => Object.keys(polys.feature(i).properties)).flat());
    expect([...keys]).toEqual(expect.arrayContaining(PROVINCE_PROPS));
    // Dak Lak (66) holds Buon Ma Thuot.
    expect(codesOf(polys)).toContain('66');
    const labels = decode(res.rawPayload, 'province_labels');
    expect(labels.length).toBeGreaterThan(0);
    expect(Object.keys(labels.feature(0).properties).sort()).toEqual(['code', 'name']);
  });

  it('puts the label of a province in exactly one of the four child tiles', async () => {
    // One zoom up, so the parent holds the labels of several provinces.
    const parent = { z: 6, x: 51, y: 29 };
    const parentCodes = codesOf(decode((await tile('provinces', parent.z, parent.x, parent.y)).rawPayload, 'province_labels'));
    expect(parentCodes.length).toBeGreaterThan(1);
    const seen: string[] = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const res = await tile('provinces', parent.z + 1, parent.x * 2 + dx, parent.y * 2 + dy);
      if (res.statusCode !== 200) continue;
      seen.push(...codesOf(decode(res.rawPayload, 'province_labels')));
    }
    for (const code of parentCodes) expect(seen.filter((c) => c === code)).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('labels every province exactly once across the whole country', async () => {
    // Zoom 5: x 24-26, y 13-15 cover more than the whole of Vietnam, archipelagos included.
    const seen: string[] = [];
    for (const x of [24, 25, 26]) {
      for (const y of [13, 14, 15]) {
        const res = await tile('provinces', 5, x, y);
        if (res.statusCode === 200) seen.push(...codesOf(decode(res.rawPayload, 'province_labels')));
      }
    }
    const { rows } = await getPool().query<{ code: string }>(`SELECT code FROM admin.provinces ORDER BY code`);
    expect(seen.sort()).toEqual(rows.map((r) => r.code));
  });

  it('simplifies the polygons to the zoom of the tile: a country-wide tile is not sent at stored detail', async () => {
    const vertices = (layer: ReturnType<typeof decode>) => {
      let n = 0;
      for (let i = 0; i < layer.length; i++) for (const ring of layer.feature(i).loadGeometry()) n += ring.length;
      return n;
    };
    const far = { z: 5, x: 25, y: 14 };
    const sent = vertices(decode((await tile('provinces', far.z, far.x, far.y)).rawPayload, 'provinces'));
    const { rows } = await getPool().query<{ stored: number }>(
      `SELECT sum(ST_NPoints(ST_Intersection(p.geom, ST_Transform(ST_TileEnvelope($1, $2, $3), 4326))))::int AS stored
         FROM admin.provinces p WHERE p.geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)`, [far.z, far.x, far.y]);
    expect(sent).toBeGreaterThan(100);
    expect(sent).toBeLessThan(rows[0].stored / 4);
    // Up close the tolerance is half a pixel of a far finer grid, so the outline keeps its shape:
    // the tile still has more than a handful of vertices where the border is detailed.
    expect(vertices(decode((await tile('provinces', BMT.z, BMT.x, BMT.y)).rawPayload, 'provinces'))).toBeGreaterThanOrEqual(4);
  });

  it('places each label on the largest part of its province, so an island province is labelled on its mainland', async () => {
    const { rows } = await getPool().query<{ multipart: number; off: number }>(
      `SELECT count(*) FILTER (WHERE ST_NumGeometries(p.geom) > 1)::int AS multipart,
              count(*) FILTER (WHERE NOT ST_Intersects(${largestPartPointSql('p.geom')},
                (SELECT d.geom FROM ST_Dump(p.geom) d ORDER BY ST_Area(d.geom) DESC LIMIT 1)))::int AS off
         FROM admin.provinces p`);
    expect(rows[0].multipart).toBeGreaterThan(0);
    expect(rows[0].off).toBe(0);
  });
});

describe('tile compression', () => {
  it('sends plain bytes without Accept-Encoding and gzip with it, decoding to the same tile', async () => {
    const plain = await tile('rivers', BMT.z, BMT.x, BMT.y);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['vary']).toMatch(/Accept-Encoding/i);
    const zipped = await app.inject({ method: 'GET', url: `/api/tiles/rivers/${BMT.z}/${BMT.x}/${BMT.y}.pbf`, headers: { 'accept-encoding': 'gzip, deflate' } });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers['vary']).toMatch(/Accept-Encoding/i);
    expect(gunzipSync(zipped.rawPayload).equals(plain.rawPayload)).toBe(true);
  });
});

describe('acceptsGzip', () => {
  it('reads the q-values of Accept-Encoding', () => {
    expect(acceptsGzip('gzip, deflate')).toBe(true);
    expect(acceptsGzip('br;q=1, gzip;q=0.5')).toBe(true);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});
