# Registry Plan B — Tools Container, Every Runbook Step Registered, `atlas:up` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring a fresh clone to a working atlas with one command, `npm run atlas:up`. Every runbook step becomes a registered dataset or a step of `atlas:up`, and all heavy tooling runs inside one `atlas-tools` Docker image.

**Architecture:**
- **Scripts move.** `apps/api/scripts` moves to `packages/atlas-data/tools` and is hardened to run unattended: passwords come from the environment, any non-2xx fails, and nothing depends on docker-in-docker.
- **Tools image.** A new `atlas-tools` image holds the Python geo stack, `raster2pgsql`, `psql`, bash and curl. It is declared as a compose service under a `tools` profile.
- **Descriptors.** New descriptors wrap today's commands as `run` stages, each with a probe that says whether the dataset is built.
- **New commands.**
  - `atlas:adopt` records an already-built machine as built without running anything.
  - `atlas:status` groups datasets by state.
  - `atlas:verify` checks observed behaviour.
  - `atlas:up` orchestrates preflight → stack → tools image → migrate → build → verify.

**Tech Stack:** TypeScript (ES2023), zod, `pg`, vitest, Node 22 built-ins; Docker Compose v2; a Python 3 venv inside the tools image; bash and curl.

**Spec:** [`2026-09-30-registry-steps-2-5-design.md`](../specs/2026-09-30-registry-steps-2-5-design.md). The relevant parts are part 1 (UC-1–UC-5, UC-10, F-1, FR-1/2/5/8/9/12/13, NFR-1–5, C-1/3/8/10/11, U-1–U-7) and §7, §9, §10 (the step 3–4 table), §12 and §14 row B.

## Global Constraints

- **Branch:** `feat/registry-plan-b`, created from `main` at `0f4225c`. Node `>=22 <23`, npm `>=10`, Docker Compose v2.
- **Host prerequisites stay** Node 22, npm, Docker and git (NFR-1). Nothing in this plan may require Python, GDAL or bash **on the host** for `atlas:up` or `atlas:build`. Host stages start `node <npm-cli.js> …` (Plan A); tools stages run inside the container.
- **No shell on the host** (NFR-2). Every process starts with `shell: false`. Bash runs only **inside** the tools container.
- **No passwords in argv.**
  - A `run` stage's argv lands in lineage (`tool` column, append-only), in stage hashes and in failure messages.
  - Scripts read `GEOSERVER_ADMIN_PASSWORD` and database credentials from the environment. The compose `tools` service sets them from `infra/.env`.
- **Non-destructive** (NFR-3). No command in this plan may run `docker compose down` (with or without `-v`) or delete a volume. The Task 12 acceptance leaves its throwaway stack running, and the report names the cleanup command for the user to run.
- **No new runtime dependencies** in `packages/atlas-data`. It may use only `pg`, `zod` and Node built-ins. The tools image's Python packages are pinned in `packages/atlas-data/tools/requirements.txt`.
- **Old commands keep working until Plan C** (NFR-7): `npm run seed`, `npm run ingest:rivers -w @webatlas/api`, `npm run publish:geoserver`, `npm run reference:build -w @webatlas/api` and `npm run contours:generate -w @webatlas/api`.
- **Migrations are never edited.** Historical path mentions inside `apps/api/src/db/migrations/*.cjs` stay as they are, because applied migrations are immutable.
- **Tests:**
  - Database-backed tests are gated on `DATABASE_URL`, GeoServer-backed tests on `GEOSERVER_URL`, and tools-image tests on `ATLAS_TOOLS_TESTS=1`. Every gated suite must be shown to execute, not skip. Export the dev env from the repo root in Git Bash with `set -a; . apps/api/.env; set +a`.
  - Test datasets, layers and views use the `__atlasdata_test__` prefix.
- **Typecheck:** run `npm run build -w @webatlas/atlas-data` (tsc over `src`) before every commit. vitest does not typecheck.
- **Commits** are in Vietnamese and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Measured Baselines (2026-09-30, `main` at `0f4225c`)

- **atlas-data:** 22 test files and 189 tests pass with the env exported. `npm run atlas:status` shows `demo` ok and `rivers` ok (`0:run`, `1:publish-geoserver`).
- **This machine already holds:**
  - the basemap: `basemap.roads_region`, and the WMS layer group `webatlas:basemap` renders PNG in about 6 s cold;
  - the reference entities: landuse 770, places 5,989, railways 203, roads 13,354, water 597;
  - the DEM: `basemap.dem_region` with 7,242 tiles, and Buôn Ma Thuột reads about 472 m;
  - contours: 250 m → 19,275, 100 m → 50,760, 50 m → 103,672;
  - `admin.provinces` 34 rows, and 588 level-1 rivers.
- **WMS behaviour:** a GetMap for a **missing** layer answers HTTP **200** with `application/vnd.ogc.se_xml`. Probes must therefore check the content type, not the status.
- **Line endings:** `core.autocrlf=true` and there is no `.gitattributes`. The working-tree `.sh` and `.py` scripts have **CRLF** line endings, which break bash inside a Linux container.
- **DEM location:** the DEM intermediates live at `apps/api/src/db/seeds/data/dem` (680 MB, git-ignored).

## Carried Over from Plan A's Final Review (Task 1)

The review items are recorded in `.superpowers/sdd/archive-registry-plan-a/progress.md` (the "Final review" section):
- `fetch-http`: remove a stale `.source` sidecar before the rename;
- cancel the body of a non-2xx fetch;
- name the call in GeoServer body-read timeouts;
- spec §8 retry wording;
- the live publish test must publish a `__atlasdata_test__` view instead of the real `dams`;
- "0 s" in the idle message.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `.gitattributes` | Force LF for `*.sh`, `*.py`, `Dockerfile` |
| `packages/atlas-data/tools/**` | Moved from `apps/api/scripts/**` with `git mv` |
| `packages/atlas-data/tools/Dockerfile`, `requirements.txt`, `.dockerignore` | The `atlas-tools` image |
| `packages/atlas-data/tools/lib/geoserver.sh` | Shared fail-closed GeoServer REST helpers for the two publish scripts |
| `packages/atlas-data/tools/basemap/publish-basemap.test.mjs` | Curl-stub tests for the hardened basemap publish |
| `packages/atlas-data/tools/basemap/styles.test.ts`, `tools/contours/styles.test.ts` | Moved from `apps/api/src/geoserver/{basemapStyles,contourStyles}.test.ts` |
| `packages/atlas-data/src/compose.ts` (+test) | `composeEnv`, `composeFile`, `composeArgs` |
| `packages/atlas-data/src/probes.ts` (+test, +db test) | Probe building blocks and `probeContext` |
| `packages/atlas-data/src/descriptors/{seeds,basemap,referenceEntities,dem,contours}.ts` | The step 3–4 datasets |
| `packages/atlas-data/src/descriptors/descriptors.test.ts` | Paths, scripts, intervals and licences are all real |
| `packages/atlas-data/src/adopt.ts` (+test), `src/cli/adopt.ts` | `atlas:adopt` |
| `packages/atlas-data/src/status.ts` (+test) | `computeStatus`, `formatStatus` |
| `packages/atlas-data/src/verify.ts` (+test), `src/cli/verify.ts` | `atlas:verify` |
| `packages/atlas-data/src/up.ts` (+test), `src/cli/system.ts`, `src/cli/up.ts` | `atlas:up` |
| `packages/atlas-data/src/cli/report.ts` | `printBuildReport`, shared by `build` and `up` |
| `packages/atlas-data/src/stages/tools.docker.test.ts` | The image really has its tools; a tools stage really runs |

**Modified**

| File | Change |
|---|---|
| `packages/atlas-data/src/types.ts`, `schema.ts` | `Dataset.probe`, `ProbeContext`, `ProbeResult` |
| `packages/atlas-data/src/lineage.ts` | `adoptionStep` |
| `packages/atlas-data/src/stages/run.ts` | Tools spawn: `-T --no-deps`, `composeEnv`, `composeFile` |
| `packages/atlas-data/src/stages/fetchHttp.ts`, `src/geoserver.ts`, `src/stages/publishGeoserver.live.test.ts` | Plan A carry-overs |
| `packages/atlas-data/src/descriptors/rivers.ts`, `index.ts` | `dependsOn: ['seeds']`, publish `rivers_overview`, probe; register the new datasets |
| `packages/atlas-data/src/cli/status.ts`, `build.ts` | Grouped status; shared report printer |
| `packages/atlas-data/package.json`, root `package.json` | `atlas:adopt`, `atlas:verify`, `atlas:up` |
| `infra/docker-compose.yml` | The `tools` service (profile `tools`) |
| `packages/atlas-data/tools/basemap/styles.py`, `contours/styles.py`, `basemap/publish-basemap.sh`, `contours/publish-contours.sh`, `basemap/load_basemap.py`, `prep_dem.py`, `load-dem.sh` | Run unattended in the container |
| `apps/api/src/db/seeds/reachSeed.test.ts`, `.gitignore`, `README.md`, `docs/runbooks/*.md`, `docs/architecture/database-architecture.md`, `packages/shared/src/layer-palette.ts` (+dist), comments that name `apps/api/scripts` | New paths |
| `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md` | §8 retry wording (Task 1) |

**Deleted:** `apps/api/scripts/raster-tools.Dockerfile` (the tools image supersedes it) and `apps/api/src/geoserver/{basemapStyles,contourStyles}.test.ts` (moved).

---

### Task 1: Plan A carry-overs

**Files:**
- Modify: `packages/atlas-data/src/stages/fetchHttp.ts`, `src/geoserver.ts`, `src/stages/publishGeoserver.live.test.ts`, `src/stages/fetchHttp.test.ts`, `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md`

**Interfaces:**
- Consumes: Plan A's `executeFetchHttp`, `publishLayer` and `geoserverEnv`.
- Produces: no new names.

- [ ] **Step 1: Archive Plan A's ledger (controller housekeeping, no commit)**

This is done by the controller before dispatching Task 1. Move `.superpowers/sdd/progress.md` and Plan A's task files to `.superpowers/sdd/archive-registry-plan-a/`.

- [ ] **Step 2: Write the failing tests**

In `src/stages/fetchHttp.test.ts`, add inside `describe('fetch-http', …)`:

```ts
  it('reports sub-second idle timeouts with one decimal, not "0 s"', async () => {
    mode = 'stall';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache, 200)).rejects.toThrow(/for 0\.2 s/);
  });
```

`executeFetchHttp`'s fifth parameter is `idleMs`, and the stall server mode is `'stall'`. Both come from Plan A's H-4.

Replace the whole of `src/stages/publishGeoserver.live.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Pool } from 'pg';
import { executePublishGeoserver } from './publishGeoserver';
import { geoserverEnv } from '../geoserver';

const GS = process.env.GEOSERVER_URL;
const DB = process.env.DATABASE_URL;
const ctx = { datasetId: '__atlasdata_test__', forced: false, log: () => {} };
const VIEW = '__atlasdata_test__view';
const LAYER = '__atlasdata_test__layer';

/**
 * Publishes a view this test owns, never a real layer (Plan A final review): the view lives in the
 * `water` schema the webatlas_water datastore reads, and both it and its featuretype are removed in
 * afterAll.
 */
describe.skipIf(!GS || !DB)('publish-geoserver against the running GeoServer', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB });
    await pool.query(
      `CREATE OR REPLACE VIEW water.${VIEW} AS
         SELECT 1::int AS id, ST_SetSRID(ST_MakePoint(108.05, 12.68), 4326)::geometry(Point, 4326) AS geom`
    );
  });

  afterAll(async () => {
    const gs = geoserverEnv();
    await fetch(
      `${gs.url}/rest/workspaces/${gs.workspace}/datastores/${gs.workspace}_water/featuretypes/${LAYER}?recurse=true`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64') },
      }
    );
    await pool.query(`DROP VIEW IF EXISTS water.${VIEW}`);
    await pool.end();
  });

  it('publishes a layer it owns, idempotently, and the layer serves WFS', async () => {
    const stage = { type: 'publish-geoserver' as const, layer: LAYER, nativeName: VIEW };
    const first = await executePublishGeoserver({} as Pool, stage, ctx);
    expect(first.summary).toMatch(new RegExp(`→ ${VIEW} \\((created|unchanged)\\)$`));
    const second = await executePublishGeoserver({} as Pool, stage, ctx);
    expect(second.summary).toMatch(/\(unchanged\)$/);

    const res = await fetch(
      `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:${LAYER}&outputFormat=application/json&count=1`
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { features: unknown[] }).features).toHaveLength(1);
  }, 60_000);

  it('fails when the backing relation does not exist', async () => {
    await expect(
      executePublishGeoserver(
        {} as Pool,
        { type: 'publish-geoserver', layer: '__atlasdata_test__missing', nativeName: '__atlasdata_test__no_such_view' },
        ctx
      )
    ).rejects.toThrow();
  }, 60_000);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data -- src/stages/fetchHttp.test.ts src/stages/publishGeoserver.live.test.ts`

Expected: the idle-message test FAILs because the message says `0 s`. The live test is expected to pass or fail depending on whether the old code already handles an owned layer. That's fine: its purpose is to stop touching `dams`.

- [ ] **Step 4: Implement**

**The idle message.** In `src/stages/fetchHttp.ts`, where the idle error text is built, replace the whole-seconds formatting with:

```ts
const seconds = idleMs < 10_000 ? (idleMs / 1000).toFixed(1) : String(Math.round(idleMs / 1000));
```

and use `${seconds} s` in the message.

**The stale sidecar.** In the same file, immediately **before** `await rename(part, target);`, add:

```ts
    // A crash between the rename and the sidecar write must never pair the new file with the
    // OLD url's sidecar (Plan A final review). With the sidecar gone first, a crash there just
    // means the next run re-downloads.
    await rm(sidecar, { force: true });
```

**The non-2xx body.** Where a non-2xx response is rejected (the `if (!res.ok || !res.body) throw …` line), cancel the body first:

```ts
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error(`fetch-http: GET ${stage.url} returned ${res.status}`);
    }
```

**Body-read timeouts.** In `src/geoserver.ts`, the body reads (`existing.json()` and `res.text()` inside `expectOk`) can throw a raw `TimeoutError` or `AbortError`. Wrap each read so the same named error the request path produces is thrown instead: ``GeoServer <METHOD> <path> timed out``. Implement this with a small helper beside the existing request-timeout mapping, and use it at both reads.

**The spec wording.** In `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md` §8, in the `run` executor bullet, replace the sentence that says `--only` alone "retries just the failed stage" with:

> `--only <id>` retries the failed stage and the stages after it that never ran; datasets that depend on `<id>` stay `missing` until a full `atlas:build`. `--force` would also redo completed stages, including downloads.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`

Expected: every test passes with 0 skipped. The live suite runs 2 tests. Afterwards, `curl -s -o /dev/null -w "%{http_code}" -u admin:$GEOSERVER_ADMIN_PASSWORD $GEOSERVER_URL/rest/workspaces/webatlas/datastores/webatlas_water/featuretypes/__atlasdata_test__layer` must print `404`, which proves the cleanup ran.

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-data/src docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md
git commit -m "fix(atlas-data): các mục tồn từ đánh giá cuối kế hoạch A — sidecar, thân phản hồi, test publish dùng view riêng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Line endings, and `apps/api/scripts` moves into `packages/atlas-data/tools`

**Files:**
- Create: `.gitattributes`
- Move: `apps/api/scripts/` → `packages/atlas-data/tools/` (`git mv`)
- Move: `apps/api/src/geoserver/basemapStyles.test.ts` → `packages/atlas-data/tools/basemap/styles.test.ts`; `apps/api/src/geoserver/contourStyles.test.ts` → `packages/atlas-data/tools/contours/styles.test.ts`
- Modify: `.gitignore`, `apps/api/src/db/seeds/reachSeed.test.ts`, `packages/atlas-data/tools/contours/publish-contours.test.mjs`, every non-migration file that names `apps/api/scripts` (list in Step 5), `packages/shared/src/layer-palette.ts` (+ rebuilt `dist`)

**Interfaces:**
- Produces:
  - `packages/atlas-data/tools/` holds every script. Later tasks refer to:
    - `tools/basemap/{load_basemap.py,styles.py,publish-basemap.sh}`
    - `tools/contours/{styles.py,publish-contours.sh}`
    - `tools/prep_dem.py`
    - `tools/load-dem.sh`
    - `tools/lib/`
  - `apps/api` holds no scripts directory.

- [ ] **Step 1: Line endings first**

Create `.gitattributes` at the repo root:

```
# Scripts run inside the Linux atlas-tools container. With core.autocrlf=true and no
# attributes, Windows checkouts hold CRLF, and bash fails on the first line
# ($'\r': command not found). Measured 2026-09-30: every .sh and .py under
# apps/api/scripts had CRLF.
*.sh        text eol=lf
*.py        text eol=lf
Dockerfile  text eol=lf
```

Then renormalise, and refresh the working copies so they actually carry LF:

```bash
git add .gitattributes
git add --renormalize .
git status --short          # expect only .gitattributes (and possibly renormalised files)
git rm -r --cached -q apps/api/scripts && git reset -q -- apps/api/scripts && git checkout -- apps/api/scripts
file apps/api/scripts/load-dem.sh apps/api/scripts/contours/publish-contours.sh
```

Expected: `file` reports no `CRLF`. This `git checkout` rewrites working files from the index. It is safe here because the tree is clean, but run `git status` first and **stop** if anything under `apps/api/scripts` is modified.

- [ ] **Step 2: Move the scripts**

```bash
git mv apps/api/scripts packages/atlas-data/tools
git mv apps/api/src/geoserver/basemapStyles.test.ts packages/atlas-data/tools/basemap/styles.test.ts
git mv apps/api/src/geoserver/contourStyles.test.ts packages/atlas-data/tools/contours/styles.test.ts
```

`git mv` of the directory also moves the untracked `.osm-cache/` and `__pycache__/`. That is intended.

The scripts compute the repo root from their own path. `parents[4]` for `basemap/*.py` and `contours/*.py`, `parents[3]` for `prep_dem.py`, and `../../..` in `load-dem.sh` all resolve to the same root at the new depth: `packages/atlas-data/tools/<x>` is exactly as deep as `apps/api/scripts/<x>`. Verify this:

```bash
python3 -c "import pathlib; p=pathlib.Path('packages/atlas-data/tools/basemap/styles.py').resolve(); print(p.parents[4])"
```

Expected: the repo root.

- [ ] **Step 3: Point the moved tests at their new home**

In `packages/atlas-data/tools/contours/styles.test.ts`, replace `const SLD_DIR = join(process.cwd(), 'scripts', 'contours');` with:

```ts
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SLD_DIR = dirname(fileURLToPath(import.meta.url));
```

Merge the imports with the existing `node:path` import.

In `packages/atlas-data/tools/basemap/styles.test.ts`:
- Set `SLD_DIR` the same way.
- Replace `import { getPool, closePool } from '../db/pool';` with `import pg from 'pg';`.
- Replace `pool = getPool();` with `pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });`.
- Replace `await closePool();` with `await pool.end();`.
- Wrap every `describe` block that queries the database in `describe.skipIf(!process.env.DATABASE_URL)(…)`. Text-only assertions over the SLD files stay unconditional. The `beforeAll`/`afterAll` that create the pool move inside the gated block.

In `packages/atlas-data/tools/contours/publish-contours.test.mjs`, replace `const SCRIPT = join(process.cwd(), 'scripts', 'contours', 'publish-contours.sh');` with:

```js
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'publish-contours.sh');
```

In `apps/api/src/db/seeds/reachSeed.test.ts`, replace `const PREP = resolvePath(here, '../../../scripts/prep_hydrosheds.py');` with:

```ts
const PREP = resolvePath(here, '../../../../../packages/atlas-data/tools/prep_hydrosheds.py');
```

- [ ] **Step 4: Run both suites**

Run:

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data
npm test -w @webatlas/api -- src/db/seeds/reachSeed.test.ts
```

Expected:
- **atlas-data:** the suite now also runs `tools/lib/regionClip.test.mjs`, `tools/lib/simplify.test.mjs`, `tools/contours/publish-contours.test.mjs`, `tools/basemap/styles.test.ts` and `tools/contours/styles.test.ts`. Every file passes, and the DB-backed basemap style tests run rather than skip.
- **reachSeed:** passes.

- [ ] **Step 5: Update every path mention**

Run `git grep -n "apps/api/scripts" -- ':!docs/superpowers' ':!.superpowers' ':!apps/api/src/db/migrations'` and replace each hit with the new path, so that `apps/api/scripts/<x>` becomes `packages/atlas-data/tools/<x>`. The hits are:
- `.gitignore`: the `.osm-cache` line, and the DEM comment. Also add `packages/atlas-data/tools/.osm-cache/` in place of the old line.
- `README.md`: the lines that run `node apps/api/scripts/…` and `apps/api/scripts/prep-hydrosheds.sh`.
- The `Chạy: node apps/api/scripts/…` header comment in each moved `.mjs` script, and the report string in `report-dam-crosscheck.mjs`.
- `prep_dem.py`'s `Next:` print, and `test_styles_upload.py`'s usage line.
- `apps/api/src/reference/registry.ts` and `apps/api/src/scripts/buildReference.ts` (comments).
- `apps/api/src/modules/assistant/tools/registry.ts` (comment).
- `docs/architecture/database-architecture.md` §10.2.
- `docs/runbooks/{elevation-dem,terrain-contours,self-hosted-basemap,map-assistant}.md`. Update the paths only; the full rewrite comes in Task 11.
- `packages/shared/src/layer-palette.ts` (comment). Then run `npm run build:shared` and stage `packages/shared/dist/layer-palette.js`, which is already tracked, so plain `git add` works.

Leave `docs/reports/dam-crosscheck.md` alone: it is a dated, generated report. Leave the migrations alone too.

Afterwards, the grep above must print nothing.

- [ ] **Step 6: Run everything that could notice**

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data
npm run build -w @webatlas/atlas-data
npm test -w @webatlas/shared
npm test -w @webatlas/api -- src/db/seeds src/reference src/geoserver
```

Expected: all pass, and `apps/api/src/geoserver` still holds `publish.test.ts`. The full API suite is left to the controller, because it takes about 7 minutes.

- [ ] **Step 7: Commit**

```bash
git add -A .gitattributes .gitignore apps packages docs README.md
git status --short   # confirm nothing unexpected (no .osm-cache or __pycache__ contents)
git commit -m "refactor: chuyển apps/api/scripts sang packages/atlas-data/tools; ép LF cho .sh/.py

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The scripts run unattended

**Files:**
- Create: `packages/atlas-data/tools/lib/geoserver.sh`, `packages/atlas-data/tools/basemap/publish-basemap.test.mjs`
- Modify: `tools/basemap/styles.py`, `tools/contours/styles.py`, `tools/basemap/publish-basemap.sh`, `tools/contours/publish-contours.sh`, `tools/contours/publish-contours.test.mjs`, `tools/basemap/load_basemap.py`, `tools/prep_dem.py`, `tools/load-dem.sh`
- Delete: `tools/raster-tools.Dockerfile`

**Interfaces:**
- Produces script contracts that Task 6's descriptors rely on:
  - `python3 packages/atlas-data/tools/basemap/load_basemap.py <zip>`, which reads the DB from `BASEMAP_DB_URL`
  - `python3 packages/atlas-data/tools/basemap/styles.py`, which reads `GEOSERVER_URL`, `GEOSERVER_ADMIN_USER` and `GEOSERVER_ADMIN_PASSWORD` from the env, and exits non-zero on any non-2xx
  - `bash packages/atlas-data/tools/basemap/publish-basemap.sh`, which is idempotent and fails closed
  - `python3 packages/atlas-data/tools/contours/styles.py`, with the password from the env
  - `bash packages/atlas-data/tools/contours/publish-contours.sh`, which ensures the workspace and the `basemap_pg` store itself
  - `python3 packages/atlas-data/tools/prep_dem.py --mainland --out packages/atlas-data/data/cache/dem`
  - `bash packages/atlas-data/tools/load-dem.sh packages/atlas-data/data/cache/dem/clipped`, which runs inside the container using `PGHOST`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`

- [ ] **Step 1: Write the failing tests**

Create `packages/atlas-data/tools/basemap/publish-basemap.test.mjs`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * publish-basemap.sh against a STUBBED curl: the stub answers by METHOD and URL from env vars,
 * never a real GeoServer. Since Plan B the script runs unattended as a registry stage, so any
 * non-2xx must fail it — a silent failure would be recorded as a successful build.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'publish-basemap.sh');
let stubDir;

const CURL_STUB = `#!/usr/bin/env bash
method=GET; url=""; fmt=""; prev=""
for arg in "$@"; do
  [ "$prev" = "-w" ] && fmt="$arg"
  case "$arg" in -XPOST) method=POST ;; -XPUT) method=PUT ;; -XDELETE) method=DELETE ;; http*) url="$arg" ;; esac
  prev="$arg"
done
case "$method $url" in
  "GET "*/workspaces/webatlas)                code="\${STUB_WS_GET:-200}" ;;
  "POST "*/workspaces)                        code="\${STUB_WS_CREATE:-201}" ;;
  "GET "*/datastores/basemap_pg)              code="\${STUB_STORE_GET:-200}" ;;
  "POST "*/datastores)                        code="\${STUB_STORE_CREATE:-201}" ;;
  "GET "*/featuretypes/*)                     code="\${STUB_FT_GET:-404}" ;;
  "POST "*/featuretypes)                      code="\${STUB_FT_CREATE:-201}" ;;
  "PUT "*/featuretypes/*)                     code="\${STUB_FT_UPDATE:-200}" ;;
  "GET "*/layergroups/basemap)                code="\${STUB_GROUP_GET:-404}" ;;
  "POST "*/layergroups)                       code="\${STUB_GROUP_CREATE:-201}" ;;
  "PUT "*/layergroups/basemap)                code="\${STUB_GROUP_UPDATE:-200}" ;;
  "POST "*/gwc/rest/masstruncate)             code="\${STUB_TRUNCATE:-200}" ;;
  *) code="000" ;;
esac
out="\${fmt//%\\{http_code\\}/\$code}"
printf '%b' "\$out"
`;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'publish-basemap-stub-'));
  writeFileSync(join(stubDir, 'curl'), CURL_STUB);
  chmodSync(join(stubDir, 'curl'), 0o755);
});
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

function run(env) {
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
      GEOSERVER_URL: 'http://fake-geoserver.invalid/geoserver',
      GEOSERVER_ADMIN_USER: 'admin',
      GEOSERVER_ADMIN_PASSWORD: 'pw',
      ...env,
    },
  });
}

describe('publish-basemap.sh — fail closed, idempotent', () => {
  it('publishes from scratch and truncates the cache', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('layergroup: 201');
    expect(r.stdout).toContain('truncate: 200');
    expect(r.stdout).toContain('Done.');
  });

  it('updates existing feature types and the layer group with PUT', () => {
    const r = run({ STUB_FT_GET: '200', STUB_GROUP_GET: '200' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('layergroup: 200');
  });

  it('fails and never truncates when the datastore cannot be created', () => {
    const r = run({ STUB_STORE_GET: '404', STUB_STORE_CREATE: '401' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('datastore: 401');
    expect(r.stdout).not.toContain('truncate:');
  });

  it('fails on an existence check that is neither 200 nor 404', () => {
    const r = run({ STUB_WS_GET: '500' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('returned 500');
  });

  it('refuses to run without the admin password in the environment', () => {
    const r = run({ GEOSERVER_ADMIN_PASSWORD: '' });
    expect(r.status).not.toBe(0);
  });
});
```

In `tools/contours/publish-contours.test.mjs`:
- Replace the whole `curlStub` string with the method-aware stub above (the same `case` table).
- Replace its three tests with the following, keeping the `run()` helper:

```js
describe('publish-contours.sh — REST call failures must fail the publish', () => {
  it('publishes every interval and truncates each', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Done.');
  });

  it('exits non-zero and stops before truncating when a featuretype call 401s', () => {
    const r = run({ STUB_FT_CREATE: '401' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/featuretype contours_\d+: 401/);
    expect(r.stdout).not.toContain('truncate:');
  });

  it('updates an existing featuretype with PUT', () => {
    const r = run({ STUB_FT_GET: '200', STUB_FT_UPDATE: '200' });
    expect(r.status).toBe(0);
  });

  it('creates the basemap_pg store itself when the basemap was never published', () => {
    const r = run({ STUB_STORE_GET: '404', STUB_STORE_CREATE: '201' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('datastore: 201');
  });
});
```

For the style PUT, add a `"PUT "*/layers/*) code="\${STUB_STYLE:-200}" ;;` line to the contours copy of the stub.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- tools/basemap/publish-basemap.test.mjs tools/contours/publish-contours.test.mjs`

Expected: FAIL. The old basemap script never exits non-zero, and the old contours script neither creates the store nor makes an existence GET.

- [ ] **Step 3: The shared GeoServer helpers**

Create `packages/atlas-data/tools/lib/geoserver.sh`:

```bash
# Fail-closed GeoServer REST helpers shared by the tools' publish scripts. Sourced, never run.
# Every call prints only the HTTP status; any unexpected status stops the calling script.

GEOSERVER_URL="${GEOSERVER_URL:-http://localhost:8080/geoserver}"
GS="${GEOSERVER_URL}/rest"
WS="${GEOSERVER_WORKSPACE:-webatlas}"
BASEMAP_STORE="basemap_pg"
AUTH="${GEOSERVER_ADMIN_USER:-admin}:${GEOSERVER_ADMIN_PASSWORD:?set GEOSERVER_ADMIN_PASSWORD (read from the environment, never argv)}"

# curl printing only the status code. A transport failure prints 000 rather than aborting here,
# so the caller's require_2xx reports it with its label.
gs_curl() { curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" "$@" || true; }

require_2xx() {
  local label="$1" code="$2"
  echo "   ${label}: ${code}"
  case "$code" in
    2??) ;;
    *) echo "ERROR: ${label} returned ${code}, expected 2xx" >&2; exit 1 ;;
  esac
}

# 0 when the resource exists (200), 1 when it does not (404). Anything else — 401, 500, 000 — stops
# the script: treating an error as "missing" would POST blindly and hide the real cause.
gs_exists() {
  local code
  code=$(gs_curl "$1")
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *) echo "ERROR: GET $1 returned ${code}" >&2; exit 1 ;;
  esac
}

gs_ensure_workspace() {
  if ! gs_exists "$GS/workspaces/$WS"; then
    require_2xx workspace "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces" \
      -d "{\"workspace\":{\"name\":\"$WS\"}}")"
  fi
}

