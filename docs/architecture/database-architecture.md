# WebATLAS Database Architecture

**Document status:** Living document. Revise when the schema changes.
**Revision:** 1.4 — 30 September 2026
Phase 1 (administrative boundaries and stamping) implemented; see docs/superpowers/plans/2026-09-18-plan-1-admin-boundaries-and-stamping.md.
Phase 2 (reference layers, named entities and search) implemented; see docs/superpowers/plans/2026-09-22-plan-2-reference-layers-and-entities.md.
Phase 3 (river topology and the three-level hierarchy) implemented; see docs/superpowers/plans/2026-09-22-plan-3-river-topology-and-hierarchy.md.
Phase 4 (the region of interest and the analysis toolbar) implemented; see docs/superpowers/plans/2026-09-30-plan-4-roi-and-analysis-toolbar.md.
**Prepared for:** Engineers, data stewards and technical reviewers of the WebATLAS water-resources information system.

---

## 1. Introduction

### 1.1 Purpose

This document describes the architecture of the WebATLAS spatial database: how geographic features are identified,
related, versioned and secured, and why each of those mechanisms takes the form it does. It is intended to be read
without reference to the source code, and to remain accurate as the schema evolves.

### 1.2 Scope

The document covers the PostgreSQL/PostGIS database that serves the WebATLAS application: its schema organisation,
entity model, temporal model, network and relationship models, indexing strategy, and access control. It does not
describe the application programming interface, the web client, or the map-server configuration except where those
components impose a constraint on the database design.

### 1.3 Document conventions

Two states are distinguished throughout:

- **Implemented** — present in the database at the stated revision.
- **Designed** — specified and approved, but not yet implemented. Designed elements are marked as such in each table.

The design elements in this revision originate from the entity-model, networks and ROI design specification
(reference [1]).

### 1.4 Definitions and abbreviations

| Term | Definition |
|---|---|
| **Feature** | A geographic object with attributes and a geometry, stored as one row. |
| **Layer** | A named collection of features of one type (for example, dams). |
| **Reach** | A length of watercourse between two confluences; the unit of hydrological topology. |
| **Segment** | One stored row of a watercourse or road. A storage artefact, not a classification. |
| **ROI** | Region of interest; the geometry over which a spatial analysis is performed. |
| **Dataset version** | An immutable snapshot of one layer's contents, produced by an ingest or by an editing session. |
| **Stamping** | Pre-computing a relationship (such as the province containing a feature) and storing it on the feature row. |
| CRS | Coordinate reference system |
| DEM | Digital elevation model |
| GiST | Generalised search tree; the PostgreSQL index type used for geometry |
| HAND | Height above nearest drainage |
| OSM | OpenStreetMap |
| WFS | Web feature service |

---

## 2. Architectural context and principles

### 2.1 Position of the database in the system

The database is the authoritative store. The map server (GeoServer) projects a read-only view of it over WFS, the
application programming interface is the only writer, and the web client holds a transient cache refreshed after each
write. Consequently, every rule expressed in the schema is enforced for all consumers, and no consumer may hold state
that contradicts it.

### 2.2 Binding invariants

Five invariants, established at the outset of the project, constrain all subsequent design (reference [2]). Those
material to the database are:

- **INV-1.** Feature data resides only in PostGIS. The map server stores nothing; all writes pass through the
  application programming interface.
- **INV-2.** The layer catalogue is authoritative and singular; the client layer panel and the map-server publication
  are both derived from it.
- **INV-4.** Each layer's attribute schema has exactly one definition, consumed by migrations, the interface and the
  client.
- **INV-5.** Raster earth-observation products are stored as cloud-optimised files and served as coverages, not inside
  PostGIS.

These invariants explain several decisions that would otherwise appear conservative, notably the rejection of a
separate graph database (§7.4) and the insistence that derived values have a single owner (§9).

---

## 3. Schema organisation

The database is divided into four schemas by *governance*: who writes the data, how often, and under what guarantees.

| Schema | Contents | Written by | Versioned | Status |
|---|---|---|---|---|
| `app` | Users, audit log, dataset versions, ingest lineage | Application, pipeline | n/a | Implemented |
| `water` | Eight thematic feature layers | Pipeline and authorised editors | Yes | Implemented |
| `admin` | Province and ward boundaries | Seed; later the dataset registry | No | Implemented |
| `basemap` | Reference data: roads, railways, land use, settlements, water bodies, elevation raster, contours | Loader scripts | No | Implemented |

The division is deliberate. Thematic data in `water` is editable and therefore requires a temporal model, audit trail
and per-feature authorisation. Reference data in `basemap` changes only when an operator reloads it, and carrying the
same machinery for it would impose cost without benefit. Administrative boundaries occupy an intermediate position:
they change rarely, but they are authoritative for statutory reporting, and they are therefore isolated in their own
schema rather than mixed with imported reference data.

One table in `basemap` departs from that governance rule and is written by the application rather than by a loader
script: `basemap.reference_entities`, described in §10.2. It shares the schema for locality — it is derived
entirely from the other `basemap` tables and has no reason to live elsewhere — but it is rebuilt by a dedicated
script (`npm run reference:build`), not by `load_basemap.py`, and it deliberately does not share that script's
lifecycle, because that lifecycle destroys indexes.

