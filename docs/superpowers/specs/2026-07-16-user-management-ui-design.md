# User-Management UI (Roadmap 1.1) — Design

**Date:** 2026-07-16
**Status:** Approved design — ready for implementation planning
**Roadmap:** Phase 1, item 1.1 (see `2026-07-15-product-roadmap.md` §3). First consumer of the now-meaningful roles (2.1) and the way editor/viewer get assigned to real people.
**Scope:** Add the missing frontend for the existing admin-only `/api/users` CRUD: an admin can list users, create a user (initial password + role), edit an existing user's name and role, and deactivate/reactivate a user. Frontend only — the API already exists and is admin-gated.

---

## 1. Context & goal

The control plane exists and is enforced server-side; only the UI is missing.

Verified API surface (`apps/api/src/modules/users/`, all four routes gated by `CAN_MANAGE_USERS = ['admin']` per roadmap 2.1):

- `GET /api/users` → `{ users: UserRow[] }`. `UserRow = { id, email, full_name: string|null, role, is_active, created_at, updated_at }`.
- `POST /api/users` → **201** `{ user }`. Body: `{ email (email), password (min 8), full_name? (string), role ('admin'|'editor'|'viewer', default 'viewer') }`.
- `PUT /api/users/:id` → **200** `{ user }`. Body: `{ full_name?: string|null, role?, is_active?: boolean }` (all optional; there is **no** email or password update path).
- `DELETE /api/users/:id` → **204** (hard delete).

Verified frontend patterns to mirror (`apps/web/src`):

- **FSD + MVP** slices: `api/` (only layer touching `apiRequest`), `model/` presenter (view-model + handlers, no JSX/fetch), `ui/*.view.tsx` (props-only), `index.tsx` container. Reference slices: `features/auth/`, `features/feature-editing/`.
- **`apiRequest` + `ApiError`** (`shared/api/apiClient.ts`): attaches JWT, throws typed `ApiError` (`.status`, `.code`, `.message`, `.details`), calls the global `onUnauthorized` on 401, returns `undefined` for 204.
- **TanStack Query** (`entities/layer/useLayerCatalog.ts` is the reference): `useQuery({ queryKey, queryFn })`; a shared `queryClient`.
- **`RequireRole`** (`features/auth/ui/RequireRole.tsx`): `role: Role | Role[]`, UX-only gate.
- **`useSession()`** (`entities/session/model/session.store.tsx`): exposes `currentUser`.
- **`shared/ui/Modal`** (`{ open, onClose, children }`) and **`shared/ui/ConfirmDialog`** already exist.
- **App shell** (`app/App.tsx`): single map view; admin/editor UI (`FeatureEditing`) overlays inside the `auth-widget-slot`. No router.

**Goal:** an admin opens a "Manage users" panel over the map, sees all users, and can create / edit-role-and-name / deactivate them — assigning editor/viewer to real people so 2.1's roles become usable in practice.

### Non-goals (deferred, YAGNI)

