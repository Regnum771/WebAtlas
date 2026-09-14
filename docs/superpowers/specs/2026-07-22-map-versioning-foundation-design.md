# Map Versioning & Provenance Foundation — Design

**Status:** approved (design), not yet implemented
**Branch:** new branch off `main` (independent of the selection-panel PRs).
**Context:** the app is growing from a single seed pipeline into one that ingests multiple evolving external datasets (HydroLAKES, HydroRIVERS, updated dams, government feeds) into one PostGIS store. That, plus a desired ability to roll the thematic map back to a previous version on a timeline, requires the map's data to be *versioned* rather than overwritten in place.

This is **sub-spec #1 of a larger HydroSHEDS effort**. The full effort decomposes into: (#1) this versioning & provenance foundation → (#2) HydroSHEDS sourcing (lakes + rivers) → (#3) layer integration → (#4) cross-layer relationships (dam ↔ reservoir ↔ river). Each is its own spec → plan → build cycle. #1 comes first so every ingest and edit downstream records into it from day one instead of being retrofitted.

## Problem

- Feature tables are **overwritten** on re-ingest (`SEED_LAYERS` seeding truncates/reloads), so a prior dataset release is lost the moment a new one lands.
- There is **no record of where a feature came from** — tables carry `created_at`/`updated_at`/`external_id` but no source or version. `SEED_LAYERS` knows the source file at seed time; that knowledge is not persisted.
- Steward edits **mutate rows in place** (`layers/service.ts` `update`/`remove`), so the map has no notion of "the state before this edit session" beyond the append-only `app.audit_log`.
- There is no way to address "the thematic map as of version N," which a timeline scrubber (future) requires.

## What already exists (do not rebuild)

- `app.audit_log` + `auditService.record()` — captures every create/update/delete with `before`/`after` jsonb, `user_id`, `table_name`, `feature_id`, `created_at`. **Already wired** into `layers/service.ts` and `users/service.ts`. This stays as-is: it is the fine-grained edit trail *within* a version, a separate concern from dataset/edit versioning.
- Water feature tables have `created_at`, `updated_at`, and a **globally-unique** `external_id`, plus a GiST index on `geom` (`water-schema` migration).
- `SEED_LAYERS` registry (`seeds/registry.ts`) — per-layer source file + column mapping.

## Scope

**In scope:**
- A `app.dataset_versions` registry: one row per version of a layer, carrying provenance (source, version label, ingest date, actor, count) and an active flag.
- A `dataset_version_id` column on each thematic feature table; `external_id` uniqueness becomes per-version.
- An **ingest path** that creates a new *full, independent* version instead of overwriting.
- An **edit-session** model: steward edits accumulate in a working state and, on explicit commit, publish as a new *copy-on-write* version off the active one.
- **Active-version selection** and version-scoped serving, so the default map is unchanged for users and any version is addressable.
- Backfill of existing seed data as each layer's "version 1".

**Explicitly out of scope (later sub-specs / tracks):**
- The **timeline scrubber UI**. This spec makes versions addressable; the frontend control that scrubs them is a later sub-spec. This spec must expose a clean "serve version X" seam for it.
- **Satellite imagery** through time — a separate raster/basemap system, deferred entirely.
- The actual **HydroSHEDS data** — sourcing is sub-spec #2. This builds the machinery those ingests use, proven against the existing seed layers.
- **Branch/merge** of versions. Edit sessions are linear off their parent; there is no divergent-branch merge.
- Changes to `app.audit_log` or the edit trail's read side (feature-level restore/diff).

## §1 — Two kinds of version

The model has exactly two ways a version comes into being, and they are stored differently because they *are* different:

- **Ingest version** — a full external dataset release (HydroLAKES v10, then v11). Two upstream releases are genuinely independent, so an ingest version is **full and standalone**: it contains a complete, self-sufficient set of that layer's features. Resolving it is a flat filter.
- **Edit version** — the published result of a steward edit session. It is ~99% identical to its parent, so it is **copy-on-write**: it stores only the features the session changed (created/updated/deleted) and inherits the rest from its parent chain. Resolving it walks the chain to the underlying ingest version.

This hybrid is deliberate (chosen over full-copy-everywhere, which bloats edit history, and copy-on-write-everywhere, which makes ingests needlessly indirect). The cost — two resolution paths — is accepted and localized to one resolver (§4).

