# Dataset Registry — Plan 2: Rebuild Cascade, Stage Types, Seed and River Migration — Design

**Date:** 2026-09-17
**Status:** Approved design — not yet implemented
**Amends:** [`2026-09-16-dataset-registry-and-one-command-build-design.md`](2026-09-16-dataset-registry-and-one-command-build-design.md) (the base spec)
**Scope:** migration steps 2–3 of the base spec §7, plus two prerequisite fixes

## Why this amendment exists

Plan 1 (merged to `main` at `f3b6acd`) delivered the registry foundation proven on one
synthetic `demo` dataset. Its final whole-branch review found two design gaps that must be
closed **before any real dataset writes permanent history**, and scoping the seed migration
uncovered a data-safety hazard and an undocumented licence. This document records the
decisions for all of them.

| Finding | Problem |
|---|---|
| **I3** | Staleness tracks *configuration*, not *execution*. Re-running a stage (a forced rebuild, recovery after a failure) does not re-run the stages and datasets that consumed its output. |
| **I4** | Process steps record `stage 0:sql completed` — not what ran. The rows are append-only and `ON DELETE RESTRICT`, so thin history becomes permanent. |
| **Edit hazard** | A seed load creates and activates a new ingest version, hiding stewards' edit versions without warning. As a registry stage, any config change — or the first build on a machine that already has data — would do this. |
| **Dams licence** | `thuydienvietnam.geojson` had no recorded origin. It is Open Development Vietnam's CC BY-SA 4.0 dataset, and the map attributes it nowhere. |

---

## §1 Rebuild cascade (I3)

### Rule: invalidate downstream before running

Immediately before `executeStage` runs stage *i* of dataset *d*, the runner deletes, in one
statement, the `app.dataset_stage_state` rows for:

- every stage of *d* after *i*; and
- every stage of every **transitive dependent** of *d*.

Invalidation happens only when a stage actually executes — never on a skip.

**Why before, not after.** Because the invalidation is written before execution, a crash at
any point leaves downstream stages *missing*, never falsely *ok*. The next build rebuilds them.
This also makes the review's observed `atlas:status` output `0:sql: failed  1:sql: ok`
impossible: a stage that re-executes clears its successors first.

**The universe is the whole registry, not the selected set.** With `--except contours`,
`contours` is not built in this run but is still invalidated, so `atlas:status` reports it
`missing` until a build includes it. `runBuild` gains an options argument:

```ts
runBuild(pool: Pool, datasets: Dataset[], options?: { universe?: Dataset[]; force?: string[] })
```

`universe` defaults to `datasets`; the CLI passes `ALL_DATASETS`. Dependents are computed over
`universe`.

**If invalidation fails,** the stage does not execute. The error is reported through the existing
per-dataset failure path, so an upstream stage can never run while its dependents still look
current.

### Rejected alternative, recorded so it is not re-proposed

Tracking an *output identity* per run (a content fingerprint, or a fresh id) and rebuilding
dependents only when it changed was designed and rejected as overkill. A stage only re-executes
when its configuration changed (already cascaded by the chained hash plan), when forced, or when
recovering a failure. The case it optimises — an upstream re-run producing byte-identical output
— occurs only after those deliberate, rare events, where some extra rebuilding is acceptable.

### Consequence to know