---

## 4. Entity model

### 4.1 Problem addressed

Before revision 1.3, a watercourse was stored as an arbitrary number of rows derived from OpenStreetMap ways. Of 9,486
rows, 1,327 carried a name and those names resolved to 466 distinct values. A search for a river therefore returned
several results describing the same watercourse, and selecting one yielded a fragment of it.
Road data exhibits the same property at greater scale: 527,215 segments, of which a single national highway may comprise
several hundred.

The stored unit is a consequence of how the source data was produced, not a property of the thing itself. The schema
must therefore distinguish the entity from its storage units. For watercourses it now does (§4.2); for roads, the
entity is provided by reference-data aggregation instead (§10.2).

### 4.2 Three-level hierarchy (implemented)

Watercourses are modelled in a single table, `water.rivers`, with an explicit `feature_level` attribute and
self-referential links (§4.3). One `rivers` dataset version holds all three levels.

| Level | Entity | Rows | Geometry | Origin |
|---|---|---|---|---|
| 1 | Named river | 588 | Derived from its member OpenStreetMap ways | Built on activation (§9) |
| 2 | Reach | 13,045 | As imported | HydroRIVERS v1.0, whole reaches intersecting the six working provinces, with the downstream link |
| 3 | Way | 9,486 | As imported | OpenStreetMap watercourses |

A single table is used, rather than one table per level, so that identity, authorisation, versioning and the audit
trail apply uniformly, and so that a query may select entities at any level without a union of dissimilar relations.
The consequence is that `water.rivers_active` returns all three levels (23,119 rows), and **filtering by level is each
consumer's responsibility**. There are three consumers, and each says which level it means:

- `water.rivers_detail` — level 3 only. It backs the map-server layer `webatlas:rivers`, so the detailed map draws each
  watercourse once rather than as its ways, reaches and entity stacked.
- `water.rivers_overview` — the far-zoom layer: level-1 rivers that include at least one OpenStreetMap
  `waterway=river` way (324 of 588), simplified at 0.01°. The restriction matches what the detailed layer's style
  draws at the same scales; with all 588, every named stream drew as a trunk river at far zoom and vanished on zooming
  in. It was a materialised view until revision 1.3 and is now a plain view (§9).
- Search (`GET /api/search`) — level 1 only, filtered before version resolution as §5.3 requires. "Thu Bồn" returns one
  result.

**How a reach gets a name.** HydroRIVERS carries topology but no names; OpenStreetMap carries names but no topology. Each
reach is sampled at five points along its length, each sample takes the nearest named way within about 1.1 km, and the
name is accepted only on a strict majority (at least three of five) with a median sample distance of at most 500 m. The
accepted match records a confidence in [0.3, 1.0]: the share of agreeing samples, scaled down by median distance. Of
13,045 reaches, 4,716 are named this way, carrying 439 of the 466 distinct names. A refused match is recorded as no
match, never as a low-confidence one.

**How reaches become rivers — and four departures from the design specification.** Each is a measured correction; the
plan records the measurements in full.

1. *A river is one name plus one connected group of reaches, not one connected component.* The specification grouped by
   connected component. A component is a basin: the largest carries 134 distinct names (Sê San, Srêpốk, Krông Ana, Đăk
   Bla and some 120 named streams), and one river per component would have discarded 133 of them. Same-named groups that
   are not connected become separate rivers — `Sông Cái`, literally "main river", yields 12. Each group's canonical
   member is its most downstream reach, which is unique because the downstream link is a tree.
2. *A reach with no confident name belongs to no river.* The specification gave such reaches a nameless river. 8,291
   reaches remain unnamed; a nameless entity for each would flood search and region-of-interest selection with
   unselectable rows. They remain level-2 rows, fully walkable through the downstream link.
3. *Level-1 geometry derives from member ways, not member reaches.* Per river, way length and reach length agree to a
   median ratio of 1.11 (Sông Ba: 349 km of way against 352 km of reach), so the difference is vertex detail, not
   extent. Ways give finer geometry, the same shape the detailed layer draws, and independence from the vote: a bad
   match cannot deform a river. Geometry source does not decide which rivers exist — the 27 names with ways but no
   matched reach have no river.
4. *Single-reach gaps are bridged.* A reach with no voted name whose downstream reach and at least one upstream reach
   carry the same voted name takes that name, with confidence 0.2. That is below the vote's floor of 0.3, so a
   confidence under 0.3 identifies a bridged reach. The pass runs once against the vote's result and never cascades.
   Without it one unnamed reach severed Sông Thu Bồn from its own outlet. 38 reaches are bridged, merging 631 groups
   into 588 rivers.

### 4.3 Relationships

Two relationships are represented, in separate columns:

- `parent_external_id` expresses **composition**: a reach belongs to a river, and a way belongs to a river. A way is
  not a member of a reach: the two are independent digitisations of the same water, and what connects them is the
  name vote, not containment. Each named way joins the same-named river whose reaches lie nearest to it.
