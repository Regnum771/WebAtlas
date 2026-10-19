# P2 — Durable Drafts: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make edit drafts outlive a request.
- A draft has a status, an owner and a revision.
- Each edit operation is its own short transaction.
- A draft whose parent is no longer active is rebased feature by feature, with conflicts surfaced and resolvable.
- Publishing re-checks permissions over everything the draft touches.
- The open-transaction edit session is gone.

**Architecture:**
- **`packages/versioning`** gains a draft lifecycle: open, lock, revise, discard, diff, rebase, resolve and publish. These run on the caller's client, like every other versioning call.
- **`apps/api`** splits the feature write into two parts:
  - draft-scoped operations that validate and write but do not authorise;
  - a publish-time check over the touched features that reuses P1's rule.
- **Direct writes.** The existing HTTP routes keep their behaviour by running open → operation → publish in one transaction.
- **HTTP for drafts is P3's job.** P2 only exposes services.

**Tech Stack:** PostgreSQL/PostGIS (node-pg-migrate `.cjs`), TypeScript, vitest against the live dev DB, Fastify.

**Spec:** `docs/superpowers/specs/2026-10-19-map-upload-edit-rbac-design.md` — "Architecture: two-tier staging", section 2 "Writes", section 3 "Conflicts" and "Publishing", and the P2 row of section 7. P1's plan (`docs/superpowers/plans/2026-10-19-p1-permissions-managing-units.md`) is the code this builds on.

## Global Constraints

- **Draft statuses, exact strings:** `personal`, `submitted`, `returned`. Only `personal` is editable. P2 creates only `personal` drafts; P4 adds the transitions.
- **Status column.** A draft is an `edit` version with `draft_status IS NOT NULL` and `NOT is_active`. Publishing sets `draft_status` to NULL. Ingest versions and published edits have NULL.
- **Conflict rule (spec section 3).**
  - touched = the external_ids stored in the draft;
  - changed = the external_ids whose content differs between the draft's parent and the current active version;
  - conflicts = touched ∩ changed, minus the conflicts already resolved against the *current* active version.
  - Empty conflicts → re-parent the draft onto the active version.
- **Content equality** compares the row as jsonb minus these keys, exactly: `id`, `dataset_version_id`, `is_current`, `created_at`, `updated_at`, `created_by`, `updated_by`, `province_codes`, `ward_codes`. A row missing from one side, and a tombstone, both count as different.
- **Conflict choices, exact strings:** `mine` (keep the draft row) and `theirs` (drop the draft row for that feature).
- **Who resolves.** Reviewers may only choose `theirs` (spec). P2 exposes both choices at service level; the caller enforces who may choose what (P4).
- **Retention never prunes a draft** (`draft_status IS NOT NULL`) **or any version in a draft's ancestor chain.**
- **Error codes and copy:**
  - `DRAFT_CHANGED`, 409: `Bản đồ đã thay đổi ở nơi khác.` — revision mismatch.
  - `DRAFT_NOT_EDITABLE`, 409: `Bản nháp đã được nộp, không sửa được nữa.` — status is not `personal`.
  - A draft that is missing or not owned by the caller → 404.
  - Conflicts at publish → 409 `STALE_EDIT`, the existing code. `details.conflicts` holds the conflicting external_ids.
- **Publish authorisation is required, never optional.** `publishDraft` takes a `guard` callback, and the API's publish path always passes `assertDraftPublishable(…, access)`.
  - The P1 rule applies per touched feature: `feature.create`, `feature.update` or `feature.delete` on the relevant unit, AND `submission.review`.
  - Changing a managing unit needs rights on both the old and the new unit.
  - Admin bypasses.
- **Personal drafts get no jurisdiction checks on their operations** (spec U7). Validation still runs: zod attributes, geometry, the known-unit check and "managing unit required without geometry".
- **Behaviour preserved.** Every P1 API test of a write stays green with unchanged expectations. That covers `layers.test.ts`, `jurisdiction.test.ts`, `unassigned.test.ts` and the assistant tests.
- **Copy and commits.** Code comments in English. Commits are Vietnamese Conventional Commits ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Checks to run, as CI does:**
  - `npx tsc -p packages/versioning/tsconfig.json --noEmit`
  - `npx tsc -p apps/api/tsconfig.json --noEmit`
  - `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`
- **Never run recursive deletes on this machine.**

## Review Focus

