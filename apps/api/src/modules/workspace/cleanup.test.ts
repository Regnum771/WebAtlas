import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discardDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import {
  adminSummary, archiveNoticed, ARCHIVE_AFTER_NOTICE_DAYS, deleteExpiredFiles, discardOrphanDrafts, INACTIVE_NOTICE_DAYS,
  markInactive, ORIGINALS_KEEP_DAYS, ORPHAN_DRAFT_GRACE_HOURS, reconcileStore,
} from './cleanup';
import { parseCleanupArgs, runReconcile } from './cleanupCli';
import { storeRoot, unlinkInStore } from './fileStore';
import { workspaceFilesDir } from '../../config/env';

// A fresh store under the OS temp directory for this file; the previous value is restored after.
const previousStoreDir = process.env.WORKSPACE_FILES_DIR;
const STORE = mkdtempSync(path.join(os.tmpdir(), 'p3b-lifecycle-'));
process.env.WORKSPACE_FILES_DIR = STORE;
// Outside the store: what a link inside it points at. Reconciliation must never reach it.
const OUTSIDE = mkdtempSync(path.join(os.tmpdir(), 'p3b-lifecycle-outside-'));

const app = buildApp();
const LAYER = 'dams';
const SOURCE = 'cleanup.test';
const PW = 'p3a-cleanup-pass-123';
const email = (who: string) => `p3a-cleanup-${who}@webatlas.test`;
const O = email('owner');
const ADM = email('admin');
const V = email('viewer');
// The file-lifecycle tests (P3b) have users of their own.
const LO = 'p3b-lifecycle-owner@webatlas.test';
const LX = 'p3b-lifecycle-other@webatlas.test';
const ids = new Map<string, string>();

// Fixed clock for every cleanup call; timestamps are backdated relative to it by SQL.
const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** Every cleanup in this file is limited to its own users and drafts. */
const scope = () => ({ ownerIds: [...ids.values()], draftIds: draftsMade });

let rootId = '';
const draftsMade: string[] = [];

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

/** Run fn in a committed transaction; always roll back before releasing the client. */
async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

