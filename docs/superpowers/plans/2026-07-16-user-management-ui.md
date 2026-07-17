# User-Management UI (Roadmap 1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin-only frontend for the existing `/api/users` CRUD — list, create (initial password + role), edit (name + role), and deactivate/reactivate users — as a panel over the map shell.

**Architecture:** A new FSD+MVP slice `features/user-management/` mirroring `features/feature-editing/`: `api/users.api.ts` (only layer touching `apiRequest`), `model/useUsersPresenter.ts` (TanStack Query list + create/update mutations, view-model + handlers), `ui/UserTable.view.tsx` + `ui/UserFormModal.view.tsx` (props-only), and a `RequireRole('admin')` container `index.tsx`. An admin-only "Manage users" toggle in `app/App.tsx` opens it. No router; deactivate (not hard-delete) is the removal path.

**Tech Stack:** React 19 + TypeScript, TanStack Query (`@tanstack/react-query`), Vitest + Testing Library + `@testing-library/user-event`, oxlint. No DB/API change.

**Design doc:** `docs/superpowers/specs/2026-07-16-user-management-ui-design.md`

## Global Constraints

- **Only `api/users.api.ts` imports `apiRequest`/`ApiError`.** Presenter and views never do (design §2 rule 1).
- **`*.view.tsx` are props-only** — no `apiRequest`, no `useSession`, no query hooks (design §2 rule 2).
- **Presenter returns a view-model + handlers** — no JSX, no `fetch` (design §2 rule 3).
- **Container is `RequireRole('admin')`-gated** — UX only; the backend enforces admin on every `/api/users` route (design §2 rule 4). Carry the standard "UX gate ONLY" comment.
- **Deactivate, not delete** — no `deleteUser` wrapper; removal = `updateUser(id, { is_active: false })` (design §1, §9).
- **Self-lockout guard:** `canModify(user) = user.id !== currentUser.id`; the admin's own row disables role-change + deactivate (design §4).
- **Password client-check mirrors the API:** create requires password length ≥ 8 (API `z.string().min(8)`); email required (design §4).
- **Edit mode:** email read-only, NO password field (API has no email/password update path) (design §5.2).
- **Role type** reuses the shared union `Role` from `entities/session/model/session.types` — no new role type.
- **Test conventions (from the repo):** api tests `vi.mock('.../shared/api/apiClient', () => ({ apiRequest: vi.fn() }))`; presenter tests `vi.mock` the query hooks + session store (no `QueryClientProvider` wrapper is used anywhere in this repo); view tests render props-only with `@testing-library/user-event`; container tests `vi.mock` the session store for role.
- **Test command:** `npm test -w @webatlas/web` (vitest, no DB). Build: `npm run build -w @webatlas/web`. Lint: `npm run lint -w @webatlas/web`.

---

### Task 1: API layer — `users.api.ts`

**Files:**
- Create: `apps/web/src/features/user-management/api/users.api.ts`
- Test: `apps/web/src/features/user-management/api/users.api.test.ts`

**Interfaces:**
- Consumes: `apiRequest` from `shared/api/apiClient`; `Role` from `entities/session/model/session.types`.
- Produces: `AdminUser`, `CreateUserInput`, `UpdateUserPatch` types; `listUsers()`, `createUser(input)`, `updateUser(id, patch)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/user-management/api/users.api.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../shared/api/apiClient', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../shared/api/apiClient';
import { listUsers, createUser, updateUser } from './users.api';

const mockApi = apiRequest as ReturnType<typeof vi.fn>;
afterEach(() => vi.clearAllMocks());

describe('listUsers', () => {
  it('GETs /api/users and unwraps the users array', async () => {
    mockApi.mockResolvedValue({ users: [{ id: 'u1', email: 'a@b.test' }] });
    const out = await listUsers();
    expect(out).toEqual([{ id: 'u1', email: 'a@b.test' }]);
    expect(mockApi.mock.calls[0][0]).toBe('/api/users');
  });
});

describe('createUser', () => {
  it('POSTs the input and unwraps user', async () => {
    mockApi.mockResolvedValue({ user: { id: 'new' } });
    const input = { email: 'e@b.test', password: 'password1', full_name: 'E', role: 'editor' as const };
    const out = await createUser(input);
    expect(out).toEqual({ id: 'new' });
    const [path, init] = mockApi.mock.calls[0];
    expect(path).toBe('/api/users');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(input);
  });
});

describe('updateUser', () => {
  it('PUTs the patch to :id and unwraps user', async () => {
    mockApi.mockResolvedValue({ user: { id: 'u1' } });
    const out = await updateUser('u1', { is_active: false });
    expect(out).toEqual({ id: 'u1' });
    const [path, init] = mockApi.mock.calls[0];
    expect(path).toBe('/api/users/u1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ is_active: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- users.api`
