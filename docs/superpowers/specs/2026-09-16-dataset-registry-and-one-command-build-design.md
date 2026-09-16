# Dataset Registry, Lineage, and One-Command Build — Design

**Date:** 2026-09-16
**Status:** Approved design — not yet implemented
**Sub-project:** B + A of the data restructuring track (see [Decomposition](#decomposition))

## Problem

Two problems, one cause.

**A fresh clone cannot produce a working app.** Roughly 1.4 GB of data lives outside git
behind eight manual runbook steps with ordering constraints
([`docs/runbooks/README.md`](../../runbooks/README.md)). Onboarding a teammate means
walking them through a sequence where skipping step 5 leaves the street basemap broken as
a grey tile returned at HTTP 200 — broken without erroring, so nothing notices.

**Adding a dataset means writing a new pipeline.** There are ~15 ingest-related entry
points across three languages, with no common contract:

| Stage | Today |
|---|---|
| Acquire | `fetch-osm-waterways.mjs`, `fetch-boundaries.mjs`, `prep_dem.py` |
| Prepare | `clip-to-region.mjs`, `build-osm-seeds.mjs`, `prep_hydrosheds.py` |
| Load | `seeds/run.ts`, `ingestRivers.ts`, `basemap/load_basemap.py`, `load-dem.sh` |
| Derive | `generateContours.ts`, `refreshRiverOverview` |
| Publish | `geoserver/publish.ts`, `basemap/publish-basemap.sh`, `styles.py` |

`SEED_LAYERS` in [`seeds/registry.ts`](../../../apps/api/src/db/seeds/registry.ts) is
already a competent mini-descriptor, but it covers exactly one class — GeoJSON into a
`water.*` table. Every other dataset grew its own shape.

The common cause is that **the dependency graph is real but implicit**. Contours need the
DEM; `rivers_overview` needs rivers; publication needs load. That graph exists only in a
runbook table and in people's heads. Once it is declared, "one command" is just
*materialise the graph in topological order*, and "add a dataset" is *add a node*.

### Evidence that implicit contracts fail here

This is not hypothetical. `refreshRiverOverview()` was called only from the
`isMainModule` block of `ingestRivers.ts`, so the matview was refreshed by
`npm run ingest:rivers` but not by any programmatic caller. `integration.test.ts` imports
the function directly, so during a test run it ingested 9,486 features, activated a new
version, and left `water.rivers_overview` as a snapshot of the previous one — silently.
CI was red for two days, with a symptom that changed depending on which test file ran
first. Fixed in `fix/river-overview-refresh`, but the class of defect is structural: a
pipeline step whose obligations are encoded in a call site rather than in a contract.

## Scope

**In scope**

- A declarative dataset registry and a runner that executes it.
- An ISO 19115-shaped lineage record, mandatory for every dataset.
- A one-command environment build covering the compose stack, the data pipeline, and a
  post-build verification probe; plus a status command.
- Migration of existing ingest paths onto the registry, incrementally.

**Out of scope** (separate sub-projects, see [Decomposition](#decomposition))

- Moving raster out of PostGIS to COGs + coverages (**C** — INV-5).
- Generating SLDs from shared style tokens (**D** — INV-3).
- Atlas export with entity information (**E**) — this spec only provides the lineage
  foundation export requires.
- Live external map services (WMS/WMTS from other organisations) — explicitly not a
  target.
- Any change to snapshot versioning. See [§0](#0-what-this-does-not-change).

## §0 What this does NOT change

Snapshot versioning (`app.dataset_versions`, `is_active`, the resolver in the versioning
foundation design) is **untouched**. It is a normal, recognised pattern — immutable
snapshots plus an active pointer — and it works.

The gap is elsewhere. Standards separate three concerns that this repo currently runs
through one mechanism:

| Concern | Answers | Standard | Status |
|---|---|---|---|
| Feature edit history | who changed this polygon, when | audit log / bitemporal | `app.audit_log` + `kind='edit'` versions |
| Dataset snapshots | which import is live; roll back a bad one | snapshot + active pointer | `app.dataset_versions`, `water.*` only |
| **Dataset lineage** | where it came from, licence, derived from what | **ISO 19115 lineage** | **ad hoc** — `basemap.dataset_sources` |

Only the third is addressed here. The versioning foundation design explicitly deferred
raster and basemap provenance — *"Satellite imagery through time — a separate
raster/basemap system, deferred entirely"* — and `basemap.dataset_sources` was later
bolted on to fill part of that gap. This spec replaces that table; it does not extend
versioning to reference data.

**Editability becomes a flag on a descriptor**, not a different architecture.

## §1 Architecture

```
apps/api/src/datasets/
  descriptors/     one module per dataset — dams.ts, basemap-roads.ts, dem.ts, contours.ts
  registry.ts      collects + validates descriptors, exposes the dependency graph
  runner/          topological execution, idempotence, lineage writes
```

Descriptors are **TypeScript modules, not YAML**. Three reasons:

1. `SEED_LAYERS` already proves the pattern in this codebase.
2. Its `columns` mapping is genuinely code. Expressing it in YAML is the first step
   toward inventing a configuration language with no debugger.
3. A TS descriptor can import attribute definitions directly from `packages/shared`,
   which is what INV-4 requires — one definition consumed by migrations, the API
   registry, and the frontend.

## §2 The descriptor

```ts
interface Dataset {
  id: string;                 // 'dams', 'basemap.roads', 'dem', 'contours'
  kind: 'vector' | 'raster' | 'derived';
  lineage: Lineage;           // mandatory — §3
  dependsOn?: string[];       // 'contours' dependsOn 'dem'
  editable?: boolean;         // opt-in to existing snapshot versioning; default false
  stages: Stage[];
}

type Stage =
  | { type: 'fetch-http';        url: string; into: string; sha256?: string }
  | { type: 'load-geojson';      file: string; table: string; columns: ColumnMap }
  | { type: 'sql';               statement: string }
  | { type: 'publish-geoserver'; layer: string; style?: string }
  | { type: 'run';               command: string; produces: string;
                                 promoteTo: string; promoteBy: string };

/** Declared by the descriptor; the runner appends process steps at execution time. */
interface Lineage {
  statement: string;                 // LI_Lineage.statement — plain-language summary
  licence: string;                   // SPDX id where one exists, else a short name
  sources: Array<{                   // LI_Source, one per upstream
    citation: string;
    licence: string;
    uri?: string;
    resolution?: string;             // e.g. '30 m', '1:50 000'
  }>;
}

/**
 * The existing `SeedLayer.columns` signature, unchanged:
 * map a GeoJSON feature's properties to { column: value }, excluding geometry.
 */
type ColumnMap = (props: Record<string, unknown>, index: number) => Record<string, unknown>;
```

`Lineage.sources` covers *declared* upstreams — where the data came from before this
repo touched it. Upstreams that are themselves registered datasets are expressed through
`dependsOn` instead, and the runner resolves those transitively (§3), so a derived
dataset does not restate its parent's citation.

Every stage declares what it `produces`, which is what makes the runner able to skip
completed work.

### The escape hatch is structurally temporary

`run` cannot be constructed without `promoteTo` (which built-in should eventually absorb
it) and `promoteBy` (the horizon). A registry test **fails the build once a `promoteBy`
date passes**. The escape hatch cannot quietly become the default, because the type
system refuses an untracked one and CI refuses an overdue one.

### What this buys immediately

Adding a thematic GeoJSON layer becomes one descriptor file with **zero new pipeline
code** — `fetch-http` + `load-geojson` + `publish-geoserver` already covers it. The
modularity goal is met for the common case from day one. `run` exists only for
`prep_dem.py`, `load_basemap.py`, and the OSM preparation scripts, each carrying a
promotion deadline.

## §3 Lineage

`basemap.dataset_sources` is replaced by three tables in `app`, mandatory for every
registered dataset. Modelled on ISO 19115-1 lineage; the standard permits a plain
descriptive `statement` where full process modelling is unwarranted, so simple datasets
stay simple.

| Table | ISO analogue | Holds |
|---|---|---|
| `app.dataset_lineage` | `LI_Lineage.statement` | one row per dataset: statement, effective licence |
| `app.dataset_lineage_source` | `LI_Source` | upstreams: citation, licence, URI, resolution |
| `app.dataset_lineage_step` | `LI_ProcessStep` | description, timestamp, tool/command |

Two properties distinguish this from documentation:

**Process steps are a by-product of execution.** The runner already knows which stage
ran, when, and with what command, so it writes `dataset_lineage_step` rows itself.
Lineage cannot drift from reality, because nobody maintains it by hand. This is the
specific failure of `basemap.dataset_sources`, which was accurate only until someone
forgot to update it.

**Licence propagation is computed, not asserted.** A derived dataset inherits its
sources' licences transitively through `dependsOn`. Contours derive from the DEM, so
contours resolve to CC BY-NC-SA automatically; anything derived from OSM carries ODbL.

This is not metadata hygiene. FABDEM (CC BY-NC-SA, **non-commercial**) and OSM (ODbL,
**share-alike**) sit in the same database today, and the only record of which is which
lives in migration comments. Export (sub-project E) is not legally shippable without a
per-layer licence answer, and ODbL share-alike obligations travel with derived data.
The registry makes that answer queryable for any node.

> ISO 19115-2 extends lineage with `LE_Source` / `LE_ProcessStep` specifically for
> imagery and gridded data. Sub-project C should use those for the raster path rather
> than re-inventing a raster provenance model.

## §4 The one-command build

```bash
npm run atlas:up                         # stack → build → verify. The onboarding command.

npm run atlas:build                      # materialise everything missing, in order
npm run atlas:build -- --only contours   # one dataset and its dependencies
npm run atlas:build -- --except dem      # everything but these and their dependents
npm run atlas:status                     # what is materialised, stale, or missing
npm run atlas:verify                     # probe a built atlas end to end
```

`atlas:up` is what a new teammate runs, and the only command onboarding documentation
needs to name. The rest are for people already working in the repo.

`--except` excludes a dataset **and everything downstream of it**, since a dependent
cannot be materialised without its parent. Excluding `dem` therefore also excludes
`contours`; the status output names what was skipped and why.

`atlas:status` addresses onboarding as directly as the build does. A teammate who clones
and runs it is told exactly what state they are in, rather than discovering it through a
grey tile served at HTTP 200.

### Stack lifecycle

Nothing can load into PostGIS or publish to GeoServer unless both are running — runbook
step 1. `atlas:up` owns that: bring the compose stack up, wait for readiness, then build,
then verify.

- **Readiness is polled, not assumed.** `db` has a compose healthcheck; GeoServer does
  not, so readiness means its REST endpoint answering, not the container existing.
  Proceeding on container start alone produces failures that look like data problems.
- **Idempotent and non-destructive.** Re-running against an already-running stack is a
  no-op. `atlas:up` never runs `down`, and never `down -v` — a command people run while
  disoriented must not be able to delete a volume holding hours of DEM load.
- **The compose file is a parameter, not a constant.** A deployment compose file already
  exists alongside the development one; `atlas:up` takes which to use rather than
  hard-coding `infra/docker-compose.yml`.

### Verify, and why it is not the test suite

`atlas:verify` probes a built atlas the way a browser would:

1. Every registered dataset's stages report materialised.
2. Every `publish-geoserver` layer answers a real WMS/WFS request — not merely existing
   in the GeoServer catalog.
3. Every loaded dataset's active version holds more than zero features.
4. Every dataset has a lineage row with a resolvable licence.

Check 3 is the generalisation of the `rivers_overview` defect: a derived artifact that
was *present, queryable, and empty*, which every structural check passed and only a
content check would have caught. Check 2 is the generalisation of the grey
"API KEY REQUIRED" tile returned at HTTP 200 — a layer that resolves but does not serve.

This is deliberately **not** `npm run test:api`. A build failing and the code being wrong
are different conditions that should fail separately and be read differently; folding
vitest into the build conflates them. `atlas:status` reports *declared state* (what the
registry believes); `atlas:verify` reports *observed behaviour* (what the stack actually
returns). Disagreement between them is itself the diagnosis.

### This dissolves the CI data problem

CI cannot build the basemap — it is a 684 MB OSM extract. Today that manifests as seven
failing tests, and the pre-existing workaround is ad hoc environment-variable gating
(`describe.skipIf(!process.env.GEOSERVER_URL)` in `publish.test.ts`,
`process.env.ASSISTANT_DATABASE_URL ? describe : describe.skip` in `privileges.test.ts`).

With a registry, CI runs `atlas:build --except basemap,dem` and tests gate on the same
source of truth as the build. Note CI calls `atlas:build`, **not** `atlas:up`: GitHub
Actions supplies its own Postgres as a job service container, so the compose lifecycle
that `atlas:up` owns is neither available nor wanted there. Separating the two commands
is what lets the same build logic serve both a laptop and CI.

```ts
describe.skipIf(!materialised('basemap'))('locate_place', () => { … });
```

`materialised(id)` is a test helper exported by the registry that reads the stage-state
record (§5) — the same state the build writes. A skipped suite reports *which* dataset
was missing, so a skip is diagnosable rather than silent.

Declarative, one mechanism instead of per-test environment archaeology, and if someone
later makes the basemap cheap enough for CI they unskip it by changing **one descriptor**
rather than seven test files.

## §5 Error handling and resumability

State is tracked per **stage**, not per dataset:
`(dataset_id, stage, input_hash, status, produced_at)`. The input hash covers the stage's
own configuration plus its upstreams' hashes, so editing a column mapping marks that
stage stale and reruns it while leaving an untouched 40-minute DEM fetch alone.

Four failure modes are designed for explicitly:

- **Interrupted downloads.** `fetch-http` writes to a temporary path and renames
  atomically on completion. A killed 684 MB download can never be mistaken for a
  finished one.
- **Upstream drift.** Optional `sha256` on `fetch-http` catches a third-party source
  changing underneath. The DEM runbook already names this risk class — *"the dependency
  class that already bit this project once (CARTO)"* — and the FABDEM mirror is exactly
  that shape.
- **Partial loads.** Database stages run in a transaction and roll back whole, leaving
  the previously-good table intact. This is the guarantee `runSeeds` already provides.
- **One failure should not waste the run.** A failed stage stops its own subtree;
  independent branches continue. The command exits non-zero with a summary of what
  succeeded, failed, and was skipped. On an hours-long build, halting everything because
  one fetch returned 404 wastes a working day.

## §6 Testing

Runner and registry tests use a **tiny synthetic dataset**, never the real ones, so the
suite stays fast and fully CI-runnable even though the real data is not available there.

**Registry**
- Every descriptor validates against the schema.
- The dependency graph is acyclic.
- Every `run` stage declares `promoteTo` and `promoteBy`.
- A `promoteBy` date in the past fails the build. *(This is the debt rule; without this
  test the rule is only a promise.)*

**Runner**
- Stages execute in topological order.
- Running twice performs the work once.
- A run resumes correctly after a simulated mid-stage failure.
- Changing a descriptor marks exactly the affected stages stale.
- A failed stage blocks its subtree and does not block independent branches.

**Lineage**
- One `dataset_lineage_step` row per stage execution.
- Licence propagation is transitive: contours resolve to CC BY-NC-SA via the DEM.
- Every registered dataset has a lineage row — no dataset can be registered without one.

**Stack lifecycle and verify**
- `atlas:up` against an already-running stack is a no-op and restarts nothing.
- `atlas:up` waits for GeoServer's REST endpoint, not merely for its container.
- `atlas:verify` fails when a dataset is materialised but its table is empty — the
  `rivers_overview` case, asserted directly.
- `atlas:verify` fails when a layer exists in the GeoServer catalog but does not serve a
  real request — the grey-tile-at-HTTP-200 case.
- No command in this spec issues `docker compose down`, with or without `-v`. Asserted
  in a test, because the cost of getting it wrong is someone's hours-long DEM load.

## §7 Migration path

Six independently shippable steps. The repository works after each one, and the existing
runbook steps remain valid in parallel until step 5, so nobody is blocked mid-migration.

| # | Step | Why this order |
|---|---|---|
| 1 | Registry, runner, lineage tables — **zero datasets migrated**, proven on one trivial dataset | Foundation lands and is testable before anything depends on it |
| 2 | Migrate the seven `SEED_LAYERS` datasets | They already fit `load-geojson` almost exactly — best effort-to-value ratio |
| 3 | Migrate rivers | Proves `dependsOn` and the `sql` derive stage against `rivers_overview` |
| 4 | Wrap basemap, DEM, contours as `run` stages with promotion deadlines | No behaviour change; brings them into the graph and under governance |
| 5 | `atlas:up` becomes the documented onboarding path | All eight runbook steps, step 1 included, collapse into one command |
| 6 | Promote `run` stages to built-ins as deadlines fall due | The raster ones are sub-project C |

## YAGNI — not doing

- **No shared/remote artifact cache.** Teammates rebuild from upstream. Accepted cost:
  first run takes hours. Revisit only if onboarding frequency justifies hosting 1.4 GB.
- **No parallel stage execution.** Topological order, one stage at a time. Simpler to
  reason about and to resume; the bottleneck is network and GDAL, not scheduling.
- **No live external map sources.** Explicitly excluded from the ingestion targets.
- **No retention policy for stage state.** It accumulates; it is small.
- **No new versioning semantics.** See §0.

## Decomposition

This spec is **B + A** of a five-part track:

| | Sub-project | Serves | Invariants |
|---|---|---|---|
| **A** | One-command environment build | repo shareability | — |
| **B** | Declarative dataset registry + generic ingest | thematic + foreign-schema ingestion | INV-2, INV-4 |
| **C** | Raster path: DEM out of PostGIS → COGs + coverages | raster/imagery products | **INV-5**, §14 `eo` |
| **D** | Generate SLD from shared style tokens | — | **INV-3** |
| **E** | Atlas export with entity information | export | builds on B's lineage |

**On D:** the SLDs are not simply a violation. INV-3 anticipates this case — *"If vector
WMS is ever needed, SLD is generated from the same style tokens, not hand-maintained."*
`styles.py` already generates SLDs; they are merely not generated *from shared tokens*.
D is "point the generator at `packages/shared`", not "delete the SLDs". The drift had a
sound cause: 103,672 contour features cannot be client-styled GeoJSON.

**On C:** `basemap.dem_region` holds 426 MB of raster inside PostGIS, against INV-5's
*"never in PostGIS"*. Beyond compliance, this is the single largest contributor to
database size and therefore constrains every hosting option.