- `flows_into_external_id` expresses **hydrology**. On a reach it is HydroRIVERS' `NEXT_DOWN`: 184 reaches are
  terminal, and 53 flow out of the working region, so their link legitimately leaves the table. On a river it is
  derived: river A flows into river B when A's outlet reach flows into a reach of B. 423 of the 588 rivers have such
  a link.

A single overloaded relationship was considered and rejected: its meaning would then depend upon the level of the row
being examined, and every query would require that knowledge to interpret the result correctly.

### 4.4 Identity and referential keys

Relationships reference `external_id`, the stable business key, and never the primary key. The reason is temporal: an
edit does not modify a row but writes a new row, bearing a new primary key, in a new dataset version (§5). A reference
to a primary key would therefore address a superseded row as soon as its target were edited, while appearing valid.

Because three sources share one identity space, and because HydroRIVERS identifiers may collide numerically with
OpenStreetMap way identifiers, the key is text namespaced by source:

| Prefix | Meaning | Example |
|---|---|---|
| `osm:` | OpenStreetMap way | `osm:12207485` |
| `hyriv:` | HydroRIVERS reach | `hyriv:41295432` |
| `river:` | Derived river; the suffix is the identifier of its outlet reach | `river:41295269` (Sông Thu Bồn) |
| `edit:` | A feature a steward created, which has no upstream identifier | `edit:<uuid>` |

A river's identifier is derived, not sequential, so that rebuilding the hierarchy on every activation (§9) reproduces
the same identifiers: a river keeps its key for as long as its outlet reach keeps its name.

Converting `external_id` from integer to text was refused while any view depended on the column, so the migration drops
and recreates the resolution view and everything built on it. A recreated view starts with no privileges, so the
assistant's read role (§12.2) must be re-granted explicitly each time; migrations 16, 18, 19 and 20 each carry that
grant, and 16 and 18 were written after the loss was discovered.

### 4.5 Editing rules (implemented)

Only level-3 ways are edited by hand; an update or deletion of a level-1 or level-2 row is refused with a conflict. The
specification kept level-1 attributes, notably the name, editable. That was reversed on 29 September 2026, by decision:
the rebuild on activation (§9) derives a river's name and geometry from its ways, so a direct edit would be silently
reverted in the commit that made it. A steward renames or reshapes a river by editing its ways. Level 2 is ingested
topology. Because only ways, which have no children, can be deleted, the rule that a parent may not be deleted while
live children reference it holds without a separate check.

---

## 5. Temporal model

### 5.1 Snapshot versioning

Each thematic layer is versioned by immutable snapshot. A row belongs to exactly one dataset version; a version is
either an *ingest* (a load from a source) or an *edit* (the result of one editing session); one version per layer is
marked active.

An edit therefore never modifies data in place. This yields an auditable history, makes a bad import reversible by
moving a pointer rather than by restoring a backup, and guarantees that a reader observing one version observes a
self-consistent state.

### 5.2 Resolution

For each layer, a view resolves the active version and its ancestry: the chain is walked recursively from the active
version through its parents, and for each business key the row from the nearest version is retained; rows marked as
deleted are then discarded. The view is the layer as a consumer should see it.

### 5.3 Consequence for query construction

The resolution view is an optimiser fence: a predicate applied over it cannot be pushed beneath it, so filtering the
view causes the entire layer to be scanned and de-duplicated before the predicate is evaluated. Queries that must use an
index therefore apply their predicate to the base table first, to obtain candidate business keys, and resolve the
version chain only for those candidates.

Two obligations follow, and both have produced defects when neglected:

1. The candidate step runs across all versions and therefore returns a superset. The real predicate, together with the
   deletion test, **must** be re-applied after resolution.
2. Two independent chains in one statement require distinct relation aliases.

### 5.4 Operational note on version accumulation

Repeated ingests accumulate versions. In the development database at revision 1.0, 2,647 versions had accumulated, of
which nine were reachable from an active version; the unreachable remainder accounted for approximately 1.4 GB, or 63%
of the database. Pruning must retain the complete ancestor chain of each active version, not merely the active version
itself, because a resolved view inherits rows from its ancestors.

---

## 6. Spatial reference and administrative geography

### 6.1 Coordinate reference system

All geometry is stored in WGS 84 (EPSG:4326). The client presents coordinates in a user-selected system — WGS 84, VN-2000
national projections, or the province-specific VN-2000 three-degree zones defined in reference [3] — but conversion is a
presentation concern. Storage remains in one system so that no query must reason about mixed references.

### 6.2 Administrative boundaries

Province and ward polygons are held in the `admin` schema, populated during seeding from files committed to the
repository, so that a newly cloned working copy functions without network access.

Coverage is asymmetric between the two levels: `admin.provinces` holds all 34 provinces nationally, while
`admin.wards` holds only the 616 wards of the six provinces in the project's working region. A ward listing for a
province outside the region therefore returns empty, not an error.

### 6.3 Administrative stamping

Each feature carries the administrative units it intersects, as indexed arrays of province and ward codes. Arrays rather
than scalars: a watercourse traverses several provinces, and a scalar column cannot answer which watercourses pass
through a given province.

