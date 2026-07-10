# WebGIS Water Resources — Backend, Frontend & Database Design

**Date:** 2026-07-10
**Status:** Approved design — ready for implementation planning
**Scope:** Add a backend, spatial database, and role-based access to the existing static
WebGIS viewer, turning it into a managed, editable water-resources platform.

---

## 1. Context & goal

The current project is a **frontend-only** React 19 + TypeScript + Vite + OpenLayers 10
WebGIS for Vietnam water resources. All data is static: GeoJSON files in `public/`
(`thuydienvietnam.geojson` dams, `thuyhe.geojson` rivers, GADM admin boundaries) plus
hardcoded mock collections in `src/data/mockData.ts` (monitoring stations, flood zones,
drought points, saltwater intrusion, flood-generation zones). There is no backend,
database, or authentication.

**Goal:** introduce a spatial database, a backend API, and role-based access:

- **Public viewer** — no login; reads thematic layers read-only.
- **Administrator** — authenticated; full CRUD on the thematic map layers, plus user
  management.

The system is expected to grow large, so the design prioritizes disciplined layering,
globally-injected cross-cutting concerns, and a single source of truth.

---

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Data store & GIS server | **PostgreSQL + PostGIS**, published via **GeoServer** (OGC-first) |
| 2 | Admin write path | **Thin auth/CRUD API in front**; GeoServer stays read-only to the public |
| 3 | Editable layers | **Water + hazard layers** move to PostGIS; GADM boundaries stay static reference |
| 4 | API language | **Node.js + TypeScript** (Fastify) — shares types with the frontend |
| 5 | Auth model | **Multiple admin accounts + JWT**, `users` table with a `role` column |
| 6 | Repo & runtime | **Monorepo + Docker Compose** (PostGIS + GeoServer + API) |
| 7 | Frontend architecture | **MVP** roles, organized with **Feature-Sliced Design** |

---

## 3. System architecture

Four cooperating services, orchestrated by Docker Compose.

```
                         ┌─────────────────────────────┐
   Public viewer  ─────► │  GeoServer (read-only)       │ ──► reads live ──┐
   (no login)            │  WFS/GeoJSON output          │                  │
                         └─────────────────────────────┘                  ▼
                                                              ┌─────────────────────┐
   Admin (JWT) ───────►  ┌─────────────────────────────┐     │ PostgreSQL + PostGIS│
   login / edit   ─────► │  Node/TS API (Fastify)       │ ──► │  water.*  +  app.*  │
                         │  auth · CRUD · validation    │write└─────────────────────┘
                         └─────────────────────────────┘
   Both ──────────────►  React / OpenLayers frontend (apps/web)
```

- **PostGIS** is the single source of truth for all thematic feature data.
- **GeoServer** connects to PostGIS and publishes the `water.*` tables as read-only
  **WFS (GeoJSON output)**. WFS is chosen over raster WMS because the frontend relies on
  client-side vector styling (dam radius by wattage, river width by `Cap`) and attribute
  popups, which GeoJSON preserves. WMS remains available for heavy layers later.
- **Node/TS API** is the *only* writer. It owns login, JWT issuance, validation, and CRUD
  to PostGIS. GeoServer's transactional WFS-T is disabled / not publicly exposed.
- **Frontend** reads thematic layers from GeoServer WFS, GADM reference layers from static
  files, and calls the API for auth and edits.

**Post-edit data flow:** admin saves → API validates → writes PostGIS → frontend refetches
WFS → change appears live. WFS reads PostGIS directly, so there is no tile cache to
invalidate.

---

## 4. Single-source-of-truth invariants

The topology gives single-source-of-truth for feature data for free, but layer
definitions, styling, and schema can silently gain second sources. These invariants are
**binding** on all future work:

- **INV-1 — Feature data lives only in PostGIS.** GeoServer stores nothing (read-through
  projection); the frontend holds only a transient cache refetched after each write. All
  writes go through the API; GeoServer WFS-T is disabled. Thematic layers stay on live WFS
  (not cached WMS) so an edit is visible on the next fetch. If WMS + GeoWebCache is ever
  introduced, cache truncation must be added to the write path.