## §2 — The `dataset_versions` registry

`app.dataset_versions` is the spine and doubles as the provenance record.

| column | type | purpose |
|---|---|---|
| `id` | uuid pk | the version id features reference |
| `layer_key` | text notNull | which thematic layer (`dams`, `lakes`, `rivers`, …) |
| `kind` | enum `ingest` \| `edit` notNull | which resolution path applies (§4) |
| `parent_version_id` | uuid null → `dataset_versions(id)` | the version this edit-version derives from; null for ingest versions |
| `source` | text notNull | origin (`HydroLAKES v10`, `thuydienvietnam.geojson`, `edit session`) |
| `source_version` | text null | upstream version label, when applicable |
| `label` | text notNull | human name for the timeline (`"HydroLAKES v10"`, `"2026-07-22 edits"`) |
| `ingested_at` | timestamptz notNull default now() | when created |
| `ingested_by` | uuid null → `app.users` | actor; null for seeds |
| `feature_count` | integer null | for an ingest version, the rows it holds (its resolved total); for an edit version, the number of features the session *changed* (rows it stores), not the resolved total — the resolved total is derived on demand via §4 and not persisted, to keep commit O(changes) |
| `is_active` | boolean notNull default false | the version the live map serves |
| `notes` | text null | free text |

**Constraints:**
- Partial unique index `unique (layer_key) where is_active` — the database refuses two active versions of a layer. "The current map" is always unambiguous.
- `kind = 'edit'` rows must have a non-null `parent_version_id`; `kind = 'ingest'` rows must have a null one. Enforce with a check constraint.
- Index on `layer_key` (every version query filters by it).

## §3 — Feature tables gain a version column

Each thematic feature table gets:

- `dataset_version_id uuid notNull → app.dataset_versions(id)`, indexed (every version-scoped query filters on it).
- For edit versions' copy-on-write, a **tombstone** marker so a version can express "this inherited feature is deleted here": `deleted boolean notNull default false`. An edit version that removes a feature stores a row for it with `deleted = true`; ingest versions never set it.
- `external_id` uniqueness changes from **global** to **per-version**: drop the existing unique index on `external_id`, add `unique (dataset_version_id, external_id)`. Without this, a second ingest carrying the same upstream ids fails on duplicate keys.
- Keep the GiST index on `geom`.

**Backfill (in the same migration):** for each existing thematic layer, create one `dataset_versions` row — `kind = 'ingest'`, `source` = the current seed file, `label = "version 1"`, `is_active = true` — and stamp every existing feature's `dataset_version_id` to it. Existing data becomes version 1 rather than an unversioned special case, and the current map keeps working unchanged.

## §4 — Version resolution (the one place the two kinds diverge)

A single resolver answers "give me the feature set for version V":

- **V is an ingest version:** `select * from <table> where dataset_version_id = V and not deleted`. Flat.
- **V is an edit version:** walk `parent_version_id` from V up to its root ingest version, producing an ordered chain `[V, …, ingest]`. A feature's effective row is the one from the *nearest* version in the chain that has a row for that `external_id`; if that nearest row is a tombstone (`deleted = true`), the feature is absent. In SQL this is a `distinct on (external_id)` over the chain ordered by chain position, filtering out tombstones.

This resolver is the seam the future timeline scrubber and the version-scoped WFS view (§5) both call. It is the *only* code that knows about the two kinds; everything else asks it for "the features of version V".

## §5 — Serving the active version

