# Repository Re-documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drifted `README.md` with an accurate, verified documentation set — a lean README, an architecture document, three data-regeneration runbooks, a status index of all historical specs/plans, and a `CLAUDE.md` for agent sessions.

**Architecture:** Verification-first. Task 1 executes every read-only command and records the actual output to a facts file; every later task consumes recorded facts rather than re-deriving or assuming them. Documents are written innermost-first (runbooks, architecture, index) so that the README — written last — links only to files that already exist.

**Tech Stack:** Markdown. No code changes. Verification uses the repo's existing npm scripts, `curl`, `docker compose`, and `git`.

**Spec:** [2026-09-07-repo-redocumentation-design.md](../specs/2026-09-07-repo-redocumentation-design.md)

## Global Constraints

- **Language: English** for every new or rewritten document. Vietnamese content moved out of the README is translated, not copied.
- **Commit messages: Vietnamese**, matching repo convention (see `git log`). Every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Documentation describes branch `feat/region-scoping-osm-water`, not `main`.** The branch is 46 commits ahead. The README status section must say so explicitly.
- **No code changes.** Bugs found during verification are recorded in the facts file and reported at the end — not fixed.
- **No deployment/production documentation.** No Dockerfile or deploy config exists in this repo.
- **No edits to the 34 historical specs/plans**, except `docs/superpowers/specs/2026-07-15-product-roadmap.md` §1 (Task 9).
- **Never execute these** — they mutate the dev database or call external APIs: `npm run seed`, `npm run ingest:rivers`, `npm run publish:geoserver`, `npm run migrate`, `apps/api/scripts/fetch-osm-waterways.mjs`, `fetch-boundaries.mjs`, `build-osm-seeds.mjs`, `clip-to-region.mjs`, `prune-hydrosheds-versions.mjs`. Document them from source.
- **Editable layer count is 8**, not 7: `dams, rivers, lakes, stations, flood_zones, drought_points, saltwater_intrusion, flood_generation` (`packages/shared/src/index.ts`).
- **Every architectural claim cites a file path that has been verified to exist.** No claim ships on memory.
- **Facts file path** (scratchpad, never committed):
  `C:/Users/quock/AppData/Local/Temp/claude/c--Users-quock-Documents-Projects-webatlas/3e4874e3-7f46-42c6-858d-dda69e197c59/scratchpad/verified-facts.md`

---

### Task 1: Verification sweep

**Files:**
- Create: `<scratchpad>/verified-facts.md` (**not committed** — this task makes no commit)
- Read only: root `package.json`, `infra/docker-compose.yml`, `apps/api/.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a facts file with four named sections that every later task reads —
  `## Commands` (command → exit code → notable output),
  `## Services` (port, health response, WFS status code),
  `## Artifact existence` (path → exists yes/no),
  `## Anomalies` (anything that contradicts existing docs).

- [ ] **Step 1: Confirm the stack is up before measuring anything**

```bash
cd /c/Users/quock/Documents/Projects/webatlas
docker compose -f infra/docker-compose.yml ps --format "table {{.Name}}\t{{.State}}"
```

Expected: both `webatlas-db-1` and `webatlas-geoserver-1` in state `running`. If either is `exited`, start it with `docker compose -f infra/docker-compose.yml up -d` and wait for GeoServer (it needs ~30–60s before WFS answers).

- [ ] **Step 2: Record service health**

```bash
curl -s -m 5 http://localhost:3001/health
curl -s -m 10 -o /dev/null -w "%{http_code}\n" "http://localhost:8080/geoserver/webatlas/ows?service=WFS&version=2.0.0&request=GetCapabilities"
```

Expected: `{"status":"ok"}` and `200`. If the API is not running, start it with `npm run dev -w @webatlas/api` first. Write both results under `## Services` in the facts file.

- [ ] **Step 3: Run the four fast verification commands, recording exit codes**

```bash
npm run build:shared; echo "build:shared exit=$?"
npm run test:shared;  echo "test:shared exit=$?"
npm run lint:web;     echo "lint:web exit=$?"
npm run build:web;    echo "build:web exit=$?"
```

Expected: exit 0 for each. `lint:web` is oxlint and exits 0 even with warnings — record the warning count if non-zero. Write each command, its exit code, and any warning count under `## Commands`.

- [ ] **Step 4: Run the two slow test suites**

```bash
npm run test:web;  echo "test:web exit=$?"
npm run test:api;  echo "test:api exit=$?"
```

Expected: exit 0 for both. `test:web` takes ~60–90s. `test:api` takes 1–2.5 minutes, requires the DB + GeoServer from Step 1, and appends one `dataset_version` row per seeded layer (`apps/api/src/db/seeds/run.ts:71-82` calls `createIngestVersion` then `activate` per layer, with no idempotency guard). Record the test counts reported by each suite — the README will not quote them, but a later drop is a drift signal.

