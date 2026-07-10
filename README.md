# WebATLAS — Water Resources WebGIS

An interactive WebGIS for Vietnam water resources (rivers, dams/reservoirs, monitoring
stations, and hazard layers such as flood, drought, saltwater intrusion, and
flood-generation zones). Built with React 19 + OpenLayers, evolving from a static viewer
into a role-based platform with a spatial database and an editable admin map.

## Architecture

The target system is four cooperating services (see the design spec for detail):

- **PostgreSQL + PostGIS** — single source of truth for thematic feature data.
- **GeoServer** — publishes the water/hazard layers read-only as WFS (GeoJSON).
- **Node/TS API** (Fastify) — the only writer: admin auth (JWT), validation, and CRUD → PostGIS.
- **React + OpenLayers frontend** — public viewer (no login) + administrator editing mode.

Roles: **public viewer** (read-only, no login) and **administrator** (JWT auth, full map CRUD).

## Monorepo layout

```
webatlas/
  apps/
    web/            # React 19 + Vite + OpenLayers frontend (the current app)
  packages/
    shared/         # @webatlas/shared — cross-cutting TS types (e.g. canonical layer keys)
  infra/
    docker-compose.yml   # PostGIS + GeoServer
    postgis/init.sql     # extensions (postgis, citext) + app/water schemas
    .env.example         # copy to .env (git-ignored) before running the stack
  docs/superpowers/
    specs/          # design spec
    plans/          # phased implementation plans
```

Uses **npm workspaces**. Requires **Node ≥ 22** and **npm ≥ 10**.

## Getting started

### 1. Install dependencies (from the repo root)

```bash
npm install
```

This wires all workspaces and builds `@webatlas/shared` automatically (via its `prepare` script).

### 2. Run the frontend

```bash
npm run dev:web      # Vite dev server at http://localhost:5173
npm run build:web    # type-check + production build
npm run lint:web     # oxlint
```

### 3. Run the infrastructure stack (PostGIS + GeoServer)

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

## Workspace scripts (repo root)

| Script | Action |
|---|---|
| `npm run dev:web` | Start the frontend dev server |
| `npm run build:web` | Build the frontend |
| `npm run lint:web` | Lint the frontend |
| `npm run build:shared` | Build `@webatlas/shared` |
| `npm run test:shared` | Run `@webatlas/shared` tests (Vitest) |

## Project status

The build-out is phased. Each plan produces working, testable software on its own.

- [x] **Plan 1 — Monorepo + infrastructure foundation** (workspaces, `@webatlas/shared`, PostGIS + GeoServer via Docker Compose).
- [ ] **Plan 2** — DB migrations + seeds, GeoServer layer publication (WFS serves the 7 thematic layers).
- [ ] **Plan 3** — Frontend WFS data-source swap + MVP/Feature-Sliced refactor (read-only).
- [ ] **Plan 4** — Fastify API: global middleware, auth, users.
- [ ] **Plan 5** — Layers CRUD + audit + admin editing UI.

## Documentation

- **Design spec:** [docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md](docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md)
- **Plan 1:** [docs/superpowers/plans/2026-07-10-plan-1-monorepo-infra-foundation.md](docs/superpowers/plans/2026-07-10-plan-1-monorepo-infra-foundation.md)
