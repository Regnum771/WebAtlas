# WebATLAS Database Architecture

**Document status:** Living document. Revise when the schema changes.
**Revision:** 1.1 — 18 September 2026
Phase 1 (administrative boundaries and stamping) implemented; see docs/superpowers/plans/2026-09-18-plan-1-admin-boundaries-and-stamping.md.
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

---

## 4. Entity model

### 4.1 Problem addressed

In the implemented schema, a watercourse is stored as an arbitrary number of rows derived from OpenStreetMap ways. Of
9,486 rows, 1,327 carry a name and those names resolve to 466 distinct values. A search for a river therefore returns
several results describing the same watercourse, and selecting one yields a fragment of it. Road data exhibits the same
property at greater scale: 527,215 segments, of which a single national highway may comprise several hundred.

The stored unit is a consequence of how the source data was produced, not a property of the thing itself. The schema
must therefore distinguish the entity from its storage units.

### 4.2 Three-level hierarchy (designed)

Watercourses are modelled in a single table with a self-referential composition relationship and an explicit level
attribute.

| Level | Entity | Geometry | Origin |
|---|---|---|---|
| 1 | Named river | Derived; the union of its member reaches | Names from OpenStreetMap; grouping from the network |
| 2 | Reach | As imported | HydroRIVERS, including the downstream link |
| 3 | Way | As imported | OpenStreetMap watercourses |

A single table is used, rather than one table per level, so that identity, authorisation, versioning and the audit
trail apply uniformly, and so that a query may select entities at any level without a union of dissimilar relations.

### 4.3 Relationships

Two relationships are represented, in separate columns:

- `parent_external_id` expresses **composition**: a way belongs to a reach; a reach belongs to a river.
- `flows_into_external_id` expresses **hydrology**: water leaves this reach for that one; this river joins that one.

A single overloaded relationship was considered and rejected: its meaning would then depend upon the level of the row
being examined, and every query would require that knowledge to interpret the result correctly.

### 4.4 Identity and referential keys

Relationships reference `external_id`, the stable business key, and never the primary key. The reason is temporal: an
edit does not modify a row but writes a new row, bearing a new primary key, in a new dataset version (§5). A reference
to a primary key would therefore address a superseded row as soon as its target were edited, while appearing valid.

Because three sources — OpenStreetMap, HydroRIVERS and derived river entities — will share one identity space, and
because HydroRIVERS identifiers may collide numerically with OpenStreetMap way identifiers, the key is namespaced by
source: `osm:12207485`, `hyriv:40315120`, `river:0012`.

### 4.5 Editing rules

Geometry may be edited at level 3 only. Level 2 originates from ingest; level 1 geometry is derived and has a
maintenance owner (§9). Attributes, notably the name, remain editable at level 1. Deletion of a parent is refused while
live children reference it.

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
| Watercourses | Directed tree | The reach row is the edge; the downstream link is its adjacency | **Designed** |
| Roads, railways | Undirected graph | Deferred; see §7.3 | Deferred |

Land use, settlements and water bodies are not networks; they are areas and points.

### 7.2 Traversal

Upstream and downstream queries are recursive traversals of the downstream link, evaluated after version resolution
(§5.2). No additional structure is required: a reach has exactly one downstream neighbour, so the adjacency is a single
column, and the resulting walk is bounded by the size of the basin.

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

## 8. Region-of-interest model (designed)

A region of interest is a first-class object: a geometry in WGS 84, the source from which it was obtained, and a label.
Four sources are admitted: a shape drawn by the user; an entity, optionally buffered; an administrative unit; and the
result of a previous analysis.

The analysis operations accept the region of interest irrespective of its source. This property is load-bearing: it is
what allows an analysis to be applied to a hazard polygon, a modelled extent or a hand-drawn area without alteration,
and it is the reason the region of interest must not be typed as a drawn shape.

Operations are divided into those that require an area and those that require a path. A point or line entity must be
buffered before it can serve as an area; the interface requires the radius rather than failing.

---

## 9. Derived values and their maintenance

The schema contains values that are computed from other values: the geometry of a level-1 river, administrative code
arrays, and computed relationships (§10.1). Each such value has exactly one designated maintenance point — the commit of
an editing session, and the corresponding stage of the ingest pipeline.

This rule exists because of a defect observed in the implemented system. A materialised view of trunk watercourses was
refreshed by a function invoked from a single call site. A programmatic caller that did not traverse that site ingested
9,486 features and activated a new version, leaving the materialised view describing the previous one. The condition
persisted for two days and presented differently depending on execution order.

The lesson recorded here is not that materialised views are unsuitable, but that **a derived value whose refresh
obligation resides in a call site rather than in a contract will eventually be stale**. Derived geometry for level-1
rivers is accordingly rebuilt by the same commit path that writes the change, and the materialised view of trunk
watercourses is withdrawn once the level model supersedes it.

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

### 10.2 Reference-data entities (designed)

Reference layers are aggregated into named entities by the loader: segments sharing a name or route designation, and
spatially proximate, are grouped and their geometry merged. The aggregation is rebuilt whenever the loader runs.
Reference data has no editing path, so the derived relation has exactly one writer and the hazard described in §9 does
not arise.

---

## 11. Indexing and performance

| Structure | Purpose |
|---|---|
| GiST index on each geometry column | Spatial predicates and nearest-neighbour ordering |
| Unique index on (dataset version, business key) | Enforces one row per key per version |
| Index on dataset version | Version-chain resolution |
| Trigram index on name columns | Fuzzy search by name |
| GIN indexes on administrative code arrays | Containment queries by province or ward |

Two measured observations inform the strategy.

**Predicates must match the index expression.** The elevation-profile operation sampled a raster with a predicate that
did not correspond to the indexed expression, producing a sequential scan of all 7,242 raster tiles for each of 100
samples: 1,941 ms. Rewriting the predicate to match the indexed expression reduced this to 103 ms, a factor of nineteen.
A regression test now asserts the query plan rather than only the result, because the result was correct in both cases.

**Bounded work per request.** Analysis operations execute within a read-only transaction carrying a statement timeout,
and results returned for display are capped in both item count and vertex count. An interactive system must degrade by
refusing a request, not by becoming unresponsive.

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
select privileges on the eight resolution views and nothing else: no access to the application schema, and none to
reference data. A defect in statement validation therefore cannot expose credentials or audit history, because the
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
| Watercourse names originate from OpenStreetMap | Name coverage is partial (1,327 of 9,486 records) and association to reaches carries a confidence value |
| Elevation model is bare-earth at 30 m | Values represent ground level; not suitable for canopy or structure heights |

---

## 14. Evolution

Schema changes are applied as ordered, reviewed migrations; data loads are declared as registry datasets so that the
dependency order, lineage and licence of each dataset are recorded with it. The distinction is maintained deliberately:
migrations create structure, and the pipeline populates it.

Administrative boundaries and stamping shipped first, in this revision (§6.2, §6.3). The remaining designed elements
are introduced in the following order, each independently useful: reference-layer access and aggregation;
watercourse topology and the entity hierarchy; the region-of-interest model; and the assistant operations that
consume them.

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
