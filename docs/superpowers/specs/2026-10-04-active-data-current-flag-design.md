# S1 Active data: a current flag and version retention

**Status:** approved in brainstorming, 2026-10-04.
**Track:** first sub-project of the simulation track (S1 → restructure R1–R4 → S2–S5), and the "O1 + O2" group of the 2026-10-04 restructure/optimisation survey.

## Why

Two measurements on the dev database (2026-10-04):

- **Every read of the active state rebuilds the whole layer.** Each `water.<layer>_active` view walks the active version chain, keeps the nearest row per `external_id` (`DISTINCT ON`) and drops tombstones, and only then applies the caller's predicate: the view is an optimizer fence. A map-window query returning 65 lakes takes 1.4 s; `rivers_active` 0.55 s; `rivers_detail` (what GeoServer serves) 0.25 s. The planner estimates these views at one row, so joins on them become nested loops.
- **Versions are never removed.** 233 of 241 versions are outside every active chain. `water.lakes` is 744 MB for 131,512 rows, of which 3,868 are live.

Two hand-written copies of the resolution exist only to work around the first point: `candidateCtes` (`apps/api/src/modules/assistant/tools/data/helpers.ts`, nine callers) and `layerCtes` (`apps/api/src/modules/search/repository.ts`).

## Context from the simulation track

WebAtlas is heading towards a simulation game: a running clock (recorded keyframes, a separately built HEC-RAS surrogate for the in-betweens) and private, link-shareable sandbox scenarios. The main levers (weather/inflow, dam operations) are parameters keyed by feature, not edits to vector features. So the real atlas stays **one world**, which a single flag can describe, and a scenario only needs to **pin** the real-atlas versions it branched from. Retention must therefore never remove a pinned version. Scenarios themselves are S4; S1 only provides the pin.

## Decisions (user, 2026-10-04)

| | Decision |
|---|---|
| D1 | Serve the active state from a stored flag (`is_current`), not from per-request resolution, nor from materialised per-layer tables, nor from parameterised GeoServer views. |
| D2 | Retention per layer: the active chain, the two most recent earlier loads, and every pinned version with its chain to the root. |
| D3 | Pins live in `app.version_pins`; S1 creates the table, S4 writes it. |
| D4 | Code comments are English (applies to every file this work touches). |

## Design

### 1. The current flag

**Schema.** Each of the eight thematic tables (`water.dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`, `lakes`, `rivers`) gets `is_current boolean NOT NULL DEFAULT false`, and partial indexes `WHERE is_current` for the access paths readers use:

- `geom` (GiST);
- `province_codes`, `ward_codes` (GIN);
- `name gin_trgm_ops` (GIN);
- `external_id` (btree).

The existing full indexes stay: resolving a version that is not active (river hierarchy, gates, loader, edit sessions) still uses them.

**Meaning.** `is_current = true` exactly when the row is what the layer's active chain resolves its feature to, and that row is not a tombstone. Superseded rows, tombstones, rows of drafts and rows of inactive versions are never current.

**Owner.** Only `versionsService.activate()` writes the flag. It is already the single contract every path to "active" goes through (ingest, edit commit, any later rollback). After the active pointer moves, in the caller's transaction:

1. `UPDATE water.<layer> SET is_current = false WHERE is_current`;
2. `UPDATE water.<layer> SET is_current = true WHERE id IN (<resolved ids of the new active chain>)`, the ids coming from `versionsRepository.resolvedSql` (§2).

Readers in other transactions see the old state or the new one, never a mix. Only the eight thematic layers are flagged; the synthetic layer keys that versioning tests activate have no table and are skipped, as stamping already does.

**Views.** Each `water.<layer>_active` becomes `SELECT <the same columns> FROM water.<layer> WHERE is_current`. Same name, same columns, same order, so `rivers_detail`, `rivers_overview`, GeoServer and `run_sql`'s allow-list need no change. PostgreSQL inlines such a view, so a caller's predicate reaches the partial indexes.

### 2. Readers

- `candidateCtes` and `layerCtes` are deleted. Their callers query `water.<layer>_active` directly with their real predicate: map window, admin codes, name match, attribute filter, or `ORDER BY geom <-> … LIMIT` for nearest. Callers: assistant tools `areaOf`, `distanceBetween`, `featuresInAdminUnit`, `featuresInView`, `filterByAttribute`, `relatedFeatures`; analysis `nearest`, `selectWithin`; `roi/resolve`; `search/repository`.
- **One resolver for a given version:** `versionsRepository.resolvedSql(layerKey, chain)`. It is used to set the flag, by `resolveFeatureIds`, and by any code that must see a version that is not active yet. The river hierarchy and gates keep their own chain resolution for the version being activated. If it duplicates `resolvedSql`'s logic, it is rewritten to call it, so there is one definition of what a version resolves to.
- **Rule:** the active state is read through the `*_active` views only. A test scans `apps/api/src` for SQL that reads `water.<layer>` without `_active`, and fails outside an allow-list: the layers repository's write path and the scripts that build derived data.

