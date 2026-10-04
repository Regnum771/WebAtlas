# Dataset Registry — Steps 2–5: One-Command Atlas — Design

**Date:** 2026-09-30
**Status:** Approved design. Not yet implemented.
**Amends:** [`2026-09-16-dataset-registry-and-one-command-build-design.md`](2026-09-16-dataset-registry-and-one-command-build-design.md) (the base spec), §7 steps 2–5.
**Supersedes:** `2026-09-17-registry-plan-2-design.md` (branch `feat/registry-plan-2`, never merged). It was written before the 2026-09-23 reorder and before entity phases 3–4. Its decisions carry over where §13 says so.

## Why this amendment exists

Plan 1 shipped the registry foundation. Since then the ground has moved:

| Change | Effect on the registry |
|---|---|
| **2026-09-23 reorder** (base spec §7) | `run` and `publish-geoserver` come first, and `atlas:up` comes before the seed migration. The stale Plan 2 design had it the other way round. |
| **Entity phase 3** (`8f0ac8a`) | Rivers are three levels in one version (9,486 OSM ways, 13,045 HydroRIVERS reaches, 588 named rivers). `activate()` builds the hierarchy and stamps administrative codes. `rivers_overview` is a plain view, so there is nothing to refresh. |
| **Entity phase 1** | `seed` also loads `admin.provinces` / `admin.wards`, and every water layer's activation stamps against them. Loading has an ordering dependency the runbook states only in prose. |
| **Entity phase 2** | `reference:build` rebuilds `basemap.reference_entities` after every basemap load (runbook step 6). |
| **Entity phase 4** (`5ac6c01`) | Migration 21 indexes `reference_entities.member_ids`. No new data step. |
| **`hydrorivers.ts`** | Registered as a `run` stage against a runner that cannot execute `run`. `atlas:build` reports it `missing`, and its `promoteBy` is 2026-12-31. |

**User decisions for this amendment (2026-09-30):**

- **D1, scope:** steps 2–5. Sub-projects C (raster out of PostGIS) and D (SLD from tokens), and deployment, come after.
- **D2, toolchain:** heavy tools run in one **`atlas-tools` Docker image**. The host needs only Node 22 and Docker.
- **D3, default set:** a bare `atlas:up` builds **everything**, DEM and contours included. `--except dem` is the opt-out.
- **D4, versioning core:** it moves to a new **`packages/versioning`**, which both `apps/api` and `packages/atlas-data` import.

---

## §1 Actors

| Actor | Wants |
|---|---|
| **New developer** | A working atlas from a fresh clone, without reading nine runbooks. |
| **Maintainer** | To refresh one dataset, add a new one, and know what state the machine is in. |
| **Steward** | Edits made in the app are never silently hidden by a reload. |
| **Existing machine** (this one) | Adopting the registry must not re-run hours of work that is already done, and must not duplicate versions. |
| **Test suites** | Data present in the dev database, without growing it on every run. |

## §2 Use cases

| # | Use case | Today | After |
|---|---|---|---|
| UC-1 | **Fresh clone → working atlas** | 9 runbook steps, a Python geo stack, a manual 684 MB download, the right order learned from prose | `npm install && npm run atlas:up`, then `create-admin` |
| UC-2 | **Resume after an interruption** (network drop, laptop sleep, Ctrl-C) | Re-run the step and hope it is idempotent; partial downloads are indistinguishable from complete ones | Re-run `atlas:up`. Completed stages are skipped, and a partial download is never trusted. |
| UC-3 | **Skip the heavy part** | Skip runbook steps 7–8 by hand | `atlas:up --except dem` drops contours too, and says so. Later, `atlas:build --only dem`. |
| UC-4 | **What state am I in?** | Discover it through an empty layer or a grey tile | `atlas:status`: each dataset's stages as ok / stale / missing / failed, with the reason |
| UC-5 | **Does it actually work?** | Open the map and look | `atlas:verify` probes layers, feature counts and lineage the way a browser would |
| UC-6 | **Refresh a dataset** (new OSM extract) | Re-run the basemap loader, remember `reference:build`, then publish | Bump the pinned extract's date and `sha256` in `descriptors/basemap.ts` (C-10), then `atlas:build`. The changed descriptor makes the basemap stale; the reference entities and the publish stage are rebuilt because they are downstream. |
| UC-7 | **A seed file changed** (e.g. the dams GeoJSON) | `npm run seed` reloads all seven layers, one new version each | The build sees the content change and loads a new version of that one layer only |
| UC-8 | **Steward edits exist on a layer being reloaded** | Silently hidden by the new ingest version | The build refuses, naming the layer; `--supersede-edits <id>` proceeds deliberately |
| UC-9 | **Add a thematic dataset** | Seed registry entry, publish script entry, runbook prose | One descriptor file: `load-geojson` + `publish-geoserver`, and zero pipeline code |
| UC-10 | **Adopt an already-built machine** | n/a | The first `atlas:build` recognises what is already loaded and records it, rather than re-running the basemap and DEM |
| UC-11 | **Which licence applies?** | Migration comments | `app.dataset_lineage`, with contours resolving to CC BY-NC-SA through `dependsOn dem` |
| UC-12 | **Run the API tests** | Every run appends a new version per layer (1,212 by today), and the budget tests flake | Test setup loads through the content-idempotent path. An unchanged file creates no version. |

