# P3a: workspace schema and personal-map API, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a signed-in user can, through the API:
- create personal maps that only they (and the people they share with) can see;
- add drawn free layers, and edit copies of official layers backed by durable drafts;
- share maps with users or groups, and copy maps shared with them.

Strangers learn nothing about any of it.

**Architecture:**
- **Schema.** A new `workspace` schema holds maps, layers, free-layer features and shares. The assistant role cannot read it, and GeoServer cannot publish from it.
- **Free layers** store rows in `workspace.features`.
- **Edit-copy layers** point at a P2 durable draft in `water.<layer>`, which is the candidate tier.
- **Writes.** Every write is one short transaction:
  1. lock the map row and check the revision the client last saw;
  2. write;
  3. bump the map's revision.

  Edit-copy writes reuse P2's `draftOps` inside that transaction.
- **Access** is resolved once per request: the owner, a recipient (directly or through a group), or nobody. Nobody gets 404, never 403, so a map's existence does not leak.

**Tech stack:** Fastify 5, zod, node-pg-migrate (`.cjs`), PostgreSQL 16 + PostGIS 3.4, vitest integration suites against the dev DB, `@webatlas/versioning`.

**Spec:** `docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md`, section 2, "Staging, personal maps and sharing", plus the Architecture section. P3 is split into P3a (this plan), P3b and P3c (user, 2026-10-20). Out of P3a:
- **P3b:** uploads, the jobs table, the GDAL worker, import/export/download, rasters/COG, quota, and the "original files kept 90 days" rule.
- **P3c:** everything in the web app, including personal layers as analysis inputs and in print.
- **P4:** submit/review, notification delivery, and conflict listing/resolution over HTTP.

## Global Constraints

- **Personal maps skip the jurisdiction check (U7).** Nothing in P3a calls `assertCan`, `authorize` or `assertDraftPublishable`. `draftOps` still validates geometry and checks that a unit is known.
- **Visibility.** Only the owner and share recipients see a map's content. Anyone else gets `404 NOT_FOUND`, the same answer as for a map that does not exist.
- **Only the owner writes.** A recipient's write gets `403 FORBIDDEN` with the message `Chỉ người tạo bản đồ được sửa bản đồ này.`
- **Stale writes.** A write whose `expectedRevision` is not the map's current revision gets `409 MAP_CHANGED` with the message `Bản đồ đã thay đổi ở nơi khác.` `expectedRevision` is **required** on every write to a map's content: its metadata, layers and features.
- **Admin sees counts and sizes, not content.** Being admin grants no read access to someone else's map.
- **Coordinates and geometry.** All geometry is in EPSG:4326. Free-layer geometry is validated with the existing `assertValidInPg`.
- **Field types for drawn layers:** exactly `text`, `number`, `date`.
- **Geometry types for drawn layers:** exactly `point`, `line`, `polygon`.
- **Layer kinds in the schema:** exactly `free`, `edit_copy`, `raster`, `annotation`. P3a creates only `free` and `edit_copy`; the other two are reserved for P3b and P11.
- **Test hygiene, the same rules as P2:**
  - every suite creates and deletes its own `app.users` rows, with emails `p3a-<suite>-<who>@webatlas.test`, because CI seeds none;
  - roll back before releasing a client;
  - give each `afterAll` stage its own guard (`runStages`);
  - pin every version of a real layer before committing an activation on it, and restore the active version in one transaction;
  - synthetic dam `external_id`s for P3a are `9010xx`;
  - `/api/auth/login` allows 10 logins a minute, so cache one token per user per file.
- **Text.** Code comments are in English. User-facing copy is Vietnamese, exactly as written here. Commit messages are in Vietnamese and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks before any claim of completion:**
  - `npm run test:api`
  - `npm run test -w @webatlas/versioning`
  - `npm run test -w @webatlas/atlas-data`
  - `npx tsc -p apps/api/tsconfig.json --noEmit`
  - `npx tsc -p packages/versioning/tsconfig.json --noEmit`
  - `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`

## Review Focus

The inputs and failure modes most likely to hurt a real user that no single task's happy path exercises, most likely first. Each one has a test in the task named after it.