- GeoServer/WFS currently serves each feature table directly. It moves to serving, per layer, a **view that resolves the active version** — i.e. the §4 resolver applied to `(select id from dataset_versions where layer_key = ? and is_active)`. For the common case (active version is an ingest version, e.g. today's backfilled version 1) this view is a simple filter; when the active version is an edit version it is the chain resolve.
- Users see exactly what they see today — the active version — with **no client change**.
- A specific non-active version is reachable by resolving it directly. That is the seam the timeline scrubber plugs into later; this spec does not build the UI, only guarantees the seam exists and is queryable.

## §6 — Ingest creates a full version

The seed/ingest path changes from overwrite to append-a-version, in one transaction:

1. Insert a `dataset_versions` row: `kind = 'ingest'`, `parent_version_id = null`, source/label metadata from `SEED_LAYERS`, `is_active = false`.
2. Load the features, each stamped with the new `dataset_version_id`.
3. Atomically flip active: clear the layer's current `is_active`, set the new one.

If any step fails, the transaction rolls back and the previously-active version is untouched — no half-loaded map. `SEED_LAYERS` gains the source/label metadata; seeds run through this same path, so "version 1" is just the first ingest, not a special case. One code path, not seed-vs-ingest.

## §7 — Edit sessions publish as a copy-on-write version

This replaces the in-place mutation in `layers/service.ts` (`update`/`remove` currently write the live row directly).

- **Working state.** A steward's edits within a session do not mutate the active version. They accumulate as pending changes associated with an open edit session. (Storage of pending edits — a `draft` edit-version row created on session start, written to as the steward works, and only made `is_active` on commit — is the natural fit: the draft is a real `kind = 'edit'` version with `is_active = false` and `parent_version_id` = the active version at session start.)
- **Commit.** Publishing the session sets the draft edit-version active (clearing the parent's active flag), atomically. The timeline gains one labeled editorial version.
- **Discard.** Abandoning the session deletes the draft edit-version and its pending rows; the active version never moved.
- **What a committed edit-version stores:** only the features the session created/updated (as rows under the new `dataset_version_id`) or deleted (as tombstone rows). Everything untouched is inherited via §4.
- **The audit_log is unchanged** — each edit still records create/update/delete with before/after. Audit is the within-session fine trail; the edit-version is the published coarse checkpoint. They are complementary.

**Consequence, stated as a decision:** an edit belongs to the version it was committed in. Rolling the active pointer back to an older version and forward again does not reapply a later version's edits — versions are discrete points, not a rebased sequence. This is the intended "discrete releases" semantics.

## Architecture touchpoints

```
apps/api/src/db/migrations/*            (new) — dataset_versions table; per-table
                                                dataset_version_id + deleted; drop global
                                                external_id unique, add composite; backfill v1
apps/api/src/db/seeds/registry.ts       (modify) — SeedLayer gains source/label metadata
apps/api/src/db/seeds/run.ts            (modify) — ingest-as-version transaction (§6)
apps/api/src/modules/versions/          (new)  — dataset_versions repo + service; the §4 resolver
apps/api/src/modules/layers/service.ts  (modify) — edit-session working state + commit/discard (§7);
                                                writes go to the draft edit-version, not the live row
apps/api/src/geoserver/*                (modify) — serve the active-version resolving view per layer (§5)
apps/api/src/layers/registry.ts         (modify) — layer defs reference their resolving view
```

## Testing

- **Migration/backfill** — after migrate, every existing layer has exactly one `is_active` ingest version; every feature carries its `dataset_version_id`; the composite `(dataset_version_id, external_id)` unique holds and the old global unique is gone.
- **`dataset_versions` constraints** — two active versions of one layer is rejected; an `edit` row with null parent and an `ingest` row with a parent are both rejected.
- **Resolver (§4)** — an ingest version resolves as a flat set; an edit version off it resolves to parent features overlaid by the session's changes, with tombstoned features absent; a two-deep edit chain resolves nearest-wins.
- **Ingest (§6)** — a second ingest of a layer creates a new active version, leaves the prior version's rows addressable, and a mid-ingest failure rolls back with the old version still active and served.
- **Edit session (§7)** — edits before commit do not change what the active-version view serves; commit makes them serve and creates one labeled edit-version; discard leaves no trace; the audit_log still records each edit.
- **Serving (§5)** — the active-version view returns today's data for a backfilled ingest version and the resolved data for an active edit version; a non-active version is directly resolvable.
- **No client regression** — existing WFS consumers see the active version unchanged.

## YAGNI — not doing

- No timeline scrubber UI (later frontend sub-spec) — only the addressable-version seam.
- No satellite imagery / temporal raster (separate track).
- No branch/merge of versions — edit sessions are linear off their parent.
- No arbitrary-timestamp reconstruction — versions are discrete releases, not a continuous time axis.
- No changes to the feature-level audit trail's read side (restore/diff from audit_log).
- No cross-layer relationships (dam ↔ reservoir ↔ river) — sub-spec #4.
- No automatic version pruning/retention policy — versions accumulate; a retention policy is future work if storage warrants it.