Expected: FAIL — cannot resolve `./users.api`.

- [ ] **Step 3: Implement `users.api.ts`**

Create `apps/web/src/features/user-management/api/users.api.ts`:

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
  return apiRequest<{ user: AdminUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.user);
}

export function updateUser(id: string, patch: UpdateUserPatch): Promise<AdminUser> {
  return apiRequest<{ user: AdminUser }>(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  }).then((r) => r.user);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- users.api`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/user-management/api/
git commit -m "feat(web): user-management api wrappers (list/create/update users)"
```

---

### Task 2: Presenter — `useUsersPresenter.ts`

The view-model + handlers: TanStack Query list, create/update mutations (invalidate `['users']`), modal state, validation, `ApiError` mapping, and the self-guard. Tests mock the query hooks + session (no real QueryClient, matching repo convention).

**Files:**
- Create: `apps/web/src/features/user-management/model/useUsersPresenter.ts`
- Test: `apps/web/src/features/user-management/model/useUsersPresenter.test.ts`

**Interfaces:**
- Consumes: `listUsers`/`createUser`/`updateUser`/`AdminUser` (Task 1); `useSession` from `entities/session/model/session.store`; `queryClient` from `shared/api/queryClient`; `useQuery`/`useMutation` from `@tanstack/react-query`; `ApiError` from `shared/api/apiClient` (for `instanceof` narrowing in mapping — allowed here because the presenter maps errors; the wrappers throw `ApiError`). NOTE: importing the `ApiError` *type/class* for `instanceof` is permitted in the presenter per design §4; only `apiRequest` calls are forbidden outside `api/`.
- Produces: `useUsersPresenter()` returning `{ users, loading, listError, modal, values, fieldErrors, formError, canSave, saving, canModify, openCreate, openEdit, closeModal, setField, submitForm, toggleActive }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/user-management/model/useUsersPresenter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const listUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
vi.mock('../api/users.api', () => ({
  listUsers: () => listUsers(),
  createUser: (i: unknown) => createUser(i),
  updateUser: (id: string, p: unknown) => updateUser(id, p),
}));

const invalidate = vi.fn();
vi.mock('../../../shared/api/queryClient', () => ({ queryClient: { invalidateQueries: (a: unknown) => invalidate(a) } }));

vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin' } }),
}));

// Mock TanStack: useQuery returns our list; useMutation returns a mutateAsync that calls the fn + onSuccess.
const rows = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '', updated_at: '' },
  { id: 'u2', email: 'ed@b.test', full_name: 'Ed', role: 'editor', is_active: true, created_at: '', updated_at: '' },
];
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: rows, isLoading: false, error: null }),
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    mutateAsync: async (v: unknown) => { const r = await opts.mutationFn(v); opts.onSuccess?.(); return r; },
    isPending: false,
  }),
}));

import { useUsersPresenter } from './useUsersPresenter';

beforeEach(() => { listUsers.mockReset(); createUser.mockReset(); updateUser.mockReset(); invalidate.mockReset(); });

describe('useUsersPresenter', () => {
  it('exposes the user list', () => {
    const { result } = renderHook(() => useUsersPresenter());
    expect(result.current.users.map((u) => u.id)).toEqual(['me', 'u2']);
  });

  it('self-guard: cannot modify own row, can modify others', () => {
    const { result } = renderHook(() => useUsersPresenter());
    expect(result.current.canModify(rows[0])).toBe(false); // me
    expect(result.current.canModify(rows[1])).toBe(true);  // u2
  });

  it('create requires email + password >= 8', () => {
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setField('email', 'x@b.test'));
    act(() => result.current.setField('password', 'short')); // 5 chars
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setField('password', 'longenough'));
    expect(result.current.canSave).toBe(true);
  });

  it('submitting create calls createUser and invalidates users, then closes', async () => {
    createUser.mockResolvedValue({ id: 'new' });
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'n@b.test'); result.current.setField('password', 'longenough'); result.current.setField('role', 'viewer'); });
    await act(async () => { await result.current.submitForm(); });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'n@b.test', password: 'longenough', role: 'viewer' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(result.current.modal.mode).toBe('closed');
  });

  it('toggleActive flips is_active via updateUser', async () => {
    updateUser.mockResolvedValue({ id: 'u2' });
    const { result } = renderHook(() => useUsersPresenter());
    await act(async () => { await result.current.toggleActive(rows[1]); });
    expect(updateUser).toHaveBeenCalledWith('u2', { is_active: false });
  });

  it('maps a 409 CONFLICT on create to an email field error', async () => {
    const { ApiError } = await import('../../../shared/api/apiClient');
    createUser.mockRejectedValue(new ApiError(409, 'CONFLICT', 'Email already in use'));
    const { result } = renderHook(() => useUsersPresenter());
    act(() => result.current.openCreate());
    act(() => { result.current.setField('email', 'dupe@b.test'); result.current.setField('password', 'longenough'); });
    await act(async () => { await result.current.submitForm(); });
    expect(result.current.fieldErrors.email).toBe('Email already in use');
    expect(result.current.modal.mode).toBe('create'); // stays open
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- useUsersPresenter`
Expected: FAIL — cannot resolve `./useUsersPresenter`.