If either fails, record the failure verbatim under `## Anomalies` and **continue the plan** — do not fix code (Global Constraints).

- [ ] **Step 5: Verify every path the architecture document will cite**

```bash
for p in \
  infra/docker-compose.yml \
  infra/postgis/init.sql \
  apps/api/src/server.ts \
  apps/api/src/plugins \
  apps/api/src/modules/auth \
  apps/api/src/modules/users \
  apps/api/src/modules/layers \
  apps/api/src/modules/versions \
  apps/api/src/modules/audit \
  apps/api/src/db/migrations/1000000000004_dataset-versions.cjs \
  apps/api/src/db/migrations/1000000000005_active-version-views.cjs \
  apps/api/src/db/migrations/1000000000006_lakes-schema.cjs \
  apps/web/src/app apps/web/src/pages apps/web/src/widgets \
  apps/web/src/features/map/model \
  apps/web/src/features/shell \
  apps/web/src/features/feature-editing \
  apps/web/src/features/user-management \
  apps/web/src/entities/persona \
  apps/web/src/entities/session \
  apps/web/src/components apps/web/src/data \
  apps/web/scripts/profile-map.mjs \
  packages/shared/src/index.ts \
  packages/shared/src/region.ts \
  packages/shared/src/osm-water.ts \
  packages/shared/src/dam-status.ts \
  .github/workflows/ci.yml \
  ; do [ -e "$p" ] && echo "OK   $p" || echo "MISS $p"; done
```

Expected: every line `OK`. Any `MISS` means the architecture outline must drop or correct that claim — record it under `## Anomalies`. Write the whole output under `## Artifact existence`.

- [ ] **Step 6: Record the two facts the README currently gets wrong**

```bash
grep -c "" README.md
grep -o "'[a-z_]*'," packages/shared/src/index.ts | head -20
grep -n "versions" apps/api/src/server.ts
```

Expected: 259 README lines; 8 layer keys; **no** match for a `versions` route registration in `server.ts` (only `authRoutes`, `usersRoutes`, `layersRoutes` are registered) — this is the "versioning is internal-only" claim. Record all three under `## Anomalies`.

- [ ] **Step 7: No commit**

This task produces a scratchpad file only. Confirm the working tree is still clean:

```bash
git status --short
```

Expected: empty output.

---

### Task 2: Status index — `docs/README.md`

**Files:**
- Create: `docs/README.md`
- Read only: `docs/superpowers/specs/*.md` (16), `docs/superpowers/plans/*.md` (19), `docs/reports/dam-crosscheck.md`

**Interfaces:**
- Consumes: `## Artifact existence` from Task 1.
- Produces: the status verdicts (`Shipped` / `Partial` / `Superseded` / `Living`) that Task 7's README status section and Task 9's roadmap baseline both reuse. Verdict strings must match exactly across all three.

- [ ] **Step 1: Verify each spec's artifacts exist**

Run the existence check for the artifact each spec claims to have produced:

```bash
for p in \
  apps/web/src/features/feature-editing \
  apps/web/src/entities/session \
  apps/web/src/features/auth \
  packages/shared/src/dam-status.ts \
  .github/workflows/ci.yml \
  apps/web/src/features/user-management \
  apps/web/src/pages/admin-users \
  apps/web/src/features/shell \
  apps/web/src/entities/persona \
  apps/web/src/widgets/top-bar \
  apps/api/src/modules/versions \
  apps/api/src/db/seeds/data/hydrolakes-vn.geojson \
  apps/api/src/db/seeds/data/hydrorivers-vn.geojson \
  apps/api/src/db/seeds/data/osm-rivers-region.geojson \
  apps/api/src/db/seeds/data/osm-lakes-region.geojson \
  packages/shared/src/region.ts \
  packages/shared/src/osm-water.ts \
  apps/web/scripts/profile-map.mjs \
  ; do [ -e "$p" ] && echo "OK   $p" || echo "MISS $p"; done
```

Expected: all `OK`. Any `MISS` downgrades that spec's verdict to `Partial` with a note naming the missing artifact.

- [ ] **Step 2: Check the one spec most likely to be `Partial`**

`2026-07-15-role-capability-semantics-design.md` defines `admin | editor | viewer`, but the roadmap records that only `admin` is exercised. Check whether that is still true:

```bash
grep -rn "editor\|viewer" apps/api/src/modules --include=*.ts | grep -v test | head -20
grep -rn "editor\|viewer" apps/web/src --include=*.ts --include=*.tsx | grep -v test | head -20
```