# The PostGIS store over the `basemap` schema. Both the basemap and the contours read from it, so each
# ensures it rather than one depending on the other having run.
gs_ensure_basemap_store() {
  if gs_exists "$GS/workspaces/$WS/datastores/$BASEMAP_STORE"; then return 0; fi
  require_2xx datastore "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces/$WS/datastores" -d "{
  \"dataStore\":{\"name\":\"$BASEMAP_STORE\",\"connectionParameters\":{\"entry\":[
    {\"@key\":\"dbtype\",\"\$\":\"postgis\"},{\"@key\":\"host\",\"\$\":\"${GEOSERVER_DB_HOST:-db}\"},
    {\"@key\":\"port\",\"\$\":\"${GEOSERVER_DB_PORT:-5432}\"},{\"@key\":\"database\",\"\$\":\"${GEOSERVER_DB_NAME:-webatlas}\"},
    {\"@key\":\"schema\",\"\$\":\"basemap\"},{\"@key\":\"user\",\"\$\":\"${GEOSERVER_DB_USER:-webatlas}\"},
    {\"@key\":\"passwd\",\"\$\":\"${GEOSERVER_DB_PASSWORD:-}\"},{\"@key\":\"Expose primary keys\",\"\$\":\"true\"},
    {\"@key\":\"Loose bbox\",\"\$\":\"true\"}]}}}")"
}

# gs_ensure_featuretype <store> <name> <body> [content-type]: create, or PUT onto an existing one.
gs_ensure_featuretype() {
  local store="$1" name="$2" body="$3" ctype="${4:-application/json}"
  local path="$GS/workspaces/$WS/datastores/$store/featuretypes"
  if gs_exists "$path/$name"; then
    require_2xx "featuretype $name" "$(gs_curl -XPUT -H "Content-Type: $ctype" "$path/$name" -d "$body")"
  else
    require_2xx "featuretype $name" "$(gs_curl -XPOST -H "Content-Type: $ctype" "$path" -d "$body")"
  fi
}
```

- [ ] **Step 4: The basemap publish**

Replace the whole of `tools/basemap/publish-basemap.sh`. Keep its existing header comment block, updated for these changes, then:

```bash
#!/usr/bin/env bash
# (keep the existing explanatory header here)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/geoserver.sh
. "$SCRIPT_DIR/../lib/geoserver.sh"

LAYERS=(land_vn landuse_region water_region railways_vn roads_region roads_vn)
STYLES=(basemap_land basemap_landuse basemap_water basemap_railways basemap_roads_region basemap_roads_vn)

echo "== workspace and datastore"
gs_ensure_workspace
gs_ensure_basemap_store

echo "== feature types"
for t in "${LAYERS[@]}" places_vn places_region; do
  gs_ensure_featuretype "$BASEMAP_STORE" "$t" \
    "{\"featureType\":{\"name\":\"$t\",\"nativeName\":\"$t\",\"srs\":\"EPSG:4326\",\"enabled\":true}}"
done

published=""; styled=""
for i in "${!LAYERS[@]}"; do
  published="$published{\"@type\":\"layer\",\"name\":\"$WS:${LAYERS[$i]}\"},"
  styled="$styled{\"name\":\"$WS:${STYLES[$i]}\"},"
done
published="${published%,}"; styled="${styled%,}"
BODY="{\"layerGroup\":{\"name\":\"basemap\",\"mode\":\"SINGLE\",
  \"title\":\"WebATLAS self-hosted basemap (OSM/ODbL, no labels)\",
  \"workspace\":{\"name\":\"$WS\"},
  \"publishables\":{\"published\":[$published]},
  \"styles\":{\"style\":[$styled]},
  \"bounds\":{\"minx\":102.0,\"maxx\":117.9,\"miny\":8.0,\"maxy\":23.5,\"crs\":\"EPSG:4326\"}}}"

echo "== layer group 'basemap'"
if gs_exists "$GS/workspaces/$WS/layergroups/basemap"; then
  require_2xx layergroup "$(gs_curl -XPUT -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups/basemap" -d "$BODY")"
else
  require_2xx layergroup "$(gs_curl -XPOST -H "Content-Type: application/json" "$GS/workspaces/$WS/layergroups" -d "$BODY")"
fi

echo "== truncate stale tiles (style and group changes do not invalidate the cache)"
require_2xx truncate "$(gs_curl -XPOST -H "Content-Type: text/xml" \
  --data "<truncateLayer><layerName>$WS:basemap</layerName></truncateLayer>" \
  "$GEOSERVER_URL/gwc/rest/masstruncate")"
echo "Done."
```

Keep the trailing "Tile endpoint" echo lines from the old script, after `Done.`, if you like.

- [ ] **Step 5: The contours publish**

In `tools/contours/publish-contours.sh`:
- Replace the block from `GEOSERVER_URL=…` through the `require_2xx()` function definition with the following. Keep `set -euo pipefail` and the header comment.

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/geoserver.sh
. "$SCRIPT_DIR/../lib/geoserver.sh"
STORE="${CONTOUR_STORE:-$BASEMAP_STORE}"

echo "== workspace and datastore"
gs_ensure_workspace
gs_ensure_basemap_store
```

- In the per-interval loop, replace the `code=$(curl … POST …)`, the `if [ "$code" = "500" ] || … PUT …` retry and its `require_2xx featuretype "$code"` with:

```bash
  gs_ensure_featuretype "$STORE" "$NAME" "$BODY" "text/xml"
```

- Replace the style and truncate `curl` calls with `gs_curl` (the same arguments minus `-s -o /dev/null -w … -u "$AUTH"`), keeping their `require_2xx style` and `require_2xx truncate` checks.
- Keep the `INTERVALS="$(python3 "$SCRIPT_DIR/styles.py" --print-intervals)"` block as it is.

- [ ] **Step 6: Passwords from the environment in both `styles.py`**

In `tools/basemap/styles.py`:

```python
USER = os.environ.get("GEOSERVER_ADMIN_USER", "admin")
SLD_DIR = pathlib.Path(__file__).resolve().parent
```

Add both near the existing `GS` and `WS` constants. Then:
- **`upload(name, xml, pw)`:** write to `SLD_DIR / f"{name}.sld"` instead of the working directory. Use `f"{USER}:{pw}"` for auth, and `f"@{path}"` with that absolute path for `--data-binary`.
- **`assign(layer, style, pw)`:** use `f"{USER}:{pw}"`.
- **The `__main__` block:** replace it with:

```python
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write-only":
        for name, xml in STYLES.items():
            (SLD_DIR / f"{name}.sld").write_text(xml, encoding="utf-8")
        sys.exit(0)
    # From the environment, never argv: a registry `run` stage's argv is written to lineage
    # (append-only) and shows in process listings.
    pw = os.environ.get("GEOSERVER_ADMIN_PASSWORD")
    if not pw:
        raise SystemExit("GEOSERVER_ADMIN_PASSWORD is not set (the password is read from the environment)")
    failed = []
    for name, xml in STYLES.items():
        code = upload(name, xml, pw)
        print(f"style {name:<24} upload {code}")
        if not code.startswith("2"):
            failed.append(f"style {name}: {code}")
    print()
    for layer, style in PAIRS:
        code = assign(layer, style, pw)
        print(f"assign {layer:<18} -> {style:<24} {code}")
        if not code.startswith("2"):
            failed.append(f"assign {layer}: {code}")
    if failed:
        raise SystemExit("GeoServer rejected: " + "; ".join(failed))
```

In `tools/contours/styles.py`, replace the argument-count check and `password = sys.argv[1]` with:

```python
    password = os.environ.get("GEOSERVER_ADMIN_PASSWORD")
    if not password:
        raise SystemExit(
            "GEOSERVER_ADMIN_PASSWORD is not set (read from the environment, never argv)\n"
            "usage: python styles.py                    (write .sld and upload)\n"
            "       python styles.py --write-only       (regenerate .sld only, no upload)\n"
            "       python styles.py --print-intervals"
        )
```

Also update the module docstring's usage lines. `upload()` already raises on a non-2xx (`r.raise_for_status()`). Run `python3 packages/atlas-data/tools/contours/test_styles_upload.py`; it must still print its success line.

- [ ] **Step 7: Loader and DEM scripts**

In `tools/basemap/load_basemap.py`, replace `ZIP = os.environ.get("BASEMAP_ZIP", "vietnam-free.shp.zip")` with:

```python
# The registry passes the downloaded extract as argv[1] (a path, never a secret); BASEMAP_ZIP stays
# for running the script by hand.
ZIP = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BASEMAP_ZIP", "vietnam-free.shp.zip")
```

In `tools/prep_dem.py`:
- Set `DEFAULT_OUT = ROOT / "packages/atlas-data/data/cache/dem"`.
- Make the final print `Next: bash packages/atlas-data/tools/load-dem.sh packages/atlas-data/data/cache/dem/clipped (inside the atlas-tools container)`.

Replace the whole of `tools/load-dem.sh` with:

```bash
#!/usr/bin/env bash
# Load clipped FABDEM tiles into basemap.dem_region.
#
# Runs INSIDE the atlas-tools container, which carries raster2pgsql and psql and reaches the
# database through PGHOST/PGUSER/PGPASSWORD/PGDATABASE (set by the compose `tools` service). The
# old host version built a one-off image and ran docker from the host; the tools image replaces it.
set -euo pipefail

DEM_DIR="${1:?usage: load-dem.sh <directory of clipped .tif tiles>}"
TABLE="basemap.dem_region"
: "${PGHOST:?PGHOST is not set — run this inside the atlas-tools container (npm run atlas:build -- --only dem)}"

q() { psql -v ON_ERROR_STOP=1 "$@"; }

shopt -s nullglob
TIFS=("$DEM_DIR"/*.tif)
if [ ${#TIFS[@]} -eq 0 ]; then
  echo "No .tif files in $DEM_DIR — run prep_dem.py first." >&2
  exit 1
fi
echo "Loading ${#TIFS[@]} tiles from $DEM_DIR into $TABLE"

q -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='basemap' AND table_name='dem_region'" | grep -q 1 || {
  echo "$TABLE does not exist — run: npm run migrate:up -w @webatlas/api" >&2
  exit 1
}

q -c "SELECT DropRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null 2>&1 || true
q -c "TRUNCATE $TABLE;"
for tif in "${TIFS[@]}"; do
  echo "  $(basename "$tif")"
  raster2pgsql -a -s 4326 -t 128x128 -F "$tif" "$TABLE" | q -q
done

echo "Deriving raster constraints..."
q -c "SELECT AddRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null

echo "Verifying..."
q -c "SELECT count(*) AS tiles, pg_size_pretty(pg_total_relation_size('$TABLE')) AS size FROM $TABLE;"
q -c "
WITH pts(label, g) AS (VALUES
  ('Buon Ma Thuot  ~472 m', ST_SetSRID(ST_MakePoint(108.0447,12.6797),4326)),
  ('Chu Yang Sin  ~2415 m', ST_SetSRID(ST_MakePoint(108.4244,12.4061),4326)),
  ('Da Nang shore    ~7 m', ST_SetSRID(ST_MakePoint(108.2440,16.0600),4326)))
SELECT p.label, round(ST_Value(d.rast, p.g)::numeric,1) AS elevation_m
  FROM pts p LEFT JOIN $TABLE d ON ST_Intersects(d.rast, p.g);"
echo "Done."
```

Delete the superseded image definition:

```bash
git rm packages/atlas-data/tools/raster-tools.Dockerfile
```

- [ ] **Step 8: Run the tests**

Run:

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data
python3 packages/atlas-data/tools/contours/test_styles_upload.py
python3 packages/atlas-data/tools/contours/styles.py --write-only && git diff --exit-code packages/atlas-data/tools/contours/*.sld
python3 packages/atlas-data/tools/basemap/styles.py --write-only && git diff --exit-code packages/atlas-data/tools/basemap/*.sld
```

Expected:
- All tests pass.
- The Python check prints success.
- Regenerating either set of SLDs changes nothing, which proves the generators and the committed artifacts still agree. If the host `python3` cannot import what `basemap/styles.py` needs (it uses only the standard library), report it; do not install anything.

- [ ] **Step 9: Mutation checks**

1. In `lib/geoserver.sh`, make `gs_exists` return 1 for any non-200 (drop the `*)` exit branch). "fails on an existence check that is neither 200 nor 404" must fail. Restore it.
2. Remove `require_2xx` from the basemap datastore creation. "fails and never truncates when the datastore cannot be created" must fail. Restore it.

- [ ] **Step 10: Commit**

```bash
git add -A packages/atlas-data/tools
git commit -m "fix(tools): script chạy không người trông — mật khẩu từ biến môi trường, lỗi khi không 2xx, load-dem chạy trong container

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `atlas-tools` image, and how tools stages start it

**Files:**
- Create: `packages/atlas-data/tools/Dockerfile`, `tools/requirements.txt`, `tools/.dockerignore`, `packages/atlas-data/src/compose.ts`, `src/compose.test.ts`, `src/stages/tools.docker.test.ts`
- Modify: `infra/docker-compose.yml`, `packages/atlas-data/src/stages/run.ts`, `src/stages/run.test.ts`

**Interfaces:**
- Consumes: Plan A's `runProcess(file, args, { label, log, cwd, env })` and `commandFor` / `executeRun`.
- Produces:
  - `COMPOSE_INTERPOLATED_KEYS: readonly string[]`
  - `composeEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`
  - `composeFile(env?, repoRoot?): string`, which honours `ATLAS_COMPOSE_FILE`
  - `composeArgs(env?, repoRoot?): string[]`, which returns `['compose', '-f', <file>]`
  - A tools stage runs `docker compose -f <file> --profile tools run --rm -T --no-deps tools <argv>` with `env: composeEnv()`.

- [ ] **Step 1: Write the failing tests**

Create `src/compose.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { composeArgs, composeEnv, composeFile, COMPOSE_INTERPOLATED_KEYS } from './compose';

describe('composeEnv', () => {
  it('removes every key compose interpolates from infra/.env, and keeps the rest', () => {
    const env = { POSTGRES_PASSWORD: 'x', GEOSERVER_ADMIN_PASSWORD: 'y', PATH: '/bin', COMPOSE_PROJECT_NAME: 'p' };
    const out = composeEnv(env);
    for (const k of COMPOSE_INTERPOLATED_KEYS) expect(out[k]).toBeUndefined();
    expect(out.PATH).toBe('/bin');
    // The acceptance run selects its throwaway project through this; it must pass through.
    expect(out.COMPOSE_PROJECT_NAME).toBe('p');
  });

  it('does not mutate its input', () => {
    const env = { POSTGRES_PASSWORD: 'x' };
    composeEnv(env);
    expect(env.POSTGRES_PASSWORD).toBe('x');
  });
});

describe('composeFile / composeArgs', () => {
  it('defaults to infra/docker-compose.yml under the repo root', () => {
    expect(composeFile({}, '/repo')).toBe(join('/repo', 'infra', 'docker-compose.yml'));
    expect(composeArgs({}, '/repo')).toEqual(['compose', '-f', join('/repo', 'infra', 'docker-compose.yml')]);
  });

  it('honours ATLAS_COMPOSE_FILE (atlas:up --compose)', () => {
    expect(composeFile({ ATLAS_COMPOSE_FILE: '/x/prod.yml' }, '/repo')).toBe('/x/prod.yml');
  });
});
```

In `src/stages/run.test.ts`, replace the `tools:` `commandFor` test's expected args with:

```ts
    expect(c.args).toEqual([
      'compose', '-f', join('/repo', 'infra', 'docker-compose.yml'), '--profile', 'tools',
      'run', '--rm', '-T', '--no-deps', 'tools', 'python', 'prep_dem.py', '--mainland',
    ]);
```

Then add inside `describe('executeRun', …)`:

```ts
  it("a tools stage's process does not see the interpolated compose keys", async () => {
    const saved = process.env.POSTGRES_PASSWORD;
    process.env.POSTGRES_PASSWORD = 'from-apps-api-env';
    try {
      const lines: string[] = [];
      await executeRun(
        pool,
        stage({ in: 'tools', argv: ['x'] }),
        ctx(lines),
        () => ({ file: process.execPath, args: ['-e', 'console.log(process.env.POSTGRES_PASSWORD ?? "unset")'], cwd: process.cwd() })
      );
      expect(lines).toContain('[rivers] unset');
    } finally {
      if (saved === undefined) delete process.env.POSTGRES_PASSWORD; else process.env.POSTGRES_PASSWORD = saved;
    }
  });
```

Create `src/stages/tools.docker.test.ts`. It is opt-in, because it builds an image of about 1 GB:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { executeRun } from './run';
import { runProcess } from '../process';
import { composeArgs, composeEnv } from '../compose';

/**
 * Opt-in (ATLAS_TOOLS_TESTS=1): builds the atlas-tools image and runs real commands in it. Needs
 * Docker and the dev stack up (the psql check reaches `db`).
 */
const ON = process.env.ATLAS_TOOLS_TESTS === '1';
const lines: string[] = [];
const ctx = { datasetId: 'tools', forced: false, log: (l: string) => lines.push(l) };
const tools = (argv: string[]) =>
  ({ type: 'run' as const, in: 'tools' as const, argv, produces: 'p', promoteTo: 'x', promoteBy: '2099-01-01' });

describe.skipIf(!ON)('the atlas-tools image', () => {
  beforeAll(async () => {
    const r = await runProcess('docker', [...composeArgs(), '--profile', 'tools', 'build', 'tools'], {
      label: 'build', log: () => {}, env: composeEnv(),
    });
    expect(r.code).toBe(0);
  }, 1_800_000);

  it('has the Python geo stack', async () => {
    await expect(
      executeRun({} as Pool, tools(['python3', '-c', 'import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests; print("py ok")']), ctx)
    ).resolves.toBeDefined();
    expect(lines).toContain('[tools] py ok');
  }, 300_000);

  it('has raster2pgsql, psql, bash and curl', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'command -v raster2pgsql psql curl >/dev/null && echo bins ok']), ctx);
    expect(lines).toContain('[tools] bins ok');
  }, 300_000);

  it('sees the repository at /repo', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'test -f packages/shared/src/contours.ts && echo repo ok']), ctx);
    expect(lines).toContain('[tools] repo ok');
  }, 300_000);

  it('reaches the database with the credentials from infra/.env', async () => {
    await executeRun({} as Pool, tools(['psql', '-tAc', 'SELECT 41 + 1']), ctx);
    expect(lines).toContain('[tools] 42');
  }, 300_000);

  it('runs scripts with LF line endings', async () => {
    await executeRun({} as Pool, tools(['bash', '-n', 'packages/atlas-data/tools/load-dem.sh']), ctx);
  }, 300_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/compose.test.ts src/stages/run.test.ts`

Expected: FAIL. `./compose` does not exist, the args lack `-T --no-deps`, and the env leaks.

- [ ] **Step 3: `compose.ts`**

Create `src/compose.ts`:

```ts
import { join } from 'node:path';
import { REPO_ROOT } from './paths';

/**
 * Keys docker compose interpolates into infra/docker-compose.yml from infra/.env. Removed from the
 * environment of every docker compose child: loadDevEnv copies apps/api/.env into process.env, and a
 * variable present in the environment OVERRIDES infra/.env during interpolation — silently changing
 * credentials, and able to make `compose run` recreate a running service (Plan A final review).
 */
export const COMPOSE_INTERPOLATED_KEYS = [
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
  'GEOSERVER_ADMIN_USER', 'GEOSERVER_ADMIN_PASSWORD', 'GEOSERVER_PORT', 'ASSISTANT_DB_PASSWORD',
] as const;

export function composeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of COMPOSE_INTERPOLATED_KEYS) delete out[k];
  return out;
}

