# Plan 1 — Monorepo + Infrastructure Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the existing single-app repo into an npm-workspaces monorepo (`apps/web`, `packages/shared`) and stand up the PostGIS + GeoServer infrastructure via Docker Compose, without changing any runtime behavior of the existing viewer.

**Architecture:** The current React app moves verbatim into `apps/web`. A new empty-but-buildable `packages/shared` holds cross-cutting TypeScript types (starting with the canonical editable-layer key list). An `infra/` directory holds a Docker Compose stack that runs PostgreSQL+PostGIS (with an init script creating the `app` and `water` schemas) and GeoServer. Nothing wires the frontend to these services yet — that happens in later plans.

**Tech Stack:** npm workspaces, Vite 8, React 19, TypeScript 6, Vitest, Docker Compose, `postgis/postgis:16-3.4`, `docker.osgeo.org/geoserver:2.26.0`.

## Global Constraints

- Node.js **22.x**, npm **10.x** (verified: Node v22.13.1, npm 10.9.2).
- Package manager is **npm workspaces** — no pnpm/yarn.
- Workspace package names are scoped `@webatlas/*` (`@webatlas/web`, `@webatlas/shared`).
- PostGIS is the single source of truth (INV-1); schemas are `app` and `water`.
- The GeoServer layer catalog is provisioned as config-as-code, never hand-edited (INV-2) — no manual GeoServer changes in this plan.
- Secrets live only in `infra/.env` (git-ignored); `infra/.env.example` is the committed template with placeholder values.
- The existing viewer's behavior must be **unchanged** after the move.

---

### Task 1: Establish the npm-workspaces root and move the web app into `apps/web`

**Files:**
- Move: `src/` → `apps/web/src/`, `public/` → `apps/web/public/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `.oxlintrc.json`, `package.json` → all under `apps/web/`
- Create: `package.json` (new workspace root)
- Modify: `apps/web/package.json` (rename), `apps/web/.oxlintrc.json:2` ($schema path)
- Delete: root `package-lock.json` (regenerated)

**Interfaces:**
- Produces: workspace root exposing scripts `dev:web`, `build:web`, `lint:web`; the web app resolvable as `@webatlas/web`.

- [ ] **Step 1: Move the app files into `apps/web` with git (preserves history)**

Run from repo root:
```bash
mkdir -p apps/web
git mv src apps/web/src
git mv public apps/web/public
git mv index.html apps/web/index.html
git mv vite.config.ts apps/web/vite.config.ts
git mv tsconfig.json apps/web/tsconfig.json
git mv tsconfig.app.json apps/web/tsconfig.app.json
git mv tsconfig.node.json apps/web/tsconfig.node.json
git mv .oxlintrc.json apps/web/.oxlintrc.json
git mv package.json apps/web/package.json
git rm --cached package-lock.json && rm -f package-lock.json
```
`README.md`, `.gitignore`, and `docs/` stay at the repo root.

- [ ] **Step 2: Rename the web package**

Edit `apps/web/package.json` — change line 2 from `"name": "atlas",` to:
```json
  "name": "@webatlas/web",
```
Leave all scripts and dependencies unchanged.

- [ ] **Step 3: Fix the oxlint schema path for the new depth**

Edit `apps/web/.oxlintrc.json` line 2 — the hoisted binary lives two levels up:
```json
  "$schema": "../../node_modules/oxlint/configuration_schema.json",
```

- [ ] **Step 4: Create the workspace root `package.json`**

Create `package.json` (repo root):
```json
{
  "name": "webatlas",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:web": "npm run dev -w @webatlas/web",
    "build:web": "npm run build -w @webatlas/web",
    "lint:web": "npm run lint -w @webatlas/web",
    "build:shared": "npm run build -w @webatlas/shared",
    "test:shared": "npm run test -w @webatlas/shared"
  }
}
```

- [ ] **Step 5: Install and regenerate the workspace lockfile**

Run from repo root:
```bash
npm install
```
Expected: completes without error; a new root `package-lock.json` is created and `node_modules/` is hoisted to the root.

- [ ] **Step 6: Verify the web app still builds**

Run from repo root:
```bash
npm run build:web
```
Expected: `tsc -b` passes and `vite build` writes `apps/web/dist/` with no errors.

- [ ] **Step 7: Verify the dev server still serves**

Run from repo root:
```bash
npm run dev:web
```
Expected: Vite prints `Local: http://localhost:5173/`. Stop it with Ctrl+C after confirming it starts cleanly (no module-resolution errors).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: move web app into apps/web under npm workspaces"
```

---

### Task 2: Scaffold `packages/shared` with the canonical layer-key list

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/layers.test.ts`

