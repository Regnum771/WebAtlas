import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { setGeoserverFetch, UPSTREAM_FAILED, type GeoserverFetch } from './proxy';

/*
 * The map-image proxy, GET /api/catalogue/:id/wms. GeoServer is a fake fetch (setGeoserverFetch):
 * these tests never reach the real one.
 */

const previousGeoserver = process.env.GEOSERVER_URL;
process.env.GEOSERVER_URL = 'http://gs.test:8080/geoserver/';

const app = buildApp();
const PW = 's1-proxy-pass-123';
const email = (who: string) => `s1-px-${who}@webatlas.test`;
const OWNER = email('owner');
const OTHER = email('other');
const SUB_OWNER = `s1-px-sub-${randomUUID()}`;
const SUB_OTHER = `s1-px-sub-${randomUUID()}`;

// Fixture pks are far above anything GeoNode hands out (catalogue.test.ts uses 9000xx).
const PK = { pub: 900101, draft: 900102, otherWs: 900103, map: 900104, doc: 900105, restricted: 900106 };
const FIXTURE_PKS = Object.values(PK);
const resourceIds = new Map<number, string>();
const LAYER = (pk: number) => `geonode:s1_px_${pk}`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

interface Call { url: URL; headers: Record<string, string> }
let calls: Call[] = [];
let respond: () => Response = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
const fakeFetch: GeoserverFetch = async (url, init) => {
  calls.push({ url: new URL(url), headers: init.headers });
  return respond();
};

const tokens = new Map<string, string>();
async function auth(who: string) {
  let token = tokens.get(who);
  if (!token) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW } });
    expect(res.statusCode).toBe(200);
    token = res.json().token as string;
    tokens.set(who, token);
  }
  return { authorization: `Bearer ${token}` };
}

async function insertResource(pk: number, o: {
  published: boolean; sub: string | null; alternate?: string; kind?: string; view?: boolean;
}) {
  // GeoNode's anonymous view defaults to granted here (public_view); the restricted fixture has none.
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
                                      is_published, is_approved, public_view, variable, unit, time_steps, bbox4326, origin)
     VALUES ($1, $2, $3, $7, $4, '', $5, 'VN', $6, $6, $8, 'mưa', 'mm',
             ARRAY['2026-10-01T00:00:00Z']::timestamptz[], ARRAY[102,8,110,24]::float8[], 'pipeline')
     RETURNING id`,
    [pk, randomUUID(), o.alternate ?? LAYER(pk), `Proxy ${pk}`, o.sub, o.published, o.kind ?? 'timeseries', o.view ?? true]
  );
  resourceIds.set(pk, rows[0].id);
}

async function cleanup() {
  await getPool().query(`DELETE FROM catalogue.resources WHERE geonode_pk = ANY($1::int[])`, [FIXTURE_PKS]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 's1-px-%@webatlas.test'`);
}

const GETMAP = 'SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&BBOX=102,8,110,24&WIDTH=256&HEIGHT=256&SRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&STYLES=';
const wms = (pk: number, query: string) => `/api/catalogue/${resourceIds.get(pk)}/wms?${query}`;

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  const subs = new Map([[OWNER, SUB_OWNER], [OTHER, SUB_OTHER]]);
  for (const [who, sub] of subs) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [row.id, sub]);
  }
  await insertResource(PK.pub, { published: true, sub: SUB_OTHER });
  await insertResource(PK.draft, { published: false, sub: SUB_OWNER });
  await insertResource(PK.otherWs, { published: true, sub: null, alternate: 'thuyvan:s1_px_mua' });
  await insertResource(PK.map, { published: true, sub: null, kind: 'map' });
  await insertResource(PK.doc, { published: true, sub: SUB_OWNER, kind: 'document' });
  await insertResource(PK.restricted, { published: true, sub: SUB_OWNER, view: false });
  setGeoserverFetch(fakeFetch);
});

afterAll(async () => {
  setGeoserverFetch(null);
  await cleanup();
  if (previousGeoserver === undefined) delete process.env.GEOSERVER_URL;
  else process.env.GEOSERVER_URL = previousGeoserver;
  await app.close();
});

beforeEach(() => {
  calls = [];
  respond = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
});

