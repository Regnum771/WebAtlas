"""
Checks for the timeseries library core: times, COG steps, mosaic folder, GeoTIFF reader.

No pytest (see workspace/test_worker.py). Runs inside the atlas-tools image:

    python3 packages/atlas-data/tools/timeseries/test_core.py
"""
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timezone

# tools/ on the path makes `timeseries` importable; the package puts tools/workspace on it too.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import cog, geotiff_series, mosaic, times  # noqa: E402
from timeseries.model import Step  # noqa: E402
from workspace_common import UserFacingError  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
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


# --- parse_time
check("YYYYMMDD", times.parse_time("rain_20251026.tif", "YYYYMMDD") == datetime(2025, 10, 26, tzinfo=UTC))
check("YYYYDDD", times.parse_time("2025299.nc", "YYYYDDD") == datetime(2025, 10, 26, tzinfo=UTC))
check("YYYYMMDDHHmm",
      times.parse_time("d_202510260130.tif", "YYYYMMDDHHmm") == datetime(2025, 10, 26, 1, 30, tzinfo=UTC))
check("no match is None", times.parse_time("x.tif", "YYYYMMDD") is None)
check("12 digits are not an 8-digit date", times.parse_time("d_202510260130.tif", "YYYYMMDD") is None)
check("patterns", times.PATTERNS == {"YYYYMMDD", "YYYYMMDDHHmm", "YYYYDDD"})

# --- assign_times
msg = message_of(lambda: times.assign_times(["a_20251026.tif", "b.tif"], "YYYYMMDD", None))
check("unmatched file is named", msg is not None and "b.tif" in msg and "Không xác định được thời điểm của" in msg)
msg = message_of(lambda: times.assign_times(["a_20251026.tif", "b_20251026.tif"], "YYYYMMDD", None))
check("duplicate time names both",
      msg is not None and "a_20251026.tif" in msg and "b_20251026.tif" in msg and "Trùng thời điểm" in msg)
msg = message_of(lambda: times.assign_times([f"f{i}.tif" for i in range(7)], "YYYYMMDD", None))
check("seven unmatched: five named and 'và 2 tệp khác'",
      msg is not None and "f4.tif" in msg and "f5.tif" not in msg and "và 2 tệp khác" in msg)
ordered = times.assign_times(["b_20251027.tif", "a_20251026.tif"], "YYYYMMDD", None)
check("sorted by time", [n for n, _ in ordered] == ["a_20251026.tif", "b_20251027.tif"])
via_csv = times.assign_times(["x.tif"], None, {"x.tif": datetime(2025, 10, 26, 1, tzinfo=UTC)})
check("csv supplies the time", via_csv == [("x.tif", datetime(2025, 10, 26, 1, tzinfo=UTC))])

# --- CSV
parsed = times.times_from_csv("file,time\nx.tif,2025-10-26T01:00:00Z\n")
check("csv time", parsed["x.tif"] == datetime(2025, 10, 26, 1, tzinfo=UTC))

# --- step_filename
check("step filename",
      cog.step_filename("lu_2025", datetime(2025, 10, 26, 1, tzinfo=UTC)) == "lu_2025_20251026T010000Z.tif")

# --- write_step / read_series
out_dir = tempfile.mkdtemp(prefix="ts_core_")
arr = np.arange(400, dtype="float32").reshape(20, 20)
arr[5:9, 5:9] = np.nan
# 20 x 20 cells of 100 m in UTM 49N (Vietnam), upper left at (500000, 2000000).
step = Step(time=datetime(2025, 10, 26, 1, tzinfo=UTC), array=arr,
            transform=Affine(100, 0, 500000, 0, -100, 2000000), crs="EPSG:32649")
path = cog.write_step(step, out_dir, "lu_2025")
check("file name", os.path.basename(path) == "lu_2025_20251026T010000Z.tif")
check("no .part left", not os.path.exists(path + ".part"))
with rasterio.open(path) as ds:
    check("GTiff tiled", ds.driver == "GTiff" and ds.profile["tiled"])
    check("overviews", len(ds.overviews(1)) >= 1)
    check("EPSG:3857", ds.crs.to_epsg() == 3857)
    check("nodata -9999", ds.nodata == -9999)
    check("float32", ds.dtypes[0] == "float32")
    data = ds.read(1)
    # A pixel in the middle of the NaN block, via its map position.
    x, y = 500000 + 650, 2000000 - 650
    from rasterio.warp import transform as warp_transform
    (mx,), (my,) = warp_transform("EPSG:32649", "EPSG:3857", [x], [y])
    row, col = ds.index(mx, my)
    check("NaN block reads back as -9999", data[row, col] == -9999)
    x, y = 500000 + 1550, 2000000 - 1550
    (mx,), (my,) = warp_transform("EPSG:32649", "EPSG:3857", [x], [y])
    row, col = ds.index(mx, my)
    check("data pixel survives", data[row, col] == arr[15, 15])

# A global 0.1° grid as MSWEP's float32 coordinates give it: the edges overshoot ±180/±90 by a
# few millionths of a degree (seen on the real files: bottom -90.0000122). Rounding, not a wrong CRS.
glob_arr = np.ones((18, 36), dtype="float32")
glob_step = Step(time=datetime(2025, 10, 27, tzinfo=UTC), array=glob_arr,
                 transform=Affine(9.99999991522, 0, -179.99999694739424, 0, -10.0000007, 89.99999695078674),
                 crs="EPSG:4326")
try:
    glob_path = cog.write_step(glob_step, out_dir, "mua_toan_cau")
    with rasterio.open(glob_path) as ds:
        b = ds.bounds
        check("a global grid whose float32 edges overshoot ±90 warps, clamped to Web Mercator",
              ds.crs.to_epsg() == 3857 and b.top <= 20037508.35 and b.bottom >= -20037508.35)
except UserFacingError as e:
    check(f"a global grid whose float32 edges overshoot ±90 warps (got: {e})", False)

series = list(geotiff_series.read_series([(path, step.time)]))
check("read_series yields a Step", len(series) == 1 and series[0].time == step.time
      and series[0].crs.endswith("3857") and np.isnan(series[0].array).any())

# --- write_config
cfg_dir = os.path.join(out_dir, "mosaic")
mosaic.write_config(cfg_dir, "lu_2025", mosaic.IndexDb("db", 5432, "geonode_data", "ts_lu_2025", "geo", "pw"))


def read(name):
    with open(os.path.join(cfg_dir, name), encoding="utf-8") as f:
        return f.read()


check("timeregex", read("timeregex.properties") == "regex=[0-9]{8}T[0-9]{6}Z,format=yyyyMMdd'T'HHmmss'Z'")
indexer = read("indexer.properties")
check("indexer", all(s in indexer for s in (
    "TimeAttribute=time", "Schema=*the_geom:Polygon,location:String,time:java.util.Date",
    "PropertyCollectors=TimestampFileNameExtractorSPI[timeregex](time)", "AbsolutePath=false",
    "Wildcard=lu_2025_*.tif")))
store = read("datastore.properties")
check("datastore", all(s in store for s in (
    "SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory", "schema=ts_lu_2025",
    "host=db", "database=geonode_data", "user=geo")))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
