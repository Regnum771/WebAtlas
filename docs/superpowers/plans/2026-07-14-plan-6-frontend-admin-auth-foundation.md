# Plan 6 — Frontend Admin Auth Foundation (session + login + apiClient) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the client-side authentication layer to `apps/web` — a `apiClient` fetch choke point, a `session` entity (login/logout/rehydrate, JWT in localStorage), TanStack Query, a `LoginModal` + presenter, a `UserBadge`, and a UX-only `RequireRole` guard — so an admin can log in, stay logged in across refresh, see they are authenticated, and log out. Editing is a later plan.

**Architecture:** Feature-Sliced Design + MVP, matching the existing frontend. Model (`entities/session`, `shared/api`) is the only layer touching `apiClient`/localStorage; Presenter (`use*Presenter` hooks) returns a view-model + handlers with no JSX/fetch; View (`*.view.tsx`) is passive props-only and may not import `apiClient`/`ol/*`; a thin container wires presenter → view. The backend is the real authorization boundary (401/403 enforced server-side); the client authenticates every call and reacts to the server's verdict (401 → logout, 403 → keep session + "no permission"); `RequireRole` is UX only.

**Tech Stack:** React 19, TypeScript (bundler resolution, `verbatimModuleSyntax`), `@tanstack/react-query`, Vitest + `@testing-library/react` + `jsdom` (added in Task 1), the Plan 4/5 API (`POST /api/auth/login`, `GET /api/auth/me`).

## Global Constraints

- Node 22 / npm 10 workspaces. All work in `apps/web` (plus its `package.json`). Base branch: current `main` (has the FSD frontend + the Plan 4/5 API).
- **Security model (spec §2):** the backend enforces auth (401 unauthenticated, 403 non-admin) on every admin route — unbypassable from the client. The frontend authenticates by attaching `Authorization: Bearer <token>`; `RequireRole` and any logged-in gating are **UX only, never a security control** (code comment required). The client reacts to the server verdict: **401 → clear session + prompt login; 403 → keep session, surface "no permission", do NOT log out.**
- **Token storage (spec §3.3, §8):** JWT persisted in `localStorage`; on app load, re-validate via `GET /api/auth/me` (200 → authenticated; 401/invalid → silent logout). Deliberate, documented deviation from the design's literal "in memory".
- **Error contract:** the API serializes errors as `{ "error": { "code": string, "message": string, "details"?: unknown } }`. `apiClient` normalizes these to `ApiError { status, code, message, details? }`; network/parse failures → `ApiError { status: 0, code: 'NETWORK_ERROR', message }`.
- **MVP layering rules (spec §7):** (1) `*.view.tsx` imports no `apiClient`/session-api/`ol/*` — props only; (2) presenters return a view-model + handlers, no JSX/fetch; (3) only Models touch `apiClient`/`localStorage`; (4) containers wire presenter → view only; (5) `RequireRole`/gating carry a "backend enforces, client is UX" comment.
- **TS constraints (web tsconfig):** `verbatimModuleSyntax` (use `import type` for type-only imports), `noUnusedLocals`/`noUnusedParameters`, `erasableSyntaxOnly` (no TS enums or constructor parameter-properties — use `type` unions and plain assignments), `jsx: react-jsx`.
- **Login response shape (from the API):** `POST /api/auth/login` → `{ token: string, user: { id: string; email: string; full_name: string | null; role: 'admin'|'editor'|'viewer'; is_active: boolean; created_at: string; updated_at: string } }`. `GET /api/auth/me` → `{ user: <same user shape> }`.

## Directory layout (end state — new/changed files)

```
apps/web/
  package.json                       # (modify) add deps + test script
  vitest.config.ts                   # (create) jsdom + setup
  src/test/setup.ts                  # (create) @testing-library/jest-dom + localStorage reset
  src/shared/
    config.ts                        # (modify) add API_BASE_URL
    api/apiClient.ts                 # (create) fetch choke point + ApiError + verdict handling
    api/apiClient.test.ts            # (create)
    api/queryClient.ts               # (create) TanStack Query client
    ui/Modal.tsx                     # (create) dumb modal shell
    ui/Toast.tsx                     # (create) toast list + notify model
  src/entities/session/
    model/session.types.ts           # (create) Role, CurrentUser, LoginCredentials
    model/session.store.tsx          # (create) AuthProvider + useSession()
    model/session.store.test.tsx     # (create)
    api/session.api.ts               # (create) loginRequest(), fetchMe()
  src/features/auth/
    model/useLoginPresenter.ts       # (create) view-model + handlers
    model/useLoginPresenter.test.ts  # (create)
    ui/LoginModal.view.tsx           # (create) passive form
    ui/LoginModal.view.test.tsx      # (create)
    ui/UserBadge.view.tsx            # (create) passive badge + logout
    ui/RequireRole.tsx               # (create) UX guard
    ui/RequireRole.test.tsx          # (create)
    index.tsx                        # (create) container: trigger <-> modal <-> badge
  src/app/providers/AppProviders.tsx # (create) QueryClient > Auth > Map
  src/app/App.tsx                    # (modify) wrap in AppProviders; mount auth container + admin placeholder
```