- [ ] **Step 3: Implement `useUsersPresenter.ts`**

Create `apps/web/src/features/user-management/model/useUsersPresenter.ts`:

```ts
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '../../../shared/api/queryClient';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';
import type { Role } from '../../../entities/session/model/session.types';
import { listUsers, createUser, updateUser, type AdminUser } from '../api/users.api';

type ModalState = { mode: 'closed' | 'create' | 'edit'; user: AdminUser | null };
interface FormValues { email: string; password: string; full_name: string; role: Role; }
const EMPTY: FormValues = { email: '', password: '', full_name: '', role: 'viewer' };

function mapError(e: unknown, setFieldErrors: (f: Record<string, string>) => void, setFormError: (s: string) => void) {
  if (e instanceof ApiError) {
    if (e.status === 409) { setFieldErrors({ email: 'Email already in use' }); return; }
    if (e.status === 400 && e.details && typeof e.details === 'object') {
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.details as Record<string, unknown>)) {
        fe[k] = Array.isArray(v) ? String(v[0]) : String(v);
      }
      setFieldErrors(fe); return;
    }
    if (e.status === 403) { setFormError('You do not have permission'); return; }
    setFormError(e.message); return;
  }
  setFormError(e instanceof Error ? e.message : 'Something went wrong');
}

export function useUsersPresenter() {
  const { currentUser } = useSession();
  const query = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const [modal, setModal] = useState<ModalState>({ mode: 'closed', user: null });
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const createMut = useMutation({ mutationFn: createUser, onSuccess: invalidate });
  const updateMut = useMutation({ mutationFn: (v: { id: string; patch: Parameters<typeof updateUser>[1] }) => updateUser(v.id, v.patch), onSuccess: invalidate });

  const openCreate = () => { setValues(EMPTY); setFieldErrors({}); setFormError(null); setModal({ mode: 'create', user: null }); };
  const openEdit = (user: AdminUser) => {
    setValues({ email: user.email, password: '', full_name: user.full_name ?? '', role: user.role });
    setFieldErrors({}); setFormError(null); setModal({ mode: 'edit', user });
  };
  const closeModal = () => setModal({ mode: 'closed', user: null });
  const setField = (k: keyof FormValues, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const canModify = (user: AdminUser) => user.id !== currentUser?.id;

  const canSave =
    modal.mode === 'edit' ||
    (modal.mode === 'create' && /\S+@\S+\.\S+/.test(values.email) && values.password.length >= 8);

  const submitForm = async () => {
    setFieldErrors({}); setFormError(null);
    try {
      if (modal.mode === 'create') {
        await createMut.mutateAsync({
          email: values.email, password: values.password,
          full_name: values.full_name || undefined, role: values.role,
        });
      } else if (modal.mode === 'edit' && modal.user) {
        await updateMut.mutateAsync({ id: modal.user.id, patch: { full_name: values.full_name || null, role: values.role } });
      }
      closeModal();
    } catch (e) {
      mapError(e, setFieldErrors, setFormError);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    try {
      await updateMut.mutateAsync({ id: user.id, patch: { is_active: !user.is_active } });
    } catch (e) {
      mapError(e, () => {}, setFormError);
    }
  };

  return {
    users: query.data ?? [],
    loading: query.isLoading,
    listError: query.error ? "Couldn't load users" : null,
    modal, values, fieldErrors, formError,
    saving: createMut.isPending || updateMut.isPending,
    canSave, canModify,
    openCreate, openEdit, closeModal, setField, submitForm, toggleActive,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- useUsersPresenter`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/user-management/model/
