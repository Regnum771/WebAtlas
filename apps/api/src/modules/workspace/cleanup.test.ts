import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { discardDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';
import {
  adminSummary, archiveNoticed, ARCHIVE_AFTER_NOTICE_DAYS, discardOrphanDrafts, INACTIVE_NOTICE_DAYS,
  markInactive, ORPHAN_DRAFT_GRACE_HOURS,
} from './cleanup';

const app = buildApp();
const LAYER = 'dams';
const SOURCE = 'cleanup.test';
const PW = 'p3a-cleanup-pass-123';
const email = (who: string) => `p3a-cleanup-${who}@webatlas.test`;
const O = email('owner');
const ADM = email('admin');
const V = email('viewer');
const ids = new Map<string, string>();

// Fixed clock for every cleanup call; timestamps are backdated relative to it by SQL.
const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

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
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-cleanup-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  await cleanupUsers();
  const repo = usersRepository(pool);
  for (const [who, role] of [[O, 'viewer'], [ADM, 'admin'], [V, 'viewer']] as const) {
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
  ]);
});

describe('inactive maps', () => {
  it('a map inactive for 181 days gets a notice; activity clears it', async () => {
    expect([INACTIVE_NOTICE_DAYS, ARCHIVE_AFTER_NOTICE_DAYS, ORPHAN_DRAFT_GRACE_HOURS]).toEqual([180, 30, 24]);
    const old = await makeMap('Cũ', { activity: ago(181 * DAY) });
    const recent = await makeMap('Gần đây', { activity: ago(179 * DAY) });
    const already = await makeMap('Đã báo', { activity: ago(200 * DAY), notice: ago(5 * DAY) });

    expect(await markInactive(getPool(), NOW)).toBeGreaterThanOrEqual(1);
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

    expect(await archiveNoticed(getPool(), NOW)).toBeGreaterThanOrEqual(1);

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

    expect(await discardOrphanDrafts(getPool(), NOW)).toBeGreaterThanOrEqual(2);

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
    expect(Object.keys(mine).sort()).toEqual(['bytes', 'email', 'features', 'layers', 'maps', 'userId']);
    expect(res.body).not.toContain('bí-mật');
    expect(res.body).not.toContain(title);

    // The same function, called directly.
    expect((await adminSummary(getPool())).find((o) => o.userId === ids.get(O))?.features).toBe(mine.features);
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
