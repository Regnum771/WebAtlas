import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import type { CurrentUser } from '../../types/fastify';
import { resolveInStore, storeRoot, unlinkInStore, writeStream } from './fileStore';
import { uploadsService } from './uploads';

// A fresh store under the OS temp directory for this file; the previous value is restored after.
const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 'p3b-uploads-'));
process.env.WORKSPACE_FILES_DIR = STORE;

const app = buildApp();
const PW = 'p3b-uploads-pass-123';
const email = (who: string) => `p3b-uploads-${who}@webatlas.test`;
const O = email('owner');
const S = email('stranger');
const A = email('admin');
const ids = new Map<string, string>();

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy tệp.' } };
const UNSUPPORTED = { error: { code: 'VALIDATION_ERROR', message: 'Định dạng tệp không được hỗ trợ.' } };
const TOO_LARGE = 'Tệp lớn hơn 200 MB.';
const QUOTA_PREFIX = 'Vượt hạn mức dung lượng: đã dùng ';

// One login per user for the whole file: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function tokenFor(who: string) {
  const cached = tokens.get(who);
  if (cached) return cached;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: who, password: PW } });
  expect(res.statusCode).toBe(200);
  const token = res.json().token as string;
  tokens.set(who, token);
  return token;
}
const auth = async (who: string) => ({ authorization: `Bearer ${await tokenFor(who)}` });