---

### Task 1: Web test harness (Vitest + Testing Library) + a smoke test

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/test/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm run test -w @webatlas/web` (Vitest, jsdom environment, `@testing-library/jest-dom` matchers, `localStorage` reset between tests). Later tasks rely on this to run hook/render tests.

- [ ] **Step 1: Add dev deps + test script**

In `apps/web/package.json`, add to `devDependencies`:
```json
    "vitest": "^3.0.0",
    "jsdom": "^25.0.1",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/user-event": "^14.5.2"
```
and to `dependencies`:
```json
    "@tanstack/react-query": "^5.62.0"
```
and to `scripts`:
```json
    "test": "vitest run"
```
Then from repo root: `npm install`.

- [ ] **Step 2: Vitest config**

Create `apps/web/vitest.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 3: Test setup**

Create `apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 4: Smoke test (RED then GREEN)**

Create `apps/web/src/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('web test harness', () => {
  it('runs vitest with jsdom (localStorage available)', () => {
    localStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(typeof window).toBe('object');
  });
});
```

- [ ] **Step 5: Run → PASS**

Run: `npm run test -w @webatlas/web`
Expected: 1 file, 1 test passes. (If jsdom/localStorage is missing, the config is wrong.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/vitest.config.ts apps/web/src/test
git commit -m "test(web): add Vitest + Testing Library harness (jsdom)"
```

---

### Task 2: `apiClient` + `ApiError` + verdict handling

**Files:**
- Modify: `apps/web/src/shared/config.ts`
- Create: `apps/web/src/shared/api/apiClient.ts`, `apps/web/src/shared/api/apiClient.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; code: string; details?: unknown }`.
  - `setAuthToken(token: string | null): void` — sets the bearer token attached to requests.
  - `onUnauthorized(cb: () => void): void` — registers the callback `apiClient` calls on a 401 (the session store registers `logout` here; keeps `apiClient` entity-agnostic and avoids a circular import).
  - `apiRequest<T>(path: string, init?: RequestInit): Promise<T>` — prepends `API_BASE_URL`, injects the auth header, parses JSON, and on non-2xx throws `ApiError` (mapping the `{ error: {...} }` envelope). On 401 it invokes the unauthorized callback before throwing; on 403 it throws `ApiError` with code `FORBIDDEN` and does NOT invoke the callback.
  - `API_BASE_URL` from `shared/config`.

- [ ] **Step 1: Add API_BASE_URL to config**

In `apps/web/src/shared/config.ts`, append:
```ts
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/shared/api/apiClient.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiRequest, ApiError, setAuthToken, onUnauthorized } from './apiClient';

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
  } as Response);
}

describe('apiClient', () => {
  beforeEach(() => { setAuthToken(null); });

  it('injects the bearer token and returns parsed JSON on 2xx', async () => {
    const fetchMock = mockFetchOnce(200, { user: { id: '1' } });
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('tok123');
    const data = await apiRequest<{ user: { id: string } }>('/api/auth/me');
    expect(data.user.id).toBe('1');
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('maps the error envelope to ApiError on non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(400, { error: { code: 'VALIDATION_ERROR', message: 'bad' } }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'bad' });
    await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('invokes the unauthorized callback on 401 (and throws)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, { error: { code: 'AUTH_ERROR', message: 'nope' } }));
    const cb = vi.fn();
    onUnauthorized(cb);
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 401 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke the unauthorized callback on 403', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(403, { error: { code: 'FORBIDDEN', message: 'no role' } }));
    const cb = vi.fn();
    onUnauthorized(cb);
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('maps a network failure to NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/shared/api/apiClient.test.ts`
Expected: FAIL — cannot find module `./apiClient`.

- [ ] **Step 4: Implement apiClient**