- **Hard delete** — the UI uses **deactivate** (`is_active=false`) as the removal path; it's reversible and preserves audit linkage. The `DELETE` endpoint is not surfaced.
- **Router / dedicated admin page** — a panel/modal over the existing shell, no react-router (that's arguably 2.2 adaptive-shell territory).
- **Email or password change** on existing users — the API has no such path; edit covers name + role + active only.
- **Password generation/one-time reveal** — the admin sets an initial password and shares it out-of-band.
- **Pagination / search / sort** — the user list is small; add later if it grows.

---

## 2. Architecture — a `user-management` feature slice

New slice mirroring `auth`/`feature-editing`:

```
apps/web/src/features/user-management/
  api/users.api.ts            # apiRequest wrappers (only layer touching apiClient)
  model/useUsersPresenter.ts  # TanStack query + mutations; view-model + handlers
  ui/
    UserTable.view.tsx        # passive table + row actions
    UserFormModal.view.tsx    # passive create/edit form (reuses shared/ui/Modal)
  index.tsx                   # RequireRole('admin') container wiring presenter -> views
```

Plus a small **shell change**: an admin-only "Manage users" toggle in `app/App.tsx`'s `auth-widget-slot` (beside `FeatureEditing`) that opens the container.

**Convention rules (enforced in review):**
1. Only `api/users.api.ts` imports `apiRequest`/`ApiError`. Presenter and views never do.
2. `*.view.tsx` are props-only — no `apiRequest`, no `useSession`, no query hooks.
3. Presenter returns a view-model + handlers; no JSX, no `fetch`.
4. Container is `RequireRole('admin')`-gated — UX only; the backend is the real authorization boundary (carry the standard comment).

---

## 3. API layer — `api/users.api.ts`

Thin wrappers over `apiRequest`, matching the verified surface:

```ts
import { apiRequest } from '../../../shared/api/apiClient';
import type { Role } from '../../../entities/session/model/session.types';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput { email: string; password: string; full_name?: string; role: Role; }
export interface UpdateUserPatch { full_name?: string | null; role?: Role; is_active?: boolean; }

export function listUsers(): Promise<AdminUser[]> {
  return apiRequest<{ users: AdminUser[] }>('/api/users').then((r) => r.users);
}
export function createUser(input: CreateUserInput): Promise<AdminUser> {
  return apiRequest<{ user: AdminUser }>('/api/users', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.user);
}
export function updateUser(id: string, patch: UpdateUserPatch): Promise<AdminUser> {
  return apiRequest<{ user: AdminUser }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) }).then((r) => r.user);
}
```

No `deleteUser` wrapper (deactivate is the removal path). `Role` reuses the shared union — no new role type.

---

## 4. Presenter — `model/useUsersPresenter.ts`

The view-model + handlers. Uses TanStack Query + the shared `queryClient` and `useSession` for the self-guard.

**Query:** `useQuery({ queryKey: ['users'], queryFn: listUsers })` → `users`, `isLoading`, list-level `error`.

**Mutations:** `useMutation` for create and update; each `onSuccess` → `queryClient.invalidateQueries({ queryKey: ['users'] })` so the table refetches (the query-cache analogue of the WFS-refetch-after-write pattern).

**View-model exposed to the container:**
- `users: AdminUser[]`, `loading: boolean`, `listError: string | null`.
- `modal: { mode: 'closed' | 'create' | 'edit'; user: AdminUser | null }`.
- Form state: `values` (`email`, `password`, `full_name`, `role`), `fieldErrors`, `formError`, `saving`, and `canSave` (create: valid email present + password length ≥ 8 [mirrors API `min(8)`]; edit: always saveable — name/role optional).
- `canModify(user): boolean` = `user.id !== currentUser?.id` (self-guard for role-change + deactivate).

**Handlers:** `openCreate()`, `openEdit(user)`, `closeModal()`, `setField(k, v)`, `submitForm()` (create → `createUser`; edit → `updateUser(id, { full_name, role })`), `toggleActive(user)` (→ `updateUser(user.id, { is_active: !user.is_active })`).

**`ApiError` mapping:** duplicate email — `ApiError.status === 409` (`code === 'CONFLICT'`, message "Email already in use", verified in `apps/api/src/errors/index.ts` + `users/service.ts`) → `fieldErrors.email = 'Email already in use'`; 400 with Zod `details` → per-field errors; 401 → handled globally by `onUnauthorized` (existing); 403 → `formError = 'You do not have permission'` (shouldn't occur behind the gate); network (`status === 0`) → `formError` from the message. List query error → `listError` ("Couldn't load users").

---

## 5. Views + shell wiring

### 5.1 `ui/UserTable.view.tsx` (passive)
Props: `users`, `canModify(user)`, `onEdit(user)`, `onToggleActive(user)`, `onNew()`, `loading`, `listError`.
- Columns: **email**, **full_name** (— if null), **role**, **status** (Active / Inactive badge from `is_active`), **created** (`created_at`, formatted).
- Per-row actions: **Edit** and **Deactivate**/**Activate** (label from `is_active`). Both **disabled when `!canModify(user)`** (the current admin's own row), with a title/tooltip "You can't change your own access."
- A **New user** button (calls `onNew`). Loading and error states rendered inline.

### 5.2 `ui/UserFormModal.view.tsx` (passive)
Reuses `shared/ui/Modal`. Props: `mode` (`'create'|'edit'`), `values`, `fieldErrors`, `formError`, `canSave`, `saving`, `onField`, `onSubmit`, `onClose`.
- **Create:** email + password + full_name + role (select of the three roles).
- **Edit:** full_name + role; **email shown read-only** (context, not editable — API has no email update); **no password field** (API has no password update).
- Field errors + form error rendered; Save disabled unless `canSave` and not `saving`.

### 5.3 Container — `index.tsx`
```
RequireRole('admin')  // UX gate ONLY; backend enforces admin on every /api/users route
  -> UserTable(view-model + handlers from useUsersPresenter)
  -> UserFormModal(open when modal.mode !== 'closed')
```

### 5.4 Shell — `app/App.tsx`
Add an admin-only **"Manage users"** button in the `auth-widget-slot` (beside `FeatureEditing`), wrapped in `RequireRole('admin')`, that toggles the `user-management` container's visibility (local `useState`, same pattern as the existing panel toggles). The container itself also carries `RequireRole('admin')` (defense in depth for the UX gate).

---

## 6. Data flow

1. Admin clicks **Manage users** → the container mounts; `useUsersPresenter` runs `listUsers` (JWT attached by `apiRequest`) → table renders.
2. **Create:** New user → modal (create) → fill email/password/name/role → Save → `createUser` (201) → `onSuccess` invalidates `['users']` → list refetches with the new row → modal closes.
3. **Edit:** Edit on a row → modal (edit, pre-filled name/role, email read-only) → change role/name → Save → `updateUser(id, {...})` (200) → invalidate → refetch → close.
4. **Deactivate/Activate:** click the row toggle → `updateUser(id, { is_active })` → invalidate → refetch → the badge flips. Disabled on the admin's own row.
5. Any 401 → the existing global `onUnauthorized` clears the session and prompts login.

---

## 7. Error handling

- **List load fails** → inline "Couldn't load users" with a retry (refetch).
- **Create/edit fails** → `ApiError` mapped in the presenter: duplicate email → email field error; 400 Zod → field errors; other → form-level error. The modal stays open with the message; no data lost.
- **Deactivate fails** → inline/toast error; the row's state is unchanged (refetch reconciles).
- **403** behind the admin gate shouldn't happen, but is surfaced (not a logout) per the auth-foundation 403-keeps-session rule.

---

## 8. Testing (mirrors existing slice tests)

- **Presenter** (`useUsersPresenter`, mocked `users.api` + mocked `useSession`): list renders; create success → `createUser` called + `['users']` invalidated + modal closed; edit → `updateUser` with `{full_name, role}`; `toggleActive` → `updateUser` with flipped `is_active`; **self-guard** (`canModify` false for `currentUser.id`); `ApiError` mapping incl. duplicate email (`status 409` / `code CONFLICT` → email field error) and short password (`canSave` false when password length < 8).
- **Views:** `UserTable` (renders rows, Inactive badge, own-row actions disabled via `canModify`); `UserFormModal` (create shows password, edit hides password + shows read-only email, Save disabled until `canSave`).
- **Container:** renders for `role: 'admin'`; hidden for `editor`/`viewer`/anon (RequireRole).
- **Manual `/run`:** log in as admin → Manage users → create an editor (`@webatlas.test`) → edit its role to viewer → deactivate it (badge flips) → reactivate → confirm own-row Edit/Deactivate are disabled. Log in as editor → the Manage-users button is absent. Clean up the test user (deactivate or DB delete).

---

## 9. Scope boundaries (YAGNI — deferred)

- Hard delete (`DELETE /api/users/:id`) — deactivate is the removal path.
- Router / dedicated `/admin/users` page — panel over the shell for now (revisit in 2.2).
- Email/password change on existing users; password reset flow — no API path exists.
- Password generation + one-time reveal.
- Pagination, search, column sort — the list is small.

---

## 10. Follow-on

- **2.2 Adaptive shell** may relocate this from a shell toggle into a dedicated Management panel/workspace; the slice (api/presenter/views) is reusable as-is — only the mount point changes.
- A future password-reset endpoint would add an "edit password" affordance to `UserFormModal` with no change to the list/create paths.