If `editor`/`viewer` appear only in type unions and forbidden-tests, the verdict is `Partial — roles defined and enforced, but only admin grants distinct capability`. If they gate real behaviour, the verdict is `Shipped`. Record which.

- [ ] **Step 3: Write `docs/README.md`**

Structure — an intro, then three tables. Use this exact skeleton, filling verdicts from Steps 1–2:

```markdown
# WebATLAS Documentation

Start at the [root README](../README.md) for what the system is and how to run it.

| I want to… | Read |
|---|---|
| Understand how the system fits together | [architecture.md](architecture.md) |
| Regenerate administrative boundaries | [runbooks/admin-boundaries.md](runbooks/admin-boundaries.md) |
| Regenerate OSM river/lake data | [runbooks/osm-water.md](runbooks/osm-water.md) |
| Understand a legacy HydroSHEDS dataset version | [runbooks/hydrosheds-legacy.md](runbooks/hydrosheds-legacy.md) |
| See why something was built the way it was | The design specs below |

## How to read this index

`superpowers/specs/` holds design documents and `superpowers/plans/` their implementation
plans. They are **written history, preserved as authored** — a spec describes what was
intended on its date, not necessarily what the code does today. This index carries the
current status; the documents themselves are not edited.

Status values: **Shipped** (artifacts exist on this branch) · **Partial** (landed
incompletely — the gap is named) · **Superseded** (replaced by later work) ·
**Living** (maintained, not a one-off).

## Design specs

| Date | Document | Status | Summary |
|---|---|---|---|
| (one row per spec, enumerated below this code block) |

## Implementation plans

| Date | Document | Status | Summary |
|---|---|---|---|
| (one row per plan, enumerated below this code block) |

## Reports

| Date | Document | Summary |
|---|---|---|
| 2026-08-04 | [reports/dam-crosscheck.md](reports/dam-crosscheck.md) | Cross-check of OSM dams against the national catalogue, generated by `apps/api/scripts/report-dam-crosscheck.mjs` |
```

The 16 spec rows, in date order: `2026-07-10-webgis-water-resources-backend-design`, `2026-07-14-admin-editing-draw-create-design`, `2026-07-14-frontend-admin-auth-foundation-design`, `2026-07-15-admin-editing-modify-delete-design`, `2026-07-15-map-perf-and-real-dam-status-design`, `2026-07-15-product-roadmap` (**Living**), `2026-07-15-role-capability-semantics-design`, `2026-07-16-ci-pipeline-design`, `2026-07-16-user-management-ui-design`, `2026-07-17-adaptive-shell-design`, `2026-07-17-shell-layout-restructure-design`, `2026-07-22-map-versioning-foundation-design`, `2026-07-28-hydrosheds-hydrology-data-design` (**Superseded** for the rivers/lakes *source* by `2026-08-04`, but its versioning + lakes schema shipped — say both), `2026-08-04-region-scoping-osm-water-new-boundaries-design`, `2026-08-05-map-performance-design`, `2026-09-07-repo-redocumentation-design` (**this work — in progress**).

The 19 plan rows are the files listed by `ls docs/superpowers/plans/*.md`. Each plan inherits its spec's verdict; `2026-07-10-plan-3b-frontend-mvp-fsd` and `2026-07-10-plan-3-frontend-wfs-swap` both map to the 2026-07-10 backend design. Note in the intro that `baseline-2026-08-05.json` and `result-2026-08-05.json` are measurement data from the map-performance work, not documents.

- [ ] **Step 4: Verify every link in the new file resolves**

```bash
d=docs; grep -oE '\]\([^)]+\)' docs/README.md | sed -E 's/^\]\(//; s/\)$//; s/#.*$//' \
  | grep -vE '^(https?:|mailto:|$)' \
  | while read -r p; do [ -e "$d/$p" ] || echo "BROKEN: $p"; done
```

Expected: no output. The four `runbooks/*` and `architecture.md` links **will** report broken at this point — they are created in Tasks 3–6. Confirm those are the only breaks, then move on; Task 10 re-runs this check when all files exist.

- [ ] **Step 5: Commit**

```bash
git add docs/README.md
git commit -m "docs: chỉ mục trạng thái cho toàn bộ spec và plan" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `docs/architecture.md`

**Files:**
- Create: `docs/architecture.md`
- Read only: every path listed in Task 1 Step 5

**Interfaces:**
- Consumes: `## Artifact existence` and `## Anomalies` from Task 1.
- Produces: the canonical prose for the four-service topology, reused in condensed form by Task 7 (README "Architecture at a glance") and Task 8 (`CLAUDE.md` conventions). The README must not contradict this file.

- [ ] **Step 1: Read the sources before writing each section**

