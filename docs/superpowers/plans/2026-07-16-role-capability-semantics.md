# Role → Capability Semantics (Roadmap 2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `editor` and `viewer` roles grant distinct, tested capabilities end-to-end — editor can write features, viewer gains authenticated feature-read — replacing today's admin-only reality.

**Architecture:** A single named capability-policy module (`capabilities.ts`) is the one source of truth for the role→route matrix; the layers/users route files reference its constants instead of inline `authorize('admin')`. The frontend editing slice is renamed `admin-editing` → `feature-editing` and its `RequireRole` gate widened to `['admin','editor']`. No DB change; the `authorize()` primitive and `app.user_role` enum already support all three roles. Backend stays the authorization boundary; `RequireRole` is UX only.

**Tech Stack:** Fastify + TypeScript (API), Vitest (`vitest run` via `-w <pkg>`), React 19 + TypeScript (web), oxlint.

**Design doc:** `docs/superpowers/specs/2026-07-15-role-capability-semantics-design.md`

## Global Constraints

- **Backend is the authorization boundary.** `RequireRole` and any hidden UI are UX only and must carry a comment saying so (design §2, §7 rule 2).
- **The role→capability matrix lives only in `capabilities.ts`.** Routes reference the named constants, never inline role literals (design §7 rule 1).
- **No DB/enum change** — `admin | editor | viewer` already exist (design §7 rule 3).
- **`authorize()` stays generic/variadic** — capability meaning lives in the constants, not the primitive (design §7 rule 5).
- **Capability matrix (design §2):** `CAN_READ_FEATURES = ['admin','editor','viewer']`; `CAN_WRITE_FEATURES = ['admin','editor']`; `CAN_MANAGE_USERS = ['admin']`. `GET /api/layers` stays fully public.
- **Test command:** API `npm test -w @webatlas/api`; web `npm test -w @webatlas/web`. Both run `vitest run`. API tests require the Postgres test DB up (the existing `layers.test.ts` already depends on it).
- **§3 persona metric-focus is non-normative** — it produces NO code in this plan.

---

### Task 1: Capability policy module

Create the single source of truth for the role→capability matrix and route the two existing admin-only bundles through it. Behavior is unchanged in this task for `users` (still admin) but `layers` write/read gates widen — the API tests that assert the new behavior come in Task 2, so here we only add the module and wire routes, keeping the suite green by not yet changing assertions.

**Files:**
- Create: `apps/api/src/hooks/capabilities.ts`
- Modify: `apps/api/src/modules/layers/routes.ts` (whole file, currently 12 lines)
- Modify: `apps/api/src/modules/users/routes.ts` (whole file, currently 11 lines)
- Test: `apps/api/src/hooks/capabilities.test.ts`

**Interfaces:**
- Consumes: `Role` from `apps/api/src/modules/users/repository` (`export type Role = 'admin' | 'editor' | 'viewer'`); `authorize(...roles: Role[])` from `apps/api/src/hooks/authorization`.
- Produces: `CAN_READ_FEATURES: readonly Role[]`, `CAN_WRITE_FEATURES: readonly Role[]`, `CAN_MANAGE_USERS: readonly Role[]` exported from `capabilities.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/hooks/capabilities.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CAN_READ_FEATURES, CAN_WRITE_FEATURES, CAN_MANAGE_USERS } from './capabilities';

describe('capability policy (role → capability matrix)', () => {
  it('read features: admin, editor, viewer', () => {
    expect([...CAN_READ_FEATURES].sort()).toEqual(['admin', 'editor', 'viewer']);
  });
  it('write features: admin, editor only', () => {
    expect([...CAN_WRITE_FEATURES].sort()).toEqual(['admin', 'editor']);
  });
  it('manage users: admin only', () => {
    expect([...CAN_MANAGE_USERS]).toEqual(['admin']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/api -- capabilities`
Expected: FAIL — cannot resolve `./capabilities` (module not found).

- [ ] **Step 3: Create the capability module**

Create `apps/api/src/hooks/capabilities.ts`:

