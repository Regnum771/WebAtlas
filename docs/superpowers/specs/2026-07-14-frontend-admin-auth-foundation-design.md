# Frontend Admin Auth Foundation — Design

**Date:** 2026-07-14
**Status:** Approved design — ready for implementation planning
**Scope:** Add the client-side authentication/session layer to the React + OpenLayers frontend (`apps/web`), on top of the existing Plan 4/5 auth + layer-CRUD API. This is the **auth foundation only**; the admin map-editing tools (draw/modify/delete + attribute form + save) are a separate follow-on plan.

Supersedes the auth portion of the backend design's §7.4 for the frontend; the editing portion of §7.4 remains for the follow-on.

---

## 1. Context & goal

The backend control plane exists and is enforced server-side:

- `POST /api/auth/login` → `{ token, user }` (JWT signed from an env secret, ~12h expiry).
- `GET /api/auth/me` → the current user (requires a valid token).
- All admin routes (`/api/users/*`, and the write routes `POST/PUT/DELETE /api/layers/:key/features`) are guarded by `[app.authenticate, authorize('admin')]`: missing/expired/invalid token → **401**, valid token with insufficient role → **403**.

The frontend (`apps/web`) is currently the **public read-only viewer**: Feature-Sliced Design layout (`app/`, `shared/`, `entities/`, `features/`), an OpenLayers `MapModel`, thematic layers served from GeoServer WFS. There is **no login, no `apiClient`, no session state**.

**Goal:** give an administrator a way to log in, stay logged in across a page refresh, see that they are authenticated, and log out — plus the client infrastructure (`apiClient`, session entity, TanStack Query, a `RequireRole` guard) that the editing plan will build on. Ends at a demoable milestone: an "Admin login" button → login modal → a user badge with logout, and a `RequireRole` guard gating a placeholder admin-only region.

### Non-goals (deferred to the editing plan)

- Any map editing (draw/modify/delete), attribute forms, or feature save → WFS refetch.
- Feature-list data fetching/caching (there are no admin lists to show yet).
- User-management UI (the `/api/users` CRUD exists in the API but has no frontend here).

---

## 2. Security model — two layers, backend is the real boundary

This is the load-bearing principle for the whole plan.

- **Backend = enforcement (already done).** Every admin API route rejects unauthenticated requests (401) and non-admin requests (403) server-side, independent of the client. A JWT is signed with a server secret; the client cannot forge one. Therefore no UI bypass — DevTools, curl, or a modified bundle — can perform an admin action without a genuine admin token. This is the authoritative authorization boundary.
- **Frontend = authentication transport + UX (this plan).** The client's job is to (a) authenticate its requests by attaching the JWT, and (b) present a coherent UI. It is **never** the authorization decision-maker.
  - `apiClient` attaches `Authorization: Bearer <token>` to every request, so backend guards can evaluate them.
  - `RequireRole` hides admin-only UI from non-admins. This is **UX only, explicitly not a security control** — a determined user can flip client state to render hidden UI, but any resulting API call is still rejected by the backend. The spec and code comments must say so, so no future work mistakes it for enforcement.
  - The client **reacts to the server's verdict** rather than guessing: a **401** means the token is missing/expired/invalid → clear the session and prompt login; a **403** means a valid token with an insufficient role → keep the session and surface a "no permission" message, do **not** log out.

"Protected from both frontend and backend" is satisfied by this split: the frontend authenticates and gates for usability; the backend authorizes for real.

---

## 3. Architecture — Feature-Sliced Design + MVP

Follows the existing frontend conventions (design §7.1–7.3): Model owns data/domain logic and is the only layer that touches `apiClient`/storage; Presenter is a hook returning a view-model + handlers (no JSX, no fetch); View is a passive `*.view.tsx` (props only, may not import `apiClient` or `ol/*`); a thin container wires presenter → view.

### 3.1 Directory layout (new/changed)