/** A draft on our synthetic root, with a chosen owner, updated_at and status. */
async function makeDraft(owner: string | null, updatedAt: Date, status = 'personal'): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO app.dataset_versions
       (layer_key, kind, parent_version_id, source, label, ingested_by, is_active, draft_status, revision, updated_at)
     VALUES ($1, 'edit', $2, 'draft', 'cleanup-test draft', $3, false, $4, 0, $5) RETURNING id`,
    [LAYER, rootId, owner, status, updatedAt]
  );
  draftsMade.push(rows[0].id);
  return rows[0].id;
}
async function versionExists(id: string): Promise<boolean> {
  const { rows } = await getPool().query(`SELECT 1 FROM app.dataset_versions WHERE id = $1`, [id]);
  return rows.length === 1;
}
async function makeMap(title: string, opts: { activity?: Date; notice?: Date | null } = {}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title, last_activity_at, inactivity_notice_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ids.get(O), title, opts.activity ?? NOW, opts.notice ?? null]
  );
  return rows[0].id;
}
async function addEditCopy(mapId: string, draftId: string, position = 0) {
  await getPool().query(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, layer_key, draft_id)
     VALUES ($1, 'edit_copy', 'Sửa lớp', $2, $3, $4)`,
    [mapId, position, LAYER, draftId]
  );
}
async function addFreeLayer(mapId: string, title: string, position = 0): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type)
     VALUES ($1, 'free', $2, $3, 'point') RETURNING id`,
    [mapId, title, position]
  );
  return rows[0].id;
}
async function addFeature(layerId: string, properties: Record<string, unknown>) {
  await getPool().query(
    `INSERT INTO workspace.features (layer_id, geom, properties)
     VALUES ($1, ST_SetSRID(ST_MakePoint(108, 16), 4326), $2)`,
    [layerId, JSON.stringify(properties)]
  );
}
async function mapState(id: string) {
  const { rows } = await getPool().query<{ inactivity_notice_at: Date | null; archived_at: Date | null }>(
    `SELECT inactivity_notice_at, archived_at FROM workspace.maps WHERE id = $1`, [id]
  );
  return rows[0];
}

async function cleanupUsers() {
  // Maps, layers, jobs and files rows go with their owner (ON DELETE CASCADE).
  await getPool().query(
    `DELETE FROM app.users WHERE email LIKE 'p3a-cleanup-%@webatlas.test' OR email LIKE 'p3b-lifecycle-%@webatlas.test'`
  );
}

// --- file store helpers (lifecycle tests) -----------------------------------------------------

/** Every store-relative path this file wrote; afterAll unlinks each one on its own. */
const written = new Set<string>();
/** Paths outside the store (and links inside it) this file made; afterAll unlinks each one. */
const extraPaths: string[] = [];

function writeInStore(rel: string, body = 'x', mtime?: Date): void {
  const abs = path.join(STORE, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  if (mtime) utimesSync(abs, mtime, mtime);
  written.add(rel);
}
const onDisk = (rel: string) => existsSync(path.join(STORE, ...rel.split('/')));

type FileKind = 'upload' | 'cog' | 'export';
/** A workspace.files row of `owner` (and, unless disk is false, its file in the store). */
async function addFile(
  owner: string, kind: FileKind, opts: { deleteAfter?: Date | null; disk?: boolean; rel?: string } = {}
): Promise<{ id: string; rel: string }> {
  const id = randomUUID();
  const rel = opts.rel ?? (
    kind === 'upload' ? `uploads/${owner}/${id}/original.geojson`
    : kind === 'cog' ? `cog/${owner}/${id}.tif`
    : `exports/${owner}/${randomUUID()}/ban-do.gpkg`
  );
  if (opts.disk !== false) writeInStore(rel);
  await getPool().query(
    `INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
     VALUES ($1, $2, $3, $4, 'tep', 'application/octet-stream', 1, $5)`,
    [id, owner, kind, rel, opts.deleteAfter ?? null]
  );
  return { id, rel };
}
async function deleteAfterOf(fileId: string): Promise<Date | null | undefined> {
  const { rows } = await getPool().query<{ delete_after: Date | null }>(
    `SELECT delete_after FROM workspace.files WHERE id = $1`, [fileId]
  );
  return rows[0]?.delete_after; // undefined: the row is gone
}
/** An import job of `owner` that read `fileId` into `mapId` (params as jobs.ts writes them); succeeded by default. */
async function addImportJob(
  owner: string, mapId: string, fileId: string, status: 'queued' | 'running' | 'succeeded' | 'failed' = 'succeeded'
) {
  await getPool().query(
    `INSERT INTO workspace.jobs (owner_id, map_id, kind, status, params)
     VALUES ($1, $2, 'import', $4, $3)`,
    [owner, mapId, JSON.stringify({ fileId, mapId, ownerId: owner }), status]
  );
}
async function makeOwnedMap(owner: string, title: string, opts: { notice?: Date; archived?: Date } = {}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title, last_activity_at, inactivity_notice_at, archived_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [owner, title, ago(220 * DAY), opts.notice ?? null, opts.archived ?? null]
  );
  return rows[0].id;
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  await cleanupUsers();
  const repo = usersRepository(pool);
  for (const [who, role] of [[O, 'viewer'], [ADM, 'admin'], [V, 'viewer'], [LO, 'viewer'], [LX, 'viewer']] as const) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: who, role });
    ids.set(who, row.id);
  }
  // A synthetic, never-activated root so drafts have a parent without touching real layer state.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
     VALUES ($1, 'ingest', $2, 'cleanup-test root', false) RETURNING id`,
    [LAYER, SOURCE]
  );
  rootId = rows[0].id;
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  await runStages([
    // Each file this suite wrote, unlinked on its own; directories are left.
    async () => {
      for (const rel of written) await unlinkInStore(rel);
    },
    async () => {
      for (const p of extraPaths) {
        try {
          unlinkSync(p); // a file, or a link (never its target)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
    },
    () => pool.query(`DELETE FROM workspace.maps WHERE owner_id = ANY($1::uuid[])`, [userIds]),
    async () => {
      for (const id of draftsMade) {
        if (await versionExists(id)) await tx((c) => discardDraft(c, id));
      }
    },
    () => pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [rootId]),
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupUsers,
    () => app.close(),
    async () => {
      if (previousStoreDir === undefined) delete process.env.WORKSPACE_FILES_DIR;
      else process.env.WORKSPACE_FILES_DIR = previousStoreDir;
    },
  ]);
});

