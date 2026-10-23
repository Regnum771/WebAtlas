import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { discardDraft, versionsService } from '@webatlas/versioning';
import { pinLayer, restoreActive, runStages, unpinLayer } from '@webatlas/versioning/testing';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const LAYER = 'dams';
const SOURCE = 'sharing.test';
const PIN = 'sharing.test';
const PW = 'p3a-sharing-pass-123';
const GROUP_PREFIX = 'p3a-sharing-';
const email = (who: string) => `p3a-sharing-${who}@webatlas.test`;
const O = email('owner');
const R = email('recipient');
const M = email('member');
const S = email('stranger');
const ids = new Map<string, string>();
const NAMES: Record<string, string> = {
  [O]: 'Chu Ban Do', [R]: 'Nguoi Nhan Qzvk', [M]: 'Thanh Vien Nhom', [S]: 'Nguoi La',
};

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Không tìm thấy bản đồ.' } };
const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';
const SELF_SHARE = 'Không thể chia sẻ với chính mình.';

// Synthetic dams for this file, all managed by 48, one every 0.01° along a line in Đà Nẵng.
const DAMS = Array.from({ length: 10 }, (_, i) => 901011 + i);
const xOf = (ext: number) => 108 + (ext - 901000) * 0.01;
const Y = 16.05;
const ALL = `${xOf(DAMS[0]) - 0.005},${Y - 0.01},${xOf(DAMS[9]) + 0.005},${Y + 0.01}`;

/** Versions this file created itself (the synthetic root). */
const created: string[] = [];
let priorActive: string | null = null;

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
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(who: string, method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method, url: `/api/workspace${url}`,
    headers: { authorization: `Bearer ${await tokenFor(who)}` },
    ...(payload ? { payload } : {}),
  });
}

async function createMap(who: string, title = 'Bản đồ chia sẻ') {
  const res = await call(who, 'POST', '/maps', { title });
  expect(res.statusCode).toBe(201);
  return res.json().map as { id: string; title: string; revision: number };
}
async function revisionOf(who: string, mapId: string): Promise<number> {
  return (await call(who, 'GET', `/maps/${mapId}`)).json().map.revision;
}
/** A map with one free point layer holding one feature; the map is at revision 2. */
async function mapWithFeature(who: string, title?: string) {
  const map = await createMap(who, title);
  const layerRes = await call(who, 'POST', `/maps/${map.id}/layers`, {
    kind: 'free', title: 'Điểm', geometryType: 'point', fields: [{ name: 'ten', type: 'text' }], expectedRevision: 0,
  });
  expect(layerRes.statusCode).toBe(201);
  const layer = layerRes.json().layer as { id: string };
  const featRes = await call(who, 'POST', `/maps/${map.id}/layers/${layer.id}/features`, {
    geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { ten: 'gốc' }, expectedRevision: 1,
  });
  expect(featRes.statusCode).toBe(201);
  return { map, layer, feature: featRes.json().feature as { id: string } };
}
async function share(mapId: string, target: { userId: string } | { groupId: string }, who = O) {
  return call(who, 'POST', `/maps/${mapId}/shares`, target);
}
async function sharedWithMe(who: string): Promise<string[]> {
  return (await call(who, 'GET', '/maps')).json().sharedWithMe.map((m: { id: string }) => m.id);
}
async function mine(who: string): Promise<string[]> {
  return (await call(who, 'GET', '/maps')).json().mine.map((m: { id: string }) => m.id);
}

async function createGroup(name: string, members: string[]): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [GROUP_PREFIX + name]
  );
  for (const m of members) {
    await getPool().query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(m), rows[0].id]);
  }
  return rows[0].id;
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