## §3 Flows

**F-1 `atlas:up`**

1. **Preflight:** Node version, Docker reachable, free disk space, and `infra/.env` present (created from the example if missing, with local defaults).
2. Bring the stack up (`db`, `geoserver`) and **poll readiness**: the db healthcheck, and the GeoServer REST endpoint answering.
3. Build the `atlas-tools` image. It is cached, so after the first run this is a no-op.
4. `migrate:up`.
5. `atlas:build`, the whole registry by default (D3).
6. `atlas:verify`.
7. Print a summary: built, skipped, failed, blocked, and the next step (`create-admin`, `dev:web`).

**F-2 Building one dataset (the runner)**

1. Skip the dataset if a dependency failed or was excluded, and name why.
2. For each stage: skip when the prior state is `ok` with the same input hash. Otherwise **invalidate downstream state first** (I3), execute, record a process step describing what ran (I4), and record the state.
3. If a stage fails, the rest of this dataset and its dependents are blocked; independent datasets continue.

**F-3 A `run` stage**

The command executes either in the `atlas-tools` container or on the host (Node commands). The container joins the compose network, with database and GeoServer addresses set for inside the network. Output streams live with a `[dataset]` prefix. A non-zero exit fails the stage.

**F-4 A versioned `load-geojson` stage**

1. Hash the file content.
2. If an ingest version with that `source` (`<file>@sha256:<hex>`) is the active version or the root of the active edit chain, **re-stamp** the active chain in place and create nothing (C-5, §11).
3. Otherwise, if the active version is a steward edit, **refuse** unless `--supersede-edits`.
4. Otherwise create a version, load, activate (hierarchy and stamping included), and set `feature_count`, all in one transaction.

---

## §4 Requirements

**Functional**

- **FR-1:** `atlas:up` is the single onboarding command and runs F-1. It is idempotent and never runs `down` or removes a volume.
- **FR-2:** Every runbook step is a registered dataset or a step of `atlas:up`:

  | Runbook step | Becomes |
  |---|---|
  | 1 stack | `atlas:up` |
  | 2 migrate | `atlas:up` |
  | 3 seeds | `seeds` in steps 3–4, then `admin_boundaries` + seven layers in step 5 |
  | 4 rivers | `rivers` |
  | 5 basemap | `basemap` |
  | 6 reference | `reference_entities` |
  | 7 DEM | `dem` |
  | 8 contours | `contours` |
  | 9 publish | per-layer `publish-geoserver` stages, each ensuring the workspace and datastore (§8) |

- **FR-3 (I3):** Executing a stage invalidates its later stages and every transitive dependent's state **before** it runs, across the whole registry, not only the selected set. `--force <ids>` exists.
- **FR-4 (I4):** Every process step records `stage <key> · <12-char input hash> · <summary>`, capped at 200 characters. A downloaded or loaded file's content hash appears in its summary.
- **FR-5:** `run` stages execute (F-3). An overdue `promoteBy` fails the build (existing).
- **FR-6:** `publish-geoserver` publishes one layer idempotently, repointing rather than recreating so styles survive. Any non-2xx response fails the stage.
- **FR-7:** `load-geojson` has versioned (F-4) and non-versioned modes. Non-versioned mode replaces the table's content in one transaction; it is used for admin boundaries.
- **FR-8:** Ordering rules become `dependsOn`, not prose:
  - every water layer depends on `admin_boundaries`, because stamping needs them;
  - `reference_entities` depends on `basemap`;
  - `contours` depends on `dem`;
  - publish stages follow their data.
- **FR-9:** `apps/api/scripts` moves into `packages/atlas-data`, leaving `apps/api` holding only the server, its migrations and its tests.
- **FR-10:** The versioning core moves to `packages/versioning` (D4). This covers `createIngestVersion`, the feature loading, `activate` with hierarchy and stamping, and the attribute mappings (INV-4 puts those in `packages/shared`).
- **FR-11:** Seed data moves to `packages/atlas-data/data/seeds/`, including `thuydienvietnam.geojson` out of `apps/web/public`.
- **FR-12:** `atlas:status` reports declared state; `atlas:verify` reports observed behaviour (base spec §4). Every dataset has a lineage row.
- **FR-13:** Adoption (UC-10). A dataset may declare a **probe**, a cheap read-only check of what it produces. `atlas:adopt` records every probed-and-passing stage as `ok`, **without running it**, and says which it adopted.

**Non-functional**