- **INV-2 — The API layer registry is the one authoritative layer catalog.** The frontend
  layer panel is *derived* from `GET /api/layers`; it is never hand-maintained. GeoServer
  layer publication is provisioned from the same registry as config-as-code, never
  hand-edited in the GeoServer UI.
- **INV-3 — Styling lives in exactly one place: the frontend.** Since the public reads
  WFS/GeoJSON and styles client-side, no parallel SLDs are maintained. If WMS is ever
  needed, SLD is *generated* from the same style tokens, not authored separately.
- **INV-4 — Attribute schema has one definition.** The shared types in
  `packages/shared` define each layer's attributes; migrations, the API layer registry,
  and the frontend attribute forms all consume that single definition.

---

## 5. Database schema

Two PostgreSQL schemas. PostGIS extension enabled at init.

### 5.1 `app` schema — auth & audit

- **`app.users`** — `id` (uuid), `email` (unique, citext), `password_hash` (argon2),
  `full_name`, `role` (`admin` | `editor` | `viewer` — enum, extensible), `is_active`
  (bool), `created_at`, `updated_at`.
- **`app.audit_log`** — `id`, `user_id` (fk), `action` (`create`|`update`|`delete`),
  `table_name`, `feature_id`, `before` (jsonb), `after` (jsonb), `created_at`. Every CRUD
  write is recorded.

### 5.2 `water` schema — editable thematic layers

One table per layer (→ one GeoServer layer each). Every table has `geometry(<type>, 4326)`
with a GiST index and common columns `id` (uuid), `name`, `created_at`, `updated_at`,
`created_by` (fk users), `updated_by` (fk users).

| Table | Geometry | Layer-specific attributes | Seed source |
|---|---|---|---|
| `water.dams` | Point | `wattage_pl`, `status` | `thuydienvietnam.geojson` |
| `water.rivers` | MultiLineString | `cap`, `length` | `thuyhe.geojson` |
| `water.stations` | Point | `type`, `status`, `value` | `mockData.ts` |
| `water.flood_zones` | MultiPolygon | `risk_level`, `area` | `mockData.ts` |
| `water.drought_points` | Point | `risk_level`, `status`, `survey_date` | `mockData.ts` |
| `water.saltwater_intrusion` | Point | `salinity`, `risk_level`, `status` | `mockData.ts` |
| `water.flood_generation` | MultiPolygon | `risk_level`, `area`, `flow_rate` | `mockData.ts` |

GADM admin boundaries (`gadm41_VNM_1`, `gadm41_VNM_3`) remain **static reference files**
served from `apps/web/public/` — not migrated into the database.

Migrations and seeds are managed with `node-pg-migrate`; seed scripts transform the
existing GeoJSON/mock content into rows and are idempotent.

---

## 6. Backend API (Fastify + TypeScript)

### 6.1 Layered architecture

Strict layering; each layer only talks to the one below. HTTP concerns, business logic,
and data access are independently testable and swappable.

```
HTTP → Routes → Controllers → Services → Repositories → DB pool (PostGIS)
                    ▲             ▲            ▲
              (validation)  (business rules) (SQL only)
```

- **Routes** — declare paths, attach schemas + guards, delegate to a controller. No logic.
- **Controllers** — validate the request (zod), shape the response envelope, translate
  results/errors. No SQL, no business rules.
- **Services** — business logic: audit logging, geometry validation orchestration, role
  checks, transactions. Layer-agnostic via the layer registry.
- **Repositories** — parameterized SQL only, one per table/aggregate. Return domain
  objects, never HTTP.
- **DB pool** — a single `pg.Pool` injected as a Fastify decorator; transactions passed
  down explicitly.

### 6.2 Global middleware injection (plugins & hooks)

Fastify's plugin/hook system is the injection mechanism. Every cross-cutting concern is a
plugin registered once at bootstrap and applied globally via lifecycle hooks — no
per-route boilerplate.