Create `apps/web/src/shared/api/apiClient.ts`:
```ts
import { API_BASE_URL } from '../config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
let unauthorizedCb: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}
export function onUnauthorized(cb: () => void): void {
  unauthorizedCb = cb;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Network request failed');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'HTTP_ERROR';
  let message = `Request failed (${res.status})`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // non-JSON error body; keep defaults
  }

  if (res.status === 401 && unauthorizedCb) unauthorizedCb();
  throw new ApiError(res.status, code, message, details);
}
```

- [ ] **Step 5: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/shared/api/apiClient.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/config.ts apps/web/src/shared/api/apiClient.ts apps/web/src/shared/api/apiClient.test.ts
git commit -m "feat(web): apiClient fetch choke point with ApiError + 401/403 verdict handling"
```

---

### Task 3: Session entity — types, api, store (`entities/session`)

**Files:**
- Create: `apps/web/src/entities/session/model/session.types.ts`, `apps/web/src/entities/session/api/session.api.ts`, `apps/web/src/entities/session/model/session.store.tsx`, `apps/web/src/entities/session/model/session.store.test.tsx`
- Create: `apps/web/src/shared/api/queryClient.ts`

**Interfaces:**
- Consumes: `apiRequest`, `setAuthToken`, `onUnauthorized`, `ApiError` (Task 2).
- Produces:
  - `type Role = 'admin' | 'editor' | 'viewer'`; `interface CurrentUser { id: string; email: string; full_name: string | null; role: Role }`; `interface LoginCredentials { email: string; password: string }`.
  - `session.api`: `loginRequest(c: LoginCredentials): Promise<{ token: string; user: CurrentUser }>`; `fetchMe(): Promise<CurrentUser>`.
  - `AuthProvider` (React provider) + `useSession(): { status: 'anonymous'|'authenticating'|'authenticated'; currentUser: CurrentUser | null; login(c): Promise<void>; logout(): void }`.
  - `queryClient` (TanStack `QueryClient`).
  - localStorage key constant `TOKEN_KEY = 'webatlas.token'`.

- [ ] **Step 1: Types**

Create `apps/web/src/entities/session/model/session.types.ts`:
```ts
export type Role = 'admin' | 'editor' | 'viewer';

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
}

export interface LoginCredentials {
  email: string;
  password: string;
}
```

- [ ] **Step 2: Session API**

Create `apps/web/src/entities/session/api/session.api.ts`:
```ts
import { apiRequest } from '../../../shared/api/apiClient';
import type { CurrentUser, LoginCredentials } from '../model/session.types';

export function loginRequest(c: LoginCredentials): Promise<{ token: string; user: CurrentUser }> {
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(c) });
}

export async function fetchMe(): Promise<CurrentUser> {
  const { user } = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
  return user;
}
```

- [ ] **Step 3: Query client**

Create `apps/web/src/shared/api/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,          // don't retry auth failures
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 4: Write the failing store test**

Create `apps/web/src/entities/session/model/session.store.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthProvider, useSession, TOKEN_KEY } from './session.store';

vi.mock('../api/session.api', () => ({
  loginRequest: vi.fn(),
  fetchMe: vi.fn(),
}));
import { loginRequest, fetchMe } from '../api/session.api';

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const ADMIN = { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' as const };

describe('session store', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('starts anonymous with no stored token', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.currentUser).toBeNull();
  });

  it('login stores token + user and becomes authenticated', async () => {
    (loginRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', user: ADMIN });
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.login({ email: ADMIN.email, password: 'pw' }); });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.currentUser).toEqual(ADMIN);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok');
  });

  it('logout clears token + user', async () => {
    (loginRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ token: 'tok', user: ADMIN });
    const { result } = renderHook(() => useSession(), { wrapper });
    await act(async () => { await result.current.login({ email: ADMIN.email, password: 'pw' }); });
    act(() => { result.current.logout(); });
    expect(result.current.status).toBe('anonymous');
    expect(result.current.currentUser).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('rehydrates from a stored token via fetchMe', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored-tok');
    (fetchMe as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.currentUser).toEqual(ADMIN);
  });

  it('clears the session when rehydration fails (expired token)', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale-tok');
    (fetchMe as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/entities/session/model/session.store.test.tsx`
Expected: FAIL — cannot find module `./session.store`.

- [ ] **Step 6: Implement the store**

