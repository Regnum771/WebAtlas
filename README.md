# WebATLAS — Water Resources WebGIS

An interactive WebGIS for Vietnam water resources (rivers, dams/reservoirs, monitoring
stations, and hazard layers such as flood, drought, saltwater intrusion, and
flood-generation zones). Built with React 19 + OpenLayers, evolving from a static viewer
into a role-based platform with a spatial database, a backend API, and an editable admin map.

## Architecture

Four cooperating services (see the design spec for detail):

- **PostgreSQL + PostGIS** — single source of truth for thematic feature data (`app` + `water` schemas).
- **GeoServer** — publishes the water/hazard layers read-only as WFS (GeoJSON).
- **Node/TS API** (Fastify) — the only writer: admin auth (JWT), user management, validation, and feature CRUD → PostGIS.
- **React + OpenLayers frontend** — public viewer (no login) + administrator login/editing.

Roles: **public viewer** (read-only, no login) and **administrator** (JWT auth, user + map CRUD).
Authorization is enforced by the API (every admin route requires an admin JWT); the frontend
authenticates its calls and gates admin UI, but the backend is the real security boundary.

## Monorepo layout

```
webatlas/
  apps/
    web/            # React 19 + Vite + OpenLayers frontend (Feature-Sliced Design)
    api/            # Fastify + TypeScript API (auth, users, layer feature CRUD, migrations, seeds)
  packages/
    shared/         # @webatlas/shared — cross-cutting TS types (layer keys, geometry + attribute maps)
  infra/
    docker-compose.yml   # PostGIS + GeoServer
    postgis/init.sql     # extensions (postgis, citext) + app/water schemas
    .env.example         # copy to .env (git-ignored) before running the stack
  docs/superpowers/
    specs/          # design specs
    plans/          # phased implementation plans
```

Uses **npm workspaces**. Requires **Node ≥ 22** and **npm ≥ 10**.

## Getting started

### 1. Install dependencies (from the repo root)

```bash
npm install
```

This wires all workspaces and builds `@webatlas/shared` automatically (via its `prepare` script).

### 2. Run the infrastructure stack (PostGIS + GeoServer)

```bash
cp infra/.env.example infra/.env          # then edit credentials for anything non-local
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```

- PostgreSQL + PostGIS → `localhost:5432` (schemas `app`, `water` created on first init).
- GeoServer → `http://localhost:8080/geoserver/` (WFS: `/geoserver/ows?service=WFS&request=GetCapabilities`).

Stop the stack:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env down
```

> `infra/.env` holds secrets and is git-ignored. Never commit it; only `infra/.env.example` is tracked.

### 3. Set up the database (migrations + seeds)

With the stack up, from the repo root:

```bash
npm run migrate            # apply DB migrations (app.users, app.audit_log, water.* tables)
npm run seed               # load the 7 thematic layers from the source GeoJSON/mock data
npm run publish:geoserver  # publish the water.* tables as WFS layers in GeoServer
```

### 4. Run the API

The API needs its own env file. Copy `apps/api/.env.example` to `apps/api/.env` and set
`JWT_SECRET` to any string ≥ 16 characters.

```bash
npm run dev -w @webatlas/api    # Fastify at http://localhost:3001 (GET /health → {"status":"ok"})
```

### 5. Create an administrator

There is **no default login and no public sign-up** — admins are provisioned with the
bootstrap script (password must be ≥ 8 characters):

```bash
npm run create-admin -w @webatlas/api -- --email you@example.com --password "your-strong-password" --name "Your Name"
```

### 6. Run the frontend

```bash
npm run dev:web      # Vite dev server at http://localhost:5173
npm run build:web    # type-check + production build
npm run lint:web     # oxlint
```

The public viewer works with just the frontend + GeoServer. To **log in as an admin**, the
API (step 4) must also be running — the login modal calls `http://localhost:3001`. The API's
CORS is locked to the web origin (`http://localhost:5173` by default; set `CORS_ORIGIN` in
`apps/api/.env` if you change the Vite port).

## API surface

```
POST   /api/auth/login                 → { token, user }
GET    /api/auth/me                     → current user                       [auth]
GET    /api/users                       → list users                         [admin]
POST   /api/users                       → create user                        [admin]
PUT    /api/users/:id                   → update user                        [admin]
DELETE /api/users/:id                   → delete user                        [admin]
GET    /api/layers                      → editable-layer catalog (metadata)
GET    /api/layers/:key/features        → GeoJSON FeatureCollection           [admin]
POST   /api/layers/:key/features        → create feature                     [admin]
PUT    /api/layers/:key/features/:id    → update feature                     [admin]
DELETE /api/layers/:key/features/:id    → delete feature                     [admin]
```

Passwords are argon2-hashed; JWTs are signed from `JWT_SECRET` with a short expiry; every
write is recorded in `app.audit_log`; geometry is validated in PostGIS before writes.

## Workspace scripts (repo root)

| Script | Action |
|---|---|
| `npm run dev:web` | Start the frontend dev server |
| `npm run build:web` | Build the frontend |
| `npm run lint:web` | Lint the frontend |
| `npm run build:shared` | Build `@webatlas/shared` |
| `npm run test:shared` | Run `@webatlas/shared` tests (Vitest) |
| `npm run migrate` | Apply DB migrations |
| `npm run seed` | Seed the `water.*` thematic layers |
| `npm run publish:geoserver` | Publish the WFS layers in GeoServer |
| `npm run test:api` | Run the API test suite (needs the DB stack up) |

API-workspace scripts (run with `-w @webatlas/api`): `dev`, `start`, `create-admin`,
`migrate:up`, `migrate:down`. Frontend tests: `npm run test -w @webatlas/web`.

## Project status

The build-out is phased. Each plan produces working, testable software on its own.

- [x] **Plan 1 — Monorepo + infrastructure foundation** (workspaces, `@webatlas/shared`, PostGIS + GeoServer via Docker Compose).
- [x] **Plan 2 — DB migrations + seeds + GeoServer publication** (WFS serves the 7 thematic layers).
- [x] **Plan 3 / 3b — Frontend WFS data-source swap + MVP/Feature-Sliced refactor** (read-only viewer).
- [x] **Plan 4 — Fastify API control plane** (global middleware, typed errors, JWT auth, RBAC, user CRUD + audit).
- [x] **Plan 5 — Layers feature CRUD API** (layer registry, generic GeoJSON CRUD, geometry validation, audit).
- [x] **Plan 6 — Frontend admin auth foundation** (apiClient, session/login, RequireRole guard).
- [ ] **Plan 7 (next)** — Admin map editing UI (draw/modify/delete + attribute forms → API → WFS refetch).

## Documentation

- **Design spec (backend/frontend/DB):** [docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md](docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md)
- **Auth foundation design:** [docs/superpowers/specs/2026-07-14-frontend-admin-auth-foundation-design.md](docs/superpowers/specs/2026-07-14-frontend-admin-auth-foundation-design.md)
- **Implementation plans:** [docs/superpowers/plans/](docs/superpowers/plans/)