- **NFR-1:** Host prerequisites are Node 22, npm 10, Docker and git. No Python, GDAL or bash on the host.
- **NFR-2:** Works from Windows (PowerShell or Git Bash), macOS and Linux. The runner never shells through `bash` on the host.
- **NFR-3:** Non-destructive. Database stages are transactional and leave the previous good state on failure. No command deletes a volume.
- **NFR-4:** Legible progress. Each stage prints start, elapsed time and outcome. Stages longer than 30 s print a heartbeat. The final summary lists every dataset.
- **NFR-5:** First full build time is measured and documented. Downloads are about 1.2 GB (basemap 684 MB, DEM tiles 512 MB), and disk needs are stated in preflight.
- **NFR-6:** Licences are preserved: FABDEM CC BY-NC-SA (non-commercial), OSM ODbL, dams CC BY-SA 4.0, and the five synthetic layers labelled as synthetic.
- **NFR-7:** Each step (2, 3, 4, 5) ships independently, and the old commands keep working until the step that replaces them.
- **NFR-8:** Database-backed tests are gated on `DATABASE_URL` and must be shown to execute, not skip.

---

## §5 Consistency pass

| # | Finding | Proposed resolution |
|---|---|---|
| C-1 | **Adopting this machine.** Its basemap, DEM and contours are loaded, but `app.dataset_stage_state` has no rows. The first `atlas:build` would re-run hours of work, and every seed layer would get a new version (legacy `source` strings do not match `file@sha256`). | FR-13 probes plus `atlas:adopt` (§9). Seed layers declare a `legacySource`. Adoption relabels a matching active ingest version whose feature count equals the file's (§11). Otherwise the layer takes one new version, as the stale Plan 2 design accepted. |
| C-2 | **Admin boundary files are served by the web app** (`provinces-34.geojson`, `wards-region.geojson` in `apps/web/public`, loaded by `MapModel`). Moving them breaks the map, and copying them creates two sources. | Keep them in `apps/web/public` for now. The `admin_boundaries` descriptor reads them from there, with a comment naming the boundary exception. Move them when the map reads boundaries from GeoServer or the API, which is a separate change. Only `thuydienvietnam.geojson`, **unused by the web app**, moves. |
| C-3 | **Runbook step 9 is monolithic.** `publish.ts` creates the workspace and datastore, then publishes every water layer. | Per-layer `publish-geoserver` stages reuse `publish.ts`'s logic, and each ensures the workspace and datastore idempotently, so no separate workspace dataset is needed (§8). Basemap and contour publishing (SLD upload, GWC truncation) stay inside their `run` stages until sub-project D. |
| C-4 | **The stale Plan 2 `rivers_overview` descriptor** refreshes a materialised view that no longer exists. | Dropped. `rivers` publishes `rivers_detail` / `rivers_overview` as the current `publish.ts` does. |
| C-5 | **Boundaries change → stamps go stale.** Every water layer depends on `admin_boundaries` (FR-8), so a boundary reload invalidates them. But a content-idempotent load finds its version already there and would do nothing, leaving stamps against the old boundaries. | The idempotent path **re-stamps** the active chain in place (the existing `stampAdminCodes`) rather than re-activating. It never activates, so it can never hide steward edits. |
| C-6 | **Rivers load two files into one version**, which the one-file `load-geojson` cannot express. | `load-geojson` takes `files: [{ file, columns }]`, all loaded into one version, and the content hash covers every file. Rivers needs no special stage type. |
| C-7 | **Test suites write to the dev database** through `runSeeds`, which is where the 1,212 versions came from. | After step 5, test setup calls the versioned load. An unchanged file creates no version (UC-12). The flaky wall-clock tests are a separate fix, out of scope. |
| C-8 | **`create-admin` needs a secret.** | Not a stage. `atlas:up` ends by printing the command. |
| C-9 | **Descriptor id `hydrorivers` vs layer key `rivers`.** | Renamed to `rivers`. Its state rows are dev-only, and adoption re-records them. |
| C-10 | **The Geofabrik `latest` extract changes daily.** A pinned `sha256` would break every day; unpinned never refreshes. | **Amended 2026-09-30 (Task 12): pinned.** The descriptor fetches one dated extract (`vietnam-YYMMDD-free.shp.zip`) with its `sha256`, so every clone gets identical data. Unpinned `latest` was the first resolution, but on 2026-09-30 every `*-latest*` alias on download.geofabrik.de 301-looped to itself and failed the fresh-clone acceptance. Geofabrik also prunes dated files (dailies after about a week, first-of-month files after about three months; the 1 January files stay), so the pin is always a first-of-month file (user decision 2026-10-04; a descriptor test enforces it). Refreshing, or replacing a pruned file that now 404s, is a deliberate bump of the date and `sha256` in `descriptors/basemap.ts` followed by `atlas:build`; `--force basemap` reuses the cached pinned file (§8) and reloads it. |
| C-11 | **Addresses differ inside and outside the container.** `DATABASE_URL` names `localhost:5432` on the host and `db:5432` in the network. | The runner derives the in-network URLs from the compose service names. `run` stages read `DATABASE_URL` / `GEOSERVER_URL` from the environment the runner sets. |
| C-12 | **CI** (base spec §4: `atlas:build --except basemap,dem`, the `materialised()` helper) | Parked with CI/CD by the user's roadmap. Out of scope, but nothing here blocks it. |

## §6 Developer-experience pass