1. **A durable draft stays alive while another edit is published on the same layer, or a re-ingest activates.** Retention must not prune the draft or its parent, and the draft must still rebase. → Task 1, `keeps an open draft and its parent chain across activations`; Task 3, `rebases across a re-ingest by content, not row id`.
2. **Re-ingest gives every row a new id.** Comparing row ids would flag every touched feature as a conflict. Content must be compared. → Task 3 (same test).
3. **A feature deleted in the active version while the draft edits it.** It is a conflict with `current = null`. `theirs` drops the edit, and `mine` publishes the feature again. → Task 3, `a feature deleted upstream conflicts; theirs drops it, mine restores it`.
4. **A failed operation must not lose the draft or the earlier operations.** Each operation rolls back alone, and the draft and its revision are unchanged. → Task 5, `a refused operation leaves the draft and its revision untouched`.
5. **The managing unit moves between opening the draft and publishing it.** Publish checks the *current* active row's unit, not the unit seen when the draft opened. → Task 6, `publish checks the managing unit current at publish time`.

---

### Task 1: Draft columns, resolutions table, retention keeps drafts

**Files:**
- Create: `apps/api/src/db/migrations/1000000000026_durable-drafts.cjs`
- Modify: `packages/versioning/src/retention.ts` (the `kept` set)
- Test: `apps/api/src/db/durableDrafts.test.ts`, `packages/versioning/src/retention.test.ts`

**Interfaces:**
- Produces, in SQL:
  - `app.dataset_versions.draft_status text NULL`, with CHECK `draft_status IN ('personal','submitted','returned')`.
  - CHECK `dataset_versions_draft_shape`: `draft_status IS NULL OR (kind = 'edit' AND NOT is_active)`.
  - `revision integer NOT NULL DEFAULT 0`.
  - `updated_at timestamptz NOT NULL DEFAULT now()`.
  - Partial index `dataset_versions_open_drafts_idx ON (layer_key) WHERE draft_status IS NOT NULL`.
  - `app.draft_resolutions (draft_id uuid REFERENCES app.dataset_versions ON DELETE CASCADE, external_id text NOT NULL, against_version_id uuid NOT NULL REFERENCES app.dataset_versions ON DELETE CASCADE, choice text NOT NULL CHECK (choice IN ('mine','theirs')), resolved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (draft_id, external_id))`.
  - No grant to `webatlas_assistant`.
  - `down()` drops the table, the index, the constraints and the columns.
- Produces in `retention.ts`: the `kept` CTE also contains every version with `draft_status IS NOT NULL`, plus its ancestor chain. `assertPrunable` is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `durableDrafts.test.ts`:
    - `an ingest cannot carry a draft status`: insert kind `ingest` with `draft_status 'personal'` → violates `dataset_versions_draft_shape`.
    - `an active version cannot be a draft`.
    - `unknown status is refused`.
    - `resolutions cascade with their draft`.
  - `retention.test.ts`:
    - `keeps an open draft and its parent chain across activations`. Draft D opens on active A₁. Another edit E is published on A₁ and becomes active. Then two newer ingests activate, which pushes A₁'s ingest root out of `EARLIER_LOADS_KEPT`. After `pruneVersions`, D and every ancestor of D still exist.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- durableDrafts` and `npm run test -w @webatlas/versioning -- retention`. Expected: FAIL. The column does not exist, and D is pruned.
- [ ] **Step 3: Write the migration** and extend `kept` with a recursive `drafts` CTE: `SELECT id, parent_version_id FROM app.dataset_versions WHERE layer_key=$1 AND draft_status IS NOT NULL`, then the union with its parents. Run `npm run migrate:up -w @webatlas/api`.
- [ ] **Step 4: Run** both tests, then `npm run test -w @webatlas/versioning` and `npm run test -w @webatlas/api -- managingUnit currentFlag`. Expected: PASS. Prove `down` with `migrate:down` followed by `migrate:up`.
- [ ] **Step 5: Commit** `feat(versioning): bản nháp có trạng thái, số hiệu sửa đổi; giữ bản nháp khi dọn phiên bản`.

### Task 2: Draft lifecycle in `packages/versioning`

**Files:**
- Create: `packages/versioning/src/drafts.ts`, `packages/versioning/src/drafts.test.ts`
- Modify: `packages/versioning/src/errors.ts`, `packages/versioning/src/index.ts`

