import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const PW = 'ag-pass-12345';
const ADMIN = 'ag-admin@webatlas.test'; // admin without groups
const HOLDER = 'ag-holder@webatlas.test'; // users.manage + feature.update on 48
const TARGET = 'ag-target@webatlas.test'; // the user whose memberships change
const PLAIN = 'ag-plain@webatlas.test'; // viewer without groups
const GROUP_PREFIX = 'ag-test-';

// Real units of admin.unit_tree: province 48 (Đà Nẵng), its wards, and province 51.
const PROVINCE = '48';
const OTHER_PROVINCE = '51';
const WARD_A = '20194';
const WARD_B = '20200';

const ids = new Map<string, string>();

// One login per user for the whole file: /api/auth/login allows 10 per minute.
const tokens = new Map<string, string>();
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  const token = res.json().token as string;
  tokens.set(email, token);
  return token;
}
const auth = async (email: string) => ({ authorization: `Bearer ${await tokenFor(email)}` });

/** Inserts a group straight into the tables, bypassing the API under test. */
async function seedGroup(name: string, units: string[], permissions: string[], members: string[] = []) {
  const pg = getPool();
  const { rows } = await pg.query(`INSERT INTO app.access_groups (name) VALUES ($1) RETURNING id`, [GROUP_PREFIX + name]);
  const groupId = rows[0].id as string;
  for (const u of units) await pg.query(`INSERT INTO app.access_group_units (group_id, unit_code) VALUES ($1, $2)`, [groupId, u]);
  for (const p of permissions) {
    await pg.query(`INSERT INTO app.access_group_permissions (group_id, permission) VALUES ($1, $2)`, [groupId, p]);
  }
  for (const m of members) await pg.query(`INSERT INTO app.user_groups (user_id, group_id) VALUES ($1, $2)`, [ids.get(m), groupId]);
  return groupId;
}

async function membershipsOf(email: string): Promise<string[]> {
  const { rows } = await getPool().query(`SELECT group_id FROM app.user_groups WHERE user_id = $1 ORDER BY group_id`, [ids.get(email)]);
  return rows.map((r: { group_id: string }) => r.group_id);
}