The values are computed at ingest and recomputed when an editing session commits a change that affects them.

This is a deliberate denormalisation. The question "how many dams are in this province" is relational and its answer is
stable; evaluating it as a geometric intersection on each request would incur cost repeatedly for an unchanging fact.
Ad-hoc areas, which have no precomputed relationship, are served instead by the region-of-interest mechanism (§8).

### 6.4 Accuracy limitation

The committed boundary geometries are simplified to approximately 11 m. A feature lying within that distance of a
boundary may be attributed to the neighbouring unit. This is acceptable for counting, filtering and cartography; it is
not acceptable for statutory determinations or for measurement against a boundary. Exact geometries, should they be
required, are to be introduced as a registered dataset rather than by editing the simplified ones.

---

## 7. Network model

### 7.1 Networks present

| Network | Structure | Representation | Status |
|---|---|---|---|
| Watercourses | Directed tree | The reach row is the edge; the downstream link is its adjacency | Implemented |
| Roads, railways | Undirected graph | Deferred; see §7.3 | Deferred |

Land use, settlements and water bodies are not networks; they are areas and points.

### 7.2 Traversal

Upstream and downstream queries are recursive traversals of the downstream link, evaluated after version resolution
(§5.2). No additional structure is required: a reach has exactly one downstream neighbour, so the adjacency is a single
column, and the resulting walk is bounded by the size of the basin.

The data supports the walk today: the activation gates (§9) walk the whole network of 13,045 reaches on every
activation. The upstream and downstream operations themselves are not yet exposed; they belong with the analysis tools
that will consume them (§14).

The resolution view is an optimiser fence (§5.3), and it applies here with force: joining reaches to named ways through
`water.rivers_active` did not finish within 120 s, and the same join over a materialised copy of the resolved rows took
10.9 s. Every builder over the network therefore materialises its resolved input into indexed temporary tables first.

### 7.3 Deferred road topology

Establishing a routable road network requires splitting segments at their intersections and assigning node identifiers —
a substantial preprocessing operation over 527,215 rows whose value is realised only when routing is performed. Routing
requires an extension that is not present in the deployed database image. The road network is therefore represented for
selection purposes only, by aggregation of named segments (§10.2). Should routing be adopted, the edge relation is to be
created with node columns following the conventional routing-extension schema, so that adoption is an installation and a
preprocessing step rather than a redesign.

### 7.4 Alternatives considered

**Graph database.** A dedicated graph store was considered and rejected. The traversal required is a walk over a tree,
which recursive SQL performs natively and which the system already employs for version resolution. A separate store
would constitute a second authoritative copy of the same data, contrary to INV-1, and would reintroduce the
synchronisation burden that the dataset registry exists to eliminate.

**Topology extension.** The PostGIS topology extension is installed. It enforces shared edge and face primitives, at the
cost of a substantially more complex interface, and it does not provide routing. It is not used.

**Dimensional (star) schema.** A star schema is an aggregation pattern comprising fact and dimension relations. It
supports reporting; it has no concept of traversal and therefore does not address the requirement. Should pre-aggregated
reporting structures later be required, they are to be produced as derived datasets under the registry.

---

## 8. Region-of-interest model (implemented)

A region of interest is a first-class object: a geometry in WGS 84, the source from which it was obtained, and a label.
Four sources are admitted: a shape drawn by the user; an entity, optionally buffered; an administrative unit; and the
result of a previous analysis.

The analysis operations accept the region of interest irrespective of its source. This property is load-bearing: it is
what allows an analysis to be applied to a hazard polygon, a modelled extent or a hand-drawn area without alteration,
and it is the reason the region of interest must not be typed as a drawn shape.

Operations are divided into those that require an area and those that require a path. A point or line entity must be
buffered before it can serve as an area; the interface requires the radius rather than failing.

As built in revision 1.4, the region of interest is a reference, never geometry, in one of four sources (the `Roi`
type in `packages/shared/src/roi.ts`). `drawn` carries a point, line or polygon drawn by the user. `feature` names a
row of an editable layer by identifier; on a river way, `whole: true` means the level-1 river the way belongs to
(§4.2), resolved server-side through its `parent_external_id` — a way with no matched river is used as itself,
labelled as a segment. `reference` names a reference entity (§10.2). `admin` names a province or ward of the working
region by code. The first three may carry a radius (greater than 0, at most 100 km), which turns a line or point into
an area; an admin unit never carries one, and an area refuses one. The design's fourth source, the result of a
previous analysis, was dropped: chaining goes through the radius and through a "use as region" action on each result
row, which names that row's feature as a new `feature` region, so nothing needs to retain a result's geometry.