**Interfaces:**
- Produces:
  - `type DraftStatus = 'personal' | 'submitted' | 'returned'`
  - `interface DraftRow { id: string; layerKey: string; parentId: string; status: DraftStatus; revision: number; ownerId: string | null }`
  - `openDraft(client: PoolClient, layerKey: string, ownerId: string): Promise<DraftRow>`
    - Parent = the active version, else `ConflictError` as `openEditDraft` throws today.
    - `kind='edit'`, `source='draft'`, label `` `${YYYY-MM-DD} nháp` ``, `ingested_by=ownerId`, `draft_status='personal'`, `revision=0`.
  - `lockDraft(client: PoolClient, draftId: string, opts?: { ownerId?: string; expectedRevision?: number; requireStatus?: DraftStatus }): Promise<DraftRow>`
    - Locks with `SELECT … FOR UPDATE`.
    - `NotFoundError` when the draft is missing, not a draft, or has another owner while `ownerId` is given.
    - `DraftNotEditableError` when the status differs from `requireStatus`.
    - `DraftRevisionError` when the revision differs from `expectedRevision`.
  - `bumpRevision(client: PoolClient, draftId: string): Promise<number>` — `revision = revision + 1`, `updated_at = now()`. Returns the new revision.
  - `discardDraft(client: PoolClient, draftId: string): Promise<void>` — deletes the draft's rows in `water.<layer>`, then the version; resolutions cascade. Refuses (`ConflictError`) a version whose `draft_status` is NULL.
  - Errors: `class DraftNotEditableError extends ConflictError` and `class DraftRevisionError extends ConflictError`.
- Removes `openEditDraft` and `discardEditDraft` from `versionsService` in Task 4, not here. Both coexist until then.

- [ ] **Step 1: Write the failing tests** in `drafts.test.ts`, with the test pool and synthetic versions on `dams`, cleaned up as in `managingUnit.test.ts`:
  - `opens a personal draft on the active version`.
  - `a draft survives its transaction`: open and COMMIT on client A; `lockDraft` on a fresh client B finds it.
  - `refuses another owner`: `NotFoundError`.
  - `refuses a stale revision`: `DraftRevisionError` when expected is 0 after one `bumpRevision`.
  - `refuses a draft that is not personal`: set the status to `submitted` with SQL; `lockDraft(…, { requireStatus: 'personal' })` → `DraftNotEditableError`.
  - `discard removes rows and version and refuses a published edit`.
  - `two clients serialise on the draft lock`: client B's `lockDraft` waits until A commits. Assert by ordering with a `Promise.race` timeout of 300 ms while A holds the lock.