async function cleanup() {
  const pg = getPool();
  const { rows } = await pg.query(`SELECT id FROM app.users WHERE email LIKE 'ag-%@webatlas.test'`);
  const userIds = rows.map((r: { id: string }) => r.id);
  // Every audited write in this file is made by one of these users.
  if (userIds.length > 0) await pg.query(`DELETE FROM app.audit_log WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await pg.query(`DELETE FROM app.access_groups WHERE name LIKE $1`, [GROUP_PREFIX + '%']);
  await pg.query(`DELETE FROM app.users WHERE email LIKE 'ag-%@webatlas.test'`);
}

beforeAll(async () => {
  await app.ready();
  await cleanup();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [HOLDER, 'viewer'], [TARGET, 'viewer'], [PLAIN, 'viewer']] as const) {
    const row = await repo.insert({ email, password_hash: await hashPassword(PW), full_name: email, role });
    ids.set(email, row.id);
  }
  await seedGroup('holder', [PROVINCE], ['users.manage', 'feature.update'], [HOLDER]);
});
afterAll(async () => {
  await cleanup();
  await app.close();
});

describe('access groups CRUD', () => {
  it('admin creates a group from units and permissions', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/access-groups', headers: await auth(ADMIN),
      payload: {
        name: GROUP_PREFIX + 'create', description: 'Cán bộ hai xã',
        units: [WARD_B, WARD_A, WARD_A], permissions: ['feature.update', 'feature.create'],
      },
    });
    expect(res.statusCode).toBe(201);
    const group = res.json().group;
    expect(group).toMatchObject({
      name: GROUP_PREFIX + 'create', description: 'Cán bộ hai xã',
      units: [WARD_A, WARD_B], permissions: ['feature.create', 'feature.update'], memberCount: 0,
    });
    expect(group.id).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await getPool().query(`SELECT created_by FROM app.access_groups WHERE id = $1`, [group.id]);
    expect(rows[0].created_by).toBe(ids.get(ADMIN));

    const list = await app.inject({ method: 'GET', url: '/api/access-groups', headers: await auth(ADMIN) });
    expect(list.statusCode).toBe(200);
    expect(list.json().groups).toContainEqual(group);
  });

  it('rejects a group whose unit is not in the unit tree', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/access-groups', headers: await auth(ADMIN),
      payload: { name: GROUP_PREFIX + 'bad-unit', units: ['99999'], permissions: ['feature.update'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('99999');
    const { rows } = await getPool().query(`SELECT 1 FROM app.access_groups WHERE name = $1`, [GROUP_PREFIX + 'bad-unit']);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown permission', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/access-groups', headers: await auth(ADMIN),
      payload: { name: GROUP_PREFIX + 'bad-perm', units: [PROVINCE], permissions: ['feature.publish'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires at least one unit and one permission', async () => {
    const headers = await auth(ADMIN);
    const noUnits = await app.inject({
      method: 'POST', url: '/api/access-groups', headers,
      payload: { name: GROUP_PREFIX + 'empty', units: [], permissions: ['feature.update'] },
    });
    expect(noUnits.statusCode).toBe(400);
    const noPerms = await app.inject({
      method: 'POST', url: '/api/access-groups', headers,
      payload: { name: GROUP_PREFIX + 'empty', units: [PROVINCE], permissions: [] },
    });
    expect(noPerms.statusCode).toBe(400);
  });

  it('refuses a duplicate name with 409', async () => {
    const headers = await auth(ADMIN);
    const payload = { name: GROUP_PREFIX + 'dup', units: [PROVINCE], permissions: ['feature.update'] };
    expect((await app.inject({ method: 'POST', url: '/api/access-groups', headers, payload })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/access-groups', headers, payload })).statusCode).toBe(409);
  });

  it('admin updates only the fields given', async () => {
    const headers = await auth(ADMIN);
    const create = await app.inject({
      method: 'POST', url: '/api/access-groups', headers,
      payload: { name: GROUP_PREFIX + 'update', units: [PROVINCE], permissions: ['feature.update'] },
    });
    const id = create.json().group.id;

    const units = await app.inject({ method: 'PUT', url: `/api/access-groups/${id}`, headers, payload: { units: [WARD_A] } });
    expect(units.statusCode).toBe(200);
    expect(units.json().group).toMatchObject({ name: GROUP_PREFIX + 'update', units: [WARD_A], permissions: ['feature.update'] });

    const perms = await app.inject({
      method: 'PUT', url: `/api/access-groups/${id}`, headers,
      payload: { name: GROUP_PREFIX + 'update-2', description: 'mô tả', permissions: ['map.import'] },
    });
    expect(perms.statusCode).toBe(200);
    expect(perms.json().group).toMatchObject({
      name: GROUP_PREFIX + 'update-2', description: 'mô tả', units: [WARD_A], permissions: ['map.import'],
    });

    const badUnit = await app.inject({ method: 'PUT', url: `/api/access-groups/${id}`, headers, payload: { units: ['99999'] } });
    expect(badUnit.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'PUT', url: '/api/access-groups/00000000-0000-0000-0000-000000000000', headers, payload: { name: GROUP_PREFIX + 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('only admin writes groups; users.manage may read them', async () => {
    const holder = await auth(HOLDER);
    const write = await app.inject({
      method: 'POST', url: '/api/access-groups', headers: holder,
      payload: { name: GROUP_PREFIX + 'by-holder', units: [WARD_A], permissions: ['feature.update'] },
    });
    expect(write.statusCode).toBe(403);
    const groupId = await seedGroup('read', [WARD_A], ['feature.update'], [TARGET]);
    expect((await app.inject({ method: 'PUT', url: `/api/access-groups/${groupId}`, headers: holder, payload: { name: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/access-groups/${groupId}`, headers: holder })).statusCode).toBe(403);

    const list = await app.inject({ method: 'GET', url: '/api/access-groups', headers: holder });
    expect(list.statusCode).toBe(200);
    expect(list.json().groups.find((g: { id: string }) => g.id === groupId)).toMatchObject({ memberCount: 1 });

    const members = await app.inject({ method: 'GET', url: `/api/access-groups/${groupId}/members`, headers: holder });
    expect(members.statusCode).toBe(200);
    expect(members.json().members).toEqual([{ id: ids.get(TARGET), email: TARGET, full_name: TARGET }]);

    const plain = await auth(PLAIN);
    expect((await app.inject({ method: 'GET', url: '/api/access-groups', headers: plain })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/access-groups/${groupId}/members`, headers: plain })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/access-groups' })).statusCode).toBe(401);
  });

  it('deleting a group removes memberships', async () => {
    const headers = await auth(ADMIN);
    const create = await app.inject({
      method: 'POST', url: '/api/access-groups', headers,
      payload: { name: GROUP_PREFIX + 'cascade', units: [WARD_B], permissions: ['feature.delete'] },
    });
    const id = create.json().group.id;
    const set = await app.inject({ method: 'PUT', url: `/api/users/${ids.get(PLAIN)}/groups`, headers, payload: { groupIds: [id] } });
    expect(set.statusCode).toBe(200);
    expect(await membershipsOf(PLAIN)).toEqual([id]);

    const del = await app.inject({ method: 'DELETE', url: `/api/access-groups/${id}`, headers });
    expect(del.statusCode).toBe(204);
    expect(await membershipsOf(PLAIN)).toEqual([]);
    const { rows } = await getPool().query(`SELECT 1 FROM app.access_group_units WHERE group_id = $1`, [id]);
    expect(rows).toHaveLength(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/access-groups/${id}`, headers })).statusCode).toBe(404);
  });

  it('group changes are audited', async () => {
    const headers = await auth(ADMIN);
    const create = await app.inject({
      method: 'POST', url: '/api/access-groups', headers,
      payload: { name: GROUP_PREFIX + 'audit', units: [PROVINCE], permissions: ['feature.update'] },
    });
    const id = create.json().group.id;
    await app.inject({ method: 'PUT', url: `/api/access-groups/${id}`, headers, payload: { permissions: ['feature.create'] } });
    const set = await app.inject({ method: 'PUT', url: `/api/users/${ids.get(PLAIN)}/groups`, headers, payload: { groupIds: [id] } });
    expect(set.statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/access-groups/${id}`, headers });

    const groupAudit = await getPool().query(
      `SELECT action, user_id, before, after FROM app.audit_log
        WHERE table_name = 'app.access_groups' AND feature_id = $1 ORDER BY id`,
      [id]
    );
    expect(groupAudit.rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
    expect(groupAudit.rows.every((r) => r.user_id === ids.get(ADMIN))).toBe(true);
    expect(groupAudit.rows[1].before.permissions).toEqual(['feature.update']);
    expect(groupAudit.rows[1].after.permissions).toEqual(['feature.create']);
    expect(groupAudit.rows[2].before.name).toBe(GROUP_PREFIX + 'audit');

    const memberAudit = await getPool().query(
      `SELECT action, user_id, before, after FROM app.audit_log
        WHERE table_name = 'app.user_groups' AND feature_id = $1 ORDER BY id`,
      [ids.get(PLAIN)]
    );
    expect(memberAudit.rows.at(-1)).toMatchObject({ action: 'update', user_id: ids.get(ADMIN), before: [], after: [id] });
  });
});

describe('memberships', () => {
  it('a users.manage holder cannot escalate', async () => {
    const holder = await auth(HOLDER);
    const review = await seedGroup('esc-review', [PROVINCE], ['submission.review']);
    const other = await seedGroup('esc-51', [OTHER_PROVINCE], ['feature.update']);
    const ward = await seedGroup('esc-ward', [WARD_A], ['feature.update']);
    const url = `/api/users/${ids.get(TARGET)}/groups`;
    const before = await membershipsOf(TARGET);

    const r1 = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [...before, review] } });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().error.code).toBe('ESCALATION');
    const r2 = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [...before, other] } });
    expect(r2.statusCode).toBe(403);
    expect(r2.json().error.code).toBe('ESCALATION');
    expect(await membershipsOf(TARGET)).toEqual(before);

    const r3 = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [...before, ward] } });
    expect(r3.statusCode).toBe(200);
    expect(r3.json().groups).toContainEqual({ id: ward, name: GROUP_PREFIX + 'esc-ward' });
    expect(await membershipsOf(TARGET)).toEqual([...before, ward].sort());
  });

  it('a holder cannot pass on users.manage wider than their own or a permission they lack on a ward', async () => {
    const holder = await auth(HOLDER);
    const wider = await seedGroup('esc-vn', ['VN'], ['feature.update']);
    const mixed = await seedGroup('esc-mixed', [WARD_A, OTHER_PROVINCE], ['feature.update']);
    const lacks = await seedGroup('esc-lacks', [WARD_A], ['feature.update', 'map.import']);
    const url = `/api/users/${ids.get(PLAIN)}/groups`;
    for (const g of [wider, mixed, lacks]) {
      const res = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [g] } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ESCALATION');
    }
    const same = await seedGroup('esc-same', [PROVINCE], ['users.manage', 'feature.update']);
    expect((await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [same] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [] } })).statusCode).toBe(200);
    expect(await membershipsOf(PLAIN)).toEqual([]);
  });

  it('a users.manage holder cannot remove a membership outside their scope', async () => {
    const holder = await auth(HOLDER);
    const outside = await seedGroup('rm-51', [OTHER_PROVINCE], ['feature.update'], [TARGET]);
    const inside = await seedGroup('rm-ward', [WARD_B], ['feature.update'], [TARGET]);
    const url = `/api/users/${ids.get(TARGET)}/groups`;
    const before = await membershipsOf(TARGET);

    const all = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: [] } });
    expect(all.statusCode).toBe(403);
    expect(all.json().error.code).toBe('ESCALATION');
    expect(await membershipsOf(TARGET)).toEqual(before);

    // Removing only the in-scope group leaves the out-of-scope one as it was.
    const keep = before.filter((g) => g !== inside);
    const res = await app.inject({ method: 'PUT', url, headers: holder, payload: { groupIds: keep } });
    expect(res.statusCode).toBe(200);
    expect(await membershipsOf(TARGET)).toEqual(keep);
    expect(keep).toContain(outside);
  });

  it('admin may set any membership; unknown groups and users are refused', async () => {
    const headers = await auth(ADMIN);
    const wide = await seedGroup('admin-vn', ['VN'], ['submission.review', 'users.manage']);
    const url = `/api/users/${ids.get(PLAIN)}/groups`;
    const ok = await app.inject({ method: 'PUT', url, headers, payload: { groupIds: [wide, wide] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().groups).toEqual([{ id: wide, name: GROUP_PREFIX + 'admin-vn' }]);

    const unknownGroup = await app.inject({ method: 'PUT', url, headers, payload: { groupIds: ['00000000-0000-0000-0000-000000000000'] } });
    expect(unknownGroup.statusCode).toBe(400);
    const unknownUser = await app.inject({
      method: 'PUT', url: '/api/users/00000000-0000-0000-0000-000000000000/groups', headers, payload: { groupIds: [] },
    });
    expect(unknownUser.statusCode).toBe(404);
    const notArray = await app.inject({ method: 'PUT', url, headers, payload: { groupIds: 'x' } });
    expect(notArray.statusCode).toBe(400);

    expect((await app.inject({ method: 'PUT', url, headers, payload: { groupIds: [] } })).statusCode).toBe(200);
  });

  it('a viewer without users.manage cannot set memberships', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/users/${ids.get(TARGET)}/groups`, headers: await auth(PLAIN), payload: { groupIds: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('users API for users.manage and without editor', () => {
  it('lists users with their groups for a users.manage holder', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: await auth(HOLDER) });
    expect(res.statusCode).toBe(200);
    const holder = res.json().users.find((u: { id: string }) => u.id === ids.get(HOLDER));
    expect(holder.groups).toEqual([{ id: expect.any(String), name: GROUP_PREFIX + 'holder' }]);
    expect(holder.password_hash).toBeUndefined();
    const plain = res.json().users.find((u: { id: string }) => u.id === ids.get(PLAIN));
    expect(plain.groups).toEqual([]);
  });

  it('keeps user create, update and delete admin-only', async () => {
    const headers = await auth(HOLDER);
    const create = await app.inject({
      method: 'POST', url: '/api/users', headers, payload: { email: 'ag-new@webatlas.test', password: 'x2345678', role: 'viewer' },
    });
    expect(create.statusCode).toBe(403);
    const update = await app.inject({ method: 'PUT', url: `/api/users/${ids.get(PLAIN)}`, headers, payload: { full_name: 'x' } });
    expect(update.statusCode).toBe(403);
    const del = await app.inject({ method: 'DELETE', url: `/api/users/${ids.get(PLAIN)}`, headers });
    expect(del.statusCode).toBe(403);
  });

  it('editor is refused on create and update', async () => {
    const headers = await auth(ADMIN);
    const create = await app.inject({
      method: 'POST', url: '/api/users', headers, payload: { email: 'ag-editor@webatlas.test', password: 'x2345678', role: 'editor' },
    });
    expect(create.statusCode).toBe(400);
    const update = await app.inject({ method: 'PUT', url: `/api/users/${ids.get(PLAIN)}`, headers, payload: { role: 'editor' } });
    expect(update.statusCode).toBe(400);
    const { rows } = await getPool().query(`SELECT role FROM app.users WHERE id = $1`, [ids.get(PLAIN)]);
    expect(rows[0].role).toBe('viewer');
  });
});