1. **Belonging to a group is enough to see a map shared with that group.** Leaving the group, or the share being revoked, hides the map on the very next request. → Task 5, `group share follows membership`.
2. **Two tabs editing one map.** The second write carrying the old revision gets `MAP_CHANGED` and changes nothing, on free and edit-copy layers alike. → Task 3, `a stale revision changes nothing`; Task 4, `edit-copy write with a stale map revision changes nothing`.
3. **Deleting a map, or an edit-copy layer, leaves no orphan draft in `water.*`.** → Task 4, `deleting the layer or the map discards the draft`.
4. **An edit copy on a big layer (rivers) is served by bounding box without resolving the whole layer.** A request is capped, and the response says when it was capped. → Task 4, `bbox read is capped and says so`.
5. **A recipient who copies a map gets an independent copy.** Their edits never reach the owner's draft, and revoking the share leaves their copy alone. → Task 5, `copy is independent and survives revocation`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/db/migrations/1000000000027_workspace.cjs` | The `workspace` schema, its tables, and revoking access from the assistant |
| `apps/api/src/db/workspaceSchema.test.ts` | Shape, cascades and privileges of the schema |
| `apps/api/src/modules/workspace/routes.ts` | Route table; every route requires `app.authenticate` |
| `apps/api/src/modules/workspace/controller.ts` | Parse with zod, call the services, shape the replies |
| `apps/api/src/modules/workspace/schemas.ts` | zod bodies, params and queries |
| `apps/api/src/modules/workspace/access.ts` | `mapAccess`: owner / recipient / none, with `MapRevisionError`, `lockMapForWrite` and `bumpMap` |
| `apps/api/src/modules/workspace/maps.ts` | Map CRUD and listing |
| `apps/api/src/modules/workspace/freeLayers.ts` | Free-layer CRUD and its features |
| `apps/api/src/modules/workspace/editCopies.ts` | Edit-copy layers on durable drafts |
| `apps/api/src/modules/workspace/sharing.ts` | Shares, share targets, copying a map |
| `apps/api/src/modules/workspace/cleanup.ts` | Inactivity notice and archive, orphan drafts, admin summary |
| `apps/api/src/scripts/workspaceCleanup.ts` | CLI around `cleanup.ts` (`npm run workspace:cleanup -w @webatlas/api`) |
| `apps/api/src/modules/workspace/*.test.ts` | One suite per service file, plus `isolation.test.ts` |
| `packages/versioning/src/drafts.ts` | Adds `copyDraft` |
| `packages/atlas-data/src/geoserver.ts` | `publishLayer` refuses a native name outside `water` |

---

### Task 1: The `workspace` schema

**Files:**
- Create: `apps/api/src/db/migrations/1000000000027_workspace.cjs`
- Modify: `packages/versioning/package.json` (add `"./testing": "./src/testLayerGuard.ts"` to `exports`)
- Test: `apps/api/src/db/workspaceSchema.test.ts`

**Interfaces:**
- Produces `@webatlas/versioning/testing`, which exposes `pinLayer`, `unpinLayer`, `restoreActive` and `runStages`. These are the test helpers versioning's own suites already use. Every P3a suite takes them from here and does not copy them.
- Produces these tables, all in schema `workspace`. Every `id` is `uuid DEFAULT gen_random_uuid()`, except `features.id`.
  - **`maps`**
    - `id`
    - `owner_id uuid NOT NULL → app.users ON DELETE CASCADE`
    - `title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200)`
    - `description text NOT NULL DEFAULT ''`
    - `revision integer NOT NULL DEFAULT 0`
    - `created_at`, `updated_at`, `last_activity_at`: `timestamptz NOT NULL DEFAULT now()`
    - `inactivity_notice_at timestamptz NULL`, `archived_at timestamptz NULL`
    - index on `(owner_id) WHERE archived_at IS NULL`
  - **`map_layers`**
    - `id`
    - `map_id → maps ON DELETE CASCADE`
    - `kind text NOT NULL CHECK (kind IN ('free','edit_copy','raster','annotation'))`
    - `title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200)`
    - `position integer NOT NULL`
    - `style jsonb NOT NULL DEFAULT '{}'`
    - `geometry_type text NULL CHECK (geometry_type IN ('point','line','polygon'))`
    - `fields jsonb NOT NULL DEFAULT '[]'`
    - `layer_key text NULL`
    - `draft_id uuid NULL → app.dataset_versions ON DELETE SET NULL`
    - `created_at`
    - `CHECK (kind <> 'edit_copy' OR layer_key IS NOT NULL)`
    - `UNIQUE (map_id, position) DEFERRABLE INITIALLY DEFERRED`
    - index on `draft_id`
  - **`features`**
    - `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
    - `layer_id → map_layers ON DELETE CASCADE`
    - `geom geometry(Geometry,4326) NOT NULL`
    - `properties jsonb NOT NULL DEFAULT '{}'`
    - `source_row integer NULL`, `source_crs text NULL`, both filled by P3b imports
    - GiST index on `geom`; btree on `layer_id`
  - **`map_shares`**
    - `id`
    - `map_id → maps ON DELETE CASCADE`
    - `user_id uuid NULL → app.users ON DELETE CASCADE`
    - `group_id uuid NULL → app.access_groups ON DELETE CASCADE`
    - `created_by uuid NULL → app.users ON DELETE SET NULL`
    - `created_at`
    - `CHECK (num_nonnulls(user_id, group_id) = 1)`
    - partial unique indexes on `(map_id, user_id)` and `(map_id, group_id)`
- Privileges: `REVOKE ALL ON SCHEMA workspace FROM PUBLIC, webatlas_assistant`, and `REVOKE ALL ON ALL TABLES IN SCHEMA workspace FROM PUBLIC, webatlas_assistant`. `down` drops the schema with CASCADE.

- [ ] **Step 1: Write the failing tests** in `workspaceSchema.test.ts`:
  - `workspace tables exist with their checks`: inserting a `map_layers` row with `kind = 'edit_copy'` and a NULL `layer_key` fails with 23514. A share with both `user_id` and `group_id` set fails with 23514.
  - `deleting a user cascades to their maps, layers and features`: insert a user, a map, a free layer and a feature; delete the user; all three are gone.
  - `a discarded draft leaves the layer with draft_id NULL`: an `edit_copy` layer pointing at a draft opened with `openDraft`. After `discardDraft`, the layer row exists and its `draft_id IS NULL`.
  - `the assistant role cannot reach workspace`: `has_schema_privilege('webatlas_assistant','workspace','USAGE')` is false, and `has_table_privilege('webatlas_assistant','workspace.<t>','SELECT')` is false for all four tables.
  - Everything runs inside one rolled-back transaction, except the cascade test, which needs a committed user and cleans up with `runStages`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- workspaceSchema`. Expected: FAIL, because the relation `workspace.maps` does not exist.
