"""
Checks for the NetCDF series reader (MSWEP layout). No pytest; run inside the atlas-tools image:

    python3 packages/atlas-data/tools/timeseries/test_netcdf.py

Set MSWEP_SAMPLE=<path to a real MSWEP .nc> for the opt-in real-file check.
"""
import os
import pathlib
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import netcdf_series  # noqa: E402
from workspace_common import UserFacingError  # noqa: E402

import h5py  # noqa: E402
import numpy as np  # noqa: E402

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


def build(path, descending=True, with_var=True):
    """Write a NetCDF-4-like file with the MSWEP layout and attached dimension scales."""
    lon = (-179.95 + 0.1 * np.arange(3600)).astype("float32")
    lat = (89.95 - 0.1 * np.arange(1800)).astype("float32")
    if not descending:
        lat = lat[::-1].copy()
    with h5py.File(path, "w") as f:
        dlon = f.create_dataset("lon", data=lon)
        dlat = f.create_dataset("lat", data=lat)
        dt = f.create_dataset("time", data=np.array([46320.0], dtype="float32"))
        dt.attrs["units"] = "days since 1900-1-1 00:00:00"
        for d in (dlon, dlat, dt):
            d.make_scale(d.name.lstrip("/"))
        if not with_var:
            return
        data = np.zeros((1, 1800, 3600), dtype="float32")
        li = int(np.argmin(np.abs(lat - 15.85)))
        lj = int(np.argmin(np.abs(lon - 108.05)))
        data[0, li, lj] = 201.0
        data[0, li, lj + 1] = -9999.0
        v = f.create_dataset("precipitation", data=data)
        v.attrs["_FillValue"] = np.array([-9999.0], dtype="float32")
        v.attrs["units"] = "mm/d"
        v.dims[0].attach_scale(dt)
        v.dims[1].attach_scale(dlat)
        v.dims[2].attach_scale(dlon)


CLIP = (107.2, 14.9, 108.8, 16.2)
tmp = tempfile.mkdtemp()

for descending in (True, False):
    p = os.path.join(tmp, f"mswep_{'desc' if descending else 'asc'}.nc")
    build(p, descending)
    tag = "descending lat" if descending else "ascending lat"
    d = netcdf_series.describe(p)
    check(f"{tag}: variable", d["variable"] == "precipitation")
    check(f"{tag}: unit", d["unit"] == "mm/d")
    check(f"{tag}: one time 2026-10-27", d["times"] == [datetime(2026, 10, 27, tzinfo=UTC)])
    steps = list(netcdf_series.read_cf(p, CLIP))
    check(f"{tag}: one step", len(steps) == 1)
    s = steps[0]
    check(f"{tag}: step time", s.time == datetime(2026, 10, 27, tzinfo=UTC))
    check(f"{tag}: shape (13,16)", s.array.shape == (13, 16))
    check(f"{tag}: float32", s.array.dtype == np.float32)
    t = s.transform
    check(f"{tag}: pixel size 0.1", abs(t.a - 0.1) < 1e-6 and abs(t.e + 0.1) < 1e-6)
    check(f"{tag}: top-left centre (107.25, 16.15)",
          abs(t.c + t.a / 2 - 107.25) < 1e-4 and abs(t.f + t.e / 2 - 16.15) < 1e-4)
    check(f"{tag}: CRS", s.crs == "EPSG:4326")
    check(f"{tag}: value 201 at row 3 col 8", abs(float(s.array[3, 8]) - 201.0) < 1e-4)
    check(f"{tag}: fill is NaN", bool(np.isnan(s.array[3, 9])))
    check(f"{tag}: only fill is NaN", int(np.isnan(s.array).sum()) == 1)

p = os.path.join(tmp, "novar.nc")
build(p, with_var=False)
msg = message_of(lambda: netcdf_series.describe(p))
check("no grid variable raises", msg == "Không tìm thấy biến lưới theo thời gian trong tệp NetCDF.")
msg = message_of(lambda: list(netcdf_series.read_cf(p, CLIP)))
check("no grid variable raises in read_cf", msg == "Không tìm thấy biến lưới theo thời gian trong tệp NetCDF.")

sample = os.environ.get("MSWEP_SAMPLE")
if sample:
    steps = list(netcdf_series.read_cf(sample, CLIP))
    mean = float(np.nanmean(steps[0].array))
    print(f"     real file basin mean = {mean:.1f} mm")
    check("real file: 2025-10-27", steps[0].time == datetime(2025, 10, 27, tzinfo=UTC))
    check("real file: basin mean 190-210 mm", 190 <= mean <= 210)

print("\nFAILED: " + ", ".join(failures) if failures else "\nall ok")
sys.exit(1 if failures else 0)