- [ ] **Step 2: Run** `npm run test -w @webatlas/versioning -- drafts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `drafts.ts`.** Read `draft_status`, `revision` and `ingested_by` as `ownerId`.
- [ ] **Step 4: Run** the test, then `npm run test -w @webatlas/versioning` and `npx tsc -p packages/versioning/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(versioning): mở, khoá, tăng số hiệu và huỷ bản nháp lưu bền`.

### Task 3: Diff, conflicts, resolution and rebase

**Files:**
- Create: `packages/versioning/src/rebase.ts`, `packages/versioning/src/rebase.test.ts`
- Modify: `packages/versioning/src/index.ts`

**Interfaces:**
- Consumes: `resolvedSql(layerKey, select)` (`resolve.ts`), `lockDraft`, `DraftRow` (Task 2).
- Produces:
  - `CONTENT_EXCLUDED_KEYS`: the nine keys from Global Constraints, `as const`.
  - `changedFeatures(client: PoolClient, layerKey: string, fromVersionId: string, toVersionId: string): Promise<Set<string>>`
    - Compares `to_jsonb(row) - CONTENT_EXCLUDED_KEYS` of the two resolved states by `external_id::text`.
    - An external_id present in only one side counts as changed.
    - One SQL statement: two `resolvedSql` CTEs and a `FULL OUTER JOIN`.
  - `touchedFeatures(client: PoolClient, layerKey: string, draftId: string): Promise<Set<string>>` — the external_ids stored in the draft.
  - `interface Conflict { externalId: string; base: Record<string, unknown> | null; current: Record<string, unknown> | null; draft: Record<string, unknown> }`
    - Each side is the content jsonb.
    - `base` is resolved at the draft's parent and `current` at the active version. Either is null when absent or a tombstone.
    - `draft` carries `deleted: true` when the draft removes the feature.
  - `listConflicts(client: PoolClient, layerKey: string, draftId: string): Promise<Conflict[]>` — computes touched ∩ changed(parent, active) minus the rows in `app.draft_resolutions` whose `against_version_id` equals the active id. Ordered by `externalId`. When the parent is the active version it returns `[]`.
  - `resolveConflict(client: PoolClient, layerKey: string, draftId: string, externalId: string, choice: 'mine' | 'theirs'): Promise<void>`
    - `theirs` deletes the draft's row for that external_id.
    - `mine` upserts `(draft_id, external_id, against_version_id = active, 'mine')`.
    - Throws `ConflictError` if the feature is not in the current conflict list.
  - `rebaseDraft(client: PoolClient, layerKey: string, draftId: string): Promise<{ rebased: boolean; conflicts: Conflict[] }>`
    - Parent equals active → `{ rebased: false, conflicts: [] }`.
    - Conflicts present → no change, and they are returned.
    - Otherwise: `UPDATE parent_version_id = active`, delete the draft's resolutions, `bumpRevision`, and return `{ rebased: true, conflicts: [] }`.
    - The caller holds the draft lock (`lockDraft`).

- [ ] **Step 1: Write the failing tests** in `rebase.test.ts`. Use synthetic dam features. Build each upstream change by publishing an edit version directly: insert rows into a new `edit` version, then `versionsService.activate`.
  - `no upstream change: nothing to rebase`.
  - `an unrelated upstream edit rebases cleanly`: the draft edits dam A, upstream edits dam B → `{ rebased: true }`, and the draft's parent is now active.
  - `the same feature edited on both sides is a conflict with all three states`: assert `base.name`, `current.name`, `draft.name`.
  - `theirs drops the draft change and the rebase then succeeds`.
  - `mine is remembered against this active version only`: resolve `mine` → rebase succeeds. When the upstream changes A again before the rebase, the conflict reappears.
  - `a feature deleted upstream conflicts; theirs drops it, mine restores it`: after `mine`, rebase, and publish with Task 4's `publishDraft` (or `activate` here), the feature is in the active view again.
  - `rebases across a re-ingest by content, not row id`: a new ingest root holds the same content for every dam except B. A draft that edits A rebases cleanly. A draft that edits B conflicts.
  - `creating different features on both sides does not conflict`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/versioning -- rebase`. Expected: FAIL.