A download whose URL always serves the latest file (e.g. Geofabrik's `latest` OSM extract) never
refreshes on its own, because its configuration never changes. Either pin `sha256` — a content
change then fails the fetch loudly — or rebuild with `--force`.

### `--force <ids>`

- Parsed by `parseBuildArgs` with the same fail-closed rules as `--only`/`--except`: space or
  `=` form, comma-separated, unknown id, missing value and repeated flag all error.
- Every stage of a forced dataset executes regardless of the skip rule, so invalidation cascades
  normally.
- A forced id must be in the selected set. `--force dem --except dem` is a usage error, not a
  silent no-op.

---

## §2 Process-step detail (I4)

No migration. A pure function in `lineage.ts`:

```ts
processStepDescription(key: string, stage: Stage, inputHash: string): { description: string; tool: string }
```

- `description` = `stage <key> · <first 12 chars of input hash> · <summary>`, e.g.
  `stage 0:sql · a3f9c2e1b7d4 · INSERT INTO app.dataset_demo (id, note) VALUES …`
- `<summary>` by stage type:

  | Type | Summary |
  |---|---|
  | `sql` | the statement, whitespace collapsed |
  | `fetch-http` | the URL |
  | `load-geojson` | `<file> → <table>` |
  | `publish-geoserver` | the layer |
  | `run` | the command |

- The whole `description` is capped at 200 characters; truncation ends with `…`.
- `tool` = the stage type; for `run` stages, the command itself.

The 12-character hash prefix ties any history row back to the exact descriptor configuration
that produced it. Structured columns are deferred to export (sub-project E), which will add them
when it needs to query history.

---

## §3 New stage types

### `fetch-http`

- Downloads into `packages/atlas-data/data/`, the `into` path resolved beneath it. Paths escaping
  that directory are rejected by `validateRegistry`.
- Writes to a temporary name, then renames atomically on completion, so an interrupted download
  can never be mistaken for a finished one.
- If `sha256` is declared, a mismatch fails the stage **before** the rename; the previous file, if
  any, is left untouched.

### `load-geojson`

**Paths.** `file` is resolved beneath `packages/atlas-data/data/`, like `fetch-http`'s `into`;
paths escaping that directory are rejected by `validateRegistry`.

**Editable datasets only, in Plan 2.** Every dataset migrated in this plan is a versioned
`water.*` layer, so `load-geojson` requires the descriptor to declare `editable: true`, and
`validateRegistry` rejects it otherwise. A non-versioned load path is not designed until a dataset
needs one.

**Transactional.** The whole load commits or rolls back as one, using `pool.connect()` with
explicit `BEGIN`/`COMMIT` (base spec §5).

**Editable layers use the existing version service** exactly as `runSeeds` does today:
`createIngestVersion` → load features → set `feature_count` → `activate`.

**Idempotent by content.** The version's existing `source` column records the file name and its
content hash: `dams.geojson@sha256:<64 hex>`. If an ingest version for that layer with exactly
that `source` already exists, the stage creates nothing, activates nothing, and succeeds. The
layer — and any edits on top of it — is untouched.

This makes the first `atlas:build` on a machine that already has data, and every re-run with
unchanged content, safe. No migration: the hash lives in `source`.

**Edit guard.** A new ingest version is created only when content genuinely changed. At that
moment, if the layer's active version has `kind = 'edit'`, the stage **fails** with:

> `<layer> has steward edits on top of its last load; loading new content would hide them. Re-run with --supersede-edits <id> to proceed.`

`--supersede-edits <ids>` is parsed fail-closed like the other flags, and is deliberately
separate from `--force`: a precautionary rebuild must never be able to hide someone's edits. A
superseded id must be in the selected set.

**Replaying edits onto new data is parked** as its own future workflow. When built, it replaces
this refusal. Until then the guard is the safety net.

### `publish-geoserver`

Publishes one layer, reusing the logic already in `apps/api/src/geoserver/publish.ts`, which
repoints existing feature types with `PUT` so styling survives. Every REST call must fail the
stage on a non-2xx response.

### Registry check

`validateRegistry` rejects any stage whose `type` has no registered executor. A descriptor using
an unimplemented type fails at load time, not after earlier stages have already executed.

---

## §4 Migrating the seed layers and rivers

### One source for the column mappings

The pure column-mapping functions from `apps/api/src/db/seeds/registry.ts`, together with
`assignDamStatus`, move into `packages/shared`. They depend only on `@webatlas/shared` already,
and INV-4 places the attribute mapping there. Both the old `runSeeds` and the new descriptors
import them, so nothing is duplicated during the transition.

### Data files

All seed GeoJSON moves to `packages/atlas-data/data/seeds/`, including
`apps/web/public/thuydienvietnam.geojson`. That resolves the boundary violation recorded in the
base spec (the API reading the web app's public directory, and 38 KB shipped to every browser
unused). The old `registry.ts` paths point at the new location.

### Descriptors

Eight datasets, each with a `load-geojson` stage followed by a `publish-geoserver` stage:
`dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`,
`flood_generation`, `lakes`, `rivers`.

Plus `rivers_overview`, depending on `rivers`, with a single `sql` stage:
`REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview`. It must be the only statement in
its stage — it cannot run inside the implicit transaction of a multi-statement string (Plan 1,
Task 8).

### Licences

| Dataset | Licence | Lineage statement / source |
|---|---|---|
| `dams` | `CC-BY-SA-4.0` | Open Development Vietnam, *Hydropower plants in Vietnam by October 2020* (created 2020-10-21, modified 2022-05-07), clipped to the working region; `https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020` |
| `lakes`, `rivers`, `rivers_overview` | `ODbL-1.0` | OpenStreetMap contributors, clipped to the working region |
| `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation` | `LicenseRef-webatlas-synthetic` | **Synthetic demonstration data** from the original prototype's `mockData.ts` — not measurements, not for publication as real data |

The dams provenance was established from the file itself: its collection name is
`hydropower_2020`, matching the publisher's resource `hydropower_2020.geojson`, and its
10-character field names (`English_hy`, `Wattage_PL`, `Quantity_(`, `Year_of_la`, `Year_of_op`)
are Shapefile-truncated forms of the publisher's plant name, wattage, reservoir quantity, year of
launch and year of operation.

### The missing dams attribution

CC BY-SA 4.0 requires attribution. The legend credits rivers, lakes, the basemap overlays and
contours, but no `layer_dams` entry exists, and nothing in the codebase names the source.

The dams task adds `layer_dams` to `LEGEND_ATTRIBUTION` in `packages/shared/src/legend.ts` with
the attribution text:

> Hydropower plants in Vietnam by October 2020 — Open Development Vietnam, CC BY-SA 4.0

following the FABDEM pattern: one exported constant, tested against rendered legend output.

### Transition behaviour

- **Old commands keep working** — `npm run seed`, `npm run ingest:rivers -w @webatlas/api`,
  `npm run publish:geoserver` — until Plan 3's `atlas:up` replaces the runbook (base spec §7
  step 5). CI is unchanged.