| # | Finding | Resolution |
|---|---|---|
| U-1 | A multi-hour first run with no sense of progress looks hung. | NFR-4 heartbeats, and a preflight that states the expected downloads and duration before starting. |
| U-2 | `--except dem` silently dropping contours is surprising. | The summary names what was excluded **and why** ("contours: excluded — depends on dem"). |
| U-3 | An error deep in a Python script is unreadable out of context. | The stage failure message names the dataset, the stage, the command, the last 20 lines of its output, and the command to re-run just that dataset. |
| U-4 | "Is it done?" is ambiguous after a partial run. | `atlas:status` groups by ok / stale / missing / failed, and ends with one suggested next command. |
| U-5 | Readers of the README are sent to nine runbooks. | README Getting started becomes: prerequisites, `npm install`, `atlas:up`, `create-admin`, `dev`. The per-dataset runbooks stay as references for *what each dataset is*, not *how to build it*. |
| U-6 | Docker Desktop not running is the most likely first failure on Windows. | Preflight detects it and says exactly that, before anything else runs. |
| U-7 | Disk exhaustion mid-DEM is costly. | Preflight checks free space against the documented total and refuses below it, with the number. |

---

# Part 2 — Design

## §7 Architecture and packages

```
apps/web            ──► packages/shared
apps/api            ──► packages/versioning ──► packages/shared
packages/atlas-data ──► packages/versioning ──► packages/shared
```

Dependencies point one way. No package imports an app.

### `packages/versioning` (new, D4)

It takes over the core that lives in `apps/api` today. That core already depends only on `pg`, `@webatlas/shared` and two error classes.

| Export | From |
|---|---|
| `versionsService(pool)`: `createIngestVersion`, `activate`, `openEditDraft`, `commitEditDraft`, `discardEditDraft` | `apps/api/src/modules/versions/service.ts` + `repository.ts` |
| `stampAdminCodes` | `apps/api/src/db/adminStamp.ts` |
| `buildRiverHierarchy`, `materialiseResolved` | `apps/api/src/db/riverHierarchy.ts` |
| `assertRiverGates`, `RIVER_BASELINE` | `apps/api/src/db/riverGates.ts` |
| `loadFeatures(client, spec, versionId)` | `loadLayerFeatures` in `apps/api/src/db/seeds/run.ts` |
| `ConflictError`, `NotFoundError` | new base classes. `apps/api/src/errors.ts` extends them, so its HTTP mapping is unchanged. |

The attribute mappings (`columns` functions) and `assignDamStatus` move to `packages/shared` (INV-4). `apps/api` imports all of the above through the package, so nothing is duplicated during the transition.

**Amended 2026-10-04 (Plan C-1).** The API's error classes do not extend the package's. The package throws its own HTTP-free `NotFoundError` and `ConflictError`, and the API's error handler maps them to 404 and 409 (`apps/api/src/plugins/errorHandler.ts`), which keeps every response the same without a class hierarchy across the package boundary.

### `packages/atlas-data` layout

```
src/               runner, stages/{sql,run,fetch-http,publish-geoserver,load-geojson}, cli/, descriptors/
tools/             everything from apps/api/scripts: basemap/, contours/, lib/, prep_dem.py, load-dem.sh,
                   and the seed-preparation scripts (build-osm-seeds.mjs, fetch-osm-waterways.mjs,
                   prep_hydrosheds.py, fetch-boundaries.mjs, …), which regenerate committed seeds and are not stages
tools/Dockerfile   the atlas-tools image (replaces raster-tools.Dockerfile)
data/seeds/        committed seed GeoJSON (step 5)
data/cache/        git-ignored downloads and intermediates: basemap zip, DEM tiles and clips
```

### The `atlas-tools` image (D2)

- **Contents:** based on the official GDAL image. It adds the Python packages the scripts import (`geopandas`, `shapely`, `pyproj`, `psycopg2-binary`, `geoalchemy2`, `rasterio`, `requests`) and `raster2pgsql`.
- **Compose:** declared in `infra/docker-compose.yml` as a `tools` service under the compose profile `tools`, so plain `docker compose up` never builds or starts it.
- **How a stage uses it:** `run` stages execute `docker compose --profile tools run --rm tools <argv>`. `packages/atlas-data/tools` and `data/` are mounted, and the container joins the compose network with `DATABASE_URL` / `GEOSERVER_URL` pointing at `db:5432` / `geoserver:8080` (C-11).

### Where a `run` stage executes

| `in:` | For | How |
|---|---|---|
| `'tools'` | Python, GDAL and bash scripts | inside the container, as above |
| `'host'` | Node commands (`reference:build`, `contours:generate`, the existing seed commands) | `child_process.spawn('npm', argv)` with `shell: false`. No host shell is ever involved (NFR-2). |

The stage type becomes `{ type: 'run'; in: 'host' | 'tools'; argv: string[]; produces; promoteTo; promoteBy }`. It holds an argument vector, not a command string, so nothing is ever re-parsed by a shell.

### `apps/api` afterwards

It holds the server, its migrations and its tests. `db/seeds/`, `ingestRivers.ts`, `geoserver/publish.ts` and `scripts/` are gone by the end of step 5. During steps 2–4 the old commands keep working (NFR-7).

## §8 Runner and stages

### Cascade (I3, FR-3)