/** The compose file every docker call uses. `atlas:up --compose <file>` sets ATLAS_COMPOSE_FILE (spec §9). */
export function composeFile(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string {
  return env.ATLAS_COMPOSE_FILE ?? join(repoRoot, 'infra', 'docker-compose.yml');
}

export function composeArgs(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string[] {
  return ['compose', '-f', composeFile(env, repoRoot)];
}
```

- [ ] **Step 4: Tools stages use it**

In `src/stages/run.ts`, import `composeArgs, composeEnv` from `'../compose'`. Replace the tools branch of `commandFor` with:

```ts
  // -T: stdin is not a TTY (the runner ignores stdin). --no-deps: never start or recreate db/geoserver
  // from here — atlas:up owns the stack's lifecycle.
  return {
    file: 'docker',
    args: [...composeArgs(process.env, repoRoot), '--profile', 'tools', 'run', '--rm', '-T', '--no-deps', 'tools', ...stage.argv],
    cwd: repoRoot,
  };
```

In `executeRun`, pass the environment:

```ts
  const outcome = await runProcess(file, args, {
    label: ctx.datasetId,
    log: ctx.log,
    cwd,
    // Tools stages: let infra/.env govern compose interpolation (see compose.ts).
    env: stage.in === 'tools' ? composeEnv() : undefined,
  });
```

- [ ] **Step 5: The image**

Create `packages/atlas-data/tools/requirements.txt`:

```
# Pinned so every machine's atlas-tools image is the same. pyogrio is geopandas' read engine
# (load_basemap.py passes columns=, which only pyogrio supports).
geopandas==1.0.1
pyogrio==0.10.0
shapely==2.0.6
pyproj==3.7.0
pandas==2.2.3
SQLAlchemy==2.0.36
GeoAlchemy2==0.16.0
psycopg2-binary==2.9.10
rasterio==1.4.3
requests==2.32.3
```

Create `packages/atlas-data/tools/.dockerignore`:

```
# The build context is only the requirements file; scripts are bind-mounted at run time.
*
!requirements.txt
```

Create `packages/atlas-data/tools/Dockerfile`:

```dockerfile
# atlas-tools: everything the registry's `tools` stages need that a developer's machine must NOT be
# asked to install (spec D2) — the Python geo stack, raster2pgsql and psql, bash and curl.
#
# Based on the database image so raster2pgsql tracks the server's PostGIS (the reasoning in the old
# raster-tools.Dockerfile, which this replaces). Scripts are not copied in: the compose `tools`
# service bind-mounts the repository at /repo, so an edited script needs no rebuild.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgis python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/atlas-venv \
 && /opt/atlas-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PATH="/opt/atlas-venv/bin:${PATH}"

# Fail the build, not a stage hours later, if anything is missing.
RUN command -v raster2pgsql && command -v psql && command -v curl \
 && python3 -c "import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests"

# The base image's entrypoint starts a PostgreSQL server; this is a tools image, not a database.
ENTRYPOINT []
CMD ["bash"]
```

If a pinned version fails to install on the image's Python (Debian bookworm, Python 3.11), move it to the nearest version that installs. Record the change in the report.

- [ ] **Step 6: The compose service**

Append to `services:` in `infra/docker-compose.yml`, before `volumes:`:

```yaml
  # Tooling for the dataset registry's `tools` stages (spec §7). Never started by a plain
  # `docker compose up`: the profile keeps it out until the runner asks for it with
  # `docker compose --profile tools run --rm -T --no-deps tools <argv>`.
  tools:
    profiles: ["tools"]
    build:
      context: ../packages/atlas-data/tools
    image: webatlas-atlas-tools
    working_dir: /repo
    volumes:
      - ..:/repo
    environment:
      # In-network addresses (spec C-11): inside the network the database is `db:5432`, not localhost.
      PGHOST: db
      PGPORT: "5432"
      PGUSER: ${POSTGRES_USER}
      PGPASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: ${POSTGRES_DB}
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      BASEMAP_DB_URL: postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      GEOSERVER_URL: http://geoserver:8080/geoserver
      GEOSERVER_ADMIN_USER: ${GEOSERVER_ADMIN_USER}
      GEOSERVER_ADMIN_PASSWORD: ${GEOSERVER_ADMIN_PASSWORD}
      GEOSERVER_WORKSPACE: webatlas
      GEOSERVER_DB_HOST: db
      GEOSERVER_DB_PORT: "5432"
      GEOSERVER_DB_NAME: ${POSTGRES_DB}
      GEOSERVER_DB_USER: ${POSTGRES_USER}
      GEOSERVER_DB_PASSWORD: ${POSTGRES_PASSWORD}
```

Check that the file is still valid and the stack is untouched:

```bash
docker compose -f infra/docker-compose.yml config --quiet && echo compose ok
docker compose -f infra/docker-compose.yml ps --format "{{.Service}} {{.State}}"   # db and geoserver still running, no tools
```

- [ ] **Step 7: Run everything**

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data
npm run build -w @webatlas/atlas-data
ATLAS_TOOLS_TESTS=1 npm test -w @webatlas/atlas-data -- src/stages/tools.docker.test.ts
```

Expected:
- All tests pass.
- The tools suite **runs**, with 5 tests. The first build takes several minutes.
- Record the image build time and size (`docker image ls webatlas-atlas-tools`) in the report.

- [ ] **Step 8: Mutation check**

In `executeRun`, change `env: stage.in === 'tools' ? composeEnv() : undefined` to `env: undefined`. "a tools stage's process does not see the interpolated compose keys" must fail. Restore it.

- [ ] **Step 9: Commit**

```bash
git add infra/docker-compose.yml packages/atlas-data
git commit -m "feat(atlas-data): ảnh Docker atlas-tools và dịch vụ compose tools; stage tools chạy với -T --no-deps, không rò biến nội suy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Probes

**Files:**
- Create: `packages/atlas-data/src/probes.ts`, `src/probes.test.ts`, `src/probes.db.test.ts`
- Modify: `src/types.ts`, `src/schema.ts`

**Interfaces:**
- Produces:
  - In `types.ts`:
    - `interface ProbeContext { pool: Pool; geoserver: (path: string) => Promise<Response> }`
    - `interface ProbeResult { ok: boolean; detail: string }`
    - `type Probe = (ctx: ProbeContext) => Promise<ProbeResult>`
    - `Dataset.probe?: Probe`
  - In `probes.ts`:
    - `pass(detail)`, `fail(detail)`, `allOf(...checks: Probe[]): Probe`
    - `rowCount(label: string, sql: string, min?: number): Probe`
    - `viewCount(layer: string): Probe`
    - `wfsAnswers(layer: string): Probe`
    - `wmsAnswers(layer: string, bbox: string): Probe`
    - `elevationBetween(label: string, lon: number, lat: number, min: number, max: number): Probe`
    - `probeContext(pool: Pool, env?: NodeJS.ProcessEnv, f?: typeof fetch): ProbeContext`

- [ ] **Step 1: Write the failing tests**

Create `src/probes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { allOf, elevationBetween, fail, pass, rowCount, wfsAnswers, wmsAnswers } from './probes';
import type { ProbeContext } from './types';

const ctx = (over: Partial<ProbeContext> = {}): ProbeContext => ({
  pool: { query: vi.fn(async () => ({ rows: [{ n: '5' }] })) } as unknown as Pool,
  geoserver: vi.fn(async () => new Response('{}', { status: 200 })),
  ...over,
});

describe('rowCount', () => {
  it('passes at or above the minimum, naming the count', async () => {
    expect(await rowCount('roads', 'SELECT', 5)(ctx())).toEqual({ ok: true, detail: 'roads: 5' });
  });

  it('fails below it', async () => {
    const r = await rowCount('roads', 'SELECT', 6)(ctx());
    expect(r).toEqual({ ok: false, detail: 'roads: 5 (expected ≥ 6)' });
  });

  it('turns a query error into a failure naming the check', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('relation "x" does not exist'); }) } as unknown as Pool;
    const r = await rowCount('x', 'SELECT')(ctx({ pool }));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/^x: relation "x" does not exist$/);
  });
});

describe('allOf', () => {
  it('returns the first failure and runs nothing after it', async () => {
    const third = vi.fn(async () => pass('c'));
    const r = await allOf(async () => pass('a'), async () => fail('b broke'), third)(ctx());
    expect(r).toEqual({ ok: false, detail: 'b broke' });
    expect(third).not.toHaveBeenCalled();
  });

  it('joins the details when everything passes', async () => {
    expect(await allOf(async () => pass('a'), async () => pass('b'))(ctx())).toEqual({ ok: true, detail: 'a; b' });
  });

  it('turns a thrown check into a failure', async () => {
    const r = await allOf(async () => { throw new Error('GEOSERVER_URL is not set'); })(ctx());
    expect(r).toEqual({ ok: false, detail: 'GEOSERVER_URL is not set' });
  });
});

describe('wmsAnswers', () => {
  it('passes only on a PNG — a missing layer answers 200 with an XML exception', async () => {
    const png = ctx({ geoserver: async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }) });
    const xml = ctx({ geoserver: async () => new Response('<x/>', { status: 200, headers: { 'content-type': 'application/vnd.ogc.se_xml;charset=UTF-8' } }) });
    expect((await wmsAnswers('basemap', '1,2,3,4')(png)).ok).toBe(true);
    const r = await wmsAnswers('basemap', '1,2,3,4')(xml);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/webatlas:basemap WMS 200 application\/vnd\.ogc\.se_xml/);
  });

  it('asks for the layer in the webatlas workspace over the given bbox', async () => {
    const geoserver = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }));
    await wmsAnswers('contours_50', '108,12,108.2,12.2')(ctx({ geoserver }));
    expect(geoserver.mock.calls[0][0]).toMatch(/^\/wms\?.*layers=webatlas:contours_50.*bbox=108,12,108\.2,12\.2.*format=image\/png/);
  });
});

describe('wfsAnswers', () => {
  it('needs at least one feature', async () => {
    const one = ctx({ geoserver: async () => new Response(JSON.stringify({ features: [{}] }), { status: 200 }) });
    const none = ctx({ geoserver: async () => new Response(JSON.stringify({ features: [] }), { status: 200 }) });
    expect((await wfsAnswers('dams')(one)).ok).toBe(true);
    expect(await wfsAnswers('dams')(none)).toEqual({ ok: false, detail: 'webatlas:dams WFS returned no features' });
  });
});

describe('elevationBetween', () => {
  it('checks the sampled value against the range', async () => {
    const at = (v: string | null) => ctx({ pool: { query: vi.fn(async () => ({ rows: [{ v }] })) } as unknown as Pool });
    expect((await elevationBetween('BMT', 108, 12, 440, 500)(at('472.0'))).ok).toBe(true);
    expect((await elevationBetween('BMT', 108, 12, 440, 500)(at('12.0'))).ok).toBe(false);
    expect(await elevationBetween('BMT', 108, 12, 440, 500)(at(null))).toEqual({ ok: false, detail: 'BMT: no elevation (DEM not loaded there)' });
  });
});
```

Create `src/probes.db.test.ts`, which is read-only against the dev database:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Pool } from 'pg';
import { probeContext, rowCount, viewCount, wfsAnswers } from './probes';

const DB = process.env.DATABASE_URL;
const GS = process.env.GEOSERVER_URL;

describe.skipIf(!DB || !GS)('probes against the dev stack (read-only)', () => {
  let pool: Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DB }); });
  afterAll(async () => { await pool.end(); });

  it('counts the 34 provinces', async () => {
    const r = await rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34)(probeContext(pool));
    expect(r).toEqual({ ok: true, detail: 'admin.provinces: 34' });
  });

  it('counts an active view and reads its WFS layer', async () => {
    const ctx = probeContext(pool);
    expect((await viewCount('dams')(ctx)).ok).toBe(true);
    expect((await wfsAnswers('dams')(ctx)).ok).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/probes.test.ts`

Expected: FAIL, because `./probes` does not exist.

- [ ] **Step 3: Types and schema**

In `src/types.ts`, add at the top `import type { Pool } from 'pg';`, and add:

```ts
/** What a probe may look at: the database, and GeoServer (a GET of a path under GEOSERVER_URL). */
export interface ProbeContext {
  pool: Pool;
  geoserver: (path: string) => Promise<Response>;
}

/** Whether a dataset's output exists and serves, with a one-line account either way. */
export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/**
 * A cheap, read-only check of what a dataset produces (spec FR-13). One definition of "built" serves
 * both atlas:adopt (record an already-built machine) and atlas:verify (does it actually serve).
 */
export type Probe = (ctx: ProbeContext) => Promise<ProbeResult>;
```

Add `probe?: Probe;` to `Dataset`. In `src/schema.ts`, add `probe: z.function().optional(),` to `datasetSchema`.

- [ ] **Step 4: `probes.ts`**

Create `src/probes.ts`:

```ts
import type { Pool } from 'pg';
import type { Probe, ProbeContext, ProbeResult } from './types';
import { geoserverEnv } from './geoserver';

export const pass = (detail: string): ProbeResult => ({ ok: true, detail });
export const fail = (detail: string): ProbeResult => ({ ok: false, detail });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Checks in order; the first failure wins and nothing after it runs. A thrown check is a failure. */
export function allOf(...checks: Probe[]): Probe {
  return async (ctx) => {
    const details: string[] = [];
    for (const check of checks) {
      let r: ProbeResult;
      try {
        r = await check(ctx);
      } catch (err) {
        return fail(message(err));
      }
      if (!r.ok) return r;
      details.push(r.detail);
    }
    return pass(details.join('; '));
  };
}

/**
 * `sql` must return one row with a text column `n`. The SQL comes from descriptor code, never from
 * input, so it is not parameterised.
 */
export function rowCount(label: string, sql: string, min = 1): Probe {
  return async ({ pool }) => {
    try {
      const { rows } = await pool.query<{ n: string }>(sql);
      const n = Number(rows[0]?.n ?? 0);
      return n >= min ? pass(`${label}: ${n}`) : fail(`${label}: ${n} (expected ≥ ${min})`);
    } catch (err) {
      return fail(`${label}: ${message(err)}`);
    }
  };
}

/** Rows visible through a versioned layer's `<layer>_active` view. */
export const viewCount = (layer: string): Probe =>
  rowCount(`water.${layer}_active`, `SELECT count(*)::text AS n FROM water.${layer}_active`);

export function wfsAnswers(layer: string): Probe {
  return async ({ geoserver }) => {
    const res = await geoserver(
      `/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:${layer}&outputFormat=application/json&count=1`
    );
    if (res.status !== 200) {
      await res.body?.cancel();
      return fail(`webatlas:${layer} WFS ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { features?: unknown[] } | null;
    return (body?.features?.length ?? 0) > 0
      ? pass(`webatlas:${layer} serves WFS`)
      : fail(`webatlas:${layer} WFS returned no features`);
  };
}

/** A missing WMS layer answers 200 with an XML ServiceException (measured), so the check is the PNG type. */
export function wmsAnswers(layer: string, bbox: string): Probe {
  return async ({ geoserver }) => {
    const res = await geoserver(
      `/wms?service=WMS&version=1.1.1&request=GetMap&layers=webatlas:${layer}&styles=&bbox=${bbox}` +
        `&width=64&height=64&srs=EPSG:4326&format=image/png`
    );
    const type = res.headers.get('content-type') ?? '';
    await res.body?.cancel();
    return res.status === 200 && type.startsWith('image/png')
      ? pass(`webatlas:${layer} renders`)
      : fail(`webatlas:${layer} WMS ${res.status} ${type}`);
  };
}

export function elevationBetween(label: string, lon: number, lat: number, min: number, max: number): Probe {
  return async ({ pool }) => {
    try {
      const { rows } = await pool.query<{ v: string | null }>(
        `SELECT ST_Value(rast, ST_SetSRID(ST_MakePoint($1, $2), 4326))::text AS v
           FROM basemap.dem_region
          WHERE ST_Intersects(rast, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          LIMIT 1`,
        [lon, lat]
      );
      const raw = rows[0]?.v ?? null;
      if (raw === null) return fail(`${label}: no elevation (DEM not loaded there)`);
      const v = Number(raw);
      return v >= min && v <= max
        ? pass(`${label}: ${Math.round(v)} m`)
        : fail(`${label}: ${Math.round(v)} m (expected ${min}–${max})`);
    } catch (err) {
      return fail(`${label}: ${message(err)}`);
    }
  };
}