- [ ] **Step 3: Write the migration.** Follow `1000000000026_durable-drafts.cjs` for style, with a header comment naming the spec section. Run `npm run migrate:up -w @webatlas/api`.
- [ ] **Step 4: Run** the test again; expected PASS. Then run `npm run migrate:down -w @webatlas/api` followed by `migrate:up`; both succeed.
- [ ] **Step 5: Commit** `feat(db): lược đồ workspace cho bản đồ cá nhân, lớp, đối tượng và chia sẻ`

---

### Task 2: Map access and map CRUD

**Files:**
- Create: `apps/api/src/modules/workspace/{routes,controller,schemas,access,maps}.ts`, `apps/api/src/modules/workspace/maps.test.ts`
- Modify: `apps/api/src/server.ts` (register `workspaceRoutes` with prefix `/api/workspace`)
- Modify: `apps/api/src/plugins/errorHandler.ts` (map `MapRevisionError` → `409 MAP_CHANGED`)

**Interfaces:**
- Produces, in `access.ts`:
  - `type MapRole = 'owner' | 'recipient'`
  - `mapRole(q: Queryable, mapId: string, userId: string): Promise<MapRole | null>`
    - A recipient is a direct `user_id` share, or a `group_id` share of a group in `app.user_groups` for that user.
    - Archived maps resolve to `null` for everyone.
  - `assertCanRead(q, mapId, user): Promise<MapRole>`: throws `NotFoundError('Không tìm thấy bản đồ.')` on `null`.
  - `class MapRevisionError extends Error` (no HTTP knowledge).
  - `lockMapForWrite(client: PoolClient, mapId: string, user: CurrentUser, expectedRevision: number): Promise<{ revision: number }>`
    - takes `SELECT ... FOR UPDATE` on the map;
    - throws NotFound when the user has no role;
    - throws `ForbiddenError('Chỉ người tạo bản đồ được sửa bản đồ này.')` for a recipient;
    - throws `MapRevisionError` when `revision <> expectedRevision`.
  - `bumpMap(client, mapId): Promise<number>`: does `revision + 1`, sets `updated_at = last_activity_at = now()`, clears `inactivity_notice_at`, and returns the new revision.
- Produces, in a new `apps/api/src/lib/transaction.ts`:
  - `inTransaction<T>(pg: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T>`, the function `draftEditor.ts` has today, **moved** here unchanged: ROLLBACK on error, and release with the error if the ROLLBACK fails.
  - `draftEditor.ts` and every workspace service import it from here.