/** A multipart body with one `file` part. */
function multipart(filename: string, body: Buffer, contentType = 'application/octet-stream') {
  const boundary = `----p3b${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(who: string, filename: string, body: Buffer) {
  const { payload, headers } = multipart(filename, body);
  return app.inject({ method: 'POST', url: '/api/workspace/uploads', payload, headers: { ...headers, ...(await auth(who)) } });
}

async function call(who: string, method: 'GET' | 'DELETE', url: string) {
  return app.inject({ method, url: `/api/workspace${url}`, headers: await auth(who) });
}

// Files this test created, as store-relative paths; each is unlinked on its own after the test.
let createdPaths: string[] = [];
async function trackUpload(fileId: string) {
  const { rows } = await getPool().query<{ path: string }>(`SELECT path FROM workspace.files WHERE id = $1`, [fileId]);
  if (rows[0]) createdPaths.push(rows[0].path);
  return rows[0]?.path;
}

/** Every regular file under the owner's upload directory (read only). */
function filesUnder(ownerId: string): string[] {
  const dir = path.join(STORE, 'uploads', ownerId);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => path.join(dir, p))
    .filter((p) => statSync(p).isFile());
}

async function fileRows(ownerId: string) {
  const { rows } = await getPool().query(`SELECT id FROM workspace.files WHERE owner_id = $1`, [ownerId]);
  return rows;
}

const userFor = (who: string): CurrentUser => ({
  id: ids.get(who)!, email: who, role: 'viewer', isAdmin: false, grants: [],
});

async function cleanupUsers() {
  // Files rows go with their owner (ON DELETE CASCADE); the files on disk are unlinked per test.
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3b-uploads-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanupUsers();
  const repo = usersRepository(getPool());
  for (const [who, role] of [[O, 'viewer'], [S, 'viewer'], [A, 'admin']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role });
    ids.set(who, row.id);
  }
});

afterEach(async () => {
  const paths = createdPaths;
  createdPaths = [];
  for (const p of paths) await unlinkInStore(p);
});

afterAll(async () => {
  await runStages([
    cleanupUsers,
    () => app.close(),
    async () => {
      if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
      else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
    },
  ]);
});

describe('uploads', () => {
  it('a gpkg upload is stored and listed', async () => {
    const body = Buffer.alloc(1500, 7);
    const res = await upload(O, 'Bản đồ hồ chứa.gpkg', body);
    expect(res.statusCode).toBe(201);
    const up = res.json().upload;
    const rel = await trackUpload(up.id);
    expect(up).toMatchObject({ originalName: 'Bản đồ hồ chứa.gpkg', sizeBytes: 1500 });
    expect(typeof up.createdAt).toBe('string');

    expect(rel).toBe(`uploads/${ids.get(O)}/${up.id}/original.gpkg`);
    const abs = path.join(STORE, rel!);
    expect(existsSync(abs)).toBe(true);
    expect(statSync(abs).size).toBe(1500);

    const list = await call(O, 'GET', '/uploads');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ uploads: [up], quotaBytes: 1073741824 });
    expect(list.json().usageBytes).toBeGreaterThanOrEqual(1500);

    const original = await call(O, 'GET', `/uploads/${up.id}`);
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload.equals(body)).toBe(true);
    expect(original.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Bản đồ hồ chứa.gpkg')}`
    );

    const removed = await call(O, 'DELETE', `/uploads/${up.id}`);
    expect(removed.statusCode).toBe(204);
    expect(existsSync(abs)).toBe(false);
    expect(await fileRows(ids.get(O)!)).toHaveLength(0);
  });

  it('an unsupported extension is refused', async () => {
    for (const name of ['setup.exe', 'bang.csv']) {
      const res = await upload(O, name, Buffer.from('a,b\n1,2\n'));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(UNSUPPORTED);
    }
    expect(await fileRows(ids.get(O)!)).toHaveLength(0);
    expect(filesUnder(ids.get(O)!)).toEqual([]);
  });

  it('a file over 200 MB is refused and leaves nothing behind', async () => {
    const service = uploadsService(getPool(), { maxBytes: 2048 });
    const err = await service
      .upload(userFor(O), { filename: 'lon.gpkg', mimetype: 'application/octet-stream', file: Readable.from([Buffer.alloc(3072, 1)]) })
      .then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE', message: TOO_LARGE });
    expect(await fileRows(ids.get(O)!)).toHaveLength(0);
    expect(filesUnder(ids.get(O)!)).toEqual([]);
  });

  it('an upload over the quota is refused and leaves nothing behind', async () => {
    await getPool().query(`UPDATE app.users SET quota_bytes = 1000 WHERE id = $1`, [ids.get(O)]);
    try {
      const res = await upload(O, 'vung.geojson', Buffer.alloc(2048, 32));
      expect(res.statusCode).toBe(413);
      const { error } = res.json();
      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.message.startsWith(QUOTA_PREFIX)).toBe(true);
      expect(error.message).toMatch(/^Vượt hạn mức dung lượng: đã dùng \d+,\d MB, hạn mức \d+,\d MB\.$/);
      expect(await fileRows(ids.get(O)!)).toHaveLength(0);
      expect(filesUnder(ids.get(O)!)).toEqual([]);

      // The recheck after the write: another file of the owner's (row only, standing in for a
      // concurrent upload) lands while this one streams; together they go over the quota.
      const otherId = randomUUID();
      async function* racing() {
        await getPool().query(
          `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
           VALUES ($1, $2, 'upload', $3, 'khac.gpkg', 'application/octet-stream', 900)`,
          [otherId, ids.get(O), `uploads/${ids.get(O)}/${otherId}/original.gpkg`]
        );
        yield Buffer.alloc(500, 2);
      }
      const err = await uploadsService(getPool())
        .upload(userFor(O), { filename: 'cung-luc.gpkg', mimetype: 'application/octet-stream', file: Readable.from(racing()) })
        .then(() => null, (e: unknown) => e);
      expect(err).toMatchObject({
        statusCode: 413, code: 'QUOTA_EXCEEDED', message: 'Vượt hạn mức dung lượng: đã dùng 0,0 MB, hạn mức 0,0 MB.',
      });
      expect((await fileRows(ids.get(O)!)).map((r) => r.id)).toEqual([otherId]);
      expect(filesUnder(ids.get(O)!)).toEqual([]);
      await getPool().query(`DELETE FROM workspace.files WHERE id = $1`, [otherId]);
    } finally {
      await getPool().query(`UPDATE app.users SET quota_bytes = DEFAULT WHERE id = $1`, [ids.get(O)]);
    }
  });

  it('an upload aborted mid-stream leaves nothing behind', async () => {
    /** The promise's outcome, or 'pending' if it has not settled within `ms`. */
    const outcome = (p: Promise<unknown>, ms = 3000) =>
      Promise.race([
        p.then(() => 'resolved', (e: unknown) => e),
        new Promise((r) => setTimeout(() => r('pending'), ms)),
      ]);
    /** A source that sends 1000 bytes and is then destroyed without an error, as multipart does on a client abort. */
    const aborting = () => {
      const source = new PassThrough();
      source.write(Buffer.alloc(1000, 3));
      setTimeout(() => source.destroy(), 50);
      return source;
    };

    // The store on its own: the write rejects and no partial file is left.
    const rel = `aborted/${randomUUID()}.gpkg`;
    createdPaths.push(rel); // unlinked after the test should the fix regress
    const stored = await outcome(writeStream(rel, aborting(), 10_000));
    expect(stored).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
    expect(existsSync(path.join(STORE, rel))).toBe(false);

    // Through the service: no row and no file either.
    const uploaded = await outcome(
      uploadsService(getPool()).upload(userFor(O), { filename: 'dut.gpkg', mimetype: 'application/octet-stream', file: aborting() })
    );
    expect(uploaded).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
    expect(await fileRows(ids.get(O)!)).toHaveLength(0);
    expect(filesUnder(ids.get(O)!)).toEqual([]);
  });

  it('a text field or a malformed body is refused with a 4xx and leaves nothing behind', async () => {
    const boundary = `----p3b${randomUUID().replace(/-/g, '')}`;
    const ct = `multipart/form-data; boundary=${boundary}`;
    const field = `--${boundary}\r\nContent-Disposition: form-data; name="ghi_chu"\r\n\r\n${'a'.repeat(4096)}\r\n`;
    const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="diem.kml"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n<kml/>`;
    const send = async (payload: string, contentType = ct) => app.inject({
      method: 'POST', url: '/api/workspace/uploads', payload,
      headers: { 'content-type': contentType, ...(await auth(O)) },
    });
    const MALFORMED = { error: { code: 'VALIDATION_ERROR', message: 'Yêu cầu tải lên không hợp lệ.' } };

    // A text field alone: over the route's limit of none (server.ts), refused before any buffering.
    const fieldOnly = await send(`${field}--${boundary}--\r\n`);
    expect(fieldOnly.statusCode).toBe(413);
    expect(fieldOnly.json()).toEqual({
      error: { code: 'TOO_MANY_PARTS', message: 'Mỗi lần tải lên chỉ gửi một tệp, trong trường "file".' },
    });
    // A text field ahead of the file: 413 when the limit is seen first, 400 when multipart has
    // already handed the file over and then cuts it off (both in one chunk, as here).
    const fieldFirst = await send(`${field}${filePart}\r\n--${boundary}--\r\n`);
    expect([400, 413]).toContain(fieldFirst.statusCode);
    expect(fieldFirst.statusCode).not.toBe(201);
    // A body that breaks off inside the file, and one without a boundary: malformed, not a 500.
    const truncated = await send(filePart);
    expect(truncated.statusCode).toBe(400);
    expect(truncated.json()).toEqual(MALFORMED);
    const noBoundary = await send(`${filePart}\r\n--${boundary}--\r\n`, 'multipart/form-data');
    expect(noBoundary.statusCode).toBe(400);
    expect(noBoundary.json()).toEqual(MALFORMED);

    expect(await fileRows(ids.get(O)!)).toHaveLength(0);
    expect(filesUnder(ids.get(O)!)).toEqual([]);
  });

  it('an expired upload is neither listed nor served', async () => {
    const res = await upload(O, 'het-han.geojson', Buffer.from('{}'));
    expect(res.statusCode).toBe(201);
    const up = res.json().upload;
    await trackUpload(up.id);
    await getPool().query(`UPDATE workspace.files SET delete_after = now() - interval '1 second' WHERE id = $1`, [up.id]);

    const list = await call(O, 'GET', '/uploads');
    expect(list.statusCode).toBe(200);
    expect(list.json().uploads.map((u: { id: string }) => u.id)).not.toContain(up.id);
    const read = await call(O, 'GET', `/uploads/${up.id}`);
    expect(read.statusCode).toBe(404);
    expect(read.json()).toEqual(NOT_FOUND);

    // Given more time, it is back: expiry is all that hid it.
    await getPool().query(`UPDATE workspace.files SET delete_after = now() + interval '1 hour' WHERE id = $1`, [up.id]);
    expect((await call(O, 'GET', '/uploads')).json().uploads.map((u: { id: string }) => u.id)).toContain(up.id);
    expect((await call(O, 'GET', `/uploads/${up.id}`)).statusCode).toBe(200);
    await call(O, 'DELETE', `/uploads/${up.id}`);
  });

  it('uploads are private', async () => {
    const res = await upload(O, 'diem.kml', Buffer.from('<kml/>'));
    expect(res.statusCode).toBe(201);
    const up = res.json().upload;
    await trackUpload(up.id);

    const read = await call(S, 'GET', `/uploads/${up.id}`);
    expect(read.statusCode).toBe(404);
    expect(read.json()).toEqual(NOT_FOUND);
    const del = await call(S, 'DELETE', `/uploads/${up.id}`);
    expect(del.statusCode).toBe(404);
    expect(del.json()).toEqual(NOT_FOUND);
    const list = await call(S, 'GET', '/uploads');
    expect(list.json().uploads.map((u: { id: string }) => u.id)).not.toContain(up.id);

    // Still there for its owner.
    expect((await call(O, 'GET', '/uploads')).json().uploads.map((u: { id: string }) => u.id)).toContain(up.id);
  });

  it("admin sets a user's quota", async () => {
    const target = ids.get(S)!;
    try {
      const put = await app.inject({
        method: 'PUT', url: `/api/users/${target}`, headers: await auth(A), payload: { quotaBytes: 5 },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().user.quotaBytes).toBe(5);

      const list = await call(S, 'GET', '/uploads');
      expect(list.json().quotaBytes).toBe(5);

      const forbidden = await app.inject({
        method: 'PUT', url: `/api/users/${target}`, headers: await auth(S), payload: { quotaBytes: 10 },
      });
      expect(forbidden.statusCode).toBe(403);

      const negative = await app.inject({
        method: 'PUT', url: `/api/users/${target}`, headers: await auth(A), payload: { quotaBytes: -1 },
      });
      expect(negative.statusCode).toBe(400);
    } finally {
      await getPool().query(`UPDATE app.users SET quota_bytes = DEFAULT WHERE id = $1`, [target]);
    }
  });

  it('resolveInStore refuses an escaping path', () => {
    expect(() => resolveInStore('../x')).toThrow();
    expect(() => resolveInStore('uploads/../../x')).toThrow();
    expect(() => resolveInStore(path.resolve(os.tmpdir(), 'elsewhere.gpkg'))).toThrow();
    expect(() => resolveInStore('')).toThrow();
    expect(resolveInStore('uploads/a/b.gpkg')).toBe(path.join(STORE, 'uploads', 'a', 'b.gpkg'));
    expect(storeRoot()).toBe(path.resolve(STORE));
  });
});