/** The live context: the pool, and authenticated GETs against GEOSERVER_URL with a 60 s timeout. */
export function probeContext(pool: Pool, env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): ProbeContext {
  return {
    pool,
    geoserver: (path) => {
      const gs = geoserverEnv(env);
      return f(`${gs.url}${path}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64') },
        signal: AbortSignal.timeout(60_000),
      });
    },
  };
}
```

When no row intersects, `elevationBetween`'s query returns no row, so `rows[0]` is undefined. That is the "no elevation" case the unit test pins with `v: null`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`

Expected: all tests pass. `probes.db.test.ts` runs (2 tests), not skipped.

- [ ] **Step 6: Mutation check**

In `wmsAnswers`, drop the `&& type.startsWith('image/png')`. "passes only on a PNG" must fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): probe — kiểm tra rẻ, chỉ đọc, cho biết tập dữ liệu đã dựng và phục vụ được

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Every runbook step is a dataset

**Files:**
- Create: `packages/atlas-data/src/descriptors/{seeds,basemap,referenceEntities,dem,contours}.ts`, `src/descriptors/descriptors.test.ts`
- Modify: `src/descriptors/rivers.ts`, `src/descriptors/index.ts`, `src/registry.test.ts`

**Interfaces:**
- Consumes: the probe helpers (Task 5); the script contracts (Task 3).
- Produces: the datasets `seeds`, `rivers` (updated), `basemap`, `reference_entities`, `dem` and `contours`, registered in `DESCRIPTORS` in that order after `demo`. `SEED_LAYERS` is exported from `seeds.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/descriptors/descriptors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { resolveLicences } from '../lineage';
import { REPO_ROOT } from '../paths';
import { CONTOUR_INTERVALS_M } from './contours';

const byId = (id: string) => ALL_DATASETS.find((d) => d.id === id)!;
const runStages = ALL_DATASETS.flatMap((d) =>
  d.stages.filter((s) => s.type === 'run').map((s) => ({ id: d.id, stage: s as Extract<typeof s, { type: 'run' }> }))
);
const WORKSPACE_DIRS: Record<string, string> = { '@webatlas/api': 'apps/api' };

describe('registered datasets', () => {
  it('validate', () => {
    expect(() => validateRegistry()).not.toThrow();
  });

  it('cover every runbook step (spec FR-2)', () => {
    expect(ALL_DATASETS.map((d) => d.id)).toEqual([
      'demo', 'seeds', 'rivers', 'basemap', 'reference_entities', 'dem', 'contours',
    ]);
  });

  it('declare the ordering rules as dependsOn, not prose (spec FR-8)', () => {
    expect(byId('rivers').dependsOn).toEqual(['seeds']);
    expect(byId('reference_entities').dependsOn).toEqual(['basemap']);
    expect(byId('contours').dependsOn).toEqual(['dem']);
  });

  it('every real dataset declares a probe (adoption and verify need one)', () => {
    for (const d of ALL_DATASETS) if (d.id !== 'demo') expect(d.probe, d.id).toBeTypeOf('function');
  });

  it('every tools script a stage names exists in the repository', () => {
    for (const { id, stage } of runStages.filter((r) => r.stage.in === 'tools')) {
      const [interpreter, script] = stage.argv;
      expect(['python3', 'bash'], `${id}: ${stage.argv.join(' ')}`).toContain(interpreter);
      expect(existsSync(join(REPO_ROOT, script)), `${id}: ${script}`).toBe(true);
    }
  });

  it('every host stage names a real npm script in a real workspace', () => {
    for (const { id, stage } of runStages.filter((r) => r.stage.in === 'host')) {
      const [verb, script, flag, workspace] = stage.argv;
      expect([verb, flag], id).toEqual(['run', '-w']);
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, WORKSPACE_DIRS[workspace], 'package.json'), 'utf8'));
      expect(pkg.scripts[script], `${id}: npm run ${script} -w ${workspace}`).toBeTypeOf('string');
    }
  });

  it('no argv carries a secret (it is written to lineage)', () => {
    for (const { id, stage } of runStages) {
      expect(stage.argv.join(' '), id).not.toMatch(/password|passwd|secret|change_me/i);
    }
  });

  it("contours' intervals match packages/shared/src/contours.ts", () => {
    const src = readFileSync(join(REPO_ROOT, 'packages/shared/src/contours.ts'), 'utf8');
    const m = src.match(/CONTOUR_INTERVALS\s*=\s*\[([^\]]*)\]/);
    expect(m, 'CONTOUR_INTERVALS literal').not.toBeNull();
    expect(m![1].split(',').map((s) => Number(s.trim()))).toEqual([...CONTOUR_INTERVALS_M]);
  });

  it('licences propagate: contours are non-commercial through the DEM, reference entities are ODbL', () => {
    expect(resolveLicences(ALL_DATASETS, 'contours')).toContain('CC-BY-NC-SA-4.0');
    expect(resolveLicences(ALL_DATASETS, 'contours')).not.toContain('ODbL-1.0');
    expect(resolveLicences(ALL_DATASETS, 'reference_entities')).toContain('ODbL-1.0');
  });
});
```

In `src/registry.test.ts`, update the rivers-stage assertion to the new stage list: `['run', 'publish-geoserver', 'publish-geoserver']`, with the second publish being `{ layer: 'rivers_overview', nativeName: 'rivers_overview' }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @webatlas/atlas-data -- src/descriptors/descriptors.test.ts`

Expected: FAIL, because the descriptor modules do not exist.

- [ ] **Step 3: The descriptors**

Create `src/descriptors/seeds.ts`:

```ts
import { defineDataset } from '../schema';
import { allOf, rowCount, viewCount, wfsAnswers } from '../probes';

/** The versioned thematic layers `npm run seed` loads. Keep in sync with apps/api/src/db/seeds/registry.ts. */
export const SEED_LAYERS = [
  'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes',
] as const;

/**
 * Runbook step 3 as one `run` stage until Plan C splits it into admin_boundaries plus one load-geojson
 * dataset per layer (spec §10). `npm run seed` also loads admin.provinces/admin.wards, which every
 * water layer's activation stamps against — hence rivers dependsOn seeds.
 *
 * Idempotency is the command's, not the runner's: `seed` appends a new version per layer each time it
 * runs, so this stage runs only when forced, when its descriptor changes, or on a fresh machine.
 */
export const seeds = defineDataset({
  id: 'seeds',
  kind: 'vector',
  editable: true,
  lineage: {
    statement:
      'Các lớp chuyên đề nạp từ GeoJSON đã commit: đập thuỷ điện, hồ, và năm lớp minh hoạ tổng hợp; ' +
      'kèm ranh giới tỉnh/xã dùng để gán mã hành chính.',
    licence: 'CC-BY-SA-4.0 AND ODbL-1.0',
    sources: [
      {
        citation: 'Open Development Vietnam, Hydropower plants in Vietnam by October 2020',
        licence: 'CC-BY-SA-4.0',
        uri: 'https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020',
      },
      { citation: 'OpenStreetMap contributors (lakes)', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' },
      {
        citation: 'Synthetic demonstration data from the original prototype (stations, flood zones, drought points, saltwater intrusion, flood generation) — not measurements',
        licence: 'LicenseRef-webatlas-synthetic',
      },
      {
        citation: 'thanglequoc/vietnamese-provinces-database — boundaries after the 2025-07-01 reorganisation',
        licence: 'MIT',
        uri: 'https://github.com/thanglequoc/vietnamese-provinces-database',
      },
    ],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'seed', '-w', '@webatlas/api'],
      produces: 'admin.provinces, admin.wards, and one new active version of each seed layer',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
    },
    ...SEED_LAYERS.map((layer) => ({ type: 'publish-geoserver' as const, layer })),
  ],
  probe: allOf(
    rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34),
    rowCount('admin.wards', 'SELECT count(*)::text AS n FROM admin.wards'),
    ...SEED_LAYERS.map((layer) => allOf(viewCount(layer), wfsAnswers(layer)))
  ),
});
```

Create `src/descriptors/basemap.ts`:

```ts
import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

const ZIP = 'basemap/vietnam-latest-free.shp.zip';

/**
 * Runbook step 5: the self-hosted street basemap from the Geofabrik Vietnam extract (684 MB). The URL
 * is `latest`, so it is deliberately unpinned (spec C-10): the fetched hash is recorded in lineage,
 * and `--force basemap` refreshes it.
 */
export const basemap = defineDataset({
  id: 'basemap',
  kind: 'vector',
  lineage: {
    statement:
      'Bản đồ nền đường phố tự phục vụ, dựng từ bản trích OSM Việt Nam của Geofabrik: đường, đường sắt, ' +
      'mặt nước, sử dụng đất và địa danh (toàn quốc sơ lược, sáu tỉnh chi tiết).',
    licence: 'ODbL-1.0',
    sources: [
      {
        citation: 'OpenStreetMap contributors, via the Geofabrik Vietnam extract',
        licence: 'ODbL-1.0',
        uri: 'https://download.geofabrik.de/asia/vietnam.html',
      },
    ],
  },
  stages: [
    { type: 'fetch-http', url: 'https://download.geofabrik.de/asia/vietnam-latest-free.shp.zip', into: ZIP },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/basemap/load_basemap.py', `packages/atlas-data/data/cache/${ZIP}`],
      produces: 'basemap.{land_vn,roads_vn,railways_vn,places_vn,roads_region,places_region,landuse_region,water_region}',
      promoteTo: 'load-ogr',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/basemap/styles.py'],
      produces: 'GeoServer styles basemap_* assigned to the basemap layers',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/basemap/publish-basemap.sh'],
      produces: 'GeoServer datastore basemap_pg, feature types, layer group webatlas:basemap',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
  ],
  probe: allOf(
    rowCount('basemap.roads_region', 'SELECT count(*)::text AS n FROM basemap.roads_region'),
    wmsAnswers('basemap', '108.0,12.5,108.2,12.7')
  ),
});
```

Create `src/descriptors/referenceEntities.ts`:

```ts
import { defineDataset } from '../schema';
import { allOf, rowCount } from '../probes';

const LAYERS = ['roads', 'railways', 'water', 'landuse', 'places'] as const;

/**
 * Runbook step 6: basemap.reference_entities, rebuilt from the raw basemap tables. load_basemap.py
 * drops and recreates those tables, so this is stale the moment the basemap reloads — which
 * dependsOn now enforces (spec FR-8) instead of a runbook paragraph.
 */
export const referenceEntities = defineDataset({
  id: 'reference_entities',
  kind: 'derived',
  dependsOn: ['basemap'],
  lineage: {
    statement: 'Thực thể có tên (đường, đường sắt, mặt nước, sử dụng đất, địa danh) gộp từ các bảng nền thô.',
    licence: 'ODbL-1.0',
    sources: [],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'reference:build', '-w', '@webatlas/api'],
      produces: 'basemap.reference_entities',
      promoteTo: 'sql',
      promoteBy: '2027-06-30',
    },
  ],
  probe: allOf(
    ...LAYERS.map((k) =>
      rowCount(`reference ${k}`, `SELECT count(*)::text AS n FROM basemap.reference_entities WHERE layer_key = '${k}'`)
    )
  ),
});
```

Create `src/descriptors/dem.ts`:

```ts
import { defineDataset } from '../schema';
import { elevationBetween } from '../probes';

/**
 * Runbook step 7: FABDEM, clipped to the working region's mainland and loaded as PostGIS raster.
 * Non-commercial licence — it propagates to every derived dataset (contours).
 */
export const dem = defineDataset({
  id: 'dem',
  kind: 'raster',
  lineage: {
    statement:
      'Mô hình độ cao bề mặt đất trần FABDEM, cắt theo phần đất liền của sáu tỉnh, nạp vào basemap.dem_region.',
    licence: 'CC-BY-NC-SA-4.0',
    sources: [
      {
        citation:
          'FABDEM V1-2, University of Bristol (Hawker et al. 2022), fetched per tile from the Fondazione LINKS mirror; ' +
          'produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018',
        licence: 'CC-BY-NC-SA-4.0',
        uri: 'https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn',
        resolution: '1 arc-second (~30 m)',
      },
    ],
  },
  stages: [
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/prep_dem.py', '--mainland', '--out', 'packages/atlas-data/data/cache/dem'],
      produces: 'packages/atlas-data/data/cache/dem/clipped/*.tif',
      promoteTo: 'fetch-cog',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/load-dem.sh', 'packages/atlas-data/data/cache/dem/clipped'],
      produces: 'basemap.dem_region',
      promoteTo: 'load-raster',
      promoteBy: '2027-06-30',
    },
  ],
  // Buôn Ma Thuột, measured ~472 m on the FABDEM load.
  probe: elevationBetween('Buôn Ma Thuột', 108.0447, 12.6797, 440, 500),
});
```

Create `src/descriptors/contours.ts`:

```ts
import { defineDataset } from '../schema';
import { allOf, rowCount, wmsAnswers } from '../probes';

/**
 * Must equal CONTOUR_INTERVALS in packages/shared/src/contours.ts. atlas-data does not depend on
 * @webatlas/shared (no new runtime dependencies), so descriptors.test.ts pins the two together.
 */
export const CONTOUR_INTERVALS_M = [250, 100, 50] as const;

/**
 * Runbook step 8: contour lines from the DEM, then their styles and GeoServer layers. The publish
 * script ensures the basemap_pg store itself, so this depends on the DEM only — a dependsOn on the
 * basemap would wrongly make contours inherit OpenStreetMap's ODbL.
 */
export const contours = defineDataset({
  id: 'contours',
  kind: 'derived',
  dependsOn: ['dem'],
  lineage: {
    statement: 'Đường đồng mức 250/100/50 m sinh từ DEM bằng ST_Contour, phục vụ dưới dạng lớp WMS có nhãn.',
    licence: 'CC-BY-NC-SA-4.0',
    sources: [],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'contours:generate', '-w', '@webatlas/api'],
      produces: 'basemap.contours',
      promoteTo: 'sql',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['python3', 'packages/atlas-data/tools/contours/styles.py'],
      produces: 'GeoServer styles contours_plain, contours_labelled',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
    {
      type: 'run',
      in: 'tools',
      argv: ['bash', 'packages/atlas-data/tools/contours/publish-contours.sh'],
      produces: 'GeoServer layers webatlas:contours_{250,100,50}',
      promoteTo: 'publish-geoserver',
      promoteBy: '2027-06-30',
    },
  ],
  probe: allOf(
    ...CONTOUR_INTERVALS_M.map((m) =>
      rowCount(`contours ${m} m`, `SELECT count(*)::text AS n FROM basemap.contours WHERE interval_m = ${m}`)
    ),
    wmsAnswers('contours_50', '108.0,12.5,108.2,12.7')
  ),
});
```

In `src/descriptors/rivers.ts`:
- Add `dependsOn: ['seeds'],` after `editable: true,`.
- Append a third stage, and add the probe:

```ts
    // The far-zoom overview: a plain view over level-1 rivers (entity phase 3). No `_active` suffix.
    { type: 'publish-geoserver', layer: 'rivers_overview', nativeName: 'rivers_overview' },
  ],
  probe: allOf(
    rowCount('level-1 rivers', 'SELECT count(*)::text AS n FROM water.rivers_active WHERE feature_level = 1'),
    wfsAnswers('rivers')
  ),
```

Import `allOf, rowCount, wfsAnswers` from `'../probes'`. Also update the file's comment: the ingest stamps against boundaries that `seeds` loads, which is why it depends on `seeds`.

Replace the whole of `src/descriptors/index.ts` with:

```ts
import { demo } from './demo';
import { seeds } from './seeds';
import { rivers } from './rivers';
import { basemap } from './basemap';
import { referenceEntities } from './referenceEntities';
import { dem } from './dem';
import { contours } from './contours';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo, seeds, rivers, basemap, referenceEntities, dem, contours];
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`

Expected: all tests pass.

Then run `npm run atlas:status`. **Do not run `atlas:build`.** Task 10 adopts first. Expected output:
- `demo` ok;
- `rivers` stale: its hash changed, because it now depends on `seeds` and has a third stage;
- `seeds`, `basemap`, `reference_entities`, `dem` and `contours` missing.

- [ ] **Step 5: Mutation check**

Change one tools argv path (e.g. `load-dem.sh` → `load_dem.sh`). "every tools script a stage names exists" must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): đăng ký seeds, basemap, reference_entities, dem, contours; rivers phụ thuộc seeds và có probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `atlas:adopt`

**Files:**
- Create: `packages/atlas-data/src/adopt.ts`, `src/adopt.test.ts`, `src/cli/adopt.ts`
- Modify: `src/lineage.ts`, `src/lineage.test.ts`, `packages/atlas-data/package.json`, root `package.json`

**Interfaces:**
- Consumes: `topologicalOrder`, `stageHashPlan`, `stageKey`, `readStageState`, `writeStageState`, `upsertLineage`, `appendProcessStep`, and `Dataset.probe`.
- Produces:
  - `adoptionStep(detail: string): { description: string; tool: string }`
  - `type AdoptResult = 'adopted' | 'has-state' | 'no-probe' | 'probe-failed'`
  - `interface AdoptOutcome { id: string; result: AdoptResult; detail: string }`
  - `adoptDatasets(pool: Pool, datasets: Dataset[], ctx: ProbeContext): Promise<AdoptOutcome[]>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lineage.test.ts`:

```ts
import { adoptionStep } from './lineage';

describe('adoptionStep', () => {
  it('says the dataset was adopted without executing, with the probe detail, capped at 200', () => {
    expect(adoptionStep('roads: 527000; webatlas:basemap renders')).toEqual({
      description: 'adopted without executing · roads: 527000; webatlas:basemap renders',
      tool: 'atlas:adopt',
    });
    expect(adoptionStep('x'.repeat(500)).description).toHaveLength(200);
  });
});
```

Create `src/adopt.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Dataset, ProbeContext } from './types';
import { stageHashPlan } from './state';

vi.mock('./stages/index', () => ({ executeStage: vi.fn(), hasExecutor: () => true }));
import { executeStage } from './stages/index';
import { adoptDatasets } from './adopt';

/** In-memory stage state and lineage, enough for adoption. */
function memoryPool(seed: Record<string, { input_hash: string; status: string }> = {}) {
  const state = new Map(Object.entries(seed));
  const steps: Array<{ id: string; description: string; tool: string }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM app.dataset_stage_state')) {
      const row = state.get(`${params[0]}|${params[1]}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params[0]}|${params[1]}`, { input_hash: params[2] as string, status: params[3] as string });
      return { rows: [] };
    }
    if (sql.includes('INTO app.dataset_lineage_step')) {
      steps.push({ id: params[0] as string, description: params[1] as string, tool: params[2] as string });
      return { rows: [] };
    }
    return { rows: [] };
  });
  const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
  return { pool, state, steps };
}

const ds = (id: string, probe?: Dataset['probe']): Dataset => ({
  id, kind: 'derived', lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  stages: [{ type: 'sql', statement: 'SELECT 1' }, { type: 'sql', statement: 'SELECT 2' }],
  probe,
});
const ctx = {} as ProbeContext;

describe('adoptDatasets', () => {
  it('records every stage ok at its planned hash, and a process step, without executing anything', async () => {
    const m = memoryPool();
    const d = ds('basemap', async () => ({ ok: true, detail: 'roads: 5' }));
    const out = await adoptDatasets(m.pool, [d], ctx);
    const hashes = stageHashPlan([d]).get('basemap')!;
    expect(out).toEqual([{ id: 'basemap', result: 'adopted', detail: 'roads: 5' }]);
    expect(m.state.get('basemap|0:sql')).toEqual({ input_hash: hashes[0], status: 'ok' });
    expect(m.state.get('basemap|1:sql')).toEqual({ input_hash: hashes[1], status: 'ok' });
    expect(m.steps).toEqual([{ id: 'basemap', description: 'adopted without executing · roads: 5', tool: 'atlas:adopt' }]);
    expect(executeStage).not.toHaveBeenCalled();
  });

  it('leaves a dataset that already has state alone — atlas:build decides', async () => {
    const m = memoryPool({ 'rivers|0:sql': { input_hash: 'old', status: 'ok' } });
    const probe = vi.fn(async () => ({ ok: true, detail: 'x' }));
    const out = await adoptDatasets(m.pool, [ds('rivers', probe)], ctx);
    expect(out[0].result).toBe('has-state');
    expect(probe).not.toHaveBeenCalled();
    expect(m.state.get('rivers|0:sql')?.input_hash).toBe('old');
  });

  it('adopts nothing when the probe fails, or throws, or is missing', async () => {
    const m = memoryPool();
    const out = await adoptDatasets(
      m.pool,
      [
        ds('a', async () => ({ ok: false, detail: 'roads: 0 (expected ≥ 1)' })),
        ds('b', async () => { throw new Error('GEOSERVER_URL is not set'); }),
        ds('c'),
      ],
      ctx
    );
    expect(out.map((o) => [o.id, o.result, o.detail])).toEqual([
      ['a', 'probe-failed', 'roads: 0 (expected ≥ 1)'],
      ['b', 'probe-failed', 'GEOSERVER_URL is not set'],
      ['c', 'no-probe', 'declares no probe; atlas:build will build it'],
    ]);
    expect(m.state.size).toBe(0);
    expect(m.steps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/adopt.test.ts src/lineage.test.ts`

Expected: FAIL, because neither `adoptionStep` nor `./adopt` exists.

- [ ] **Step 3: `adoptionStep`**

In `src/lineage.ts`, factor the collapse-and-cap logic out of `processStep` into a module-private helper. Then add the new function:

```ts
function capped(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > STEP_CAP ? `${collapsed.slice(0, STEP_CAP - 1)}…` : collapsed;
}

/** The process step atlas:adopt appends: no stage ran, the probe said the output already exists. */
export function adoptionStep(detail: string): { description: string; tool: string } {
  return { description: capped(`adopted without executing · ${detail}`), tool: 'atlas:adopt' };
}
```

Make `processStep` use `capped` for its description. Its existing tests must still pass unchanged.

- [ ] **Step 4: `adopt.ts`**

Create `src/adopt.ts`:

```ts
import type { Pool } from 'pg';
import type { Dataset, ProbeContext, ProbeResult } from './types';
import { topologicalOrder } from './graph';
import { stageKey, stageHashPlan, readStageState, writeStageState } from './state';
import { upsertLineage, appendProcessStep, adoptionStep } from './lineage';

export type AdoptResult = 'adopted' | 'has-state' | 'no-probe' | 'probe-failed';

export interface AdoptOutcome {
  id: string;
  result: AdoptResult;
  detail: string;
}

/**
 * Record an already-built machine as built without running anything (spec FR-13, UC-10). A dataset
 * with no stage state whose probe passes gets every stage written `ok` at its current planned hash,
 * plus one process step saying so. Anything that already has state is left to atlas:build, which
 * knows whether it is stale. Never executes a stage.
 */
export async function adoptDatasets(pool: Pool, datasets: Dataset[], ctx: ProbeContext): Promise<AdoptOutcome[]> {
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const out: AdoptOutcome[] = [];

  for (const d of ordered) {
    const keys = d.stages.map((s, i) => stageKey(i, s));

    let tracked = false;
    for (const key of keys) {
      if (await readStageState(pool, d.id, key)) {
        tracked = true;
        break;
      }
    }
    if (tracked) {
      out.push({ id: d.id, result: 'has-state', detail: 'already tracked; atlas:build decides what to redo' });
      continue;
    }
    if (!d.probe) {
      out.push({ id: d.id, result: 'no-probe', detail: 'declares no probe; atlas:build will build it' });
      continue;
    }

    let r: ProbeResult;
    try {
      r = await d.probe(ctx);
    } catch (err) {
      r = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!r.ok) {
      out.push({ id: d.id, result: 'probe-failed', detail: r.detail });
      continue;
    }

    // Lineage row first: process steps reference it (ON DELETE RESTRICT).
    await upsertLineage(pool, d);
    const step = adoptionStep(r.detail);
    await appendProcessStep(pool, d.id, step.description, step.tool);
    const hashes = plan.get(d.id)!;
    for (const [i, key] of keys.entries()) await writeStageState(pool, d.id, key, hashes[i], 'ok');
    out.push({ id: d.id, result: 'adopted', detail: r.detail });
  }

  return out;
}
```

- [ ] **Step 5: The CLI**

Create `src/cli/adopt.ts`:

```ts
import pg from 'pg';
import { loadDevEnv } from './env';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { adoptDatasets } from '../adopt';
import { probeContext } from '../probes';

async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();
  if (process.argv.length > 2) {
    console.error(`atlas:adopt: unexpected argument "${process.argv[2]}" (atlas:adopt takes no arguments)`);
    process.exitCode = 1;
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    const outcomes = await adoptDatasets(pool, ALL_DATASETS, probeContext(pool));
    for (const o of outcomes) console.log(`  ${o.result.padEnd(13)} ${o.id.padEnd(20)} ${o.detail}`);
    const adopted = outcomes.filter((o) => o.result === 'adopted').length;
    console.log(`adopted ${adopted} of ${outcomes.length}; next: npm run atlas:status`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

Add `"atlas:adopt": "tsx src/cli/adopt.ts",` to `packages/atlas-data/package.json` scripts, and add `"atlas:adopt": "npm run atlas:adopt -w @webatlas/atlas-data --",` to the root `package.json`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`

Expected: all tests pass.

- [ ] **Step 7: Mutation check**

In `adoptDatasets`, write `hashes[0]` for every stage instead of `hashes[i]`. The first test must fail. Restore it.

- [ ] **Step 8: Commit**

```bash
git add packages/atlas-data package.json
git commit -m "feat(atlas-data): atlas:adopt — ghi nhận dữ liệu đã có trên máy mà không chạy lại

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `atlas:status` groups; `atlas:verify`

**Files:**
- Create: `packages/atlas-data/src/status.ts`, `src/status.test.ts`, `src/verify.ts`, `src/verify.test.ts`, `src/cli/verify.ts`, `src/cli/report.ts`
- Modify: `src/cli/status.ts`, `src/cli/build.ts`, `packages/atlas-data/package.json`, root `package.json`

**Interfaces:**
- Consumes: `probeContext` and `wfsAnswers` from Task 5.
- Produces:
  - `type StageState = 'ok' | 'stale' | 'missing' | 'failed'`
  - `interface DatasetStatus { id: string; state: StageState; stages: Array<{ key: string; state: StageState }> }`
  - `computeStatus(pool, datasets): Promise<DatasetStatus[]>`
  - `formatStatus(rows: DatasetStatus[]): string[]`
  - `interface VerifyCheck { id: string; check: 'stages' | 'probe' | 'layer' | 'lineage'; ok: boolean; detail: string }`
  - `verifyAtlas(pool, datasets, ctx: ProbeContext): Promise<VerifyCheck[]>`
  - `formatVerify(checks): { lines: string[]; ok: boolean }`
  - `printBuildReport(report: BuildReport): void` (in `cli/report.ts`)

- [ ] **Step 1: Write the failing tests**

Create `src/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatStatus, type DatasetStatus } from './status';