describe('GET /api/catalogue/:id/wms', () => {
  it('forces LAYERS to the entry\'s own layer when the client asks for another', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, `${GETMAP}&LAYERS=webatlas:secret_layer`) });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.getAll('LAYERS')).toEqual([LAYER(PK.pub)]);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe('http://gs.test:8080/geoserver/geonode/wms');
  });

  it('streams GeoServer\'s body and content type back, with a public cache header for a published entry', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('calls GeoServer with the admin basic auth, not the caller\'s token', async () => {
    await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP), headers: await auth(OTHER) });
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
  });

  it('treats parameter names and REQUEST case-insensitively, still forcing the layer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: wms(PK.pub, 'service=WMS&request=getmap&layers=webatlas:secret_layer&bbox=102,8,110,24&width=256&height=256&srs=EPSG:4326&format=image/png'),
    });
    expect(res.statusCode).toBe(200);
    const sent = calls[0].url.searchParams;
    expect(sent.getAll('LAYERS')).toEqual([LAYER(PK.pub)]);
    expect(sent.get('REQUEST')).toBe('GetMap');
    expect(sent.get('WIDTH')).toBe('256');
    expect([...sent.keys()].filter((k) => k.toUpperCase() === 'LAYERS')).toEqual(['LAYERS']);
  });

  it('forces QUERY_LAYERS on GetFeatureInfo and LAYER on GetLegendGraphic', async () => {
    const info = await app.inject({
      method: 'GET',
      url: wms(PK.pub, `${GETMAP.replace('GetMap', 'GetFeatureInfo')}&LAYERS=a:b&QUERY_LAYERS=a:b&X=10&Y=20&INFO_FORMAT=application/json&FEATURE_COUNT=5`),
    });
    expect(info.statusCode).toBe(200);
    expect(calls[0].url.searchParams.get('QUERY_LAYERS')).toBe(LAYER(PK.pub));
    expect(calls[0].url.searchParams.get('X')).toBe('10');
    expect(calls[0].url.searchParams.get('INFO_FORMAT')).toBe('application/json');

    const legend = await app.inject({
      method: 'GET', url: wms(PK.pub, 'SERVICE=WMS&REQUEST=GetLegendGraphic&LAYER=a:b&FORMAT=image/png&LEGEND_OPTIONS=fontSize:10'),
    });
    expect(legend.statusCode).toBe(200);
    expect(calls[1].url.searchParams.get('LAYER')).toBe(LAYER(PK.pub));
    expect(calls[1].url.searchParams.get('LEGEND_OPTIONS')).toBe('fontSize:10');
  });

  it('passes TIME through', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, `${GETMAP}&TIME=2026-10-01T01:00:00Z`) });
    expect(res.statusCode).toBe(200);
    expect(calls[0].url.searchParams.get('TIME')).toBe('2026-10-01T01:00:00Z');
    const ms = await app.inject({ method: 'GET', url: wms(PK.pub, `${GETMAP}&TIME=2026-10-01T01:00:00.000Z`) });
    expect(ms.statusCode).toBe(200);
  });

  it('refuses a TIME that is not one ISO instant to the second (range, list, current, reduced precision) with 400', async () => {
    for (const t of ['1900/2100', '2026-10-01T00:00:00Z/2026-10-02T00:00:00Z', '2026-10-01,2026-10-02', 'current', '2026-13-45',
      '2026-10-01', '2026-10-01T01:00Z', '2026-10']) {
      const res = await app.inject({ method: 'GET', url: wms(PK.pub, `${GETMAP}&TIME=${encodeURIComponent(t)}`) });
      expect(res.statusCode, t).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('allows only image formats on GetMap and PNG on GetLegendGraphic', async () => {
    for (const f of ['image/png8', 'image/jpeg', 'image/webp', 'IMAGE/PNG']) {
      const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('FORMAT=image/png', `FORMAT=${f}`)) });
      expect(res.statusCode, f).toBe(200);
    }
    expect(calls.map((c) => c.url.searchParams.get('FORMAT'))).toEqual(['image/png8', 'image/jpeg', 'image/webp', 'image/png']);
    calls = [];
    for (const f of ['application/vnd.google-earth.kml+xml', 'application/openlayers', 'image/geotiff', 'application/rss+xml', 'text/html']) {
      const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('FORMAT=image/png', `FORMAT=${encodeURIComponent(f)}`)) });
      expect(res.statusCode, f).toBe(400);
    }
    const legend = await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WMS&REQUEST=GetLegendGraphic&FORMAT=image/jpeg') });
    expect(legend.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    // No FORMAT: PNG is asked for, never GeoServer's own default.
    const none = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('&FORMAT=image/png', '')) });
    expect(none.statusCode).toBe(200);
    expect(calls[0].url.searchParams.get('FORMAT')).toBe('image/png');
  });

  it('allows only JSON and plain text as INFO_FORMAT', async () => {
    const info = (f: string) => app.inject({
      method: 'GET',
      url: wms(PK.pub, `${GETMAP.replace('GetMap', 'GetFeatureInfo')}&QUERY_LAYERS=a:b&I=10&J=20&INFO_FORMAT=${encodeURIComponent(f)}`),
    });
    expect((await info('text/plain')).statusCode).toBe(200);
    for (const f of ['text/html', 'application/vnd.ogc.gml', 'text/xml']) expect((await info(f)).statusCode, f).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('answers 404 for a map or document entry, without calling GeoServer', async () => {
    expect((await app.inject({ method: 'GET', url: wms(PK.map, GETMAP) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: wms(PK.doc, GETMAP), headers: await auth(OWNER) })).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('hides a published entry GeoNode does not let anonymous users view, except from its owner', async () => {
    expect((await app.inject({ method: 'GET', url: wms(PK.restricted, GETMAP) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: wms(PK.restricted, GETMAP), headers: await auth(OTHER) })).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    const own = await app.inject({ method: 'GET', url: wms(PK.restricted, GETMAP), headers: await auth(OWNER) });
    expect(own.statusCode).toBe(200);
    expect(own.headers['cache-control']).toBe('private, max-age=300');
  });

  it('varies the cached answer by Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP) });
    expect(String(res.headers.vary)).toMatch(/(^|,\s*)Authorization(\s*,|$)/);
  });

  it('drops parameters outside the list (SLD_BODY, SLD, EXCEPTIONS, ...)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: wms(PK.pub, `${GETMAP}&SLD_BODY=${encodeURIComponent('<StyledLayerDescriptor/>')}&SLD=http://evil/x.sld&EXCEPTIONS=application/vnd.ogc.se_inimage&ENV=a:b`),
    });
    expect(res.statusCode).toBe(200);
    const keys = [...calls[0].url.searchParams.keys()];
    for (const k of ['SLD_BODY', 'SLD', 'EXCEPTIONS', 'ENV']) expect(keys).not.toContain(k);
  });

  it('refuses GetCapabilities with 400 and never calls GeoServer', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WMS&REQUEST=GetCapabilities') });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses a request without REQUEST, and a WFS request', async () => {
    expect((await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WMS&LAYERS=x') })).statusCode).toBe(400);
    const wfs = await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WFS&REQUEST=GetMap&TYPENAMES=x') });
    expect(wfs.statusCode).toBe(400);
    const getFeature = await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=x') });
    expect(getFeature.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses WIDTH=4096 or HEIGHT=4096 with 400', async () => {
    const wide = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('WIDTH=256', 'WIDTH=4096')) });
    expect(wide.statusCode).toBe(400);
    const tall = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('HEIGHT=256', 'HEIGHT=4096')) });
    expect(tall.statusCode).toBe(400);
    const odd = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('WIDTH=256', 'WIDTH=1e9')) });
    expect(odd.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    const edge = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('WIDTH=256', 'WIDTH=2048')) });
    expect(edge.statusCode).toBe(200);
  });

  it('refuses a parameter given twice with 400', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, `${GETMAP}&TIME=a&TIME=b`) });
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('answers 404 to an anonymous caller on an unpublished entry, without calling GeoServer', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.draft, GETMAP) });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('answers 404 to another user on an unpublished entry', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.draft, GETMAP), headers: await auth(OTHER) });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('serves the owner their unpublished entry with a private cache header', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.draft, GETMAP), headers: await auth(OWNER) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(calls[0].url.searchParams.get('LAYERS')).toBe(LAYER(PK.draft));
  });

  it('answers 404 for an id that is not in the catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/catalogue/${randomUUID()}/wms?${GETMAP}` });
    expect(res.statusCode).toBe(404);
  });

  it('uses the workspace of the entry\'s layer name', async () => {
    const res = await app.inject({ method: 'GET', url: wms(PK.otherWs, GETMAP) });
    expect(res.statusCode).toBe(200);
    expect(calls[0].url.pathname).toBe('/geoserver/thuyvan/wms');
    expect(calls[0].url.searchParams.get('LAYERS')).toBe('thuyvan:s1_px_mua');
  });

  it('turns a GeoServer error into 502 with a fixed message, never its XML', async () => {
    respond = () => new Response('<ServiceExceptionReport>secret path /opt/geoserver</ServiceExceptionReport>', {
      status: 500, headers: { 'content-type': 'application/xml' },
    });
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP) });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toBe(UPSTREAM_FAILED);
    expect(res.body).not.toContain('ServiceExceptionReport');
  });

  it('turns a 200 ServiceException (WMS 1.1.1) into the same 502', async () => {
    respond = () => new Response('<ServiceExceptionReport/>', {
      status: 200, headers: { 'content-type': 'application/vnd.ogc.se_xml;charset=UTF-8' },
    });
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP) });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('ServiceExceptionReport');
  });

  it('turns a 200 WMS 1.3.0 exception (text/xml) into the same 502', async () => {
    respond = () => new Response('<ServiceExceptionReport>/opt/geoserver/data</ServiceExceptionReport>', {
      status: 200, headers: { 'content-type': 'text/xml;charset=UTF-8' },
    });
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP.replace('1.1.1', '1.3.0')) });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('ServiceExceptionReport');
    const legend = await app.inject({ method: 'GET', url: wms(PK.pub, 'SERVICE=WMS&REQUEST=GetLegendGraphic&FORMAT=image/png') });
    expect(legend.statusCode).toBe(502);
  });

  it('turns an unreachable GeoServer into 502', async () => {
    respond = () => { throw new TypeError('fetch failed'); };
    const res = await app.inject({ method: 'GET', url: wms(PK.pub, GETMAP) });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toBe(UPSTREAM_FAILED);
  });
});