```bash
sed -n '1,40p' apps/api/src/server.ts
ls apps/api/src/plugins apps/api/src/modules
sed -n '1,30p' apps/api/src/db/migrations/1000000000005_active-version-views.cjs
ls apps/web/src apps/web/src/features apps/web/src/entities
sed -n '1,35p' packages/shared/src/region.ts
```

Do not write a section before reading its sources. Every claim needs a file behind it.

- [ ] **Step 2: Write the file, six sections in this order**

1. **Service topology** — PostGIS (`infra/docker-compose.yml`, schemas from `infra/postgis/init.sql`), GeoServer (read-only WFS), Fastify API, React frontend. State the invariant plainly: **the API is the only writer**; GeoServer serves reads; the API — not the frontend — is the security boundary. Public viewer needs only frontend + GeoServer; admin login additionally needs the API.
2. **`apps/web`** — Feature-Sliced Design layers actually present: `app/`, `pages/` (only `admin-users`), `widgets/` (only `top-bar`), `features/` (`map`, `shell`, `auth`, `feature-editing`, `user-management`), `entities/` (`layer`, `persona`, `session`), `shared/`. Name `components/` and `data/` as **pre-FSD holdovers** that predate the 3b refactor. State the MVP rule: OpenLayers is quarantined in `features/map/model/` and the map instance is deliberately not exposed on `window`.
3. **`apps/api`** — plugins (`errorHandler`, `security`, `db`, `authentication`) register before routes; modules `auth`, `users`, `layers`, `versions`, `audit`. Give the route table from `server.ts:28-31`: `/api/auth`, `/api/users`, `/api` (layers), plus `/health` registered inside a child plugin so the rate-limit hook applies to it.
4. **Dataset versioning** — migrations `1000000000004_dataset-versions.cjs` and `1000000000005_active-version-views.cjs`; each ingest creates a version, loads features, records `feature_count`, then flips active inside one transaction per layer (`apps/api/src/db/seeds/run.ts:68-85`). **Call out that `modules/versions/` registers no HTTP routes** — it is internal, consumed by seeds and ingest scripts. This is the single least discoverable fact in the codebase.
5. **Persona and shell model** — roles (`admin | editor | viewer` + anonymous) are the enforced authorization boundary; personas are a UX layer over them (`entities/persona/`). Describe the shell: burger drawer on the left, display panel on the right, top bar above, map always mounted as a sibling of the routed content.
6. **Region scoping and map performance** — `REGION_PROVINCE_CODES` in `packages/shared/src/region.ts` is the single source of truth for the working region (6 provinces, Nam Trung Bộ & Tây Nguyên); data-prep and clip scripts and tests all read it. Then the load strategy: bbox-filtered WFS requests, rivers/lakes gated to zoom ≥ 8.5, ward boundaries to zoom ≥ 10, map opens at the working region. Point at `apps/web/scripts/profile-map.mjs` and `docs/superpowers/plans/baseline-2026-08-05.json` as the measurement harness.

- [ ] **Step 3: Verify no claim outran the evidence**

```bash
grep -oE '`[a-zA-Z0-9_./-]+\.(ts|tsx|cjs|mjs|sql|yml|json)`' docs/architecture.md \
  | tr -d '`' | sort -u \
  | while read -r p; do [ -e "$p" ] || echo "NO SUCH FILE: $p"; done
```

Expected: no output. Any hit means a fabricated path — fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: tài liệu kiến trúc hệ thống hiện tại" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `docs/runbooks/admin-boundaries.md`

**Files:**
- Create: `docs/runbooks/admin-boundaries.md`
- Source content: `README.md:146-164` (Vietnamese — translate)
- Read only: `apps/api/scripts/fetch-boundaries.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a file the README (Task 7) links to as `docs/runbooks/admin-boundaries.md`.

- [ ] **Step 1: Read both the current README section and the script**

```bash
sed -n '146,164p' README.md
head -40 apps/api/scripts/fetch-boundaries.mjs
```

If the script contradicts the README text (different output paths, different tolerance), the **script wins** — record the discrepancy in the facts file `## Anomalies`.

- [ ] **Step 2: Write the runbook**