- Produces, in `maps.ts`, `mapsService(pg)`:
  - `listMine(user): Promise<MapSummary[]>`
  - `listSharedWithMe(user): Promise<MapSummary[]>`
  - `create(user, { title, description? }): Promise<MapDetail>`
  - `get(user, mapId): Promise<MapDetail>`
  - `update(user, mapId, { title?, description?, expectedRevision })`
  - `remove(user, mapId, { expectedRevision })`: discards every edit-copy draft of the map in the same transaction (via `discardDraft`), then deletes the map.
  - `MapSummary = { id, title, description, ownerId, ownerName, revision, updatedAt, layerCount, role }`
  - `MapDetail = MapSummary & { layers: LayerSummary[] }`
  - `LayerSummary = { id, kind, title, position, style, geometryType, fields, layerKey, draftId, featureCount }`
  - `featureCount` is the number of `workspace.features` rows for `free` layers and `null` otherwise.
- Routes, each with `preHandler: [app.authenticate]`:
  - `GET /maps` → `{ mine, sharedWithMe }`
  - `POST /maps` → `201 { map }`
  - `GET /maps/:mapId` → `{ map }`
  - `PATCH /maps/:mapId` → `{ map }`
  - `DELETE /maps/:mapId` (body `{ expectedRevision }`) → `204`

- [ ] **Step 1: Write the failing tests** in `maps.test.ts`. Use users O (owner), R (direct recipient, given a share row by SQL in this task) and S (stranger).
  - `owner creates, reads, renames and deletes a map`: the revision goes 0 → 1 after the PATCH.
  - `list separates mine from shared with me`.
  - `a stranger gets 404 for get, patch and delete, and the same body as for a random uuid`.
  - `a recipient reads but cannot write`: PATCH → 403 with the exact message.
  - `a stale revision changes nothing`: PATCH with `expectedRevision: 0` after another PATCH → `409 MAP_CHANGED` with the exact message. The title is unchanged.
  - `an archived map is invisible, even to its owner`: set `archived_at` by SQL; GET → 404, and the map is absent from both lists.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- workspace/maps`. Expected: FAIL (404, because the route is not registered).
- [ ] **Step 3: Implement** the five files and the two modifications. Follow `access-groups` for the controller/schemas/`validate` pattern. Return `{ mine, sharedWithMe }` ordered by `updated_at DESC`.
- [ ] **Step 4: Run** the suite plus `npm run test -w @webatlas/api -- draftEditor errorHandler` (the `inTransaction` move). Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): bản đồ cá nhân — tạo, xem, đổi tên, xoá; chỉ chủ và người được chia sẻ thấy`

---

### Task 3: Free layers and their features

**Files:**
- Create: `apps/api/src/modules/workspace/freeLayers.ts`, `apps/api/src/modules/workspace/freeLayers.test.ts`
- Modify: `routes.ts`, `controller.ts`, `schemas.ts`

**Interfaces:**
- Consumes: `lockMapForWrite`, `bumpMap`, `assertCanRead`, and `inTransaction` from Task 2. Also `assertValidInPg`, from the layers module's geometry helpers.
- Produces `freeLayersService(pg)`. Every write takes `expectedRevision` and returns `{ revision }` plus its payload.
  - `addLayer(user, mapId, { title, geometryType, fields, style?, expectedRevision })` → `{ layer, revision }`
    - The new layer's position is `max(position) + 1`.
    - `fields` is an array of `{ name, type }`, at most 50.
    - A `name` is 1–63 characters, trimmed, unique case-insensitively within the layer, and not `id`.
  - `updateLayer(user, mapId, layerId, { title?, style?, position?, expectedRevision })`
    - A position change shifts the others, which works because of the deferrable unique constraint.
    - `style` is any JSON object of at most 8 KB serialised. Larger gets `400 VALIDATION_ERROR` with the message `Kiểu hiển thị quá lớn.`
  - `removeLayer(user, mapId, layerId, { expectedRevision })`
  - `features(user, mapId, layerId, { bbox?: [minX,minY,maxX,maxY], limit? })` → `{ type: 'FeatureCollection', features, truncated }`
    - `limit` defaults to 5000, with a maximum of 20000.
    - Each feature's `id` is a string, and its `properties` are the jsonb.
  - `addFeature(user, mapId, layerId, { geometry, properties, expectedRevision })` → `{ feature, revision }`
  - `updateFeature(user, mapId, layerId, featureId, { geometry?, properties?, expectedRevision })`
  - `removeFeature(user, mapId, layerId, featureId, { expectedRevision })`
