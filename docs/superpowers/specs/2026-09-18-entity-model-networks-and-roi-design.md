# Entity Model, Networks and ROI Analysis — Design

**Date:** 2026-09-18
**Status:** Approved design — not yet implemented
**Branch:** to be cut from `main` (at `ddb1ac3`, the supervisor-feedback merge)
**Time box:** ~1 week
**Amends:** the analysis surface shipped in
[2026-09-17-supervisor-feedback-map-operations-design.md](2026-09-17-supervisor-feedback-map-operations-design.md)
**Read first:** [2026-09-14-spatial-analysis-tools-handover.md](2026-09-14-spatial-analysis-tools-handover.md) §4 (what the
data is), §6.6 (why river topology was blocked) and
[2026-09-16-dataset-registry-and-one-command-build-design.md](2026-09-16-dataset-registry-and-one-command-build-design.md)
(the registry these ingests should use).

## Problem

Three defects share one root cause: **the database has rows, not entities.**

1. **One river is many rows.** `water.rivers` is OSM waterways: 9,486 rows, 1,327 of them named, 466 distinct names.
   Searching "thu" returns *two* hits both called "Sông Thu Bồn". Picking one as an analysis input gives an arbitrary
   fragment of the river. The same is true of roads: `basemap.roads_region` holds 527,215 segments, and "Quốc lộ 14"
   is hundreds of them.
2. **Analysis inputs are drawn shapes only.** The toolbar shipped in the supervisor-feedback release makes each tool
   draw its own geometry, so a shape cannot be reused between tools; the "Dùng hình vừa vẽ" button is a workaround
   that remembers exactly one shape and refuses it when the type does not match.
3. **Administrative questions are unanswerable.** "Bao nhiêu đập trong tỉnh Đắk Lắk" — the most common question this
   atlas will get — has no implementation: province and ward polygons are browser GeoJSON files, not database tables.

Downstream of the same cause: there is no river topology (so "thượng nguồn của đập X" cannot be asked), no
relationship between a dam and the reservoir it impounds, and the reference layers (roads, landuse, places) are
renderable but not queryable.

## Scope

**In scope**

- A hierarchy in `water.rivers`: named river → reach → OSM way, with composition and flow links.
- A HydroRIVERS ingest that keeps `NEXT_DOWN`, joined to OSM names with a recorded confidence.
- Province and ward polygons in the base database, and administrative codes stamped onto every feature.
- A read-only access path to the `basemap` reference layers, with named entities and search.
- ROI as a first-class object, and the toolbar reorganised around it.
- Network edges and cross-entity links, traversed with recursive SQL.
- The assistant tools that follow from the above.

**Out of scope** (stated so nobody fills the gap with a guess)

- **Routing** (shortest path, isochrones, nearest road access). Needs pgRouting, which is not in the database image.
  The edge tables are shaped so adopting it later is an extension install plus a noding step.
- **Flood modelling and dam-break inundation.** Hydraulic modelling, not a buffer. Flood exposure is used in §8 only
  as a pressure test on the schema.
- **A graph database.** See §7.
- Contour lines as an analysis input (considered, dropped — they are cartographic output, not entities).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Entity model | One table, three levels, self-referential | User's design. Identity becomes a row, not a derived cache |
| Link keys | `external_id`, never `id` | An edit writes a new row with a new `id`; an `id` link would point into a superseded version |
| Composition vs hydrology | Two columns, `parent_external_id` and `flows_into_external_id` | One overloaded "parent" would mean "is part of" on one row and "flows into" on the next |
| Identity space | `rivers.external_id` becomes prefixed text | Three sources (OSM, HydroRIVERS, derived rivers) now share it; `HYRIV_ID` and OSM ids can collide |
| Level-1 geometry | Derived, rebuilt at ingest and on edit-commit | Storing it without an owner is the staleness pattern that broke `rivers_overview` |
| Boundaries | Baked into the base DB from the committed GeoJSON; later changes via the registry | A fresh clone must work offline |
| Admin stamping | `province_codes text[]`, `ward_codes text[]` + GIN | A river crosses provinces; one column cannot answer "sông chảy qua Đắk Lắk" |
| Reference layers | Own read-only registry, derived entity table | They are unversioned, in another schema, with a different geometry column name |
| Networks | Adjacency + recursive CTEs in PostgreSQL | The river network is a directed tree; a second store would break INV-1 |
| Cross-entity links | One generic link table with confidence and source | A column per relation means a migration per idea |