**Interfaces:**
- Produces: `@webatlas/shared` exporting `EDITABLE_LAYER_KEYS` (readonly tuple of 7 keys) and the `EditableLayerKey` union type. Consumed by the API layer registry and frontend in later plans (INV-4).

- [ ] **Step 1: Create the shared package manifest**

Create `packages/shared/package.json`:
```json
{
  "name": "@webatlas/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create the shared package tsconfig**

Create `packages/shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 3: Write the failing test**

Create `packages/shared/src/layers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';

describe('EDITABLE_LAYER_KEYS', () => {
  it('lists exactly the seven thematic water/hazard layers', () => {
    expect(EDITABLE_LAYER_KEYS).toHaveLength(7);
  });

  it('includes the dams and rivers layers', () => {
    expect(EDITABLE_LAYER_KEYS).toContain('dams');
    expect(EDITABLE_LAYER_KEYS).toContain('rivers');
  });

  it('contains no duplicate keys', () => {
    expect(new Set(EDITABLE_LAYER_KEYS).size).toBe(EDITABLE_LAYER_KEYS.length);
  });
});
```

- [ ] **Step 4: Install the new dev dependencies**

Run from repo root:
```bash
npm install
```
Expected: `vitest` and `typescript` resolve for `@webatlas/shared`.

- [ ] **Step 5: Run the test to verify it fails**

Run from repo root:
```bash
npm run test:shared
```
Expected: FAIL — `Failed to resolve import "./index"` / `EDITABLE_LAYER_KEYS is not defined` (no `index.ts` yet).

- [ ] **Step 6: Write the minimal implementation**

Create `packages/shared/src/index.ts`:
```ts
/**
 * Canonical keys for the editable thematic layers.
 * Single source of truth for layer identity across API registry,
 * GeoServer publication, and the frontend (INV-4).
 */
export const EDITABLE_LAYER_KEYS = [
  'dams',
  'rivers',
  'stations',
  'flood_zones',
  'drought_points',
  'saltwater_intrusion',
  'flood_generation',
] as const;

export type EditableLayerKey = (typeof EDITABLE_LAYER_KEYS)[number];
```

- [ ] **Step 7: Run the test to verify it passes**

Run from repo root:
```bash
npm run test:shared
```
Expected: PASS — 3 passing tests.

- [ ] **Step 8: Verify the package builds and emits declarations**

Run from repo root:
```bash
npm run build:shared
```
Expected: `packages/shared/dist/index.js` and `packages/shared/dist/index.d.ts` are created with no errors.

- [ ] **Step 9: Ignore the shared build output**

Append to `.gitignore` (repo root):
```
# Shared package build output
packages/shared/dist/
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold @webatlas/shared with canonical editable-layer keys"
```

---

### Task 3: Docker Compose stack — PostGIS + GeoServer with schema init

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/postgis/init.sql`
- Create: `infra/.env.example`
- Modify: `.gitignore` (ignore `infra/.env`)

**Interfaces:**
- Produces: a running PostGIS instance reachable on `${POSTGRES_PORT}` with `postgis` + `citext` extensions and `app` + `water` schemas pre-created; a running GeoServer reachable at `http://localhost:${GEOSERVER_PORT}/geoserver/`. Consumed by Plan 2 (migrations, seeds, layer publication).

- [ ] **Step 1: Create the PostGIS init script**

