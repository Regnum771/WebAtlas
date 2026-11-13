import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import type { CurrentUser } from '../../types/fastify';
import { unlinkInStore } from '../workspace/fileStore';
import { uploadsService } from '../workspace/uploads';
import { deleteExpiredFiles } from '../workspace/cleanup';
import { catalogueUploadsService } from './uploads';
import { canDownload, canView } from './access';

const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 's1-catalogue-'));
process.env.WORKSPACE_FILES_DIR = STORE;

const app = buildApp();
const PW = 's1-catalogue-pass-123';
const email = (who: string) => `s1-cat-${who}@webatlas.test`;
const OWNER = email('owner');
const OTHER = email('other');
const NOSSO = email('nosso');
const PEND = email('pend');
const SUB_OWNER = `s1-cat-sub-${randomUUID()}`;
const SUB_OTHER = `s1-cat-sub-${randomUUID()}`;
const ids = new Map<string, string>();

// Fixture pks are far above anything GeoNode hands out.
const PK = { pub: 900001, mine: 900002, theirs: 900003, raster: 900004, restricted: 900005, minePublished: 900006 };
const FIXTURE_PKS = Object.values(PK);
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu trong Danh mục.' } };

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

function multipart(filename: string, body: Buffer) {
  const boundary = `----s1${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, body, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const userFor = (who: string): CurrentUser => ({ id: ids.get(who)!, email: who, role: 'viewer', isAdmin: false, grants: [] });
const part = (filename: string, size: number) => ({ filename, mimetype: 'application/octet-stream', file: Readable.from([Buffer.alloc(size, 1)]) });

async function insertResource(pk: number, o: {
  title: string; published: boolean; sub: string | null; kind?: string; abstract?: string; view?: boolean;
}) {
  // GeoNode's anonymous view defaults to granted here (public_view); `view: false` withdraws it.
  await getPool().query(
    `INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
                                      is_published, is_approved, public_view, variable, unit, time_steps, bbox4326, origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'VN', $8, $8, $9, 'mưa', 'mm',
             ARRAY['2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z']::timestamptz[], ARRAY[102,8,110,24]::float8[], 'pipeline')`,
    [pk, randomUUID(), `geonode:s1_cat_${pk}`, o.kind ?? 'timeseries', o.title, o.abstract ?? '', o.sub, o.published, o.view ?? true]
  );
}

const createdPaths: string[] = [];
async function track(fileId: string) {
  const { rows } = await getPool().query<{ path: string }>(`SELECT path FROM workspace.files WHERE id = $1`, [fileId]);
  if (rows[0]) createdPaths.push(rows[0].path);
}

async function cleanup() {
  await getPool().query(`DELETE FROM catalogue.resources WHERE geonode_pk = ANY($1::int[])`, [FIXTURE_PKS]);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 's1-cat-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const who of [OWNER, OTHER, NOSSO, PEND]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role: 'viewer' });
    ids.set(who, row.id);
  }
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OWNER), SUB_OWNER]);
  await getPool().query(`UPDATE app.users SET oidc_subject = $2 WHERE id = $1`, [ids.get(OTHER), SUB_OTHER]);
  await insertResource(PK.pub, { title: 'Lũ tháng 10', published: true, sub: SUB_OTHER });
  await insertResource(PK.mine, { title: 'Bản nháp của tôi', published: false, sub: SUB_OWNER });
  await insertResource(PK.theirs, { title: 'Bản nháp người khác', published: false, sub: SUB_OTHER });
  await insertResource(PK.raster, { title: 'Độ cao', published: true, sub: null, kind: 'raster', abstract: 'Mô hình số' });
  await insertResource(PK.restricted, { title: 'Chia sẻ riêng nhóm', published: true, sub: SUB_OTHER, view: false });
  await insertResource(PK.minePublished, { title: 'Của tôi, riêng nhóm', published: true, sub: SUB_OWNER, view: false });
});

afterAll(async () => {
  for (const p of createdPaths) await unlinkInStore(p).catch(() => undefined);
  await cleanup();
  if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
  else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
  await app.close();
});

interface Item { title: string; mine: boolean; isPublished: boolean; layerName: string }
const fixtureItems = (items: Item[]) => items.filter((i) => i.layerName.startsWith('geonode:s1_cat_'));

describe('GET /api/catalogue/search', () => {
  it('shows an anonymous caller published entries only', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/catalogue/search' });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ page: 1, pageSize: 20 });
    expect(typeof all.json().total).toBe('number');
    const items = fixtureItems(all.json().items);
    const got = items.map((i: { title: string }) => i.title);
    expect(got).toContain('Lũ tháng 10');
    expect(got).not.toContain('Bản nháp của tôi');
    expect(got).not.toContain('Bản nháp người khác');
    expect(items.every((i: { mine: boolean }) => i.mine === false)).toBe(true);
  });

  it('counts only published rows in an anonymous total', async () => {
    const { rows } = await getPool().query(`SELECT count(*)::int AS n FROM catalogue.resources WHERE is_published AND public_view`);
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search' });
    expect(res.json().total).toBe(rows[0].n);
  });

  it('shows the owner their own unpublished entry with mine: true, and not another user\'s', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search?kind=timeseries', headers: await auth(OWNER) });
    const items = fixtureItems(res.json().items) as Array<{ title: string; mine: boolean; isPublished: boolean }>;
    const draft = items.find((i) => i.title === 'Bản nháp của tôi');
    expect(draft).toMatchObject({ mine: true, isPublished: false });
    expect(items.find((i) => i.title === 'Bản nháp người khác')).toBeUndefined();
    expect(items.find((i) => i.title === 'Lũ tháng 10')?.mine).toBe(false);
  });

  it('does not show the owner\'s unpublished entry to another user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search?kind=timeseries', headers: await auth(OTHER) });
    const titles = fixtureItems(res.json().items).map((i: { title: string }) => i.title);
    expect(titles).not.toContain('Bản nháp của tôi');
    expect(titles).toContain('Bản nháp người khác');
  });

  it('matches q ignoring case and diacritics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search?q=lu' });
    expect(res.json().items.map((i: { title: string }) => i.title)).toContain('Lũ tháng 10');
    const upper = await app.inject({ method: 'GET', url: '/api/catalogue/search?q=THANG' });
    expect(upper.json().items.map((i: { title: string }) => i.title)).toContain('Lũ tháng 10');
    const abs2 = await app.inject({ method: 'GET', url: '/api/catalogue/search?q=mo%20hinh%20so' });
    expect(abs2.json().items.map((i: { title: string }) => i.title)).toContain('Độ cao');
  });

  it('filters by kind and rejects an unknown kind', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search?kind=raster' });
    const items = res.json().items as Array<{ kind: string; title: string }>;
    expect(items.every((i) => i.kind === 'raster')).toBe(true);
    expect(items.map((i) => i.title)).toContain('Độ cao');
    const bad = await app.inject({ method: 'GET', url: '/api/catalogue/search?kind=nope' });
    expect(bad.statusCode).toBe(400);
  });

  it('answers 401 for a bad token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search', headers: { authorization: 'Bearer nonsense' } });
    expect(res.statusCode).toBe(401);
  });

  it('maps the fields of an item', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/search?q=lu' });
    const item = res.json().items.find((i: { title: string }) => i.title === 'Lũ tháng 10');
    expect(item).toMatchObject({
      kind: 'timeseries', managingUnit: 'VN', variable: 'mưa', unit: 'mm', layerName: `geonode:s1_cat_${PK.pub}`,
      timeSteps: ['2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z'], bbox4326: [102, 8, 110, 24],
    });
    expect(new Date(item.updatedAt).toISOString()).toBe(item.updatedAt);
  });
});

describe('GET /api/catalogue/recent', () => {
  // Far in the future, so the fixtures come first whatever else the catalogue holds.
  beforeAll(async () => {
    const at = (pk: number, day: number) => getPool().query(
      `UPDATE catalogue.resources SET updated_at = $2 WHERE geonode_pk = $1`, [pk, `2099-01-${String(day).padStart(2, '0')}T00:00:00Z`]);
    await at(PK.raster, 1);
    await at(PK.pub, 2);
    await at(PK.mine, 3);
    await at(PK.theirs, 4);
  });

  it('gives an anonymous caller the published public entries, changed last first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/recent?limit=20' });
    expect(res.statusCode).toBe(200);
    const titles = fixtureItems(res.json().items).map((i) => i.title);
    expect(titles).toEqual(['Lũ tháng 10', 'Độ cao']);
  });

  it('adds the caller\'s own unpublished entry, and never another user\'s', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/recent?limit=20', headers: await auth(OWNER) });
    const items = fixtureItems(res.json().items);
    expect(items.map((i) => i.title)).toEqual(['Bản nháp của tôi', 'Lũ tháng 10', 'Độ cao', 'Của tôi, riêng nhóm']);
    expect(items[0].mine).toBe(true);
    expect(items.map((i) => i.title)).not.toContain('Bản nháp người khác');
    expect((items[0] as Item & { updatedAt: string }).updatedAt).toBe('2099-01-03T00:00:00.000Z');
  });

  it('gives 6 entries by default and refuses more than 20', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/catalogue/recent', headers: await auth(OWNER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeLessThanOrEqual(6);
    expect((await app.inject({ method: 'GET', url: '/api/catalogue/recent?limit=21' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/catalogue/recent?limit=0' })).statusCode).toBe(400);
  });
});

describe('GET /api/catalogue/:id', () => {
  const idOf = async (pk: number) =>
    (await getPool().query<{ id: string }>(`SELECT id FROM catalogue.resources WHERE geonode_pk = $1`, [pk])).rows[0].id;

  it('returns a published entry to anyone', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/catalogue/${await idOf(PK.pub)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Lũ tháng 10', mine: false });
  });

  it('hides a published entry without GeoNode\'s anonymous view from everyone but its owner', async () => {
    const id = await idOf(PK.restricted);
    expect((await app.inject({ method: 'GET', url: `/api/catalogue/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/catalogue/${id}`, headers: await auth(OWNER) })).statusCode).toBe(404);
    const theirs = await app.inject({ method: 'GET', url: `/api/catalogue/${id}`, headers: await auth(OTHER) });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json()).toMatchObject({ mine: true, isPublished: true, isPublic: false });

    const anon = fixtureItems((await app.inject({ method: 'GET', url: '/api/catalogue/search' })).json().items);
    expect(anon.map((i) => i.title)).not.toContain('Chia sẻ riêng nhóm');
    const own = fixtureItems((await app.inject({ method: 'GET', url: '/api/catalogue/search', headers: await auth(OWNER) })).json().items);
    expect(own.map((i) => i.title)).toContain('Của tôi, riêng nhóm');
    expect(own.map((i) => i.title)).not.toContain('Chia sẻ riêng nhóm');
  });

  it('returns an unpublished entry to its owner only', async () => {
    const id = await idOf(PK.mine);
    const own = await app.inject({ method: 'GET', url: `/api/catalogue/${id}`, headers: await auth(OWNER) });
    expect(own.statusCode).toBe(200);
    expect(own.json().mine).toBe(true);
    const other = await app.inject({ method: 'GET', url: `/api/catalogue/${id}`, headers: await auth(OTHER) });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual(NOT_FOUND);
    const anon = await app.inject({ method: 'GET', url: `/api/catalogue/${id}` });
    expect(anon.statusCode).toBe(404);
  });

  it('is 404 for a missing id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/catalogue/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });
});

describe('access.canView', () => {
  it('follows the visibility rule', () => {
    const owner = { ...userFor(OWNER), oidcSubject: 'sub-a' };
    expect(canView(undefined, { is_published: true, public_view: true, owner_sub: 'sub-a' })).toBe(true);
    expect(canView(undefined, { is_published: false, public_view: true, owner_sub: 'sub-a' })).toBe(false);
    expect(canView(owner, { is_published: false, public_view: true, owner_sub: 'sub-a' })).toBe(true);
    expect(canView(owner, { is_published: false, public_view: true, owner_sub: 'sub-b' })).toBe(false);
    expect(canView(owner, { is_published: false, public_view: true, owner_sub: null })).toBe(false);
    expect(canView(userFor(OWNER), { is_published: false, public_view: true, owner_sub: null })).toBe(false);
    // GeoNode's anonymous view counts: published without it is the owner's alone.
    expect(canView(undefined, { is_published: true, public_view: false, owner_sub: 'sub-a' })).toBe(false);
    expect(canView(owner, { is_published: true, public_view: false, owner_sub: 'sub-a' })).toBe(true);
  });

  it('allows a copy with GeoNode\'s anonymous download, or to the owner', () => {
    const owner = { ...userFor(OWNER), oidcSubject: 'sub-a' };
    const row = (o: Partial<{ is_published: boolean; public_view: boolean; public_download: boolean; owner_sub: string | null }>) => ({
      is_published: true, public_view: true, public_download: true, owner_sub: 'sub-b', ...o,
    });
    expect(canDownload(owner, row({}))).toBe(true);
    expect(canDownload(owner, row({ public_download: false }))).toBe(false);
    expect(canDownload(owner, row({ public_view: false }))).toBe(false);
    expect(canDownload(owner, row({ is_published: false }))).toBe(false);
    expect(canDownload(owner, row({ owner_sub: 'sub-a', is_published: false, public_view: false, public_download: false }))).toBe(true);
  });
});

describe('time-series uploads', () => {
  it('accepts a 1.5 KiB .hdf with the time-series cap at 2 KiB and the workspace cap at 1 KiB, which refuses it', async () => {
    const user = userFor(OWNER);
    const { upload } = await catalogueUploadsService(getPool(), { maxBytes: 2048 }).upload(user, part('run.hdf', 1536));
    await track(upload.id);
    expect(upload.sizeBytes).toBe(1536);
    await expect(uploadsService(getPool(), { maxBytes: 1024 }).upload(user, part('run.hdf', 1536))).rejects.toMatchObject({ statusCode: 400 });
    await expect(uploadsService(getPool(), { maxBytes: 1024 }).upload(user, part('run.tif', 1536))).rejects.toMatchObject({ statusCode: 413 });
  });

  it('refuses a time-series file over its cap', async () => {
    await expect(catalogueUploadsService(getPool(), { maxBytes: 1024 }).upload(userFor(OWNER), part('big.nc', 1536)))
      .rejects.toMatchObject({ statusCode: 413 });
  });

  it('accepts a small .csv and refuses one over its own cap while the file cap is larger', async () => {
    const svc = catalogueUploadsService(getPool(), { maxBytes: 4096, csvMaxBytes: 1024 });
    const { upload } = await svc.upload(userFor(OWNER), part('times.csv', 512));
    await track(upload.id);
    expect(upload.sizeBytes).toBe(512);
    await expect(svc.upload(userFor(OWNER), part('times.csv', 1536)))
      .rejects.toMatchObject({ statusCode: 413, message: 'Tệp CSV lớn hơn 1 MB.' });
    // The same size is fine for a series file.
    const big = await svc.upload(userFor(OWNER), part('serie.nc', 1536));
    await track(big.upload.id);
    expect(big.upload.sizeBytes).toBe(1536);
  });

  it('refuses .exe with 400 over HTTP', async () => {
    const { payload, headers } = multipart('x.exe', Buffer.from('MZ'));
    const res = await app.inject({ method: 'POST', url: '/api/catalogue/uploads', payload, headers: { ...headers, ...(await auth(OWNER)) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Định dạng chưa hỗ trợ cho chuỗi thời gian.');
  });

  it('requires sign-in to upload', async () => {
    const { payload, headers } = multipart('x.tif', Buffer.from('II'));
    const res = await app.inject({ method: 'POST', url: '/api/catalogue/uploads', payload, headers });
    expect(res.statusCode).toBe(401);
  });

  it('stores the upload with purpose timeseries, leaves usage_bytes alone and hides it from the workspace list', async () => {
    const usage = async () =>
      Number((await getPool().query(`SELECT workspace.usage_bytes($1) AS u`, [ids.get(OWNER)])).rows[0].u);
    const before = await usage();
    const { payload, headers } = multipart('serie.tif', Buffer.alloc(4096, 7));
    const res = await app.inject({ method: 'POST', url: '/api/catalogue/uploads', payload, headers: { ...headers, ...(await auth(OWNER)) } });
    expect(res.statusCode).toBe(201);
    const { upload } = res.json();
    expect(Object.keys(upload).sort()).toEqual(['id', 'originalName', 'sizeBytes']);
    expect(upload.sizeBytes).toBe(4096);
    await track(upload.id);
    const { rows } = await getPool().query(`SELECT purpose, kind FROM workspace.files WHERE id = $1`, [upload.id]);
    expect(rows[0]).toEqual({ purpose: 'timeseries', kind: 'upload' });
    expect(await usage()).toBe(before);

    const list = await app.inject({ method: 'GET', url: '/api/workspace/uploads', headers: await auth(OWNER) });
    expect(list.statusCode).toBe(200);
    expect(list.json().uploads.map((u: { id: string }) => u.id)).not.toContain(upload.id);
  });
});

describe('POST /api/catalogue/timeseries', () => {
  async function uploadFor(who: string, name: string) {
    const { upload } = await catalogueUploadsService(getPool()).upload(userFor(who), part(name, 64));
    await track(upload.id);
    return upload.id;
  }
  const post = async (who: string | null, body: unknown) =>
    app.inject({ method: 'POST', url: '/api/catalogue/timeseries', payload: body as object, headers: who ? await auth(who) : {} });

  it('queues a timeseries_import job carrying the owner subject', async () => {
    const fileId = await uploadFor(OWNER, 'mua.nc');
    const res = await post(OWNER, { fileId, title: 'Mưa giờ', timePattern: 'YYYYMMDD' });
    expect(res.statusCode).toBe(202);
    const { job } = res.json();
    expect(job).toMatchObject({ kind: 'timeseries_import', status: 'queued', mapId: null });
    expect(job.steps.map((s: { key: string; label: string }) => [s.key, s.label])).toEqual([
      ['read', 'Đọc tệp'], ['transform', 'Tạo các bước thời gian'], ['publish', 'Đưa lên Danh mục'],
    ]);
    expect(job).not.toHaveProperty('params');
    const { rows } = await getPool().query(`SELECT params FROM workspace.jobs WHERE id = $1`, [job.id]);
    expect(rows[0].params).toMatchObject({
      fileId, originalName: 'mua.nc', ownerId: ids.get(OWNER), title: 'Mưa giờ', abstract: '', source: 'netcdf',
      timePattern: 'YYYYMMDD', timesCsvPath: null, hdfArea: null, every: 4,
      owner: { sub: SUB_OWNER, email: OWNER },
      clip4326: null, hdfTimeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(rows[0].params.path).toMatch(/^uploads\/.+\/original\.nc$/);
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [job.id]);
  });

  it('resolves timesCsvFileId to the store path and takes every = 1', async () => {
    const fileId = await uploadFor(OWNER, 'run.hdf');
    const csvId = await uploadFor(OWNER, 'times.csv');
    const res = await post(OWNER, { fileId, title: 'HEC', timesCsvFileId: csvId, every: 1, hdfArea: 'Area 1' });
    expect(res.statusCode).toBe(202);
    const { rows } = await getPool().query(`SELECT params FROM workspace.jobs WHERE id = $1`, [res.json().job.id]);
    expect(rows[0].params).toMatchObject({ source: 'hecras', every: 1, hdfArea: 'Area 1' });
    expect(rows[0].params.timesCsvPath).toMatch(/^uploads\/.+\/original\.csv$/);
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [res.json().job.id]);
  });

  it('refuses a .csv as the series file', async () => {
    const fileId = await uploadFor(OWNER, 'times.csv');
    const res = await post(OWNER, { fileId, title: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Tệp CSV chỉ dùng làm bảng thời gian, không phải chuỗi dữ liệu.');
  });

  it('refuses a timesCsvFileId that is not a .csv, not a time-series upload, or not the caller\'s', async () => {
    const fileId = await uploadFor(OWNER, 'a.tif');
    const notCsv = await uploadFor(OWNER, 'b.tif');
    const res = await post(OWNER, { fileId, title: 'x', timesCsvFileId: notCsv });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('Bảng thời gian phải là tệp CSV đã tải lên cho chuỗi thời gian.');
    const theirs = await uploadFor(OTHER, 'times.csv');
    expect((await post(OWNER, { fileId, title: 'x', timesCsvFileId: theirs })).statusCode).toBe(404);
    // A personal-map upload is not purpose 'timeseries' (the workspace takes no .csv, so name it .tif).
    const { upload } = await uploadsService(getPool()).upload(userFor(OWNER), part('plain.tif', 16));
    await track(upload.id);
    expect((await post(OWNER, { fileId, title: 'x', timesCsvFileId: upload.id })).statusCode).toBe(404);
  });

  it('carries a NetCDF clip extent and a HEC-RAS time zone into the job', async () => {
    const fileId = await uploadFor(OWNER, 'mswep.nc');
    const res = await post(OWNER, { fileId, title: 'Mưa', clip4326: [107.2, 14.8, 108.9, 16.2] });
    expect(res.statusCode).toBe(202);
    const { rows } = await getPool().query(`SELECT params FROM workspace.jobs WHERE id = $1`, [res.json().job.id]);
    expect(rows[0].params.clip4326).toEqual([107.2, 14.8, 108.9, 16.2]);
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [res.json().job.id]);

    const hdf = await uploadFor(OWNER, 'run2.hdf');
    const utc = await post(OWNER, { fileId: hdf, title: 'HEC', hdfTimeZone: 'UTC' });
    expect(utc.statusCode).toBe(202);
    const { rows: r2 } = await getPool().query(`SELECT params FROM workspace.jobs WHERE id = $1`, [utc.json().job.id]);
    expect(r2[0].params.hdfTimeZone).toBe('UTC');
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [utc.json().job.id]);
  });

  it('refuses a clip extent off the globe, inverted, not finite or not four numbers, and an unknown time zone', async () => {
    const fileId = await uploadFor(OWNER, 'bad.nc');
    for (const clip of [[-181, 0, 10, 10], [0, -91, 10, 10], [10, 0, 5, 10], [0, 10, 10, 5], [0, 0, 10], [0, 0, 'a', 10], [0, 0, 0, 10]]) {
      expect((await post(OWNER, { fileId, title: 'x', clip4326: clip })).statusCode, JSON.stringify(clip)).toBe(400);
    }
    expect((await post(OWNER, { fileId, title: 'x', hdfTimeZone: 'Europe/Paris' })).statusCode).toBe(400);
  });

  it('refuses every other than 1 or 4', async () => {
    const fileId = await uploadFor(OWNER, 'a.hdf');
    expect((await post(OWNER, { fileId, title: 'x', every: 2 })).statusCode).toBe(400);
  });

  it('is 409 for a user with no oidc_subject', async () => {
    const fileId = await uploadFor(NOSSO, 'a.tif');
    const res = await post(NOSSO, { fileId, title: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe('Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.');
  });

  it('is 404 for another user\'s file and for a personal-map upload', async () => {
    const fileId = await uploadFor(OWNER, 'a.tif');
    expect((await post(OTHER, { fileId, title: 'x' })).statusCode).toBe(404);
    const { upload } = await uploadsService(getPool()).upload(userFor(OWNER), part('plain.tif', 32));
    await track(upload.id);
    expect((await post(OWNER, { fileId: upload.id, title: 'x' })).statusCode).toBe(404);
  });

  it('requires sign-in', async () => {
    expect((await post(null, { fileId: randomUUID(), title: 'x' })).statusCode).toBe(401);
  });

  it('refuses an unknown time pattern', async () => {
    const fileId = await uploadFor(OWNER, 'p.tif');
    expect((await post(OWNER, { fileId, title: 'x', timePattern: '%Y%m%d' })).statusCode).toBe(400);
  });
});

describe('bounded time-series uploads', () => {
  const rowOf = async (id: string) =>
    (await getPool().query(`SELECT delete_after, purpose FROM workspace.files WHERE id = $1`, [id])).rows[0];
  async function fresh(who: string, name: string, size = 64) {
    const { upload } = await catalogueUploadsService(getPool()).upload(userFor(who), part(name, size));
    await track(upload.id);
    return upload.id;
  }
  const queue = async (payload: object) =>
    app.inject({ method: 'POST', url: '/api/catalogue/timeseries', payload, headers: await auth(OWNER) });
  const removeUpload = async (id: string) =>
    app.inject({ method: 'DELETE', url: `/api/workspace/uploads/${id}`, headers: await auth(OWNER) });

  it('refuses an upload from a user with no oidc_subject, before reading the body', async () => {
    const count = async () =>
      (await getPool().query(`SELECT count(*)::int AS n FROM workspace.files WHERE owner_id = $1`, [ids.get(NOSSO)])).rows[0].n;
    const before = await count();
    const { payload, headers } = multipart('x.tif', Buffer.alloc(2048, 1));
    const res = await app.inject({ method: 'POST', url: '/api/catalogue/uploads', payload, headers: { ...headers, ...(await auth(NOSSO)) } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe('Cần đăng nhập một lần (SSO) để đưa dữ liệu lên Danh mục.');
    expect(await count()).toBe(before);
  });

  it('gives a time-series upload a delete_after about 3 days ahead', async () => {
    const { delete_after, purpose } = await rowOf(await fresh(OWNER, 'd.tif'));
    expect(purpose).toBe('timeseries');
    const days = (new Date(delete_after).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  });

  it('caps what a user holds in uploads not yet imported', async () => {
    const svc = catalogueUploadsService(getPool(), { pendingCapBytes: 2048 });
    const user = userFor(PEND);
    const first = await svc.upload(user, part('a.tif', 1024));
    await track(first.upload.id);
    // Room left is 1024: a larger file is stopped at it and reports the cap.
    await expect(svc.upload(user, part('b.tif', 1500))).rejects.toMatchObject({
      statusCode: 413, message: expect.stringContaining('4 GB'),
    });
    // The user cannot see failed attempts' uploads: the message says they go away by themselves.
    await expect(svc.upload(user, part('b2.tif', 1500))).rejects.toMatchObject({
      message: expect.stringContaining('tự xoá trong vòng một ngày'),
    });
    const second = await svc.upload(user, part('c.tif', 1024));
    await track(second.upload.id);
    await expect(svc.upload(user, part('d.tif', 1))).rejects.toMatchObject({ statusCode: 413 });
    // An imported file (date cleared) no longer counts.
    await getPool().query(`UPDATE workspace.files SET delete_after = NULL WHERE id = $1`, [first.upload.id]);
    const third = await svc.upload(user, part('e.tif', 1024));
    await track(third.upload.id);
    expect(third.upload.sizeBytes).toBe(1024);
  });

  it('keeps files a queued timeseries_import reads past their date, and removes them once it is done', async () => {
    const fileId = await fresh(OWNER, 's.tif');
    const csvId = await fresh(OWNER, 't.csv');
    const res = await queue({ fileId, title: 'x', timesCsvFileId: csvId });
    expect(res.statusCode).toBe(202);
    const jobId = res.json().job.id;
    const both = [fileId, csvId];
    await getPool().query(`UPDATE workspace.files SET delete_after = now() - interval '1 day' WHERE id = ANY($1::uuid[])`, [both]);
    const scope = { ownerIds: [ids.get(OWNER)!] };
    await deleteExpiredFiles(getPool(), new Date(), scope);
    const left = await getPool().query(`SELECT id FROM workspace.files WHERE id = ANY($1::uuid[])`, [both]);
    expect(left.rows.length).toBe(2);
    await getPool().query(`UPDATE workspace.jobs SET status = 'failed' WHERE id = $1`, [jobId]);
    await deleteExpiredFiles(getPool(), new Date(), scope);
    const gone = await getPool().query(`SELECT id FROM workspace.files WHERE id = ANY($1::uuid[])`, [both]);
    expect(gone.rows.length).toBe(0);
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [jobId]);
  });

  it('refuses to remove an upload a queued timeseries_import reads (series and times table)', async () => {
    const fileId = await fresh(OWNER, 'u.tif');
    const csvId = await fresh(OWNER, 'u.csv');
    const res = await queue({ fileId, title: 'x', timesCsvFileId: csvId });
    expect(res.statusCode).toBe(202);
    for (const id of [fileId, csvId]) {
      const refused = await removeUpload(id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.message).toBe('Tệp đang được dùng cho một công việc chuỗi thời gian, chưa xoá được.');
    }
    await getPool().query(`DELETE FROM workspace.jobs WHERE id = $1`, [res.json().job.id]);
    expect((await removeUpload(fileId)).statusCode).toBe(204);
  });
});