git commit -m "feat(web): useUsersPresenter (list/create/edit/deactivate + self-guard + error mapping)"
```

---

### Task 3: Views — `UserTable.view.tsx` + `UserFormModal.view.tsx`

Passive, props-only. Table with row actions (disabled on own row); create/edit modal reusing `shared/ui/Modal`.

**Files:**
- Create: `apps/web/src/features/user-management/ui/UserTable.view.tsx`
- Create: `apps/web/src/features/user-management/ui/UserFormModal.view.tsx`
- Test: `apps/web/src/features/user-management/ui/UserTable.view.test.tsx`
- Test: `apps/web/src/features/user-management/ui/UserFormModal.view.test.tsx`

**Interfaces:**
- Consumes: `AdminUser` (Task 1); `Modal` from `shared/ui/Modal`; `Role` from session types.
- Produces: `UserTableView` (props: `users`, `canModify`, `onEdit`, `onToggleActive`, `onNew`, `loading`, `listError`); `UserFormModalView` (props: `open`, `mode`, `values`, `fieldErrors`, `formError`, `canSave`, `saving`, `onField`, `onSubmit`, `onClose`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/user-management/ui/UserTable.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserTableView } from './UserTable.view';
import type { AdminUser } from '../api/users.api';

const users: AdminUser[] = [
  { id: 'me', email: 'me@b.test', full_name: 'Me', role: 'admin', is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '' },
  { id: 'u2', email: 'ed@b.test', full_name: null, role: 'editor', is_active: false, created_at: '2026-01-02T00:00:00Z', updated_at: '' },
];

describe('UserTableView', () => {
  it('renders a row per user with role and an inactive badge', () => {
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} />);
    expect(screen.getByText('me@b.test')).toBeInTheDocument();
    expect(screen.getByText('ed@b.test')).toBeInTheDocument();
    expect(screen.getByText(/inactive/i)).toBeInTheDocument();
  });

  it('disables Edit/Deactivate on a row that cannot be modified', () => {
    const canModify = (u: AdminUser) => u.id !== 'me';
    render(<UserTableView users={users} canModify={canModify} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={vi.fn()} loading={false} listError={null} />);
    // the "me" row's edit button is disabled
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    expect(editButtons[0]).toBeDisabled();
  });

  it('calls onNew when the New user button is clicked', async () => {
    const onNew = vi.fn();
    render(<UserTableView users={users} canModify={() => true} onEdit={vi.fn()} onToggleActive={vi.fn()} onNew={onNew} loading={false} listError={null} />);
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    expect(onNew).toHaveBeenCalled();
  });
});
```

Create `apps/web/src/features/user-management/ui/UserFormModal.view.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserFormModalView } from './UserFormModal.view';

const base = {
  values: { email: 'e@b.test', password: '', full_name: 'E', role: 'viewer' as const },
  fieldErrors: {}, formError: null, canSave: true, saving: false,
  onField: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('UserFormModalView', () => {
  it('create mode shows a password field', () => {
    render(<UserFormModalView open mode="create" {...base} />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('edit mode hides password and shows email read-only', () => {
    render(<UserFormModalView open mode="edit" {...base} />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('readonly');
  });

  it('disables Save when canSave is false', () => {
    render(<UserFormModalView open mode="create" {...base} canSave={false} />);
    expect(screen.getByRole('button', { name: /save|create/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @webatlas/web -- UserTable.view UserFormModal.view`
Expected: FAIL — cannot resolve the view modules.

- [ ] **Step 3: Implement `UserTable.view.tsx`**

Create `apps/web/src/features/user-management/ui/UserTable.view.tsx`:

```tsx
import type { AdminUser } from '../api/users.api';

export function UserTableView({ users, canModify, onEdit, onToggleActive, onNew, loading, listError }: {
  users: AdminUser[];
  canModify: (u: AdminUser) => boolean;
  onEdit: (u: AdminUser) => void;
  onToggleActive: (u: AdminUser) => void;
  onNew: () => void;
  loading: boolean;
  listError: string | null;
}) {
  return (
    <div className="user-mgmt">
      <div className="user-mgmt-header">
        <h2>Users</h2>
        <button type="button" className="user-new-btn" onClick={onNew}>New user</button>
      </div>
      {listError && <p className="user-mgmt-error" role="alert">{listError}</p>}
      {loading ? (
        <p>Loading users…</p>
      ) : (
        <table className="user-table">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const locked = !canModify(u);
              const title = locked ? "You can't change your own access" : undefined;
              return (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.full_name ?? '—'}</td>
                  <td>{u.role}</td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button type="button" onClick={() => onEdit(u)} disabled={locked} title={title}>Edit</button>
                    <button type="button" onClick={() => onToggleActive(u)} disabled={locked} title={title}>
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `UserFormModal.view.tsx`**

Create `apps/web/src/features/user-management/ui/UserFormModal.view.tsx`:

```tsx
import { Modal } from '../../../shared/ui/Modal';
import type { Role } from '../../../entities/session/model/session.types';

interface Values { email: string; password: string; full_name: string; role: Role; }