Open with a "Run this when" line: *administrative boundaries change (province/ward mergers)*. Then: the generated artifacts `apps/web/public/provinces-34.geojson` (34 provinces, nationwide) and `wards-region.geojson` (wards of the 6 working-region provinces) are committed — **you do not need to run this to run the app**. Source: [thanglequoc/vietnamese-provinces-database](https://github.com/thanglequoc/vietnamese-provinces-database) (MIT), original data from NXB Tài nguyên – Môi trường và Bản đồ (Bộ NN&MT). Command: `node apps/api/scripts/fetch-boundaries.mjs`. Then the constraint that matters: geometry is simplified (Douglas–Peucker tolerance 0.0001 ≈ 11 m, coordinates rounded to 5 decimals) and **this step is mandatory** — raw ward data is 157 MB, ~10 MB after processing. The 11 m error is below half a pixel at the app's maximum zoom (1:100,000).

- [ ] **Step 3: Verify the referenced paths exist**

```bash
for p in apps/api/scripts/fetch-boundaries.mjs apps/web/public/provinces-34.geojson apps/web/public/wards-region.geojson; do
  [ -e "$p" ] && echo "OK   $p" || echo "MISS $p"; done
```

Expected: all `OK`. A `MISS` means the runbook names a file that does not exist — correct the runbook.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/admin-boundaries.md
git commit -m "docs: runbook tái tạo ranh giới hành chính" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `docs/runbooks/osm-water.md`

**Files:**
- Create: `docs/runbooks/osm-water.md`
- Source content: `README.md:165-215` (Vietnamese — translate)
- Read only: `apps/api/scripts/{fetch-osm-waterways,explore-osm,report-dam-crosscheck,build-osm-seeds,clip-to-region,prune-hydrosheds-versions}.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a file the README (Task 7) links to as `docs/runbooks/osm-water.md`.

This is the highest-risk runbook: two of its three ordering constraints cause **silent** data corruption when violated. The constraints are the point of the document, not an appendix.

- [ ] **Step 1: Read the current section and confirm each constraint against the scripts**

```bash
sed -n '165,215p' README.md
grep -n "git show HEAD\|thuydienvietnam" apps/api/scripts/report-dam-crosscheck.mjs apps/api/scripts/clip-to-region.mjs | head
grep -n "active\|refuse\|throw" apps/api/scripts/prune-hydrosheds-versions.mjs | head
```

Confirm from source: (a) `clip-to-region.mjs` overwrites `apps/web/public/thuydienvietnam.geojson` **in place**; (b) `report-dam-crosscheck.mjs` has a `git show HEAD:` fallback that only warns; (c) `prune-hydrosheds-versions.mjs` refuses to run while an old version is active. If any is false, document what the source actually does.

- [ ] **Step 2: Write the runbook**

Open with "Run this when" — *you want fresher OpenStreetMap waterway data*. State that `apps/api/src/db/seeds/data/osm-rivers-region.geojson` and `osm-lakes-region.geojson` are committed generated artifacts, that OSM is the **sole** source for `rivers`/`lakes`, and that the licence is **ODbL** requiring "© OpenStreetMap contributors" attribution.

Then the seven steps in order:

```bash
node apps/api/scripts/fetch-osm-waterways.mjs      # 1. raw download from Overpass (not committed)
node apps/api/scripts/explore-osm.mjs              # 2. inspect tag distribution for changes
node apps/api/scripts/report-dam-crosscheck.mjs    # 3. cross-check OSM dams vs the catalogue (report only)
node apps/api/scripts/build-osm-seeds.mjs          # 4. convert to seed files
node apps/api/scripts/clip-to-region.mjs           # 5. clip to the working region
npm run seed -w @webatlas/api                      # 6. reload the other thematic layers
npm run ingest:rivers -w @webatlas/api             # 7. load OSM rivers as the active version
```

Then the three mandatory constraints, each with its consequence:

- **Step 2 before step 4** — always run `explore-osm.mjs` and reconcile against the mapping table in `packages/shared/src/osm-water.ts`. If OSM has introduced significant new tag values, update the table before ingesting.
- **Step 3 before step 5** — `clip-to-region.mjs` overwrites `apps/web/public/thuydienvietnam.geojson` **in place**. `report-dam-crosscheck.mjs` needs the full nationwide file to cross-check correctly; its `git show HEAD:` fallback only prints a console warning and does **not** block a wrong run.
- **Step 7 after step 6** — `seed` no longer touches `rivers`, but if an older `rivers` version is active, `ingest:rivers` is the only step that activates the new OSM version.

Close with the optional cleanup: `node apps/api/scripts/prune-hydrosheds-versions.mjs` removes stale `rivers`/`lakes` versions (HydroSHEDS, `thuyhe.geojson`) and **refuses to run** if one of them is still active, so it cannot delete data currently being served. Link to [hydrosheds-legacy.md](hydrosheds-legacy.md) for what those versions were.

- [ ] **Step 3: Verify every script named in the runbook exists**

```bash
grep -oE 'apps/api/scripts/[a-z-]+\.mjs' docs/runbooks/osm-water.md | sort -u \
  | while read -r p; do [ -e "$p" ] || echo "NO SUCH SCRIPT: $p"; done
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/osm-water.md
git commit -m "docs: runbook tái tạo dữ liệu sông hồ từ OSM" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `docs/runbooks/hydrosheds-legacy.md`

**Files:**
- Create: `docs/runbooks/hydrosheds-legacy.md`
- Source content: `README.md:216-241` (English — move, do not translate)
- Read only: `apps/api/scripts/prep-hydrosheds.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a file linked from both `docs/runbooks/osm-water.md` (Task 5) and the README (Task 7).

- [ ] **Step 1: Read the current section**

```bash
sed -n '216,241p' README.md
ls apps/api/scripts/prep-hydrosheds.sh apps/api/src/db/seeds/data/hydro*.geojson
```

- [ ] **Step 2: Write the runbook with a superseded banner at the top**

Open with an explicit status block, not a buried caveat:

```markdown
> **Superseded.** OpenStreetMap replaced HydroSHEDS as the source for `rivers` and `lakes`
> on 2026-08-04 — see [osm-water.md](osm-water.md). This runbook is kept because HydroSHEDS
> dataset versions may still exist in a developer database, and `prune-hydrosheds-versions.mjs`
> exists to remove them. Do not use this to add new data.
```

Then move the existing English content verbatim: the clipped seed inputs `hydrolakes-vn.geojson` / `hydrorivers-vn.geojson` (bbox `102 8 110 24`), the two upstream downloads (HydroLAKES v1.0 polygons ~800 MB; HydroRIVERS v1.0 Asia ~90 MB) with their URLs, the `pip install geopandas shapely pyproj fiona` step, the `apps/api/scripts/prep-hydrosheds.sh <lakes.shp> <rivers.shp>` invocation, and the resulting attributes (lakes: `Hylak_id, Lake_name, Lake_type, Lake_area, Vol_total, Shore_len`; rivers: `HYRIV_ID, ORD_STRA, LENGTH_KM`, filtered to `ORD_STRA >= 3`).

- [ ] **Step 3: Verify the script and data files exist**

```bash
for p in apps/api/scripts/prep-hydrosheds.sh \
         apps/api/src/db/seeds/data/hydrolakes-vn.geojson \
         apps/api/src/db/seeds/data/hydrorivers-vn.geojson; do
  [ -e "$p" ] && echo "OK   $p" || echo "MISS $p"; done
```

Expected: all `OK`. If the `.geojson` files are gone, say so in the runbook rather than implying they are present.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/hydrosheds-legacy.md
git commit -m "docs: runbook HydroSHEDS (đã bị OSM thay thế)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rewrite `README.md`

**Files:**
- Modify: `README.md` (259 lines → ~120; full rewrite)

**Interfaces:**
- Consumes: `## Commands` and `## Services` from Task 1; the status verdicts from Task 2; the topology prose from Task 3; the three runbook paths from Tasks 4–6.
- Produces: the repository entry point. Nothing consumes it.

Written last on purpose: every link it makes now points at a file that exists.

- [ ] **Step 1: Write the new README, six sections**

**§1 Identity** — keep the existing opening paragraph (`README.md:1-6`): an interactive WebGIS for Vietnam water resources, React 19 + OpenLayers, evolving into a role-based platform. Add one sentence naming the working region: 6 provinces of Nam Trung Bộ & Tây Nguyên.

**§2 Architecture at a glance** — the four services in a table (PostGIS / GeoServer / Fastify API / React frontend), the "API is the only writer" invariant, the two roles, and one line pointing to [docs/architecture.md](docs/architecture.md) for detail. Condense Task 3's §1 — do not contradict it. Keep the monorepo layout tree from `README.md:23-38`, updated: `docs/` now also holds `architecture.md`, `runbooks/`, and `README.md`.

**§3 Quickstart** — the existing six steps, preserved with their exact commands (`README.md:41-108`): install; `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d`; `npm run migrate` + `npm run seed` + `npm run publish:geoserver`; `npm run dev -w @webatlas/api`; `npm run create-admin -w @webatlas/api -- --email … --password … --name …`; `npm run dev:web`. **Keep the CORS note** — `CORS_ORIGIN` defaults to `http://localhost:5173` and a different Vite port silently breaks admin login. Add one line after the seed step: *`npm run ingest:rivers -w @webatlas/api` must follow `seed` to activate the OSM rivers version — see [docs/runbooks/osm-water.md](docs/runbooks/osm-water.md).*

**§4 API surface** — keep the existing table (`README.md:112-125`) verbatim; it was checked against `server.ts` and is accurate. Keep the closing paragraph on argon2, JWT, `app.audit_log`, and PostGIS geometry validation.

**§5 Workspace scripts** — the existing table plus the two missing rows:

| `npm run test:web` | Run the frontend test suite (Vitest) |
| `npm run ingest:rivers -w @webatlas/api` | Load OSM rivers as the active dataset version — run after `seed` |

Keep the note that API-workspace scripts run with `-w @webatlas/api`. Add: `npm run build:web` type-checks (`tsc -b`) and catches errors Vitest does not.

**§6 Project status** — replace the stale Plan-1-to-7 checklist entirely. Open with the branch caveat, stated plainly:

```markdown
> This documentation describes the `feat/region-scoping-osm-water` branch, which is
> 46 commits ahead of `main`. Work listed as shipped is on this branch; not all of it
> has been merged.
```

Then a short prose summary of what exists — read-only public viewer, admin auth + user management, admin feature editing (draw/modify/delete), dataset versioning, adaptive shell with personas, region-scoped OSM hydrology, CI — and a pointer to [docs/README.md](docs/README.md) for the per-document status. Do **not** reproduce the 34-row table here.

**§7 Documentation** — replace the 3-link list with: [docs/README.md](docs/README.md) (index), [docs/architecture.md](docs/architecture.md), the three runbooks, and [the roadmap](docs/superpowers/specs/2026-07-15-product-roadmap.md).

- [ ] **Step 2: Confirm the removed content survived elsewhere**

```bash
SCRATCH="C:/Users/quock/AppData/Local/Temp/claude/c--Users-quock-Documents-Projects-webatlas/3e4874e3-7f46-42c6-858d-dda69e197c59/scratchpad"
git show HEAD:README.md | sed -n '146,241p' > "$SCRATCH/removed-sections.txt"
wc -l "$SCRATCH/removed-sections.txt"
ls docs/runbooks/
```

Expected: 96 lines removed; three runbook files present. Spot-check that the ODbL attribution requirement, the 157 MB → 10 MB rationale, and all three ordering constraints appear in the runbooks:

```bash
grep -l "ODbL" docs/runbooks/*.md
grep -l "157" docs/runbooks/*.md
grep -c "before step\|after step" docs/runbooks/osm-water.md
```

Expected: `osm-water.md`, `admin-boundaries.md`, and at least 3 constraint mentions.

- [ ] **Step 3: Verify the line count and every link**

```bash
grep -c "" README.md
grep -oE '\]\([^)]+\)' README.md | sed -E 's/^\]\(//; s/\)$//; s/#.*$//' \
  | grep -vE '^(https?:|mailto:|$)' \
  | while read -r p; do [ -e "$p" ] || echo "BROKEN: $p"; done
```

Expected: roughly 120 lines (140 is fine; 259 means the rewrite did not happen), and **no** broken links.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: viết lại README theo trạng thái thực tế của repo" -m "Tách runbook dữ liệu sang docs/runbooks/, sửa số lớp 7 -> 8, cập nhật project status." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: `## Commands` from Task 1 — only commands with a recorded exit 0 may be listed as working.
- Produces: nothing.

- [ ] **Step 1: Write the file, four sections**

**Commands** — a table of the verified commands with what each is for and its cost: `build:shared`, `test:shared`, `lint:web` (oxlint, warnings exit 0), `build:web` (`tsc -b && vite build` — the real type-check), `test:web` (~60–90s), `test:api` (1–2.5 min, needs the Docker stack), `dev:web` (Vite :5173), `dev -w @webatlas/api` (Fastify :3001). State that the DB + GeoServer stack must be up for API tests: `docker compose -f infra/docker-compose.yml up -d`.

**Conventions** — Feature-Sliced Design in `apps/web/src`; OpenLayers quarantined in `features/map/model/` and the map instance deliberately not on `window`; `packages/shared` is the single source of truth for layer identity (`EDITABLE_LAYER_KEYS`, 8 keys) and for the working region (`REGION_PROVINCE_CODES`); commit messages are Vietnamese.

**Landmines** — the four facts that cost time when unknown:

```markdown
- `packages/shared/dist` **is git-tracked.** After editing `packages/shared/src/*`, rebuild
  and commit the regenerated `dist` too, or it silently drifts from source.
- `ingest:rivers` must run **after** `seed`. `seed` no longer seeds `rivers`, but a stale
  active version will keep serving unless `ingest:rivers` activates the new one.
- `npm run test:api` hits a **live** PostGIS + GeoServer and appends a `dataset_version`
  row per seeded layer on every run (`runSeeds()` has no idempotency guard). Tests must
  assert `label ~ /^version \d+$/`, never an exact `version 1`.
- `vitest` uses esbuild and **skips type-checking.** Run `npm run build:web` to catch
  strict type errors before claiming a change compiles.
```

**Where to look** — point at [docs/architecture.md](docs/architecture.md) for the system, [docs/README.md](docs/README.md) for design history, and the runbooks for data regeneration. Repeat the never-run-these list from Global Constraints.

- [ ] **Step 2: Verify no unverified command is listed as working**

Cross-check every command in `CLAUDE.md` against the facts file `## Commands` section. Any command not recorded there must either be run now or removed from the file.

```bash
grep -oE 'npm run [a-z:]+( -w @webatlas/[a-z]+)?' CLAUDE.md | sort -u
```

Compare that list against the facts file by eye. Destructive commands appear only under "never run these", not under Commands.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — lệnh, quy ước và các bẫy của repo" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Refresh the roadmap baseline

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-product-roadmap.md:10-24` (§1 "Where we are") — **this section only**

**Interfaces:**
- Consumes: the status verdicts from Task 2. Verdicts must match exactly.
- Produces: nothing.

The document declares itself living and says the baseline paragraph "is appended-to as items land" (line 16). This task honours that contract; it is the single permitted edit to a historical document.

- [ ] **Step 1: Read the section and its self-imposed rules**

```bash
sed -n '10,25p' docs/superpowers/specs/2026-07-15-product-roadmap.md
```

Note the rule on line 16: phase tables mark shipped rows inline with ✅ **rather than deleting them**, so sequencing rationale stays readable. Do not delete rows.

- [ ] **Step 2: Append to the "On `main`" paragraph, do not rewrite it**

Add a dated sentence covering what landed since 2026-07-15 — shell layout restructure, map-versioning foundation, HydroSHEDS hydrology (lakes layer), region scoping + OSM waterways + new administrative boundaries, and map-load performance — and state that these are on `feat/region-scoping-osm-water`, 46 commits ahead of `main`, not yet merged. Correct the three "verified facts" below it that are now false: CI **exists** (`.github/workflows/ci.yml`), the user-management UI **exists** (`apps/web/src/features/user-management/`), and `test:web` **is** a root script. Mark each correction with its date rather than silently editing, so the 2026-07-15 assessment stays legible as history.

- [ ] **Step 3: Verify nothing outside §1 changed**

```bash
git diff --stat docs/superpowers/specs/2026-07-15-product-roadmap.md
git diff -U0 docs/superpowers/specs/2026-07-15-product-roadmap.md | grep -E '^@@'
```

Expected: one file changed, and every hunk header inside the line 10–25 region. A hunk outside it violates the Global Constraint on editing historical documents — revert it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-15-product-roadmap.md
git commit -m "docs: cập nhật mốc hiện trạng trong roadmap" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Final consistency check

**Files:**
- Modify: whichever files the checks below find wrong (expected: none)

**Interfaces:**
- Consumes: every file produced by Tasks 2–9.
- Produces: the final report.

- [ ] **Step 1: Every relative link in every new document resolves**

```bash
cd /c/Users/quock/Documents/Projects/webatlas
for f in README.md CLAUDE.md docs/README.md docs/architecture.md docs/runbooks/*.md; do
  d=$(dirname "$f")
  grep -oE '\]\([^)]+\)' "$f" | sed -E 's/^\]\(//; s/\)$//; s/#.*$//' \
    | grep -vE '^(https?:|mailto:|$)' \
    | while read -r p; do [ -e "$d/$p" ] || echo "BROKEN in $f: $p"; done
done
```

Expected: no output.

- [ ] **Step 2: The corrected facts are corrected everywhere**

```bash
grep -rn "7 thematic layers\|7 lớp\|Plan 7 (next)" README.md docs/*.md docs/runbooks/*.md CLAUDE.md
grep -rn "20 plans\|36 documents\|2 of 16" README.md docs/README.md
```

Expected: no output from either. Both are the drift this work exists to remove.

- [ ] **Step 3: No stray Vietnamese in the English documents**

```bash
grep -nP '[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]' \
  README.md CLAUDE.md docs/architecture.md docs/runbooks/*.md | grep -v "Nam Trung Bộ\|Tây Nguyên\|Tài nguyên\|Môi trường\|Bản đồ\|thuyhe\|thuydienvietnam"
```

Expected: no output. Vietnamese proper nouns (place names, the data source publisher, filenames) are the intended exceptions; running prose is not.

- [ ] **Step 4: The repo still builds and the working tree is clean**

```bash
npm run build:web; echo "build:web exit=$?"
git status --short
git log --oneline -10
```

Expected: exit 0, empty status, and the eight documentation commits from Tasks 2–9, plus the spec and plan commits.

- [ ] **Step 5: Report**

State which claims were verified **by execution** (the commands in Task 1 Steps 2–4, the link checks, the final build) and which **by reading source only** (the destructive pipelines in Tasks 4–6, per Global Constraints). List every entry recorded in the facts file `## Anomalies` — including any test failure found in Task 1 Step 4 — as known issues, not as fixed work.

No commit; this task changes nothing unless a check fails.
