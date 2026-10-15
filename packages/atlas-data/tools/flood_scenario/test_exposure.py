"""
Checks for exposure.py's road handling: which OSM roads can flood, and segment lengths.

No pytest (see basemap/test_load_basemap.py). Runs inside the atlas-tools image:

    python3 packages/atlas-data/tools/flood_scenario/test_exposure.py
"""
import importlib.util
import pathlib
import sys

import geopandas as gpd
import numpy as np
from rasterio.transform import from_origin
from shapely.geometry import LineString

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("exposure", HERE / "exposure.py")
exposure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exposure)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


line = LineString([(108.0, 15.8), (108.01, 15.8)])  # ~1.07 km east-west at 15.8 N
roads = gpd.GeoDataFrame({
    "osm_id": ["a", "b", "c", "d"],
    "fclass": ["primary", "primary", "residential", "motorway"],
    "name": ["QL1", "Cầu X", None, None],
    "ref": [None, None, None, None],
    "bridge": ["F", "T", "F", "F"],
    "tunnel": ["F", "F", "F", "F"],
}, geometry=[line] * 4, crs=4326)

kept = exposure.floodable_roads(roads)
check("bridges are dropped: they stand above the water", "b" not in set(kept["osm_id"]))
check("motorways are dropped: their embankments vanish in a 30 m DEM", "d" not in set(kept["osm_id"]))
check("ordinary roads are kept", set(kept["osm_id"]) == {"a", "c"})

transform = from_origin(107.99, 15.81, 0.001, 0.001)
arrays = {"first_cut": np.full((20, 40), 5, dtype="int16"), "max_depth": np.full((20, 40), 0.5, dtype="float32")}
out = exposure.roads_exposure(kept.reset_index(drop=True), exposure.road_samples(kept.reset_index(drop=True)), arrays, transform)
check("segment length in metres", abs(out["length_m"].iloc[0] - 1071) < 15)
check("cut hour read from the grid", out["cut_hour"].iloc[0] == 5)

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