| Concern | Mechanism | Applies |
|---|---|---|
| Request ID / correlation | `onRequest` hook + `pino` child logger | every request |
| Structured logging | pino + `onRequest`/`onResponse` | every request |
| CORS | `@fastify/cors` (locked to web origin) | global |
| Security headers | `@fastify/helmet` | global |
| Rate limiting | `@fastify/rate-limit` (tighter on `/auth/login`) | global + override |
| Body limits / parsing | core config | global |
| **Authentication (JWT verify)** | `authenticate` decorator + `onRequest` hook | guarded routes |
| **Authorization (RBAC)** | `authorize(role)` `preHandler` factory | write / admin routes |
| **Validation** | zod compiler bound to Fastify's schema hook (`preValidation`) | routes with a schema |
| **Central error handling** | `setErrorHandler` — maps typed errors → HTTP | all thrown errors |
| Response envelope | `onSend` hook | every response |
| Not-found handler | `setNotFoundHandler` | unmatched routes |
| DB pool / graceful shutdown | plugin + `onClose` hook | app lifecycle |

**Typed error hierarchy** — thrown anywhere, caught once in `setErrorHandler`:
`AppError` → `ValidationError` (400), `AuthError` (401), `ForbiddenError` (403),
`NotFoundError` (404), `GeometryError` (422), `ConflictError` (409), `InternalError` (500).
The handler serializes them to a consistent shape and logs at the appropriate level;
services and repositories only `throw`, never format HTTP.

### 6.3 Authentication vs. the auth feature — global vs. local

Two distinct things are both called "auth"; only one is cross-cutting:

- **Global capability** — verifying identity and enforcing roles applies across *every*
  route and has no endpoints of its own. It lives in the injection layer:
  `plugins/authentication.ts` (JWT verify → attach user) and
  `hooks/authorization.ts` (`authorize(role)` RBAC factory).
- **Local features** — login endpoints and user records are resources with their own
  routes and/or tables, structurally identical to any other module:
  `modules/auth/` owns `POST /auth/login` and `GET /auth/me`;
  `modules/users/` owns CRUD over `app.users`.

The rule: **has its own routes and/or table → feature module; behavior applied across
routes with no endpoints → global plugin/hook.** This keeps the authentication *mechanism*
global while preventing every module from transitively depending on the users *feature*.

### 6.4 API surface

```
POST   /api/auth/login              → { email, password } → JWT + user
GET    /api/auth/me                 → current user
GET    /api/layers                  → editable-layer metadata (keys, geom types, schemas)
GET    /api/layers/:key/features    → GeoJSON FeatureCollection (admin read)
POST   /api/layers/:key/features    → create feature                 [auth]
PUT    /api/layers/:key/features/:id → update feature                [auth]
DELETE /api/layers/:key/features/:id → delete feature                [auth]
GET    /api/users                   → list users                     [admin]
POST   /api/users                   → create user                    [admin]
PUT    /api/users/:id               → update user                    [admin]
DELETE /api/users/:id               → deactivate/delete user         [admin]
```

A **layer registry** (`layers/registry.ts`) maps each layer key → PostGIS table +
geometry type + zod attribute schema, so CRUD and validation are generic across all seven
layers and `GET /api/layers` is derived from it (INV-2).

### 6.5 API directory layout

```
apps/api/src/
  server.ts                  # build app: register plugins in order, then modules
  config/                    # env loading + validation (zod) → typed config object
  plugins/                   # GLOBAL injection — one file per concern
    cors.ts  helmet.ts  rateLimit.ts  logger.ts  requestId.ts
    db.ts                    # pg.Pool decorator + onClose
    authentication.ts        # authenticate decorator (JWT verify)
    errorHandler.ts          # setErrorHandler + setNotFoundHandler
    responseEnvelope.ts      # onSend
    validation.ts            # zod ↔ Fastify schema compiler
  hooks/
    authorization.ts         # authorize(role) preHandler factory
    audit.ts                 # audit preHandler / service wiring
  errors/                    # AppError + typed subclasses
  modules/                   # feature-sliced vertical slices
    auth/     { routes, controller, service, repository, schemas }
    users/    { routes, controller, service, repository, schemas }
    layers/   { routes, controller, service, repository, schemas }
    audit/    { service, repository }
  layers/registry.ts         # layer key → table + geom type + zod attr schema
  lib/                       # jwt, password (argon2), geometry helpers
  db/{migrations,seeds}/
  types/
```

