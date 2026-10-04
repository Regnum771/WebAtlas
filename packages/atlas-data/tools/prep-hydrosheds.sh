#!/usr/bin/env bash
# Regenerate the clipped HydroSHEDS seed inputs from upstream global/regional downloads.
# Run once by a developer; NOT run in CI.
#
# Upstream (record the exact version + region you downloaded):
#   HydroLAKES  v1.0 polygons        — https://www.hydrosheds.org/products/hydrolakes
#     direct:  https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip
#   HydroRIVERS v1.0 (Asia region)   — https://www.hydrosheds.org/products/hydrorivers
#     direct:  https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip
#
# Requires: Python 3 with geopandas, shapely, pyproj, and fiona (or pyogrio) installed:
#   pip install geopandas shapely pyproj fiona
# System GDAL / ogr2ogr is NOT required — the actual clip is done by prep_hydrosheds.py
# via the Python geo stack, which is more portable to install than GDAL system packages.
#
# Usage:
#   ./prep-hydrosheds.sh /path/to/HydroLAKES_polys_v10.shp /path/to/HydroRIVERS_v10_as.shp
set -euo pipefail

LAKES_SRC="${1:?path to HydroLAKES polygons shapefile}"
RIVERS_SRC="${2:?path to HydroRIVERS shapefile}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SCRIPT_DIR/../data/seeds"

# Vietnam extent (minX minY maxX maxY, lon/lat, EPSG:4326). Kept in sync with the BBOX
# constant in prep_hydrosheds.py.
BBOX="102 8 110 24"

echo "Clipping HydroLAKES -> hydrolakes-vn.geojson"
python3 "$SCRIPT_DIR/prep_hydrosheds.py" lakes "$LAKES_SRC" "$OUT/hydrolakes-vn.geojson"

# The rivers output is selected against the six working provinces (whole reaches, all
# stream orders) rather than clipped at the Vietnam bbox; prep_hydrosheds.py reads
# apps/web/public/provinces-34.geojson to do the selection.
echo "Clipping HydroRIVERS -> hydrorivers-region.geojson"
python3 "$SCRIPT_DIR/prep_hydrosheds.py" rivers "$RIVERS_SRC" "$OUT/hydrorivers-region.geojson"

echo "Done. Verify file sizes are reasonable before committing."