```typescript
import type { Role } from '../modules/users/repository';

// Single source of truth for the role → capability matrix (design §2, §3.1).
// Routes reference these named sets; they never inline role literals.
export const CAN_READ_FEATURES: readonly Role[] = ['admin', 'editor', 'viewer'];
export const CAN_WRITE_FEATURES: readonly Role[] = ['admin', 'editor'];
export const CAN_MANAGE_USERS: readonly Role[] = ['admin'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/api -- capabilities`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the layers routes to the policy**

Replace the entire contents of `apps/api/src/modules/layers/routes.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { CAN_READ_FEATURES, CAN_WRITE_FEATURES } from '../../hooks/capabilities';
import { getLayers, listFeatures, createFeature, updateFeature, deleteFeature } from './controller';

export default async function layersRoutes(app: FastifyInstance) {
  const canRead = { preHandler: [app.authenticate, authorize(...CAN_READ_FEATURES)] };
  const canWrite = { preHandler: [app.authenticate, authorize(...CAN_WRITE_FEATURES)] };
  app.get('/layers', getLayers); // public metadata (INV-2 catalog)
  app.get('/layers/:key/features', canRead, listFeatures);
  app.post('/layers/:key/features', canWrite, createFeature);
  app.put('/layers/:key/features/:id', canWrite, updateFeature);
  app.delete('/layers/:key/features/:id', canWrite, deleteFeature);
}
```

- [ ] **Step 6: Wire the users routes to the policy**

Replace the entire contents of `apps/api/src/modules/users/routes.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { CAN_MANAGE_USERS } from '../../hooks/capabilities';
import { listUsers, createUser, updateUser, deleteUser } from './controller';

export default async function usersRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, authorize(...CAN_MANAGE_USERS)] };
  app.get('/', adminOnly, listUsers);
  app.post('/', adminOnly, createUser);
  app.put('/:id', adminOnly, updateUser);
  app.delete('/:id', adminOnly, deleteUser);
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/hooks/capabilities.ts apps/api/src/hooks/capabilities.test.ts apps/api/src/modules/layers/routes.ts apps/api/src/modules/users/routes.ts
git commit -m "feat(api): capability policy module; layers routes use editor/viewer gates"
```

---

### Task 2: API tests for the new role capabilities

Update `layers.test.ts` so it asserts the *new* matrix: editor can write, viewer can read but not write, anon is 401. This is where the old "editor → 403 on GET" assertion flips. Also confirm users routes still reject editor/viewer.

**Files:**
- Modify: `apps/api/src/modules/layers/layers.test.ts` (add VIEWER seed at line 9/21; rewrite the `rejects non-admin` test at lines 44-50; add an editor-write test)
- Modify: `apps/api/src/modules/users/users.test.ts` (add an assertion that viewer is 403 on `/api/users`, mirroring the existing editor assertion)

**Interfaces:**
- Consumes: `tokenFor(email)`, the `beforeAll` seed loop, and constants `ADMIN`/`EDITOR`/`PW` already in `layers.test.ts`; the `authorize(...)` behavior wired in Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a VIEWER seed to `layers.test.ts`**

In `apps/api/src/modules/layers/layers.test.ts`, add the constant after line 9 (`const EDITOR = ...`):

```typescript
const VIEWER = 'layers-viewer@webatlas.test';
```

And change the seed loop (line 21) from:

```typescript
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor']] as const) {
```

to:

```typescript
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor'], [VIEWER, 'viewer']] as const) {
```

(The `afterAll` cleanup already deletes `WHERE email LIKE 'layers-%@webatlas.test'`, so the viewer row is cleaned up — no cleanup change needed.)

- [ ] **Step 2: Replace the stale `rejects non-admin` test**

In the same file, replace the whole test block at lines 44-50:

```typescript
  it('rejects non-admin with 403 and anonymous with 401', async () => {
    const editorToken = await tokenFor(EDITOR);
    const forbidden = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: { authorization: `Bearer ${editorToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });
```

with:

```typescript
  it('viewer can read features but cannot write; anonymous is 401', async () => {
    const viewerToken = await tokenFor(VIEWER);
    const vAuth = { authorization: `Bearer ${viewerToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: vAuth });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: vAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: NAME } },
    });
    expect(write.statusCode).toBe(403);

    const anon = await app.inject({ method: 'GET', url: '/api/layers/dams/features' });
    expect(anon.statusCode).toBe(401);
  });

  it('editor can read and write features', async () => {
    const editorToken = await tokenFor(EDITOR);
    const eAuth = { authorization: `Bearer ${editorToken}` };

    const read = await app.inject({ method: 'GET', url: '/api/layers/dams/features', headers: eAuth });
    expect(read.statusCode).toBe(200);

    const create = await app.inject({
      method: 'POST', url: '/api/layers/dams/features', headers: eAuth,
      payload: { geometry: { type: 'Point', coordinates: [105.81, 21.01] }, properties: { name: NAME } },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().feature.id;

    const del = await app.inject({ method: 'DELETE', url: `/api/layers/dams/features/${id}`, headers: eAuth });
    expect(del.statusCode).toBe(204);
  });
```

(Both new tests reuse the existing `NAME` constant; the editor test cleans up its own row via DELETE, and `afterAll` also deletes any `water.dams WHERE name = NAME` as a backstop.)

- [ ] **Step 3: Run the layers tests to verify they pass**

Run: `npm test -w @webatlas/api -- layers`
Expected: PASS — the `layers metadata`, `viewer can read...`, `editor can read and write...`, `404 for unknown layer key`, and `admin creates...` tests all green.

- [ ] **Step 4: Add a viewer assertion to `users.test.ts`**

Open `apps/api/src/modules/users/users.test.ts`. It already seeds an editor and asserts editor → 403 on `GET /api/users`. Locate that editor assertion (search for `editorToken` and `/api/users`) and add, immediately after the editor `expect(...).toBe(403)` line, a viewer check. If the file does not already seed a viewer, add a `VIEWER = 'users-viewer@webatlas.test'` constant and include `[VIEWER, 'viewer']` in its seed loop (mirroring the pattern from Task 2 Step 1), then:

```typescript
    const viewerToken = await tokenFor(VIEWER);
    const viewerForbidden = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${viewerToken}` } });
    expect(viewerForbidden.statusCode).toBe(403);
```

Note: read `users.test.ts` first to match its exact `tokenFor`/seed helper names (they mirror `layers.test.ts` but confirm before editing). The `afterAll` there already cleans `users-%@webatlas.test`.

- [ ] **Step 5: Run the users tests to verify they pass**

Run: `npm test -w @webatlas/api -- users`
Expected: PASS — including the new viewer-403 assertion.

- [ ] **Step 6: Run the full API suite**

Run: `npm test -w @webatlas/api`
Expected: PASS — all API test files green (no regressions from the gate change).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/layers/layers.test.ts apps/api/src/modules/users/users.test.ts
git commit -m "test(api): editor writes, viewer reads-only, users stays admin-only"
```

---

### Task 3: Rename the editing slice and widen the frontend gate

Rename `features/admin-editing` → `features/feature-editing`, `AdminEditing` → `FeatureEditing`, update the one app-shell import, and widen the `RequireRole` gate to `['admin','editor']`. `RequireRole`/`apiClient`/session are unchanged.

**Files:**
- Rename (git mv, whole directory): `apps/web/src/features/admin-editing/` → `apps/web/src/features/feature-editing/`
- Modify: `apps/web/src/features/feature-editing/index.tsx` (the default export name + the `RequireRole` gate + the comment)
- Modify: `apps/web/src/app/App.tsx:4,28` (import path + JSX tag)
- Tests: the slice's own tests move with the directory (`git mv`); update any import string that referenced the old path.

**Interfaces:**
- Consumes: `RequireRole` (`role: Role | Role[]`) from `features/auth/ui/RequireRole` — unchanged.
- Produces: default export `FeatureEditing` from `features/feature-editing/index.tsx`, imported by `App.tsx`.

- [ ] **Step 1: Move the directory with git**

Run:

```bash
git mv apps/web/src/features/admin-editing apps/web/src/features/feature-editing
```

Expected: the directory (all `.ts`/`.tsx` including `index.tsx`, `index.test.tsx`, `model/`, `ui/`, `api/`) is now under `feature-editing/`. `git status` shows renames.