```
apps/web/src/
  app/providers/
    AppProviders.tsx           # composes QueryClientProvider > AuthProvider > MapProvider
  shared/
    api/apiClient.ts           # fetch choke point: base URL, JWT header, 401/403 handling,
                               #   response-envelope -> typed ApiError
    api/queryClient.ts         # TanStack Query QueryClient (defaults/retry)
    config.ts                  # (existing) add API_BASE_URL
    ui/
      Modal.tsx                # dumb modal shell (if not already present)
      Toast.tsx / toast model  # minimal notification surface
  entities/session/
    model/session.types.ts     # CurrentUser, LoginCredentials
    model/session.store.tsx    # AuthProvider context + useSession(): token, currentUser,
                               #   status, login(), logout(), (auto) rehydrate
    api/session.api.ts         # loginRequest(), fetchMe() via apiClient
  features/auth/
    model/useLoginPresenter.ts # view-model + handlers (email/pw, submit, error, loading)
    ui/LoginModal.view.tsx     # passive email/password modal form
    ui/UserBadge.view.tsx      # logged-in badge (name/email) + logout button
    ui/RequireRole.tsx         # UX guard: renders children only for allowed role(s)
    index.tsx                  # container: login trigger button <-> modal <-> presenter,
                               #   swaps to UserBadge when authenticated
```

### 3.2 Provider tree

`AppProviders` wraps the app: `QueryClientProvider` (TanStack Query) → `AuthProvider` (session) → `MapProvider` (existing). `AuthProvider` sits above `MapProvider` so any panel — and the future editing feature — can read session state. `app/App.tsx` renders `<AppProviders>` around the existing map UI and mounts the `features/auth` container (login button / user badge) into the control area.

### 3.3 Session entity (`entities/session`)

- **State:** `token: string | null` (mirrored to `localStorage` under a fixed key), `currentUser: CurrentUser | null`, `status: 'anonymous' | 'authenticating' | 'authenticated'`.
- **`CurrentUser`:** `{ id: string; email: string; role: 'admin' | 'editor' | 'viewer'; full_name?: string | null }` (role reuses the shared union).
- **`login(credentials)`:** `session.api.loginRequest()` → on success store token (memory + localStorage) and `currentUser`, set `authenticated`; on failure rethrow the `ApiError` for the presenter.
- **`logout()`:** clear token (memory + localStorage) and `currentUser`, set `anonymous`, clear the TanStack Query cache entry for `me`.
- **Rehydrate (on mount):** if a token exists in `localStorage`, issue `GET /api/auth/me` via TanStack Query. 200 → populate `currentUser`, `authenticated`. 401/invalid → `logout()` (silent; the app simply loads logged-out). This is what makes localStorage persistence safe: the server re-validates the token on every load.

### 3.4 `apiClient` (`shared/api`)

The single choke point for all API calls.

- **Base URL** from `shared/config` `API_BASE_URL` (e.g. `http://localhost:3001`).
- **Auth header:** injects `Authorization: Bearer <token>` from the current session token when present.
- **Verdict handling:** on **401** → invoke the registered session-expiry callback (`logout`) and reject with an `ApiError`; on **403** → reject with an `ApiError` (code `FORBIDDEN`) **without** logging out. The session store registers its `logout` with `apiClient` at init (avoids a circular import; `apiClient` stays entity-agnostic).
- **Error normalization:** parse the API envelope `{ error: { code, message, details? } }` (Plan 4 contract) into `ApiError { status: number; code: string; message: string; details?: unknown }`. Network/parse failures → `ApiError { status: 0, code: 'NETWORK_ERROR', message }`.

### 3.5 TanStack Query

Introduced now so the caching/provider infrastructure is ready for the editing plan. In this plan it backs the `/auth/me` rehydration query (keyed on the presence of a token). `queryClient` holds sensible defaults (no retry on 401/403; the 401 path logs out rather than retries).

---

## 4. Data flow

**Login**
1. User clicks "Admin login" → `LoginModal` opens.
2. `useLoginPresenter` holds `email`/`password`, `loading`, `error`; on submit → `session.login({ email, password })`.
3. `session.login` → `session.api.loginRequest()` → `apiClient` `POST /api/auth/login` → `{ token, user }`.
4. Store token (memory + localStorage) + `currentUser`; status `authenticated`. Modal closes; the trigger becomes `UserBadge`.

**Rehydrate (app load)**
1. `AuthProvider` mounts, reads token from localStorage.
2. Token present → TanStack Query `GET /api/auth/me` (auth header injected).
3. 200 → `currentUser` set, `authenticated` (survives refresh). 401/invalid → `logout()` (silent).

