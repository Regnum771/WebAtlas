"""
Checks for the HEC-RAS reader and the FABDEM reader. No pytest; run inside the atlas-tools image:

    python3 packages/atlas-data/tools/timeseries/test_hecras.py

Opt-ins: RAS_HDF_SAMPLE=<real .p01.hdf> for the real-file checks; the DEM check runs when
BASEMAP_DB_URL is set and basemap.dem_region has rows.
"""
import os
import pathlib
import sys
import tempfile
import time
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import hecras  # noqa: E402
from timeseries.fixtures import make_ras_fixture as fx  # noqa: E402
from workspace_common import UserFacingError  # noqa: E402

import numpy as np  # noqa: E402
from affine import Affine  # noqa: E402

UTC = timezone.utc
failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


def message_of(fn):
    try:
        fn()
    except UserFacingError as e:
        return str(e)
    return None


tmp = tempfile.mkdtemp()
wse = np.full((9, 5), 10.0)
wse[:, 0], wse[:, 1], wse[:, 2] = 10.30, 10.03, 9.0
wse[3, 3] = 12.0  # cell 3 floods only at step 3, which `every=4` skips but the peak must see
p = os.path.join(tmp, "a.hdf")
fx.build(p, wse=wse)

# 50 m pixels over the 200 m x 200 m extent: 4x4 pixels, 2x2 per cell
tr = Affine(50, 0, fx.X0, 0, -50, fx.Y0 + 200)
shape = (4, 4)

with hecras.RasFile(p) as ras:
    check("areas == ['A1']", ras.areas == ["A1"])
    check("9 times", len(ras.times) == 9)
    check("first time 2025-10-25T00:00Z", ras.times[0] == datetime(2025, 10, 25, tzinfo=UTC))
    check("last time 02:00", ras.times[-1] == datetime(2025, 10, 25, 2, 0, tzinfo=UTC))
    check("crs is UTM 49N", "UTM_Zone_49N" in ras.crs_wkt)
    check("extent", ras.extent("A1") == (fx.X0, fx.Y0, fx.X0 + 200, fx.Y0 + 200))

    grid = hecras.cell_index_grid(ras, "A1", tr, shape)
    check("grid dtype int32", grid.dtype == np.int32)
    expect = np.array([[2, 2, 3, 3], [2, 2, 3, 3], [0, 0, 1, 1], [0, 0, 1, 1]])
    check("grid pixels carry the cell index", (grid == expect).all())
    check("ghost cell 4 never appears", not (grid == 4).any())
    wide = Affine(50, 0, fx.X0 - 100, 0, -50, fx.Y0 + 300)
    g2 = hecras.cell_index_grid(ras, "A1", wide, (6, 8))
    check("outside pixels are -1", g2[0, 0] == -1 and g2[5, 7] == -1 and int((g2 >= 0).sum()) == 16)

    dem = np.full(shape, 10.0, dtype="float32")
    dem[0, 0] = np.nan  # a pixel of cell 2 with no DEM
    steps = list(hecras.depth_steps(ras, "A1", dem, tr, every=4))
    check("3 steps for every=4", len(steps) == 3)
    check("step times 0:00, 1:00, 2:00",
          [s.time.hour for s in steps] == [0, 1, 2] and all(s.time.minute == 0 for s in steps))
    s0 = steps[0]
    check("step dtype float32 / crs / transform",
          s0.array.dtype == np.float32 and s0.transform == tr and "UTM_Zone_49N" in s0.crs)
    check("cell 0 depth 0.30", np.allclose(s0.array[2:, :2], 0.30, atol=1e-6))
    check("cell 1 (0.03) is NaN", np.isnan(s0.array[2:, 2:]).all())
    check("cell 2 (negative) is NaN", np.isnan(s0.array[:2, :2]).all())
    check("DEM NaN pixel is NaN", np.isnan(s0.array[0, 0]))
    check("cell 3 dry at step 0", np.isnan(s0.array[:2, 2:]).all())
    check("every=1 gives 9 steps", len(list(hecras.depth_steps(ras, "A1", dem, tr, every=1))) == 9)

    peak = hecras.peak_depth(ras, "A1", dem, tr)
    ref = np.fmax.reduce([s.array for s in hecras.depth_steps(ras, "A1", dem, tr, every=1)])
    check("peak equals per-pixel max",
          np.array_equal(np.nan_to_num(peak.array, nan=-1), np.nan_to_num(ref, nan=-1)))
    check("peak sees cell 3 (2.0 m)", np.allclose(peak.array[:2, 2:], 2.0))
    check("peak time is the last step", peak.time == ras.times[-1])
    check("pick_area on a single-area file", hecras.pick_area(ras, None) == "A1")