Create `infra/postgis/init.sql` (runs once on first DB init via the image's entrypoint):
```sql
-- Enable spatial + case-insensitive text support
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- Application schemas (INV-1: PostGIS is the single source of truth)
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS water;
```

- [ ] **Step 2: Create the environment template**

Create `infra/.env.example`:
```dotenv
# PostgreSQL / PostGIS
POSTGRES_USER=webatlas
POSTGRES_PASSWORD=change_me_dev
POSTGRES_DB=webatlas
POSTGRES_PORT=5432

# GeoServer
GEOSERVER_ADMIN_USER=admin
GEOSERVER_ADMIN_PASSWORD=change_me_dev
GEOSERVER_PORT=8080
```

- [ ] **Step 3: Create the Compose file**

Create `infra/docker-compose.yml`:
```yaml
name: webatlas

services:
  db:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./postgis/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 12

  geoserver:
    image: docker.osgeo.org/geoserver:2.26.0
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      GEOSERVER_ADMIN_USER: ${GEOSERVER_ADMIN_USER}
      GEOSERVER_ADMIN_PASSWORD: ${GEOSERVER_ADMIN_PASSWORD}
      SKIP_DEMO_DATA: "true"
    ports:
      - "${GEOSERVER_PORT:-8080}:8080"
    volumes:
      - geoserver_data:/opt/geoserver_data

volumes:
  db_data:
  geoserver_data:
```

- [ ] **Step 4: Ignore the real env file**

Append to `.gitignore` (repo root):
```
# Local infra secrets
infra/.env
```

- [ ] **Step 5: Create a local env file from the template**

Run from repo root:
```bash
cp infra/.env.example infra/.env
```

- [ ] **Step 6: Start the stack**

Run from repo root:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
```
Expected: pulls images (first run) and starts `webatlas-db-1` and `webatlas-geoserver-1`.

- [ ] **Step 7: Verify the database is healthy and provisioned**

Run from repo root:
```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T db \
  psql -U webatlas -d webatlas -c "SELECT postgis_version();" -c "\dn"
```
Expected: prints a PostGIS `3.4` version string, and the schema list includes `app`, `water`, and `public`.

- [ ] **Step 8: Verify GeoServer is up**

Run from repo root (GeoServer may take 30–60s on first start; re-run until `200`):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/geoserver/web/
```
Expected: `200`.

- [ ] **Step 9: Commit (env file excluded by .gitignore)**

```bash
git add infra/docker-compose.yml infra/postgis/init.sql infra/.env.example .gitignore
git commit -m "feat: add PostGIS + GeoServer docker-compose stack with schema init"
```

- [ ] **Step 10: Confirm the working tree is clean and services still run**

Run from repo root:
```bash
git status --porcelain
docker compose -f infra/docker-compose.yml --env-file infra/.env ps
```
Expected: `git status` prints nothing (clean; `infra/.env` is ignored); `ps` shows both services with state `running`/`healthy`.

---

## Self-Review

**1. Spec coverage (against §8 repo structure & §13 step 1–2 of the design):**
- `apps/web` move → Task 1 ✓
- `packages/shared` for shared types (INV-4) → Task 2 ✓
- `infra/docker-compose.yml` (PostGIS + GeoServer) → Task 3 ✓
- `infra/postgis/init.sql` (extensions + `app`/`water` schemas) → Task 3 ✓
- `apps/api` and `infra/geoserver/` provisioning are intentionally **out of scope** for Plan 1 — `apps/api` is Plan 4, GeoServer layer publication is Plan 2. Noted, not a gap.

**2. Placeholder scan:** No TBD/TODO/"handle appropriately" strings; every file's full content is given. ✓

**3. Type consistency:** `EDITABLE_LAYER_KEYS` / `EditableLayerKey` names match between `src/index.ts`, the test, and the Interfaces block. The seven keys match the seven `water.*` tables in design §5.2 exactly (`dams`, `rivers`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`). ✓

---

## Follow-on plans (authored after this one completes)

- **Plan 2** — DB migrations (`app.users`, `app.audit_log`, `water.*`) via `node-pg-migrate`, seed scripts from existing GeoJSON/mock, GeoServer layer publication as config-as-code. Deliverable: WFS serves the seven layers as GeoJSON.
- **Plan 3** — Frontend WFS data-source swap + MVP/FSD refactor (read-only). Deliverable: public viewer visually unchanged, reading from WFS.
- **Plan 4** — Fastify API skeleton, global plugins/hooks, `modules/auth` + `modules/users`, JWT + argon2. Deliverable: login + user CRUD API, tested.
- **Plan 5** — Layer registry + layers CRUD + audit, frontend admin login/edit toolbar/attribute forms/RequireRole. Deliverable: admin CRUD on the map.
