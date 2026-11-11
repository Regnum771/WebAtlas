import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import { resolveInStore, unlinkInStore } from '../workspace/fileStore';
import { IMPORT_MAX_ROWS, IMPORT_STEPS } from '../workspace/jobs';
import { MAP_NOT_FOUND } from '../workspace/access';
import { setGeoserverFetch, type GeoserverFetch } from './proxy';
import { COPY_FAILED, LINK_ONLY, NO_DOWNLOAD } from './copy';

/*
 * "Sao vào Bản của tôi", POST /api/catalogue/:id/copy. GeoServer is a fake fetch
 * (setGeoserverFetch): these tests never reach the real one. The job is only queued here; the
 * worker's import itself is covered by the workspace suites.
 */

const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 's1-copy-'));
process.env.WORKSPACE_FILES_DIR = STORE;
const previousGeoserver = process.env.GEOSERVER_URL;
process.env.GEOSERVER_URL = 'http://gs.test:8080/geoserver';

const app = buildApp();
const PW = 's1-copy-pass-123';
const email = (who: string) => `s1-cp-${who}@webatlas.test`;
const OWNER = email('owner');
const OTHER = email('other');
const SUB_OTHER = `s1-cp-sub-${randomUUID()}`;
const SUB_OWNER = `s1-cp-sub-${randomUUID()}`;
const ids = new Map<string, string>();

const PK = {
  vector: 900201, raster: 900202, series: 900203, draft: 900204, map: 900205,
  noDownload: 900206, mineNoDownload: 900207, noView: 900208,
};
const FIXTURE_PKS = Object.values(PK);
const resourceIds = new Map<number, string>();
const LAYER = (pk: number) => `geonode:s1_cp_${pk}`;

const GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { ten: 'Trạm A' }, geometry: { type: 'Point', coordinates: [105.8, 21.0] } }],
});
const TIFF = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 2, 3]);

let calls: URL[] = [];
let signals: (AbortSignal | undefined)[] = [];
let respond: (url: URL) => Response = defaultRespond;
function defaultRespond(url: URL): Response {
  if (url.searchParams.get('service') === 'WCS') return new Response(TIFF, { status: 200, headers: { 'content-type': 'image/tiff' } });
  return new Response(GEOJSON, { status: 200, headers: { 'content-type': 'application/json;charset=UTF-8' } });
}
const fakeFetch: GeoserverFetch = async (url, init) => {
  expect(init.headers.Authorization).toMatch(/^Basic /);
  const u = new URL(url);
  calls.push(u);
  signals.push(init.signal);
  return respond(u);
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
  kind: string; title: string; published: boolean; sub: string | null; view?: boolean; download?: boolean;
}) {
  // GeoNode's anonymous view/download default to granted here; the permission tests turn them off.
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
                                      is_published, is_approved, public_view, public_download, bbox4326, origin)
     VALUES ($1, $2, $3, $4, $5, '', $6, 'VN', $7, $7, $8, $9, ARRAY[102,8,110,24]::float8[], 'pipeline')
     RETURNING id`,
    [pk, randomUUID(), LAYER(pk), o.kind, o.title, o.sub, o.published, o.view ?? true, o.download ?? true]
  );
  resourceIds.set(pk, rows[0].id);
}

async function createMap(who: string, title: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/workspace/maps', headers: await auth(who), payload: { title } });
  expect(res.statusCode).toBe(201);
  return res.json().map.id as string;
}

const copy = async (pk: number, mapId: string, who: string | null = OWNER) => app.inject({
  method: 'POST',
  url: `/api/catalogue/${resourceIds.get(pk)}/copy`,
  headers: who ? await auth(who) : {},
  payload: { mapId },
});

async function uploadsOf(who: string) {
  const { rows } = await getPool().query<{ id: string; path: string; original_name: string; purpose: string; size_bytes: string }>(
    `SELECT id, path, original_name, purpose, size_bytes FROM workspace.files
      WHERE owner_id = $1 AND kind = 'upload' ORDER BY created_at`,
    [ids.get(who)]
  );
  return rows;
}

async function cleanup() {
  for (const who of [OWNER, OTHER]) {
    if (!ids.has(who)) continue;
    for (const f of await uploadsOf(who)) await unlinkInStore(f.path).catch(() => undefined);
  }
  await getPool().query(
    `DELETE FROM workspace.jobs WHERE owner_id IN (SELECT id FROM app.users WHERE email LIKE 's1-cp-%@webatlas.test')`
  );
  await getPool().query(`DELETE FROM catalogue.resources WHERE geonode_pk = ANY($1::int[])`, [FIXTURE_PKS]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 's1-cp-%@webatlas.test'`);
}