**Logout** — clear token (memory + localStorage) + `currentUser`, status `anonymous`, drop the `me` query from cache; trigger reverts to the login button.

**401 during any call** — `apiClient` calls the registered `logout`; UI drops to logged-out (login button reappears). **403 during any call** — `apiClient` rejects with a `FORBIDDEN` `ApiError`; the caller surfaces a "no permission" toast; session unchanged.

---

## 5. Error handling

- **`apiClient`** is the single normalization point (§3.4): envelope → `ApiError`; network/parse → generic `ApiError`.
- **Login errors** surface in `LoginModal` via the presenter's `error` view-model field: 401 → "Invalid email or password"; 429 (login is rate-limited server-side) → "Too many attempts, please wait and try again"; `NETWORK_ERROR` → "Cannot reach the server."
- **Rehydrate failure** (401/expired `/auth/me`) → silent `logout()`; no error UI, the app just loads logged-out.
- **Toasts** — a minimal notification model in `shared/ui` for session-expiry (401 mid-session) and the 403 "no permission" case. Deliberately small (a toast list + a `notify()` call), not a framework.

---

## 6. Testing (design §7.3, §11)

- **Presenter** (`useLoginPresenter`) — pure hook with a **mocked session model**: submit-success drives `loading` → done and closes; submit-failure surfaces the mapped error string; no DOM, no network.
- **Views** — render with hand-built props/view-model, no network/map: `LoginModal.view` renders fields and calls the submit handler; `UserBadge.view` shows the user and calls logout; `RequireRole` renders children for an allowed role and the fallback for a disallowed role / anonymous.
- **Session model** (`session.store`) — against a **mocked `apiClient`**: `login` stores token + user; `logout` clears both (and localStorage); rehydrate calls `/auth/me` and populates on 200 / clears on 401.
- **`apiClient`** — with a mocked `fetch`: injects the auth header; maps the error envelope to `ApiError`; **401 triggers the logout callback**; **403 does not**; network failure → `NETWORK_ERROR`.
- **No browser E2E in this plan.** The milestone is covered by the hook/render/unit tests plus a manual `/run` login-and-badge walkthrough at the end (as Plans 3/3b verified visually).

---

## 7. Convention rules (enforced in review/lint)

Carried from design §7.3, applied to the new code:

1. `*.view.tsx` may not import `apiClient`, the session api, or `ol/*` — props only.
2. Presenters (`use*Presenter.ts`) return a view-model + handlers; no JSX, no `fetch`.
3. Only Models (`entities/session`, `shared/api`) touch `apiClient` and `localStorage`.
4. Containers (`index.tsx`) contain no logic beyond wiring presenter → view.
5. `RequireRole` and any "logged-in" gating are UX only; they carry a comment stating that authorization is enforced by the backend, not the client (§2).

---

## 8. Stack additions

- `@tanstack/react-query` (query client + provider; backs `/auth/me`).
- A minimal toast/notification model in `shared/ui` (no external dependency required).
- JWT persisted in `localStorage` (with `/auth/me` re-validation on load). This is a deliberate, documented deviation from the backend design's literal "in memory": persistence gives normal admin-tool UX (survives refresh), and the short server-side JWT expiry plus per-load re-validation bound the exposure.

---

## 9. Scope boundaries (YAGNI — deferred)

- Map editing (draw/modify/delete), attribute forms, feature save → WFS refetch — the **editing plan**.
- User-management UI over `/api/users`.
- Refresh-token rotation (short-lived JWT + re-login, per backend design §12).
- A dedicated `/login` route / router (the app is a single map view; a modal over the map is used instead).

---

## 10. Follow-on

- **Editing plan** — admin editing mode consuming this session layer and the Plan 5 feature-CRUD API: `EditToolbar`, OpenLayers `Draw`/`Modify`/`Translate` in `MapModel`, a schema-driven `AttributeForm` derived from `LAYER_ATTRIBUTE_MAP` (shared), save → `POST/PUT/DELETE /api/layers/:key/features` → WFS refetch (TanStack Query invalidation), `RequireRole`-gated toolbar. The `layer_* ↔ canonical-key` mapping already lives in `entities/layer/layerRegistry.ts` (`LAYER_REGISTRY`).