Each **module** owns its full vertical slice; adding a domain later means adding a folder,
not editing shared files. Global concerns live in `plugins/` and `hooks/`, injected once in
`server.ts`.

**Stack:** Fastify, `pg`, zod, `jsonwebtoken`, `argon2`, `pino`, `node-pg-migrate`.

---

## 7. Frontend (React + OpenLayers) — MVP + Feature-Sliced Design

### 7.1 MVP roles

- **Model** — data and domain logic, zero JSX. API access (repositories over
  `apiClient`), domain types, and state stores. The imperative OpenLayers `Map` / sources /
  WFS loading are quarantined behind a Model service (`MapModel`, `LayerModel`), never in
  components. Models never import React components and never format for display.
- **Presenter** — one custom hook per feature (`useEditToolbarPresenter`,
  `useLoginPresenter`). Consumes the Model, holds view logic and user-intent handlers,
  returns a display-ready **view-model** + callbacks. No JSX, no `fetch`, no direct
  SQL/OL calls except through the Model.
- **View** — passive `*.view.tsx` components. Receive the view-model and handlers as props,
  render, forward events. No data fetching, no business logic, no direct Model access.

A thin **container** (`index.tsx`) is the only place presenter and view meet: it calls the
presenter hook and passes the result into the view.

**OpenLayers within MVP:** the `Map`, vector sources, WFS fetching, and draw/modify
interactions are **Model** (`features/map/model/MapModel.ts`). Presenters call Model methods
(`mapModel.startDraw('dams')`, `mapModel.loadWfs(key)`) and subscribe to Model events to
derive view-model state. The View is the map `<div>` plus overlay panels — it renders, it
does not drive OL directly. The current `MapContext` becomes a Model service.

### 7.2 Feature-Sliced Design layout

Models are not lumped into one folder; each lives with the entity or feature it belongs to.

```
apps/web/src/
  app/
    App.tsx
    providers/                 # composed provider tree (Auth, Notifications, Query, Map)
    ErrorBoundary.tsx          # global React error boundary
  shared/
    api/apiClient.ts           # single fetch choke point: base URL, auth header,
                               #   401 interceptor → logout/redirect, error normalization
    api/queryClient.ts         # data fetching/caching (TanStack Query)
    ui/                        # dumb presentational components (Button, Modal, Field, Toast)
  entities/                    # shared domain models
    session/  { model/ (store, types), api/ }      # current user, login/logout, /auth/me
    layer/    { model/, api/ }                      # generic layer + feature model,
                                                    #   driven by the layer registry /
                                                    #   shared schema (not per-theme folders)
  features/                    # each = MVP slice with model · ui · api segments
    map/            { model/ (MapModel, LayerModel), ui/, index.tsx }
    layers-panel/   { model/, ui/ }                # LayerTree, Basemap, Legend, Search
    auth/           { model/ (useLoginPresenter), ui/ (LoginModal.view) }
    admin-editing/  { model/, ui/, api/, index.tsx } # EditToolbar, Draw, Modify, AttributeForm
    admin-users/    { model/, ui/, api/ }
  styles/
```

**MVP → FSD mapping:**

| MVP role | FSD home |
|---|---|
| Model | `entities/*/model` + `entities/*/api` (shared) · `features/*/model` (local) |
| Presenter | `features/*/model` hooks (the `use*Presenter` hooks) |
| View | `features/*/ui` (`.view.tsx`) · `shared/ui` (dumb components) |

### 7.3 Convention rules (enforced in review / lint)

1. `*.view.tsx` may not import `apiClient`, repositories, or `ol/*` — props only.
2. Presenters (`use*Presenter.ts`) return a view-model + handlers; they contain no JSX.
3. Only Models touch `apiClient` and OpenLayers.
4. Containers (`index.tsx`) contain no logic beyond wiring presenter → view.

### 7.4 Behavior changes

- **Data source swap:** `MapContainer` thematic layers move from static/mock to GeoServer
  WFS URLs; existing OL styles/popups stay. GADM layers unchanged.
