# CI Pipeline (Roadmap 1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that runs the full lint/build/test gate (shared, web, api — with a real migrated+seeded PostGIS for api) on every PR to `main` and every push to `main`.

**Architecture:** One workflow file `.github/workflows/ci.yml` with three jobs: `shared` (build+test), and `web` / `api` running concurrently. Each job checks out, sets up Node 22 with npm caching, `npm ci`, and explicitly builds `@webatlas/shared` (there is NO root `prepare` hook — consumers resolve `dist/`, which exists only after `build:shared`). The `api` job runs a `postgis/postgis:16-3.4` service container, then `migrate` → `seed` → `test:api`. Validation is empirical: push and watch the run on PR #9.

**Tech Stack:** GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v4`), npm workspaces, node-pg-migrate, vitest, oxlint, PostGIS service container.

**Design doc:** `docs/superpowers/specs/2026-07-16-ci-pipeline-design.md`

## Global Constraints

- **Node:** `node-version: '22'` (matches root `engines: node >=22 <23`); `cache: 'npm'` on setup-node; install with `npm ci`.
- **Triggers (exact):** `pull_request: branches: [main]` and `push: branches: [main]`.
- **Every job builds shared explicitly** (`npm run build:shared`) before web/api steps — no artifact passing, no `needs` chain between `web` and `api` (they run concurrently).
- **api job env (exact values):** `DATABASE_URL: postgres://webatlas:webatlas@localhost:5432/webatlas` and `JWT_SECRET: ci_dummy_secret_at_least_16_chars` — set at job level so migrate, seed, and test all see them.
- **PostGIS service (exact):** image `postgis/postgis:16-3.4`, `POSTGRES_USER/PASSWORD/DB` all `webatlas`, port `5432:5432`, health-cmd `pg_isready -U webatlas`.
- **No `continue-on-error` anywhere** — every step is load-bearing.
- **GeoServer is NOT used in CI** (tests hit Postgres directly).
- Root scripts that exist and must be used verbatim: `build:shared`, `test:shared`, `lint:web`, `build:web`, `migrate`, `seed`, `test:api`. Web tests: this plan ADDS a root `test:web` script (roadmap 1.2 note) and the workflow uses it.
- **Success is claimed only from a green run on GitHub** (design §5) — never from the committed YAML alone.

---

### Task 1: The workflow file + root `test:web` script

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (root — add one script line)

**Interfaces:**
- Consumes: existing root scripts `build:shared`, `test:shared`, `lint:web`, `build:web`, `migrate`, `seed`, `test:api` (all verified present); workspace script `@webatlas/web` `test` = `vitest run`.
- Produces: root script `test:web` (= `npm run test -w @webatlas/web`), consumed by the workflow's web job; the workflow file consumed by Task 2's live validation.

- [ ] **Step 1: Add the root `test:web` script**

In the root `package.json`, the `scripts` block currently ends with `"test:api": "npm run test -w @webatlas/api"`. Add a `test:web` line so the block includes (order within the block does not matter, but keep the web scripts together):

```json
    "lint:web": "npm run lint -w @webatlas/web",
    "test:web": "npm run test -w @webatlas/web",
```

(That is: insert `"test:web": "npm run test -w @webatlas/web",` adjacent to the existing `lint:web` entry. Do not change any other line.)

- [ ] **Step 2: Verify the script works locally**

Run: `npm run test:web`
Expected: the web vitest suite runs — 22 files / 81 tests pass (no DB needed). This is the "failing test → make it pass" cycle for a script addition: before Step 1 the command errors with "Missing script"; after, it runs the suite.

- [ ] **Step 3: Create the workflow file**

Create `.github/workflows/ci.yml` with EXACTLY this content:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:shared
      - run: npm run test:shared

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:shared
      - run: npm run lint:web
      - run: npm run build:web
      - run: npm run test:web

  api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: webatlas
          POSTGRES_PASSWORD: webatlas
          POSTGRES_DB: webatlas
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U webatlas"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://webatlas:webatlas@localhost:5432/webatlas
      JWT_SECRET: ci_dummy_secret_at_least_16_chars
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:shared
      - run: npm run migrate
      - run: npm run seed
      - run: npm run test:api
```

- [ ] **Step 4: Structural sanity check (local)**

Run these checks (they catch typos; they do NOT prove a green run — that's Task 2):

```bash
# YAML parses
node -e "const yaml=require('js-yaml');const fs=require('fs');const d=yaml.load(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('jobs:',Object.keys(d.jobs).join(','));console.log('triggers:',Object.keys(d.on||d[true]||{}).join(','))" 2>/dev/null \
  || npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo "YAML OK"

# every npm script the workflow calls exists at the root
node -e "const s=require('./package.json').scripts;['build:shared','test:shared','lint:web','build:web','test:web','migrate','seed','test:api'].forEach(k=>{if(!s[k]){console.error('MISSING root script: '+k);process.exit(1)}});console.log('all workflow scripts exist')"
```

Expected: `YAML OK` (or the jobs/triggers listing) and `all workflow scripts exist`.

(Note: `js-yaml` may not be installed; the `npx --yes js-yaml` fallback fetches it ad hoc. If the machine has no network for npx, skip the YAML-parse check — Task 2's real run is the authoritative validation.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: add GitHub Actions gate (shared/web/api, postgis service) + root test:web"
```

