"""
Checks for depth.py: interpolated water surface, connectivity to a channel, colour ramp.

No pytest (see basemap/test_load_basemap.py). Runs inside the atlas-tools image:

    python3 packages/atlas-data/tools/flood_scenario/test_depth.py
"""
import importlib.util
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("depth", HERE / "depth.py")
depth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(depth)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


dem = np.array([[0, 0, 9, 0, 0]] * 3, dtype="float32")  # a ridge at col 2
channel = np.zeros_like(dem, bool)
channel[:, 0] = True
d = depth.flood_depth(np.full(dem.shape, 1.0, "float32"), dem, channel)
check("connected side is wet", d[1, 1] == 1.0)
check("cut-off hollow stays dry", d[1, 4] == 0.0)
check("ridge is dry", d[1, 2] == 0.0)
check("nan ground is dry", depth.flood_depth(
    np.array([[2.0]], "float32"), np.array([[np.nan]], "float32"), np.array([[True]]))[0, 0] == 0.0)

diag_dem = np.array([[0, 9], [9, 0]], dtype="float32")
diag_channel = np.array([[True, False], [False, False]])
check("diagonal neighbours connect", depth.flood_depth(
    np.full((2, 2), 1.0, "float32"), diag_dem, diag_channel)[1, 1] == 1.0)

rgba = depth.depth_rgba(np.array([[0.0, 0.3, 2.0, 4.0, 9.0]], "float32"))
check("rgba shape", rgba.shape == (1, 5, 4) and rgba.dtype == np.uint8)
check("dry is transparent", rgba[0, 0, 3] == 0)
check("wet is drawn", rgba[0, 1, 3] == 190)


def lum(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


check("deeper is darker", lum(rgba[0, 1]) > lum(rgba[0, 2]) > lum(rgba[0, 3]))
check("capped at max", (rgba[0, 3] == rgba[0, 4]).all())

coast_dist = np.array([[0.0, 1.0, 2.0, 3.0, 4.0, 6.0]], "float32")  # km from the sea
prof = depth.profile_surface({"down": 2.0, "up": 10.0}, {"down": 1.0, "up": 4.0}, coast_dist, sea_level=0.5)
check("profile: sea level at the coast", abs(prof[0, 0] - 0.5) < 1e-6)
check("profile: station takes its level", abs(prof[0, 1] - 2.0) < 1e-6 and abs(prof[0, 4] - 10.0) < 1e-6)
check("profile: linear between stations", abs(prof[0, 2] - (2.0 + 8.0 / 3)) < 1e-5)
check("profile: holds beyond the last station", abs(prof[0, 5] - 10.0) < 1e-6)

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
