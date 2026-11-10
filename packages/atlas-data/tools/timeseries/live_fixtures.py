"""
Fixtures shared by the opt-in live checks (test_geoserver_live.py, test_bridge_live.py): a small
3-step depth series written as COGs under TIMESERIES_DIR, and removal of a check's own files one
by one by name (never a recursive delete).
"""
import os
from datetime import datetime, timedelta, timezone

import numpy as np
from affine import Affine

from timeseries import cog
from timeseries.model import Step

UTC = timezone.utc
# 40 x 40 cells of 50 m in UTM 49N (Vietnam).
TRANSFORM = Affine(50, 0, 500000, 0, -50, 2000000)
CRS = "EPSG:32649"
T0 = datetime(2025, 10, 26, 1, tzinfo=UTC)
# The files GeoServer and mosaic.write_config put beside the steps of mosaic <name>.
MOSAIC_FILES = ("datastore.properties", "indexer.properties", "timeregex.properties", "sample_image.dat")


def write_depth_series(folder, name, steps=3):
    """Hourly steps from T0, depth rising each hour, one 10 x 10 corner dry. Returns (times, files)."""
    times = [T0 + timedelta(hours=i) for i in range(steps)]
    for i, t in enumerate(times):
        arr = np.full((40, 40), 0.3 + 1.2 * i, dtype="float32")
        arr[:10, :10] = np.nan
        cog.write_step(Step(time=t, array=arr, transform=TRANSFORM, crs=CRS), folder, name)
    return times, [cog.step_filename(name, t) for t in times]


def mosaic_files(name):
    """Every file a published mosaic <name> may hold besides its steps."""
    return list(MOSAIC_FILES) + [f"{name}.properties"]


def remove_files(own):
    """`own` maps a folder to the file names a check wrote there: remove those, then the folder if empty."""
    for d, names in own.items():
        for n in names:
            path = os.path.join(d, n)
            if os.path.isfile(path):
                os.remove(path)
        try:
            if os.path.isdir(d):
                os.rmdir(d)
        except OSError:
            print(f"     left in {d}: {sorted(os.listdir(d))}")