---

### Task 2: Live validation on GitHub (the acceptance test)

The workflow only truly runs on GitHub. This task pushes it and confirms a green run on PR #9. Per the spec (§5), success is claimed ONLY from the observed run.

**Files:** none (verification only; a fix commit is created ONLY if the run fails).

**Interfaces:**
- Consumes: the committed `.github/workflows/ci.yml` from Task 1; open PR #9 (`feat/admin-editing-modify-delete` → `main`).
- Produces: a passing `CI` check (3 jobs) visible on PR #9.

- [ ] **Step 1: Push the branch**

```bash
git push origin feat/admin-editing-modify-delete
```

Expected: push succeeds; because PR #9 targets `main`, the `pull_request` trigger fires and a `CI` run starts.

- [ ] **Step 2: Watch the run**

```bash
# list the newest run for this branch, grab its id
gh run list --branch feat/admin-editing-modify-delete --limit 3
# watch it to completion (substitute the RUN_ID from the list)
gh run watch <RUN_ID> --exit-status
```

Expected: the run completes with all three jobs (`shared`, `web`, `api`) green and `gh run watch --exit-status` exits 0. Typical duration: shared ~1min, web ~2-3min, api ~3-5min (postgis pull + migrate + seed + tests).

- [ ] **Step 3: Confirm the check shows on the PR**

```bash
gh pr checks 9
```

Expected: three passing checks (one per job), no failures — replacing the previous "no checks reported".

- [ ] **Step 4: If any job fails — diagnose, fix, re-run**

Read the failing step's log:

```bash
gh run view <RUN_ID> --log-failed | tail -80
```

Likely failure modes and their fixes (commit any fix and push; the run re-triggers automatically):
- **`api` fails at migrate with connection refused:** the service healthcheck raced. Add an explicit wait step BEFORE `npm run migrate` in the api job:
  ```yaml
      - run: until pg_isready -h localhost -U webatlas; do sleep 2; done
        timeout-minutes: 2
  ```
  (`pg_isready` is preinstalled on ubuntu-latest via the postgres client tools; if not, `sudo apt-get install -y postgresql-client` first.)
- **`api` fails at test with missing env var:** an env key the API's zod `EnvSchema` requires isn't set. Read the error's variable name, check `apps/api/src/config/env.ts` for its default, and add it to the api job's `env:` block with a CI-safe dummy value.
- **`web` fails at lint/build/test:** a real regression — these all pass locally on this branch (81 tests, build + lint clean), so investigate the log; do not weaken the gate to get green.
- **npm ci fails:** lockfile mismatch — run `npm install` locally, commit the updated `package-lock.json`.

After any fix: re-run Steps 2–3 until green. Do NOT use `continue-on-error` or skip jobs to force green.

- [ ] **Step 5: Record the result**

Note the green run URL in the PR (a short comment or the ledger): "CI added — run <URL> green: shared/web/api all pass." No commit needed if Step 4 wasn't triggered.

---

## Self-Review

**1. Spec coverage (design §1–§7):**
- §2 triggers (PR→main + push main), runner, Node 22 + npm cache, `npm ci` → Task 1 Step 3 YAML ✓
- §2.1/§2.2/§2.3 three jobs, web∥api concurrent, each builds shared explicitly, api service container + migrate + seed + test → Task 1 Step 3 ✓
- §2.3 exact service image/env/healthcheck + job env (DATABASE_URL, JWT_SECRET) → Task 1 Step 3 + Global Constraints ✓
- §4 error handling: no continue-on-error (constraint); healthcheck race fallback → Task 2 Step 4 first bullet ✓
- §5 validation is the real run on PR #9, never YAML alone → Task 2 (the whole task) + Global Constraints last line ✓
- §6 branch protection = manual repo setting → correctly NOT a task (noted in spec; nothing for the implementer) ✓
- §7 YAGNI (no GeoServer, no matrix, no artifacts, no coverage) → absent from the plan ✓
- Roadmap 1.2's "add a root test:web script" → Task 1 Steps 1-2 ✓

**2. Placeholder scan:** none — full YAML given verbatim; every command exact with expected output; Task 2 Step 4's fixes include the actual YAML/commands to apply.

**3. Type/name consistency:** script names in the YAML (`build:shared`, `test:shared`, `lint:web`, `build:web`, `test:web`, `migrate`, `seed`, `test:api`) match the root package.json (verified) plus the one added in Task 1 Step 1. The branch/PR names (`feat/admin-editing-modify-delete`, PR #9) match the live repo state.

**4. Risks for the implementer:**
- The `pull_request` run executes the workflow from the PR's HEAD — so pushing the branch is sufficient to trigger it; no need to merge first.
- `postgis/postgis:16-3.4` is a multi-hundred-MB pull; first run is slower — that's normal, not a failure.
- The api tests create/delete `@webatlas.test` rows; the CI DB is ephemeral per run, so no cleanup concerns.
- If GitHub Actions is disabled on the repo (Settings → Actions), no run will start at all — enable it; this looks like "nothing happened" rather than a red run.
