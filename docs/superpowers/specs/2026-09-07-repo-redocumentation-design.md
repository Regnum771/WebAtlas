# Repository Re-documentation — Design

**Date:** 2026-09-07
**Status:** Approved design — ready for implementation planning
**Branch:** `feat/region-scoping-osm-water` (46 commits ahead of `main` at time of writing)
**Scope:** Documentation only. No code changes, no schema changes, no merge.

## Problem

The repository's documentation has drifted from the code it describes. `README.md` was last
substantively touched on 2026-08-04 (`4462dc6`) and carries claims that are now false, while
whole subsystems that shipped since have never been documented anywhere outside their original
design specs.

Verified drift, checked against the working tree on 2026-09-07:

| Drift | Evidence |
|---|---|
| "Project status" lists Plan 7 as **next** and unchecked | Plans 7 through map-performance have all shipped; 15 specs and 19 plans exist |
| "the 7 thematic layers" (3 occurrences) | `EDITABLE_LAYER_KEYS` in `packages/shared/src/index.ts` has **8** entries — `lakes` was added by the 2026-07-28 hydrology work |
| Architecture section omits entire subsystems | dataset versioning (`migrations/1000000000004`, `…005`, `apps/api/src/modules/versions/`), personas (`apps/web/src/entities/persona/`), adaptive shell (`features/shell/`, `widgets/top-bar/`), routing, region scoping, bbox + zoom-gated WFS loading |
| Documentation index links 2 of 15 specs | `README.md:255-259` |
| HydroSHEDS regeneration section reads as current | The README's own OSM section states OSM is the sole `rivers`/`lakes` source |
| Scripts table omits `test:web` and `ingest:rivers` | vs. root `package.json` |
| No agent-facing documentation | No `CLAUDE.md`/`AGENTS.md`; `.claude/` is empty |
| Language is mixed | Quickstart in English, OSM and boundaries sections in Vietnamese |

Nothing marks which of the 34 specs and plans shipped, which were superseded, and which landed
only partially.

## Goals

1. A reader who has never seen the repository can understand what it is and run it.
2. Every documented command and architectural claim is true of this branch.
3. A Claude Code session stops rediscovering the same operational facts each time.
4. The historical spec/plan record becomes navigable without being rewritten.

## Non-goals

- No code changes. Bugs found during verification are reported, not fixed.
- No deployment or production documentation — no Dockerfile or deploy config exists.
- No edits to the 34 historical specs/plans, except the roadmap baseline (below).
- No merge of this branch to `main`.

## Decisions

- **Language: English throughout.** The Vietnamese README sections are translated as they move
  into runbooks. Existing Vietnamese specs stay untouched as history.
- **Documentation describes this branch, not `main`.** The branch is 46 commits ahead;
  `main`-accurate docs would be wrong on merge. The status section states this explicitly rather
  than implying unmerged work is on `main`.
- **Historical specs and plans are indexed, not edited.** They are written history. A new
  `docs/README.md` carries the status; the files keep their original bytes.
- **HydroSHEDS documentation is retained, marked superseded.** `prune-hydrosheds-versions.mjs`
  exists because those dataset versions can still be present in a developer database, so a reader
  who encounters one needs the documentation to still exist.

## Deliverables

| File | Action | Contents |
|---|---|---|
| `README.md` | Rewrite, 259 → ~120 lines | Identity; architecture at a glance (4 services + role model); quickstart; complete scripts table; honest project status; docs index |
| `docs/architecture.md` | New | The system as it is today (detail below) |
| `docs/runbooks/admin-boundaries.md` | New (moved from README) | `fetch-boundaries.mjs`, simplification tolerance, why the step is mandatory |
| `docs/runbooks/osm-water.md` | New (moved from README) | The 7-step Overpass → seed pipeline and its three ordering constraints |
| `docs/runbooks/hydrosheds-legacy.md` | New (moved from README) | HydroSHEDS prep, marked superseded by OSM |
| `docs/README.md` | New | Status index of all 34 specs/plans + `docs/reports/dam-crosscheck.md` |
| `CLAUDE.md` | New | Agent-facing commands, conventions, landmines |
| `docs/superpowers/specs/2026-07-15-product-roadmap.md` §1 | Targeted edit | Refresh the baseline paragraph, which the document itself says is appended-to as items land |