export function UserFormModalView({ open, mode, values, fieldErrors, formError, canSave, saving, onField, onSubmit, onClose }: {
  open: boolean;
  mode: 'create' | 'edit';
  values: Values;
  fieldErrors: Record<string, string>;
  formError: string | null;
  canSave: boolean;
  saving: boolean;
  onField: (k: keyof Values, v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="user-form">
        <h3>{mode === 'create' ? 'New user' : 'Edit user'}</h3>

        <label htmlFor="uf-email">Email</label>
        <input
          id="uf-email" type="email" value={values.email}
          readOnly={mode === 'edit'}
          onChange={(e) => onField('email', e.target.value)}
        />
        {fieldErrors.email && <p className="field-error" role="alert">{fieldErrors.email}</p>}

        {mode === 'create' && (
          <>
            <label htmlFor="uf-password">Password</label>
            <input id="uf-password" type="password" value={values.password} onChange={(e) => onField('password', e.target.value)} />
            {fieldErrors.password && <p className="field-error" role="alert">{fieldErrors.password}</p>}
          </>
        )}

        <label htmlFor="uf-name">Full name</label>
        <input id="uf-name" type="text" value={values.full_name} onChange={(e) => onField('full_name', e.target.value)} />

        <label htmlFor="uf-role">Role</label>
        <select id="uf-role" value={values.role} onChange={(e) => onField('role', e.target.value)}>
          <option value="admin">admin</option>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>

        {formError && <p className="form-error" role="alert">{formError}</p>}

        <div className="user-form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSave || saving}>{mode === 'create' ? 'Create' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w @webatlas/web -- UserTable.view UserFormModal.view`
Expected: PASS (6 tests total).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/user-management/ui/
git commit -m "feat(web): UserTable + UserFormModal views (props-only, own-row locked, edit hides password)"
```

---

### Task 4: Container + shell wiring

Wire the presenter to the views under `RequireRole('admin')`, and add the admin-only "Manage users" toggle to the app shell.

**Files:**
- Create: `apps/web/src/features/user-management/index.tsx`
- Test: `apps/web/src/features/user-management/index.test.tsx`
- Modify: `apps/web/src/app/App.tsx` (add the toggle in the `auth-widget-slot`)

**Interfaces:**
- Consumes: `useUsersPresenter` (Task 2); `UserTableView`/`UserFormModalView` (Task 3); `RequireRole` from `features/auth/ui/RequireRole`.
- Produces: default export `UserManagement` (a self-gated container that renders when `open`), consumed by `App.tsx`.

- [ ] **Step 1: Write the failing container test**

Create `apps/web/src/features/user-management/index.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// admin session so RequireRole passes
vi.mock('../../entities/session/model/session.store', () => ({
  useSession: () => ({ currentUser: { id: 'me', email: 'a@b.test', full_name: 'A', role: 'admin' }, status: 'authenticated' }),
}));
// presenter stub: one user, closed modal
vi.mock('./model/useUsersPresenter', () => ({
  useUsersPresenter: () => ({
    users: [{ id: 'u2', email: 'ed@b.test', full_name: 'Ed', role: 'editor', is_active: true, created_at: '', updated_at: '' }],
    loading: false, listError: null,
    modal: { mode: 'closed', user: null }, values: { email: '', password: '', full_name: '', role: 'viewer' },
    fieldErrors: {}, formError: null, saving: false, canSave: false,
    canModify: () => true, openCreate: vi.fn(), openEdit: vi.fn(), closeModal: vi.fn(),
    setField: vi.fn(), submitForm: vi.fn(), toggleActive: vi.fn(),
  }),
}));

import UserManagement from './index';

describe('UserManagement container', () => {
  it('renders the user table for an admin when open', () => {
    render(<UserManagement open onClose={vi.fn()} />);
    expect(screen.getByText('ed@b.test')).toBeInTheDocument();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<UserManagement open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @webatlas/web -- user-management/index`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement `index.tsx`**

Create `apps/web/src/features/user-management/index.tsx`:

```tsx
import { RequireRole } from '../auth/ui/RequireRole';
import { useUsersPresenter } from './model/useUsersPresenter';
import { UserTableView } from './ui/UserTable.view';
import { UserFormModalView } from './ui/UserFormModal.view';

function Panel({ onClose }: { onClose: () => void }) {
  const p = useUsersPresenter();
  return (
    <div className="user-mgmt-panel glass-panel">
      <button type="button" className="user-mgmt-close" onClick={onClose}>Close</button>
      <UserTableView
        users={p.users} canModify={p.canModify}
        onEdit={p.openEdit} onToggleActive={p.toggleActive} onNew={p.openCreate}
        loading={p.loading} listError={p.listError}
      />
      <UserFormModalView
        open={p.modal.mode !== 'closed'}
        mode={p.modal.mode === 'edit' ? 'edit' : 'create'}
        values={p.values} fieldErrors={p.fieldErrors} formError={p.formError}
        canSave={p.canSave} saving={p.saving}
        onField={p.setField} onSubmit={p.submitForm} onClose={p.closeModal}
      />
    </div>
  );
}

// UX gate ONLY. Real authorization is enforced by the backend (admin on every
// /api/users route); a non-admin who forces this open still gets 401/403.
export default function UserManagement({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <RequireRole role="admin">
      <Panel onClose={onClose} />
    </RequireRole>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @webatlas/web -- user-management/index`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the toggle into `App.tsx`**

In `apps/web/src/app/App.tsx`:

Add the import after the `FeatureEditing` import (line 4):

```tsx
import UserManagement from '../features/user-management';
```

Add the `RequireRole` import (it is not yet imported in App.tsx) after the `UserManagement` import:

```tsx
import { RequireRole } from '../features/auth/ui/RequireRole';
```

Add a state hook next to the existing `panelsVisible` state (after line 17):

```tsx
  const [usersOpen, setUsersOpen] = useState(false);
```

Replace the `auth-widget-slot` block (currently lines 26-29):

```tsx
        <div className="auth-widget-slot">
          <AuthWidget />
          <FeatureEditing />
        </div>
```

with:

```tsx
        <div className="auth-widget-slot">
          <AuthWidget />
          <FeatureEditing />
          <RequireRole role="admin">
            <button type="button" className="manage-users-btn glass-panel" onClick={() => setUsersOpen(true)}>
              Manage users
            </button>
          </RequireRole>
        </div>

        <UserManagement open={usersOpen} onClose={() => setUsersOpen(false)} />
```

- [ ] **Step 6: Run the full web suite + build + lint**

Run: `npm test -w @webatlas/web`
Expected: PASS — all web tests including the new slice.

Run: `npm run build -w @webatlas/web`
Expected: `tsc -b` + vite build succeed.

Run: `npm run lint -w @webatlas/web`
Expected: no new lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/user-management/index.tsx apps/web/src/features/user-management/index.test.tsx apps/web/src/app/App.tsx
git commit -m "feat(web): user-management container + admin Manage-users toggle on the shell"
```

---

### Task 5: Manual verification (/run)

Confirm the real flow. Not a code task — evidence-gathering per design §8.

**Files:** none.

- [ ] **Step 1: Bring the stack up + start web**

Start Postgres (`docker compose -f infra/docker-compose.yml up -d db`), the API (`npm run dev -w @webatlas/api`), and the web app (`npm run dev -w @webatlas/web`). Ensure an admin account exists (`npm run create-admin -w @webatlas/api -- --email admin@webatlas.test --password admin-pass-123`).

- [ ] **Step 2: Admin flow**

Log in as the admin → click **Manage users** → the panel lists users. Create a new user (`ed@webatlas.test`, password ≥ 8, role editor) → it appears in the table. Edit it → change role to viewer → saved. Click **Deactivate** on that row → badge flips to Inactive; **Activate** → back to Active. Confirm your OWN row's Edit/Deactivate are disabled with the tooltip.

- [ ] **Step 3: Non-admin flow**

Log out, log in as the created editor (reactivate it first if needed) → confirm the **Manage users** button is ABSENT (RequireRole hides it). Optionally confirm a direct `GET /api/users` with the editor token returns 403 (from 2.1).

- [ ] **Step 4: Clean up**

Delete the test user row (or leave deactivated). Note the /run result: admin can list/create/edit/deactivate; own-row locked; non-admin sees no button.

---

## Self-Review

**1. Spec coverage (design §1–§10):**
- §2 slice structure (api/model/ui/index) → Tasks 1-4 ✓
- §3 api wrappers (list/create/update, no delete) → Task 1 ✓
- §4 presenter (query, mutations+invalidate, modal, canSave password≥8, canModify self-guard, ApiError 409/400/403 mapping) → Task 2 ✓
- §5.1 UserTable (columns, badge, own-row disabled, New) → Task 3 ✓
- §5.2 UserFormModal (create password, edit read-only email + no password, Save gated) → Task 3 ✓
- §5.3 container RequireRole('admin') → Task 4 ✓
- §5.4 shell Manage-users toggle (admin-only) → Task 4 Step 5 ✓
- §6 data flow → exercised by Tasks 2/4 tests + Task 5 ✓
- §7 error handling (list error, form error, 403 kept) → Task 2 mapError + Task 3 views ✓
- §8 testing (presenter/views/container + /run) → Tasks 2-5 ✓
- §9 YAGNI (no delete, no router, no password edit) → honored; no such tasks ✓

**2. Placeholder scan:** none — every component has full code; every step has exact command + expected result.

**3. Type/name consistency:** `AdminUser`/`CreateUserInput`/`UpdateUserPatch` + `listUsers`/`createUser`/`updateUser` defined Task 1, consumed Tasks 2-4. `useUsersPresenter` view-model keys defined Task 2 match the props passed in Task 4's container and the props expected by Task 3's views (`users`, `canModify`, `onEdit`, `onToggleActive`, `onNew`, `loading`, `listError`; `open`, `mode`, `values`, `fieldErrors`, `formError`, `canSave`, `saving`, `onField`, `onSubmit`, `onClose`). `UserManagement({open,onClose})` produced Task 4, consumed in App.tsx same task. `Role` reused from session types throughout.

**4. Risks for the implementer:**
- **`ApiError` import in the presenter:** allowed — design §4 needs `instanceof ApiError` for mapping; only `apiRequest` *calls* are forbidden outside `api/`. The class import is fine. (Noted in Task 2 Interfaces.)
- **No `QueryClientProvider` in tests:** the presenter test mocks `@tanstack/react-query`'s `useQuery`/`useMutation` directly (repo has no query-provider test wrapper), so no real client is needed. The `useMutation` mock runs `mutationFn` then `onSuccess`, exercising the invalidate path.
- **App.tsx already imports `useState`** (line 1) — reuse it; do not re-import. `RequireRole` is NOT yet imported there — add it (Task 4 Step 5).
- **Styling:** class names (`user-mgmt-panel`, `manage-users-btn`, `badge-*`) reuse the `glass-panel` convention; exact CSS is cosmetic and can follow the existing `styles/main.css` patterns — not required for tests/build to pass. If oxlint or tsc flags an unused import after wiring, remove it.
- **Password field `type="password"` label:** the view test queries `getByLabelText(/password/i)` — the `<label htmlFor="uf-password">Password</label>` provides it. Edit mode omits the field entirely, so the negative assertion holds.