- **Auth:** `session` entity + `LoginModal`; JWT held in memory with `/auth/me`
  rehydration; "Admin login" entry in the UI.
- **Admin editing mode** (visible only when logged in): toolbar to pick a layer, **draw**
  (OL `Draw` per geometry type), **modify/move** (`Modify`/`Translate`), **delete**, and a
  schema-driven attribute form. Save → API → refetch WFS.
- **Role gating:** a `RequireRole` guard gates admin-only UI; the public viewer is
  unchanged. Existing panels (LayerTree, BasemapSwitcher, SearchBar, DynamicLegend,
  DynamicPopup, OGCClient) are preserved.

**Stack additions:** TanStack Query (server cache), a notification/toast model, an auth
context.

---

## 8. Repository structure (monorepo)

```
webatlas/
  apps/
    web/                 # existing React app moved here (src/, public/, vite config)
    api/                 # new Fastify API (see §6.5)
  packages/
    shared/              # shared TS types: feature & attribute schemas (INV-4)
  infra/
    docker-compose.yml   # postgis + geoserver + api
    postgis/init.sql     # extensions + schemas
    geoserver/           # catalog config + provisioning (config-as-code, INV-2)
  docs/superpowers/specs/
  package.json           # npm workspaces root
```

npm workspaces; `docker compose up` brings up PostGIS + GeoServer + API; the frontend runs
via Vite dev (or containerized). Shared feature/attribute types live in `packages/shared`
so the API and web agree on schemas.

---

## 9. Error handling

- **API:** zod → 400; auth → 401/403; invalid geometry (`ST_IsValid`, SRID) → 422; DB →
  500 with safe messages; structured logging with request-id correlation. All via the
  central `setErrorHandler` (§6.2).
- **Frontend:** `apiClient` normalizes errors; global `ErrorBoundary` for render errors;
  toast notifications for save/delete outcomes; `401 → login redirect`. Writes refetch WFS
  rather than optimistically mutating.

---

## 10. Security

- Passwords hashed with **argon2**.
- **JWT** signed from an env secret, short expiry; held in memory on the client.
- **CORS** locked to the frontend origin; **helmet** security headers.
- **Rate limiting**, stricter on `/auth/login`.
- **Parameterized SQL** everywhere; geometry SRID normalized/validated before insert.
- GeoServer default credentials changed; **WFS-T / write endpoints not publicly exposed**.
- Every write recorded in `app.audit_log`.

---

## 11. Testing strategy

- **API:** integration tests (Vitest + Fastify `inject`, throwaway PostGIS via
  testcontainers) covering auth, each CRUD path, validation, RBAC, and audit logging;
  migration/seed idempotency; unit tests for services and geometry helpers.
- **Frontend:** presenters tested as pure hooks with a mocked Model (view logic, no DOM);
  views tested via render/snapshot with a hand-built view-model (no network, no map);
  Models tested as units (repositories against a mocked `apiClient`; `MapModel` against an
  OL test double). Auth flow and edit toolbar covered end-to-end at the presenter level.

---

## 12. Scope boundaries (YAGNI — deferred)

- No refresh-token rotation (short-lived JWT + re-login for now).
- No public user registration (admins are provisioned by admins / seed).
- No map versioning or rollback beyond the audit log.
- GADM boundaries stay static (not editable, not in the DB).
- No WMS/GeoWebCache tiling initially (WFS live). If added later, INV-1 requires cache
  truncation on the write path.

---

## 13. Migration path (high level)

1. Restructure to the monorepo (`apps/web` = current app, add `apps/api`, `packages/shared`,
   `infra/`).
2. Stand up PostGIS + GeoServer + API via Docker Compose; init schemas; run migrations.
3. Seed `water.*` tables from existing GeoJSON/mock; publish layers in GeoServer from the
   registry.
4. Point the frontend thematic layers at GeoServer WFS; verify the public viewer is
   unchanged.
5. Build auth (backend + `session` entity + login UI).
6. Build the layers CRUD API + admin editing mode.
7. Build user management.
8. Harden: error handling, rate limiting, audit logging, tests.

Detailed, ordered implementation steps are produced next via the writing-plans skill.