describe('inactive maps', () => {
  it('a map inactive for 181 days gets a notice; activity clears it', async () => {
    expect([INACTIVE_NOTICE_DAYS, ARCHIVE_AFTER_NOTICE_DAYS, ORPHAN_DRAFT_GRACE_HOURS]).toEqual([180, 30, 24]);
    const old = await makeMap('Cũ', { activity: ago(181 * DAY) });
    const recent = await makeMap('Gần đây', { activity: ago(179 * DAY) });
    const already = await makeMap('Đã báo', { activity: ago(200 * DAY), notice: ago(5 * DAY) });

    // A scope that names only drafts touches no maps (not every map in the database).
    expect(await markInactive(getPool(), NOW, { draftIds: ['00000000-0000-4000-8000-000000000000'] })).toBe(0);
    expect((await mapState(old)).inactivity_notice_at).toBeNull();

    expect(await markInactive(getPool(), NOW, scope())).toBe(1);
    expect((await mapState(old)).inactivity_notice_at).toEqual(NOW);
    expect((await mapState(recent)).inactivity_notice_at).toBeNull();
    // An existing notice keeps its date: the 30 days run from the first notice.
    expect((await mapState(already)).inactivity_notice_at).toEqual(ago(5 * DAY));

    // A content write (bumpMap) clears the notice and refreshes activity.
    const res = await app.inject({
      method: 'PATCH', url: `/api/workspace/maps/${old}`,
      headers: { authorization: `Bearer ${await tokenFor(O)}` },
      payload: { title: 'Cũ nhưng vừa sửa', expectedRevision: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect((await mapState(old)).inactivity_notice_at).toBeNull();
  });

  it('a map noticed 31 days ago is archived and its drafts discarded; one noticed 29 days ago is not', async () => {
    const due = await makeMap('Đến hạn', { activity: ago(220 * DAY), notice: ago(31 * DAY) });
    const dueDraft = await makeDraft(ids.get(O)!, NOW);
    await addEditCopy(due, dueDraft);
    const freeLayer = await addFreeLayer(due, 'Lớp tự vẽ', 1);
    await addFeature(freeLayer, {});
    const notYet = await makeMap('Chưa đến hạn', { activity: ago(210 * DAY), notice: ago(29 * DAY) });
    const keptDraft = await makeDraft(ids.get(O)!, NOW);
    await addEditCopy(notYet, keptDraft);

    expect(await archiveNoticed(getPool(), NOW, scope())).toBe(1);

    expect((await mapState(due)).archived_at).toEqual(NOW);
    expect(await versionExists(dueDraft)).toBe(false);
    // Free features are kept.
    const { rows: kept } = await getPool().query(`SELECT 1 FROM workspace.features WHERE layer_id = $1`, [freeLayer]);
    expect(kept).toHaveLength(1);
    expect((await mapState(notYet)).archived_at).toBeNull();
    expect(await versionExists(keptDraft)).toBe(true);
  });
});

describe('orphan drafts', () => {
  it('no owner, or unreferenced and older than 24 h, are discarded; a referenced or fresh one is kept', async () => {
    const stale = ago((ORPHAN_DRAFT_GRACE_HOURS + 1) * HOUR);
    const fresh = ago(23 * HOUR);
    const noOwner = await makeDraft(null, fresh); // discarded even though fresh
    const unreferencedOld = await makeDraft(ids.get(O)!, stale);
    const unreferencedFresh = await makeDraft(ids.get(O)!, fresh);
    const referencedOld = await makeDraft(ids.get(O)!, stale);
    await addEditCopy(await makeMap('Có tham chiếu'), referencedOld);
    const submittedOld = await makeDraft(ids.get(O)!, stale, 'submitted');

    expect(await discardOrphanDrafts(getPool(), NOW, scope())).toBe(2);

    expect(await versionExists(noOwner)).toBe(false);
    expect(await versionExists(unreferencedOld)).toBe(false);
    expect(await versionExists(unreferencedFresh)).toBe(true);
    expect(await versionExists(referencedOld)).toBe(true);
    expect(await versionExists(submittedOld)).toBe(true);
  });
});

describe('admin summary', () => {
  it('admin summary reports counts and sizes, no titles', async () => {
    const title = 'Tiêu đề-bí-mật-xyz';
    const map = await makeMap(title);
    const layer = await addFreeLayer(map, 'Lớp-bí-mật-xyz');
    for (const n of [1, 2]) await addFeature(layer, { ten: `giá-trị-bí-mật-${n}` });

    const res = await app.inject({
      method: 'GET', url: '/api/workspace/admin/summary',
      headers: { authorization: `Bearer ${await tokenFor(ADM)}` },
    });
    expect(res.statusCode).toBe(200);
    const owners = res.json().owners as Array<{ userId: string; email: string; maps: number; layers: number; features: number; bytes: number }>;
    const mine = owners.find((o) => o.userId === ids.get(O))!;
    expect(mine).toMatchObject({ email: O });
    expect(mine.maps).toBeGreaterThanOrEqual(1);
    expect(mine.layers).toBeGreaterThanOrEqual(1);
    expect(mine.features).toBeGreaterThanOrEqual(2);
    expect(mine.bytes).toBeGreaterThan(0);
    expect(Object.keys(mine).sort()).toEqual(
      ['bytes', 'email', 'features', 'layers', 'maps', 'quotaBytes', 'usageBytes', 'userId']
    );
    expect(res.body).not.toContain('bí-mật');
    expect(res.body).not.toContain(title);

    // The same function, called directly.
    expect((await adminSummary(getPool())).find((o) => o.userId === ids.get(O))?.features).toBe(mine.features);
  });

  it("the summary counts an owner's files in usageBytes and lists a user who has only uploads", async () => {
    // Rows only: nothing is read from the store.
    const insertFile = (owner: string, size: number, deleteAfter: string | null) => getPool().query(
      `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
       VALUES ($1, 'upload', $2, 'tep', 'application/octet-stream', $3, ${deleteAfter ?? 'NULL'})`,
      [owner, `uploads/${owner}/${randomUUID()}/original.geojson`, size]
    );
    const map = await makeMap('Có tệp');
    await addFeature(await addFreeLayer(map, 'Điểm'), { ten: 'a' });
    await insertFile(ids.get(O)!, 1000, null);
    await insertFile(ids.get(O)!, 300, `now() + interval '1 day'`);
    await insertFile(ids.get(O)!, 7000, `now() - interval '1 minute'`); // expired: no longer counts
    // V owns no map, only an upload.
    await insertFile(ids.get(V)!, 2048, null);
    await getPool().query(`UPDATE app.users SET quota_bytes = 5000000 WHERE id = $1`, [ids.get(V)]);

    const res = await app.inject({
      method: 'GET', url: '/api/workspace/admin/summary',
      headers: { authorization: `Bearer ${await tokenFor(ADM)}` },
    });
    expect(res.statusCode).toBe(200);
    const owners = res.json().owners as Array<Record<string, unknown> & { userId: string; bytes: number }>;
    const mine = owners.find((o) => o.userId === ids.get(O))!;
    // bytes stays the free features alone; usageBytes is the quota's measure, files included.
    expect(mine.bytes).toBeGreaterThan(0);
    expect(mine.usageBytes).toBe(mine.bytes + 1300);
    expect(mine.quotaBytes).toBe(1073741824);
    const { rows } = await getPool().query<{ usage: string }>(`SELECT workspace.usage_bytes($1) AS usage`, [ids.get(O)]);
    expect(mine.usageBytes).toBe(Number(rows[0].usage));

    expect(owners.find((o) => o.userId === ids.get(V))).toEqual({
      userId: ids.get(V), email: V, maps: 0, layers: 0, features: 0, bytes: 0, usageBytes: 2048, quotaBytes: 5000000,
    });
    // Someone with neither maps nor files is not listed.
    expect(owners.find((o) => o.userId === ids.get(ADM))).toBeUndefined();
  });

  it('the summary route is admin-only', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/workspace/admin/summary',
      headers: { authorization: `Bearer ${await tokenFor(V)}` },
    });
    expect(res.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/workspace/admin/summary' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('file lifecycle', () => {
  const owner = () => ids.get(LO)!;
  const lifecycleScope = () => ({ ownerIds: [ids.get(LO)!] });
  async function ownerCall(method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({
      method, url: `/api/workspace${url}`,
      headers: { authorization: `Bearer ${await tokenFor(LO)}` },
      ...(payload ? { payload } : {}),
    });
  }

  it("archiving marks the map's import originals for 90 days; a file also imported into a live map is kept", async () => {
    expect(ORIGINALS_KEEP_DAYS).toBe(90);
    const due = await makeOwnedMap(owner(), 'Sắp lưu trữ', { notice: ago(31 * DAY) });
    const live = await makeOwnedMap(owner(), 'Đang dùng');
    const archivedBefore = await makeOwnedMap(owner(), 'Đã lưu trữ', { archived: ago(10 * DAY) });

    const onlyDue = await addFile(owner(), 'upload'); // imported into the due map only
    const alsoLive = await addFile(owner(), 'upload'); // also imported into a live map: kept
    const alsoArchived = await addFile(owner(), 'upload'); // also imported into an archived map: marked
    const liveOnly = await addFile(owner(), 'upload'); // imported into the live map only
    const neverImported = await addFile(owner(), 'upload');
    const reimported = await addFile(owner(), 'upload'); // imported into the due map, imported again below
    const failedLive = await addFile(owner(), 'upload'); // its import into the live map failed: marked
    const queuedLive = await addFile(owner(), 'upload'); // an import into the live map is only queued: marked
    const failedDueOnly = await addFile(owner(), 'upload'); // only a failed import into the due map: not an original
    for (const f of [onlyDue, alsoLive, alsoArchived, reimported, failedLive, queuedLive]) {
      await addImportJob(owner(), due, f.id);
    }
    await addImportJob(owner(), live, alsoLive.id);
    await addImportJob(owner(), archivedBefore, alsoArchived.id);
    await addImportJob(owner(), live, liveOnly.id);
    await addImportJob(owner(), live, failedLive.id, 'failed');
    await addImportJob(owner(), live, queuedLive.id, 'queued');
    await addImportJob(owner(), due, failedDueOnly.id, 'failed');

    expect(await archiveNoticed(getPool(), NOW, lifecycleScope())).toBe(1);
    expect((await mapState(due)).archived_at).toEqual(NOW);

    const keepUntil = new Date(NOW.getTime() + 90 * DAY);
    expect(await deleteAfterOf(onlyDue.id)).toEqual(keepUntil);
    expect(await deleteAfterOf(alsoArchived.id)).toEqual(keepUntil);
    expect(await deleteAfterOf(reimported.id)).toEqual(keepUntil);
    expect(await deleteAfterOf(failedLive.id)).toEqual(keepUntil);
    // Its import clears the date if it succeeds (worker.py keep_imported_original); until then
    // the sweep leaves the file alone (BEING_IMPORTED).
    expect(await deleteAfterOf(queuedLive.id)).toEqual(keepUntil);
    expect(await deleteAfterOf(alsoLive.id)).toBeNull();
    expect(await deleteAfterOf(liveOnly.id)).toBeNull();
    expect(await deleteAfterOf(neverImported.id)).toBeNull();
    expect(await deleteAfterOf(failedDueOnly.id)).toBeNull();
    // Marked, not removed: the originals stay on disk for the 90 days.
    expect(onDisk(onlyDue.rel)).toBe(true);

    // Queued again into a live map, an original keeps its date: only a successful import clears
    // it (the worker, test_import_vector.py). While the import is queued the sweep leaves the
    // file alone, even past its date; once the import has failed, the sweep removes it.
    const res = await ownerCall('POST', `/maps/${live}/imports`, { fileId: reimported.id });
    expect(res.statusCode).toBe(201);
    expect(await deleteAfterOf(reimported.id)).toEqual(keepUntil);
    await getPool().query(`UPDATE workspace.files SET delete_after = $2 WHERE id = $1`, [reimported.id, ago(HOUR)]);
    expect(await deleteExpiredFiles(getPool(), NOW, lifecycleScope())).toBe(0);
    expect(await deleteAfterOf(reimported.id)).toEqual(ago(HOUR));
    expect(onDisk(reimported.rel)).toBe(true);
    await getPool().query(`UPDATE workspace.jobs SET status = 'failed' WHERE id = $1`, [res.json().job.id]);
    expect(await deleteExpiredFiles(getPool(), NOW, lifecycleScope())).toBe(1);
    expect(await deleteAfterOf(reimported.id)).toBeUndefined();
    expect(onDisk(reimported.rel)).toBe(false);
    // One whose time has run out is gone, whether or not the sweep has removed it yet.
    await getPool().query(`UPDATE workspace.files SET delete_after = now() - interval '1 second' WHERE id = $1`, [onlyDue.id]);
    const expired = await ownerCall('POST', `/maps/${live}/imports`, { fileId: onlyDue.id });
    expect(expired.statusCode).toBe(404);
    expect(expired.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tệp.' } });
  });

  it("an archived map's original is kept for a live map only by a succeeded import", async () => {
    const due = await makeOwnedMap(owner(), 'Sắp lưu trữ (2)', { notice: ago(31 * DAY) });
    const live = await makeOwnedMap(owner(), 'Đang dùng (2)');
    const byStatus = new Map<string, { id: string }>();
    for (const status of ['queued', 'running', 'succeeded', 'failed'] as const) {
      const file = await addFile(owner(), 'upload', { disk: false });
      await addImportJob(owner(), due, file.id); // each one an original of the due map
      await addImportJob(owner(), live, file.id, status);
      byStatus.set(status, file);
    }

    expect(await archiveNoticed(getPool(), NOW, lifecycleScope())).toBe(1);

    const keepUntil = new Date(NOW.getTime() + ORIGINALS_KEEP_DAYS * DAY);
    expect(await deleteAfterOf(byStatus.get('succeeded')!.id)).toBeNull();
    for (const status of ['queued', 'running', 'failed']) {
      expect(await deleteAfterOf(byStatus.get(status)!.id), status).toEqual(keepUntil);
    }
  });

  it('expired files are unlinked and their rows deleted; a missing file does not stop the sweep', async () => {
    // Cleared first so the sweep below sees only this test's files.
    await getPool().query(`UPDATE workspace.files SET delete_after = NULL WHERE owner_id = $1`, [owner()]);
    // Swept in delete_after order: the missing file first, then the refused path, then the export.
    const missing = await addFile(owner(), 'cog', { deleteAfter: ago(2 * HOUR), disk: false });
    const outsideRow = await addFile(owner(), 'upload', { deleteAfter: ago(90 * 60 * 1000), disk: false, rel: '../thoat-ra.txt' });
    const expiredExport = await addFile(owner(), 'export', { deleteAfter: ago(HOUR) });
    const notYet = await addFile(owner(), 'upload', { deleteAfter: new Date(NOW.getTime() + HOUR) });
    const forever = await addFile(owner(), 'upload');
    const someoneElse = await addFile(ids.get(LX)!, 'export', { deleteAfter: ago(HOUR) }); // outside the scope

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await deleteExpiredFiles(getPool(), NOW, lifecycleScope())).toBe(2);
      // The refused file is reported on its own, and the sweep went on past it.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(outsideRow.id);
    } finally {
      warn.mockRestore();
    }

    expect(await deleteAfterOf(missing.id)).toBeUndefined();
    expect(await deleteAfterOf(expiredExport.id)).toBeUndefined();
    expect(onDisk(expiredExport.rel)).toBe(false);
    // A path that resolves outside the store is refused on its own; its row waits for a person.
    expect(await deleteAfterOf(outsideRow.id)).toEqual(ago(90 * 60 * 1000));
    for (const kept of [notYet, forever]) {
      expect(await deleteAfterOf(kept.id)).not.toBeUndefined();
      expect(onDisk(kept.rel)).toBe(true);
    }
    expect(await deleteAfterOf(someoneElse.id)).toEqual(ago(HOUR));
    expect(onDisk(someoneElse.rel)).toBe(true);
    // Leave no orphan behind for the store sweep below.
    await getPool().query(`DELETE FROM workspace.files WHERE id = ANY($1::uuid[])`, [[outsideRow.id, someoneElse.id]]);
    await unlinkInStore(someoneElse.rel);
  });

  it('deleting a raster layer schedules its COG for removal', async () => {
    const mapId = (await ownerCall('POST', '/maps', { title: 'Bản đồ ảnh' })).json().map.id as string;
    async function rasterLayer(map: string, position: number) {
      const cog = await addFile(owner(), 'cog');
      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
         VALUES ($1, 'raster', 'Ảnh', $2, $3, '{}'::jsonb) RETURNING id`,
        [map, position, cog.id]
      );
      return { layerId: rows[0].id, cog };
    }
    const first = await rasterLayer(mapId, 0);
    const free = await addFreeLayer(mapId, 'Điểm', 1);

    const stale = await ownerCall('DELETE', `/maps/${mapId}/layers/${first.layerId}`, { expectedRevision: 5 });
    expect(stale.statusCode).toBe(409);
    const before = Date.now();
    const res = await ownerCall('DELETE', `/maps/${mapId}/layers/${first.layerId}`, { expectedRevision: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revision: 1 });
    const { rows: left } = await getPool().query<{ id: string; position: number }>(
      `SELECT id, position FROM workspace.map_layers WHERE map_id = $1`, [mapId]
    );
    expect(left).toEqual([{ id: free, position: 0 }]);
    // Scheduled in the request, removed by the sweep: the API never unlinks.
    const due = await deleteAfterOf(first.cog.id);
    expect(due).toBeInstanceOf(Date);
    expect(due!.getTime()).toBeGreaterThan(before - 60_000);
    expect(due!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(onDisk(first.cog.rel)).toBe(true);

    // Deleting a map does the same for each of its raster layers.
    const second = await rasterLayer(mapId, 1);
    const gone = await ownerCall('DELETE', `/maps/${mapId}`, { expectedRevision: 1 });
    expect(gone.statusCode).toBe(204);
    expect(await deleteAfterOf(second.cog.id)).toBeInstanceOf(Date);
    expect(onDisk(second.cog.rel)).toBe(true);

    // The next sweep removes both. Its clock is a minute ahead: the database's now() set them.
    expect(await deleteExpiredFiles(getPool(), new Date(Date.now() + 60_000), lifecycleScope())).toBeGreaterThanOrEqual(2);
    for (const cog of [first.cog, second.cog]) {
      expect(await deleteAfterOf(cog.id)).toBeUndefined();
      expect(onDisk(cog.rel)).toBe(false);
    }
  });

  it('the store sweep removes old orphan files only: young ones, files with a row and links are kept', async () => {
    // Age is taken from the newest of mtime, ctime and birthtime, and a file just written cannot
    // be made older than now (backdating its mtime changes its ctime). So the sweep's clock runs
    // two days ahead instead: every file written here is two days old to it.
    const later = new Date(Date.now() + 2 * DAY);
    const old = new Date(Date.now() - 2 * DAY);
    const me = owner();
    const oldOrphan = `uploads/${me}/${randomUUID()}/original.kml`;
    const youngOrphan = `cog/${me}/${randomUUID()}.tif`;
    const workLeftover = `exports/${me}/${randomUUID()}/.work-abc123/ban-do.gpkg`;
    const partLeftover = `cog/${me}/${randomUUID()}.tif.part`;
    const outsideTrees = 'ghi-chu.txt'; // at the root, in none of the three trees: not walked
    writeInStore(oldOrphan);
    // Written an hour before the sweep's clock: young to it.
    writeInStore(youngOrphan, 'x', new Date(later.getTime() - HOUR));
    writeInStore(workLeftover);
    writeInStore(partLeftover);
    writeInStore(outsideTrees);
    const withRow = await addFile(me, 'upload');

    // A directory link (a junction on Windows) inside the store, to an old file outside it.
    const target = path.join(OUTSIDE, 'khong-dung.txt');
    writeFileSync(target, 'x');
    utimesSync(target, old, old);
    const dirLink = path.join(STORE, 'uploads', me, 'lien-ket');
    symlinkSync(OUTSIDE, dirLink, 'junction');
    extraPaths.push(dirLink);
    // A file link too, where the platform allows one (Windows refuses it without the privilege).
    const fileLink = path.join(STORE, 'cog', me, 'lien-ket.tif');
    let fileLinkMade = false;
    try {
      symlinkSync(target, fileLink, 'file');
      fileLinkMade = true;
      extraPaths.push(fileLink);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    }
    extraPaths.push(target);

    // A dry run by default: the candidates are listed and nothing is deleted.
    const dry = await reconcileStore(getPool(), later, { force: true });
    expect(dry).toMatchObject({ root: path.resolve(STORE), refused: null, removed: 0 });
    expect(dry.candidates.map((c) => c.path).sort()).toEqual([oldOrphan, partLeftover, workLeftover].sort());
    for (const c of dry.candidates) {
      expect(c.sizeBytes).toBe(1);
      expect(c.ageMs).toBeGreaterThan(DAY);
    }
    expect(onDisk(oldOrphan)).toBe(true);

    // Forced: the store's other files are few, so 3 orphans are over the 20 % guard (tested below).
    expect(await reconcileStore(getPool(), later, { apply: true, force: true })).toMatchObject({ removed: 3, refused: null });

    expect(onDisk(oldOrphan)).toBe(false);
    expect(onDisk(workLeftover)).toBe(false);
    expect(onDisk(partLeftover)).toBe(false);
    expect(onDisk(youngOrphan)).toBe(true);
    expect(onDisk(withRow.rel)).toBe(true);
    expect(onDisk(outsideTrees)).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(dirLink)).toBe(true);
    if (fileLinkMade) expect(existsSync(fileLink)).toBe(true);
    // Directories are never removed, even emptied ones.
    expect(existsSync(path.join(STORE, ...path.posix.dirname(oldOrphan).split('/')))).toBe(true);

    // A shorter age reaches the young orphan.
    expect(
      await reconcileStore(getPool(), new Date(later.getTime() + 1000), { olderThanMs: 0, apply: true, force: true })
    ).toMatchObject({ removed: 1 });
    expect(onDisk(youngOrphan)).toBe(false);
    expect(onDisk(withRow.rel)).toBe(true);
  });

  it('the store sweep keeps a file copied a moment ago, even when the copy kept an old mtime', async () => {
    // As sharing.ts copyCog does: fs.copyFile from a COG last written two days ago. On Windows
    // and macOS the copy keeps the source's mtime; the row only commits with the whole map copy.
    const old = new Date(Date.now() - 2 * DAY);
    const source = path.join(OUTSIDE, 'anh-goc.tif');
    writeFileSync(source, 'x');
    utimesSync(source, old, old);
    extraPaths.push(source);
    const copied = `cog/${owner()}/${randomUUID()}.tif`;
    const abs = path.join(STORE, ...copied.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    copyFileSync(source, abs);
    written.add(copied);
    // Pinned on every platform: the copy's mtime is two days old, whatever copyFile kept.
    utimesSync(abs, old, old);

    const apply = { apply: true, force: true };
    expect(await reconcileStore(getPool(), new Date(), apply)).toMatchObject({ candidates: [], removed: 0 });
    expect(onDisk(copied)).toBe(true);
    // An orphan in every other respect: two days on, with still no row, it goes.
    expect(await reconcileStore(getPool(), new Date(Date.now() + 2 * DAY), apply)).toMatchObject({ removed: 1 });
    expect(onDisk(copied)).toBe(false);
  });
});

describe('store reconciliation guards', () => {
  // Each test uses a store of its own under the OS temp directory, so the counts are exact;
  // WORKSPACE_FILES_DIR is set back to this file's STORE after each one.
  const later = () => new Date(Date.now() + 2 * DAY);

  /** A fresh store; returns a writer that records each file for afterAll to unlink on its own. */
  function freshStore(prefix: string) {
    const root = mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.WORKSPACE_FILES_DIR = root;
    const put = (rel: string) => {
      const abs = path.join(root, ...rel.split('/'));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, 'x');
      extraPaths.push(abs);
      return rel;
    };
    const there = (rel: string) => existsSync(path.join(root, ...rel.split('/')));
    return { root, put, there };
  }
  /** `n` files written to the store with a workspace.files row each (one INSERT). */
  async function filesWithRows(put: (rel: string) => string, n: number) {
    const owner = ids.get(LO)!;
    const rels = Array.from({ length: n }, () => put(`uploads/${owner}/${randomUUID()}/original.geojson`));
    await getPool().query(
      `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
       SELECT $1, 'upload', p, 'tep', 'application/octet-stream', 1 FROM unnest($2::text[]) AS p`,
      [owner, rels]
    );
    return rels;
  }
  const orphans = (put: (rel: string) => string, n: number) =>
    Array.from({ length: n }, () => put(`exports/${ids.get(LO)}/${randomUUID()}/.work-x/ban-do.gpkg`));
  const restoreStore = () => { process.env.WORKSPACE_FILES_DIR = STORE; };

  it('a relative WORKSPACE_FILES_DIR is refused, by reconciliation and by the config', async () => {
    process.env.WORKSPACE_FILES_DIR = path.join('var', 'workspace-files');
    try {
      const result = await reconcileStore(getPool(), later(), { apply: true, force: true });
      expect(result).toMatchObject({ root: '', filesSeen: 0, candidates: [], removed: 0 });
      expect(result.refused).toContain('WORKSPACE_FILES_DIR is relative');
      expect(() => workspaceFilesDir()).toThrow(/absolute/);
      expect(() => storeRoot()).toThrow(/absolute/);
    } finally {
      restoreStore();
    }
    // Empty still means unset (the default, absolute).
    process.env.WORKSPACE_FILES_DIR = '';
    try {
      expect(path.isAbsolute(workspaceFilesDir())).toBe(true);
    } finally {
      restoreStore();
    }
  });

  it('a dry run lists the candidates; apply deletes them; over 20 % of the store is refused unless forced', async () => {
    const { put, there } = freshStore('p3b-reconcile-share-');
    try {
      const kept = await filesWithRows(put, 10);
      const [one] = orphans(put, 1); // 1 of 11: under the guard

      const dry = await reconcileStore(getPool(), later());
      expect(dry).toMatchObject({ filesSeen: 11, refused: null, removed: 0 });
      expect(dry.candidates.map((c) => c.path)).toEqual([one]);
      expect(there(one)).toBe(true);
      expect(await reconcileStore(getPool(), later(), { apply: true })).toMatchObject({ removed: 1, refused: null });
      expect(there(one)).toBe(false);

      const three = orphans(put, 3); // 3 of 13: over 20 %
      const refused = await reconcileStore(getPool(), later(), { apply: true });
      expect(refused).toMatchObject({ filesSeen: 13, removed: 0 });
      expect(refused.candidates).toHaveLength(3);
      expect(refused.refused).toContain('--force');
      for (const rel of three) expect(there(rel)).toBe(true);

      expect(await reconcileStore(getPool(), later(), { apply: true, force: true })).toMatchObject({ removed: 3 });
      for (const rel of three) expect(there(rel)).toBe(false);
      for (const rel of kept) expect(there(rel)).toBe(true);
    } finally {
      restoreStore();
    }
  });

  it('more than 50 orphans are refused unless forced, even under 20 % of the store', async () => {
    const { put, there } = freshStore('p3b-reconcile-count-');
    try {
      await filesWithRows(put, 250);
      const many = orphans(put, 51); // 51 of 301: under 20 %, over 50 files
      const refused = await reconcileStore(getPool(), later(), { apply: true });
      expect(refused).toMatchObject({ filesSeen: 301, removed: 0 });
      expect(refused.candidates).toHaveLength(51);
      expect(refused.refused).toContain('more than 50 files');
      for (const rel of many) expect(there(rel)).toBe(true);
      expect(await reconcileStore(getPool(), later(), { apply: true, force: true })).toMatchObject({ removed: 51 });
      for (const rel of many) expect(there(rel)).toBe(false);
    } finally {
      restoreStore();
    }
  });

  it('a database with no workspace.files rows is refused, even when forced', async () => {
    const { put, there } = freshStore('p3b-reconcile-empty-');
    try {
      const [orphan] = orphans(put, 1);
      // Stands in for a fresh or restored database: no file is named, and the table is empty.
      const emptyDb = {
        query: async (sql: string) => (sql.includes('EXISTS') ? { rows: [{ has_rows: false }] } : { rows: [] }),
      } as unknown as pg.Pool;
      const result = await reconcileStore(emptyDb, later(), { apply: true, force: true });
      expect(result).toMatchObject({ filesSeen: 1, removed: 0 });
      expect(result.refused).toContain('workspace.files has no rows');
      expect(there(orphan)).toBe(true);
    } finally {
      restoreStore();
    }
  });

  it('the CLI reconciles only when asked, lists by default and deletes only with --apply', async () => {
    expect(parseCleanupArgs([])).toEqual({ archive: false, reconcile: false, apply: false, force: false });
    expect(parseCleanupArgs(['--reconcile'])).toEqual({ archive: false, reconcile: true, apply: false, force: false });
    expect(parseCleanupArgs(['--archive', '--reconcile', '--apply', '--force']))
      .toEqual({ archive: true, reconcile: true, apply: true, force: true });
    expect(() => parseCleanupArgs(['--apply'])).toThrow(/only go with --reconcile/);
    expect(() => parseCleanupArgs(['--force'])).toThrow(/only go with --reconcile/);
    expect(() => parseCleanupArgs(['--reconcile', '--aply'])).toThrow(/unknown argument/);

    const { put, there } = freshStore('p3b-reconcile-cli-');
    try {
      await filesWithRows(put, 10);
      const [orphan] = orphans(put, 1);
      const lines: string[] = [];
      expect(await runReconcile(getPool(), later(), { apply: false, force: false }, (l) => lines.push(l))).toBe(0);
      expect(lines.some((l) => l.includes(orphan) && l.includes('1 bytes'))).toBe(true);
      expect(lines.at(-1)).toContain('dry run, nothing deleted');
      expect(there(orphan)).toBe(true);

      const more = orphans(put, 3);
      lines.length = 0;
      expect(await runReconcile(getPool(), later(), { apply: true, force: false }, (l) => lines.push(l))).toBe(1);
      expect(lines.at(-1)).toContain('REFUSED, nothing deleted');
      for (const rel of [orphan, ...more]) expect(there(rel)).toBe(true);

      lines.length = 0;
      expect(await runReconcile(getPool(), later(), { apply: true, force: true }, (l) => lines.push(l))).toBe(0);
      expect(lines.at(-1)).toContain('removed 4 of 4');
      for (const rel of [orphan, ...more]) expect(there(rel)).toBe(false);
    } finally {
      restoreStore();
    }
  });
});