---

## §1 Entity model: one table, three levels

`water.rivers` gains a hierarchy.

| Level | Row is | Geometry | Origin |
|---|---|---|---|
| 1 | Named river — "Sông Srêpốk" | merged, **derived** from member reaches | names from OSM, grouping from the network |
| 2 | Reach — confluence to confluence | as imported | HydroRIVERS (`HYRIV_ID`, `ORD_STRA`, `NEXT_DOWN`) |
| 3 | OSM way | as imported | OSM waterways (today's rows) |

New columns on `water.rivers`:

```
feature_level       smallint NOT NULL   -- 1 river | 2 reach | 3 way
parent_external_id  text                -- composition: way -> reach -> river
flows_into_external_id text             -- hydrology: reach -> reach, river -> river
match_confidence    real                -- 0..1, for computed parent links (§2)
```

**Why two link columns.** `parent_external_id` answers "what is this part of"; `flows_into_external_id` answers "where
does the water go". Overloading one column would make its meaning depend on the row's level, and every query would have
to know which.

**Why links key on `external_id`.** Versioned tables never update in place: an edit writes a new row with a new `id`
inside a new dataset version, and `water.<layer>_active` resolves the chain with `DISTINCT ON (external_id)`. A link
holding an `id` points into superseded data the moment anyone edits the parent. Every hierarchy walk therefore runs
**after** version resolution — a recursive walk nested inside the existing recursive version resolution.

**Identity space.** `rivers.external_id` is `integer` today (the OSM way id) with a unique index per version. Three
sources now share that space and `HYRIV_ID` values can collide with OSM ids, so the column becomes `text` with a source
prefix: `osm:12207485`, `hyriv:40315120`, `river:0012`. The registry already supports text external ids
(`externalIdType: 'text'`, with uuid allocation for steward-created rows). Consequences to carry: a migration that
rewrites existing values, `LAYER_ATTRIBUTE_MAP`, the GeoServer attribute type, and the seed/ingest paths.

**Level-1 geometry has an owner.** It is rebuilt by the pipeline after ingest, and on commit of any edit session that
touched a member row — the same commit-time hook that maintains §3's stamped codes. Not a per-row trigger: a one-row
edit must not re-cluster a layer.

**`stream_order` stops lying.** Level 2 carries the true Strahler order from HydroRIVERS; level 3 keeps the OSM
waterway rank it has always held, documented as such; level 1 takes the maximum over its reaches.

**Rendering.** GeoServer publishes `rivers_active`, so the published view filters by level — level 1 at far zoom, level
2/3 near — otherwise every river draws twice and clicks are ambiguous. This supersedes the `rivers_overview` matview,
which exists today to do exactly the far-zoom job; it is dropped in the same migration that adds the filter.

**Editing rules.** Geometry is editable on level 3 only. Level 1 geometry is derived; level 2 comes from ingest.
Attributes (notably `name`) remain editable at level 1. Deleting a parent is refused while live children reference it.

## §2 Topology ingest: reaches and the name join

**Source.** HydroRIVERS (HydroSHEDS, CC BY 4.0), already used by `prep_hydrosheds.py`, which currently keeps only
`HYRIV_ID`, `ORD_STRA`, `LENGTH_KM`. The prep step must also keep **`NEXT_DOWN`** — the reason this ingest exists.
Clipped to the six working provinces as today.

**Load.** Reaches enter `water.rivers` as level-2 rows: `external_id = 'hyriv:<HYRIV_ID>'`,
`flows_into_external_id = 'hyriv:<NEXT_DOWN>'` (HydroRIVERS writes `0` for a terminal reach → `NULL`),
`stream_order = ORD_STRA`. This lands as a new **ingest version** through the existing versioning pipeline, so it is
reversible by moving the active pointer, and it is declared as a descriptor in `packages/atlas-data` rather than a
sixteenth bespoke script.

**Name join.** HydroRIVERS has no names; 1,327 OSM ways do. For each named OSM way: sample points along it, find the
nearest reach within a tolerance per sample, take the majority. Record on the OSM row both the resulting
`parent_external_id` and a `match_confidence` (share of agreeing samples, scaled by median distance). Unmatched and
low-confidence rows stay visibly so; they are never silently attached.

**Level-1 rivers.** Walk `flows_into` to obtain connected reach sets; take the majority name among each set's matched
OSM ways; emit one level-1 row per set. A set with no matched name gets a river row **with no name** — a valid ROI
target, never an invented name.

**Tributaries.** River A `flows_into` river B when A's outlet reach has its `NEXT_DOWN` inside B.

**Activation gates** (failure means the version is not activated):

- no cycles in `flows_into`; no reach with two parents;
- Strahler order never decreases downstream;
- every level-1 river has at least one reach;
- named-OSM-way match rate at or above the baseline measured on the first real run, then pinned — so a later re-ingest
  cannot silently regress.

## §3 Boundaries in the base database

**Tables.** A new `admin` schema in `infra/postgis/init.sql`; tables created by migration, populated by the existing
seed runner from the committed files, so a fresh clone works **offline**:

- `admin.provinces` — 34 rows from `apps/web/public/provinces-34.geojson`
- `admin.wards` — 616 rows from `wards-region.geojson`, carrying `province_code`

Columns: `code` (PK), `name`, `name_en`, `full_name`, `area_km2`, `geom MultiPolygon 4326`; GiST on geometry, btree on
`code`, btree on `wards.province_code`.

**Stamping.** Every feature row in the eight thematic layers gains `province_codes text[]` and `ward_codes text[]` with
GIN indexes. Arrays, not scalars: a river crosses provinces, and "những sông chảy qua Đắk Lắk" must work. A point gets
a one-element array, so every layer has one shape and one predicate: `province_codes && ARRAY['66']`.

Computed at ingest and recomputed on edit-commit, by the same hook that rebuilds level-1 geometry.

**Query surface.**

- `GET /api/layers/:key/features?province=66` (and `?ward=`).
- Analysis ops accept an admin unit as an ROI.
- Assistant tool `features_in_admin_unit(layerKey, code)` — an indexed lookup, not geometry maths, so it cannot hit the
  5-second analysis timeout.
- `PROVINCE_CENTROIDS` (hardcoded browser centroids behind `zoomToRegion`) is retired in favour of real extents.

**Accuracy, stated.** The committed boundaries are simplified to ~11 m (`fetch-boundaries.mjs`: 0.0001° tolerance,
5-decimal rounding). A feature within ~11 m of a border may be stamped to the neighbour. Adequate for counting and
filtering; **not** adequate for legal use or for measuring against a boundary. Exact boundaries, if ever needed, arrive
as a registry dataset.

## §4 Reference layers: access, entities, search

The `basemap` tables are unversioned, have no `external_id` or `deleted`, name their geometry column `geometry`, and are
created by `load_basemap.py` rather than a migration. They get their own read-only path.

**Reference registry** (API), mirroring `layers/registry.ts`: one entry per usable table declaring key, table, geometry
column, id column (`osm_id`), name column, optional `ref` column, **classification column** (`fclass`) and **summable
numeric attributes** (`places_region.population`). As with `layerTable()`, this is the only place a layer key becomes
SQL.

In scope: `roads_region`, `railways_vn`, `water_region`, `landuse_region`, `places_region`.
Out: `dem_region` and `contours` (raster/derived, already served by the elevation ops), and the `*_vn` national
duplicates, which would confuse a region-scoped atlas.

**Named entities.** The loader builds `basemap.reference_entities`: group by `coalesce(ref, name)` plus a spatial
cluster (`ST_ClusterDBSCAN`), storing the merged geometry and member `osm_id`s. Rebuilt whenever the loader runs.
Unlike the water layers there is no edit path, so the derived table has exactly one writer.

**Search.** `/api/search` gains an optional source filter so roads and landuse are findable. Requires new trigram
indexes on `roads_region.name` and `.ref`, `landuse_region.name`, `water_region.name`, `railways_vn.name`,
`places_region.name` — none exist today.

**As ROI.** Analysis ops accept `{ referenceLayer, entityId, radiusKm? }`. Lines and points require a radius. The ROI is
clipped to the working region and refused past a size limit, with a message that says which limit was hit — a national
road dissolved end to end otherwise produces an enormous buffer.

**Assistant access** is by typed tools on the app pool. The `webatlas_assistant` SQL role gains nothing; `run_sql` still
cannot see `basemap`, as migration 8 intended.

## §5 ROI as a first-class object

```
ROI = { geometry (EPSG:4326), source, label }
source =
  | drawn   { kind: freeform | circle | rectangle }
  | entity  { layerKey | referenceLayer, entityId, radiusKm? }
  | admin   { province | ward, code }
  | result  { opId }        -- a previous analysis output
```

**Interaction.** Draw or pick an ROI; it stays selected and labelled on the map; the tool buttons enable. With no ROI
they are disabled with a tooltip stating why. An entity becomes the ROI from a search result, a map click, or the
assistant.

**Two input families**, because they are not interchangeable:

- **Area tools** — đo diện tích, vùng đệm, chọn trong vùng, thống kê độ cao — take an ROI.
- **Path tools** — đo chiều dài, trắc diện độ cao — take a line, drawn or a river entity (now meaningful, per §1).

**Chaining.** Any result geometry can become the next ROI: buffer a river 5 km → count dams inside → elevation stats
there. This replaces the "Dùng hình vừa vẽ" button and its type-mismatch error.

**Radius prompt.** Line and point entities need a radius to become an area; the panel asks rather than failing.

## §6 Networks

Each network is an **edge list with adjacency**, traversed by recursive SQL, in PostgreSQL:

| Network | Shape | Source of edges | Built in this spec? |
|---|---|---|---|
| Rivers | directed tree | `flows_into_external_id` (from `NEXT_DOWN`) | **Yes** — the reach row *is* the edge; no separate edge table |
| Roads, railways | undirected graph | noding at intersections | **No** — deferred (see below) |

Landuse, places and water bodies are not networks; they are polygons and points.

**Rivers need no edge table.** A level-2 reach row is already an edge: its geometry is the span, and
`flows_into_external_id` is its single outgoing adjacency. Upstream and downstream are `WITH RECURSIVE` walks over that
column, run after version resolution.

**Road and rail noding is explicitly deferred.** Splitting 527,215 road rows at their intersections is a heavy
preprocessing job that only pays off once routing exists, and routing needs pgRouting, which is not in the image. What
this spec builds for roads is the named-entity dissolve in §4 — enough to select "Quốc lộ 14" as an ROI, which is what
was asked for. When routing is taken up, the edge table is created with `from_node` / `to_node` columns matching
pgRouting's `source`/`target` convention, so it is an extension install plus a noding step rather than a remodel. That
shape is recorded here; it is not implemented now.

**Why not a graph database.** The traversal needed is a tree walk, which `WITH RECURSIVE` already does — the codebase
uses that shape for version chains. A second store would be a second source of truth, against INV-1, and would
reintroduce precisely the synchronisation problem the dataset registry exists to remove. Apache AGE and pgRouting are
**not available** in `postgis/postgis:16-3.4` (checked); `postgis_topology` is installed but enforces shared
edge/face primitives at a heavy API cost and still provides no routing.

**Why not a star schema.** It is an aggregation pattern (facts and dimensions) with no notion of traversal. It answers
reporting questions, not "what is upstream". If report generation later needs pre-aggregates, they belong in the
registry as a derived dataset.

## §7 Cross-entity relationships

```
feature_links(
  from_layer, from_external_id,
  to_layer,   to_external_id,
  relation,      -- on_reach | impounds | monitors | crosses
  confidence,    -- 0..1 for computed links
  source,        -- 'computed' | 'steward'
  updated_at )
```

A column per relation (`dams.reach_external_id`, …) would mean a migration per idea and a rewritten row per edit. The
link table takes new relation types for free and is the same edge shape as §6, so one traversal implementation serves
both.

| Relation | Meaning |
|---|---|
| `on_reach` | dam / station → the reach it sits on |
| `impounds` | dam → the lake it creates |
| `monitors` | station → river or lake |
| `crosses` | road / railway → river |

`flows_into` stays a column on the row (§1) rather than a link, because it is single-valued and read on every
traversal.

Feature → admin unit stays as §3's stamped arrays: every feature has one, and an indexed array is far faster than a
join.

**Two properties that make the links trustworthy:**

- Computed links carry a **confidence** (distance, overlap share). A dam 40 m from two reaches is genuinely ambiguous,
  and the model must say so rather than pick silently.
- Recomputation **never overwrites `source='steward'` rows**. Automated association is wrong often enough that a human
  correction must survive the next ingest.

Maintenance rides the same commit-time hook as §1 and §3.

## §8 Flood exposure as a schema pressure test

Flood exposure is **not specced as a feature here**. It is used to check that the structure supports it later without a
remodel.

| Requirement | Met by | Adjustment |
|---|---|---|
| Extent polygon from any source (drawn, hazard feature, admin unit, later a modelled raster) | §5 ROI is source-agnostic | ROI must never be typed to "drawn shape" |
| Overlay against roads/landuse/places **by class** | §4 reference registry | declare the class column (`fclass`) — folded into §4 |
| Aggregate km of line, ha of polygon, **sum of population** | `places_region.population` present on all 6,145 rows | declare summable attributes — folded into §4 |
| Resolve which river an affected asset relates to | §6 network + §7 links | none |
| Store scenario outputs (HAND rasters, modelled extents) | The dataset registry models derived datasets | none |

Conclusion: the structure carries it. The missing ingredient is not schema but data — `water.flood_zones` holds **2
placeholder rows**, as do four other hazard layers. Recorded so that nobody mistakes a buffer for a flood model.

## §9 Assistant

**`resolve_entity(name)`** returns entity id and level for named rivers, roads, lakes, dams and admin units. This is the
fix for the failure the live routing run caught: prompt rule 5 sends *every* place name to `locate_place`, the
settlement gazetteer, so "hồ Lắk" fails before any tool runs. The rule is scoped — settlements to the gazetteer, map
features to the resolver.

**Existing tools take an ROI** rather than only a feature id: `select_within`, `zonal_elevation` and `buffer_feature`
accept `roi: { kind: 'entity' | 'admin' | 'geometry', …, radiusKm? }` — the same object the toolbar uses. Extending
tools rather than adding near-duplicates matters: every definition sits in the cached prompt prefix and is resent every
turn.

**Three new tools:**

- `features_in_admin_unit(layerKey, code)` — §3's indexed query.
- `upstream_of(entityId)` / `downstream_of(entityId)` — the recursive walk over `flows_into`.
- `related_entities(entityId)` — reads §7's link table.

Live routing cases are added for each and run once before sign-off; the suite costs tokens, so it runs deliberately.

## §10 Sequencing and verification

| Order | Piece | Rationale |
|---|---|---|
| 1 | Boundaries + stamped codes (§3) | Independent; answers the most common question immediately |
| 2 | Reference registry, entities, indexes (§4) | Unblocks roads/landuse as ROI and in search. Named-entity dissolve only — no road noding (§6) |
| 3 | Topology ingest + hierarchy (§1, §2) | The largest piece; everything river-shaped depends on it |
| 4 | ROI object + toolbar (§5) | Consumes 1–3; ships usable on water polygons and admin units even if 3 slips |
| 5 | Assistant (§9) | Tool shapes settle after the ROI object does |

**Verification**

- Ingest: the §2 activation gates, run as tests against the loaded version.
- Versioning: a test that edits a level-3 row and asserts the level-1 geometry, stamped codes and computed links all
  update on commit, and that a steward-set link survives a recompute.
- Admin stamping: a feature moved across a border restamps.
- ROI: contract tests per source kind; a browser pass for the disabled-until-ROI behaviour, because jsdom cannot prove a
  button is reachable.
- Performance: `select_within` over an admin-unit ROI and `upstream_of` on a deep basin, both inside the 5-second
  analysis budget.

**Risks**

| Risk | Standing |
|---|---|
| The OSM↔HydroRIVERS name join needs a second pass | Most likely schedule risk; the confidence column makes a bad join visible rather than silent |
| `external_id` type change touches seeds, GeoServer and the shared registry | Contained to one migration plus the ingest paths; tests cover the resolver |
| Five of eight thematic layers hold 2 placeholder rows | Unchanged by this work; any analysis over them is correct and useless until real data lands |
| The week is tight | Sequencing is chosen so 1, 2 and 4 form a coherent release without 3 |