- Validation, all `400 VALIDATION_ERROR`, with `details.field` naming the offending key:
  - **Geometry type:** for a drawn layer with a `geometryType`, the geometry must match. `point` takes Point and MultiPoint, `line` takes LineString and MultiLineString, `polygon` takes Polygon and MultiPolygon. Otherwise the message is `Lớp này chỉ nhận đối tượng dạng <điểm|đường|vùng>.`
  - **Unknown properties:** a key not in `fields`, on a layer that has `fields`, gets `Trường "<name>" không có trong lớp.`
  - **Wrong value types:** a `number` field takes a finite JSON number. A `date` field takes `YYYY-MM-DD`. A `text` field takes a string. A wrong type gets `Trường "<name>" phải là <chữ|số|ngày>.`
  - **Empty values:** `null` is allowed for every type.
  - A layer with `fields = []` (the uploads of P3b) accepts any properties.
- Routes:
  - `POST /maps/:mapId/layers`, with body `{ kind: 'free', ... }`. Task 4 adds `kind: 'edit_copy'` on the same route.
  - `PATCH /maps/:mapId/layers/:layerId`
  - `DELETE /maps/:mapId/layers/:layerId`
  - `GET /maps/:mapId/layers/:layerId/features?bbox=a,b,c,d&limit=n`
  - `POST /maps/:mapId/layers/:layerId/features`
  - `PUT /maps/:mapId/layers/:layerId/features/:featureId`
  - `DELETE /maps/:mapId/layers/:layerId/features/:featureId`
  - A `layerId` that is not in `mapId`, or a `featureId` that is not in `layerId`, gets 404.

- [ ] **Step 1: Write the failing tests** in `freeLayers.test.ts`:
  - `owner draws a layer, adds, edits and removes features; each write bumps the revision`.
  - `a stale revision changes nothing`: two adds with the same `expectedRevision`; the second → 409 `MAP_CHANGED`; the feature count stays 1.
  - `geometry type and field types are enforced`: one case per message above, each asserting the exact copy and `details.field`.
  - `invalid geometry is 422 and writes nothing`: a self-intersecting polygon.
  - `bbox filters and limit truncates`: 3 features, two inside the bbox → 2 returned. `limit=1` → 1 returned and `truncated: true`.
  - `a recipient reads features but cannot add`: 403 with the exact message.
  - `a layer of another map is 404`.
  - `reordering layers keeps positions unique`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- freeLayers`. Expected: FAIL.
- [ ] **Step 3: Implement.** The bbox filter is `geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`. Read `limit + 1` rows to compute `truncated`. Geometry goes in as `ST_SetSRID(ST_GeomFromGeoJSON($n), 4326)`, after `assertValidInPg`.
- [ ] **Step 4: Run** the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): lớp tự vẽ trong bản đồ cá nhân — trường do người tạo định nghĩa, ghi theo số hiệu bản đồ`

---

### Task 4: Edit-copy layers on durable drafts

**Files:**
- Create: `apps/api/src/modules/workspace/editCopies.ts`, `apps/api/src/modules/workspace/editCopies.test.ts`
- Modify: `routes.ts`, `controller.ts`, `schemas.ts`, and `maps.ts` (`remove` discards drafts; this is already the contract, and the test lands here)

**Interfaces:**
- Consumes:
  - `openDraft`, `lockDraft`, `bumpRevision`, `discardDraft` and `touchedFeatures` from `@webatlas/versioning`;
  - `createInDraft`, `updateInDraft` and `removeInDraft` from `apps/api/src/modules/layers/draftOps.ts`;
  - `getUnitTree`;
  - everything from Task 2.
- Produces `editCopiesService(pg)`:
  - `addLayer(user, mapId, { layerKey, title?, expectedRevision })` → `{ layer, revision }`
    - opens a personal draft of `layerKey` owned by `user`, all in one transaction;
    - the title defaults to `Sửa lớp <layer display name>`, using the registry title;
    - an unknown `layerKey` gets `400 VALIDATION_ERROR`.
  - `features(user, mapId, layerId, { bbox, limit? })` → `{ type: 'FeatureCollection', features, truncated, changed: string[] }`
    - `bbox` is **required**. Without it the answer is `400 VALIDATION_ERROR`.
    - `changed` lists the external_ids the draft stores a row for, from `touchedFeatures`.
    - Each feature's `properties` include `external_id` and `managing_unit`.
    - A layer whose `draft_id` is NULL gets `410 DRAFT_GONE` with the message `Bản nháp của lớp này không còn.`
  - `addFeature`, `updateFeature` and `removeFeature`:
    - they take the same arguments as in Task 3, and `featureId` is the `water.<layer>` row id that the read returns;
    - each takes one transaction: `lockMapForWrite` → `lockDraft(draftId, { ownerId: user.id, requireStatus: 'personal' })` → the `draftOps` call → `bumpRevision(draft)` → `bumpMap`;
    - they return `{ feature, warnings, revision }`, where `revision` is the **map's** revision.
  - Removing an edit-copy layer: `removeLayer` dispatches on kind, and for `edit_copy` it runs `discardDraft` in the same transaction.
