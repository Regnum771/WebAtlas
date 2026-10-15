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

rgba = depth.depth_rgba(np.array([[0.0, 0.25, 0.75, 1.5, 2.5, 3.5, 9.0]], "float32"))
check("rgba shape", rgba.shape == (1, 7, 4) and rgba.dtype == np.uint8)
check("dry is transparent", rgba[0, 0, 3] == 0)
check("wet is drawn", rgba[0, 1, 3] == depth.ALPHA)


def lum(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


check("each band darker than the last", all(lum(rgba[0, i]) > lum(rgba[0, i + 1]) + 15 for i in range(1, 5)))
check("deep water capped at 4 m", (rgba[0, 6] == depth.depth_rgba(np.array([[4.0]], "float32"))[0, 0]).all())
# Every 0.25 m step gets its own colour, so the map can read depth back from a frame pixel.
steps = depth.depth_rgba(np.array([[k * 0.25 for k in range(1, 17)]], "float32"))[0]
check("16 steps, 16 distinct colours", len({tuple(c) for c in steps}) == 16)
check("steps decode back to depth", all(depth.depth_of_rgba(tuple(c)) == (k + 1) * 0.25 for k, c in enumerate(steps)))
check("transparent decodes to dry", depth.depth_of_rgba((0, 0, 0, 0)) is None)
check("band of 1.75 m", tuple(depth.depth_rgba(np.array([[1.75]], "float32"))[0, 0][:3]) == (0x3A + 3, 0x86, 0xC8))

coast_dist = np.array([[0.0, 1.0, 2.0, 3.0, 4.0, 6.0]], "float32")  # km from the sea
prof = depth.profile_surface({"down": 2.0, "up": 10.0}, {"down": 1.0, "up": 4.0}, coast_dist, sea_level=0.5)
check("profile: sea level at the coast", abs(prof[0, 0] - 0.5) < 1e-6)
check("profile: station takes its level", abs(prof[0, 1] - 2.0) < 1e-6 and abs(prof[0, 4] - 10.0) < 1e-6)
check("profile: linear between stations", abs(prof[0, 2] - (2.0 + 8.0 / 3)) < 1e-5)
check("profile: holds beyond the last station", abs(prof[0, 5] - 10.0) < 1e-6)

base = np.array([[0.4, 0.0, 0.0]], "float32")
now = np.array([[1.4, 0.7, 0.0]], "float32")
fl = depth.above_baseline(now, base)
check("baseline: water already there before the flood is not flood", fl[0, 0] == 0.0)
check("baseline: new water is flood at its full depth", abs(fl[0, 1] - 0.7) < 1e-6)
check("baseline: dry stays dry", fl[0, 2] == 0.0)

check("floodplain offset is the calibrated 1.5 m", depth.FLOODPLAIN_OFFSET_M == 1.5)
fp = depth.floodplain_surface({"down": 2.0, "up": 10.0}, {"down": 1.0, "up": 4.0}, coast_dist, sea_level=0.5)
check("floodplain surface sits the offset below the river profile", np.allclose(fp, prof - 1.5))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
