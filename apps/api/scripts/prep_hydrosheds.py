#!/usr/bin/env python3
"""Clip HydroLAKES / HydroRIVERS shapefiles to the Vietnam bbox and emit GeoJSON.

Companion script to prep-hydrosheds.sh. System GDAL / ogr2ogr is not assumed to be
installed, so this uses the Python geo stack instead (geopandas + shapely + pyproj +
fiona/pyogrio), which is installable anywhere via pip:

    pip install geopandas shapely pyproj fiona

Usage:
    python prep_hydrosheds.py lakes  /path/to/HydroLAKES_polys_v10.shp  <out.geojson>
    python prep_hydrosheds.py rivers /path/to/HydroRIVERS_v10_as.shp   <out.geojson>

Normally invoked via prep-hydrosheds.sh rather than run directly.
"""
from __future__ import annotations

import json
import sys

import geopandas as gpd
from shapely.geometry import box

# Vietnam clip bbox (minX minY maxX maxY, lon/lat, EPSG:4326) -- matches prep-hydrosheds.sh.
BBOX = (102, 8, 110, 24)

LAKE_FIELDS = ["Hylak_id", "Lake_name", "Lake_type", "Lake_area", "Vol_total", "Shore_len"]
RIVER_FIELDS = ["HYRIV_ID", "ORD_STRA", "LENGTH_KM"]

# Stream order threshold for the rivers clip, per the brief. HydroRIVERS Asia clipped
# to the Vietnam bbox at ORD_STRA >= 3 comes out to ~27k features / ~8.7 MB of GeoJSON,
# comfortably under the ~25 MB committed-file budget, so no need to raise it further.
RIVER_MIN_ORD_STRA = 3


def clip_lakes(src: str, dst: str) -> None:
    gdf = gpd.read_file(src, bbox=BBOX)
    gdf = gdf.to_crs(epsg=4326)
    gdf = gpd.clip(gdf, box(*BBOX))
    gdf = gdf[[c for c in LAKE_FIELDS if c in gdf.columns] + ["geometry"]]
    _write_geojson(gdf, dst)


def clip_rivers(src: str, dst: str) -> None:
    gdf = gpd.read_file(src, bbox=BBOX)
    gdf = gdf.to_crs(epsg=4326)
    gdf = gdf[gdf["ORD_STRA"] >= RIVER_MIN_ORD_STRA]
    gdf = gpd.clip(gdf, box(*BBOX))
    gdf = gdf[[c for c in RIVER_FIELDS if c in gdf.columns] + ["geometry"]]
    _write_geojson(gdf, dst)


def _write_geojson(gdf: "gpd.GeoDataFrame", dst: str) -> None:
    # Round-trip through geopandas' own GeoJSON writer, then re-serialize with
    # sorted/compact output so the committed file is diff-friendly and has no CRS
    # member (GeoJSON is implicitly WGS84 per RFC 7946), matching the other seed files
    # in apps/api/src/db/seeds/data/.
    raw = json.loads(gdf.to_json())
    fc = {"type": "FeatureCollection", "features": raw["features"]}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print(f"Wrote {dst}: {len(fc['features'])} features")


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] not in ("lakes", "rivers"):
        print(__doc__)
        sys.exit(1)
    kind, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    if kind == "lakes":
        clip_lakes(src, dst)
    else:
        clip_rivers(src, dst)


if __name__ == "__main__":
    main()
