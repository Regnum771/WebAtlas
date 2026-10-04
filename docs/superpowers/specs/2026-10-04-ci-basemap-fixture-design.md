# CI basemap fixture — design

Date: 2026-10-04. Branch: `feat/registry-plan-b` (stacked on PR #19, user decision).

## 1. Problem

The `api` CI job has been red on `main` since the reference layers landed. On PR #19 six test files fail (11 tests, plus three files and one `describe` block that fail in their setup), all for one of two reasons:

- **All but two need basemap tables that CI's database does not have.** `basemap.places_region`, `basemap.roads_region` and `basemap.railways_vn` are created by `load_basemap.py` from a 720 MB Geofabrik extract. CI never runs that, so the queries fail with `relation "basemap.…" does not exist`.
- **2 DEM tests take the wrong branch.** `demAvailable()` asks whether `basemap.dem_region` exists. Migrations always create it, empty, so in CI the tests assert on numbers that are not there.

A red job that is always red cannot block a real regression. The alternative of skipping these tests when the data is absent was offered and declined: CI should run them.

## 2. Decisions (user, 2026-10-04)

| # | Decision |
|---|---|
| D1 | CI loads a **committed fixture** of real data. Tests are not skipped. |
| D2 | The fixture holds **every named feature of the six working-region provinces**, not a small spatial slice. About 14 MB gzipped. |
| D3 | **No DEM in CI.** Only the availability check is fixed, so the DEM tests take their existing "not loaded" branch. |
| D4 | Stored as **a plain schema file plus one gzipped PostgreSQL COPY file per table**, loaded with `psql`. |
| D5 | The work is **stacked on PR #19**, so that PR goes green. |
| D6 | Reference entity numbering becomes **deterministic** (§8). Found while checking this design: entity ids depended on table row order. |

Implementation note: the three scripts this document first named are one Python tool with three subcommands (plan `docs/superpowers/plans/2026-10-04-ci-basemap-fixture.md`), because all three need JSON, sha256 and gzip.

## 3. Why "every named feature" is the right fixture

Only two things in `apps/api` read the raw basemap tables:

- `locate_place` reads `basemap.places_region`.
- `buildReferenceEntities` (`apps/api/src/db/referenceEntities.ts`) reads the five tables in `REFERENCE_REGISTRY` and keeps a row only when its entity key, a route-number token or else the name, is not null.

Everything else (search, ROI resolution, the reference API, analysis on a reference entity) reads `basemap.reference_entities`, which that build produces.

So a fixture that contains every row with a name or a route number yields **the same `reference_entities` as a full atlas**, once entity numbering no longer depends on row order (§8). Every existing assertion then holds unchanged: `QL.14` is still over 500 km with more than 100 members, the single-segment part of Đường tỉnh 699D still exists, Buôn Ma Thuột still has population 465,392. A small spatial slice would break roughly eight tests that assert region-wide facts, and they would then have to hold on both the slice and the full data.

## 4. Fixture contents

Measured on the dev database on 2026-10-04, loaded from pin `vietnam-261001`.

| Table | Rows in fixture | Rule | Gzipped |
|---|---|---|---|
| `basemap.roads_region` | 33,637 of 527,825 | `name IS NOT NULL OR ref IS NOT NULL` | 8.9 MB |
| `basemap.water_region` | 680 of 5,874 | `name IS NOT NULL` | 4.4 MB |
| `basemap.landuse_region` | 812 of 12,214 | `name IS NOT NULL` | 0.3 MB |
| `basemap.railways_vn` | 3,764 (all) | none | 0.7 MB |
| `basemap.places_region` | 6,040 (all) | none | 0.15 MB |

- Every column is kept, and geometry is stored as the loader wrote it (hex EWKB in COPY text format). Nothing is simplified or reprojected.
- The rules are a superset of what the reference build reads. `railways_vn` and `places_region` are small enough to keep whole, and `locate_place` reads `places_region` directly.
- `roads_vn`, `places_vn`, `land_vn`, `dem_region` and `contours` are **not** in the fixture. No API test reads them.

The data is OpenStreetMap, ODbL 1.0, via Geofabrik. The repository already commits OSM-derived seed files on the same terms.

## 5. Layout

```
packages/atlas-data/fixtures/basemap/
  README.md             what this is, ODbL attribution, how to regenerate
  MANIFEST.json         source pin; per file: table, rule, row count, sha256;
                        per reference layer: entity count and digest
  schema.sql            plain text: CREATE TABLE and CREATE INDEX for the five tables
  roads_region.copy.gz
  water_region.copy.gz
  landuse_region.copy.gz
  railways_vn.copy.gz
  places_region.copy.gz
packages/atlas-data/tools/fixtures/
  basemap_fixture.py    build | load | verify
```

- **`schema.sql`** is dumped with `pg_dump --schema-only` from a built atlas, so the table and index definitions are the ones `load_basemap.py` (through geopandas) really creates. It includes `CREATE SCHEMA IF NOT EXISTS basemap`, the geometry indexes and the `fclass` indexes. It is plain text so a change to it is reviewable.
- **One COPY file per table.** Rows are ordered by `osm_id` and gzipped with `gzip -n` (no timestamp), so regenerating unchanged data produces identical bytes and no git churn. Regenerating one table does not rewrite the others.
- **`MANIFEST.json`** records the Geofabrik `DATE` the atlas was built from, the selection rule of each table, its row count and the sha256 of its file. For each of the five reference layers it also records the entity count and a digest of the real atlas's entities: the sha256 of the sorted lines `entity_id|member_count|md5(member ids)`. It also records the sha256 of `schema.sql`.
- `.gitattributes` marks `*.copy.gz` as binary.

## 6. Cutting the fixture: `basemap_fixture.py build`

Run by hand, in the tools image, against a fully built atlas:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build
```

Steps:

1. Refuse to run unless all five tables exist and `roads_region` also holds unnamed rows. A database that was itself loaded from the fixture has only named rows; re-cutting from it would reproduce the fixture and prove nothing.
2. Dump `schema.sql` for the five tables.
3. `COPY (SELECT <columns> FROM <table> WHERE <rule> ORDER BY osm_id, geometry, whole row) TO STDOUT`, one file per table, gzipped at level 9 with no timestamp. The column list is explicit and recorded in the manifest.
4. Compute the per-layer entity count and digest from the atlas's own `basemap.reference_entities`, and write `MANIFEST.json`.

The script requires `reference_entities` to be current: built by the deterministic build of §8, after the last basemap load. It checks this for each layer by counting the member rows the build would read from the source table and comparing with the sum of `member_count` stored for that layer. A mismatch stops it and prints the command to rebuild.

The proof that the fixture reproduces a real atlas is not made here. It is made in CI, on every run, by `basemap_fixture.py verify` (§7).

**When to regenerate.** Only when a test needs newer data, or the loader's schema changes. A pin bump alone does not require it: CI stays on the frozen extract, which keeps it deterministic. Each regeneration adds about 14 MB to git history, which is the reason not to do it routinely.

## 7. Loading the fixture: `basemap_fixture.py load`

Environment: `DATABASE_URL`, or the `PG*` variables. Needs `python3` (standard library only) and `psql`, both present on GitHub's Ubuntu runners, in the tools image and on the dev host. The connection reaches `psql` through `PG*` variables, never argv.

1. Verify every file named in the manifest, `schema.sql` included, exists and matches its sha256, and that the manifest names only the five tables. A mismatch stops the script before anything is written.
2. **Refuse to run if any of the five tables already holds rows.** The fixture must never overwrite a real atlas. There is no `--force`.
3. In one transaction: for each table, take a lock and raise if it holds rows (this is the check that holds; step 2's is there for its plainer message); drop the five tables, which are empty or absent; run `schema.sql`; then `COPY … FROM STDIN` each file, with its data inline in the same stream.
4. Check each table's row count against the manifest, then `ANALYZE`.

The `api` job in `.github/workflows/ci.yml` becomes:

```
migrate → seed → ingest:rivers → basemap_fixture.py load → reference:build → basemap_fixture.py verify → test:api
```

`reference:build` is the existing `npm run reference:build -w @webatlas/api`; it took 12 s on the acceptance stack.

**`basemap_fixture.py verify`** runs after it. For each reference layer it computes the entity count and the digest of `entity_id|member_count|md5(member ids)` from the freshly built `basemap.reference_entities` and compares them with the manifest. A difference fails the job and prints the layer and both counts. This is the end-to-end check that the fixture, loaded and built in CI, gives exactly the entities of the real atlas it was cut from. It makes the claim in §3 a checked fact on every run, without repeating the build's SQL in a script.

## 8. Deterministic entity numbering

`buildReferenceEntities` splits the members of one entity key (a route number, or a name) into spatial clusters with `ST_ClusterDBSCAN(…) OVER (PARTITION BY entity_key)` and puts the cluster number in the id: `roads:<md5 of key>:<cluster>`. The window has no ordering, so the **numbers** depend on the order rows sit in the table.

Measured on the dev database, 2026-10-04, roads layer:

- 1,206 entity keys have more than one cluster.
- Clustering in ascending versus descending `osm_id` order gives 12,726 member rows a different cluster number. The stored table differs from the ascending order for 11,005 member rows.
- The **grouping** is stable: no stored cluster is split differently under another order. Only the numbers move.

So entity ids can change on any basemap reload, and a fixture loaded in a different order than the real atlas would number about 1,200 road entities differently. `analysis.test.ts` hard-codes one such id (`roads:82ccce28b3c34d80ee4f3e80fd438e39:1`, the single-segment part of Đường tỉnh 699D; cluster `0` of that key is a different, two-segment part).

Change: after clustering, renumber the clusters of each entity key from 0, in order of each cluster's smallest member `osm_id`, compared as text under the `"C"` collation so the order does not depend on the database locale. The DBSCAN call and the grouping stay as they are.

Effects:

- Ids are the same on every machine and after every reload of the same data.
- Ids of some multi-cluster entities change once, when `reference_entities` is next rebuilt. Nothing stores entity ids outside that table (no other table references them and the web app does not persist them), so there is nothing to migrate.
- Stage hashes do not cover script contents, so a built machine needs `npm run atlas:build -- --force reference_entities` to pick the change up.
- The hard-coded id in `analysis.test.ts` is re-checked after the rebuild and updated if the 699D part moved.

## 9. DEM availability

`demAvailable()` in `apps/api/src/modules/analysis/dem.ts` changes from "the table exists" to "the table exists **and has at least one row**":

- It still checks `to_regclass` first. The comment above it explains why: querying a missing relation inside a transaction aborts the transaction with 25P02.
- Only when the relation exists does it run `SELECT EXISTS (SELECT 1 FROM basemap.dem_region)`.

Effects:

- In CI the three DEM tests in `analysis.test.ts` assert `Chưa nạp dữ liệu độ cao`, which is the branch written for exactly this case.
- On a machine with the DEM loaded nothing changes.
- An atlas built with `atlas:up -- --except dem` now reports "not loaded" from `elevation_profile` and `zonal_elevation`, where today it returns a summary with missing numbers. This is a real fix, not only a test fix.

## 10. Tests

| Test | Where | Checks |
|---|---|---|
| Manifest | atlas-data suite, no database | Every file in the manifest exists, its sha256 matches, no stray `*.copy.gz`; `schema.sql` creates exactly the five tables |
| `load` and `verify`, stubbed `psql` | atlas-data suite, same style as `publish-basemap.test.mjs` | Load stops before calling `psql` on a checksum mismatch (data or `schema.sql`) and on a manifest naming any other table, and stops when a table already holds rows. It sends the in-transaction lock-and-check and the row-count guard; that those guards roll the load back needs a real server and is not covered by a test. Verify fails when a layer's count or digest differs |
| `demAvailable` | api suite | False for an existing empty table, false for a missing table, true when a row exists |
| Entity numbering | api suite, `referenceEntities.test.ts` | Cluster numbers of one key run from 0 with no gaps and ascend with each cluster's smallest member id. Order independence itself is proven in CI by `verify`: the fixture is loaded in `osm_id` order, the real atlas in loader order |
| The 15 failing tests | api suite, in CI | Pass, none skipped |

Acceptance:

1. The `api` job is green on PR #19, and its log shows the six formerly failing files running with no skipped data-dependent test.
2. `npm run test:api` still passes on the dev stack with the full atlas (482 tests today).
3. `basemap_fixture.py verify` passes in CI: the entities built from the fixture match the digest taken from the real atlas.

## 11. Out of scope

- A DEM fixture, real or synthetic (D3).
- Running `atlas:up` in CI.
- The `basemap SLD artifacts vs live tables` test in the atlas-data suite. It needs every `fclass` in the full tables, so it stays gated on `DATABASE_URL` and runs on built machines only.
- Registering the fixture as an atlas dataset. Plan C can adopt it once the `load-geojson` stage exists.
- Reducing the fixture below "every named feature" (D2).

## 12. Risks

- **Repository size.** About 14 MB now, and again on each regeneration. Mitigated by regenerating rarely (§6) and by byte-stable output.
- **Schema drift.** If `load_basemap.py` changes a column, `schema.sql` goes stale and CI tests an old shape. The fixture README says to regenerate when the loader's output changes; the manifest test cannot detect this on its own.
- **Dev and CI on different extracts.** After a pin bump the dev atlas is newer than the fixture. Tests that hard-code a value from the data (a population, an entity id) could then pass in CI and fail on a dev machine, or the reverse. That exposure exists today without the fixture; regenerating resolves it.