async function cleanupPrincipals() {
  await getPool().query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await getPool().query(`DELETE FROM app.users WHERE email LIKE 'p3a-sharing-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  const pool = getPool();
  await cleanupPrincipals();
  const repo = usersRepository(pool);
  for (const who of [O, R, M, S]) {
    const row = await repo.insert({ email: who, password_hash: await hashPassword(PW), full_name: NAMES[who], role: 'viewer' });
    ids.set(who, row.id);
  }
  priorActive = await versionsService(pool).getActiveVersionId(LAYER);
  // This file commits an activation on dams: pin every existing version so retention cannot
  // prune a real ingest while it runs.
  await pinLayer(pool, LAYER, PIN);
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ($1, 'ingest', $2, 'sharing-test root', false) RETURNING id`,
      [LAYER, SOURCE]
    );
    created.push(rows[0].id);
    for (const ext of DAMS) {
      await c.query(
        `INSERT INTO water.dams
           (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, '{}', '{}', '48', false)`,
        [ext, `dam-${ext}`, xOf(ext), Y, rows[0].id]
      );
    }
    await versionsService(pool).activate(c, LAYER, rows[0].id);
  });
});

afterAll(async () => {
  const pool = getPool();
  const userIds = [...ids.values()];
  // Until the prior version is active again, ours is the active version of dams: deleting it
  // then would leave the layer with none.
  let restored = priorActive === null;
  let drafts: string[] = [];
  await runStages([
    async () => {
      if (!priorActive) return;
      await restoreActive(pool, LAYER, priorActive);
      restored = true;
    },
    () => unpinLayer(pool, PIN),
    // The drafts our users opened or copied; their maps go with the users, the drafts do not.
    async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM app.dataset_versions WHERE ingested_by = ANY($1::uuid[]) AND draft_status IS NOT NULL`,
        [userIds]
      );
      drafts = rows.map((r) => r.id);
    },
    () => pool.query(`DELETE FROM workspace.maps WHERE owner_id = ANY($1::uuid[])`, [userIds]),
    async () => {
      for (const id of drafts) await tx((c) => discardDraft(c, id));
    },
    async () => {
      if (restored) await pool.query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1::uuid[])`, [created]);
    },
    async () => {
      if (!restored) return;
      for (const id of [...created].reverse()) await pool.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [id]);
    },
    // audit_log.user_id is ON DELETE SET NULL: delete the audit rows before their users.
    () => pool.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]),
    cleanupPrincipals,
    () => app.close(),
  ]);
});