- [ ] **Step 3: Implement `rebase.ts`.** Read the active version with `FOR NO KEY UPDATE` only in `publishDraft` (Task 4). Here a plain read is enough.
- [ ] **Step 4: Run** the test, `npm run test -w @webatlas/versioning`, and tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(versioning): so khác theo nội dung, xung đột theo từng đối tượng và dời gốc bản nháp`.

### Task 4: `publishDraft` replaces `commitEditDraft`

**Files:**
- Modify: `packages/versioning/src/service.ts`. Remove `openEditDraft`, `commitEditDraft` and `discardEditDraft`, and add `publishDraft`.
- Create: `packages/versioning/src/publish.test.ts`
- Modify: `packages/versioning/src/errors.ts`, `packages/versioning/src/index.ts`
- Modify: the callers of the removed methods outside `apps/api/src/modules/layers` (grep). The layers service is rewritten in Task 6. Until then, keep it compiling with a thin local shim. Task 6 deletes the shim.

**Interfaces:**
- Consumes: `lockDraft`, `rebaseDraft`, `Conflict` (Tasks 2–3), `activate`.
- Produces:
  - `class DraftConflictError extends StaleDraftError { constructor(public readonly conflicts: Conflict[]) }`, with the message `Bản nháp xung đột với dữ liệu đã xuất bản ở ${n} đối tượng.`
  - `versionsService(pg).publishDraft(client: PoolClient, layerKey: string, draftId: string, guard: (client: PoolClient) => Promise<void>): Promise<void>`, in this order:
    1. Lock the active row (`FOR NO KEY UPDATE`).
    2. `lockDraft(draftId)`.
    3. `rebaseDraft`; any conflicts → `DraftConflictError`.
    4. `await guard(client)`.
    5. `activate(layerKey, draftId)`.
    6. Set `draft_status = NULL`.
    7. Set `feature_count` (same rule as today: the stored rows after activate).
    8. Delete the draft's resolutions.

  `guard` is a required parameter, so TypeScript rejects a missing one.

- [ ] **Step 1: Write the failing tests** in `publish.test.ts`:
  - `publishes a clean draft and clears its status`.
  - `rebases before publishing when the layer moved on`.
  - `refuses with DraftConflictError listing the conflicts and activates nothing`.
  - `a throwing guard activates nothing and keeps the draft personal`.
  - `the guard sees the rebased draft`: inside the guard, the draft's parent equals the active id.
- [ ] **Step 2: Run** `npm run test -w @webatlas/versioning -- publish`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `grep -rn "openEditDraft\|commitEditDraft\|discardEditDraft" apps packages` and replace every caller outside the layers service.
- [ ] **Step 4: Run** `npm run test -w @webatlas/versioning`, `npm run test -w @webatlas/atlas-data`, the three tsc commands, and `npm run test -w @webatlas/api -- layers jurisdiction`. The shim keeps these green. Expected: PASS.
- [ ] **Step 5: Commit** `feat(versioning): xuất bản bản nháp — dời gốc, kiểm tra quyền rồi kích hoạt`.

### Task 5: Draft-scoped feature operations, one transaction each

**Files:**
- Create: `apps/api/src/modules/layers/draftOps.ts`. This is the core operation set on a client, with validation but no authorisation.
- Create: `apps/api/src/modules/layers/draftEditor.ts`. This is the durable wrapper, one transaction per operation.
- Modify: `apps/api/src/modules/layers/repository.ts`. `resolveEditSource` resolves through the draft's chain (`resolvedSql(layer, 'id')` with the draft id plus an `external_id` filter) instead of `is_current`.
- Modify: `apps/api/src/plugins/errorHandler.ts`. Map `DraftRevisionError` → 409 `DRAFT_CHANGED` and `DraftNotEditableError` → 409 `DRAFT_NOT_EDITABLE`, with the Global Constraints copy. Map `DraftConflictError` → 409 `STALE_EDIT` with `details: { conflicts: string[] }`.
- Test: `apps/api/src/modules/layers/draftEditor.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4. From P1, the types `FeatureInput`, `FeatureWarning`, `FeatureResult` (move them into `draftOps.ts`; `service.ts` re-exports them) and `prepare`, `placementWarnings`, `assertKnownUnit`, and the field error "Chọn đơn vị chủ quản" move from `service.ts` into `draftOps.ts` unchanged.
- Produces:
  - `draftOps.createInDraft(client: PoolClient, def: LayerDef, draftId: string, input: FeatureInput, actorId: string, tree: UnitTree): Promise<FeatureResult>`
  - `draftOps.updateInDraft(client, def, draftId, id: string, input, actorId, tree)`, with the same return.
  - `draftOps.removeInDraft(client, def, draftId, id: string, actorId): Promise<void>`
  - All three write audit rows exactly as today.
  - `draftEditor(pg: Pool)`:
    - `open(key: string, actor: CurrentUser): Promise<{ draftId: string; revision: number }>`
    - `create(key, draftId, input, actor, tree, opts?: { expectedRevision?: number }): Promise<{ feature; warnings; revision }>`
    - `update(key, draftId, id, input, actor, tree, opts?)`, with the same return.
    - `remove(key, draftId, id, actor, opts?): Promise<{ revision }>`
    - `discard(key, draftId, actor): Promise<void>`
    - Each call: BEGIN → `lockDraft(draftId, { ownerId: actor.id, expectedRevision, requireStatus: 'personal' })` → op → `bumpRevision` → COMMIT. Any error → ROLLBACK, release, rethrow.
    - The draft's `layerKey` must equal `key`; otherwise `NotFoundError`.