p2 = os.path.join(tmp, "geom.hdf")
fx.build(p2, results=False)


def read_times_of_geometry_only():
    with hecras.RasFile(p2) as r:
        return r.times


msg = message_of(read_times_of_geometry_only)
check("geometry-only raises", msg == "Tệp .hdf không có kết quả mô phỏng (thiếu nhóm Results).")

p3 = os.path.join(tmp, "two.hdf")
fx.build(p3, areas=("A1", "B2"))
with hecras.RasFile(p3) as ras:
    check("two areas listed", ras.areas == ["A1", "B2"])
    msg = message_of(lambda: hecras.pick_area(ras, None))
    check("no area chosen names both", msg is not None and "A1" in msg and "B2" in msg)
    check("chosen area is returned", hecras.pick_area(ras, "B2") == "B2")
    msg = message_of(lambda: hecras.pick_area(ras, "Z"))
    check("unknown area raises and lists names", msg is not None and "A1" in msg and "B2" in msg)

sample = os.environ.get("RAS_HDF_SAMPLE")
if sample:
    t0 = time.time()
    area = "Thu_Bon_Vu_Gia_4"
    with hecras.RasFile(sample) as ras:
        check("real: areas", ras.areas == [area])
        check("real: 289 times", len(ras.times) == 289)
        check("real: range", ras.times[0] == datetime(2025, 10, 25, tzinfo=UTC)
              and ras.times[-1] == datetime(2025, 10, 28, tzinfo=UTC))
        check("real: UTM 49N", "UTM_Zone_49N" in ras.crs_wkt)
        rtr, rshape = hecras.area_grid(ras, area, 30.0)
        print(f"     grid {rshape}")
        t1 = time.time()
        rgrid = hecras.cell_index_grid(ras, area, rtr, rshape)
        print(f"     rasterized in {time.time() - t1:.0f} s, {int((rgrid >= 0).sum())} covered pixels")
        check("real: indexes within real cells", int(rgrid.max()) < ras.n_cells(area))
        cmin = ras.cell_min_elevation(area)
        counts = []
        for i in (0, 144, 288):
            w = ras.water_surface(area, i)
            d = np.where(rgrid >= 0, w[rgrid.clip(0)] - cmin[rgrid.clip(0)], np.nan)
            counts.append(int((d > 0.05).sum()))
        print(f"     wet pixels (WSE - cell minimum elevation > 0.05) at steps 0/144/288: {counts}")
        check("real: wet area grows", counts[0] < counts[1] < counts[2])
    print(f"     real-file checks took {time.time() - t0:.0f} s")

if os.environ.get("BASEMAP_DB_URL"):
    from sqlalchemy import create_engine, text
    from timeseries import dem as demmod
    engine = create_engine(os.environ["BASEMAP_DB_URL"])
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT count(*) FROM basemap.dem_region")).scalar()
        if not rows:
            print("     basemap.dem_region is empty: DEM check skipped")
        else:
            # 3 km box inside the basin, in UTM 49N (about 15.8 N, 108.2 E)
            bounds = (200000.0, 1750000.0, 203000.0, 1753000.0)
            arr, dtr = demmod.read_dem(conn, bounds, fx.UTM49N, 30.0)
            check("dem: 30 m grid", abs(dtr.a - 30) < 1e-6 and abs(dtr.e + 30) < 1e-6)
            check("dem: covers bounds", arr.shape == (100, 100))
            fin = arr[np.isfinite(arr)]
            check("dem: finite values 0-2000 m", fin.size > 0 and fin.min() >= -5 and fin.max() <= 2000)
            outside = (300000.0, 1000000.0, 303000.0, 1003000.0)  # open sea, no FABDEM
            arr2, _ = demmod.read_dem(conn, outside, fx.UTM49N, 30.0)
            check("dem: NaN outside coverage", bool(np.isnan(arr2).all()))

print("\nFAILED: " + ", ".join(failures) if failures else "\nall ok")
sys.exit(1 if failures else 0)