describe('sharing a personal map', () => {
  it('share with a user: they see it under sharedWithMe and can read features', async () => {
    const { map, layer } = await mapWithFeature(O);
    expect(await sharedWithMe(R)).not.toContain(map.id);
    expect((await call(R, 'GET', `/maps/${map.id}`)).statusCode).toBe(404);

    const added = await share(map.id, { userId: ids.get(R)! });
    expect(added.statusCode).toBe(201);
    const s = added.json().share;
    expect(s).toMatchObject({ userId: ids.get(R), groupId: null, name: NAMES[R] });
    expect(typeof s.id).toBe('string');
    expect(Number.isNaN(Date.parse(s.createdAt))).toBe(false);

    // A duplicate returns the existing share.
    const again = await share(map.id, { userId: ids.get(R)! });
    expect(again.statusCode).toBe(200);
    expect(again.json().share.id).toBe(s.id);

    // Shares are not content: the map's revision does not move.
    expect(await revisionOf(O, map.id)).toBe(2);

    const listed = await call(O, 'GET', `/maps/${map.id}/shares`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().shares).toEqual([s]);

    expect(await sharedWithMe(R)).toContain(map.id);
    const fc = await call(R, 'GET', `/maps/${map.id}/layers/${layer.id}/features`);
    expect(fc.statusCode).toBe(200);
    expect(fc.json().features).toHaveLength(1);
    expect(fc.json().features[0].properties).toEqual({ ten: 'gốc' });

    // Unknown targets and malformed bodies are refused.
    const ghostUser = await share(map.id, { userId: randomUUID() });
    expect(ghostUser.statusCode).toBe(400);
    expect(ghostUser.json().error.code).toBe('VALIDATION_ERROR');
    const ghostGroup = await share(map.id, { groupId: randomUUID() });
    expect(ghostGroup.statusCode).toBe(400);
    const both = await call(O, 'POST', `/maps/${map.id}/shares`, { userId: ids.get(R), groupId: randomUUID() });
    expect(both.statusCode).toBe(400);
    const neither = await call(O, 'POST', `/maps/${map.id}/shares`, {});
    expect(neither.statusCode).toBe(400);
    expect((await call(O, 'GET', `/maps/${map.id}/shares`)).json().shares).toEqual([s]);
  });

  it('group share follows membership', async () => {
    const map = await createMap(O, 'Bản đồ cho nhóm');
    const groupId = await createGroup('group-G', [M]);
    const added = await share(map.id, { groupId });
    expect(added.statusCode).toBe(201);
    expect(added.json().share).toMatchObject({ userId: null, groupId, name: `${GROUP_PREFIX}group-G` });

    // A member sees the map; a non-member does not.
    expect((await call(M, 'GET', `/maps/${map.id}`)).statusCode).toBe(200);
    expect(await sharedWithMe(M)).toContain(map.id);
    expect((await call(S, 'GET', `/maps/${map.id}`)).statusCode).toBe(404);

    // Leaving the group hides the map on the very next request.
    await getPool().query(`DELETE FROM app.user_groups WHERE user_id = $1 AND group_id = $2`, [ids.get(M), groupId]);
    const left = await call(M, 'GET', `/maps/${map.id}`);
    expect(left.statusCode).toBe(404);
    expect(left.json()).toEqual(NOT_FOUND);
    expect(await sharedWithMe(M)).not.toContain(map.id);

    // Back in the group, then the share is revoked: hidden again.
    await getPool().query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(M), groupId]);
    expect((await call(M, 'GET', `/maps/${map.id}`)).statusCode).toBe(200);
    const revoked = await call(O, 'DELETE', `/maps/${map.id}/shares/${added.json().share.id}`);
    expect(revoked.statusCode).toBe(204);
    const gone = await call(M, 'GET', `/maps/${map.id}`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual(NOT_FOUND);
    expect(await revisionOf(O, map.id)).toBe(0);
  });

  it('only the owner lists, adds and removes shares', async () => {
    const map = await createMap(O, 'Chỉ chủ chia sẻ');
    const s = (await share(map.id, { userId: ids.get(R)! })).json().share;

    for (const res of [
      await call(R, 'GET', `/maps/${map.id}/shares`),
      await share(map.id, { userId: ids.get(S)! }, R),
      await call(R, 'DELETE', `/maps/${map.id}/shares/${s.id}`),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toEqual({ code: 'FORBIDDEN', message: OWNER_ONLY });
    }
    for (const res of [
      await call(S, 'GET', `/maps/${map.id}/shares`),
      await share(map.id, { userId: ids.get(S)! }, S),
      await call(S, 'DELETE', `/maps/${map.id}/shares/${s.id}`),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(NOT_FOUND);
    }
    // Nothing changed.
    expect((await call(O, 'GET', `/maps/${map.id}/shares`)).json().shares).toEqual([s]);

    // A share id of another map, or none at all, is not found on this one.
    const other = await createMap(O, 'Bản đồ khác');
    expect((await call(O, 'DELETE', `/maps/${other.id}/shares/${s.id}`)).statusCode).toBe(404);
    expect((await call(O, 'DELETE', `/maps/${map.id}/shares/${randomUUID()}`)).statusCode).toBe(404);
    expect((await call(O, 'DELETE', `/maps/${map.id}/shares/${s.id}`)).statusCode).toBe(204);
    expect((await call(O, 'GET', `/maps/${map.id}/shares`)).json().shares).toEqual([]);
  });

  it('cannot share with yourself', async () => {
    const map = await createMap(O, 'Không tự chia sẻ');
    const res = await share(map.id, { userId: ids.get(O)! });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: SELF_SHARE });
    expect((await call(O, 'GET', `/maps/${map.id}/shares`)).json().shares).toEqual([]);
  });

  it('share targets match name or email and exclude the caller', async () => {
    const targets = async (who: string, q: string) => {
      const res = await call(who, 'GET', `/share-targets?q=${encodeURIComponent(q)}`);
      expect(res.statusCode).toBe(200);
      return res.json() as { users: Array<{ id: string; name: string; email: string }>; groups: Array<{ id: string; name: string }> };
    };
    const groupId = await createGroup('targets-team', []);

    // By email, case-insensitively; the caller is not offered.
    const byEmail = await targets(O, 'P3A-SHARING-');
    expect(byEmail.users.map((u) => u.email).sort()).toEqual([M, R, S].sort());
    expect(byEmail.users.find((u) => u.email === R)).toEqual({ id: ids.get(R), name: NAMES[R], email: R });
    expect(byEmail.groups).toContainEqual({ id: groupId, name: `${GROUP_PREFIX}targets-team` });

    // By name; the person searched for does not find themselves.
    expect((await targets(O, 'qzvk')).users.map((u) => u.email)).toEqual([R]);
    expect((await targets(R, 'qzvk')).users).toEqual([]);

    // LIKE wildcards are literal.
    expect(await targets(O, '%%')).toEqual({ users: [], groups: [] });

    // At most 10 of each.
    for (let i = 0; i < 11; i++) await createGroup(`cap-${String(i).padStart(2, '0')}`, []);
    expect((await targets(O, `${GROUP_PREFIX}cap-`)).groups).toHaveLength(10);

    // q is 2 to 100 characters.
    for (const q of ['a', 'x'.repeat(101)]) {
      const res = await call(O, 'GET', `/share-targets?q=${q}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await call(O, 'GET', '/share-targets')).statusCode).toBe(400);
  });

  it('share-target search ignores diacritics: "dien" finds "Điện"', async () => {
    const targets = async (q: string) => {
      const res = await call(O, 'GET', `/share-targets?q=${encodeURIComponent(q)}`);
      expect(res.statusCode).toBe(200);
      return res.json() as { users: Array<{ id: string; name: string; email: string }>; groups: Array<{ id: string; name: string }> };
    };
    // A user of this test only: the email search in the test above counts this file's users.
    const dien = await usersRepository(getPool()).insert({
      email: email('dien'), password_hash: await hashPassword(PW), full_name: 'Lê Thị Điện Xqwy', role: 'viewer',
    });
    ids.set(email('dien'), dien.id);
    const groupId = await createGroup('Hồ Chứa Wqzj', []);
    const user = { id: dien.id, name: 'Lê Thị Điện Xqwy', email: email('dien') };
    const group = { id: groupId, name: `${GROUP_PREFIX}Hồ Chứa Wqzj` };

    // Folded on both sides: no marks, any case, đ as d.
    for (const q of ['dien xqwy', 'DIEN XQWY', 'điện xqwy', 'thi dien xq']) {
      expect((await targets(q)).users, q).toContainEqual(user);
    }
    for (const q of ['ho chua wqzj', 'HỒ CHỨA WQZJ', 'chua wqzj']) {
      expect((await targets(q)).groups, q).toEqual([group]);
    }
    // Emails are folded too, and LIKE wildcards stay literal.
    expect((await targets('SHARING-DIEN')).users).toEqual([user]);
    expect((await targets('di_n xqwy')).users).toEqual([]);

    // workspace.fold_text (migration 31) is the API's alone, as workspace.map_role is.
    for (const role of ['webatlas_assistant', 'public']) {
      const { rows } = await getPool().query<{ ok: boolean }>(
        `SELECT has_function_privilege($1, 'workspace.fold_text(text)', 'EXECUTE') AS ok`, [role]
      );
      expect(rows[0].ok, role).toBe(false);
    }
  });

  it('copy is independent and survives revocation', async () => {
    const { map, layer, feature } = await mapWithFeature(O, 'Bản đồ gốc');
    const ec = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: LAYER, expectedRevision: 2 });
    expect(ec.statusCode).toBe(201);
    const ownerLayer = ec.json().layer as { id: string; draftId: string };
    const ownerBase = `/maps/${map.id}/layers/${ownerLayer.id}`;
    // The owner edits one dam in their draft.
    const ownerRead = (await call(O, 'GET', `${ownerBase}/features?bbox=${ALL}`)).json();
    const ownerDam = ownerRead.features.find((f: { properties: { external_id: string } }) => f.properties.external_id === String(DAMS[0]));
    const edited = await call(O, 'PUT', `${ownerBase}/features/${ownerDam.id}`, { properties: { name: 'chủ sửa' }, expectedRevision: 3 });
    expect(edited.statusCode).toBe(200);
    const s = (await share(map.id, { userId: ids.get(R)! })).json().share;

    // A stranger cannot copy.
    const strangerCopy = await call(S, 'POST', `/maps/${map.id}/copy`);
    expect(strangerCopy.statusCode).toBe(404);
    expect(strangerCopy.json()).toEqual(NOT_FOUND);

    // 1. The recipient copies.
    const copied = await call(R, 'POST', `/maps/${map.id}/copy`);
    expect(copied.statusCode).toBe(201);
    const copy = copied.json().map;
    expect(copy).toMatchObject({ title: 'Bản sao của Bản đồ gốc', ownerId: ids.get(R), revision: 0, role: 'owner', layerCount: 2 });
    expect(copy.id).not.toBe(map.id);
    const [freeCopy, ecCopy] = copy.layers;
    expect(freeCopy).toMatchObject({ kind: 'free', title: 'Điểm', geometryType: 'point', fields: [{ name: 'ten', type: 'text' }], featureCount: 1 });
    expect(freeCopy.id).not.toBe(layer.id);
    expect(ecCopy).toMatchObject({ kind: 'edit_copy', layerKey: LAYER, position: 1 });
    expect(ecCopy.draftId).not.toBe(ownerLayer.draftId);

    // 4. The copy's draft is the recipient's, on the owner's draft's parent, with its edit.
    const versions = await getPool().query(
      `SELECT id, ingested_by, draft_status, revision, parent_version_id FROM app.dataset_versions WHERE id = ANY($1::uuid[])`,
      [[ownerLayer.draftId, ecCopy.draftId]]
    );
    const byId = new Map(versions.rows.map((r) => [r.id, r]));
    expect(byId.get(ecCopy.draftId)).toMatchObject({ ingested_by: ids.get(R), draft_status: 'personal', revision: 0 });
    expect(byId.get(ecCopy.draftId).parent_version_id).toBe(byId.get(ownerLayer.draftId).parent_version_id);
    const copyBase = `/maps/${copy.id}/layers/${ecCopy.id}`;
    const copyRead = (await call(R, 'GET', `${copyBase}/features?bbox=${ALL}`)).json();
    expect(copyRead.changed).toEqual([String(DAMS[0])]);
    const findDam = (fc: { features: Array<{ id: string; properties: { external_id: string; name: string } }> }, ext: number) =>
      fc.features.find((f) => f.properties.external_id === String(ext))!;
    expect(findDam(copyRead, DAMS[0]).properties.name).toBe('chủ sửa');

    // 2. The recipient edits the free feature and two dams (one the owner's draft holds, one it does not).
    const freeFeatures = (await call(R, 'GET', `/maps/${copy.id}/layers/${freeCopy.id}/features`)).json().features;
    expect(freeFeatures).toHaveLength(1);
    expect(freeFeatures[0].id).not.toBe(feature.id);
    let rev = 0;
    const putFree = await call(R, 'PUT', `/maps/${copy.id}/layers/${freeCopy.id}/features/${freeFeatures[0].id}`, {
      properties: { ten: 'bản sao' }, expectedRevision: rev,
    });
    expect(putFree.statusCode).toBe(200);
    rev = putFree.json().revision;
    for (const ext of [DAMS[0], DAMS[1]]) {
      const put = await call(R, 'PUT', `${copyBase}/features/${findDam(copyRead, ext).id}`, {
        properties: { name: `người nhận sửa ${ext}` }, expectedRevision: rev,
      });
      expect(put.statusCode).toBe(200);
      rev = put.json().revision;
    }
    expect(rev).toBe(3);

    // 3. The owner's map and draft are unchanged.
    expect(await revisionOf(O, map.id)).toBe(4);
    const ownerFree = (await call(O, 'GET', `/maps/${map.id}/layers/${layer.id}/features`)).json().features;
    expect(ownerFree.map((f: { properties: unknown }) => f.properties)).toEqual([{ ten: 'gốc' }]);
    const ownerAfter = (await call(O, 'GET', `${ownerBase}/features?bbox=${ALL}`)).json();
    expect(ownerAfter.changed).toEqual([String(DAMS[0])]);
    expect(findDam(ownerAfter, DAMS[0]).properties.name).toBe('chủ sửa');
    expect(findDam(ownerAfter, DAMS[1]).properties.name).toBe(`dam-${DAMS[1]}`);
    const ownerDraft = await getPool().query(
      `SELECT revision FROM app.dataset_versions WHERE id = $1`, [ownerLayer.draftId]
    );
    expect(ownerDraft.rows[0].revision).toBe(1);
    const ownerRows = await getPool().query(
      `SELECT external_id, name FROM water.dams WHERE dataset_version_id = $1`, [ownerLayer.draftId]
    );
    expect(ownerRows.rows).toEqual([{ external_id: DAMS[0], name: 'chủ sửa' }]);
    const copyAfter = (await call(R, 'GET', `${copyBase}/features?bbox=${ALL}`)).json();
    expect(copyAfter.changed).toEqual([String(DAMS[0]), String(DAMS[1])]);

    // 5. Revoking the share leaves the copy alone.
    expect((await call(O, 'DELETE', `/maps/${map.id}/shares/${s.id}`)).statusCode).toBe(204);
    expect((await call(R, 'GET', `/maps/${map.id}`)).statusCode).toBe(404);
    expect(await mine(R)).toContain(copy.id);
    expect(await sharedWithMe(R)).not.toContain(map.id);
    expect((await call(R, 'GET', `/maps/${copy.id}`)).json().map.layers).toHaveLength(2);
    // The copy is the recipient's alone: the owner does not see it.
    expect((await call(O, 'GET', `/maps/${copy.id}`)).statusCode).toBe(404);
  });

  it('copying keeps a layer whose draft is gone, and fits a long title', async () => {
    const title = 'Đ'.repeat(200);
    const map = await createMap(O, title);
    const ec = await call(O, 'POST', `/maps/${map.id}/layers`, { kind: 'edit_copy', layerKey: LAYER, expectedRevision: 0 });
    const draftId = ec.json().layer.draftId as string;
    await tx((c) => discardDraft(c, draftId));

    const res = await call(O, 'POST', `/maps/${map.id}/copy`);
    expect(res.statusCode).toBe(201);
    const copy = res.json().map;
    expect(copy.title).toBe(`Bản sao của ${title}`.slice(0, 200));
    expect(copy.layers).toHaveLength(1);
    expect(copy.layers[0]).toMatchObject({ kind: 'edit_copy', layerKey: LAYER, draftId: null });
    expect(await mine(O)).toEqual(expect.arrayContaining([map.id, copy.id]));
  });
});