const row = (id: string, ...stages: Array<[string, DatasetStatus['state']]>): DatasetStatus => {
  const order = ['failed', 'missing', 'stale', 'ok'] as const;
  const state = order.find((s) => stages.some(([, st]) => st === s)) ?? 'ok';
  return { id, state, stages: stages.map(([key, st]) => ({ key, state: st })) };
};

describe('formatStatus (spec U-4)', () => {
  it('groups worst-first, names the unhealthy stages, and suggests one next command', () => {
    const lines = formatStatus([
      row('demo', ['0:sql', 'ok']),
      row('basemap', ['0:fetch-http', 'missing'], ['1:run', 'missing']),
      row('rivers', ['0:run', 'stale'], ['1:publish-geoserver', 'ok']),
    ]);
    expect(lines).toEqual([
      'missing basemap',
      '          basemap: 0:fetch-http missing, 1:run missing',
      'stale   rivers',
      '          rivers: 0:run stale',
      'ok      demo',
      'next: npm run atlas:build   (or npm run atlas:adopt first, if this machine already holds the data)',
    ]);
  });

  it('points a failure at a targeted retry', () => {
    const lines = formatStatus([row('dem', ['0:run', 'ok'], ['1:run', 'failed'])]);
    expect(lines.at(-1)).toBe('next: npm run atlas:build -- --only dem   (retries the failed stage; the build output has the error)');
  });

  it('when everything is built, suggests verifying it serves', () => {
    expect(formatStatus([row('demo', ['0:sql', 'ok'])]).at(-1)).toBe(
      'next: npm run atlas:verify   (everything is recorded as built; check it actually serves)'
    );
  });
});

describe('computeStatus', () => {
  it('reads each stage as ok, stale (hash moved), failed or missing', async () => {
    const { vi } = await import('vitest');
    const { stageHashPlan } = await import('./state');
    const { computeStatus } = await import('./status');
    const d = {
      id: 'x', kind: 'derived' as const, lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [0, 1, 2, 3].map((i) => ({ type: 'sql' as const, statement: `SELECT ${i}` })),
    };
    const h = stageHashPlan([d]).get('x')!;
    const rows: Record<string, { input_hash: string; status: string }> = {
      '0:sql': { input_hash: h[0], status: 'ok' },
      '1:sql': { input_hash: 'an older hash', status: 'ok' },
      '2:sql': { input_hash: h[2], status: 'failed' },
    };
    const pool = {
      query: vi.fn(async (_sql: string, params: unknown[]) => ({ rows: rows[params[1] as string] ? [rows[params[1] as string]] : [] })),
    } as unknown as import('pg').Pool;
    const [s] = await computeStatus(pool, [d]);
    expect(s.stages.map((st) => st.state)).toEqual(['ok', 'stale', 'failed', 'missing']);
    expect(s.state).toBe('failed');
  });
});
```

Create `src/verify.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Dataset, ProbeContext } from './types';
import { stageHashPlan } from './state';
import { formatVerify, verifyAtlas } from './verify';

const d: Dataset = {
  id: 'rivers', kind: 'vector', lineage: { statement: 's', licence: 'ODbL-1.0', sources: [] },
  stages: [{ type: 'sql', statement: 'SELECT 1' }, { type: 'publish-geoserver', layer: 'rivers', nativeName: 'rivers_detail' }],
  probe: async () => ({ ok: true, detail: 'level-1 rivers: 588' }),
};
const hashes = stageHashPlan([d]).get('rivers')!;

function pool(opts: { state?: 'ok' | 'none'; licence?: string | null }) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app.dataset_stage_state')) {
        if (opts.state === 'none') return { rows: [] };
        const i = params[1] === '0:sql' ? 0 : 1;
        return { rows: [{ input_hash: hashes[i], status: 'ok' }] };
      }
      if (sql.includes('FROM app.dataset_lineage')) return { rows: opts.licence ? [{ licence: opts.licence }] : [] };
      return { rows: [] };
    }),
  } as unknown as Pool;
}
const ctx = (wfsFeatures: number): ProbeContext => ({
  pool: {} as Pool,
  geoserver: async () => new Response(JSON.stringify({ features: Array(wfsFeatures).fill({}) }), { status: 200 }),
});