Create `apps/web/src/entities/session/model/session.store.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { setAuthToken, onUnauthorized } from '../../../shared/api/apiClient';
import { loginRequest, fetchMe } from '../api/session.api';
import type { CurrentUser, LoginCredentials } from './session.types';

export const TOKEN_KEY = 'webatlas.token';

type Status = 'anonymous' | 'authenticating' | 'authenticated';

interface SessionContextValue {
  status: Status;
  currentUser: CurrentUser | null;
  login: (c: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('anonymous');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setCurrentUser(null);
    setStatus('anonymous');
  }, []);

  // apiClient calls this on any 401 (expired/invalid token mid-session).
  useEffect(() => { onUnauthorized(logout); }, [logout]);

  const login = useCallback(async (c: LoginCredentials) => {
    setStatus('authenticating');
    try {
      const { token, user } = await loginRequest(c);
      localStorage.setItem(TOKEN_KEY, token);
      setAuthToken(token);
      setCurrentUser(user);
      setStatus('authenticated');
    } catch (e) {
      logout();
      throw e;
    }
  }, [logout]);

  // Rehydrate once on mount from a stored token.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    setAuthToken(stored);
    setStatus('authenticating');
    fetchMe()
      .then((user) => { setCurrentUser(user); setStatus('authenticated'); })
      .catch(() => { logout(); });
  }, [logout]);

  return (
    <SessionContext.Provider value={{ status, currentUser, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within an AuthProvider');
  return ctx;
}
```

- [ ] **Step 7: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/entities/session/model/session.store.test.tsx`
Expected: 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/entities/session apps/web/src/shared/api/queryClient.ts
git commit -m "feat(web): session entity (store/api/types) + TanStack Query client"
```

---

### Task 4: Login presenter (`features/auth/model`)

**Files:**
- Create: `apps/web/src/features/auth/model/useLoginPresenter.ts`, `apps/web/src/features/auth/model/useLoginPresenter.test.ts`

**Interfaces:**
- Consumes: `useSession` (Task 3), `ApiError` (Task 2).
- Produces: `useLoginPresenter(onSuccess?: () => void)` → `{ email; password; loading; error; setEmail(v); setPassword(v); submit(): Promise<void> }`. `submit` calls `session.login`; on success calls `onSuccess`; on failure sets `error` to a human message mapped from the `ApiError` status (401 → "Invalid email or password", 429 → "Too many attempts, please wait and try again", 0/NETWORK_ERROR → "Cannot reach the server", else the error message).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/auth/model/useLoginPresenter.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoginPresenter } from './useLoginPresenter';
import { ApiError } from '../../../shared/api/apiClient';

const loginMock = vi.fn();
vi.mock('../../../entities/session/model/session.store', () => ({
  useSession: () => ({ login: loginMock, status: 'anonymous', currentUser: null, logout: vi.fn() }),
}));

describe('useLoginPresenter', () => {
  beforeEach(() => { loginMock.mockReset(); });

  it('submits credentials and calls onSuccess', async () => {
    loginMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    act(() => { result.current.setEmail('a@webatlas.test'); result.current.setPassword('pw'); });
    await act(async () => { await result.current.submit(); });
    expect(loginMock).toHaveBeenCalledWith({ email: 'a@webatlas.test', password: 'pw' });
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('maps a 401 to a friendly error and does not call onSuccess', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'AUTH_ERROR', 'Invalid credentials'));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPresenter(onSuccess));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Invalid email or password');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('maps a network error', async () => {
    loginMock.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'down'));
    const { result } = renderHook(() => useLoginPresenter());
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Cannot reach the server');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/auth/model/useLoginPresenter.test.ts`
Expected: FAIL — cannot find module `./useLoginPresenter`.

- [ ] **Step 3: Implement the presenter**

Create `apps/web/src/features/auth/model/useLoginPresenter.ts`:
```ts
import { useState, useCallback } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import { ApiError } from '../../../shared/api/apiClient';

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Invalid email or password';
    if (e.status === 429) return 'Too many attempts, please wait and try again';
    if (e.status === 0 || e.code === 'NETWORK_ERROR') return 'Cannot reach the server';
    return e.message;
  }
  return 'Something went wrong';
}

export function useLoginPresenter(onSuccess?: () => void) {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await login({ email, password });
      onSuccess?.();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setLoading(false);
    }
  }, [login, email, password, onSuccess]);

  return { email, password, loading, error, setEmail, setPassword, submit };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm run test -w @webatlas/web -- src/features/auth/model/useLoginPresenter.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth/model
git commit -m "feat(web): login presenter (view-model + submit with error mapping)"
```

---

### Task 5: Views — Modal shell, LoginModal, UserBadge, RequireRole