### 3. Retention

**Rule, per layer.** Keep:

1. every version of the active chain;
2. the two most recent ingest versions outside the active chain (by `ingested_at`), with all of their descendants;
3. every version in `app.version_pins`, with its chain to the root.

Delete every other version of the layer: first its rows in `water.<layer>`, then its `app.dataset_versions` row. The kept set is closed under "ancestor of", so `parent_version_id ... ON DELETE CASCADE` can never remove a kept version. `pruneVersions` asserts this before deleting and throws if it does not hold.

**`app.version_pins`:** `version_id uuid NOT NULL REFERENCES app.dataset_versions(id) ON DELETE RESTRICT`, `holder text NOT NULL` (for example `scenario:<uuid>`), `created_at timestamptz NOT NULL DEFAULT now()`, primary key `(version_id, holder)`.

**`pruneVersions(client, layerKey)`** lives in `packages/versioning` and returns the number of versions and rows removed. Called:

- by `activate()`, after the flag, in the same transaction;
- by the `load-geojson` loader's "content unchanged" path, under the layer lock it already holds;
- by `ensureSeeded` for a layer it finds unchanged (through the same loader core).

So an existing machine's backlog goes at its next `atlas:build`, `atlas:seed` or API test run. The dev database is expected to drop from 241 versions to about 24.

Space is reused by PostgreSQL, not returned to the operating system. Nothing runs `VACUUM FULL`.

### 4. Migration `1000000000022_current-flag`

1. Add `is_current` to the eight tables.
2. Backfill it from each layer's active chain, with the same resolution the old views used.
3. Create the partial indexes.
4. `CREATE OR REPLACE` the eight `*_active` views as the filter.
5. Create `app.version_pins`.
6. Set `app.dataset_versions.ingested_at`'s default to `clock_timestamp()` (added while planning): retention orders loads by `ingested_at`, and `now()` gives every version created in one transaction the same time.

The backfill writes data, an exception to "migrations create tables, the pipeline populates". The flag is part of the schema change: without it the views would return nothing until each layer's next activation. The migration does not prune. `down` restores the old view definitions and drops the column, the indexes and the table.

### 5. Error handling

- A failure while setting the flag or pruning fails `activate()`, so the caller's transaction rolls back with the previous version still active and still flagged.
- `pruneVersions` never deletes a version that has a pin, is in the active chain, or is an ancestor of one. A violated invariant throws; it does not skip.
- A pin pointing at a version cannot be removed by pruning (`ON DELETE RESTRICT` as a second guard).

## Testing

- **Equivalence (versioning package, database):** for each of these cases, the flagged rows of the layer equal `resolvedSql` over the active chain: an ingest, an edit commit with a change and a tombstone, a discarded draft (flags unchanged), and a second ingest.
- **Views:** for every layer on a migrated database, `*_active` returns the same rows as the old definition. The migration test compares them before and after.
- **Retention (versioning package, database):** a layer with five loads and an edit chain keeps the active chain and two earlier loads with their edits. A pinned version from the oldest load survives with its chain. The cascade assertion throws on a constructed violation. A discarded draft leaves nothing behind.
- **Readers:** the existing API tests of assistant tools, analysis, ROI and search pass with unchanged assertions; the guard test of §2.
- **Loader / `ensureSeeded`:** an unchanged layer is pruned; the version count is the same on a second run.
- **Measured on dev, recorded in the plan's notes:**
  - the survey's map-window queries on `lakes_active` and `rivers_active` under 50 ms each, with `EXPLAIN` showing the partial GiST index;
  - at most three loads per layer after one `atlas:seed`;
  - `rivers` activation at most 2 s slower than today;
  - `atlas:verify` 50/50.

## Out of scope

- A rollback command (activating a kept earlier load).
- Creating scenarios, or writing `app.version_pins` outside tests (S4).
- Dropping the old full indexes, to be revisited once the readers are measured.
- `VACUUM FULL`, and any storage-reclaim step.
- The web app (it reads through GeoServer and the API, both unchanged in shape).
