#!/usr/bin/env bash
# Load the clipped FABDEM V1-2 tiles produced by prep_dem.py into
# basemap.dem_region. Run once by a developer; NOT run in CI.
#
#   1. python apps/api/scripts/prep_dem.py --mainland   # download + clip
#   2. npm run migrate:up -w @webatlas/api          # creates the empty table
#   3. apps/api/scripts/load-dem.sh                 # this script
#
# See docs/runbooks/elevation-dem.md. Idempotent by truncate-and-reload: running it
# twice leaves one copy of the data, not two.
#
# Requires Docker (the compose stack must be up) and nothing else on the host —
# raster2pgsql runs inside the one-off image built from raster-tools.Dockerfile,
# because the stock postgis image does not ship it. See that file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Git Bash mangles Docker arguments twice over, and this project is developed on
# Windows, so both need handling or the mount silently points at nothing:
#   1. MSYS rewrites a bare `/dem` container path into `C:/Program Files/Git/dem`.
#      MSYS_NO_PATHCONV=1 turns that off. No-op on Linux and macOS.
#   2. `pwd` here yields `/c/Users/...`, which Docker Desktop does not understand.
#      cygpath -m converts it to `C:/Users/...`. Absent elsewhere, hence the guard.
export MSYS_NO_PATHCONV=1
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

DEM_DIR="${1:-$ROOT/apps/api/src/db/seeds/data/dem/clipped}"
TABLE="basemap.dem_region"
IMAGE="webatlas-raster-tools:16-3.4"
# Compose sets `name: webatlas`, so the default network is <project>_default.
NETWORK="${DEM_NETWORK:-webatlas_default}"

# Credentials come from infra/.env, the same file compose reads.
set -a
# shellcheck disable=SC1091
. "$ROOT/infra/.env"
set +a
: "${POSTGRES_USER:?missing in infra/.env}"
: "${POSTGRES_PASSWORD:?missing in infra/.env}"
: "${POSTGRES_DB:?missing in infra/.env}"

shopt -s nullglob
TIFS=("$DEM_DIR"/*.tif)
if [ ${#TIFS[@]} -eq 0 ]; then
  echo "No .tif files in $DEM_DIR — run prep_dem.py first." >&2
  exit 1
fi
echo "Loading ${#TIFS[@]} tiles from $DEM_DIR into $TABLE"

docker build -t "$IMAGE" \
  -f "$(host_path "$SCRIPT_DIR/raster-tools.Dockerfile")" \
  "$(host_path "$SCRIPT_DIR")"

run_psql() {
  docker run --rm -i --network "$NETWORK" -e PGPASSWORD="$POSTGRES_PASSWORD" "$IMAGE" \
    psql -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

# Fail early and legibly if migration 1000000000010 has not been applied, rather than
# emitting several hundred MB of INSERTs into a missing table.
run_psql -tAc "SELECT 1 FROM information_schema.tables
               WHERE table_schema='basemap' AND table_name='dem_region'" | grep -q 1 || {
  echo "$TABLE does not exist — run: npm run migrate:up -w @webatlas/api" >&2
  exit 1
}

# Constraints are dropped before the load and re-derived after: AddRasterConstraints
# pins srid/scale/blocksize/extent from the rows present when it runs, so a second load
# into a constrained table would be rejected by the extent constraint it added itself.
# The ::name casts are load-bearing. AddRasterConstraints/DropRasterConstraints are
# overloaded, and three bare string literals resolve to the
# (table, column, VARIADIC constraints[]) form rather than (schema, table, column) —
# which fails with the memorable but misleading "The table 'basemap' does not occur
# in the search_path". Casting forces the three-name overload.
run_psql -c "SELECT DropRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null 2>&1 || true
run_psql -c "TRUNCATE $TABLE;"

# -a append (the table is the migration's, not raster2pgsql's), -s 4326 matching every
# other layer, -t 128x128 so one ST_Value touches one small tile instead of a whole
# 1-degree cell, -F keeps the source filename as a column for provenance when a tile
# looks wrong. No -I/-C: the index is the migration's and the constraints come after.
for tif in "${TIFS[@]}"; do
  name="$(basename "$tif")"
  echo "  $name"
  docker run --rm -i --network "$NETWORK" \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    -v "$(host_path "$DEM_DIR"):/dem:ro" "$IMAGE" \
    sh -c "raster2pgsql -a -s 4326 -t 128x128 -F '/dem/$name' $TABLE \
           | psql -h db -U '$POSTGRES_USER' -d '$POSTGRES_DB' -q -v ON_ERROR_STOP=1"
done

echo "Deriving raster constraints..."
run_psql -c "SELECT AddRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null

echo "Verifying..."
run_psql -c "SELECT count(*) AS tiles,
                    pg_size_pretty(pg_total_relation_size('$TABLE')) AS size,
                    round(ST_XMin(ST_Union(ST_ConvexHull(rast)))::numeric,3) AS west,
                    round(ST_YMin(ST_Union(ST_ConvexHull(rast)))::numeric,3) AS south,
                    round(ST_XMax(ST_Union(ST_ConvexHull(rast)))::numeric,3) AS east,
                    round(ST_YMax(ST_Union(ST_ConvexHull(rast)))::numeric,3) AS north
               FROM $TABLE;"

# Three knowns and one deliberate miss. Expect roughly 472 / 2415 / 7 / NULL on FABDEM.
#
# Buon Ma Thuot first because it is the ROBUST check: a broad basalt plateau, so being a
# few hundred metres off the nominal point changes nothing. The summit is the opposite —
# these coordinates are the DEM's own high pixel, and a published summit coordinate that
# is even 2 km out reads ~400 m low on the flank (which is exactly what the first version
# of this check did, and it looked like a data fault rather than a bad coordinate).
# Treat a summit reading well BELOW the published 2,442 m as correct, not as error: a 30 m
# grid averages a sharp peak away, and FABDEM is bare earth, so it also strips whatever is
# growing on top. Measured 2,414.5 m.
run_psql -c "
WITH pts(label, g) AS (VALUES
  ('Buon Ma Thuot  ~472 m', ST_SetSRID(ST_MakePoint(108.0447,12.6797),4326)),
  ('Chu Yang Sin  ~2415 m', ST_SetSRID(ST_MakePoint(108.4244,12.4061),4326)),
  ('Da Nang shore    ~7 m', ST_SetSRID(ST_MakePoint(108.2440,16.0600),4326)),
  ('Offshore        (null)', ST_SetSRID(ST_MakePoint(112.0000,12.0000),4326)))
SELECT p.label, round(ST_Value(d.rast, p.g)::numeric,1) AS elevation_m
  FROM pts p LEFT JOIN $TABLE d ON ST_Intersects(d.rast, p.g);"

echo "Done."