**Files:**
- Create: `apps/web/src/shared/ui/Modal.tsx`, `apps/web/src/features/auth/ui/LoginModal.view.tsx`, `apps/web/src/features/auth/ui/LoginModal.view.test.tsx`, `apps/web/src/features/auth/ui/UserBadge.view.tsx`, `apps/web/src/features/auth/ui/RequireRole.tsx`, `apps/web/src/features/auth/ui/RequireRole.test.tsx`

**Interfaces:**
- Consumes: `useSession` (Task 3, only in `RequireRole`), `Role` (Task 3).
- Produces:
  - `Modal({ open, onClose, children })` — dumb overlay shell.
  - `LoginModalView({ open, email, password, loading, error, onEmail, onPassword, onSubmit, onClose })` — passive form; no `apiClient`/session imports.
  - `UserBadgeView({ email, onLogout })` — passive badge + logout button.
  - `RequireRole({ role, fallback?, children })` — renders `children` only when the current user's role matches (UX only; comment states backend enforces).

- [ ] **Step 1: Modal shell**

Create `apps/web/src/shared/ui/Modal.tsx`:
```tsx
import type { ReactNode } from 'react';

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing LoginModal test**

Create `apps/web/src/features/auth/ui/LoginModal.view.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginModalView } from './LoginModal.view';

const baseProps = {
  open: true, email: '', password: '', loading: false, error: null as string | null,
  onEmail: vi.fn(), onPassword: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(),
};