`resolveRoi` (`apps/api/src/modules/roi/resolve.ts`) is the only code that turns a region of interest into geometry.
Every analysis operation calls it first, and the browser reaches it through `POST /api/roi/resolve`, which returns the
label, the kind after the radius (area, line or point), the length or area, a simplified display geometry, the bounding
box and the centroid; the full-precision geometry stays on the server. Because the browser's chip and the operations
share this one resolver, the chip never shows a region that a tool would then refuse without saying why. It applies
these limits, in order: the source-complexity limits (§11: 10,000 points, 300 parts), which apply when a radius is
given and are evaluated inside the SQL so that `ST_Buffer` never runs on an oversized source; the clip to the six working provinces; the area ceiling
of 25,000 km²; and the resulting-vertex ceiling of 5,000 points. An admin unit is exempt from the clip and from the
resulting-vertex ceiling: it is selected by code from the working provinces, so it is inside the region by
construction, and Khánh Hoà alone — 5,195 vertices stored (5,031 as resolved) in 164 parts, most of them islands — would exceed the ceiling. No
operation feeds an admin unit's full geometry to an expensive geometric step: "Chọn trong vùng" counts it by codes,
elevation statistics refuses every province on area (the largest ward, 4,208 km², fits its 5,000 km² limit), and
"Gần nhất" uses the centroid.

`select_within` over an admin unit counts features by the stamped `province_codes` or `ward_codes`
(§6.3), served by their GIN indexes, rather than by polygon intersection. Two measurements decided this. The geometric
path over Lâm Đồng, the largest province, took 5.2 s on a cold cache (2.2 s warm), which breaks the five-second
interactive budget; the stamped-code path answers the same four-layer query in about 1.7 s. And it is the method the
assistant's `features_in_admin_unit` uses, so "how many dams in Đắk Lắk" gets the same number from the toolbar and from
the assistant, where polygon intersection against a simplified boundary could disagree for features near a border. The
result names its method ("Theo mã hành chính đã gán"). Every other region is counted
geometrically.

"Gần nhất" measures from the region's centroid, so it is available for every kind; a point's centroid is the point
itself. The centroid is drawn on the map and named in the result, because for a curved river or an L-shaped area it can
fall outside the shape. When the region is itself a feature of the searched layer, that feature is excluded, so the
dams nearest a dam do not begin with the dam at 0 km.

---

## 9. Derived values and their maintenance

The schema contains values that are computed from other values: the geometry of a level-1 river, administrative code
arrays, and computed relationships (§10.1). Each such value has exactly one designated maintenance point: the
activation of a dataset version, through which both an ingest and the commit of an editing session pass.

This rule exists because of a defect observed in the implemented system. A materialised view of trunk watercourses was
refreshed by a function invoked from a single call site. A programmatic caller that did not traverse that site ingested
9,486 features and activated a new version, leaving the materialised view describing the previous one. The condition
persisted for two days and presented differently depending on execution order.

The lesson recorded here is not that materialised views are unsuitable, but that **a derived value whose refresh
obligation resides in a call site rather than in a contract will eventually be stale**.

**The contract is activation.** Every path by which a version becomes the active one — today an ingest or the commit
of an editing session; any future rollback path must use it too — passes through one function,
`versionsService.activate()`, and that function owns both implemented derived values. For the `rivers` layer it runs,
in this order:

1. **Rebuild the hierarchy** (`buildRiverHierarchy`): name the reaches, bridge gaps, group rivers, derive their geometry
   and links (§4.2, §4.3).
2. **Assert the activation gates** (`assertRiverGates`): no cycle in the downstream link; Strahler order never decreases
   downstream; every river has at least one reach; no link points at a missing river. An ingest version must also meet
   the match-rate baseline pinned from the measured build of 23 September 2026 — 4,754 named reaches, 439 names, 588
   rivers — so that a re-ingest cannot silently regress; raising it is a deliberate act. An editing session is held to the structural gates only: a steward who deletes a
   named way lowers the counts legitimately.
3. **Stamp administrative codes** (§6.3), for every layer.
4. **Move the active pointer.**

A failure at step 1 or 2 aborts the caller's transaction, so the version is never activated and the previous one stays
live. The order of steps 1 and 3 is load-bearing: the rebuild inserts new level-1 rows, and stamping updates every row
of the version in one statement, so with the order reversed every rebuilt river would carry empty code arrays and be invisible to any query
by province or ward.

**The rebuild writes only differences.** Every read goes through the resolved version chain, and the result is compared
with what that chain already holds; a row is written into the version being activated only where a derived value
changed, and a river that has lost its last named reach is written as a deletion. An editing session that changes
nothing writes nothing, and one that moves a way writes rows only for what that move changed. A wholesale rewrite would have been
simpler, but would have added every reach, way and river, and one level of version chain, on every commit. Because the
rebuild reads only source data — geometry, names and the HydroRIVERS link — and never a value it derived earlier,
repeating it over an already-built version writes nothing. It costs roughly ten seconds per activation, and the gates
roughly fifteen, measured on the development machine.

**The materialised view is withdrawn.** `water.rivers_overview` is now a plain view over level-1 rivers (§4.2), and the
function that refreshed its predecessor has been deleted. A plain view has no refresh obligation to forget, so the
defect described above cannot recur in that form.

---

## 10. Relationships between entities

### 10.1 Cross-entity relationships (designed)

Relationships between features of different layers — a dam and the reach it occupies, a dam and the reservoir it
impounds, a monitoring station and the water body it observes, a road and the watercourse it crosses — are recorded in a
single relation with a relationship type, rather than as a column per relationship.