- **When:** immediately before stage *i* of dataset *d* executes, and never on a skip.
- **What:** one statement deletes the stage state of *d*'s later stages and of every stage of every **transitive dependent** of *d*.
- **Why before, not after:** a crash can then only leave downstream stages `missing`, never falsely `ok`.
- **Scope:** dependents are computed over the **whole registry**, not only the selected set, so a dependent excluded by `--except` is still invalidated and reports `missing`.
- **If invalidation fails,** the stage does not execute.

`runBuild(pool, datasets, { universe?, force?, supersedeEdits? })`.

**`--force <ids>`:**
- Every stage of a forced dataset executes regardless of the skip rule, and the cascade applies.
- It uses the same fail-closed parsing as `--only`/`--except`: space or `=` form, comma-separated, and an error for an unknown id, a missing value or a repeated flag.
- A forced id must be in the selected set.

The *rejected alternative* (tracking output identity) stays rejected, for the reason the stale Plan 2 design gave.

### Process-step detail (I4, FR-4)

`processStepDescription(key, stage, inputHash)` returns `{ description, tool }`:
- `description` is `stage <key> · <first 12 of input hash> · <summary>`, with whitespace collapsed and a 200-character cap that ends in `…`.
- `tool` is the stage type, or the joined argv for `run`.

| Type | Summary |
|---|---|
| `sql` | the statement |
| `run` | the argv, joined |
| `fetch-http` | the URL and the fetched file's sha256 |
| `load-geojson` | `<files> → <layer>`, with the content hash |
| `publish-geoserver` | the layer |

The summary depends on the fetched or loaded content, so it is computed **after** execution. The executor returns it.

### Executors

- **`run`:**
  - Spawns per §7.
  - Streams stdout and stderr line by line with a `[<dataset>]` prefix, and prints a heartbeat every 30 s of silence.
  - A non-zero exit fails the stage. The error carries the last 20 output lines and the command that re-runs this dataset alone (`npm run atlas:build -- --only <id>`). `--only <id>` retries the failed stage and the stages after it that never ran; datasets that depend on `<id>` stay `missing` until a full `atlas:build`. `--force` would also redo completed stages, including downloads.
- **`fetch-http`:**
  - Downloads into `data/cache/<into>`, with the path validated to stay beneath `data/cache`. It writes `<into>.part` and renames on completion, so an interrupted download is never taken for a finished one.
  - When a `sha256` is declared, a mismatch fails the stage **before** the rename and leaves the previous file untouched.
  - Otherwise the fetched hash is only recorded. (The basemap extract is pinned, C-10; no registered source is unpinned today.)
  - If the target already exists and `sha256` matches (or none is declared), the stage succeeds without downloading. Refreshing an unpinned source takes `--force`.
  - A file that matches its declared `sha256` is reused **even when the dataset is forced**: a pinned, matching file cannot be stale, so forcing re-runs only the later stages. The log says `… matches its pin; reused although forced`, and the summary keeps `(reused)`. (Amended 2026-09-30, Task 12: forcing the pinned basemap re-downloaded the 720 MB already in the cache.)
- **`publish-geoserver { layer, nativeName?, style? }`:**
  - The logic of `apps/api/src/geoserver/publish.ts`: it ensures the workspace and datastore, then creates or repoints the layer with `PUT`, so styling survives.
  - Every REST call fails the stage on a non-2xx response.
- **`load-geojson`:** §11.

**Registry validation** rejects, at load time:
- any stage type with no registered executor;
- a `run` stage with an empty `argv`;
- a path escaping `data/`;
- a `dependsOn` on an unknown id (existing);
- an overdue `promoteBy` (existing).

## §9 Probes, adoption, and the commands

### Probes (FR-13)

Each dataset may declare `probe(ctx): Promise<{ ok: boolean; detail: string }>`, a cheap read-only check of what the dataset produces. `ctx` offers the pool and a GeoServer `fetch`. One definition of "built" serves both adoption and verification.

| Dataset | Probe |
|---|---|
| `basemap` | Each of the eight `basemap.*` tables the loader writes has rows, and each of the five layer groups the web app requests (`basemap`, `bm_landuse`, `bm_water`, `bm_railways`, `basemap_roads`) answers a WMS GetMap (amended 2026-10-04, final review) |
| `reference_entities` | `basemap.reference_entities` has rows for each of the five layers |
| `dem` | `ST_Value` at Buôn Ma Thuột (108.0447, 12.6797) is between 440 and 500 m |
| `contours` | `basemap.contours` has rows for each published interval, and its layer answers |
| each water layer / `rivers` | the active version exists with `feature_count > 0` and its layer answers WFS; for `rivers`, the hierarchy dry run (what `rivers:hierarchy` prints) reports 0 rows would change |

### Commands (all in `packages/atlas-data/src/cli`, exposed at the repo root)

| Command | Does |
|---|---|
| `atlas:up [--compose <file>] [--only/--except …]` | F-1: preflight → stack → tools image → `migrate:up` → build → verify → summary. Never runs `down`. |
| `atlas:build [--only/--except/--force/--supersede-edits]` | Build the selection (F-2) |
| `atlas:status` | Stages grouped ok / stale / missing / failed, each with its reason; ends with one suggested command (U-4) |
| `atlas:verify` | Every stage ok; every probe passes; every published layer answers a real WMS or WFS request; every dataset has a lineage row with a licence |
| `atlas:adopt` | Runs each probe. For a passing dataset with no state, it records every stage `ok` at its current hash and appends one process step, `adopted: <probe detail>`. It never executes a stage. |