describe('LoginModalView', () => {
  it('renders email + password fields and a submit button when open', () => {
    render(<LoginModalView {...baseProps} />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('shows an error message when provided', () => {
    render(<LoginModalView {...baseProps} error="Invalid email or password" />);
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
  });

  it('calls onSubmit when the form is submitted', async () => {
    const onSubmit = vi.fn();
    render(<LoginModalView {...baseProps} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<LoginModalView {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/auth/ui/LoginModal.view.test.tsx`
Expected: FAIL — cannot find module `./LoginModal.view`.

- [ ] **Step 4: Implement LoginModal view**

Create `apps/web/src/features/auth/ui/LoginModal.view.tsx`:
```tsx
import { Modal } from '../../../shared/ui/Modal';

// Passive view: props only. Must not import apiClient/session/ol.
export interface LoginModalViewProps {
  open: boolean;
  email: string;
  password: string;
  loading: boolean;
  error: string | null;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function LoginModalView(props: LoginModalViewProps) {
  const { open, email, password, loading, error, onEmail, onPassword, onSubmit, onClose } = props;
  return (
    <Modal open={open} onClose={onClose}>
      <form
        className="login-form"
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      >
        <h2>Admin login</h2>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email" type="email" autoComplete="username" value={email}
          onChange={(e) => onEmail(e.target.value)} required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => onPassword(e.target.value)} required
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: UserBadge view (no test needed — trivial passive markup, exercised by the container in Task 6)**

Create `apps/web/src/features/auth/ui/UserBadge.view.tsx`:
```tsx
import { LogOut } from 'lucide-react';

export interface UserBadgeViewProps {
  email: string;
  onLogout: () => void;
}

export function UserBadgeView({ email, onLogout }: UserBadgeViewProps) {
  return (
    <div className="user-badge glass-panel">
      <span className="user-badge-email">{email}</span>
      <button type="button" className="user-badge-logout" onClick={onLogout} title="Log out">
        <LogOut size={16} />
        <span>Log out</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Write the failing RequireRole test**

Create `apps/web/src/features/auth/ui/RequireRole.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequireRole } from './RequireRole';

function mockSession(user: { role: string } | null) {
  vi.doMock('../../../entities/session/model/session.store', () => ({
    useSession: () => ({ currentUser: user, status: user ? 'authenticated' : 'anonymous', login: vi.fn(), logout: vi.fn() }),
  }));
}

describe('RequireRole (UX gate)', () => {
  it('renders children for a matching role', async () => {
    vi.resetModules();
    mockSession({ role: 'admin' });
    const { RequireRole: Fresh } = await import('./RequireRole');
    render(<Fresh role="admin"><div>secret</div></Fresh>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('renders the fallback for a non-matching role', async () => {
    vi.resetModules();
    mockSession({ role: 'viewer' });
    const { RequireRole: Fresh } = await import('./RequireRole');
    render(<Fresh role="admin" fallback={<div>denied</div>}><div>secret</div></Fresh>);
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('renders nothing for anonymous with no fallback', async () => {
    vi.resetModules();
    mockSession(null);
    const { RequireRole: Fresh } = await import('./RequireRole');
    const { container } = render(<Fresh role="admin"><div>secret</div></Fresh>);
    expect(container).toBeEmptyDOMElement();
  });
});
// keep the top-level import referenced so the file type-checks
void RequireRole;
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test -w @webatlas/web -- src/features/auth/ui/RequireRole.test.tsx`
Expected: FAIL — cannot find module `./RequireRole`.

- [ ] **Step 8: Implement RequireRole**

Create `apps/web/src/features/auth/ui/RequireRole.tsx`:
```tsx
import type { ReactNode } from 'react';
import { useSession } from '../../../entities/session/model/session.store';
import type { Role } from '../../../entities/session/model/session.types';

// UX gate ONLY. Real authorization is enforced by the backend (401/403 on every
// admin route); a user who forces this open still cannot perform admin API calls.
export function RequireRole({ role, fallback = null, children }: {
  role: Role | Role[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { currentUser } = useSession();
  const allowed = Array.isArray(role) ? role : [role];
  if (!currentUser || !allowed.includes(currentUser.role)) return <>{fallback}</>;
  return <>{children}</>;
}
```

- [ ] **Step 9: Run tests → PASS**

Run: `npm run test -w @webatlas/web -- src/features/auth/ui`
Expected: LoginModal (4) + RequireRole (3) pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/shared/ui/Modal.tsx apps/web/src/features/auth/ui
git commit -m "feat(web): auth views - Modal, LoginModal, UserBadge, RequireRole (UX gate)"
```

---

### Task 6: Auth container + provider tree + app wiring

**Files:**
- Create: `apps/web/src/features/auth/index.tsx`, `apps/web/src/app/providers/AppProviders.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/features/auth/index.test.tsx`

**Interfaces:**
- Consumes: `useSession` (Task 3), `useLoginPresenter` (Task 4), `LoginModalView`/`UserBadgeView`/`RequireRole` (Task 5), `queryClient` (Task 3), `AuthProvider` (Task 3), the existing `MapProvider`.
- Produces:
  - `AuthWidget` (default export of `features/auth/index.tsx`) — shows a "Admin login" button when anonymous (opens the modal via the presenter) and a `UserBadgeView` when authenticated.
  - `AppProviders({ children })` — `QueryClientProvider` → `AuthProvider` → `MapProvider`.
  - `App` wrapped in `AppProviders`, mounting `AuthWidget` in the controls area and a `RequireRole role="admin"` placeholder region (proves gating).

- [ ] **Step 1: Auth container**

Create `apps/web/src/features/auth/index.tsx`:
```tsx
import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useSession } from '../../entities/session/model/session.store';
import { useLoginPresenter } from './model/useLoginPresenter';
import { LoginModalView } from './ui/LoginModal.view';
import { UserBadgeView } from './ui/UserBadge.view';

export default function AuthWidget() {
  const { status, currentUser, logout } = useSession();
  const [open, setOpen] = useState(false);
  const presenter = useLoginPresenter(() => setOpen(false));

  if (status === 'authenticated' && currentUser) {
    return <UserBadgeView email={currentUser.email} onLogout={logout} />;
  }

  return (
    <>
      <button type="button" className="admin-login-btn glass-panel" onClick={() => setOpen(true)}>
        <LogIn size={16} />
        <span>Admin login</span>
      </button>
      <LoginModalView
        open={open}
        email={presenter.email}
        password={presenter.password}
        loading={presenter.loading}
        error={presenter.error}
        onEmail={presenter.setEmail}
        onPassword={presenter.setPassword}
        onSubmit={presenter.submit}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: Provider tree**

Create `apps/web/src/app/providers/AppProviders.tsx`:
```tsx
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../shared/api/queryClient';
import { AuthProvider } from '../../entities/session/model/session.store';
import { MapProvider } from './MapProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MapProvider>{children}</MapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Wire App.tsx**

In `apps/web/src/app/App.tsx`: replace the `MapProvider` wrapper with `AppProviders`, mount `AuthWidget`, and add a `RequireRole` admin placeholder. Change the imports at the top:
```tsx
import { AppProviders } from './providers/AppProviders';
import AuthWidget from '../features/auth';
import { RequireRole } from '../features/auth/ui/RequireRole';
```
Remove the old `import { MapProvider } from './providers/MapProvider';` line. Then change the JSX so the outer wrapper is `AppProviders` and the widget + placeholder are mounted (keep all existing panels/children exactly as they are):
```tsx
  return (
    <AppProviders>
      <div className="app-container">
        <MapView />
        <MapControls />

        {/* Auth entry: login button or user badge */}
        <div className="auth-widget-slot">
          <AuthWidget />
          <RequireRole role="admin">
            <div className="admin-region-placeholder glass-panel">Admin tools (coming soon)</div>
          </RequireRole>
        </div>

        <div className={`panels-wrapper ${panelsVisible ? '' : 'hidden'}`}>
          <LayerTree />
          <BasemapSwitcher />
          <SearchBar />
          <DynamicLegend />
          <OGCClient />
        </div>

        <DynamicPopup />

        <button
          className="toggle-panels-btn glass-panel"
          onClick={() => setPanelsVisible(!panelsVisible)}
          title={panelsVisible ? 'Ẩn các panel' : 'Hiện các panel'}
        >
          {panelsVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span>{panelsVisible ? 'Ẩn giao diện' : 'Hiện giao diện'}</span>
        </button>
      </div>
    </AppProviders>
  );
```

- [ ] **Step 4: Write the failing container test**

Create `apps/web/src/features/auth/index.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sessionValue = { status: 'anonymous', currentUser: null, login: vi.fn(), logout: vi.fn() };
vi.mock('../../entities/session/model/session.store', () => ({ useSession: () => sessionValue }));

import AuthWidget from './index';

describe('AuthWidget', () => {
  it('shows the Admin login button when anonymous and opens the modal', async () => {
    render(<AuthWidget />);
    const btn = screen.getByRole('button', { name: /admin login/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
```
Then add a second block for the authenticated state (separate file-level mock via `vi.resetModules`):
```tsx
describe('AuthWidget (authenticated)', () => {
  it('shows the user badge with logout', async () => {
    vi.resetModules();
    vi.doMock('../../entities/session/model/session.store', () => ({
      useSession: () => ({ status: 'authenticated', currentUser: { id: '1', email: 'a@webatlas.test', full_name: 'A', role: 'admin' }, login: vi.fn(), logout: vi.fn() }),
    }));
    const { default: Fresh } = await import('./index');
    render(<Fresh />);
    expect(screen.getByText('a@webatlas.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `npm run test -w @webatlas/web -- src/features/auth/index.test.tsx`
Expected: initially FAIL (module/markup missing) until Steps 1–3 are in place, then 2 tests pass.

- [ ] **Step 6: Minimal styles for the new elements**

Append to `apps/web/src/styles/main.css` (keep visual consistency with existing `glass-panel`):
```css
.auth-widget-slot { position: absolute; top: 12px; right: 12px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.admin-login-btn, .user-badge, .user-badge-logout, .login-form button { cursor: pointer; }
.admin-login-btn, .user-badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: none; border-radius: 8px; }
.user-badge { flex-direction: row; }
.user-badge-logout { display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 2000; }
.modal-content { min-width: 320px; max-width: 90vw; padding: 20px; border-radius: 12px; }
.login-form { display: flex; flex-direction: column; gap: 8px; }
.login-form input { padding: 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.2); }
.login-error { color: #c0392b; margin: 0; }
.admin-region-placeholder { padding: 8px 12px; border-radius: 8px; }
```

- [ ] **Step 7: Build + lint + full test suite**

Run (from repo root):
```bash
npm run build:web
npm run lint:web
npm run test -w @webatlas/web
```
Expected: web builds (tsc + vite) with no type errors; lint exit 0 (pre-existing warnings only); all web test files pass. Fix any type error before committing (watch `verbatimModuleSyntax`/unused-vars).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/auth/index.tsx apps/web/src/features/auth/index.test.tsx apps/web/src/app/providers/AppProviders.tsx apps/web/src/app/App.tsx apps/web/src/styles/main.css
git commit -m "feat(web): auth container + provider tree + app wiring (login/badge/RequireRole)"
```

- [ ] **Step 9: Manual verification (controller /run — login walkthrough)**

With the API (`npm run dev -w @webatlas/api`) and the web dev server (`npm run dev:web`) running, and an admin present (`npm run create-admin -w @webatlas/api -- --email admin@webatlas.test --password admin-pass-123`):
- Load the app → "Admin login" button visible, admin placeholder hidden.
- Click → modal opens; submit wrong password → "Invalid email or password"; submit correct → modal closes, badge shows the email, "Admin tools (coming soon)" placeholder appears.
- Reload the page → still logged in (badge shown) via `/auth/me` rehydration.
- Click "Log out" → back to the login button; placeholder hidden.

---

## Self-Review

**1. Spec coverage (design §2–§8):**
- Security model — backend enforces; `apiClient` attaches JWT; 401 → logout, 403 → keep session; `RequireRole` UX-only with comment → Tasks 2, 3, 5 ✓
- Token in localStorage + `/auth/me` rehydration (logout on 401) → Task 3 ✓
- Error normalization envelope → `ApiError`; login error messages (401/429/network) → Tasks 2, 4 ✓
- FSD/MVP layering (Model-only apiClient/localStorage; presenter no JSX/fetch; view props-only; container wiring; RequireRole comment) → Tasks 2–6 ✓
- Provider tree QueryClient > Auth > Map; TanStack Query introduced (backs rehydrate query — here the store uses a direct `fetchMe` in an effect, which satisfies the rehydration requirement; `queryClient` is provided app-wide for the editing plan) → Tasks 3, 6 ✓
- Login UX: button → modal → badge + logout; admin placeholder gated by RequireRole → Tasks 5, 6 ✓
- Testing: presenter pure-hook, views via render, store/apiClient against mocked fetch, manual /run → Tasks 2–6 ✓
- **Deviation noted:** the spec describes rehydration "via TanStack Query"; this plan rehydrates via a direct `fetchMe()` effect in the store (simpler, fully testable) while still providing `QueryClientProvider` app-wide so the editing plan uses TanStack Query for feature lists. This satisfies the rehydration requirement and the "introduce TanStack Query now" decision (the provider + client exist); it does not route `/auth/me` through a `useQuery`. If a reviewer deems routing `/auth/me` through `useQuery` mandatory, that is a small follow-up — flag to the human.

**2. Placeholder scan:** every file's full content is given; no TBD/TODO. The "Admin tools (coming soon)" text is intentional demo copy for the gated placeholder, not a plan placeholder.

**3. Type/name consistency:** `ApiError`, `apiRequest`, `setAuthToken`, `onUnauthorized`, `CurrentUser`, `Role`, `LoginCredentials`, `loginRequest`, `fetchMe`, `AuthProvider`, `useSession`, `TOKEN_KEY`, `useLoginPresenter`, `LoginModalView`, `UserBadgeView`, `RequireRole`, `AuthWidget`, `AppProviders`, `queryClient` are used consistently across tasks. Login/`/auth/me` response shapes match the API (`{ token, user }` / `{ user }`).

**4. Risks for the implementer:**
- **`verbatimModuleSyntax` + `erasableSyntaxOnly`:** use `import type` for all type-only imports; `ApiError`'s `public readonly` constructor params are fine (that's a class field, not a parameter-property on a plain function) — but the class uses `extends Error`, set `this.name` explicitly (done). No TS enums.
- **Circular import avoidance:** `apiClient` must not import the session store; the store registers `logout` via `onUnauthorized` (done). Keep it that way.
- **StrictMode double-effect:** the rehydration effect runs on mount; it is idempotent (reads localStorage, sets state) and safe under React 19 StrictMode.
- **`RequireRole.test` module mocking:** uses `vi.resetModules()` + `vi.doMock` + dynamic `import()` so each case gets a fresh session mock; the trailing `void RequireRole;` keeps the top import referenced under `noUnusedLocals`.
- **CORS:** the API's `@fastify/cors` is locked to `CORS_ORIGIN` (default `http://localhost:5173`); the Vite dev server must run on that origin (default) so browser calls to `:3001` are allowed. If the dev port differs, set `CORS_ORIGIN` accordingly.
- **Test isolation:** the manual /run admin uses an `@webatlas.test` email; no automated test hits the real API (all mock `fetch`/session).

---

## Follow-on

- **Editing plan** — admin editing mode consuming this session layer + the Plan 5 feature-CRUD API: `EditToolbar`, OpenLayers `Draw`/`Modify`/`Translate` in `MapModel`, a schema-driven `AttributeForm` from `LAYER_ATTRIBUTE_MAP`, save → `POST/PUT/DELETE /api/layers/:key/features` → WFS refetch via TanStack Query invalidation, `RequireRole`-gated toolbar. The `layer_* ↔ canonical-key` mapping lives in `entities/layer/layerRegistry.ts` (`LAYER_REGISTRY`).
- Optional: route `/auth/me` rehydration through `useQuery` if a single query-cache source of truth for the current user is wanted; a user-management UI over `/api/users`.