Two properties are required of the record:

1. A computed relationship carries a **confidence**. A dam equidistant from two reaches is genuinely ambiguous, and the
   record must express that rather than resolve it arbitrarily.
2. Recomputation **must not overwrite a relationship asserted by a steward**. Automated association is incorrect
   sufficiently often that a human correction must survive the next ingest.

### 10.2 Reference-data entities (implemented)

Reference layers — roads, railways, water bodies, land use and places, each an unversioned OpenStreetMap import held
in `basemap` — are aggregated into named entities by `apps/api/src/db/referenceEntities.ts`, the single writer of
`basemap.reference_entities`. The table holds one row per named, spatially coherent group of segments: an
`entity_id`, the layer it belongs to, the name and route designation the group shares, its dissolved geometry, the
`osm_id` of every member segment, and a count and a sum of any summable attribute the layer declares (places sums
`population`). The aggregation is rebuilt whole, one layer at a time inside a transaction, so a reader never observes
a half-built layer; §10.2.2 explains when that rebuild must run.

**Grouping and identity.** Each source row is keyed by `coalesce(ref, name)`, the OpenStreetMap route designation if
present, otherwise the name. OpenStreetMap's `ref` field is multi-valued — 930 road rows carry a value such as
`QL.14;HCM`, meaning that stretch of road belongs to both Quốc lộ 14 and the Hồ Chí Minh route — so the builder
unnests it on `;` before grouping, and a single road segment may therefore be a member of more than one entity. A
literal reading of `ref` would have grouped `QL.14;HCM` as a route distinct from plain `QL.14`, fragmenting the
highway the grouping exists to unify; with the unnest, `QL.14` dissolves to one entity of 621 members spanning
approximately 998 km. Within one grouping key, `ST_ClusterDBSCAN` then splits members that are not within
`CLUSTER_EPS_DEGREES` (0.02°, approximately 2.2 km at this latitude) of each other into separate entities —
`minpoints = 1`, so an isolated segment still forms its own single-member entity rather than being discarded as
noise. This second step is what keeps identically named but unrelated features apart: the key `Thôn 3` alone groups
into 147 separate clusters, because there are 147 different hamlets of that name in different communes, and merging
them into one entity would be wrong regardless of how the name is spelled. Consequently every layer yields more
entities than it has distinct grouping keys, and that inequality is the mechanism working as designed, not a defect
to be reconciled. `entity_id` is formed as `<layer_key>:<md5(entity_key)>:<cluster_id>`, which is stable across
rebuilds as long as the grouping key and cluster membership do not change.

Measured on a full build against the live dataset (5.6 s for all five layers):

| Layer | Entities | Distinct grouping keys |
|---|---|---|
| roads | 13,354 | 8,848 |
| railways | 203 | 138 |
| water | 597 | 572 |
| landuse | 770 | 759 |
| places | 5,989 | 4,025 |

**Why the trigram indexes are on this table, not on the raw `basemap` tables.** This is a deliberate departure from
treating reference layers exactly as they arrive from the loader, and it is the least obvious property of this
design. `packages/atlas-data/tools/basemap/load_basemap.py` loads each raw table with GeoPandas'
`to_postgis(..., if_exists="replace")`, which **drops and recreates** the table on every run. An index created on
`basemap.roads_region` by a migration would therefore vanish silently the next time the basemap is reloaded, with
nothing to signal that search had quietly stopped using it. `basemap.reference_entities` is never touched by the
loader, so it is the only object in the schema an index can be placed on safely, and its trigram indexes
(`reference_entities_name_trgm_idx`, `reference_entities_ref_trgm_idx`) are created once, by migration, and survive
every subsequent basemap reload. Searching the dissolved table is also the better result for a user: "Quốc lộ 14"
returns one entity, not several thousand road segments.

**Security.** Migration 1000000000008 withholds `USAGE` on the `basemap` schema from `webatlas_assistant`, so the
assistant's generated-SQL path (§12.2) cannot reach `basemap.reference_entities` any more than it can reach the raw
basemap tables. This table gains the assistant nothing; access to reference layers by the assistant, when it is
introduced, will be through typed tools running under the application's own connection, not through `run_sql`.

#### 10.2.1 Access paths (implemented)

No separate API reference document exists in this repository; the read paths over reference data are recorded here,
next to the table they serve, because §1.2 permits describing the interface where it constrains the database design,
and every read path below exists because of a property of `basemap.reference_entities` established above.

`GET /api/reference/layers` lists the five reference layers and, for each, its geometry kind, its classification
column and its summable attributes. `GET /api/reference/:layer/entities` lists a layer's entities, optionally
filtered by `q` (a trigram match against name and route designation, minimum two characters), `fclass`, and `limit`
(default 50, maximum 200). `GET /api/reference/:layer/entities/:entityId` returns one entity. All three are public,
by the same reasoning as `/api/search` and `/api/admin-units`: reference data carries no attribute that is sensitive
to expose.

