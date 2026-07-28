# HydroSHEDS Hydrology Data — Lakes Layer + Rivers Replacement — Design

**Date:** 2026-07-28
**Status:** Approved design — ready for implementation planning
**Branch:** builds on the map-versioning foundation (`feat/map-versioning-foundation`, sub-spec #1); new branch off it (or off `main` once #1 lands).

## 1. Framing & scope

This is **product-roadmap item 3.2 "Improve hydrology data"**, reconciled with the **HydroSHEDS effort** decomposition introduced in the map-versioning design (`2026-07-22-map-versioning-foundation-design.md`). That design frames the effort as: **#1** versioning & provenance foundation → **#2** HydroSHEDS sourcing (lakes + rivers) → **#3** layer integration → **#4** cross-layer relationships.

Sub-spec #1 (versioning foundation) is already built on the current branch (ingest versions, edit sessions, the resolver, and per-layer `<layer>_active` GeoServer views are committed). This spec is therefore **#2 (sourcing) + #3 (integration) combined**, delivering two user-visible outcomes:

- **(a) New `lakes` layer** — a fully editable `water.lakes` MultiPolygon layer sourced from **HydroLAKES**, styled bright-blue, so lakes/reservoirs render as real app water bodies instead of the basemap's own faint fill.
- **(b) Rivers replacement** — **HydroRIVERS** (Vietnam clip) ingested as a **new active ingest version** of the existing `rivers` layer, replacing the coarse `thuyhe.geojson` data. `thuyhe` stays addressable as rivers **version 1**; HydroRIVERS becomes **version 2** and active.

**Why one spec:** both are the same "improve hydrology data" effort, both use the HydroSHEDS family (HydroLAKES/HydroRIVERS share lineage, licence, and the versioned-ingest machinery), and both are exercised end-to-end by the same test and `/run` verification.

**Confirmed decisions (from brainstorming):**

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | Both lakes layer **and** rivers replacement, in one spec |
| 2 | Lake dataset | **HydroLAKES** (HydroSHEDS family) |
| 3 | River dataset | **HydroRIVERS** (HydroSHEDS family; carries Strahler `ORD_STRA`) |
| 4 | Ingest path | Offline prep (`ogr2ogr` clip/normalize) → committed clipped **GeoJSON** → existing seed/ingest pipeline |
| 5 | Rivers versioning | HydroRIVERS is a **new active ingest version** (v2); thuyhe stays as addressable v1 |
| 6 | Lakes CRUD | **Fully editable** layer, like the other 7 (`EDITABLE_LAYER_KEYS`, registry, attribute form) |

### 1.1 Out of scope (later / other specs)

- **Cross-layer relationships** (dam ↔ reservoir ↔ river) — HydroSHEDS sub-spec **#4**; its own later spec.
- **Timeline-scrubber UI** — deferred by the versioning spec; this spec makes versions addressable but adds no scrubber.
- **Satellite / EO** — the separate raster subsystem; untouched.
- **Deriving the GeoServer `TABLES` list from the registry** — noted as a small INV-2 seam (§4.5); a follow-up, not this spec.

## 2. Offline data prep (reproducible, one-time)

HydroLAKES and HydroRIVERS ship as large global shapefiles/geodatabases. We do **not** commit the raw multi-GB data or pull GDAL into the runtime. A documented, reproducible prep step produces small **clipped GeoJSON** files that the existing seed/ingest pipeline loads — exactly like `thuyhe.geojson` today.

- **Script:** `apps/api/scripts/prep-hydrosheds.sh` (documented, run by a developer once; **not** run in CI). Uses `ogr2ogr` to, for each dataset:
  - **Clip** to Vietnam's extent (~`[102, 8, 110, 24]` lon/lat — generous enough to catch cross-border basins).
  - **Normalize** to EPSG:4326 (HydroSHEDS is already 4326; this asserts/normalizes rather than truly reprojecting).
  - **Select** only the attributes we keep (see §3.2, §4.3), dropping the ~50 unused HydroSHEDS columns to keep files lean.
  - **Output** `hydrolakes-vn.geojson` and `hydrorivers-vn.geojson` into `apps/api/src/db/seeds/data/`.
- **Committed artifacts:** the two clipped GeoJSON files (the seed inputs). The prep script plus a README section document how to regenerate them from the upstream downloads — **source URLs and dataset versions recorded** — so the derivation is reproducible while the raw data never enters the repo.
- **Size guard:** the VN HydroRIVERS clip can still be large (tens of thousands of segments). Before committing, verify the clipped file is a reasonable size; if HydroRIVERS-clipped is too heavy, filter by a minimum stream order (`ORD_STRA >= N`) during prep. That threshold is a **documented prep parameter**, not runtime code.

## 3. The `lakes` layer, end-to-end

Adding `lakes` touches every "add a layer" seam. Per **INV-2** (registry is the one catalog) and **INV-4** (attribute schema has one definition), the layer key and attribute schema have single definitions everything else derives from.

### 3.1 Shared types (`packages/shared`) — the single source (INV-4)

- Add `'lakes'` to `EDITABLE_LAYER_KEYS` (7 → 8 layers). `layers.test.ts` `.toHaveLength(7)` becomes `8`.
- Add `lakes: 'MultiPolygon'` to `LAYER_GEOMETRY`.

### 3.2 Migration (new `node-pg-migrate` file)

Creates `water.lakes` following the existing table pattern **plus** the versioning columns the foundation added:

- `geom geometry(MultiPolygon, 4326)` + GiST index.
- Audit columns: `id` (uuid pk), `created_at`, `updated_at`, `created_by`/`updated_by` (fk `app.users`).
- `name` (text) + HydroLAKES attributes: `lake_type` (text), `area_km2` (numeric), `volume_mcm` (numeric — total lake volume), `shore_len_km` (numeric).
- `external_id` typed **integer** (HydroLAKES `Hylak_id`).
- Versioning columns matching §3 of the versioning spec: `dataset_version_id uuid notNull → app.dataset_versions(id)` (indexed); `deleted boolean notNull default false`; `unique (dataset_version_id, external_id)` (per-version, not global).
- The `lakes_active` resolving view, created the same way the versioning migration created the other seven, so GeoServer serves the active version.

### 3.3 API layer registry (`apps/api/src/layers/registry.ts`)

Add the `lakes` entry to `ATTRS` (`name`, `lake_type`, `area_km2`, `volume_mcm`, `shore_len_km`) and `EXTERNAL_ID_TYPE['lakes'] = 'integer'`. `geomNullable` is `false` (a lake must have geometry). CRUD and validation are then generic across all 8 layers — no per-layer code.

### 3.4 Seed registry (`apps/api/src/db/seeds/registry.ts`)

Add a `lakes` `SeedLayer`: `file: hydrolakes-vn.geojson`, `source: 'HydroLAKES v10'`, `multiPolygon: true`, and a `columns` mapper:

```
external_id: p.Hylak_id,
name:        p.Lake_name,
lake_type:   LAKE_TYPE_LABEL[p.Lake_type],   // HydroLAKES Lake_type is a coded int (1=Lake, 2=Reservoir, 3=Lake control); map to a label
area_km2:    p.Lake_area,
volume_mcm:  p.Vol_total,
shore_len_km: p.Shore_len,
```

The `Lake_type` code→label map is a tiny lookup defined alongside the seed mapper (analogous to `assignDamStatus`).

Seeding creates lakes **version 1** through the versioning pipeline, the same backfill path every other layer uses.

### 3.5 GeoServer publication (`apps/api/src/geoserver/publish.ts`)

Add `'lakes'` to the `TABLES` array; `publishAll()` then publishes `webatlas:lakes` pointed at the `lakes_active` view. This hardcoded `TABLES` list is a small **INV-2 seam** — it must stay in sync with `EDITABLE_LAYER_KEYS`. Deriving it from the registry is a follow-up, out of scope here (§1.1).

## 4. Rivers replacement as a new active ingest version

Rather than editing the `rivers` seed source in place, HydroRIVERS enters through the **ingest path** (§6 of the versioning spec): a full, standalone new version, active flag flipped atomically.

### 4.1 thuyhe stays as rivers v1

The existing seed already produces `rivers` version 1 from `thuyhe.geojson`. We don't touch that history — it stays addressable for rollback, which is the entire point of sub-spec #1.

### 4.2 HydroRIVERS ingested as rivers v2, made active

Using the already-built `versionsService` ingest + atomic active-flip, ingest `hydrorivers-vn.geojson` as a new **ingest**-kind version of `rivers`, then flip `is_active` to it. The `rivers_active` view already backs GeoServer's `webatlas:rivers`, so WFS consumers see HydroRIVERS **with no republish** — the frontend needs no change to *receive* the new data.

### 4.3 Attribute mapping (no schema change)

HydroRIVERS → the existing `rivers` columns, so the schema and the existing style keep working:

```
external_id:  p.HYRIV_ID,          // stable upstream id (cleaner than thuyhe's positional key)
stream_order: p.ORD_STRA,          // Strahler order → feeds riverBucket() (see §4.4)
length_m:     p.LENGTH_KM * 1000,
name:         null,                // HydroRIVERS has no per-segment names
code:         null,
```

Rivers are styled by order, not labelled, so null names are acceptable.

### 4.4 Stream-order style re-tuning (required — a real visible issue)

`thuyhe`'s `Cap` was ~1–6; HydroRIVERS `ORD_STRA` is Strahler ~1–10. The current `riverBucket()` maps cap 1/2/3 to distinct widths and **everything else to the thin default** — so high-order (major) HydroRIVERS rivers would all fall into the *thin* bucket, backwards from reality. `riverBucket()` and `RIVER_WIDTHS` **must be re-mapped for Strahler order: higher order → wider stroke.** Covered in §6 by both a unit test and `/run`.

### 4.5 How the ingest is invoked

A repeatable seed/ingest command (or seed-run step) that calls the existing `versionsService` ingest for `rivers` with the HydroRIVERS file. It is **idempotent**: re-running does not create a duplicate active v2 — it detects the existing HydroRIVERS version by source/label and no-ops the second create.

## 5. Frontend styling & layer wiring

Small, localized to `apps/web/src/features/map`.

### 5.1 Lakes style (`model/styles.ts`)

A new `lakesStyle` — bright-blue water matching the rivers palette, **Fill + Stroke** (rivers are stroke-only; a polygon water body needs a fill):

- Fill `rgba(56, 189, 248, 0.35)` (sky-400, semi-transparent so basemap terrain/labels read through) — consistent with the rivers' `#38bdf8` core.
- Stroke `#0284c7` (sky-600), width ~1.
- A single static `Style` (no per-feature variance), like `floodStyle`.

### 5.2 Lakes layer in `model/MapModel.ts`

One `mkWfs('layer_lakes', 'lakes', lakesStyle)` call, inserted into the `layers: [...]` array **below rivers** (line rivers draw on top of lake fills, matching real cartography). Lakes join `layerStates` and the layer panel derived from `GET /api/layers` (INV-2), so the panel entry appears automatically — no hand-maintained panel list. Lakes get attribute popups for free through the generic path.

### 5.3 Rivers style re-tuning (from §4.4)

`RIVER_WIDTHS` + `riverBucket()` re-mapped so higher Strahler order → wider stroke. The paired border/core two-`Style` structure and the `RIVER_SELECT_STYLES` highlight variant stay; only the order→width mapping changes.

### 5.4 Unchanged

`wfsSource.ts` (keys off the layer key), the 4326→3857 reproject path, and the popup/select machinery are untouched.

## 6. Testing strategy

Following §11 of the backend design: API integration tests against throwaway PostGIS; frontend presenter/view/model units with no network/map.

### 6.1 API / data pipeline

- **Schema/migration** (`db/schema.test.ts`): `water.lakes` exists with `MultiPolygon/4326` geom + GiST index, the versioning columns (`dataset_version_id`, `deleted`), the per-version `unique (dataset_version_id, external_id)`, and `lakes_active` resolves.
- **Seed** (`db/seeds/seed.test.ts`): seeding `hydrolakes-vn.geojson` creates lakes **version 1** with the expected row count and correctly mapped attributes; idempotent re-run doesn't duplicate.
- **Registry** (`layers/registry.test.ts`): `lakes` present with the right geom type, attribute columns, `externalIdType: 'integer'`; generic CRUD validates a lake feature.
- **Rivers new-version ingest** (`modules/versions/integration.test.ts`): ingesting HydroRIVERS as a second `rivers` version creates an **ingest**-kind version, flips active atomically, leaves thuyhe v1 addressable, and `rivers_active` resolves to HydroRIVERS rows; re-ingest is idempotent (no duplicate active v2).
- **GeoServer publish** (`geoserver/publish.test.ts`): `lakes` is published pointing at `lakes_active`.
- **Shared** (`layers.test.ts`): length is 8 and contains `lakes`; geometry/attribute round-trip tests cover `lakes`.

### 6.2 Frontend

- **`model/styles.test.ts`**: `lakesStyle` yields a Fill + Stroke; the re-tuned `riverBucket`/`RIVER_WIDTHS` maps a high Strahler order to a **wider** width than a low one (locks in §4.4 against regression).
- MapModel wiring is covered at existing test altitude (no new MapModel suite — consistent with the codebase, which has none).

### 6.3 Manual `/run` verification (required, not optional)

After ingest, launch the app and confirm the roadmap exit criteria — the one thing unit tests can't assert:

1. Lakes render as **bright-blue filled water bodies** over the basemap (not basemap fill).
2. HydroRIVERS **traces real watercourses**, with major rivers visibly **wider** than headwaters.

## 7. Exit criteria

From roadmap 3.2: *"Rivers trace real watercourses at usable detail; lakes/reservoirs render as a styled app water-body layer, not basemap fill."* Plus: thuyhe remains addressable as rivers v1, and the new `lakes` layer is fully editable through the existing admin CRUD flow.