**Amended 2026-10-04 (deferred list).**

- `atlas:build` takes `--compose` too. `atlas:status`, `atlas:verify` and `atlas:adopt` never start a container; given the flag they say it has no effect there.
- One build per database: `atlas:build`, `atlas:up` and `atlas:adopt` hold a PostgreSQL advisory lock while they write build state, and a second one stops at once.
- `atlas:up` refuses when the compose project's containers were created from another checkout's compose file (a second clone keeps the project name), unless `ATLAS_SHARED_STACK=1`.
- `fetch-http` takes `supersedes`: an anchored pattern of earlier downloads in the target's directory, removed once the new file is in place and verified. It is not part of the stage hash.
- The stage hash plan hashes a missing `load-geojson` file as `missing`, so one absent file makes one stage stale instead of stopping every command.

### Preflight (U-6, U-7)

- Node ≥ 22.
- `docker info` succeeds. If it fails: "Docker is not running — start Docker Desktop".
- `docker compose version` is v2.
- `infra/.env` exists; if missing it is created from `infra/.env.example`, and preflight says so.
- At least 6 GB free on the drive holding `data/cache`.
- The expected downloads (about 1.2 GB) and the measured first-build duration (§12) are printed before anything starts (U-1).

### Readiness

- **db:** the compose healthcheck reports healthy.
- **geoserver:** `GET /geoserver/rest/about/version.json` returns 200 with the admin credentials. Polled every 2 s for up to 180 s.

### Summary

Every dataset with its outcome. Excluded datasets are listed with their cause ("contours: excluded — depends on dem", U-2). The last line is the next step, `npm run create-admin -w @webatlas/api -- …` (C-8).

## §10 The dataset graph

### After steps 3–4 (wrapping today's commands)

| Dataset | Stages | `dependsOn` | Licence |
|---|---|---|---|
| `seeds` | run host `npm run seed -w @webatlas/api` → publish ×7 | — | per the licence table (§11) |
| `rivers` (renamed from `hydrorivers`, C-9) | run host `npm run ingest:rivers -w @webatlas/api` → publish `rivers` | `seeds` | ODbL-1.0 |
| `basemap` | fetch-http Geofabrik `vietnam-YYMMDD-free.shp.zip`, pinned by `sha256` (C-10) → run tools `load_basemap.py` → run tools `styles.py` + `publish-basemap.sh` | — | ODbL-1.0 |
| `reference_entities` | run host `npm run reference:build -w @webatlas/api` | `basemap` | ODbL-1.0 (inherited) |
| `dem` | run tools `prep_dem.py --mainland` → run tools `load-dem.sh` | — | CC-BY-NC-SA-4.0 |
| `contours` | run host `npm run contours:generate -w @webatlas/api` → run tools `styles.py` + `publish-contours.sh` | `dem` | CC-BY-NC-SA-4.0 (inherited) |

- Every `run` stage carries `promoteTo` and a `promoteBy`. The raster ones point at sub-project C, and the Node ones at step 5 or a built-in.
- The `demo` dataset stays as the registry's synthetic fixture.

### After step 5

- `seeds` is replaced by `admin_boundaries` (non-versioned) plus `dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation` and `lakes`. Each of these is one `load-geojson` + one `publish-geoserver`, and each depends on `admin_boundaries`.
- `rivers` becomes `load-geojson` (two files) + publish, depending on `admin_boundaries`.

## §11 `load-geojson` (step 5)

```ts
{ type: 'load-geojson', layer: EditableLayerKey | 'admin', versioned: boolean,
  files: Array<{ file: string; columns: ColumnMap; target?: string; multiLine?: boolean }>,
  legacySource?: string }
```

**Paths and hashing**
- `file` resolves beneath `packages/atlas-data/data/`. The stage's input hash includes each file's sha256, so editing a file makes the stage stale, and touching it without changing content does not.
- The version `source` is `<file names joined by +>@sha256:<sha256 of the concatenated file hashes>`.

**Versioned mode** runs in one transaction on one client (`BEGIN`…`COMMIT`), through `packages/versioning`.

| Situation | Action |
|---|---|
| An ingest version with this `source` exists **and** is the active version or the root of the active edit chain | **Re-stamp** every version in the active chain with `stampAdminCodes` (C-5). Create nothing, activate nothing. |
| An ingest version with this `source` exists but is not in the active chain | Treated as new content (the next rows) |
| New content, and the active version has `kind = 'edit'`, and the layer is not in `--supersede-edits` | **Fail:** `<layer> has steward edits on top of its last load; loading new content would hide them. Re-run with --supersede-edits <layer> to proceed.` |
| Otherwise | `createIngestVersion` → `loadFeatures` for each file → `activate` (hierarchy, gates and stamping for `rivers`) → set `feature_count` |