- [ ] **Step 2: Rename the component and widen the gate in `index.tsx`**

In `apps/web/src/features/feature-editing/index.tsx`, replace the final export block (currently lines ~120-129):

```tsx
// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// admin route); a user who forces this open still cannot perform admin API calls.
export default function AdminEditing() {
  return (
    <RequireRole role="admin">
      <EditToolbar />
      <EditExisting />
    </RequireRole>
  );
}
```

with:

```tsx
// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// write route); a viewer who forces this open still gets 403 on the API call.
// Editors and admins can edit features (design §2 CAN_WRITE_FEATURES).
export default function FeatureEditing() {
  return (
    <RequireRole role={['admin', 'editor']}>
      <EditToolbar />
      <EditExisting />
    </RequireRole>
  );
}
```

- [ ] **Step 3: Update the app-shell import and tag**

In `apps/web/src/app/App.tsx`, change line 4:

```tsx
import AdminEditing from '../features/admin-editing';
```

to:

```tsx
import FeatureEditing from '../features/feature-editing';
```

and change the usage at line 28:

```tsx
          <AdminEditing />
```

to:

```tsx
          <FeatureEditing />
```

- [ ] **Step 4: Fix any stale import strings inside the moved tests**

Run a search for the old path/name inside the moved slice:

```bash
git grep -n "admin-editing\|AdminEditing" -- apps/web/src
```

Expected after Steps 1-3: **no matches**. If any remain (e.g. a test that imported `../admin-editing` by relative path, or asserts the component name `AdminEditing`), update the string to `feature-editing` / `FeatureEditing`. (Relative imports *within* the moved directory are unaffected by the rename; only cross-directory or name references need fixing.)

- [ ] **Step 5: Update the RequireRole render test to cover editor (optional-but-cheap)**

Open `apps/web/src/features/auth/ui/RequireRole.test.tsx`. It currently tests `role="admin"` matching and a `viewer` non-match. Add a case that an array role admits `editor`, appending inside the `describe` block:

```tsx
  it('renders children when the role is in the allowed array', async () => {
    vi.resetModules();
    mockSession({ role: 'editor' });
    const { RequireRole: Fresh } = await import('./RequireRole');
    render(<Fresh role={['admin', 'editor']}><div>secret</div></Fresh>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the web suite**

Run: `npm test -w @webatlas/web`
Expected: PASS — all web tests green, including the moved slice tests and the new RequireRole array case.

- [ ] **Step 7: Typecheck / build the web app**

Run: `npm run build -w @webatlas/web`
Expected: `tsc -b` passes (no dangling references to the old module path/name), Vite build succeeds.

- [ ] **Step 8: Lint**

Run: `npm run lint -w @webatlas/web`
Expected: no new lint errors (oxlint clean, incl. no unused imports from the rename).

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): rename admin-editing -> feature-editing; gate widened to [admin,editor]"
```

---

### Task 4: Manual verification (/run)

Confirm the real stack behaves per the matrix. Not a code task — evidence-gathering per design §6.

**Files:** none (verification only).

- [ ] **Step 1: Bring the stack up**

Start Postgres/GeoServer/API/web per the repo's usual dev flow (Docker Compose + `npm run dev -w @webatlas/api` + `npm run dev -w @webatlas/web`). Confirm the map loads.

- [ ] **Step 2: Seed an editor and a viewer**