- [ ] **Step 1: Write the failing tests** in `draftEditor.test.ts`, live DB, cleaning up drafts, rows and audit rows:
  - `edits persist across connections and bump the revision`: open, create, update, then on a new pool client the draft rows exist and `revision === 2`.
  - `a refused operation leaves the draft and its revision untouched`: an update with an invalid geometry → 422, the revision is unchanged, and the earlier rows are intact.
  - `a stale expectedRevision is refused with DRAFT_CHANGED`: the code and the exact copy.
  - `another user's draft is not found`.
  - `a submitted draft refuses edits with DRAFT_NOT_EDITABLE`.
  - `personal drafts are not checked against jurisdiction`: a viewer with no group can open a draft and edit a dam managed by `51`.
  - `editing a feature not yet in the draft copies it from the draft's own state, not the newer active one`: open the draft, publish an upstream change to the same dam, update in the draft → the copied row carries the base name. The rebase then reports a conflict.
  - `discard removes the draft`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- draftEditor`. Expected: FAIL.
- [ ] **Step 3: Implement.** `draftOps` must not import `authorize`.
- [ ] **Step 4: Run** the test, `npm run test -w @webatlas/api -- layers jurisdiction`, and `npx tsc -p apps/api/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): sửa đối tượng trong bản nháp lưu bền, mỗi thao tác một giao dịch`.

### Task 6: Publish-time authorisation; direct writes on drafts; the session is gone

**Files:**
- Create: `apps/api/src/modules/layers/publishAccess.ts`
- Modify: `apps/api/src/modules/layers/service.ts`. Delete `editSession`, `singleChange`, `EditSession` and the Task 4 shim. `create`, `update` and `remove` become direct writes.
- Modify: `apps/api/src/modules/layers/controller.ts` only if the signatures change; they should not.
- Test: `apps/api/src/modules/layers/publishAccess.test.ts`. Delete or rewrite the edit-session cases in `apps/api/src/modules/layers/service.test.ts` so that they target `draftEditor` and `publishDraft`.

**Interfaces:**
- Consumes: `Access` (`{ user: CurrentUser; tree: UnitTree }`; move the type from `service.ts` into `publishAccess.ts`, and `service.ts` re-exports it, so the two files never import each other at runtime), `assertCan`, `touchedFeatures`, `draftOps`, `openDraft`, `publishDraft`.
- Produces:
  - `assertDraftPublishable(client: PoolClient, def: LayerDef, draftId: string, access: Access): Promise<void>`. For each touched external_id, read the draft row, and the active current row through `is_current` (after the rebase the parent is the active version):
    - **no current row and the draft row is not deleted:** create → `feature.create` + `submission.review` on the draft row's unit;
    - **draft row deleted:** delete → `feature.delete` + `submission.review` on the current unit (NULL → `VN`);
    - **otherwise:** update → `feature.update` + `submission.review` on the current unit, and on the draft row's unit when it differs.
    - It runs `assertKnownUnit` on every unit. Admin bypasses.
    - It throws the P1 errors unchanged (`NO_PERMISSION`, `OUT_OF_JURISDICTION`).
  - `featuresService(pg).create(key, input, access)`, `update(key, id, input, access)` and `remove(key, id, access)` keep P1's signatures and responses. One transaction: `openDraft(actor)` → the `draftOps` call → `publishDraft(…, guard = (c) => assertDraftPublishable(c, def, draftId, access))` → COMMIT. Any error → ROLLBACK, so no draft is left behind.

- [ ] **Step 1: Write the failing tests** in `publishAccess.test.ts`:
  - `publish checks the managing unit current at publish time`: open a durable draft as user P (rights on `48`) and edit dam D (unit `20194`). Admin then moves D to `51` and publishes. P's publish → rebase conflict, because D changed. After P resolves `mine`, publish → 403 `OUT_OF_JURISDICTION` for `51`.
  - `a multi-feature draft is refused whole when one feature is out of reach`: P's draft edits a `48` dam and a `51` dam → 403, and neither change is active.
  - `create, update and delete map to their permissions`: user E holds only `feature.update` + `submission.review` on `48`. A draft that creates a dam in `48` → 403 `NO_PERMISSION` for `feature.create`.
  - `changing the unit needs both units`.
  - `admin publishes anything`.
- [ ] **Step 2: Run** `npm run test -w @webatlas/api -- publishAccess`. Expected: FAIL.
- [ ] **Step 3: Implement `publishAccess.ts`** and rewrite the direct paths. Run `grep -rn "editSession\|singleChange" apps/api/src`; it must find nothing.
- [ ] **Step 4: Run** the full checks:
  - `npm run test:api`. All of P1's `layers`, `jurisdiction`, `unassigned` and assistant tests must pass unchanged.
  - `npm run test -w @webatlas/versioning`
  - `npm run test -w @webatlas/atlas-data`
  - the three tsc commands.

  Expected: all green. Paste the summary lines.
- [ ] **Step 5: Commit** `feat(api): kiểm tra quyền lúc xuất bản trên mọi đối tượng bản nháp chạm tới; bỏ phiên biên tập giữ giao dịch`.
