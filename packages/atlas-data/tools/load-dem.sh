#!/usr/bin/env bash
# Load clipped FABDEM tiles into basemap.dem_region.
#
# Runs INSIDE the atlas-tools container, which carries raster2pgsql and psql and reaches the
# database through PGHOST/PGUSER/PGPASSWORD/PGDATABASE (set by the compose `tools` service). The
# old host version built a one-off image and ran docker from the host; the tools image replaces it.
set -euo pipefail

DEM_DIR="${1:?usage: load-dem.sh <directory of clipped .tif tiles>}"
TABLE="basemap.dem_region"
: "${PGHOST:?PGHOST is not set — run this inside the atlas-tools container (npm run atlas:build -- --only dem)}"

q() { psql -v ON_ERROR_STOP=1 "$@"; }

shopt -s nullglob
TIFS=("$DEM_DIR"/*.tif)
if [ ${#TIFS[@]} -eq 0 ]; then
  echo "No .tif files in $DEM_DIR — run prep_dem.py first." >&2
  exit 1
fi
echo "Loading ${#TIFS[@]} tiles from $DEM_DIR into $TABLE"

q -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='basemap' AND table_name='dem_region'" | grep -q 1 || {
  echo "$TABLE does not exist — run: npm run migrate:up -w @webatlas/api" >&2
  exit 1
}

q -c "SELECT DropRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null 2>&1 || true
q -c "TRUNCATE $TABLE;"
for tif in "${TIFS[@]}"; do
  echo "  $(basename "$tif")"
  raster2pgsql -a -s 4326 -t 128x128 -F "$tif" "$TABLE" | q -q
done

echo "Deriving raster constraints..."
q -c "SELECT AddRasterConstraints('basemap'::name,'dem_region'::name,'rast'::name);" >/dev/null

echo "Verifying..."
q -c "SELECT count(*) AS tiles, pg_size_pretty(pg_total_relation_size('$TABLE')) AS size FROM $TABLE;"
q -c "
WITH pts(label, g) AS (VALUES
  ('Buon Ma Thuot  ~472 m', ST_SetSRID(ST_MakePoint(108.0447,12.6797),4326)),
  ('Chu Yang Sin  ~2415 m', ST_SetSRID(ST_MakePoint(108.4244,12.4061),4326)),
  ('Da Nang shore    ~7 m', ST_SetSRID(ST_MakePoint(108.2440,16.0600),4326)))
SELECT p.label, round(ST_Value(d.rast, p.g)::numeric,1) AS elevation_m
  FROM pts p LEFT JOIN $TABLE d ON ST_Intersects(d.rast, p.g);"
echo "Done."