let ownerMap = '';
let otherMap = '';

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const who of [OWNER, OTHER]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OTHER), SUB_OTHER]);
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OWNER), SUB_OWNER]);
  await insertResource(PK.vector, { kind: 'vector', title: 'Trạm đo mưa / 2026', published: true, sub: SUB_OTHER });
  await insertResource(PK.raster, { kind: 'raster', title: 'Độ cao', published: true, sub: null });
  await insertResource(PK.series, { kind: 'timeseries', title: 'Mưa giờ', published: true, sub: null });
  await insertResource(PK.draft, { kind: 'vector', title: 'Bản nháp', published: false, sub: SUB_OTHER });
  await insertResource(PK.map, { kind: 'map', title: 'Bản đồ GeoNode', published: true, sub: null });
  await insertResource(PK.noDownload, { kind: 'vector', title: 'Chỉ xem', published: true, sub: SUB_OTHER, download: false });
  await insertResource(PK.mineNoDownload, { kind: 'raster', title: 'Của tôi', published: true, sub: SUB_OWNER, view: false, download: false });
  await insertResource(PK.noView, { kind: 'vector', title: 'Riêng nhóm', published: true, sub: SUB_OTHER, view: false, download: true });
  ownerMap = await createMap(OWNER, 'Bản của tôi');
  otherMap = await createMap(OTHER, 'Bản người khác');
  setGeoserverFetch(fakeFetch);
});

afterAll(async () => {
  setGeoserverFetch(null);
  await cleanup();
  if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
  else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
  if (previousGeoserver === undefined) delete process.env.GEOSERVER_URL;
  else process.env.GEOSERVER_URL = previousGeoserver;
  await app.close();
});

beforeEach(() => {
  calls = [];
  signals = [];
  respond = defaultRespond;
});