- Read algorithm. It must not resolve a whole layer, because rivers has about 23k features:
  - **When the draft's parent is the active version:**
    - read the `water.<layer>_active` rows inside the bbox whose `external_id` is not in the draft's touched set;
    - then `UNION ALL` the draft's own rows (`dataset_version_id = draftId AND NOT deleted`) inside the bbox.
  - **Otherwise:** read `resolvedSql(layer, '*', '$1')` with the draft id, wrapped as `SELECT * FROM (...) r WHERE r.geom && envelope`.
  - Both paths apply `limit + 1`.

- [ ] **Step 1: Write the failing tests** in `editCopies.test.ts`. Pin every dams version, as in P2 suites. Use synthetic dams `901001`–`901010`, managed by `48`.
  - `adding an edit copy opens a personal draft owned by the map owner`.
  - `edit-copy writes go to the draft and bump the map revision`:
    - update a dam's name; the draft holds the row; `changed` lists it;
    - the `dams_active` view still has the old name;
    - the map revision is now 2: 1 for adding the layer, 1 for the edit.
  - `edit-copy write with a stale map revision changes nothing`: 409 `MAP_CHANGED`, and the draft row count is unchanged.
  - `no jurisdiction check on personal edits`: a user with no group edits a dam managed by `51` → 200.
  - `bbox read is capped and says so`: `limit=1` on a bbox holding 2 synthetic dams → 1 feature, `truncated: true`. Without `bbox` → 400.
  - `the read falls back to the resolved chain when the layer moved on`: commit an upstream publish on dams, then read; the draft's edit and the upstream change both appear.
  - `deleting the layer or the map discards the draft`: after each delete, `SELECT count(*) FROM app.dataset_versions WHERE id = <draft>` is 0.
  - `a layer whose draft is gone answers 410`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- editCopies`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite plus `npm run test -w @webatlas/api -- workspace layers`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): lớp "Sửa lớp" trong bản đồ cá nhân — ghi vào bản nháp lưu bền, đọc theo khung nhìn`

---

### Task 5: Sharing, share targets and copying a map

**Files:**
- Create: `apps/api/src/modules/workspace/sharing.ts`, `apps/api/src/modules/workspace/sharing.test.ts`
- Modify: `packages/versioning/src/drafts.ts` and `index.ts` (add `copyDraft`); `packages/versioning/src/drafts.test.ts`
- Modify: `routes.ts`, `controller.ts`, `schemas.ts`

**Interfaces:**
- Produces, in versioning:
  - `copyDraft(client: PoolClient, sourceDraftId: string, ownerId: string): Promise<DraftRow>`
  - It creates a `personal` draft on the **same parent** as the source, then copies the source draft's own rows, tombstones included, with `dataset_version_id` set to the new draft. Every column is copied except `id` and `dataset_version_id`, and `is_current` is false.
  - It does not copy `draft_resolutions`.
  - The source must be a draft; otherwise it throws `NotFoundError`.
- Produces `sharingService(pg)`:
  - `list(user, mapId)`, owner only → `Share[]`
    - `Share = { id, userId, groupId, name, createdAt }`, where `name` is the user's `full_name` or email, or the group's name.
  - `add(user, mapId, { userId } | { groupId })`, owner only → `{ share }`, with status 201
    - Sharing with yourself gets `400 VALIDATION_ERROR` with the message `Không thể chia sẻ với chính mình.`
    - A duplicate returns the existing share with status 200.
    - An unknown user or group gets 400.
  - `remove(user, mapId, shareId)`, owner only → 204.
  - `targets(user, q)`: `q` is 2–100 characters. The result is `{ users: {id,name,email}[], groups: {id,name}[] }`: at most 10 of each, matched case-insensitively on name or email, and excluding the caller.
  - `copy(user, mapId)`, for a recipient or the owner → `{ map }`, with status 201
    - The new map is owned by `user`, titled `Bản sao của <title>`, and starts at revision 0.
    - Free layers are copied with their features.
    - Edit-copy layers are copied with `copyDraft`. A layer whose draft is gone is copied with `draft_id = NULL`.
    - Everything happens in one transaction.
- Routes:
  - `GET /maps/:mapId/shares`
  - `POST /maps/:mapId/shares`
  - `DELETE /maps/:mapId/shares/:shareId`
  - `GET /share-targets?q=`
  - `POST /maps/:mapId/copy`
- Shares do not change the map's revision. They are not content.

