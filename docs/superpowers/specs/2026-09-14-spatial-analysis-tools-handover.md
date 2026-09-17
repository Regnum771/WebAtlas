# Spatial Analysis Tools — Handover

**Date:** 2026-09-14
**Status:** Handover / assessment, written 2026-09-14 with no code changes. Amended 2026-09-15: elevation accepted,
built and **loaded** (§6.4), cursor elevation readout shipped, and terrain contours **built and published**
(§6.5). Everything else is still assessment.
**Audience:** The engineer who will add the next spatial analysis tools to the map assistant.
**Scope:** What exists today, how it is wired to the data and the browser, whether the tool layer should be restructured first, and which tools to add next.

**Read first:** [docs/runbooks/map-assistant.md](../../runbooks/map-assistant.md) (operations, cost, known limits) and
[2026-09-07-ui-overhaul-and-map-assistant-design.md](2026-09-07-ui-overhaul-and-map-assistant-design.md) (why the assistant is shaped this way).

---

## 1. Summary for the impatient

- All spatial analysis lives in **one place**: the assistant tool registry at
  [apps/api/src/modules/assistant/tools/](../../../apps/api/src/modules/assistant/tools/). 14 tools, one file each,
  registered in a fixed list. Adding a capability = one file + one line. There is no dispatcher to edit.
- The only spatial code **outside** that registry is client-side measuring
  ([useMeasure.ts](../../../apps/web/src/features/map/model/useMeasure.ts)), which never touches the database.
- The biggest functional gap is not exotic: **no tool returns a feature's attributes.** The assistant can find a dam
  and measure it, but cannot state its installed capacity without the optional SQL escape hatch.
- The biggest structural gap: **province and ward polygons are not in PostGIS**, they are GeoJSON files served to the
  browser. Every "which province is this in / how many in Đắk Lắk" question is therefore unanswerable except by a bbox
  approximation. Loading them is the single highest-value unlock, and the data is already in the repo.
- **Restructure verdict: yes, but narrowly.** Four targeted extractions (§5.3), roughly a day, worth doing *before*
  the next three tools land — not a framework, and not a rewrite of the existing six.
- **A 30 m bare-earth DEM is loaded** (FABDEM V1-2; decided 2026-09-14, loaded and re-sourced 2026-09-15, §6.4) — a capability bet rather than a
  backlog item, and the first dataset each developer must generate locally instead of pulling from git. One tool reads
  it so far; every box needs [the runbook](../../runbooks/elevation-dem.md) run once or elevation answers "không có dữ liệu".
- **Terrain contours are built and published** (§6.5): three GWC-cached layers
  (`webatlas:contours_250/100/50`) over `basemap.contours`, a panel toggle with interval
  and label sub-options, on the second dataset each developer generates locally — see
  [the runbook](../../runbooks/terrain-contours.md).

---

## 2. Current tools

