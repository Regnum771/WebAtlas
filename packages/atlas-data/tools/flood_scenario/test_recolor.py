"""
Checks for recolor_frames.py: frames drawn in an older ramp become the current violet bands.

    python3 packages/atlas-data/tools/flood_scenario/test_recolor.py
"""
import importlib.util
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("recolor_frames", HERE / "recolor_frames.py")
recolor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recolor)
import depth  # noqa: E402

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


depths = np.array([[0.0] + [k * 0.25 for k in range(1, 17)]], "float32")
current = depth.depth_rgba(depths)
check("smooth-ramp frames become the current bands", (recolor.recolor(recolor.old_rgba(depths), "smooth") == current).all())
blue = recolor.blue_band_rgba(depths)
check("blue-band frames become the current bands", (recolor.recolor(blue) == current).all())
check("blue-band frames still decode to their depth under the old bands",
      all(depth.depth_of_rgba(tuple(c)) is None for c in blue[0, 1:]))
check("a second run changes nothing", (recolor.recolor(current) == current).all())
check("an unknown colour is left transparent", recolor.recolor(np.array([[[1, 2, 3, 190]]], np.uint8))[0, 0, 3] == 0)

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
