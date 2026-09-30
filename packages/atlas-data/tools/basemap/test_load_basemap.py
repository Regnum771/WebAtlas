"""
Checks for load_basemap.py's region clip and chunked write plan. No database, no extract.

No pytest: this repo has no Python test runner (see contours/test_styles_upload.py). Runs inside
the atlas-tools image, from the gated tools suite (ATLAS_TOOLS_TESTS=1, tools.docker.test.ts):

    python3 packages/atlas-data/tools/basemap/test_load_basemap.py
"""
import importlib.util
import pathlib
import sys

import geopandas as gpd
from shapely.geometry import LineString, Polygon, box

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("load_basemap", HERE / "load_basemap.py")
lb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lb)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


# An L-shaped region: its bbox contains points that are NOT in the region, which is the case the
# precise clip exists for (the real region's bbox reaches far out to sea).
region = Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)])
lines = [
    LineString([(0.5, 0.5), (0.5, 3.5)]),  # inside
    LineString([(3, 3), (3.5, 3.5)]),      # in the bbox, outside the L
    LineString([(3.5, 0.5), (5, 0.5)]),    # crosses the edge
    LineString([(2, 2), (2.5, 2.5)]),      # in the bbox, outside the L
    LineString([(0.2, 0.2), (0.3, 0.3)]),  # inside
]
gdf = gpd.GeoDataFrame({"osm_id": ["a", "b", "c", "d", "e"]}, geometry=lines, crs="EPSG:4326")

clipped = lb.clip_to_region(gdf, region)
check("clip keeps exactly the rows that intersect the region", list(clipped["osm_id"]) == ["a", "c", "e"])
check("clip selects the same rows as the per-row intersects it replaces",
      list(clipped["osm_id"]) == list(gdf[gdf.intersects(region)]["osm_id"]))
check("clip keeps the original row order and index", list(clipped.index) == [0, 2, 4])
check("clip of an empty frame is empty",
      lb.clip_to_region(gdf.iloc[0:0], region).empty)
check("clip with nothing inside is empty",
      lb.clip_to_region(gdf, box(10, 10, 11, 11)).empty)

check("write plan: one replace for a small table", lb.write_chunks(3, 50_000) == [(0, 3, "replace")])
check("write plan: replace, then appends, covering every row once",
      lb.write_chunks(120_001, 50_000) == [(0, 50_000, "replace"), (50_000, 100_000, "append"), (100_000, 120_001, "append")])
check("write plan: nothing for an empty table", lb.write_chunks(0) == [])

land = lb.national_land()
check("land_vn is the 34 provinces", len(land) == 34)
check("land_vn keeps code and name, as publish-basemap.sh and the dev table have them",
      list(land.columns) == ["code", "name", "geometry"])
check("land_vn is polygons in EPSG:4326",
      set(land.geom_type) <= {"Polygon", "MultiPolygon"} and land.crs.to_epsg() == 4326)

if failures:
    sys.exit(f"{len(failures)} check(s) failed")
print("load_basemap checks passed")