`GET /api/search` gained a `sources` parameter: a comma-separated list drawn from `dams`, `lakes`, `rivers`,
`stations` (the four editable layers with names worth matching) and `ref:roads`, `ref:railways`, `ref:water`,
`ref:landuse`, `ref:places` (the five reference layers, prefixed so the two identifier spaces do not collide in one
query string). Omitting `sources` preserves the pre-existing behaviour — the four editable layers only — so that no
existing caller's result set changes by default.

`POST /api/analysis/:op` gained a `reference` input, one of exactly three permitted per request alongside `geometry`
and `feature`: `{ referenceLayer, entityId, radiusKm? }`. A line or point entity requires `radiusKm` to become an
area; an already-areal entity (water, landuse) does not. §11 describes the limits this input is subject to before an
operation is allowed to run on it.

Revision 1.4 (§8) replaced those three inputs with one. The bodies of `select_within`, `nearest`,
`elevation_profile` and `zonal_elevation` now take `roi` — the region of interest in any of its four sources — beside
the operation's own parameters. `buffer` keeps the `geometry` / `feature` / `reference` body, because only the
assistant's `buffer_feature` tool calls it now that the toolbar's radius replaced the buffer tool; its source still goes
through `resolveRoi`.

`POST /api/roi/resolve` takes `{ roi }` and returns the resolved region (§8) without its full-precision geometry. It is
public and bounded like the analysis operations — the analysis connection pool, a read-only transaction and the
five-second statement timeout — with a rate limit of 120 requests a minute, above the analysis operations' 60, because
every pick and every radius change is one resolve.

`GET /api/search` accepts `admin` among its `sources`: the six working provinces and their 616 wards, matched by
trigram against the short and full names. A hit's `featureId` is the unit's code and its `layerKey` is `province` or
`ward`. Units outside the working region are not returned, because a region of interest outside it is refused anyway.
Like the other tokens it is opt-in; the web application's search includes it.

`GET /api/reference/:layer/entities` accepts `?member=<osm id>`: the entities of that layer whose `member_ids`
contain the given OSM id, ignoring `q` and `fclass`. It answers "which road is the segment I clicked part of", so that
the map popup can offer the whole road as a region of interest; the GIN index of §11 serves it.

#### 10.2.2 Rebuild ordering (implemented)

`basemap.reference_entities` is derived from the raw `basemap` tables, and `load_basemap.py` replaces every one of
those tables wholesale on each run (§10.2). The dissolved entities are therefore stale — referring to rows that may
no longer exist, or missing rows that now do — from the moment a basemap load finishes until `npm run reference:build
-w @webatlas/api` is run again. The runbook (`docs/runbooks/README.md`) accordingly places the rebuild immediately
after the basemap load, not as an independent, skippable step.

---

## 11. Indexing and performance

| Structure | Purpose |
|---|---|
| GiST index on each geometry column | Spatial predicates and nearest-neighbour ordering |
| Unique index on (dataset version, business key) | Enforces one row per key per version |
| Index on dataset version | Version-chain resolution |
| Trigram index on name columns | Fuzzy search by name |
| GIN indexes on administrative code arrays | Containment queries by province or ward |
| B-tree indexes on `feature_level`, `parent_external_id` and `flows_into_external_id` (watercourses) | Level filtering, composition lookups and network walks |
| GIN index on `basemap.reference_entities.member_ids` (migration 21, `1000000000021_reference-member-index`) | The entity a clicked basemap segment belongs to (`?member=`, §10.2.1); it survives `reference:build`, which rebuilds the table with `DELETE` and `INSERT` |

Two measured observations inform the strategy.

**Predicates must match the index expression.** The elevation-profile operation sampled a raster with a predicate that
did not correspond to the indexed expression, producing a sequential scan of all 7,242 raster tiles for each of 100
samples: 1,941 ms. Rewriting the predicate to match the indexed expression reduced this to 103 ms, a factor of nineteen.
A regression test now asserts the query plan rather than only the result, because the result was correct in both cases.

**Bounded work per request.** Analysis operations execute within a read-only transaction carrying a statement timeout,
and results returned for display are capped in both item count and vertex count. An interactive system must degrade by
refusing a request, not by becoming unresponsive.

The reference-entity input to `POST /api/analysis/:op` (§10.2.1) showed that this must also bound the *source* of an
operation, not only its result. That endpoint is public and unauthenticated, and `ST_Buffer` applied to a
caller-named entity can exhaust backend memory before the five-second statement timeout gets a chance to cancel the
statement — during development this OOM-killed a Postgres backend outright. Four limits now guard the two ends of
the operation, and they are deliberately not redundant with one another. `MAX_SOURCE_ENTITY_VERTICES` (10,000
points) and `MAX_SOURCE_ENTITY_PARTS` (300 parts) bound the source entity itself, enforced *before* any buffering
runs: first by a SQL `CASE` that prevents the buffer expression from being evaluated at all once a limit is
exceeded, and separately by an application-level check that produces the message naming which limit was hit, because
the SQL failure alone does not distinguish the two. Part count is bounded independently of vertex count because part
count, not vertex count, is what drives `ST_Buffer`'s cost on a fragmented multi-part geometry — each disjoint part
contributes its own two round end caps and its own disc to the union, so a geometry can carry comfortably few
vertices and still be expensive to buffer if it is split into enough separate pieces. `MAX_ROI_AREA_KM2` (25,000
km²) and `MAX_INPUT_VERTICES` (5,000 points) bound the *resulting* region of interest, measured after buffering and
after clipping to the working region — a distinct concern from the two limits above, which bound the cost of
producing that result in the first place. Since revision 1.4 all four are applied in one place, `resolveRoi`, to every
source of a region of interest, with the admin-unit exemption from the resulting-vertex limit described in §8.