describe('verifyAtlas (spec §9)', () => {
  it('passes when stages are ok, the probe passes, the layer serves and lineage has a licence', async () => {
    const checks = await verifyAtlas(pool({ licence: 'ODbL-1.0' }), [d], ctx(1));
    expect(checks.map((c) => [c.check, c.ok])).toEqual([['stages', true], ['probe', true], ['layer', true], ['lineage', true]]);
    expect(formatVerify(checks).ok).toBe(true);
  });

  it('reports each broken check, so disagreement between status and behaviour is visible', async () => {
    const checks = await verifyAtlas(pool({ state: 'none', licence: null }), [d], ctx(0));
    const byCheck = Object.fromEntries(checks.map((c) => [c.check, c]));
    expect(byCheck.stages).toMatchObject({ ok: false, detail: '0:sql missing, 1:publish-geoserver missing' });
    expect(byCheck.layer).toMatchObject({ ok: false, detail: 'webatlas:rivers WFS returned no features' });
    expect(byCheck.lineage).toMatchObject({ ok: false, detail: 'no lineage row — build or adopt the dataset' });
    const { lines, ok } = formatVerify(checks);
    expect(ok).toBe(false);
    expect(lines.at(-1)).toMatch(/^3 of 4 checks failed$/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/status.test.ts src/verify.test.ts`

Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: `status.ts`**

Create `src/status.ts`:

```ts
import type { Pool } from 'pg';
import type { Dataset } from './types';
import { topologicalOrder } from './graph';
import { stageKey, stageHashPlan, readStageState } from './state';

export type StageState = 'ok' | 'stale' | 'missing' | 'failed';

export interface DatasetStatus {
  id: string;
  state: StageState;
  stages: Array<{ key: string; state: StageState }>;
}

/** Worst first: a dataset is as healthy as its least healthy stage. */
const ORDER: StageState[] = ['failed', 'missing', 'stale', 'ok'];

/** Declared state (spec §4): what the registry believes, from the same hash plan the runner uses. */
export async function computeStatus(pool: Pool, datasets: Dataset[]): Promise<DatasetStatus[]> {
  const ordered = topologicalOrder(datasets);
  const plan = stageHashPlan(ordered);
  const out: DatasetStatus[] = [];
  for (const d of ordered) {
    const hashes = plan.get(d.id)!;
    const stages: DatasetStatus['stages'] = [];
    for (const [i, stage] of d.stages.entries()) {
      const key = stageKey(i, stage);
      const prior = await readStageState(pool, d.id, key);
      const state: StageState = !prior
        ? 'missing'
        : prior.status !== 'ok'
          ? 'failed'
          : prior.input_hash !== hashes[i]
            ? 'stale'
            : 'ok';
      stages.push({ key, state });
    }
    out.push({ id: d.id, state: ORDER.find((s) => stages.some((st) => st.state === s)) ?? 'ok', stages });
  }
  return out;
}

function suggestion(rows: DatasetStatus[]): string {
  const failed = rows.filter((r) => r.state === 'failed').map((r) => r.id);
  if (failed.length > 0) {
    return `npm run atlas:build -- --only ${failed.join(',')}   (retries the failed stage; the build output has the error)`;
  }
  if (rows.some((r) => r.state === 'missing' || r.state === 'stale')) {
    return 'npm run atlas:build   (or npm run atlas:adopt first, if this machine already holds the data)';
  }
  return 'npm run atlas:verify   (everything is recorded as built; check it actually serves)';
}

export function formatStatus(rows: DatasetStatus[]): string[] {
  const lines: string[] = [];
  for (const group of ORDER) {
    const inGroup = rows.filter((r) => r.state === group);
    if (inGroup.length === 0) continue;
    lines.push(`${group.padEnd(8)}${inGroup.map((r) => r.id).join(', ')}`);
    if (group === 'ok') continue;
    for (const r of inGroup) {
      const unhealthy = r.stages.filter((s) => s.state !== 'ok').map((s) => `${s.key} ${s.state}`);
      lines.push(`          ${r.id}: ${unhealthy.join(', ')}`);
    }
  }
  lines.push(`next: ${suggestion(rows)}`);
  return lines;
}
```

Replace the body of `src/cli/status.ts`'s `try` block. Keep its argument check and `loadDevEnv`:

```ts
    for (const line of formatStatus(await computeStatus(pool, ALL_DATASETS))) console.log(line);
```

Import `computeStatus` and `formatStatus` from `'../status'`, and remove the now-unused imports.

- [ ] **Step 4: `verify.ts`**

Create `src/verify.ts`:

```ts
import type { Pool } from 'pg';
import type { Dataset, Probe, ProbeContext, ProbeResult } from './types';
import { computeStatus } from './status';
import { wfsAnswers } from './probes';

export interface VerifyCheck {
  id: string;
  check: 'stages' | 'probe' | 'layer' | 'lineage';
  ok: boolean;
  detail: string;
}

async function safely(probe: Probe, ctx: ProbeContext): Promise<ProbeResult> {
  try {
    return await probe(ctx);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Observed behaviour (spec §9): every stage recorded ok, every probe passing, every published layer
 * answering a real WFS request, every dataset with a licensed lineage row. Deliberately not the test
 * suite — a build failing and the code being wrong are read differently.
 */
export async function verifyAtlas(pool: Pool, datasets: Dataset[], ctx: ProbeContext): Promise<VerifyCheck[]> {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const checks: VerifyCheck[] = [];
  for (const s of await computeStatus(pool, datasets)) {
    const d = byId.get(s.id)!;
    const unhealthy = s.stages.filter((x) => x.state !== 'ok');
    checks.push({
      id: d.id,
      check: 'stages',
      ok: unhealthy.length === 0,
      detail: unhealthy.length ? unhealthy.map((x) => `${x.key} ${x.state}`).join(', ') : `${s.stages.length} stage(s) ok`,
    });
    if (d.probe) checks.push({ id: d.id, check: 'probe', ...(await safely(d.probe, ctx)) });
    for (const stage of d.stages) {
      if (stage.type === 'publish-geoserver') {
        checks.push({ id: d.id, check: 'layer', ...(await safely(wfsAnswers(stage.layer), ctx)) });
      }
    }
    const { rows } = await pool.query<{ licence: string }>(
      'SELECT licence FROM app.dataset_lineage WHERE dataset_id = $1',
      [d.id]
    );
    const licence = rows[0]?.licence ?? '';
    checks.push({
      id: d.id,
      check: 'lineage',
      ok: licence.length > 0,
      detail: licence ? `licence ${licence}` : 'no lineage row — build or adopt the dataset',
    });
  }
  return checks;
}

export function formatVerify(checks: VerifyCheck[]): { lines: string[]; ok: boolean } {
  const lines = checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(20)} ${c.check.padEnd(8)} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  lines.push(failed === 0 ? `all ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`);
  return { lines, ok: failed === 0 };
}
```

Create `src/cli/verify.ts`. It follows the same shape as `cli/adopt.ts`: `loadDevEnv`, `validateRegistry`, no arguments, a pool, then:

```ts
    const { lines, ok } = formatVerify(await verifyAtlas(pool, ALL_DATASETS, probeContext(pool)));
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
```

Add `"atlas:verify": "tsx src/cli/verify.ts",` to the atlas-data scripts, and add `"atlas:verify": "npm run atlas:verify -w @webatlas/atlas-data --",` to the root scripts.

- [ ] **Step 5: One report printer**

Create `src/cli/report.ts`, moving the printing loop out of `build.ts` unchanged:

```ts
import type { BuildReport } from '../runner';

/** The build summary, shared by atlas:build and atlas:up. Sets a failing exit code on any failure. */
export function printBuildReport(report: BuildReport): void {
  console.log(`executed ${report.executed.length}, skipped ${report.skipped.length}`);
  for (const s of report.executed) console.log(`  built   ${s}`);
  for (const s of report.failed) console.log(`  FAILED  ${s}: ${report.errors[s]}`);
  for (const s of report.blocked) console.log(`  blocked ${s} (not run)`);
  if (report.failed.length > 0 || report.blocked.length > 0) process.exitCode = 1;
}
```

In `src/cli/build.ts`, replace the printing block with `printBuildReport(report);`.

- [ ] **Step 6: Run the tests and the typecheck; try the commands**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data && npm run atlas:status`

Expected: all tests pass. `atlas:status` prints the grouped view: `missing` first, then `stale rivers`, then `ok demo`, then the adopt/build suggestion.

- [ ] **Step 7: Mutation check**

In `computeStatus`, replace `prior.input_hash !== hashes[i] ? 'stale' : 'ok'` with `'ok'`. "reads each stage as ok, stale (hash moved), failed or missing" must fail. Restore it.

- [ ] **Step 8: Commit**

```bash
git add packages/atlas-data package.json
git commit -m "feat(atlas-data): atlas:status nhóm theo trạng thái, gợi ý một lệnh; thêm atlas:verify

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `atlas:up`

**Files:**
- Create: `packages/atlas-data/src/up.ts`, `src/up.test.ts`, `src/cli/system.ts`, `src/cli/up.ts`
- Modify: `packages/atlas-data/package.json`, root `package.json`

**Interfaces:**
- Consumes:
  - `composeArgs`, `composeEnv` (Task 4)
  - `npmCli` (Plan A)
  - `runProcess` (Plan A)
  - `loadDevEnv`, `geoserverEnv`, `runBuild`, `printBuildReport`, `verifyAtlas`, `formatVerify`, `probeContext`
  - `parseBuildArgs`, `selectDatasets`, `assertForceSelected`
- Produces:
  - `interface UpSystem`
  - `interface UpConfig`
  - `class UpError extends Error`
  - `ENV_FILES: string[]`
  - `preflight(sys, cfg)`
  - `startStack(sys, cfg)`
  - `waitReady(sys, cfg, gs)`
  - `buildTools(sys, cfg)`
  - `migrate(sys, cfg)`
  - `realSystem(): UpSystem`

- [ ] **Step 1: Write the failing tests**

Create `src/up.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildTools, ENV_FILES, migrate, preflight, startStack, UpError, waitReady, type UpConfig, type UpSystem } from './up';

const GiB = 1024 ** 3;

function fakeSystem(over: {
  exec?: (file: string, args: string[]) => number;
  free?: number;
  existing?: string[];
  statuses?: number[];
} = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const copies: Array<[string, string]> = [];
  let clock = 0;
  const statuses = [...(over.statuses ?? [200])];
  const sys: UpSystem = {
    async exec(file, args) {
      calls.push([file, ...args].join(' '));
      return { code: over.exec ? over.exec(file, args) : 0, tail: ['last line'] };
    },
    async freeBytes() { return over.free ?? 50 * GiB; },
    exists: (p) => (over.existing ?? []).some((e) => p.endsWith(e)),
    copy: (a, b) => { copies.push([a, b]); },
    async status() { return statuses.length > 1 ? statuses.shift()! : statuses[0]; },
    async sleep(ms) { clock += ms; },
    now: () => clock,
    log: (l) => { logs.push(l); },
  };
  return { sys, calls, logs, copies };
}

const cfg: UpConfig = {
  repoRoot: '/repo',
  cacheDir: '/repo/packages/atlas-data/data/cache',
  nodeVersion: '22.13.1',
  docker: ['compose', '-f', '/repo/infra/docker-compose.yml'],
  dockerEnv: {},
  npm: { file: '/usr/bin/node', args: ['/npm/bin/npm-cli.js'] },
  readyTimeoutMs: 10_000,
  pollMs: 2_000,
};
const gs = { url: 'http://localhost:8080/geoserver', user: 'admin', password: 'pw' };

describe('preflight (spec F-1, U-6, U-7)', () => {
  it('passes on a ready machine and states the expected downloads first', async () => {
    const f = fakeSystem({ existing: ENV_FILES });
    await preflight(f.sys, cfg);
    expect(f.logs.some((l) => /downloads about 1\.2 GB/.test(l))).toBe(true);
    expect(f.copies).toEqual([]);
  });

  it('refuses a Node other than 22', async () => {
    await expect(preflight(fakeSystem().sys, { ...cfg, nodeVersion: '20.11.0' })).rejects.toThrow(/Node 22 is required \(this is Node 20\.11\.0\)/);
  });

  it('says Docker is not running when `docker info` fails — before anything else runs', async () => {
    const f = fakeSystem({ exec: (file, args) => (args[0] === 'info' ? 1 : 0) });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/Docker is not running — start Docker Desktop/);
    expect(f.calls).toEqual(['docker info']);
  });

  it('requires Compose v2', async () => {
    const f = fakeSystem({ exec: (file, args) => (args[0] === 'compose' ? 1 : 0) });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/Docker Compose v2 is required/);
  });

  it('creates missing env files from their examples and says so', async () => {
    const f = fakeSystem({ existing: [] });
    await preflight(f.sys, cfg);
    expect(f.copies).toEqual([
      [join('/repo', 'infra', '.env.example'), join('/repo', 'infra', '.env')],
      [join('/repo', 'apps', 'api', '.env.example'), join('/repo', 'apps', 'api', '.env')],
    ]);
    expect(f.logs.filter((l) => l.startsWith('created '))).toHaveLength(2);
  });

  it('refuses below the free-space floor, with the number', async () => {
    const f = fakeSystem({ existing: ENV_FILES, free: 2 * GiB });
    await expect(preflight(f.sys, cfg)).rejects.toThrow(/only 2\.0 GB free .* needs at least 6 GB/);
  });
});

describe('startStack / buildTools / migrate', () => {
  it('bring up only db and geoserver, never down', async () => {
    const f = fakeSystem();
    await startStack(f.sys, cfg);
    await buildTools(f.sys, cfg);
    await migrate(f.sys, cfg);
    expect(f.calls).toEqual([
      'docker compose -f /repo/infra/docker-compose.yml up -d db geoserver',
      'docker compose -f /repo/infra/docker-compose.yml --profile tools build tools',
      '/usr/bin/node /npm/bin/npm-cli.js run migrate:up -w @webatlas/api',
    ]);
    expect(f.calls.join('\n')).not.toMatch(/\bdown\b/);
  });

  it('carry the failing command output in the error', async () => {
    const f = fakeSystem({ exec: () => 1 });
    await expect(startStack(f.sys, cfg)).rejects.toThrow(/last line/);
    await expect(migrate(f.sys, cfg)).rejects.toBeInstanceOf(UpError);
  });
});

describe('waitReady (spec §4 stack lifecycle)', () => {
  it('polls the database, then GeoServer REST, until both answer', async () => {
    let dbAttempts = 0;
    const f = fakeSystem({ exec: () => (++dbAttempts < 3 ? 1 : 0), statuses: [0, 503, 200] });
    await waitReady(f.sys, cfg, gs);
    expect(dbAttempts).toBe(3);
    expect(f.logs).toEqual(['db ready', 'geoserver ready']);
  });

  it('gives up with the last status when GeoServer never answers', async () => {
    const f = fakeSystem({ statuses: [503] });
    await expect(waitReady(f.sys, cfg, gs)).rejects.toThrow(/GeoServer did not answer within 10 s \(last status 503\)/);
  });

  it('names a credentials mismatch instead of waiting it out', async () => {
    const f = fakeSystem({ statuses: [401] });
    await expect(waitReady(f.sys, cfg, gs)).rejects.toThrow(/GEOSERVER_ADMIN_PASSWORD in apps\/api\/\.env must match infra\/\.env/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/up.test.ts`

Expected: FAIL, because `./up` does not exist.

- [ ] **Step 3: `up.ts`**

Create `src/up.ts`:

```ts
import { join } from 'node:path';

export interface ExecResult {
  code: number | null;
  tail: string[];
}

/** Everything atlas:up touches outside itself, so the orchestration is testable without Docker. */
export interface UpSystem {
  /** Start a process (never through a shell). `quiet` suppresses its output. Never rejects. */
  exec(file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; quiet?: boolean }): Promise<ExecResult>;
  /** Bytes free on the filesystem that holds `path`, which may not exist yet. */
  freeBytes(path: string): Promise<number>;
  exists(path: string): boolean;
  copy(src: string, dst: string): void;
  /** Status of an authenticated GET, or 0 when nothing answered. Never rejects. */
  status(url: string, auth: { user: string; password: string }): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export interface UpConfig {
  repoRoot: string;
  cacheDir: string;
  nodeVersion: string;
  /** `['compose', '-f', <file>]` (composeArgs). */
  docker: string[];
  /** composeEnv(): infra/.env governs interpolation. */
  dockerEnv: NodeJS.ProcessEnv;
  /** node + npm-cli.js (npmCli), so `npm` never goes through a shell. */
  npm: { file: string; args: string[] };
  minFreeBytes?: number;
  readyTimeoutMs?: number;
  pollMs?: number;
}

export class UpError extends Error {}

const GiB = 1024 ** 3;

/** The env files a fresh clone needs, created from their committed examples. */
export const ENV_FILES = [join('infra', '.env'), join('apps', 'api', '.env')];

function failed(what: string, r: ExecResult): UpError {
  return new UpError([what, ...r.tail.map((l) => `  | ${l}`)].join('\n'));
}

/** Everything that can be known to fail before anything runs (spec F-1 step 1, U-1, U-6, U-7). */
export async function preflight(sys: UpSystem, cfg: UpConfig): Promise<void> {
  if (Number(cfg.nodeVersion.split('.')[0]) !== 22) {
    throw new UpError(`Node 22 is required (this is Node ${cfg.nodeVersion}) — see "engines" in package.json`);
  }
  if ((await sys.exec('docker', ['info'], { env: cfg.dockerEnv, quiet: true })).code !== 0) {
    throw new UpError('Docker is not running — start Docker Desktop (or the docker service), then run npm run atlas:up again');
  }
  if ((await sys.exec('docker', ['compose', 'version'], { env: cfg.dockerEnv, quiet: true })).code !== 0) {
    throw new UpError('Docker Compose v2 is required: `docker compose version` failed');
  }
  for (const rel of ENV_FILES) {
    const file = join(cfg.repoRoot, rel);
    if (!sys.exists(file)) {
      sys.copy(`${file}.example`, file);
      sys.log(`created ${rel} from ${rel}.example (local development defaults — change them for anything shared)`);
    }
  }
  const min = cfg.minFreeBytes ?? 6 * GiB;
  const free = await sys.freeBytes(cfg.cacheDir);
  if (free < min) {
    throw new UpError(
      `only ${(free / GiB).toFixed(1)} GB free for ${cfg.cacheDir}; the first build needs at least ${Math.round(min / GiB)} GB ` +
        '(downloads, intermediates and the database volume)'
    );
  }
  sys.log(
    'first build: downloads about 1.2 GB (OpenStreetMap extract 684 MB, FABDEM tiles 512 MB) and takes a while — ' +
      'see README "Getting started" for the measured time. Re-running resumes; finished work is skipped.'
  );
}

/** Up, never down (spec §4): starting an already-running stack is a no-op, and no volume is ever touched. */
export async function startStack(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec('docker', [...cfg.docker, 'up', '-d', 'db', 'geoserver'], { env: cfg.dockerEnv });
  if (r.code !== 0) throw failed('could not start the stack (docker compose up -d db geoserver):', r);
}

/** Readiness is polled, not assumed (spec §4): db accepting connections, then GeoServer's REST API answering. */
export async function waitReady(
  sys: UpSystem,
  cfg: UpConfig,
  gs: { url: string; user: string; password: string }
): Promise<void> {
  const timeout = cfg.readyTimeoutMs ?? 180_000;
  const poll = cfg.pollMs ?? 2_000;
  const deadline = sys.now() + timeout;

  for (;;) {
    const r = await sys.exec('docker', [...cfg.docker, 'exec', '-T', 'db', 'pg_isready'], { env: cfg.dockerEnv, quiet: true });
    if (r.code === 0) break;
    if (sys.now() >= deadline) throw new UpError(`the database did not become ready within ${timeout / 1000} s`);
    await sys.sleep(poll);
  }
  sys.log('db ready');

  for (;;) {
    const status = await sys.status(`${gs.url}/rest/about/version.json`, gs);
    if (status === 200) break;
    if (status === 401) {
      throw new UpError('GeoServer rejected the admin credentials — GEOSERVER_ADMIN_PASSWORD in apps/api/.env must match infra/.env');
    }
    if (sys.now() >= deadline) {
      throw new UpError(`GeoServer did not answer within ${timeout / 1000} s (last status ${status})`);
    }
    await sys.sleep(poll);
  }
  sys.log('geoserver ready');
}

export async function buildTools(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec('docker', [...cfg.docker, '--profile', 'tools', 'build', 'tools'], { env: cfg.dockerEnv });
  if (r.code !== 0) throw failed('could not build the atlas-tools image:', r);
}

export async function migrate(sys: UpSystem, cfg: UpConfig): Promise<void> {
  const r = await sys.exec(cfg.npm.file, [...cfg.npm.args, 'run', 'migrate:up', '-w', '@webatlas/api']);
  if (r.code !== 0) throw failed('migrations failed (npm run migrate:up -w @webatlas/api):', r);
}
```

- [ ] **Step 4: The real system and the CLI**

Create `src/cli/system.ts`:

```ts
import { copyFileSync, existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UpSystem } from '../up';
import { runProcess } from '../process';
import { REPO_ROOT } from '../paths';

export function realSystem(label = 'up'): UpSystem {
  return {
    async exec(file, args, opts = {}) {
      try {
        const r = await runProcess(file, args, {
          label,
          log: opts.quiet ? () => {} : (l) => console.log(l),
          env: opts.env,
          cwd: REPO_ROOT,
        });
        return { code: r.code, tail: r.tail };
      } catch (err) {
        // runProcess rejects only when the executable cannot start (e.g. docker not installed).
        return { code: null, tail: [err instanceof Error ? err.message : String(err)] };
      }
    },
    async freeBytes(path) {
      let p = path;
      while (!existsSync(p)) {
        const up = dirname(p);
        if (up === p) break;
        p = up;
      }
      const s = await statfs(p);
      return s.bavail * s.bsize;
    },
    exists: existsSync,
    copy: (src, dst) => copyFileSync(src, dst),
    async status(url, auth) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.password}`).toString('base64') },
          signal: AbortSignal.timeout(5_000),
        });
        await res.body?.cancel();
        return res.status;
      } catch {
        return 0;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.log(line),
  };
}
```

Create `src/cli/up.ts`:

```ts
import { resolve } from 'node:path';
import pg from 'pg';
import { loadDevEnv } from './env';
import { realSystem } from './system';
import { printBuildReport } from './report';
import { parseBuildArgs } from './args';
import { selectDatasets, assertForceSelected, type ExclusionReason } from './select';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { runBuild } from '../runner';
import { verifyAtlas, formatVerify } from '../verify';
import { probeContext } from '../probes';
import { geoserverEnv } from '../geoserver';
import { composeArgs, composeEnv } from '../compose';
import { npmCli } from '../stages/run';
import { buildTools, migrate, preflight, startStack, UpError, waitReady, type UpConfig } from '../up';
import { DATA_CACHE, REPO_ROOT } from '../paths';

/** `--compose <file>` or `--compose=<file>` is atlas:up's own; everything else is atlas:build's. */
function takeCompose(argv: string[]): { compose?: string; rest: string[] } {
  const rest: string[] = [];
  let compose: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('atlas:up: --compose requires a file');
      compose = v;
      i++;
    } else if (a.startsWith('--compose=')) {
      compose = a.slice('--compose='.length);
    } else {
      rest.push(a);
    }
  }
  return { compose, rest };
}

async function main(): Promise<void> {
  validateRegistry();

  // Usage errors first, before anything starts.
  let datasets = ALL_DATASETS;
  let excluded: ExclusionReason[] = [];
  let force: string[] = [];
  try {
    const { compose, rest } = takeCompose(process.argv.slice(2));
    if (compose) process.env.ATLAS_COMPOSE_FILE = resolve(compose);
    const { only, except, force: forced } = parseBuildArgs(rest);
    ({ selected: datasets, excluded } = selectDatasets(ALL_DATASETS, { only, except }));
    if (datasets.length === 0) throw new Error('atlas:up: no datasets selected (--only/--except excluded everything)');
    assertForceSelected(forced, ALL_DATASETS, datasets);
    force = forced;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const sys = realSystem();
  const cfg: UpConfig = {
    repoRoot: REPO_ROOT,
    cacheDir: DATA_CACHE,
    nodeVersion: process.versions.node,
    docker: composeArgs(),
    dockerEnv: composeEnv(),
    npm: { file: process.execPath, args: [npmCli()] },
  };

  try {
    console.log('== preflight');
    await preflight(sys, cfg);
    // After preflight: it may have just created apps/api/.env.
    const envFile = loadDevEnv();
    if (envFile) console.log(`(environment from ${envFile})`);
    cfg.dockerEnv = composeEnv();
    console.log('== stack');
    await startStack(sys, cfg);
    await waitReady(sys, cfg, geoserverEnv());
    console.log('== atlas-tools image');
    await buildTools(sys, cfg);
    console.log('== migrations');
    await migrate(sys, cfg);
  } catch (err) {
    if (err instanceof UpError) {
      console.error(`atlas:up: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  for (const e of excluded) console.log(`  excluded ${e.id} (${e.reason})`);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    console.log('== build');
    printBuildReport(await runBuild(pool, datasets, { universe: ALL_DATASETS, force }));
    console.log('== verify');
    const { lines, ok } = formatVerify(await verifyAtlas(pool, datasets, probeContext(pool)));
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }

  console.log('');
  console.log('next: create an administrator (there is no default login):');
  console.log('  npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"');
  console.log('then: npm run dev -w @webatlas/api   and   npm run dev:web');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

A dataset that `--except` drops only because it depends on an excluded one must say which one (U-2): "contours: excluded — depends on dem". In `src/cli/select.ts`, replace the loop that builds `excluded` with:

```ts
  const excluded: ExclusionReason[] = [];
  const exceptIds = new Set(except);
  for (const d of all) {
    if (selectedIds.has(d.id)) continue;
    const droppedByExcept = keptByExcept !== null && !keptByExcept.has(d.id);
    if (!droppedByExcept) {
      excluded.push({ id: d.id, reason: 'not in --only' });
    } else if (exceptIds.has(d.id)) {
      excluded.push({ id: d.id, reason: '--except' });
    } else {
      // Dropped because a dependency was: name the first dependency that is itself dropped.
      const cause = (d.dependsOn ?? []).find((dep) => !keptByExcept!.has(dep));
      excluded.push({ id: d.id, reason: `depends on ${cause}` });
    }
  }
```

Then, in `src/cli/select.test.ts`, change the expected reason for a dependent of an excluded dataset from `'--except'` to `'depends on <parent>'`. With that file's graph, excluding `dem` gives `{ id: 'contours', reason: 'depends on dem' }`. Keep every other expectation unchanged.

Add `"atlas:up": "tsx src/cli/up.ts",` to the atlas-data scripts, and add `"atlas:up": "npm run atlas:up -w @webatlas/atlas-data --",` to the root scripts.

- [ ] **Step 5: Run the tests and the typecheck, then try it on this machine**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`

Expected: all tests pass.

Then run the preflight and stack half on this machine, where the stack is already up. It must be a no-op for the running containers:

```bash
npm run atlas:up -- --only demo
```

Expected sequence:
1. `== preflight` passes.
2. `== stack`: `up -d` reports both services running, then `db ready` and `geoserver ready`.
3. `== atlas-tools image` builds or reports cached.
4. `== migrations`: nothing to run.
5. `== build`: `demo` skipped.
6. `== verify`: demo checks pass.
7. The `create-admin` hint is printed.
8. Exit code 0.

Confirm with `docker compose -f infra/docker-compose.yml ps` that `db` and `geoserver` kept their uptime. If either was recreated, stop and report it.

- [ ] **Step 6: Mutation check**

In `waitReady`, remove the `if (status === 401) …` branch. "names a credentials mismatch instead of waiting it out" must fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-data package.json
git commit -m "feat(atlas-data): atlas:up — kiểm tra trước, dựng stack, chờ sẵn sàng, ảnh tools, migrate, dựng, kiểm chứng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Adopt this machine

This is operational. It changes the dev database's registry tables, but no data tables are touched except by the `rivers` rebuild.

**Files:**
- Modify: this plan's Execution Notes only.

- [ ] **Step 1: Before**

Run: `npm run atlas:status`

Expected: `rivers` stale; `seeds`, `basemap`, `reference_entities`, `dem` and `contours` missing; `demo` ok. Record the output.

- [ ] **Step 2: Adopt**

Run: `npm run atlas:adopt`

Expected: `adopted` for `seeds`, `basemap`, `reference_entities`, `dem` and `contours`, each with its probe detail (the Measured Baselines figures); `has-state` for `demo` and `rivers`. If any probe fails, **stop** and report the detail; do not force anything.

- [ ] **Step 3: Build what is stale**

Run: `npm run atlas:build`

Expected: every adopted dataset is skipped. `rivers` re-runs its ingest (about a minute, 0 hierarchy rows changed) and its two publish stages. Exit code 0. Nothing may start the tools container: no tools stage should execute here.

- [ ] **Step 4: Verify**

Run: `npm run atlas:verify` and then `npm run atlas:status`

Expected: all checks pass, and every dataset is `ok`, with the suggestion `npm run atlas:verify`.

- [ ] **Step 5: Record**

Add the outputs of Steps 1–4 (trimmed) and their timings to the Execution Notes, then commit:

```bash
git add docs/superpowers/plans/2026-09-30-plan-B-registry-atlas-up.md
git commit -m "docs(plan): máy dev đã được nhận vào sổ đăng ký (adopt), mọi tập dữ liệu ok

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation — `atlas:up` is the way in

**Files:**
- Modify: `README.md` ("Getting started" and "Workspace scripts"), `docs/runbooks/README.md`, `docs/runbooks/self-hosted-basemap.md`, `docs/runbooks/elevation-dem.md`, `docs/runbooks/terrain-contours.md`, `docs/architecture/database-architecture.md` (§14 and the registry mentions)

- [ ] **Step 1: README "Getting started"**

Replace README §"Getting started" (from `## Getting started` up to the next `##`) with:

````markdown
## Getting started

**Prerequisites:** Node 22, npm 10, Docker (Desktop on Windows/macOS) with Compose v2, and git.
Nothing else: the Python geo stack, GDAL and `raster2pgsql` run inside the `atlas-tools` image.
Allow at least 6 GB free on the drive holding the repository.

```bash
npm install
npm run atlas:up
```

`atlas:up` checks the machine, creates `infra/.env` and `apps/api/.env` from their examples when
missing (local development defaults), starts PostGIS and GeoServer, builds the tools image, applies
migrations, builds every dataset and verifies the result. The first run downloads about 1.2 GB
(the OpenStreetMap Vietnam extract and FABDEM elevation tiles) and took **<measured in Task 12>**
on the reference machine. Re-running resumes: finished work is skipped. To skip the elevation
data: `npm run atlas:up -- --except dem` (contours depend on it and are skipped too).

Then create an administrator (there is no default login) and start the app:

```bash
npm run create-admin -w @webatlas/api -- --email you@example.com --password "…" --name "…"
npm run dev -w @webatlas/api    # API at http://localhost:3001
npm run dev:web                 # web app at http://localhost:5173
```

### Day-to-day

| Command | Does |
|---|---|
| `npm run atlas:status` | What is built, stale, missing or failed — and the one command to run next |
| `npm run atlas:build -- --only <id>` | Build one dataset and its dependencies |
| `npm run atlas:build -- --force <id>` | Rebuild a dataset on purpose (e.g. `--force basemap` for a newer OSM extract) |
| `npm run atlas:verify` | Check the atlas actually serves: stages, probes, layers, lineage |
| `npm run atlas:adopt` | A machine set up before the registry: record what is already built, without re-running it |

Datasets: `seeds`, `rivers`, `basemap`, `reference_entities`, `dem`, `contours` (plus the synthetic `demo`).
The runbooks under `docs/runbooks/` describe what each dataset is and where it comes from.
````

In "Workspace scripts", add rows for `atlas:up`, `atlas:status`, `atlas:build`, `atlas:verify` and `atlas:adopt`, and mark `seed` and `publish:geoserver` as "superseded by `atlas:build`; kept until Plan C".

- [ ] **Step 2: Runbooks**

**`docs/runbooks/README.md`.** Replace the "Runbooks — setup order" introduction and table. The page now says that `npm run atlas:up` performs every step. The table maps each old runbook step to its dataset or `atlas:up` step, following spec FR-2. Keep the "Notes on each step" as reference material about each dataset, reworded from "run this" to "this is what the `<id>` dataset does", and point each at `npm run atlas:build -- --only <id>` for a manual rerun.

**Per-dataset runbooks.** In `self-hosted-basemap.md`, `elevation-dem.md` and `terrain-contours.md`:
- Replace the "Rebuilding" and "Load" command sequences with `npm run atlas:build -- --force <id>`.
- Say that the tools run inside `atlas-tools`.
- Keep every measurement, licence note and troubleshooting item.
- Replace remaining `python …` and `bash …` host invocations with the in-container form, for anyone debugging one script: `docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools <argv>`.
- Delete the "Install the Python geo stack" steps.
- In `terrain-contours.md`, drop the `python3` versus `python` interpreter note, since it no longer applies.

- [ ] **Step 3: Architecture doc**

In `docs/architecture/database-architecture.md`:
- Update the §14 status so that registry steps 2–4 are implemented. Name the datasets, `atlas:up`, and the tools image.
- Note that step 5 (Plan C) remains.

- [ ] **Step 4: Check the docs name real commands**

```bash
git grep -n "pip install\|apps/api/scripts" -- README.md docs/runbooks docs/architecture
```

Expected: no host `pip install` instructions remain, apart from any explicitly marked "only for editing a script outside the container". No old paths remain.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: atlas:up là lối vào — README, runbook và kiến trúc cập nhật theo sổ đăng ký

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Fresh-clone acceptance

This task is operational. It downloads about 1.2 GB and takes a long time, so run it in the background and poll.

**Files:**
- Modify: `README.md` (the measured duration), and this plan's Execution Notes.

- [ ] **Step 1: A clean clone, on its own ports and project**

The paths below use the session scratchpad; substitute its absolute path. From Git Bash:

```bash
ACC="<scratchpad>/atlas-accept"
git clone --branch feat/registry-plan-b "$(git rev-parse --show-toplevel)" "$ACC"
cd "$ACC"
cp infra/.env.example infra/.env
sed -i 's/^POSTGRES_PORT=.*/POSTGRES_PORT=55432/; s/^GEOSERVER_PORT=.*/GEOSERVER_PORT=58080/' infra/.env
cp apps/api/.env.example apps/api/.env
sed -i 's#localhost:5432#localhost:55432#g; s#localhost:8080#localhost:58080#g' apps/api/.env
export COMPOSE_PROJECT_NAME=webatlas_accept
npm install
```

The pre-created env files exist only to move the ports off the running dev stack. Preflight's file creation is covered by `up.test.ts`. `COMPOSE_PROJECT_NAME` beats the compose file's `name: webatlas`, so the containers and volumes are separate.

- [ ] **Step 2: `atlas:up` from nothing**

```bash
date; time npm run atlas:up 2>&1 | tee atlas-up.log; echo "exit ${PIPESTATUS[0]}"
```

Run it in the background and check progress every few minutes; the heartbeats show it is alive.

Expected, in order:
1. Preflight passes.
2. The `webatlas_accept` stack comes up.
3. The tools image builds, or is reused.
4. Migrations run.
5. Every dataset builds: seeds, rivers, basemap (download → load → styles → publish), reference_entities, dem (prep → load) and contours (generate → styles → publish).
6. The verify step reports `all … checks passed`.
7. Exit code 0.

If a stage fails, the error names the dataset, the command, its last lines and the retry command. **Fix the cause in the repository on the branch** (a new commit, with a test when the cause is code), `git pull` it into the clone, and rerun `npm run atlas:up`. The rerun must resume, skipping finished stages; record that too. Never delete the clone's volumes to "start clean". If a clean start is genuinely needed, stop and ask.

- [ ] **Step 3: Check it is real**

In the clone:

```bash
npm run atlas:status        # every dataset ok
npm run atlas:verify        # all checks pass
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost:58080/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=webatlas:basemap&styles=&bbox=108.0,12.5,108.2,12.7&width=256&height=256&srs=EPSG:4326&format=image/png"
```

Expected: `200 image/png`.

- [ ] **Step 4: Record, and hand the cleanup to the user**

In the branch's `README.md`, replace `<measured in Task 12>` with the measured wall time, for example "about 45 minutes on a 100 Mbit/s line". Add the same figure to the Execution Notes, together with:
- the per-dataset timings from `atlas-up.log`;
- the final `atlas:verify` output;
- the image size;
- the disk used by the clone's cache and volumes.

In the report, give the user the cleanup command. **Do not run it:**

```
docker compose -p webatlas_accept -f <scratchpad>/atlas-accept/infra/docker-compose.yml down -v
```

Commit:

```bash
git add README.md docs/superpowers/plans/2026-09-30-plan-B-registry-atlas-up.md
git commit -m "docs: đo thời gian atlas:up từ bản clone sạch; ghi chú thực thi kế hoạch B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final Verification

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data                 # all pass, 0 skipped
ATLAS_TOOLS_TESTS=1 npm test -w @webatlas/atlas-data -- src/stages/tools.docker.test.ts
npm run build -w @webatlas/atlas-data
npm test -w @webatlas/shared
npm run test -w @webatlas/api                    # the controller runs this; the known wall-clock flakes are pre-existing
npm run build:web
npm run atlas:status && npm run atlas:verify     # this machine: all ok
git grep -n "apps/api/scripts" -- ':!docs/superpowers' ':!.superpowers' ':!apps/api/src/db/migrations' ':!docs/reports'   # nothing
```

## Definition of Done

- A fresh clone reaches a verified atlas with `npm install && npm run atlas:up` (Task 12). The measured time is in the README.
- The host needs only Node 22, npm, Docker and git. All Python, GDAL and bash work runs in `atlas-tools`.
- Every runbook step is a registered dataset or a step of `atlas:up`. Ordering is expressed as `dependsOn`.
- This machine is adopted, and every dataset reports `ok` and verifies.
- No password appears in any argv, stage hash or lineage row. The scripts fail on any non-2xx.
- `apps/api` holds no `scripts/` directory.
- The old commands still work.