`--supersede-edits <ids>` is parsed fail-closed and is deliberately separate from `--force`: a precautionary rebuild must never be able to hide someone's edits. A superseded id must be in the selected set. Replaying edits onto new data is out of scope; the guard is the safety net until then.

**Non-versioned mode** (`admin_boundaries`): `DELETE` then load `admin.provinces` / `admin.wards` in one transaction. Because every water layer depends on it, a boundary change cascades to every layer's re-stamp path.

**Adoption** (C-1): if a layer's active version is an ingest version whose `source` equals the descriptor's `legacySource` **and** whose `feature_count` equals the file's feature count, `atlas:adopt` rewrites its `source` to the hashed form. Otherwise the first build loads one new version, and the edit guard still applies.

**Amended 2026-10-04 (Plan C review).** Four things differ from the text above.

- **A version is its content and its mapping.** The stage takes `mappingRevision?: number` (1 when omitted) and a file takes `multiPolygon?: boolean` and `root?: 'data' | 'repo'`. The loader records `source_version = 'mapping-<n>'`, and "an ingest version with this `source` exists" in the table reads "with this `source` and this `source_version`". Without it, a changed `columns` function re-ran the stage, found the bytes unchanged, re-stamped, and reported success with the old columns still in the table. A person decides when a mapping change is a new revision; a test pins the mapping code and each stage's flags so the change cannot pass unnoticed.
- **The load locks the layer.** Its first statement is `SELECT … FROM app.dataset_versions WHERE layer_key = $1 FOR UPDATE`, held to the end of the transaction. Committing an edit needs one of those rows, so an edit cannot be committed between the guard's check and the activation that would hide it.
- **The build adopts too.** Adoption is the first thing the versioned load tries, not only `atlas:adopt`: a machine that never ran `atlas:adopt` gets its existing version re-labelled and re-stamped, with the edits on top of it left active, instead of a second copy. Adoption compares the row count of the root version (for `rivers`, the rows the files supplied, not the derived hierarchy), not `feature_count`, and applies to the root of the active chain, not only to an active ingest version. It also labels a version loaded before `source_version` was recorded. Neither is done once the stage is past its first mapping revision: nobody can say which mapping an unlabelled version used, except that it was the first.
- **The load analyses what it filled.** `ANALYZE water.<layer>` after activation, and both boundary tables after a replacement, in the same transaction. Autovacuum reaches a new table about a minute later; until then the planner has no statistics, which made one query over freshly loaded rivers take 72 s instead of 11 s.
- **Tracked datasets.** `atlas:adopt` also re-labels the version of a dataset that already has build state when its load stage is new to that state (`rivers` on a machine built before step 5).

### Data relocation (FR-11, C-2)

- Every file in `apps/api/src/db/seeds/data/` moves to `packages/atlas-data/data/seeds/`.
- `thuydienvietnam.geojson` moves from `apps/web/public` and is renamed `dams.geojson`. The web app does not load it.
- `provinces-34.geojson` and `wards-region.geojson` **stay** in `apps/web/public`, because the map loads them. `admin_boundaries` reads them there, with a comment recording the exception and its exit, which is the map reading boundaries from GeoServer or the API.

### Licences (carried over from the stale Plan 2 design)

| Dataset | Licence | Lineage |
|---|---|---|
| `dams` | CC-BY-SA-4.0 | Open Development Vietnam, *Hydropower plants in Vietnam by October 2020*, clipped to the working region; `https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020` |
| `lakes`, `rivers` | ODbL-1.0 | OpenStreetMap contributors (and HydroSHEDS HydroRIVERS, CC-BY-4.0, for rivers), clipped to the working region |
| `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation` | LicenseRef-webatlas-synthetic | **Synthetic demonstration data** from the original prototype, not measurements |
| `admin_boundaries` | MIT | `thanglequoc/vietnamese-provinces-database` (MIT), from NXB Tài nguyên – Môi trường và Bản đồ data, after the 2025-07-01 reorganisation; simplified by `fetch-boundaries.mjs` |

`layer_dams` joins `LEGEND_ATTRIBUTION` in `packages/shared/src/legend.ts`: *Hydropower plants in Vietnam by October 2020 — Open Development Vietnam, CC BY-SA 4.0*, and it is tested against rendered legend output.

### Test setup (C-7, UC-12)

The API suites stop calling `runSeeds`. A test helper `ensureSeeded(layers)` runs the versioned load for the layers a suite needs. An unchanged file creates no version, so repeated test runs stop growing `app.dataset_versions`.

**Amended 2026-10-04 (Plan C-3).** The helper takes no layer list and runs once per test run, from a Vitest global setup: nearly every API suite reads the seeded layers and none declared it. Before loading anything it re-labels a version the old command loaded, so switching a machine over creates no versions. CI, which this design had parked, runs the same function through a command, `npm run atlas:seed`, because the `packages/versioning` suite needs seeded data and cannot import `atlas-data`. Neither records build state nor calls GeoServer.

### Old commands

- At the end of step 5, `npm run seed`, `ingest:rivers` and `publish:geoserver` (and their root aliases) are removed. The docs point at `atlas:*`.
- `rivers:hierarchy`, the read-only check, stays.