`create-admin.ts` only makes admins, so seed the other two roles directly. From the API workspace, run a one-off insert (adjust to the repo's script/psql convention), e.g. via `psql` on the running DB:

```sql
INSERT INTO app.users (email, password_hash, full_name, role)
VALUES
  ('editor@webatlas.test', crypt('editor-pass-123', gen_salt('bf')), 'Run Editor', 'editor'),
  ('viewer@webatlas.test', crypt('viewer-pass-123', gen_salt('bf')), 'Run Viewer', 'viewer');
```

If the project's password hashing is not pgcrypto-compatible, instead add a temporary `tsx` snippet mirroring `create-admin.ts` but taking a `--role` argument, or reuse `hashPassword` in a REPL. Confirm both users exist and are active.

- [ ] **Step 2b: Log in as editor and edit a feature**

Log in as `editor@webatlas.test`. Verify the editing toolbar is visible (gate admits editor). Draw or select a feature on an editable layer (e.g. a dam), change an attribute, Save. Expected: the write succeeds (201/200) and the change renders live via WFS refetch. Delete the test feature to clean up.

- [ ] **Step 3: Log in as viewer and confirm read-only**

Log out, log in as `viewer@webatlas.test`. Expected: the editing toolbar is **absent** (gate does not admit viewer). In the browser devtools/network, confirm a direct `GET /api/layers/dams/features` (with the viewer's token) returns **200**, and a manual `POST` to the same collection returns **403** — and the app stays logged in (403 keeps session).

- [ ] **Step 4: Confirm anonymous public is unchanged**

Log out. Expected: the public map still renders all thematic layers (GeoServer WFS), and `GET /api/layers` (catalog) returns 200 without a token. A `GET /api/layers/dams/features` without a token returns **401**.

- [ ] **Step 5: Clean up**

Remove the `@webatlas.test` editor/viewer rows:

```sql
DELETE FROM app.users WHERE email IN ('editor@webatlas.test', 'viewer@webatlas.test');
```

- [ ] **Step 6: Record the result**

Note in the PR/commit that /run passed: editor edits, viewer reads-only (403 on write, session kept), anon unchanged (401 on feature API, WFS map intact).

---

## Self-Review

**1. Spec coverage (design §1–§10):**
- §2 capability matrix (CAN_READ/WRITE_FEATURES, CAN_MANAGE_USERS) → Task 1 ✓
- §3 persona metric focus (non-normative) → intentionally no task ✓ (Global Constraints note)
- §4.1 capabilities.ts single source of truth → Task 1 Steps 3-4 ✓
- §4.2 layers routes per-route gates; §4.2 users routes reference policy → Task 1 Steps 5-6 ✓
- §4.3 rename slice + widen gate; RequireRole/apiClient unchanged → Task 3 ✓
- §5 data flow (JWT role already carried) → exercised by Task 2 + Task 4 ✓
- §6 error handling (401 anon, 403 viewer-write keeps session) → Task 2 Step 2 (401/403), Task 4 Step 3 (session kept) ✓
- §7 tests: editor writes, viewer reads/403-writes, anon 401, users admin-only, RequireRole editor/admin render → Task 2 + Task 3 Step 5 ✓
- §8 convention rules → Global Constraints + Task 1 (matrix in one place, authorize generic) ✓
- §9 scope (no DB change, no private layers) → honored; no migration task ✓

**2. Placeholder scan:** No TBD/TODO. Every code step shows full code; every run step shows the command + expected result. Task 2 Step 4 asks the implementer to read `users.test.ts` before editing (its helper names mirror `layers.test.ts` but aren't quoted verbatim here) — this is a real caution, not a placeholder; the code to add is given.

**3. Type/name consistency:** `CAN_READ_FEATURES`/`CAN_WRITE_FEATURES`/`CAN_MANAGE_USERS` defined in Task 1, consumed by name in Task 1 route wiring and asserted in Task 1 test. `Role` imported from `modules/users/repository` (verified export). `FeatureEditing` default export (Task 3 Step 2) consumed by `App.tsx` import (Task 3 Step 3). `tokenFor`/`NAME`/`ADMIN`/`EDITOR` reused from existing `layers.test.ts` (verified present). `authorize(...roles)` spread of a `readonly Role[]` is valid (variadic).

**4. Risks for the implementer:**
- **API tests need the test DB.** `layers.test.ts` already hits Postgres; the runner must have it up (same precondition as today). Not a new dependency.
- **`readonly Role[]` spread into `authorize(...)`:** `authorize(...roles: Role[])` accepts a spread of a readonly array in TS — fine. If strictness complains, widen the param to `readonly Role[]` in `authorization.ts` (one-line, no behavior change).
- **The rename is the churn-heavy step.** `git mv` the directory first (Step 1) so history follows; then fix references. Step 4's `git grep` is the guard that nothing dangles.
- **`create-admin.ts` can't seed editor/viewer** (hardcodes admin) — Task 4 Step 2 seeds via SQL/one-off instead; called out explicitly.