The three data-regeneration runbooks are split rather than combined because their trigger
conditions differ: boundaries change when administrative units merge, OSM when fresher waterway
data is wanted, HydroSHEDS ideally never again. A single file would recreate the long-document
problem this design exists to fix.

### `docs/architecture.md` outline

1. **Service topology** — PostGIS, GeoServer, Fastify API, React frontend; the API is the only
   writer, GeoServer is read-only WFS, the API is the security boundary.
2. **`apps/web`** — Feature-Sliced layout (`app / pages / widgets / features / entities / shared`),
   with `components/` and `data/` noted as pre-FSD holdovers; the MVP rule that OpenLayers stays
   quarantined in `features/map/model/`.
3. **`apps/api`** — module map (`auth`, `users`, `layers`, `versions`, `audit`) and plugins
   (`errorHandler`, `security`, `db`, `authentication`).
4. **Dataset versioning** — migrations `…004`/`…005`, active-version views, and the fact that
   `versions` exposes **no HTTP routes**; it is internal-only, which the module list does not reveal.
5. **Persona and shell model** — roles vs. personas, the drawer/panel/top-bar structure.
6. **Region scoping and map performance** — `REGION_PROVINCE_CODES` as single source of truth,
   bbox-filtered WFS, zoom gates at 8.5 (rivers/lakes) and 10 (ward boundaries).

### `CLAUDE.md` contents

Commands that work; conventions (FSD, the OpenLayers quarantine, shared types as the source of
layer identity); and the landmines:

- `packages/shared/dist` is git-tracked — rebuild and commit it alongside source changes.
- `ingest:rivers` must run after `seed`, or the active `rivers` version is wrong.
- API tests hit a live PostGIS + GeoServer and are slow (1–2.5 min).
- `build:web` catches strict type errors that `vitest` (esbuild) skips.

## Verification method

| Claim type | Verified by |
|---|---|
| Quickstart and scripts-table commands | Executed: `build:shared`, `build:web`, `lint:web`, `test:shared`, `test:web`, `test:api`, `GET /health`, WFS GetCapabilities |
| Ports, env vars, CORS | Read `infra/docker-compose.yml`, `apps/api/.env.example`, `apps/api/src/config/`; cross-checked against the running stack |
| Architecture statements | Source-read; no claim ships without a file backing it |
| Destructive pipelines (`seed`, `ingest:rivers`, `publish:geoserver`, `fetch-osm-*`) | Script source only — **not executed**; they mutate the dev database and call Overpass |
| Spec/plan status | Mapped to code artifacts on this branch |

**Status determination.** A spec or plan is *shipped* when its code artifacts exist on this branch —
`.github/workflows/ci.yml` for the CI plan, `apps/web/src/features/user-management/` for the
user-management UI, `features/shell/` + `widgets/top-bar/` + `entities/persona/` for the adaptive
shell. Not "a commit message says so." Anything that cannot be mapped to code is marked **partial**
with a note on what is missing, rather than guessed in either direction. Roadmap items 2.3 and 2.4
(Governance and Research panels) are expected to land there: the adaptive-shell spec states it left
typed placeholders for them.

**Known side effect:** `test:api` runs 1–2.5 minutes against the live dev database and appends a
`dataset_version` row per run (`runSeeds()` has no idempotency guard). This is accepted because
"the test command works" is a load-bearing README claim.

## Definition of done

- Every command in the documentation has been executed or its source read.
- Every architectural claim points at a real file.
- The status index maps all 34 documents to code artifacts.
- The final report states which claims were verified by execution and which by reading.
