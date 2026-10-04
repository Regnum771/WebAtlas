# Basemap fixture for CI

Real OpenStreetMap data, cut from a built atlas, so the `api` CI job can run the reference, search,
ROI and `locate_place` tests without the 720 MB Geofabrik extract. Design:
`docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md`.

**Data © OpenStreetMap contributors, ODbL 1.0, via Geofabrik.** `MANIFEST.json` names the extract.

## What is in it

Every row the reference build can read, for the six working-region provinces:

| Table | Rows kept |
|---|---|
| `basemap.roads_region` | those with a name or a route number |
| `basemap.water_region`, `basemap.landuse_region` | those with a name |
| `basemap.railways_vn`, `basemap.places_region` | all |

Unnamed roads, the national `*_vn` road and place tables, land, the DEM and contours are not here:
no API test reads them. Because the reference build skips rows with neither a name nor a route
number, the entities built from this fixture are the same as a full atlas's. CI checks that on
every run (`verify`, below).

## Files

- `schema.sql`: the real table and index definitions, dumped from a built atlas.
- `<table>.copy.gz`: PostgreSQL COPY text, gzipped. Binary in git.
- `MANIFEST.json`: the source extract; each file's selection rule, columns, row count and sha256;
  and for each reference layer, the entity count and a digest of the real atlas's entity ids.

## Using it

```bash
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load     # into an EMPTY database
npm run reference:build -w @webatlas/api
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
```

`load` reads `DATABASE_URL` (or the `PG*` variables), needs `python3` and `psql`, and **refuses to
run when any of the five tables already holds rows**. It is for CI and scratch databases. It never
replaces a basemap built by `atlas:up`.

## Regenerating

Only when a test needs newer data, or when `load_basemap.py` changes what it writes. A new basemap
pin alone is not a reason: CI stays on the frozen extract. Each regeneration adds about 14 MB to
the repository's history.

On a machine with the full atlas built:

```bash
npm run atlas:build -- --force reference_entities
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build
npm run test -w @webatlas/atlas-data
```

`build` refuses a database that was itself loaded from the fixture, and one whose
`reference_entities` is older than its tables. Unchanged data gives byte-identical files.
