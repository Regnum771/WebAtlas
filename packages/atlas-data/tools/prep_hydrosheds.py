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
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box, shape
from shapely.ops import unary_union

# Vietnam clip bbox (minX minY maxX maxY, lon/lat, EPSG:4326) -- matches prep-hydrosheds.sh.
# Still used for the lakes clip.
BBOX = (102, 8, 110, 24)

LAKE_FIELDS = ["Hylak_id", "Lake_name", "Lake_type", "Lake_area", "Vol_total", "Shore_len"]

# NEXT_DOWN is the whole reason this ingest exists: it is HydroRIVERS' downstream
# adjacency, and the river network is nothing without it. MAIN_RIV is HydroRIVERS' own
# river-system (basin) id -- not loaded into the database by this plan, but kept in the
# file because regenerating it needs the 90 MB upstream shapefile again and a later
# basin-level entity would want it.
RIVER_FIELDS = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "LENGTH_KM"]

# Keep in step with REGION_PROVINCE_CODES in packages/shared/src/region.ts. Python
# cannot import the TypeScript source of truth, so reachSeed.test.ts guards the
# duplication. Same arrangement as tools/clip-to-region.mjs.
REGION_PROVINCE_CODES = {"48", "51", "52", "56", "66", "68"}

# packages/atlas-data/tools -> repo root is three levels up.
PROVINCES = Path(__file__).resolve().parents[3] / "apps/web/public/provinces-34.geojson"


def _region_polygon():
    """Union of the six working provinces, from the committed boundary file."""
    with open(PROVINCES, encoding="utf-8") as f:
        fc = json.load(f)
    geoms = [
        shape(ft["geometry"])
        for ft in fc["features"]
        if ft.get("properties", {}).get("code") in REGION_PROVINCE_CODES
    ]
    if len(geoms) != len(REGION_PROVINCE_CODES):
        raise SystemExit(
            f"expected {len(REGION_PROVINCE_CODES)} provinces in {PROVINCES}, found {len(geoms)}"
        )
    return unary_union(geoms)


def clip_lakes(src: str, dst: str) -> None:
    gdf = gpd.read_file(src, bbox=BBOX)
    gdf = gdf.to_crs(epsg=4326)
    gdf = gpd.clip(gdf, box(*BBOX))
    gdf = gdf[[c for c in LAKE_FIELDS if c in gdf.columns] + ["geometry"]]
    _write_geojson(gdf, dst)


def clip_rivers(src: str, dst: str) -> None:
    region = _region_polygon()
    # bbox is only a cheap prefilter on read; the region test below is what selects.
    # Note the six provinces include offshore islands, so this bbox reaches ~117.8E.
    gdf = gpd.read_file(src, bbox=region.bounds)
    gdf = gdf.to_crs(epsg=4326)
    # SELECT whole reaches, deliberately NOT gpd.clip. Clipping cuts a reach at the
    # border: one LineString becomes several parts, LENGTH_KM stops matching the
    # geometry, and HYRIV_ID stops being one row per reach -- which breaks NEXT_DOWN,
    # since every link references a reach as a whole. A reach flowing out of the
    # region simply keeps a NEXT_DOWN that is not in the file (53 of them, measured),
    # which is honest and which the activation gate tolerates.
    gdf = gdf[gdf.intersects(region)]
    # No ORD_STRA threshold. Region scoping already cuts the file to a committable
    # size (13,045 reaches, 3.25 MB), and dropping orders 1-2 would leave the small
    # streams most named OSM ways sit on with no reach to attach to.
    gdf = gdf[[c for c in RIVER_FIELDS if c in gdf.columns] + ["geometry"]]
    _write_geojson(gdf, dst, round_to=5)


def _write_geojson(gdf: "gpd.GeoDataFrame", dst: str, round_to: int | None = None) -> None:
    # Round-trip through geopandas' own GeoJSON writer, then re-serialize with compact
    # output so the committed file is diff-friendly and has no CRS member (GeoJSON is
    # implicitly WGS84 per RFC 7946), matching the other seed files in
    # apps/api/src/db/seeds/data/.
    raw = json.loads(gdf.to_json())
    features = raw["features"]
    if round_to is not None:
        def _round(coords):
            if coords and isinstance(coords[0], (int, float)):
                return [round(coords[0], round_to), round(coords[1], round_to)]
            return [_round(c) for c in coords]
        for ft in features:
            # geopandas emits a per-feature "id" that is just the dataframe index; it is
            # not a stable identifier and would churn the diff on every regeneration.
            ft.pop("id", None)
            ft["geometry"]["coordinates"] = _round(ft["geometry"]["coordinates"])
    fc = {"type": "FeatureCollection", "features": features}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
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