## §12 Error handling and testing

**Failure isolation** is unchanged from Plan 1: a failed stage blocks its own dataset and its dependents, independent datasets continue, and the command exits non-zero with the summary. Ctrl-C leaves the executing stage without an `ok` state, so the next run redoes it.

**Tests**

- **Database:** tests are gated on `DATABASE_URL` and must be shown to execute, not skip. They use `__atlasdata_test__*` layers, never real ones.
  - **Amended 2026-10-04 (Plan C-2).** The `load-geojson`, adoption and `ensureSeeded` tests run on the real layers: a layer key is a CHECK-constrained set and each has its own table, so there is no test layer to load into. Each test runs in a transaction that is always rolled back, and the suite's own assertion is that the version count is the same after as before. CI runs every `*.db.test.ts` of the package in the `api` job, which has the database.
- **Cascade:** a synthetic two-dataset graph shaped like DEM → contours.
  - Forcing the upstream re-runs its later stages and its dependent.
  - A dependent excluded by `--except` is still invalidated.
  - A skip invalidates nothing.
  - If the upstream's second stage fails during a forced run, the dependent's state is gone even though it never ran.
  - An invalidation failure prevents execution.
- **Parsing:** every `--force` and `--supersede-edits` case, including a clash with `--except`.
- **Step detail:** each type's summary, whitespace collapsing, and 200-character truncation.
- **`run`:**
  - `node -e` commands: exit codes, tail capture, and the heartbeat, using fake timers.
  - A test proving `shell: false`: an argv containing `;` / `&&` is passed literally.
  - Tools-container tests gated on Docker being available.
- **`fetch-http`:** against a local `http.createServer`: an interrupted download leaves no file, a `sha256` mismatch keeps the old file, and an existing file skips.
- **`publish-geoserver`:** gated on `GEOSERVER_URL`, like the existing `publish.test.ts`.
- **Probes and adoption:** adoption records state without executing (proved with an executor spy), and a failing probe adopts nothing.
- **`load-geojson`:**
  - content idempotency: an unchanged file creates no version;
  - the re-stamp path;
  - the edit guard, with a real `kind = 'edit'` version;
  - `--supersede-edits`;
  - the two-file rivers load, including gates;
  - non-versioned replacement.
- **Versioning package:** the existing versions, hierarchy and stamping tests move with the code and must pass unchanged.
- **Acceptance** (the real onboarding proof):
  - `atlas:up` from nothing in a **throwaway compose project** on this machine: its own project name, ports and volumes, run from a clean clone.
  - It must end with `atlas:verify` all green.
  - The measured duration is recorded in the README (NFR-5).
  - It runs at the end of Plan B and again at the end of Plan C.

## §13 Carried over from the stale Plan 2 design

Kept as written there:
- the cascade rule and its rejected alternative;
- the process-step format;
- `fetch-http`'s atomic rename and `sha256` behaviour;
- `publish-geoserver`'s repoint-with-`PUT` and non-2xx failure;
- the edit guard, `--supersede-edits` and its separation from `--force`;
- the dams provenance and licence table;
- the dams legend attribution.

Changed here:
- **order:** `run` and `publish-geoserver` now come before `load-geojson`;
- **`rivers_overview` descriptor:** dropped (C-4);
- **rivers:** two files, one version (C-6);
- **re-stamp path:** new (C-5);
- **non-versioned mode:** new, for `admin_boundaries`;
- **package boundary:** new (D4);
- **run stages:** in the tools container (D2).

## §14 Delivery

Three plans, each leaving `main` working (NFR-7):

| Plan | Base spec step | Contents | Done when |
|---|---|---|---|
| **A** | 2 | Cascade and `--force`; process-step detail; `run` (host and tools), `fetch-http` and `publish-geoserver` executors; registry validation; `hydrorivers` → `rivers` | `atlas:build --only rivers` executes for real, and `atlas:status` shows it `ok` |
| **B** | 3–4 | `atlas-tools` image; `apps/api/scripts` → `packages/atlas-data/tools`; the §10 step-3–4 descriptors with probes; `atlas:adopt`, `atlas:status` and `atlas:verify`; `atlas:up` with preflight and readiness; README and runbook rewrite (U-5) | This machine adopts cleanly, and the fresh-clone acceptance passes |
| **C** | 5 | `packages/versioning`; mappings to shared; `load-geojson`; `admin_boundaries`, the seven layers and rivers; data relocation; dams attribution; `ensureSeeded`; removal of the old commands | The acceptance passes again, and a second API test run adds no versions |

## Out of scope

| Item | Where it goes |
|---|---|
| Sub-project C (raster out of PostGIS) and D (SLD from shared tokens) | After this track (D1) |
| Deployment (`feat/deploy-cicd`, on-prem) | After this track |
| CI wiring, the `materialised()` test helper | CI/CD, parked by the roadmap |
| The flaky wall-clock API tests | A separate small fix |
| Replaying steward edits onto newly loaded data | Its own future workflow; replaces the edit guard |
| Output-identity rebuild precision | Rejected (§8) |
| Moving the admin boundary files out of `apps/web/public` | When the map stops loading them statically (C-2) |