- [ ] **Step 1: Write the failing tests.**
  - **In `drafts.test.ts`:** `copyDraft copies rows and tombstones onto the same parent`.
  - **In `sharing.test.ts`:**
    - `share with a user: they see it under sharedWithMe and can read features`.
    - `group share follows membership`:
      - share with a group G;
      - member M sees the map;
      - delete M's `user_groups` row → M's next GET is 404;
      - re-add M, then revoke the share → 404 again.
    - `only the owner lists, adds and removes shares`: the recipient gets 403 and the stranger 404.
    - `cannot share with yourself`, with the exact copy.
    - `share targets match name or email and exclude the caller`.
    - `copy is independent and survives revocation`:
      1. The recipient copies.
      2. They edit a free feature and the edit-copy dam in their copy.
      3. The owner's map and draft are unchanged.
      4. The copy's edit-copy draft is owned by the recipient and has the same parent as the owner's.
      5. Revoke the share: the copy is still listed under the recipient's `mine`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/versioning -- drafts` and `npm run test -w @webatlas/api -- sharing`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): chia sẻ bản đồ cá nhân với người dùng hoặc nhóm; tạo bản sao độc lập`

---

### Task 6: Cleanup and the admin summary

**Files:**
- Create: `apps/api/src/modules/workspace/cleanup.ts`, `apps/api/src/modules/workspace/cleanup.test.ts`, `apps/api/src/scripts/workspaceCleanup.ts`
- Modify: `apps/api/package.json` (script `"workspace:cleanup": "tsx src/scripts/workspaceCleanup.ts"`), `routes.ts`, `controller.ts`

**Interfaces:**
- Produces, in `cleanup.ts`:
  - `INACTIVE_NOTICE_DAYS = 180`, `ARCHIVE_AFTER_NOTICE_DAYS = 30` and `ORPHAN_DRAFT_GRACE_HOURS = 24`, exported constants.
  - `markInactive(pg, now: Date): Promise<number>`: sets `inactivity_notice_at = now` on unarchived maps whose `last_activity_at < now - 180 days` and which have no notice yet. It returns the count. P4 delivers the notice from this column.
  - `archiveNoticed(pg, now): Promise<number>`: for unarchived maps whose `inactivity_notice_at < now - 30 days`, in one transaction per map, it discards every edit-copy draft and sets `archived_at = now`. Free features are kept, because P3b decides what happens to files after 90 days. It returns the count.
  - `discardOrphanDrafts(pg, now): Promise<number>`: discards every `personal` draft that **either** has `ingested_by IS NULL`, **or** is referenced by no `workspace.map_layers.draft_id` and has `updated_at < now - 24 h`. It returns the count.
  - `adminSummary(pg): Promise<Array<{ userId, email, maps, layers, features, bytes }>>`
    - `bytes = sum(pg_column_size(geom) + pg_column_size(properties))` over the owner's free features.
    - No titles, no content.
- The script runs all three steps with `new Date()` and prints the three counts.
- Route: `GET /admin/summary`, with `preHandler: [app.authenticate, requireAdmin()]`.
- Writing to someone's map does not touch other maps' activity. `bumpMap` (Task 2) already clears `inactivity_notice_at` on activity.

