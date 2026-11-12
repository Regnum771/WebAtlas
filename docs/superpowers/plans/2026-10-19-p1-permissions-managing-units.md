# P1 — Permissions by Administrative Level and Managing Units: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat admin-only write rule with access groups (jurisdiction + permissions), give every feature of the 8 editable layers a managing unit, enforce both on every write, and add the Quản lý area with Nhóm quyền, Người dùng and Đơn vị chưa gán pages.

**Architecture:**
- **Shared rule.** A pure `can()` in `packages/shared` is the one rule both apps apply. The API loads a user's effective grants on every authenticated request and checks each object in the layer service against the managing unit of the feature's current row.
- **Database.** One migration adds the unit tree view, the managing-unit rule as a SQL function, the `managing_unit` column with its backfill, and the access-group tables.
- **Assignment on activation.** `packages/versioning`'s `activate()` assigns managing units to new rows and inherits them across re-ingests.
- **Web.** The web app gains a lazy-loaded `/quan-ly` route group.

**Tech Stack:** PostgreSQL/PostGIS (node-pg-migrate `.cjs`), Fastify + zod, vitest, React + TanStack Query + react-router, OpenLayers (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md`, section 1 and the P1 row of section 7.

## Global Constraints

- Three levels only: `VN` (Bộ) → tỉnh (2-digit code, `admin.provinces`) → xã (5-digit code, `admin.wards`). Unit code regex: `^(VN|\d{2}|\d{5})$`.
- **Permissions, exact strings:** `feature.create`, `feature.update`, `feature.delete`, `map.import`, `submission.review`, `users.manage`.
- **Templates, exact names and contents:** `Cán bộ cấp Bộ`, `Cán bộ cấp tỉnh`, `Cán bộ cấp xã`. Each holds `feature.create`, `feature.update`, `feature.delete`, `map.import`. None holds `submission.review`. Templates are interface presets, not groups.
- **Admin.** The `admin` role sees and does everything without belonging to any group. Only admin creates, edits and deletes groups.
- **The `editor` role is retired.** Existing `editor` users become `viewer`. The value is no longer accepted by the API or offered by the web.
- **Managing unit is versioned and never recomputed from geometry after it is set.** Re-ingest keeps an existing `external_id`'s unit.
- **Initial-assignment rule.** This plan's clarification of spec U6, needed because `admin.wards` covers only the working region:
  - province count ≠ 1 → `VN`;
  - exactly one province and exactly one ward → that ward;
  - otherwise → that province.
  - A NULL geometry has empty arrays, so → `VN`.
- **Direct publish until P4.** This plan's ruling, and an application of U16's "Xuất bản ngay". Until submissions exist, every write still publishes immediately. A write therefore requires `feature.<op>` **and** `submission.review` on the managing unit. P4 relaxes `feature.<op>` alone to "creates a draft".
- **Refusal copy (exact):** `Đối tượng thuộc {unitName}; nhóm của anh/chị chỉ có quyền trong {allowedNames}.` For no grant at all: `Anh/chị chưa có quyền {permissionLabel} ở đơn vị nào.`
- **`users.manage` never escalates.** A holder may add a user only to a group whose units all lie within the holder's jurisdiction for `users.manage` and whose permissions are a subset of the holder's own.
- UI text in Vietnamese; code comments in English; commit messages in Vietnamese Conventional Commits.
- After editing `packages/shared/src/*`, rebuild shared and commit `dist`. New files need `git add -f packages/shared/dist/<file>.js packages/shared/dist/<file>.d.ts`, because `.gitignore` has a blanket `dist` rule.
- `npm run build:web` must pass before any task touching `apps/web` is called done (vitest skips type checking).

## Review Focus

1. **The managing unit changed between page load and save.** A user loads a dam managed by their xã. Someone at the tỉnh moves it to another xã. The user saves. The check must use the feature's *current* row (`resolveEditSource`), not the row id in the request, and must refuse. → Task 6, test `refuses when the current row's managing unit moved out of jurisdiction`.
2. **A user removed from a group while signed in.** The JWT stays valid, but the next write must be refused, because grants are loaded per request and never cached in the token. → Task 4, test `drops a revoked grant on the next request`.
3. **Creating a dam without geometry** (`dams.geomNullable`). The suggestion is `VN`. A xã officer who passes their own ward explicitly may create it; omitting the unit must not silently produce `VN` and then refuse with a confusing message. → Task 6, test `create without geometry and without managing_unit asks for a unit`.
4. **Re-ingest after a manual reassignment.** A ward-assigned dam reassigned by hand to its tỉnh must still be the tỉnh after `atlas:build` re-ingests dams. → Task 3, test `inherits the managing unit of the current row with the same external_id`.
5. **Unknown or stale unit codes.** A group saved with `99999`, or a ward code that a boundary reload removed. Group save must reject unknown codes. `can()` must return false for a unit the tree does not know, never throw or match by prefix. → Task 1 test `unknown unit never matches`, and Task 5 test `rejects a group whose unit is not in the unit tree`.

---

### Task 1: Shared access model and `can()`

**Files:**
- Create: `packages/shared/src/access.ts`
- Create: `packages/shared/src/access.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './access.js';`)
- Modify: `packages/shared/src/layer-attributes.ts` (add `managing_unit: 'managingAuthority'` to every layer's `attributes`)

**Interfaces:**
- Produces:
  - `PERMISSIONS` — the six strings above, `as const`.
  - `type Permission = (typeof PERMISSIONS)[number]`
  - `PERMISSION_LABELS: Record<Permission, string>`, with exactly these values:
    - `feature.create` → `'thêm đối tượng'`
    - `feature.update` → `'sửa đối tượng'`
    - `feature.delete` → `'xoá đối tượng'`
    - `map.import` → `'nhập bản đồ'`
    - `submission.review` → `'duyệt và xuất bản'`
    - `users.manage` → `'quản lý người dùng'`
  - `interface Grant { permission: Permission; unit: string }`
  - `interface UnitNode { code: string; level: 'country' | 'province' | 'ward'; parent: string | null; name: string }`
  - `type UnitTree = ReadonlyMap<string, UnitNode>`
  - `buildUnitTree(nodes: UnitNode[]): UnitTree`
  - `ancestorsOf(tree: UnitTree, code: string): string[]` — self first, then up to `VN`; `[]` for an unknown code.
  - `can(grants: readonly Grant[], permission: Permission, unit: string, tree: UnitTree): boolean`
  - `unitsFor(grants: readonly Grant[], permission: Permission): string[]` — distinct, sorted.
  - `isWithin(unit: string, scopeUnits: readonly string[], tree: UnitTree): boolean`
  - `GROUP_TEMPLATES: ReadonlyArray<{ id: 'bo' | 'tinh' | 'xa'; name: string; level: UnitNode['level']; permissions: Permission[] }>`
  - `UNIT_CODE_RE = /^(VN|\d{2}|\d{5})$/`
  - `COUNTRY_UNIT = 'VN'`

- [ ] **Step 1: Write the failing tests** in `access.test.ts`. The fixture tree is VN → `48` (Đà Nẵng) → `20194`, `20200`; VN → `51` → `21000`.
  - `can grants a ward inside a province grant`: `can([{permission:'feature.update',unit:'48'}],'feature.update','20194',tree)` → `true`.
  - `can refuses a sibling province`: the same grant against `'21000'` → `false`.
  - `can refuses another permission`: a `feature.update` grant asked for `feature.delete` → `false`.
  - `VN covers everything`: a grant on `'VN'` → `true` for `'48'`, `'20194'`, `'VN'`.
  - `a ward grant does not cover its province`: a grant on `'20194'` asked for `'48'` → `false`.
  - `unknown unit never matches`: a grant on `'VN'` asked for `'99999'` → `false`, and `ancestorsOf(tree,'99999')` → `[]`.
  - `grants from several groups unite`: `[{feature.update,'20194'},{feature.update,'51'}]` → `true` for `'21000'` and `'20194'`, `false` for `'20200'`.
  - `isWithin`: `isWithin('20194',['48'],tree)` → `true`; `isWithin('48',['20194'],tree)` → `false`.
  - `templates match the spec`: three templates with the exact names; every template's permissions equal `['feature.create','feature.update','feature.delete','map.import']`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/shared -- access`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `access.ts`.** `can` = some grant with that permission whose unit is in `ancestorsOf(tree, unit)`. `ancestorsOf` walks `parent` with a visited set, so a malformed tree cannot loop.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm run test -w @webatlas/shared`. Expected: all pass. `layer-attributes.test` still covers every key.
- [ ] **Step 5: Build and commit.** Run `npm run build:shared`, then:
  ```bash
  git add packages/shared/src/access.ts packages/shared/src/access.test.ts packages/shared/src/index.ts packages/shared/src/layer-attributes.ts packages/shared/dist
  git add -f packages/shared/dist/access.js packages/shared/dist/access.d.ts
  git commit -m "feat(shared): mô hình phân quyền theo cấp hành chính và hàm can()"
  ```

### Task 2: Migration — unit tree, managing unit, access groups, retire `editor`

**Files:**
- Create: `apps/api/src/db/migrations/1000000000025_access-groups-managing-unit.cjs`
- Create: `apps/api/src/db/managingUnit.test.ts`

**Interfaces:**
- Produces, in SQL:
  - `admin.unit_tree (code text, level text, parent text, name text)`, a view: one `VN` row (`name = 'Toàn quốc'`, `parent NULL`), then `admin.provinces` with parent `VN`, then `admin.wards` with parent `province_code`. `GRANT SELECT` to `webatlas_assistant`.
  - `admin.managing_unit_for(province_codes text[], ward_codes text[]) RETURNS text`, `IMMUTABLE`, implementing the Global Constraints rule.
  - `water.<layer>.managing_unit text` on all 8 layers. Nullable, because ingest rows get it at activation (Task 3). It has `CHECK (managing_unit IS NULL OR managing_unit ~ '^(VN|[0-9]{2}|[0-9]{5})$')`, and a partial index `<layer>_current_managing_unit_idx ON (managing_unit) WHERE is_current`.
  - The backfill sets every row: `managing_unit = admin.managing_unit_for(province_codes, ward_codes)`.
  - `water.<layer>_active` is re-created with the column appended, using migration 22's pattern (column list read from `information_schema`, plus `managing_unit`). `water.rivers_detail` is re-created as `SELECT * FROM water.rivers_active WHERE feature_level = 3`. `CREATE OR REPLACE` keeps the existing grants.
  - `app.access_groups (id uuid pk default gen_random_uuid(), name text not null unique, description text, created_by uuid references app.users on delete set null, created_at, updated_at)`
  - `app.access_group_units (group_id uuid references app.access_groups on delete cascade, unit_code text not null, primary key (group_id, unit_code))`
  - `app.access_group_permissions (group_id uuid references app.access_groups on delete cascade, permission text not null check (permission in (<the six>)), primary key (group_id, permission))`
  - `app.user_groups (user_id uuid references app.users on delete cascade, group_id uuid references app.access_groups on delete cascade, primary key (user_id, group_id))`
  - `UPDATE app.users SET role = 'viewer' WHERE role = 'editor'`, then `ALTER TABLE app.users ADD CONSTRAINT users_role_not_editor CHECK (role <> 'editor')`. The enum value stays; Postgres cannot drop one cleanly.
- `down()` drops the tables and the constraint, drops `managing_unit` after restoring the views without it (explicit column list, as in migration 22's `down`), and drops the function and the view.

- [ ] **Step 1: Write the failing tests** in `managingUnit.test.ts` (live DB, same style as `db/currentFlag.test.ts`):
  - `the rule picks the smallest containing unit`: `SELECT admin.managing_unit_for(...)` gives
    - `('{48}','{20194}')` → `'20194'`
    - `('{48}','{20194,20200}')` → `'48'`
    - `('{48,51}','{20194}')` → `'VN'`
    - `('{}','{}')` → `'VN'`
    - `('{48}','{}')` → `'48'`
  - `no current row lacks a managing unit`: for each of the 8 layers, `count(*) FROM water.<layer> WHERE is_current AND managing_unit IS NULL` = 0.
  - `the active views and rivers_detail expose managing_unit`: `SELECT managing_unit FROM water.dams_active LIMIT 1` and `… FROM water.rivers_detail LIMIT 1` succeed.
  - `the assistant role reads managing_unit through the views but not the group tables`: `SET ROLE webatlas_assistant`; selecting `managing_unit` from `water.lakes_active` succeeds; selecting from `app.access_groups` fails with permission denied.
  - `unit_tree has one VN root and parents that exist`: exactly one row with `parent IS NULL` and `code = 'VN'`; no row whose `parent` is missing from the view.
  - `editor is gone`: `count(*) FROM app.users WHERE role = 'editor'` = 0; inserting a user with role `editor` fails on `users_role_not_editor`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- managingUnit`. Expected: FAIL (function `admin.managing_unit_for` does not exist).
- [ ] **Step 3: Write the migration.** Run `npm run migrate:up -w @webatlas/api`.
- [ ] **Step 4: Run** the test again. Expected: PASS. Then run the whole API suite: `npm run test -w @webatlas/api`. Expected: green, except the tests that still assert the `editor` role. Those are fixed in Task 5; list them in the task report.
- [ ] **Step 5: Reset GeoServer's schema cache** so WFS serves `managing_unit`:
  ```bash
  curl -u "$GEOSERVER_ADMIN_USER:$GEOSERVER_ADMIN_PASSWORD" -X POST "$GEOSERVER_URL/rest/reset"   # values from apps/api/.env
  ```
  Then `curl "http://localhost:8080/geoserver/webatlas/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=webatlas:dams"` must list `managing_unit`.
- [ ] **Step 6: Commit** `feat(api): đơn vị chủ quản cho 8 lớp, cây đơn vị và bảng nhóm quyền`.

### Task 3: Versioning assigns and inherits managing units on activation

**Files:**
- Create: `packages/versioning/src/managingUnit.ts`
- Create: `packages/versioning/src/managingUnit.test.ts`
- Modify: `packages/versioning/src/service.ts` (`activate()`: call after `stampAdminCodes`, before the pointer moves)
- Modify: `packages/versioning/src/index.ts` (export)
- Modify: `apps/api/src/modules/layers/repository.ts` (`tombstoneInVersion` copies `managing_unit` into the tombstone row)

**Interfaces:**
- Consumes: `admin.managing_unit_for` (Task 2).
- Produces: `stampManagingUnits(client: PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<{ inherited: number; assigned: number }>`.
  - For rows of `versionId` with `managing_unit IS NULL AND NOT deleted`, first set it from the row of the same `external_id` that is `is_current` (the still-active previous state, since this runs before `refreshCurrentRows`).
  - Then set the remaining NULLs with `admin.managing_unit_for(province_codes, ward_codes)`.
  - Rows that already have a value are never touched.
  - Uses the same allowlist guard as `stampAdminCodes`.

- [ ] **Step 1: Write the failing tests** in `managingUnit.test.ts`, using the versioning package's own test pool and synthetic versions on `dams`, cleaned up like `adminStamp.test.ts`:
  - `assigns the rule to a new external_id`: an ingest version holding one dam inside ward `20194`, activated → that row's `managing_unit` = `'20194'`.
  - `inherits the managing unit of the current row with the same external_id`: activate v1 (the dam gets `'20194'`); set it to `'48'` by hand on the current row; ingest v2 with the same `external_id` and `managing_unit` NULL; activate v2 → the v2 row is `'48'`.
  - `never overwrites a set value`: a draft row with `managing_unit = '51'` keeps `'51'` after activation.
  - `returns counts`: `{ inherited: 1, assigned: 0 }` in the inheritance case.
- [ ] **Step 2: Run** `npm run test -w @webatlas/versioning -- managingUnit`. Expected: FAIL.
- [ ] **Step 3: Implement `stampManagingUnits` and call it from `activate()`.** Run it only for `EDITABLE_LAYER_KEYS`, in the same block as `stampAdminCodes`.
- [ ] **Step 4: Run** `npm run test -w @webatlas/versioning` and `npm run test -w @webatlas/atlas-data`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(versioning): gán và giữ đơn vị chủ quản khi kích hoạt phiên bản`.

### Task 4: API authorization core — grants per request, unit tree, `assertCan`

**Files:**
- Create: `apps/api/src/authz/grants.ts`
- Create: `apps/api/src/authz/unitTree.ts`
- Create: `apps/api/src/authz/assert.ts`
- Create: `apps/api/src/authz/authz.test.ts`
- Modify: `apps/api/src/types/fastify.d.ts`. `CurrentUser` becomes `{ id; email; role: 'admin' | 'viewer'; isAdmin: boolean; grants: Grant[] }`.
- Modify: `apps/api/src/plugins/authentication.ts` (load grants after `findById`)
- Modify: `apps/api/src/modules/users/repository.ts` (`Role = 'admin' | 'viewer'`)
- Modify: `apps/api/src/modules/auth/service.ts` and `controller.ts`. Login and `/me` return `user.grants` and `user.isAdmin`.
- Modify: `apps/api/src/errors/index.ts`. `ForbiddenError` takes an optional `code` and `details`; the default `code` stays `'FORBIDDEN'`.
- Delete: `apps/api/src/hooks/capabilities.ts` and its test. Its sets are replaced by `requirePermission`.

**Interfaces:**
- Consumes: `Grant`, `Permission`, `UnitTree`, `can`, `unitsFor`, `PERMISSION_LABELS` (Task 1); `admin.unit_tree`, `app.user_groups` and the other group tables (Task 2).
- Produces:
  - `loadGrants(pg: Pool, userId: string): Promise<Grant[]>` — one query joining `user_groups`, `access_group_permissions` and `access_group_units`; distinct.
  - `getUnitTree(pg: Pool): Promise<UnitTree>` — process cache with a 10-minute TTL, plus `invalidateUnitTree(): void`.
  - `requirePermission(...perms: Permission[])` — a preHandler: 401 without a user; passes for admin; passes when the user holds any of the given permissions on any unit; otherwise `ForbiddenError` with code `'NO_PERMISSION'` and the "chưa có quyền" message.
  - `requireAdmin()` — a preHandler.
  - `assertCan(user: CurrentUser, permission: Permission, unit: string, tree: UnitTree): void` — no-op for admin; otherwise throws `ForbiddenError` with code `'OUT_OF_JURISDICTION'`, the exact refusal message (unit names from the tree; allowed names joined with `', '`), and `details: { unit, permission, allowed: string[] }`.

- [ ] **Step 1: Write the failing tests** in `authz.test.ts` (live DB; create two users and a group via SQL):
  - `loads the union of grants across groups`.
  - `drops a revoked grant on the next request`: a user in group G (`feature.update` on `48`) calls `GET /api/auth/me` → grants include it; delete the `user_groups` row; call `/me` again with the same token → grants are empty.
  - `admin passes requirePermission with no groups`.
  - `assertCan message names both units`: a grant on `20194` asked for `20200` throws with code `'OUT_OF_JURISDICTION'` and a message equal to the template with both ward names filled from `admin.unit_tree`.
  - `login returns grants and isAdmin`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- authz`. Expected: FAIL.
- [ ] **Step 3: Implement.** Grants are never put in the JWT. Replace every use of `CAN_READ_FEATURES`:
  - layers `GET` features → `app.authenticate` only;
  - assistant → `app.authenticate` only.

  `CAN_MANAGE_USERS` is replaced in Task 5, and `CAN_WRITE_FEATURES` in Task 6.
- [ ] **Step 4: Run** `npm run test -w @webatlas/api -- authz auth`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): nạp quyền theo nhóm cho mỗi yêu cầu, kiểm tra phạm vi theo cây đơn vị`.

### Task 5: Access-groups API and memberships; users API without `editor`

**Files:**
- Create: `apps/api/src/modules/access-groups/{repository,service,controller,routes,schemas}.ts`
- Create: `apps/api/src/modules/access-groups/accessGroups.test.ts`
- Modify: `apps/api/src/modules/users/{routes,schemas,service,controller}.ts`
- Modify: `apps/api/src/server.ts` (register `/api/access-groups`)
- Modify: `apps/api/src/modules/users/users.test.ts` and any test still using `editor`

**Interfaces:**
- Consumes: `requireAdmin`, `requirePermission`, `getUnitTree`, `isWithin`, `unitsFor` (Tasks 1 and 4); `auditService`.
- Produces, as HTTP:
  - `GET /api/access-groups` (admin or `users.manage`) → `{ groups: Array<{ id, name, description, units: string[], permissions: Permission[], memberCount: number }> }`.
  - `POST /api/access-groups` (admin) — body `{ name, description?, units: string[] (min 1), permissions: Permission[] (min 1) }` → 201 `{ group }`.
  - `PUT /api/access-groups/:id` (admin) — same body, all fields optional.
  - `DELETE /api/access-groups/:id` (admin) → 204.
  - `GET /api/access-groups/:id/members` (admin or `users.manage`) → `{ members: Array<{ id, email, full_name }> }`.
  - `PUT /api/users/:id/groups` (admin or `users.manage`) — body `{ groupIds: string[] }`. Replaces the user's memberships. For a non-admin, every group added *or removed* must pass the no-escalation rule; a failure gives 403 `'ESCALATION'`.
  - `GET /api/users` — now also returns `groups: Array<{ id, name }>` per user, and is open to `users.manage`.
  - `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id` stay admin-only. The `role` enum becomes `['admin','viewer']`.
- Every create, update, delete and membership change writes `app.audit_log`, with `tableName` set to `'app.access_groups'` or `'app.user_groups'`.

- [ ] **Step 1: Write the failing tests** in `accessGroups.test.ts`:
  - `admin creates a group from units and permissions`.
  - `rejects a group whose unit is not in the unit tree`: units `['99999']` → 400 naming the code.
  - `rejects an unknown permission`: 400.
  - `a users.manage holder cannot escalate`: holder H has `users.manage` + `feature.update` on `48`. H adding user U to a group with `submission.review` on `48` → 403 `'ESCALATION'`. To a group on `51` → 403. To a group with `feature.update` on `20194` → 200.
  - `a users.manage holder cannot remove a membership outside their scope`.
  - `deleting a group removes memberships` (cascade).
  - `editor is refused on create and update`: 400.
  - `group changes are audited`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- accessGroups users`. Expected: FAIL.
- [ ] **Step 3: Implement.** Validate units against `getUnitTree`. A non-admin's `PUT /users/:id/groups` checks, for each changed group: every unit `isWithin(unit, unitsFor(holder.grants,'users.manage'), tree)`, and every permission `p` satisfies `can(holder.grants, p, unit, tree)` for each of the group's units.
- [ ] **Step 4: Run** `npm run test -w @webatlas/api`. Expected: all green.
- [ ] **Step 5: Commit** `feat(api): nhóm quyền và thành viên nhóm; bỏ vai trò editor`.

### Task 6: Feature writes enforce jurisdiction and managing unit

**Files:**
- Modify: `apps/api/src/layers/registry.ts`. Every layer's `ATTRS` gains `managing_unit: z.string().regex(UNIT_CODE_RE, 'Mã đơn vị không hợp lệ').optional()`.
- Modify: `apps/api/src/modules/layers/service.ts` (object checks in `create`, `update`, `remove`)
- Modify: `apps/api/src/modules/layers/routes.ts`. Writes use `requirePermission('feature.create')`, `requirePermission('feature.update')` and `requirePermission('feature.delete')` respectively.
- Modify: `apps/api/src/modules/layers/controller.ts` (pass `req.currentUser` and the tree into the service)
- Create: `apps/api/src/modules/layers/jurisdiction.test.ts`
- Modify: `apps/api/src/modules/admin-units/{routes,controller,repository}.ts`. Adds `POST /api/admin-units/suggest` (body `{ geometry }` → `{ unit: string }`, computed in SQL with `admin.managing_unit_for` over the arrays intersecting the geometry), and `GET /api/admin-units/tree` (→ `{ units: UnitNode[] }`; public, like `/admin-units`).

**Interfaces:**
- Consumes: `assertCan`, `getUnitTree`, `CurrentUser` (Task 4); `managing_unit` (Task 2).
- Produces: `featuresService(pg).create|update|remove(key, …, actor: CurrentUser, tree: UnitTree)`. The old `actorId?: string` parameter becomes `actor`; the edit session still receives `actor.id`.
- **Rules**, each needing the op permission *and* `submission.review` (Global Constraints, direct publish):
  - **create:** `properties.managing_unit` is required whenever it cannot be suggested. If omitted and a geometry is present, it is set to the suggestion. If omitted and there is no geometry → 400 with field error `managing_unit: 'Chọn đơn vị chủ quản'`. Then `assertCan` on that unit.
  - **update:** `assertCan` on the managing unit of the row `resolveEditSource` returns. If `managing_unit` is in the body and differs, `assertCan` on the new unit too.
  - **delete:** `assertCan` on the current row's managing unit.
  - All checks run inside the session, before any write.
  - **Warning, not refusal:** when the saved geometry does not intersect its managing unit at all (the unit's geometry from `admin.provinces` or `admin.wards`; `VN` never warns), the response carries `warnings: [{ code: 'OUTSIDE_MANAGING_UNIT', message: 'Đối tượng không còn nằm trong {unitName}. Kiểm tra lại đơn vị chủ quản.' }]`. The managing unit is not changed. `create` and `update` return `{ feature, warnings }`.

- [ ] **Step 1: Write the failing tests** in `jurisdiction.test.ts`. Users: P (`feature.*` + `submission.review` on `48`); X (the same on ward `20194`); E (`feature.update` on `48` without review); admin A.
  - `a province officer edits a ward feature inside the province`: P updates a dam whose managing unit is `20194` → 200.
  - `is refused in another province`: P updates a dam managed by `51` → 403 `'OUT_OF_JURISDICTION'`, with the exact message.
  - `a ward officer cannot edit the province's feature`: X updates a dam managed by `48` → 403.
  - `moving a managing unit out of jurisdiction is refused`: X sets `managing_unit: '48'` on a `20194` dam → 403. P sets `'20200'` on the same dam → 200.
  - `refuses when the current row's managing unit moved out of jurisdiction`: X loads dam D (`20194`, row id r1); P moves D to `20200` (new current row r2); X sends `PUT …/features/r1` → 403.
  - `edit without review right is refused until P4`: E updates a `48` dam → 403 `'NO_PERMISSION'` or `'OUT_OF_JURISDICTION'` for `submission.review`.
  - `create without geometry and without managing_unit asks for a unit`: P creates a dam with no geometry and no unit → 400 with field error `managing_unit`.
  - `create suggests the containing ward`: P creates a dam at a point inside `20194` with no unit → 201, `properties.managing_unit === '20194'`.
  - `admin edits anywhere`.
  - `moving a dam out of its managing unit warns and keeps the unit`: P moves a `20194` dam to a point in `20200` → 200, `warnings[0].code === 'OUTSIDE_MANAGING_UNIT'`, and `managing_unit` is still `'20194'`.
  - `the suggest endpoint applies the rule`: `POST /api/admin-units/suggest` with a point in `20194` → `{ unit: '20194' }`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- jurisdiction`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `singleChange`'s retry: its `apply` must only act through the session, and the check reads through the session client.
- [ ] **Step 4: Run** `npm run test -w @webatlas/api`. Expected: all green. `layers.test.ts`'s former `editor` cases now assert the new 403 codes.
- [ ] **Step 5: Commit** `feat(api): kiểm tra phạm vi và đơn vị chủ quản khi thêm, sửa, xoá đối tượng`.

### Task 7: Unassigned-features endpoint

**Files:**
- Modify: `apps/api/src/modules/layers/{routes,controller,repository}.ts`
- Test: `apps/api/src/modules/layers/unassigned.test.ts`

**Interfaces:**
- Produces: `GET /api/layers/unassigned` → `{ features: Array<{ layerKey, id, externalId, name }> }`. Lists current rows with `managing_unit = 'VN'` and NULL geometry, across the 8 layers. Open to admin, or to anyone holding `feature.update` on `VN`.

- [ ] **Step 1: Write the failing tests:**
  - `lists the dams without geometry`: the count equals `SELECT count(*) FROM water.dams_active WHERE geom IS NULL AND managing_unit = 'VN'`.
  - `refuses a province officer`: 403.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- unassigned`. Expected: FAIL.
- [ ] **Step 3: Implement** one `UNION ALL` over the registry's tables (`rivers` reads `rivers_detail`).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): danh sách đối tượng chưa gán đơn vị chủ quản`.

### Task 8: Web session carries grants; permission gates replace role gates

**Files:**
- Modify: `apps/web/src/entities/session/model/session.types.ts`. `CurrentUser` gains `isAdmin: boolean; grants: Grant[]`; `Role = 'admin' | 'viewer'`.
- Create: `apps/web/src/entities/session/model/useUnitTree.ts` — TanStack Query on `GET /api/admin-units/tree`, `staleTime: Infinity`, returns `UnitTree | null`.
- Create: `apps/web/src/entities/session/model/useCan.ts` — `useCan(): (permission: Permission, unit?: string) => boolean`. Without `unit`, it answers "anywhere". Admin → always true.
- Create: `apps/web/src/features/auth/ui/RequirePermission.tsx` — `{ permission: Permission | Permission[]; mode?: 'any' | 'all'; fallback?; children }`. Admin passes.
- Modify: `apps/web/src/app/MapScreen.tsx`. Biên tập is shown when `useCan()('feature.update') && useCan()('submission.review')`, or for admin. The `isAdmin` effect becomes this condition.
- Modify: `apps/web/src/features/feature-editing/index.tsx` and `ProposedEdit.tsx`: `RequireRole role="admin"` → `RequirePermission permission={['feature.update','submission.review']} mode="all"`.
- Modify: `apps/web/src/entities/persona/persona.ts` (drop the `editor` branch)
- Modify: `apps/web/src/features/user-management/ui/UserFormModal.view.tsx` and `UserTable.view.tsx` (`ROLE_LABELS` without `editor`)
- Tests: `useCan.test.ts`, `RequirePermission.test.tsx`; update `MapScreen.test.tsx` and `persona` tests.

**Interfaces:**
- Consumes: `can`, `Grant`, `Permission`, `UnitTree`, `buildUnitTree` (Task 1); `/api/auth/me` and login payloads (Task 4); `/api/admin-units/tree` (Task 6).
- Produces: `useCan`, `useUnitTree`, `RequirePermission`. These are used by Tasks 9–12.

- [ ] **Step 1: Write the failing tests:**
  - `useCan answers anywhere and per unit`: grants `[{feature.update,'48'}]` → `can('feature.update')` true; `can('feature.update','20194')` true once the tree has loaded; `can('feature.update','51')` false; `can('feature.delete')` false.
  - `useCan is false per unit while the tree loads`: per-unit asks return false until the query resolves; "anywhere" asks work without the tree.
  - `RequirePermission mode all needs both`.
  - `Biên tập shows for a province officer with review right and hides without it` (MapScreen).
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- useCan RequirePermission MapScreen persona`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `RequireRole` once nothing imports it.
- [ ] **Step 4: Run** `npm run test -w @webatlas/web` and `npm run build:web`. Expected: green.
- [ ] **Step 5: Commit** `feat(web): phiên đăng nhập mang quyền theo nhóm; cổng theo quyền thay cho vai trò`.

### Task 9: The Quản lý area shell

**Files:**
- Create: `apps/web/src/pages/quan-ly/index.tsx` — `QuanLyRoute`, lazy-loaded. A sub-nav with three items:
  - `Nhóm quyền` → `/quan-ly/nhom-quyen`, admin only;
  - `Người dùng` → `/quan-ly/nguoi-dung`, admin or `users.manage`;
  - `Đơn vị chưa gán` → `/quan-ly/chua-gan`, admin or `feature.update` on `VN`.

  It renders a nested `<Outlet />`. The index route redirects to the first visible item. A user with none of the three is redirected to `/`.
- Modify: `apps/web/src/app/App.tsx`:
  - `const QuanLyRoute = lazy(() => import('../pages/quan-ly'))`, inside `<Suspense>`;
  - nested routes `nhom-quyen`, `nguoi-dung`, `chua-gan`;
  - `/admin/users` → `<Navigate to="/quan-ly/nguoi-dung" replace />`.
- Modify: `apps/web/src/widgets/top-bar/model/nav.ts`. `NavItem.visibleTo` is replaced by `visibleWhen?: (user: CurrentUser | null) => boolean`. Add `{ to: '/quan-ly', label: 'Quản lý', visibleWhen: canSeeQuanLy }`.
- Modify: `apps/web/src/widgets/top-bar/index.tsx` and `ui/AccountMenu.view.tsx`. The account menu's `Người dùng` link points to `/quan-ly/nguoi-dung`, under the same condition as that sub-nav item.
- Create: `apps/web/src/pages/quan-ly/model/visibility.ts` — `canSeeQuanLy(user, can)`, plus one predicate per item.
- Tests: `apps/web/src/pages/quan-ly/index.test.tsx`; update `nav.test.ts`, `App.routing.test.tsx` and `AccountMenu.view.test.tsx`.

**Interfaces:**
- Consumes: `useCan`, `RequirePermission` (Task 8).
- Produces: the route paths above, and an outlet slot that Tasks 10–12 fill. The map stays mounted, since `MapScreen` is still a sibling of `<Routes>`.

- [ ] **Step 1: Write the failing tests:**
  - `Quản lý is hidden from a reader and shown to admin`.
  - `a users.manage holder sees only Người dùng`.
  - `/admin/users redirects to /quan-ly/nguoi-dung`.
  - `the Quản lý chunk is not in the main bundle`: assert that `App.tsx` imports `pages/quan-ly` only through `lazy` (a source-text test, like the existing English-string test).
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- quan-ly nav App.routing AccountMenu`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pages use the existing shared view components (buttons, fields, messages, dialogs) and tokens from redesign sub-project 1.
- [ ] **Step 4: Run** `npm run test -w @webatlas/web` and `npm run build:web`. Expected: green; the Vite output lists a separate `quan-ly` chunk.
- [ ] **Step 5: Commit** `feat(web): khu Quản lý tải riêng, điều hướng theo quyền`.

### Task 10: Nhóm quyền page

**Files:**
- Create: `apps/web/src/features/access-groups/api/accessGroups.api.ts` (+ test)
- Create: `apps/web/src/features/access-groups/model/useGroupsPresenter.ts` (+ test)
- Create: `apps/web/src/features/access-groups/model/useUnitPicker.ts` (+ test)
- Create: `apps/web/src/features/access-groups/ui/GroupList.view.tsx`, `GroupForm.view.tsx`, `UnitPicker.view.tsx` (+ view tests)
- Create: `apps/web/src/features/access-groups/index.tsx`
- Modify: `apps/web/src/pages/quan-ly/index.tsx` (route `nhom-quyen` renders it)

**Interfaces:**
- Consumes: the Task 5 HTTP API; `GROUP_TEMPLATES`, `PERMISSIONS`, `PERMISSION_LABELS` (Task 1); `useUnitTree` (Task 8).
- Produces:
  - `useUnitPicker(tree, selected: string[])` → `{ query, setQuery, rows: Array<UnitNode & { depth, selected, coveredByAncestor }>, toggle(code) }`. Selecting a unit whose ancestor is already selected is a no-op, and its row shows `Đã gồm trong {ancestorName}`.
  - **The form flow:** *Tạo nhóm* → choose `Từ mẫu` (one of the three templates) or `Trống` → pick units → tick permissions → name and description → *Lưu*.
- **States** (redesign D15):
  - loading;
  - empty: `Chưa có nhóm nào.`, with a create button;
  - save error: server field errors shown on their fields;
  - delete confirm: `Xoá nhóm {name}? {n} người sẽ mất các quyền của nhóm này.`

- [ ] **Step 1: Write the failing tests:**
  - `choosing the tỉnh template ticks the four permissions and limits the picker to provinces first`.
  - `selecting Đà Nẵng then one of its xã keeps one unit`.
  - `search finds a xã by name without diacritics` (`dien hong` matches `Điện Hồng`).
  - `an unknown-unit 400 lands on the units field`.
  - `delete asks with the member count`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- access-groups`. Expected: FAIL.
- [ ] **Step 3: Implement** with the presenter/view split used across `apps/web/src/features`.
- [ ] **Step 4: Run** `npm run test -w @webatlas/web` and `npm run build:web`. Expected: green.
- [ ] **Step 5: Commit** `feat(web): trang Nhóm quyền — tạo từ mẫu, chọn đơn vị, chọn quyền`.

### Task 11: Người dùng page with groups and effective jurisdiction

**Files:**
- Move: `apps/web/src/features/user-management` stays where it is. Its panel is rendered by the `nguoi-dung` route. `pages/admin-users` is deleted.
- Modify: `apps/web/src/features/user-management/api/users.api.ts` (`groups` in the list; `setUserGroups(id, groupIds)`)
- Modify: `apps/web/src/features/user-management/model/useUsersPresenter.ts`
- Modify: `apps/web/src/features/user-management/ui/UserTable.view.tsx`
- Create: `apps/web/src/features/user-management/ui/UserGroupsDialog.view.tsx` (+ test)
- Create: `apps/web/src/features/user-management/model/jurisdictionSummary.ts` (+ test)

**Interfaces:**
- Consumes: `PUT /api/users/:id/groups` and `GET /api/access-groups` (Task 5); `unitsFor`, `PERMISSION_LABELS` (Task 1); `useCan` (Task 8).
- Produces: `jurisdictionSummary(grants: Grant[], tree: UnitTree): string[]`. It returns one line per distinct set of units, permissions in `PERMISSIONS` order, for example `'Thêm, sửa, xoá, nhập: Đà Nẵng'` and `'Duyệt: Xã Điện Hồng'`. A user with no grants gets `['Chỉ xem']`.
- **Non-admin behaviour.** A `users.manage` holder sees the list, but no create, edit-account or delete buttons. In the groups dialog, groups outside their scope are shown disabled with the tooltip `Ngoài phạm vi quản lý của anh/chị`. Account creation is admin-only.

- [ ] **Step 1: Write the failing tests:**
  - `summary groups permissions per unit set`.
  - `no grants reads Chỉ xem`.
  - `a users.manage holder cannot tick an out-of-scope group`.
  - `a 403 ESCALATION shows the server message in the dialog`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- user-management`. Expected: FAIL.
- [ ] **Step 3: Implement.** Grants per row come from expanding the user's groups with the group list already loaded; no extra endpoint.
- [ ] **Step 4: Run** `npm run test -w @webatlas/web` and `npm run build:web`. Expected: green.
- [ ] **Step 5: Commit** `feat(web): trang Người dùng — gán nhóm, tóm tắt phạm vi thực tế`.

### Task 12: Đơn vị chủ quản field, refusal messages, Đơn vị chưa gán page

**Files:**
- Create: `apps/web/src/features/feature-editing/ui/ManagingUnitField.view.tsx` (+ test)
- Create: `apps/web/src/features/feature-editing/model/useManagingUnitField.ts` (+ test)
- Modify: `apps/web/src/features/feature-editing/model/useAttributeFormPresenter.ts`. `managing_unit` is rendered by `ManagingUnitField` instead of a text field. `messageFor` maps 403 `OUT_OF_JURISDICTION` and `NO_PERMISSION` to the server message.
- Modify: `apps/web/src/features/feature-editing/ui/AttributeForm.view.tsx`
- Create: `apps/web/src/features/unassigned/{api,model,ui,index}` — the `chua-gan` page: a table of layer, name and id. *Gán đơn vị* opens a dialog with `ManagingUnitField` and saves through `PUT /api/layers/:key/features/:id`.
- Modify: `apps/web/src/components/DynamicPopup.tsx`. For the 8 editable layers, add a row `Đơn vị chủ quản: {name}` using the unit tree; WFS delivers it as `managingAuthority` via `normalizeFeatureProperties`.
- Modify: `apps/web/src/features/feature-editing/model/useAttributeFormPresenter.ts`. Show the response's `warnings` as a toast after a successful save.

**Interfaces:**
- Consumes: `POST /api/admin-units/suggest`, `GET /api/layers/unassigned` (Tasks 6 and 7); `useCan`, `useUnitTree` (Task 8); the `UnitPicker` view (Task 10, reused in single-select mode).
- Produces: `useManagingUnitField({ layerKey, geometry, initial })` → `{ value, setValue, options: UnitNode[], suggestion: string | null, error: string | null }`.
  - `options` = the units within `unitsFor(grants,'feature.update')` (admin: the whole tree).
  - On create, `suggestion` comes from the suggest endpoint whenever the geometry changes, and becomes `value` while the user has not chosen.
  - On edit, `value` = the feature's current unit. If that unit is outside the user's options, the field is read-only, showing `{name} — ngoài phạm vi của anh/chị`.

- [ ] **Step 1: Write the failing tests:**
  - `create prefills the suggested ward`.
  - `a user-chosen unit is not overwritten by a later suggestion`.
  - `options are limited to the jurisdiction`.
  - `a 403 OUT_OF_JURISDICTION shows the server message as the form error`.
  - `the unassigned page lists rows and assigns a unit`.
  - `the feature card shows the managing unit name`.
  - `a save with an OUTSIDE_MANAGING_UNIT warning shows the warning toast`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/web -- feature-editing unassigned`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test -w @webatlas/web` and `npm run build:web`. Expected: green.
- [ ] **Step 5: Commit** `feat(web): ô Đơn vị chủ quản, thông báo ngoài phạm vi, trang Đơn vị chưa gán`.

### Task 13: Browser proof and runbook

**Files:**
- Create: `apps/web/scripts/verify-permissions.mjs` (puppeteer-core with the system Chrome, following `verify-shell.mjs` and `rehearse-flood-demo.mjs`; credentials from `VERIFY_*` env vars only)
- Modify: `apps/web/package.json` (`"verify:permissions": "node scripts/verify-permissions.mjs"`)
- Modify: `docs/runbooks/` — add `permissions-and-groups.md`. It covers creating the first groups from templates, the GeoServer `rest/reset` after migration 25, and the meaning of Đơn vị chưa gán.

**Steps (the script)**, at 1440 px and 768 px; screenshots only after tile traffic has been quiet for 4 s:
1. Admin creates group "Kiểm thử — Đà Nẵng" from the tỉnh template on `48`, adds `submission.review`, and assigns user P. Admin creates "Kiểm thử — Điện Hồng" from the xã template on the Điện Hồng ward, with `submission.review`, and assigns user X.
2. P signs in. Biên tập is visible. P edits the name of a lake managed by a Đà Nẵng xã → saved.
3. X signs in and opens a lake managed by `48`. The Đơn vị chủ quản field is read-only with the "ngoài phạm vi" note. A forced save via the API returns 403 with the exact message.
4. A reader (no group) sees no Biên tập and no Quản lý.
5. Admin opens Đơn vị chưa gán and sees the dams without geometry.

- [ ] **Step 1:** Write the script; run it against `npm run dev:web` plus the API. Expected: every step PASS, screenshots saved in the session scratchpad.
- [ ] **Step 2:** Run the full suites: `npm run test:shared`, `npm run test -w @webatlas/versioning`, `npm run test:api`, `npm run test:web`, `npm run test -w @webatlas/atlas-data`, `npm run build:web`. Expected: all green; report the counts.
- [ ] **Step 3: Commit** `test(web): kiểm chứng phân quyền trên trình duyệt; sổ tay nhóm quyền`.