describe('POST /api/catalogue/:id/copy', () => {
  it('copies a vector entry: reads it over WFS as GeoJSON, stores it as the caller\'s upload, queues an import', async () => {
    const before = (await uploadsOf(OWNER)).length;
    const res = await copy(PK.vector, ownerMap);
    expect(res.statusCode).toBe(202);
    const { job } = res.json();
    expect(job).toMatchObject({ kind: 'import', status: 'queued', mapId: ownerMap });
    expect(job.steps).toEqual(IMPORT_STEPS);

    expect(calls).toHaveLength(1);
    const q = calls[0].searchParams;
    expect(calls[0].origin + calls[0].pathname).toBe('http://gs.test:8080/geoserver/geonode/ows');
    expect(q.get('service')).toBe('WFS');
    expect(q.get('request')).toBe('GetFeature');
    expect(q.get('typeName')).toBe(LAYER(PK.vector));
    expect(q.get('outputFormat')).toBe('application/json');
    // One more than the import takes, so a layer over the limit fails the import rather than being cut short.
    expect(q.get('maxFeatures')).toBe(String(IMPORT_MAX_ROWS + 1));

    const uploads = await uploadsOf(OWNER);
    expect(uploads).toHaveLength(before + 1);
    const upload = uploads[uploads.length - 1];
    expect(upload.purpose).toBe('map');
    expect(upload.original_name).toBe('Trạm đo mưa _ 2026.geojson');
    expect(readFileSync(resolveInStore(upload.path), 'utf8')).toBe(GEOJSON);

    const { rows } = await getPool().query(`SELECT owner_id, kind, params FROM workspace.jobs WHERE id = $1`, [job.id]);
    expect(rows[0]).toMatchObject({ owner_id: ids.get(OWNER), kind: 'import' });
    expect(rows[0].params).toMatchObject({ fileId: upload.id, path: upload.path, mapId: ownerMap, maxRows: IMPORT_MAX_ROWS });
    // M12: the layer takes the entry's title verbatim, not the sanitised file name.
    expect(rows[0].params.title).toBe('Trạm đo mưa / 2026');
    // M8: the GeoServer read cannot hang the request for ever.
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('copies a raster entry over WCS as a GeoTIFF', async () => {
    const res = await copy(PK.raster, ownerMap);
    expect(res.statusCode).toBe(202);
    const q = calls[0].searchParams;
    expect(q.get('service')).toBe('WCS');
    expect(q.get('request')).toBe('GetCoverage');
    expect(q.get('coverageId')).toBe(`geonode__s1_cp_${PK.raster}`);
    expect(q.get('format')).toBe('image/tiff');
    const uploads = await uploadsOf(OWNER);
    const upload = uploads[uploads.length - 1];
    expect(upload.original_name).toBe('Độ cao.tif');
    expect(readFileSync(resolveInStore(upload.path)).equals(TIFF)).toBe(true);
  });

  it('counts the copy toward the caller\'s quota', async () => {
    await getPool().query(`UPDATE app.users SET quota_bytes = workspace.usage_bytes(id) + 10 WHERE id = $1`, [ids.get(OWNER)]);
    try {
      const before = (await uploadsOf(OWNER)).length;
      const res = await copy(PK.vector, ownerMap);
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
      expect(await uploadsOf(OWNER)).toHaveLength(before);
    } finally {
      await getPool().query(`UPDATE app.users SET quota_bytes = DEFAULT WHERE id = $1`, [ids.get(OWNER)]);
    }
  });

  it('refuses a time series (link only) with 400 and never calls GeoServer', async () => {
    const res = await copy(PK.series, ownerMap);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(LINK_ONLY);
    expect(LINK_ONLY).toBe('Mục này chỉ thêm được dạng liên kết.');
    expect((await copy(PK.map, ownerMap)).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('answers the workspace 404 for a map the caller does not own, before reading anything', async () => {
    const before = (await uploadsOf(OWNER)).length;
    const res = await copy(PK.vector, otherMap);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe(MAP_NOT_FOUND);
    expect(calls).toHaveLength(0);
    expect(await uploadsOf(OWNER)).toHaveLength(before);
    expect((await copy(PK.vector, randomUUID())).statusCode).toBe(404);
  });

  it('refuses with 403 an entry GeoNode does not let anonymous users download, before reading anything', async () => {
    const before = (await uploadsOf(OWNER)).length;
    const res = await copy(PK.noDownload, ownerMap);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe(NO_DOWNLOAD);
    expect(calls).toHaveLength(0);
    expect(await uploadsOf(OWNER)).toHaveLength(before);
  });

  it('lets the owner copy an entry without anonymous view or download', async () => {
    const res = await copy(PK.mineNoDownload, ownerMap);
    expect(res.statusCode).toBe(202);
    expect(calls).toHaveLength(1);
  });

  it('answers 404 for a published entry GeoNode does not let anonymous users view', async () => {
    const res = await copy(PK.noView, ownerMap);
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('answers 404 for an entry the caller cannot see', async () => {
    const res = await copy(PK.draft, ownerMap);
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('needs a signed-in caller', async () => {
    const res = await copy(PK.vector, ownerMap, null);
    expect(res.statusCode).toBe(401);
  });

  it('refuses a body without a map id', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/catalogue/${resourceIds.get(PK.vector)}/copy`, headers: await auth(OWNER), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('turns a GeoServer failure into 502 and keeps no upload', async () => {
    const before = (await uploadsOf(OWNER)).length;
    respond = () => new Response('<ows:ExceptionReport>boom</ows:ExceptionReport>', { status: 500, headers: { 'content-type': 'application/xml' } });
    const failed = await copy(PK.vector, ownerMap);
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.message).toBe(COPY_FAILED);
    expect(failed.body).not.toContain('ExceptionReport');

    // A 200 that is an exception report rather than GeoJSON is refused the same way.
    respond = () => new Response('<ows:ExceptionReport/>', { status: 200, headers: { 'content-type': 'application/xml' } });
    expect((await copy(PK.vector, ownerMap)).statusCode).toBe(502);
    expect(await uploadsOf(OWNER)).toHaveLength(before);
  });

  it('turns a body that fails mid-read (timeout, dropped connection) into 502 and keeps no upload', async () => {
    const before = (await uploadsOf(OWNER)).length;
    respond = () => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('{"type":"FeatureCollection","features":[')); return; }
          controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const failed = await copy(PK.vector, ownerMap);
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.message).toBe(COPY_FAILED);
    expect(await uploadsOf(OWNER)).toHaveLength(before);
  });
});