- [ ] **Step 1: Write the failing tests** in `cleanup.test.ts`. Backdate timestamps by SQL, and pass a fixed `now`.
  - `a map inactive for 181 days gets a notice; activity clears it`.
  - `a map noticed 31 days ago is archived and its drafts discarded; one noticed 29 days ago is not`.
  - `orphan drafts: no owner, or unreferenced and older than 24 h, are discarded; a referenced or fresh one is kept`.
  - `admin summary reports counts and sizes, no titles`. Assert that the response JSON contains no map title string.
  - `the summary route is admin-only`: a non-admin gets 403.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- workspace/cleanup`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite, then `npm run workspace:cleanup -w @webatlas/api` once against the dev DB. It prints three counts and exits 0. Paste the output into the report.
- [ ] **Step 5: Commit** `feat(api): dọn bản đồ cá nhân không hoạt động và bản nháp mồ côi; tóm tắt dung lượng cho quản trị`

---

### Task 7: Isolation, proven by tests

**Files:**
- Create: `apps/api/src/modules/workspace/isolation.test.ts`
- Modify: `packages/atlas-data/src/geoserver.ts` (`publishLayer`), `packages/atlas-data/src/geoserver.test.ts`

**Interfaces:**
- Produces: `publishLayer` throws `Error('Lớp GeoServer chỉ được trỏ tới lược đồ water: <name>')` **before any HTTP call** when the resolved native name does not match `/^[a-z_][a-z0-9_]*$/` (no schema qualifier) or starts with `workspace`. The datastore is already pinned to schema `water`, and this guard keeps a qualified name from escaping it.

- [ ] **Step 1: Write the failing tests.**
  - **`isolation.test.ts`:** `every workspace route refuses a stranger with 404`.
    - Build the list of routes from the app with `app.printRoutes` or a hand-kept table that this test asserts is complete. Compare it against `app.hasRoute` for each, so a new route without a case fails the test.
    - Call every route under `/api/workspace/maps/:mapId...` as a stranger, with a real map, layer, feature and share id, and expect 404 and the same body as for a random uuid.
    - The exceptions are `/share-targets` and `/admin/summary`, which are not map-scoped.
  - **`isolation.test.ts`:** `the assistant role reads nothing in workspace`.
    - `SET LOCAL ROLE webatlas_assistant` inside a rolled-back transaction.
    - `SELECT count(*) FROM workspace.maps` fails with 42501.
    - The positive control is that `SELECT count(*) FROM water.dams_active` succeeds.
  - **`geoserver.test.ts`:** `publishLayer refuses a native name outside water`, for `workspace.features` and `workspace_features`. The injected `fetch` is never called.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- isolation` and `npm run test -w @webatlas/atlas-data -- geoserver`. Expected: the geoserver case FAILS. The route sweep may already pass; if so, show it fails once by temporarily making one route return 403 for a stranger, then revert.
- [ ] **Step 3: Implement** the guard.
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** `test(api): chứng minh người lạ và vai trò trợ lý không thấy gì trong workspace; GeoServer không trỏ được tới workspace`

---

### Task 8: P2 leftovers that P3a makes urgent

**Files:**
- Modify: `apps/api/src/modules/layers/layers.test.ts` (around lines 38–60), `apps/api/src/modules/versions/integration.test.ts`
- Modify: `packages/atlas-data/src/stages/loadGeojson.ts` (after the bulk `FOR UPDATE` around line 88), `packages/versioning/src/rebase.ts` (doc comment on `rebaseDraft`)
- Test: `packages/atlas-data/src/stages/loadGeojson.db.test.ts`

**Interfaces:** none new.

What to change:
- **`layers.test.ts`.** Its `afterAll` deletes **every** `kind = 'edit'` dams version. Since P2 that includes open drafts, and since P3a every edit-copy layer's draft.
  - Extract the cleanup into a function `dropOwnEdits(since: Date)`.
  - It deletes only the dams versions with `kind = 'edit' AND draft_status IS NULL AND source = 'edit session' AND ingested_at >= since`, where `since` is taken in `beforeAll`. These are the versions this suite's direct writes publish; test files run one at a time.
  - Pin every dams version in `beforeAll`.
  - Restore the active version with `restoreActive` from `@webatlas/versioning/testing`.
- **`versions/integration.test.ts`.** Pin every `stations` version before activating, and restore in one transaction.
- **`loadGeojson.ts`.** Right after the bulk lock, re-lock the active row in a fresh statement: `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active FOR UPDATE`. A draft published while the bulk statement waited is then held too. Comment why: the bulk statement's snapshot filtered out a version that was still a draft.
- **`rebaseDraft`.** Document that callers must hold the active row lock (`FOR NO KEY UPDATE`) for the whole call, as `publishDraft` does. Retention's safety depends on it.

- [ ] **Step 1: Write the failing test** in `layers.test.ts`: `cleanup leaves other people's drafts alone`.
  1. Open a dams draft with `openDraft` for the suite's viewer user.
  2. Make one direct write as admin.
  3. Run the cleanup.
  4. Assert the admin's edit version is gone and the draft still exists.
  5. Discard the draft in the final cleanup stage.

  Before the fix, the cleanup is the inline `afterAll` body. Call it through the extracted function's signature so the test compiles only once the function exists.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- layers.test`. Expected: FAIL, either because `dropOwnEdits` does not exist or because the draft is deleted.
- [ ] **Step 3: Implement** all four changes.
- [ ] **Step 4: Run** the full checks from the Global Constraints, then the atlas-data DB tests (`npm run test:db -w @webatlas/atlas-data` with `DATABASE_URL` set). Check read-only that the dev DB is clean before and after: 0 pins, 0 drafts, 0 `@webatlas.test` users, 0 `workspace.maps`, and one active version per layer. Expected: all green.
- [ ] **Step 5: Commit** `fix: test lớp không xoá bản nháp của người khác; bộ nạp khoá lại phiên bản đang dùng; ghi rõ điều kiện khoá của dời gốc`