- **One-time new version per layer on machines that already have data.** Existing active
  versions carry legacy `source` strings (`thuydienvietnam.geojson`, `OSM waterways`, …) that do
  not match `<file>@sha256:…`, so the first registry build creates and activates one new ingest
  version per layer. Harmless where no edits exist; the edit guard protects any layer that has
  them. Fresh clones are unaffected.

---

## §5 Task order

Each task leaves the repository working.

1. Rebuild cascade: invalidate downstream before running; `--force`.
2. Process-step detail.
3. `fetch-http`.
4. `load-geojson`: transactional, versioned, content-idempotent, edit guard, `--supersede-edits`.
5. `publish-geoserver`; `validateRegistry` rejects stage types with no executor.
6. Column mappings and `assignDamStatus` to `packages/shared`; seed files to
   `packages/atlas-data/data/seeds/`. Old commands still pass their tests.
7. Descriptors for the five synthetic layers and `lakes`.
8. `dams` descriptor, plus its legend attribution.
9. `rivers` and `rivers_overview`.
10. End-to-end on the dev database: `atlas:build` materialises all nine datasets; a second build
    skips everything; no edit version is touched.

---

## §6 Testing

- Database-backed tests are gated on `DATABASE_URL`, run with it exported, and must be shown to
  execute rather than skip.
- `publish-geoserver` is tested against the running GeoServer, gated on `GEOSERVER_URL` like the
  existing `apps/api/src/geoserver/publish.test.ts`.
- The edit guard is proven with a real `kind = 'edit'` version on a `__atlasdata_test__` layer —
  never on a real layer such as `dams`.
- **Cascade** — on synthetic test datasets modelled on the DEM → contours shape (DEM and contours
  are not registered until Plan 3): forcing a two-stage upstream re-runs its later stages and its
  dependent; a dependent excluded by `--except` is still invalidated; a skip invalidates nothing; if
  the upstream's second stage fails during a forced run, the dependent's state is gone although it
  never ran; an invalidation failure prevents execution.
- **Content idempotency:** a second load of an unchanged file creates no version and activates
  nothing; a changed file creates and activates one.
- **Parsing:** every `--force` and `--supersede-edits` case, including contradiction with
  `--except`.
- **Step detail:** each stage type's summary, whitespace collapsing, 200-character truncation.
- **Attribution:** the dams legend entry appears in rendered legend output and fails the test if
  removed.

---

## Out of scope

| Item | Where it goes |
|---|---|
| Replaying steward edits onto newly loaded data | Its own future workflow; replaces the edit guard |
| Output-identity-based rebuild precision | Rejected as overkill (§1) |
| Basemap, DEM and contours as `run` stages; moving `apps/api/scripts` | Plan 3 (base spec §7 step 4) |
| `atlas:up`, `atlas:verify` | Plan 3 (base spec §7 step 5) |
| Structured process-step columns | Export, sub-project E |
| Wiring `atlas-data` tests into CI | CI/CD work, parked by the user |
| Attribution for the raster basemap tiles (OSM streets, Esri satellite) | Accepted residual, recorded separately |

## Licence notes for export (sub-project E)

The atlas now combines **CC BY-SA 4.0** (dams), **ODbL** (OpenStreetMap layers) and
**CC BY-NC-SA 4.0** (FABDEM-derived contours). Their share-alike terms do not combine freely, so
export must carry licensing **per layer**, never a single package licence. Because `dams` is
steward-editable, edits to it are derivative works under CC BY-SA 4.0.
