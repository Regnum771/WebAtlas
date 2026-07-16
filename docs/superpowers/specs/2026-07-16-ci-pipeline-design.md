# CI Pipeline (Roadmap 1.2) — Design

**Date:** 2026-07-16
**Status:** Approved design — ready for implementation planning
**Roadmap:** Phase 1, item 1.2 (see `2026-07-15-product-roadmap.md` §3). Turns the existing test suites into an automatic gate.
**Scope:** Add a GitHub Actions workflow that runs the full lint / build / test gate on every pull request to `main` and every push to `main`. Infrastructure/config only — no product code changes.

---

## 1. Context & goal

The repo has substantial test suites but **no CI**: PR #9 reports "no checks". Regressions can merge silently.

Verified facts driving this design (checked against the repo 2026-07-16):

- **Monorepo, npm workspaces** (`apps/*`, `packages/*`), lockfile `package-lock.json`. Root `engines`: `node >=22 <23`, `npm >=10`.
- **Root scripts** already exist: `build:shared`, `test:shared`, `lint:web`, `build:web`, `migrate` (= `migrate:up -w @webatlas/api`), `seed` (= `seed -w @webatlas/api`), `test:api`. There is **no** root `test:web` script (web tests run via `npm test -w @webatlas/web` / `vitest run`).
- **No root `prepare` hook.** `@webatlas/shared` consumers resolve `./dist/index.js` + `./dist/index.d.ts`, which exist only after `npm run build:shared` (`tsc`). So CI must build shared explicitly before web/api steps.
- **API tests need a migrated + seeded PostGIS DB.** They query `water.*`, PostGIS `geometry_columns` (`schema.test.ts` asserts 7 geometry columns), audit rows, and seeded 7-layer state (`layers.test.ts` asserts `toHaveLength(7)`; `seed.test.ts` asserts seeded rows). They do **not** bootstrap schema themselves — they assume `migrate` + `seed` ran. Required env: `DATABASE_URL`, `JWT_SECRET` (≥16 chars).
- **GeoServer is NOT needed for tests** — the suites hit Postgres directly, never GeoServer. CI omits it (saves minutes).

**Goal:** a green/red check on every PR and main push covering shared + web + api, so no lint error, type error, build break, or test failure merges unnoticed.

### Non-goals (deferred)

- **Branch protection / required-checks enforcement** — that is a GitHub repo setting, not something a workflow file can self-apply. Called out as a manual follow-up (§6).
- Deploy/publish/release automation, GeoServer publishing in CI, coverage reporting, multi-Node matrix, caching Docker layers. YAGNI.
- Changing any product code or test.

---

## 2. Architecture — one workflow, three jobs

File: `.github/workflows/ci.yml`.

**Triggers:**
```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

**Common runner setup** (each job): `runs-on: ubuntu-latest`; `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: '22'` and `cache: 'npm'` (keyed on `package-lock.json`); install via `npm ci` (lockfile-exact, clean).

**Three jobs**, `web` and `api` running **concurrently** (no `needs` between them); each job is self-contained and rebuilds `@webatlas/shared` itself (a sub-second `tsc`) rather than chaining an artifact — chosen for simplicity over a strict single-build `needs: shared` + upload/download.

### 2.1 `shared`
1. checkout + setup-node + `npm ci`
2. `npm run build:shared`
3. `npm run test:shared`

### 2.2 `web` (parallel with `api`)
1. checkout + setup-node + `npm ci`
2. `npm run build:shared` (web imports `@webatlas/shared`)
3. `npm run lint:web` (oxlint)
4. `npm run build:web` (`tsc -b` + vite build — catches type errors)
5. `npm test -w @webatlas/web` (vitest)

### 2.3 `api` (parallel with `web`)
Uses a PostGIS **service container**:
```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    env:
      POSTGRES_USER: webatlas
      POSTGRES_PASSWORD: webatlas
      POSTGRES_DB: webatlas
    ports: ['5432:5432']
    options: >-
      --health-cmd "pg_isready -U webatlas"
      --health-interval 10s --health-timeout 5s --health-retries 10
```
Steps:
1. checkout + setup-node + `npm ci`
2. `npm run build:shared` (api imports `@webatlas/shared`)
3. `npm run migrate` — node-pg-migrate up (the real migration path)
4. `npm run seed` — `tsx src/db/seeds/run.ts` (the real seed path)
5. `npm run test:api` — vitest against the migrated+seeded DB

Job-level `env` so migrate, seed, and test all see it:
```yaml
env:
  DATABASE_URL: postgres://webatlas:webatlas@localhost:5432/webatlas
  JWT_SECRET: ci_dummy_secret_at_least_16_chars
```
The service healthcheck gates the job; steps 3–5 only run once Postgres is healthy. (If a race is observed, add an explicit `pg_isready` wait loop before migrate — but the `services` healthcheck normally suffices.)

---

## 3. Data flow (a CI run)

1. A PR is opened/updated against `main`, or a commit lands on `main` → the workflow triggers.
2. Three jobs start. `shared` builds+tests the shared package. `web` and `api` each `npm ci`, build shared, then run their gate. `api` additionally waits for the PostGIS service, migrates, and seeds first.
3. Any non-zero step exit fails its job. GitHub aggregates the three job results into the PR's checks.
4. All green → the PR shows passing checks. Any red → the failing job's log pinpoints the step.

---

## 4. Error handling

- **Step failure → job failure → red check.** No `continue-on-error`; every step is load-bearing.
- **DB not ready:** the service healthcheck (`pg_isready`) blocks the job until Postgres accepts connections; migrate won't run against a cold DB.
- **Broken migration or seed:** fails `api` at step 3/4 — a feature, since it means CI also guards the migrate/seed path, not just tests.
- **Flaky install:** `npm ci` is deterministic from the lockfile; a lockfile/`package.json` mismatch fails fast at install.

---

## 5. Testing / validation

A workflow only genuinely runs on GitHub, so validation is empirical, not local:

- **Structural pre-check (local):** the YAML is declarative; confirm structure (valid keys, job names, service block, script names all matching real root/workspace scripts). This catches typos but does not prove a green run.
- **Real validation:** push the branch and observe the run on PR #9 (`gh run watch` / `gh pr checks 9`). Confirm all three jobs pass. This is the acceptance test and must be in the implementation plan — success is **not** claimed from the committed YAML alone.
- Confirm the check appears on the PR and would appear on future PRs (trigger config correct).

---

## 6. Follow-on (manual, outside the workflow)

- **Branch protection:** in GitHub repo settings → Branches → protect `main` → require the CI checks to pass before merge. A workflow file cannot set this; it is a one-time repo-owner action, noted here so the gate is actually enforced, not merely reported.
- Later roadmap items may add jobs (e.g. a deploy job, coverage) — additive to this file.

---

## 7. Scope boundaries (YAGNI — deferred)

- GeoServer in CI (tests don't use it).
- Multi-Node-version matrix (single Node 22 matches `engines`).
- Artifact-passing `dist/` between jobs (each job's `build:shared` is trivially fast).
- Coverage, caching beyond npm, Docker-layer caching, deploy/release.
- Required-check enforcement (repo setting, §6).