---

## 12. Security model

### 12.1 Authorisation

Feature modification is restricted to the administrator role. Other roles, including the editor role retained for
compatibility, hold read access only. Authorisation is enforced by the application programming interface; interface
controls in the client are a convenience and are never the protective boundary.

Every modification is recorded in the audit log with the prior and resulting attribute values, the acting user, and —
for changes originating from the assistant-mediated workflow — the source document and the supplying organisation.

### 12.2 Least privilege for generated queries

The conversational assistant may execute generated read-only statements. These execute under a dedicated role holding
select privileges on the eight resolution views and the two per-level watercourse views (§4.2), and nothing else: no
access to the application schema, and none to reference data. A defect in statement validation therefore cannot expose credentials or audit history, because the
privilege boundary, not the parser, is the control.

### 12.3 Connection isolation

Analysis operations, which are publicly reachable and may hold a connection for the duration of a statement timeout,
draw from a dedicated bounded connection pool. A saturated analysis workload therefore degrades analysis alone; it
cannot exhaust the connections required for authentication and ordinary reads.

---

## 13. Known limitations

| Limitation | Consequence |
|---|---|
| Five of the eight thematic layers contain two placeholder records each | Analyses over hazard layers are correct and uninformative until real data is loaded |
| Administrative boundaries simplified to approximately 11 m | Attribution near a boundary may be incorrect; unsuitable for statutory use |
| No routable road topology | Shortest-path and accessibility analysis unavailable |
| No hydraulic model | Flood extent cannot be derived; exposure analysis requires an externally supplied extent |
| Watercourse names originate from OpenStreetMap | 4,716 of 13,045 reaches are named by vote and 38 more by bridging; the other 8,291 are walkable but belong to no named river, and every association carries a confidence value |
| Watercourse topology covers the six working provinces | 53 reaches flow out of the region, so a downstream walk from them ends at the regional boundary |
| The river ingest is not yet a declarative load | `rivers` is registered as a dated escape hatch (§14): a `run` stage executes the ingest script, then a publish stage exposes the layer; it is to be promoted to `load-geojson` |
| Elevation model is bare-earth at 30 m | Values represent ground level; not suitable for canopy or structure heights |

---

## 14. Evolution

Schema changes are applied as ordered, reviewed migrations; data loads are declared as registry datasets so that the
dependency order, lineage and licence of each dataset are recorded with it. The distinction is maintained deliberately:
migrations create structure, and the pipeline populates it.

Administrative boundaries and stamping shipped first, in revision 1.1 (§6.2, §6.3). Reference-layer access and
aggregation shipped second, in revision 1.2 (§10.2). Watercourse topology and the entity hierarchy shipped third, in
revision 1.3 (§4, §7, §9). The region-of-interest model and the analysis toolbar built on it shipped fourth, in this
revision (§8, §10.2.1). The remaining designed elements are introduced in the following order, each independently
useful: cross-entity relationships (§10.1); and the assistant operations that consume them, including the upstream and
downstream walks (§7.2).

The river ingest departs from the second half of the rule above. The design called for it to be declared as a registry
dataset that loads its GeoJSON, but the registry has no `load-geojson` executor yet. It is therefore registered as
`rivers`, with a `run` stage naming the ingest script, followed by a `publish-geoserver` stage, and a promotion deadline
of 31 December 2026 for moving the first stage to `load-geojson`; the runner executes both stages today, and the
registry's own test fails the build once that date passes, so the escape hatch cannot quietly become permanent.

---

## 15. References

1. *Entity Model, Networks and ROI Analysis — Design*, WebATLAS project, 18 September 2026.
   `docs/superpowers/specs/2026-09-18-entity-model-networks-and-roi-design.md`
2. *WebGIS Water Resources — Backend Design*, WebATLAS project, 10 July 2026 (invariants INV-1 to INV-5).
   `docs/superpowers/specs/2026-07-10-webgis-water-resources-backend-design.md`
3. Thông tư 973/2001/TT-TCĐC, Tổng cục Địa chính — VN-2000 projection parameters and provincial central meridians.
4. HydroSHEDS/HydroRIVERS, version 1.0, World Wildlife Fund — watercourse network and topology (CC BY 4.0).
5. FABDEM V1-2, University of Bristol — bare-earth elevation model (CC BY-NC-SA 4.0).
6. OpenStreetMap contributors — watercourse, road, railway, land-use and settlement data (ODbL).
7. Open Development Vietnam — hydropower dataset (CC BY-SA 4.0).