14 tools are registered ([registry.ts:27](../../../apps/api/src/modules/assistant/tools/registry.ts#L27)); `run_sql`
is conditional on `ASSISTANT_DATABASE_URL` being set, so a default dev box advertises 12.

### 2.1 Data tools — query PostGIS, return facts + provenance

| Tool | File | What it answers | PostGIS | Notes |
|---|---|---|---|---|
| `features_in_view` | [featuresInView.ts](../../../apps/api/src/modules/assistant/tools/data/featuresInView.ts) | "how many X here / on screen" | `ST_MakeEnvelope`, `&&` | Falls back to `ctx.mapContext.bbox`. Counts in full, lists ≤ 25 |
| `nearest_features` | [nearestFeatures.ts](../../../apps/api/src/modules/assistant/tools/data/nearestFeatures.ts) | "nearest / closest to" | KNN `<->`, then `ST_Distance(geography)` | Bounded over-fetch (×20) plus an exact-query fallback |
| `related_features` | [relatedFeatures.ts](../../../apps/api/src/modules/assistant/tools/data/relatedFeatures.ts) | "X within N km of feature Y" | `ST_DWithin` (degrees, then metre re-check) | Anchored on a *feature*, not a coordinate. Max 200 km |
| `distance_between` | [distanceBetween.ts](../../../apps/api/src/modules/assistant/tools/data/distanceBetween.ts) | "how far from A to B" | `ST_Distance(geography)` | Two prefixed CTE chains, one per side |
| `area_of` | [areaOf.ts](../../../apps/api/src/modules/assistant/tools/data/areaOf.ts) | "area of this polygon" | `ST_Area`, `ST_Perimeter` | **Polygon layers only** — refuses points and lines |
| `filter_by_attribute` | [filterByAttribute.ts](../../../apps/api/src/modules/assistant/tools/data/filterByAttribute.ts) | "dams with status Operating" | none (attribute `ILIKE`) | Column allowlist per layer. Contains/equality only, no ranges |
| `locate_place` | [locatePlace.ts](../../../apps/api/src/modules/assistant/tools/data/locatePlace.ts) | "where is Buôn Ma Thuột" | `ST_X` / `ST_Y` | Gazetteer over `basemap.places_region` (~6,100 rows). Exists because the model invented coordinates otherwise |
| `elevation_at_point` | [elevationAtPoint.ts](../../../apps/api/src/modules/assistant/tools/data/elevationAtPoint.ts) | "how high is this place" | `ST_Value` over `basemap.dem_region` | Added 2026-09-15. Answers "không có dữ liệu" until a developer loads the DEM ([runbook](../../runbooks/elevation-dem.md)). Bare earth (FABDEM), so ground level, not canopy |
| `run_sql` | [runSql.ts](../../../apps/api/src/modules/assistant/tools/data/runSql.ts) | aggregates, groupings, numeric ranges | anything the guard allows | Conditional. Separate read-only role, `BEGIN READ ONLY`, 3s timeout, [guard.ts](../../../apps/api/src/modules/assistant/sql/guard.ts) |

### 2.2 Command tools — emit a validated `MapCommand` for the browser

| Tool | File | Emits |
|---|---|---|
| `zoom_to_province` | [zoomToRegion.ts](../../../apps/api/src/modules/assistant/tools/command/zoomToRegion.ts) | `zoomToRegion` |
| `zoom_to_feature` | [zoomToFeature.ts](../../../apps/api/src/modules/assistant/tools/command/zoomToFeature.ts) | `zoomToFeature` (fixed zoom 12) |
| `set_layer_visible` | [setLayerVisible.ts](../../../apps/api/src/modules/assistant/tools/command/setLayerVisible.ts) | `setLayerVisible` |
| `set_basemap` | [setBasemap.ts](../../../apps/api/src/modules/assistant/tools/command/setBasemap.ts) | `setBasemap` |
| `highlight_features` | [highlightFeatures.ts](../../../apps/api/src/modules/assistant/tools/command/highlightFeatures.ts) | `highlightFeatures` (≤ 50 points) |

**Four of the nine `MapCommand` kinds have no tool.** `resetView`, `zoomTo`, `setLayerOpacity` and `clearHighlights`
are defined in the shared contract, validated by `isMapCommand`, executed by
[mapCommands.ts](../../../apps/web/src/features/map/model/mapCommands.ts), and emitted by the UI — but nothing in the
assistant can reach them. They are the cheapest tools anyone will ever add (§6.1).

### 2.3 Client-side, not in the registry

[useMeasure.ts](../../../apps/web/src/features/map/model/useMeasure.ts) — OpenLayers `Draw` plus `ol/sphere`
`getLength` / `getArea`, wired to the two ruler buttons in
[MapToolbar.tsx:75-83](../../../apps/web/src/features/map/ui/MapToolbar.tsx#L75-L83). Interactive measurement of
user-drawn shapes: no server round trip, no relationship to the tool layer. Not a candidate for merging — its input is
a mouse, not a feature id.

---

## 3. How a tool is wired

### 3.1 Request lifecycle

```
browser: useAssistant.send()
  -> buildMapContext(map, basemap, layersState)      # bbox, zoom, visible layers, basemap
  -> POST /api/assistant/messages  {sessionId, message, mapContext}
       auth (admin|editor|viewer) -> rate limit 20/min by user id -> budget.check()
       runAssistant()                                  [service.ts]
         buildTools(ctx)                               [registry.ts]  ctx = {pool, mapContext, collect, provenance}
         SDK beta toolRunner, model claude-haiku-4-5, max_iterations 8
           data tool    -> SQL -> JSON string  -> ctx.provenance(record)
           command tool -> isMapCommand()      -> ctx.collect(command), returns Vietnamese prose
         collectReplyText(all messages) -> parseReplySegments()
  <- {segments, commands, provenance}
  -> panel renders segments + provenance chips; for (const c of reply.commands) run(c)
       createCommandExecutor -> OpenLayers            [mapCommands.ts]
```

### 3.2 The five contracts a new tool touches

1. **`ToolContext` / `ToolFactory`** — [tools/types.ts](../../../apps/api/src/modules/assistant/tools/types.ts).
   A tool is a factory over `{pool, mapContext, collect, provenance}`, not a free function reading globals. That is
   what makes the unit tests possible: construct a context, run the tool, assert exactly what it collected.
2. **The registry** — [registry.ts](../../../apps/api/src/modules/assistant/tools/registry.ts). Fixed order, because
   tool definitions sit inside the **prompt-cache prefix** and are resent every turn; a set that reorders itself
   misses the cache on every request. `guardToolErrors` wraps every tool so a thrown error becomes a Vietnamese result
   the model can respond to, not a 500.
3. **`MapCommand`** — [packages/shared/src/map-commands.ts](../../../packages/shared/src/map-commands.ts). The single
   contract shared by UI buttons and the assistant. `isMapCommand()` is the only thing between a hallucinated province
   code and the map. A new command kind means union member + validator case + executor case + the shared tests.
4. **`Provenance`** — [packages/shared/src/assistant.ts](../../../packages/shared/src/assistant.ts):
   `{tool, layerKey, rowCount, datasetVersion, sql?}`, one record per call, rendered as chips under the answer.
   **Every data tool must emit one, including on the empty path** — a tool that stays silent when it finds nothing
   makes the answer look ungrounded when it is in fact grounded in an absence.
5. **The system prompt** — [prompt.ts](../../../apps/api/src/modules/assistant/prompt.ts). Rule 2 (numbers come from
   tools), rule 3 ("Không có dữ liệu" must be reported honestly) and rule 5 (never invent coordinates) are what make a
   tool's *return strings* load-bearing, not just its data.

### 3.3 Conventions every existing data tool follows

- Vietnamese result strings; the empty case starts with **`Không có dữ liệu:`** (12 hand-typed occurrences).
- Rows as JSON via `JSON.stringify`, capped at `ROW_LIMIT = 25`; counts still reported in full.
- `layerKey` is validated against `EDITABLE_LAYER_KEYS` by Zod *and* by `assertKnownLayer` before it is interpolated
  into SQL. Everything else is a bind parameter.
- Feature ids are checked with `isFeatureId()` before hitting the database — a malformed uuid raises Postgres 22P02,
  which reaches the model as a database error instead of an honest "no such feature".
- Coordinates are sanity-checked with `inVietnam()`. Note this lives in
  [command/zoomToFeature.ts](../../../apps/api/src/modules/assistant/tools/command/zoomToFeature.ts) and is imported
  back into `data/nearestFeatures.ts` — a minor layering smell, see §5.3.

---

## 4. The data underneath

### 4.1 Thematic layers (`water` schema)

Eight editable layers, created by
[1000000000002_water-schema.cjs](../../../apps/api/src/db/migrations/1000000000002_water-schema.cjs) (plus `lakes` in
migration 6). Every table: `id uuid PK`, `external_id`, `name`, `geom geometry(<type>, 4326) NOT NULL`, audit columns,
`dataset_version_id`, `deleted`.

| Layer | Geometry | Attribute columns | Filterable (allowlist) | Data state |
|---|---|---|---|---|
| `dams` | Point | name_en, wattage_mw, annual_output, year_launched, year_operational, status | name, name_en, status, year_launched, year_operational | real |
| `rivers` | MultiLineString | code, stream_order, length_m | name, code, stream_order | real (~9,500 rows) |
| `lakes` | MultiPolygon | lake_type, area_km2, volume_mcm, shore_len_km | name, lake_type | real |
| `stations` | Point | station_type, status, value | name, station_type, status, value | **2 fake rows** |
| `flood_zones` | MultiPolygon | hazard_type, area, risk_level | name, hazard_type, risk_level, area | **2 fake rows** |
| `drought_points` | Point | risk_level, status, survey_date | name, risk_level, status | **2 fake rows** |
| `saltwater_intrusion` | Point | salinity, risk_level, status | name, salinity, risk_level, status | **2 fake rows** |
| `flood_generation` | MultiPolygon | risk_level, area, flow_rate | name, risk_level, area, flow_rate | **2 fake rows** |

Five of eight layers are placeholder data. A tool built on the hazard layers will be *correct* and *useless* until real
data arrives — let that drive ordering, not design.

**Indexes:** GiST on `geom` and unique on `external_id` for every layer; GIN trigram on `name` for dams, lakes, rivers
and stations ([migration 7](../../../apps/api/src/db/migrations/1000000000007_pg-trgm-search.cjs)). **No index on any
attribute column** — which is why `filter_by_attribute` deliberately skips the CTE pattern (§4.2).

Also present: `water.rivers_overview`, a materialized view of stream-order-5 trunks pre-simplified for far zooms
([migration 9](../../../apps/api/src/db/migrations/1000000000009_river-overview.cjs)). No tool reads it.

### 4.2 Versioning: why the queries look the way they do

Layer data is versioned through `app.dataset_versions` (a parent chain, one active version per layer). The
`water.<layer>_active` views resolve that chain with `WITH RECURSIVE` + `DISTINCT ON`, then drop tombstones.

Those views are an **optimizer fence**: a predicate applied on top cannot be pushed down, so filtering the view scans
and dedups the entire layer before the predicate runs. `candidateCtes()` in
[helpers.ts](../../../apps/api/src/modules/assistant/tools/data/helpers.ts) rebuilds the same resolution logic *below*
a candidate step that runs against the base table, where the indexes are reachable.

Three rules a new tool must not get wrong:

1. The candidate predicate must be **index-servable** (a GiST hit, or `id = $1`). If it is not, the pattern is slower
   than querying the view — measured; see the comment block in `filterByAttribute.ts`.
2. The candidate step runs across **every** version, so it returns a superset. You **must** re-apply the real
   predicate *and* `NOT deleted` when selecting from `resolved`.
3. Two chains in one statement need distinct `prefix` arguments (`'from_'` / `'to_'`), even for the same layer.

### 4.3 Reference data (`basemap` schema)

Loaded by [load_basemap.py](../../../apps/api/scripts/basemap/load_basemap.py), documented in
[self-hosted-basemap.md](../../runbooks/self-hosted-basemap.md). Eight tables: `roads_region` (~527k), `roads_vn`,
`landuse_region`, `places_region` (~6.1k), `water_region`, `railways_vn`, `places_vn`, `land_vn`.

Only `places_region` is used by a tool (`locate_place`). The rest are rendered basemap context — **available for
analysis and currently unexploited**.

### 4.4 What is *not* in the database

- **Province and ward polygons.** They are `apps/web/public/provinces-34.geojson` and `wards-region.geojson`, loaded by
  the browser, plus hard-coded `PROVINCE_CENTROIDS` for zooming. Server-side there is only
  [region.ts](../../../packages/shared/src/region.ts) — six codes and six names. Every admin-unit question is today
  approximated by bbox, or not answered.
- **Elevation.** The DEM basemap is an Esri raster service, not local data, so no `ST_Value` is possible today.
  **Accepted for loading** — see §6.4 for the source, storage decision and the tools it unlocks.
- **River network topology.** The live `rivers` layer is **OSM waterways**, not HydroRIVERS
  ([ingestRivers.ts](../../../apps/api/src/db/seeds/ingestRivers.ts)): `external_id` is an OSM id, `code` is the
  `waterway` tag, and `stream_order` is a rank by waterway type — *not* a Strahler order, despite the column name. OSM
  carries no downstream link, and the HydroSHEDS path does not supply one either: `RIVER_FIELDS` in
  [prep_hydrosheds.py:28](../../../apps/api/scripts/prep_hydrosheds.py#L28) keeps only `HYRIV_ID`, `ORD_STRA`,
  `LENGTH_KM` — `NEXT_DOWN` is dropped at prep time. Tracing is therefore not a column away; see §6.6.
- **Time series.** `stations.value` is a single `text` column.

**Should these be folded into PostGIS?** The test is not "is it geodata" — it is **does a tool need to run a predicate
over it server-side**. Rendering data is better off as a cached static asset; anything a query must filter, join or
measure against has to be in the database.

| Missing data | Fold in? | Why |
|---|---|---|
| Province / ward polygons | **Yes, now** | Point-in-polygon and per-unit counts are predicates, and they are the most common question this atlas gets. One migration plus a loader; the source script already exists. Load from the **unsimplified** source, not the browser copies — those are Douglas-Peucker'd at 0.0001° (~11 m) and rounded to 5 decimals by [fetch-boundaries.mjs:33](../../../apps/api/scripts/fetch-boundaries.mjs#L33), which puts border features on the wrong side near the line. Keep the simplified files for rendering (raw ward data is 157 MB); one script writes both, the way the dams seed already reads `apps/web/public/thuydienvietnam.geojson` |
| Elevation | **Yes** (decided 2026-09-14) | A 30 m DEM clipped to the working region, as in-database PostGIS raster. Nothing queries elevation *today*, so this one is a capability bet rather than a backlog item — but it is the only missing dataset that unlocks a whole class of questions (height, drop, slope, profile) instead of one tool. The `postgis_raster` extension is available in the running image (verified); the `raster2pgsql` client binary is not, so the loader needs a decision. Design in §6.4 |
| River topology | **Yes in value, no in cost** | See §6.6 — the current source has no downstream link at all, so this is a re-ingest decision, not a migration. Wait for a concrete hydrology requirement |
| Station time series | **No** | Two fake rows today. Designing a readings table before the real feed exists means designing it twice. When it arrives it is a new `water.station_readings` table, not a change to `stations` |

### 4.5 Privilege boundary (matters when choosing a pool)

`run_sql` uses a **separate role** (`webatlas_assistant`) whose grants are `SELECT` on the eight
`water.<layer>_active` views and nothing else — explicitly not the base tables, not the `app` schema, and **not the
`basemap` schema** ([migration 8](../../../apps/api/src/db/migrations/1000000000008_assistant-db-role.cjs)).

Consequence for new tools: anything needing `basemap.*` (gazetteer, roads, landuse) or the base tables must be a
**typed tool on `ctx.pool`**, the way `locate_place` is. It cannot be delegated to the SQL escape hatch.

---

## 5. Should the tool layer be restructured?

### 5.1 What is genuinely duplicated

Every data tool repeats the same seven-step skeleton: Zod schema → validate ids/bounds → build `candidateCtes` →
`Promise.all([pool.query, activeVersionLabel])` → `ctx.provenance({...})` → empty-guard returning
`"Không có dữ liệu: …"` → `JSON.stringify`. Concretely:

| Duplication | Where | Risk |
|---|---|---|
| Anchor-feature geometry lookup (candidate CTEs, `id = $1`, `NOT deleted` re-apply) | `areaOf`, `distanceBetween`, `relatedFeatures` — three hand-written variants | Every new anchored tool writes a fourth. Forgetting the `NOT deleted` re-apply silently returns tombstoned rows |
| The `Không có dữ liệu:` prefix | 12 hand-typed occurrences | Load-bearing for system-prompt rule 3, defined nowhere. `areaOf`'s wrong-geometry message already breaks the pattern |
| `provenance({tool, layerKey, rowCount, datasetVersion})` | every data tool, with the tool name as a magic string that must match the file's own `name:` | A typo makes the chip lie, and nothing checks it |
| Version-chain CTEs | `helpers.candidateCtes` **and** [search/repository.ts:24](../../../apps/api/src/modules/search/repository.ts#L24) `layerCtes` | Two implementations of one non-obvious query shape; search's is the older, fixed-predicate one |
| Per-layer column lists | `FILTERABLE_COLUMNS` (tools), `ATTRS` ([layers/registry.ts](../../../apps/api/src/layers/registry.ts)), `LAYER_ATTRIBUTE_MAP` ([packages/shared](../../../packages/shared/src/layer-attributes.ts)) | Three lists of the same columns. A schema change must land in all three |
| Result envelope | `{count, listed, rows}` / `{truncated, rows}` / `{from, rows}` / `{anchor, radiusKm, rows}` / flat `{areaKm2}` | Five shapes for "some rows plus some context". Costs tokens, and makes any future result-rendering UI a special case per tool |

Dead code: `FeatureRow` at
[helpers.ts:124](../../../apps/api/src/modules/assistant/tools/data/helpers.ts#L124) is exported and imported by
nothing (the `FeatureRow` used elsewhere is `layers/repository.ts`'s own, unrelated type).

### 5.2 What is *deliberately* not shared — do not "fix" these

Most of the per-tool variation is reasoned, and the reasoning is in the comments. Read them before abstracting:

- `filter_by_attribute` **not** using `candidateCtes` is a measured decision (~43ms via the view vs 82–130ms via the
  candidate form, because no attribute column is indexed).
- `nearest_features`' over-fetch factor and exact-query fallback exist because KNN has no indexable predicate.
- `related_features`' `CONSERVATIVE_KM_PER_DEGREE = 100` exists because `ST_DWithin(geography)` forces a sequential
  scan while the degree form uses the GiST index.
- Empty-result messages are tool-specific on purpose: they tell the model *what* was absent.

A generic `defineSpatialTool({sql, params})` framework would bury all four. That is the wrong shape here.

### 5.3 Verdict and the four extractions

**Restructure — narrowly, and first.** The payoff is not tidiness. The next three tools are each anchored on a feature,
and without a shared resolver each will hand-roll the candidate/re-apply dance that is the one place in this module
where a mistake returns *wrong data silently* rather than failing. Roughly a day, and cheaper now (6 call sites) than
after the next wave (10+).

1. **`resolveFeature(pool, layerKey, featureId, prefix?)`** in `helpers.ts`, returning
   `{name, geomWkt, lon, lat} | null`, with the candidate CTEs, the `NOT deleted` re-apply and `isFeatureId` inside.
   Replaces three hand-written variants; every anchored tool in §6 uses it. *Highest value of the four.*
2. **A `NO_DATA` constant plus `noData(message)` helper** — one definition of the prefix that system-prompt rule 3
   depends on, and a natural place to assert that contract in a test.
3. **A `dataToolResult()` envelope** — `{tool, layerKey, count, truncated, rows, ...extra}`, adopted by new tools
   immediately and by existing ones as they are next touched. Standardising the shape is what makes a future
   "show the rows in a table" panel possible without per-tool rendering code.
4. **Fold `search/repository.ts`'s `layerCtes` onto `candidateCtes`**, with `prefix` and a caller-supplied predicate.
   Same query shape, one implementation, and search inherits prefix support for free.

Cheap, do them in passing: delete the dead `FeatureRow`; move `inVietnam` out of `command/zoomToFeature.ts` into
`helpers.ts` so a data tool no longer imports from the command folder.

**Explicitly not recommended:** a generic tool-definition DSL; collapsing the six data tools into one parameterised
"spatial query" tool (it defeats the typed-tool design the whole prompt strategy rests on); moving `FILTERABLE_COLUMNS`
into `packages/shared` before someone reconciles the three column lists as its own task.

### 5.4 The budget constraint on *any* new tool

Tool definitions live in the cached prompt prefix and are **resent on every turn of every conversation**. A tool is a
permanent per-message cost, not a one-off. Two consequences:

- Prefer **extending an existing tool** over adding a near-duplicate (teach `area_of` to measure lines rather than
  adding a `length_of`).
- `MAX_ITERATIONS = 8` caps the chain. A single question already costs three calls (`locate_place` →
  `nearest_features` → `highlight_features`); a tool needing two more calls before it is usable will not fit inside a
  compound question.

---

## 6. Recommended tools to add

Ordered by value per unit of effort. Prerequisites are stated because three of these are blocked on data, not code.

### 6.1 Tier 0 — hours, no new data, no schema change

| # | Tool | Why | Notes |
|---|---|---|---|
| 1 | `feature_details(layerKey, featureId)` | **The biggest gap.** Nothing returns a feature's attributes; "công suất đập Đray H'linh?" is unanswerable without `run_sql`, which is off by default | Reuse `LAYER_ATTRIBUTE_MAP` for the column list and the ISO-aligned names; exclude audit columns the way `FILTERABLE_COLUMNS` does |
| 2 | `reset_view` / `clear_highlights` / `set_layer_opacity` | Three command kinds already validated and executed, unreachable by the assistant. ~25 lines each, mirroring `setBasemap.ts` | "Xoá đánh dấu đi" currently does nothing. Consider one `map_view` tool rather than three definitions, for prefix cost |
| 3 | Extend `area_of` into `measure_feature` | Symmetry gap: a polygon can be measured, a river cannot. `ST_Length(geography)` for lines, area + perimeter for polygons, refuse points | An extension, not a new tool — keeps the cached prefix flat. Rename in the same commit as the live-test update |

### 6.2 Tier 1 — about a day each, no new data

| # | Tool | Why | Sketch |
|---|---|---|---|
| 4 | `features_within_radius(layerKey, lon, lat, radiusKm)` | `related_features` needs an *anchor feature*; `nearest_features` gives top-k, not "all within". "Bao nhiêu đập trong 30 km quanh Buôn Ma Thuột" needs neither | The same two-step degree/metre `ST_DWithin` pattern as `related_features`, with the point bound instead of an anchor. Report a full count like `features_in_view` |
| 5 | `features_in_polygon(layerKey, containerLayerKey, containerFeatureId)` | The one genuinely missing *overlay* operation: which stations lie inside flood zone X, which dams inside a flood-generation area | `ST_Intersects` candidate on the GiST index, re-applied after resolution. Wants `resolveFeature` (§5.3) first. Data caveat: the hazard layers are 2-row fakes |
| 6 | `count_by_attribute(layerKey, column, bbox?)` | Every "phân bố theo…" question. Today only `run_sql` can group, and it is disabled unless a second DB role is configured | `GROUP BY` over the `_active` view, reusing the `FILTERABLE_COLUMNS` allowlist. Cheap, and it removes the most common reason to enable the escape hatch |
| 7 | `zoom_to_extent` (new `MapCommand`) | `zoom_to_feature` animates to a point at fixed zoom 12 — a 200 km river or a province-sized polygon is framed wrongly every time. Also the natural way to frame a *result set* | Contract change: union member + `isMapCommand` case + executor case + shared tests. Feed it `ST_Extent` from the tool side |

### 6.3 Tier 2 — needs a data load (the files are already in the repo)

| # | Tool | Prerequisite | Why it earns the migration |
|---|---|---|---|
| 8 | `locate_admin_unit(lon, lat)` — "which province/ward is this in" | Load `provinces-34.geojson` + `wards-region.geojson` into PostGIS: new schema, GiST index, one migration plus a loader | Point-in-polygon against admin units is the most common real GIS question in an atlas like this, and every answer today is a bbox approximation |
| 9 | `features_in_admin_unit(layerKey, provinceCode)` | same | "Bao nhiêu hồ ở Đắk Lắk" is currently answered by viewport, which is wrong at any zoom that does not happen to match the province |
| 10 | `nearest_road_access(featureId)`, landuse context | `basemap.roads_region` and `landuse_region` are already loaded — only grants and a tool are missing | Cheap follow-on once the radius pattern from §6.2 exists; useful for hazard reporting |

Doing #8 also fixes `zoom_to_province`, which today depends on hard-coded browser-side centroids.

### 6.4 Elevation — accepted, needs a DEM load

Decided 2026-09-14, overriding this document's first recommendation to defer. Treat it as a capability bet: no question
in the backlog needs elevation today, but it is the only missing dataset that opens a *class* of questions rather than
one tool, and the stack already carries the pieces.

**Source: FABDEM V1-2** — Copernicus GLO-30 with forest and building height removed by ML, i.e. **bare earth**.
Swapped in on 2026-09-15 (it was raw Copernicus for the first load) once the project was confirmed public-sector:
the licence is CC BY-NC-SA, non-commercial. See the runbook for attribution, citation and the mirror it downloads from.

Two source caveats to record now rather than rediscover:

- **It is bare earth, and that is measurable.** Against the Copernicus tiles over the same ground: mean −4.1 m in
  Lâm Đồng highland forest, median −8.4 m in Quảng Nam mountain forest, p95 −18 m, max −88 m. At a 20 m contour
  interval an 8 m canopy bias is nearly half a contour, which is why the switch was worth redoing the load for.
- **Attribution is required**, as with the OSM basemap. Copernicus DEM carries a © DLR / © Airbus Defence and Space
  notice; put it wherever elevation numbers surface, and in the runbook.

**Storage: in-database PostGIS raster, tiled.** The three candidates and why this one:

| Option | Verdict |
|---|---|
| In-db `raster` tiled 128×128, GiST-indexed | **Chosen.** `ST_Value(rast, point)` is one join, the read-only assistant role is granted the same way as everything else (§4.5), and a dump carries the data. Costs a few hundred MB of DB volume |
| Out-db raster (`raster2pgsql -R`) | Rejected. Keeps the DB small but the GeoTIFFs must be mounted at an identical path inside the container on every machine, plus `postgis.enable_outdb_rasters` and driver allowlisting. Too brittle for a repo where a dev box is `docker compose up` |
| Pre-sampled `elevation_m` column per feature | Rejected as the primary design — it answers "how high is this dam" and forecloses profiles, slopes and polygon statistics. Worth adding later as a denormalised convenience *on top of* the raster |

**The loader needs a decision — verified against the running stack on 2026-09-14, do not assume:**

- `postgis_raster` **is** available: `pg_available_extensions` lists 3.4.3, currently *not installed*. The server side
  is ready.
- `raster2pgsql` **is not in the image.** `postgis/postgis:16-3.4` ships the extension libraries but not the client
  binary (`find / -name 'raster2pgsql*'` returns nothing). The usual one-liner from every PostGIS raster tutorial will
  fail here.

Three ways through. **Implemented: (3)** — this section originally recommended (1), and building the pipeline showed
(3) strictly dominates it.

1. **Rebuild the `db` service** with the Debian `postgis` package added. Canonical loader, but every developer builds
   an image on their next `docker compose up` — including everyone who will never touch elevation — to gain a binary
   used once. Rejected.
2. **Skip the binary** — `rasterio` reads the clipped GeoTIFF, sends bytes as `bytea`, PostGIS parses them with
   `ST_FromGDALRaster()` + `ST_Tile()`. No infra change, but needs `postgis.gdal_enabled_drivers` set on the database
   and is a path with far fewer worked examples when it misbehaves. Rejected.
3. **A one-off tools image** ([raster-tools.Dockerfile](../../../apps/api/scripts/raster-tools.Dockerfile)): same
   canonical `raster2pgsql`, built only when someone runs the loader, joined to the compose network, `docker-compose.yml`
   untouched. Based on `postgis/postgis:16-3.4` so the loader's PostGIS version matches the server's — the base already
   has the PGDG apt repo configured, so `postgis` resolves to the matching 3.4 build rather than Debian's older one.

The **host still needs no system GDAL** either way — `prep-hydrosheds.sh`'s promise holds. Clipping is Python
`rasterio` on the host, the same geo stack `prep_hydrosheds.py` and `load_basemap.py` already require.

**Clip to the province polygons, not the bbox.** The region's bounding box reaches lon 117.8° because Hoàng Sa and
Trường Sa belong to Đà Nẵng and Khánh Hoà — the basemap runbook hit this exact trap. The boundary load (§6.3 #8) turned
out **not** to be a prerequisite after all: the prep script reads `apps/web/public/provinces-34.geojson` directly, whose
`.code` property matches `REGION_PROVINCE_CODES` exactly. Those polygons are the simplified browser ones, which is fine
for deciding which 30 m pixels to keep (and the mask is padded ~110 m on top) — but that reasoning does **not**
transfer to anything that measures against a boundary.

**Status — built 2026-09-15:**

| # | Item | State |
|---|---|---|
| 1 | `postgis_raster` + `basemap.dem_region` (`rast` + `filename`) + GiST index — [migration 1000000000010](../../../apps/api/src/db/migrations/1000000000010_dem-raster.cjs) | **Applied** |
| 2 | [prep_dem.py](../../../apps/api/scripts/prep_dem.py) — tile list from the region geometry, download, clip, per-tile GeoTIFFs | **Run** (FABDEM): 18 mainland tiles, 254 MB of clips. Fetches per-tile from a mirror at ~7.6 MB/s because the authoritative Bristol distribution is ZIP-only and measured 23 KB/s — a 20-hour download for 1.7 GB |
| 3 | [load-dem.sh](../../../apps/api/scripts/load-dem.sh) + [raster-tools.Dockerfile](../../../apps/api/scripts/raster-tools.Dockerfile) | **Run**: 7,242 raster rows, 406 MB, extent 107.20–109.46 E / 10.57–16.22 N |
| 4 | `.gitignore` for `seeds/data/dem/` | Done |
| 5 | `elevation_at_point` + 5 unit tests | Done. Verified end-to-end on the loaded DEM: Buôn Ma Thuột 472.2 m, Chu Yang Sin 2,414.5 m, offshore → no-data, out-of-region → refused |
| 6 | [Runbook](../../runbooks/elevation-dem.md) | Done |
| 7 | `SELECT` grant to `webatlas_assistant` so `run_sql` can reach the DEM | **Not done** — deliberately typed-tool-only until someone wants it |
| 8 | `elevation_of_feature`, `elevation_profile` | Not started (§6.4.1) |
| 9 | `GET /api/elevation` + cursor readout in the map corner | Done 2026-09-15. Own rate-limit ceiling (600/min) so cursor traffic cannot exhaust the global 100/min and lock the user out of the rest of the API |

Per-tile GeoTIFFs rather than one mosaic, incidentally: a mosaic over the region bounds would be mostly empty sea and
would need ~1 GB of RAM to assemble, `raster2pgsql` takes a glob anyway, and per-tile makes the download resumable.

#### 6.4.1 Tools this unlocks

| Tool | Shape | Note |
|---|---|---|
| `elevation_at_point(lon, lat)` | `ST_Value(rast, ST_SetSRID(ST_MakePoint(…),4326))` | Coordinates must come from `locate_place` or another tool — the same rule 5 discipline as `nearest_features` |
| `elevation_of_feature(layerKey, featureId)` | `ST_PointOnSurface` (already `POINT_SQL`) → `ST_Value`; for polygons `ST_SummaryStats(ST_Clip(...))` for min/max/mean | Wants `resolveFeature` from §5.3 |
| `elevation_profile(layerKey, featureId, samples)` | Interpolate N points along a river reach, sample each, report drop and mean gradient | The one with real hydrological value. Cap `samples` — it is the only tool here that can return a long array |

Watersheds, flow accumulation and stream delineation are **not** in scope: they need flow-direction and accumulation
rasters (HydroSHEDS CON/DIR products), not a bare DEM. A separate decision, later.

**Honest effort estimate:** 2–3 days including the runbook and tests, most of it in the prep/load pipeline rather than
the tools. The tools themselves are an afternoon each once the raster is in place.

### 6.5 Terrain contours — built and published (2026-09-15)

**Status — built:**

| # | Item | State |
|---|---|---|
| 1 | `basemap.contours` + `basemap.dataset_sources` — [migration 1000000000011](../../../apps/api/src/db/migrations/1000000000011_contours.cjs) | **Applied** |
| 2 | [generateContours.ts](../../../apps/api/src/scripts/generateContours.ts) — per-1° contouring with overlap/clip, simplify, index-contour tagging | **Run**: 19,275 features / 11 levels / 632,337 vertices at 250 m; 50,760 / 26 / 1,664,414 at 100 m; 103,672 / 52 / 3,376,103 at 50 m. **~17 min** measured (plan estimated ~30) |
| 3 | Three GWC-cached layers, `webatlas:contours_250/100/50`, each a SQL view on the `basemap_pg` datastore, published by [styles.py](../../../apps/api/scripts/contours/styles.py) + [publish-contours.sh](../../../apps/api/scripts/contours/publish-contours.sh) | **Published**, verified via WMTS in both `contours_plain` and `contours_labelled` styles |
| 4 | Panel toggle, **Địa hình → Đường đồng mức**, with **Khoảng cao đều** (auto/250/100/50) and **Nhãn độ cao** sub-options | Done — [contours.ts](../../../apps/web/src/features/map/model/contours.ts), [layerDisplay.ts](../../../apps/web/src/entities/layer/layerDisplay.ts) |
| 5 | Two independent integrity checks: every elevation an exact multiple of its interval; 50 m bucket's index contours (every 250 m) count exactly matches the 250 m bucket's total | **Passed** |
| 6 | 20 m bucket, per-basemap line colour, pre-contour smoothing | **Deferred** — see below |
| 7 | [Runbook](../../runbooks/terrain-contours.md) | Done |

Shipped at three of the four originally planned buckets (§6.4-era estimate below kept 20 m
open pending screen time), all three sub-options from the design, and both integrity checks
the plan called for as verification. The rest of this section is the scoping work that led
there, kept for the reasoning.

Requested shape: a **toggle in Quản lý dữ liệu** that overlays contour lines on *all three*
basemaps, with sub-options. Architecturally that is already free — the basemap is one layer
whose source swaps ([MapModel.ts:454](../../../apps/web/src/features/map/model/MapModel.ts#L454)),
while `CONTEXT_LAYERS` render above it regardless of which basemap is showing. A contour layer
added the same way overlays street, satellite and dem with no special casing.

**Source: our own DEM** (`ST_Contour` over `basemap.dem_region`), not a third-party contour
service. The deciding argument is consistency, not convenience: any other source would let the
cursor readout say 472 m while a contour labelled 480 m runs past it, and the iso-band
highlight would stop lining up with the contours it should hug. One origin for elevation is
the same INV-1 rule the rest of the data follows. Secondary: a third-party contour service is
the dependency class that already broke this project once (CARTO, grey tiles at HTTP 200).

**That DEM is now FABDEM V1-2, not raw Copernicus** — swapped 2026-09-15 once the project was
confirmed public-sector, which is what the CC BY-NC-SA licence requires. See §6.4.

#### Alternatives actually checked (web, 2026-09-15)

| Source | What it is | Verdict |
|---|---|---|
| [MapTiler contours](https://www.maptiler.com/on-prem-datasets/dataset/contours/asia/vietnam/) | Ready-made contour vector tiles (MBTiles, z9–14), self-hostable | **No.** Derived from the same class of open DEMs, so no accuracy gain, and it reintroduces the disagreement problem. Commercial: on-prem Standard is one internal app ≤500 MAU, B2G needs a custom quote, and [serving from a public cloud is prohibited](https://www.maptiler.com/data/license/) |
| [OD Mekong "Vietnam DEM"](https://data.opendevelopmentmekong.net/en/dataset/digital-elevation-model-dem) | The dataset that *looks* like the official national one | **No.** Source is USGS (SRTM, 2000–2011) at 30 m, CC-BY-SA-4.0 with a non-commercial note. Older and weaker than the Copernicus data already loaded |
| [East View Geospatial](https://shop.geospatial.com/publication/RN86EBG5BBXF4C69AECM4N1PY5/Vietnam-1-to-50000-Scale-Topographic-Maps-VN2000) | Vietnam 1:50.000 topographic series (VN2000 datum), digital vector available | **Procurement question.** Genuinely surveyed contours, the cartographic gold standard here. Price on request, 1–7 days for vector delivery |
| [FABDEM V1-2](https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn) | Copernicus GLO-30 with forests and buildings removed by ML — **bare earth** | **Adopted 2026-09-15.** Non-commercial licence, and the project is public-sector |
| [OpenDEM](https://www.opendem.info/download_contours.html) | SRTM-derived contour shapefiles | No — Europe-focused, and SRTM again |

**The find worth acting on: FABDEM.** It is the same 30 m grid, the same 1°×1° GeoTIFF tiling and
the same parent dataset as what `prep_dem.py` already downloads — so switching source is close to
a drop-in change of URL and licence notice. What it removes is exactly the problem that forces the
3×3 smoothing: canopy and buildings. Contours off bare earth in Tây Nguyên forest would be
properly cartographic rather than merely de-noised.

The catch is the licence: **CC BY-NC-SA 4.0 — non-commercial, share-alike**. So the question that
decides it is one nobody has asked yet: *is this atlas a non-commercial public-sector deliverable?*
If yes, FABDEM is free and strictly better for both contours and the elevation readout. If it is
commercial, Fathom sells a commercial equivalent (FABDEM+ / FathomDEM), and the fallback is what is
already loaded. **Answer that before building the contour pipeline** — it changes the input, and
re-running the DEM load is an hour.

Note also that the openly published "official" Vietnamese elevation data is just repackaged SRTM.
A genuinely authoritative national contour set exists but is a purchase or a government
arrangement, not a download — worth asking whether the client already holds rights.

#### Measurements

All against the loaded DEM. Coverage: **98,646 km²**, 106.7M valid pixels.

Contour density at 100 m interval, six 750 km² blocks, **measured on FABDEM** (the first pass
used raw Copernicus; both are shown because the difference is the argument for the switch):

| Block | Features | Vertices | Vertices/km² | vs Copernicus (features) |
|---|---|---|---|---|
| coast Quy Nhơn | 215 | 33,719 | 45 | −17% |
| mountain Chu Yang Sin | 295 | 30,093 | 40 | −38% |
| plateau Gia Lai | 229 | 43,360 | 58 | −52% |
| coast Khánh Hoà | 311 | 66,401 | 88 | −18% |
| highland Lâm Đồng | 544 | 91,934 | 122 | −29% |
| mountain Quảng Nam | 825 | 157,759 | 213 | −14% |

The spread is the point — a single mountainous sample would have overestimated by 2×. Across
all six, bare earth cuts **features by 27%** (3,316 → 2,419) and vertices by 6%: the removed
lines are the little closed rings that canopy noise produces, which is also what wrecks label
placement.

Simplifying at 0.0002° (~22 m, **sub-pixel** against a 30 m grid, so visually lossless) cuts
vertices a further **5.9×**, to ~15/km² on average. Interval scaling, measured on the Chu Yang
Sin block: 20 m = 5.7×, 50 m = 2.2×, 250 m = 0.65× of the 100 m vertex count.

A **3×3 focal mean before contouring** still helps but is no longer load-bearing: on FABDEM it
removes 32% of features and 11% of vertices (on the surface model it was 43% and 14%). Bare
earth has already done most of that work, so treat smoothing as a cartographic nicety to tune
during the build, not a prerequisite.

One full 1° cell (3728×3728 px) contours in **28 s**. Contours must be generated from a
**unioned block**, never per 128×128 storage tile — per-tile contouring chops every line into
128-pixel fragments at the seams.

#### Region estimates (simplified, per bucket)

| Interval | Features | Vertices | GeoJSON |
|---|---|---|---|
| 20 m | ~445,000 | ~10M | ~230 MB |
| 50 m | ~160,000 | ~4M | ~90 MB |
| 100 m | ~73,000 | ~1.8M | ~45 MB |
| 250 m | ~41,000 | ~1.1M | ~28 MB |

Extrapolated from six blocks; treat as ±2× and re-measure per cell during the build.

*As built:* these estimates overshot by roughly 1.6–2×. The measured totals are 19,275 /
50,760 / 103,672 — see the Status table below and
[the runbook](../../runbooks/terrain-contours.md). Two reasons, kept here because the gap is
instructive: they were extrapolated from the **Copernicus surface model** and never rescaled
when the source became bare-earth FABDEM, which removes 27% of features; and at a coarse
interval the count follows how many levels the terrain crosses — only **11** at 250 m — so it
does not scale linearly with interval the way a single sample block suggests.

#### What the numbers decide: raster tiles, not WFS

WFS loads by bbox, so the fair test is per viewport, and that is where it breaks:

| Zoom | Viewport | 100 m bucket |
|---|---|---|
| 1:150.000 | ~60 km² | ~1,100 vertices (~24 kB) — fine |
| 1:1.000.000 | ~2,800 km² | ~50,000 vertices (~1.1 MB) — heavy |
| 1:12.800.000 | larger than the region | the entire bucket, 28–45 MB — impossible |

The same shape as the river layer, but worse: rivers follow a network, contours cover every
square kilometre. For scale, the full river network was 17.6 MB and was judged too heavy to
load below zoom 8.5; the coarsest useful contour bucket is larger than that.

So: **GWC-cached WMS tiles**, exactly like the basemap context layers, which have the same
"linework everywhere" property. Contours carry no attributes worth clicking, and labels place
better server-side anyway, so vector delivery buys nothing here.

Two routes to those tiles:

- **A — precompute a `basemap.contours` table** per interval bucket (smoothed, simplified),
  publish as a vector layer, let GWC cache the tiles. ~17M vertices across four buckets,
  roughly 400–600 MB, comparable to the DEM itself. Full control over index contours, labels
  and per-basemap styling. **Recommended for shipping.**
- **B — GeoServer `ras:Contour` rendering transformation** straight over the DEM raster: no
  storage, interval as an SLD `env` parameter. Needs a render buffer or the seams artifact,
  and every style change re-renders. Good for seeing it on screen in a day.

#### Pipeline (mirrors the DEM load)

1. Smooth 3×3, then contour **per 1° cell with an overlap**, clipping lines back to the cell so
   seams meet instead of gapping.
2. Simplify per bucket at 0.0002°; store with `interval_m` and a GiST index; mark index
   contours (`value % (5 × interval) = 0`).
3. Publish four layer groups; the interval selector chooses which one loads, so each keeps its
   own GWC cache. Zoom-gate 250 → 100 → 50 → 20 m, defaulting to auto.

   *As built:* **three** published layers, not four — 20 m stays deferred. Zoom-gate is
   250 → 100 → 50, defaulting to auto, and each interval is a SQL-view feature type rather
   than a layer group.
4. Runtime ~28 s × 19 cells × 4 intervals ≈ **35 minutes**, developer-run, same class as the DEM
   load. Like the DEM, the output is too large to commit.

   *As built:* smoothing was dropped (no longer load-bearing on bare earth, see above), three
   intervals shipped rather than four, and the measured run came to **~17 minutes** — see the
   Status table above and [the runbook](../../runbooks/terrain-contours.md) for the per-bucket counts.

**Shipped: 250 / 100 / 50.** The 20 m bucket remains the questionable one at ~230 MB and
~445,000 features; still deferred pending screen time on 50 m.

#### Sub-options

Expose three, automate the rest — every knob is one a user has to understand.

| Option | Why |
|---|---|
| **Khoảng cao đều** — auto by zoom (default), or 20/50/100/250 m | Auto fits the existing zoom-gating; the selector just picks which published group loads, so caching survives |
| **Nhãn độ cao** on/off | Labels clutter over satellite and are the whole point over street. Default on, rendered only above a zoom threshold |
| **Độ mờ** | Already free: the panel renders an opacity slider for any visible ungated layer, and `setLayerOpacity` is already a valid `MapCommand`, so the assistant can drive it too |

Automatic, not offered: **line colour by basemap** (brown over street, white over satellite,
grey over hillshade — one right answer each, so a colour picker is a knob with no good use);
**index contours** (styling, not preference); the **zoom gate** (same treatment as
`layer_rivers`).

Put it in a new `Địa hình` group in `LAYER_DISPLAY`, not under `Nền bản đồ` — the natural
sibling is a **Đổ bóng địa hình** row from `ST_HillShade` on the same DEM, and that pair is what
would eventually let the Esri hillshade basemap be dropped.

**One UI note:** the panel row is a checkbox plus a conditional opacity slider, with no
affordance for sub-options
([LayersPanel.view.tsx](../../../apps/web/src/features/layers-panel/ui/LayersPanel.view.tsx)).
Interval and labels want a small disclosure under the row when the layer is on, mirroring how
the opacity slider already appears conditionally. Keep those two settings in their own state
rather than widening the shared `LayerState` (`{id, visible, opacity}`) — that shape is part of
the `MapCommand` contract, and one special layer should not bend it.

#### Caveats to carry into the build

- Coverage stops at the region edge: contours will visibly end at the province boundary, and
  there are none over the archipelagos (the DEM was loaded `--mainland`).
- Smoothing removes 43% of the canopy fragments, not all of them. Dense forest stays noisy.
- The estimates come from six blocks with a 4.7× spread. Measure per cell as the pipeline runs.

**Caveat confirmed on screen after shipping:** on the satellite basemap the brown contour
lines are hard to see against the imagery — only the haloed labels stay clearly legible. This
is the cost the deferred per-basemap line colour (above) was always going to have; now there
is a concrete instance of it rather than a hypothetical. Recorded as a known limitation in
[the runbook](../../runbooks/terrain-contours.md), not a bug.

### 6.6 Tier 3 — blocked, recorded so nobody re-derives it

- **Upstream/downstream river tracing.** The highest analytical value for a water-resources atlas, and the first thing
  a hydrology user asks for — but it is **not** a column away (§4.4). The displayed layer is OSM waterways, which has
  no topology attribute, and the HydroSHEDS prep script discards `NEXT_DOWN`. Three routes, none cheap:
  (a) re-run the prep keeping `NEXT_DOWN` and ingest HydroRIVERS into a **separate** topology table keyed by
  `HYRIV_ID`, leaving the OSM-named `rivers` layer alone — then tracing answers by HydroRIVERS reach, and naming a
  reach means a spatial join back to OSM; (b) replace `rivers` with HydroRIVERS again, which re-loses the river names
  that motivated the OSM swap; (c) build topology from OSM geometry by noding and snapping, which is a project in
  itself. (a) is the one to scope. Do not start it without a concrete hydrology requirement to aim at.
- **Buffer / overlay results drawn on the map.** Requires a `MapCommand` carrying geometry — highlights are points
  only today. Contract change, plus a rendering path, plus a payload cap.
- **Watersheds, flow accumulation, stream delineation.** Need flow-direction/accumulation rasters, not the bare DEM of
  §6.4. Separate decision. (Plain elevation, slope and profiles moved out of this tier on 2026-09-14 — see §6.4.)
- **Station time series.** Blocked on the data model (`value` is one text column).

---

## 7. Checklist for adding a tool

1. New file under `tools/data/` or `tools/command/`. Copy the nearest sibling, and keep `import { z } from 'zod/v4'` —
   plain `zod` throws inside `betaZodTool`.
2. Layer keys via `z.enum(EDITABLE_LAYER_KEYS)`, ids via `isFeatureId`, coordinates via `inVietnam`. Everything that
   reaches SQL is a bind parameter except the layer key, and that goes through `layerView` / `layerTable`.
3. Emit `ctx.provenance(...)` on **every** path, including empty. Command tools call `isMapCommand` before
   `ctx.collect`.
4. An empty result returns a message starting `Không có dữ liệu:` — rule 3 of the system prompt reads it.
5. One line in `FACTORIES` ([registry.ts:27](../../../apps/api/src/modules/assistant/tools/registry.ts#L27)).
   **Append; do not reorder** — the list sits in the cached prefix.
6. Tests: unit tests against a live dev database in `tools/data/data*.test.ts` (construct a `ToolContext` with
   `vi.fn()` collectors, assert rows *and* provenance), plus `registry.test.ts` if the count or conditionality changes.
7. `npm run test:api:live` — the intent-routing suite. It **costs real tokens**, and the runbook requires a run
   whenever tools or the system prompt change. Add a case proving the model actually routes to the new tool; a tool the
   model never picks is pure prefix cost.
8. Update [docs/runbooks/map-assistant.md](../../runbooks/map-assistant.md) — it states the tool count in its opening
   paragraph and carries the known-limits list.
9. Verify in a browser with a real key. The runbook's first-run section is the standing reminder that a provenance chip
   proves a tool *ran*, not that its input was right.

## 8. Traps worth knowing before you start

- **A grounded-looking answer can be ungrounded.** The 2026-09-14 first-run test caught the model feeding
  `nearest_features` a remembered coordinate — wrong by 117 km, with a provenance chip attached. Ask the same question
  three times; static data with drifting answers means something is being filled in by the model.
- **The `_active` views are an optimizer fence.** Any new predicate applied on top scans the whole layer. §4.2.
- **`run_sql` cannot see `basemap` or the base tables.** §4.5.
- **Sessions and the token budget live in process memory.** A multi-process deployment breaks both.
- **The panel renders raw text, not Markdown.** A new tool that returns tables will show as literal pipes and asterisks.
