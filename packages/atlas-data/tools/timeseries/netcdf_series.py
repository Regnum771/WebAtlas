"""Reads a CF-style NetCDF-4 (HDF5) grid series with h5py, clipped to a lon/lat window (MSWEP layout)."""
import re
from datetime import datetime, timedelta, timezone
from typing import Iterator

import h5py
import numpy as np
from affine import Affine

from workspace_common import UserFacingError

from .model import Step

NO_VARIABLE = "Không tìm thấy biến lưới theo thời gian trong tệp NetCDF."
_UNIT_SECONDS = {"day": 86400, "days": 86400, "hour": 3600, "hours": 3600,
                 "minute": 60, "minutes": 60, "second": 1, "seconds": 1}


def _text(value):
    if isinstance(value, np.ndarray):
        value = value.flat[0] if value.size else ""
    return value.decode() if isinstance(value, bytes) else str(value)


def _dim_names(ds):
    """Names of the dimension scales attached to each axis of `ds`, from DIMENSION_LIST."""
    refs = ds.attrs.get("DIMENSION_LIST")
    if refs is None:
        return None
    names = []
    for axis_refs in refs:
        names.append(ds.file[axis_refs[0]].name.rsplit("/", 1)[-1] if len(axis_refs) else "")
    return names


def _find_variable(f):
    for key in f:
        ds = f[key]
        if not isinstance(ds, h5py.Dataset) or ds.ndim != 3 or ds.dtype.kind != "f":
            continue
        names = _dim_names(ds)
        if names and names[1] == "lat" and names[2] == "lon":
            return ds
    raise UserFacingError(NO_VARIABLE)


def _times(f, count):
    ds = f["time"]
    m = re.match(r"\s*(\w+)\s+since\s+(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?",
                 _text(ds.attrs.get("units", "")))
    if not m or m.group(1) not in _UNIT_SECONDS:
        raise UserFacingError("Không đọc được đơn vị thời gian của tệp NetCDF.")
    base = datetime(*(int(g or 0) for g in m.groups()[1:]), tzinfo=timezone.utc)
    step = _UNIT_SECONDS[m.group(1)]
    values = np.asarray(ds[...], dtype="float64").ravel()
    out = [base + timedelta(seconds=round(float(v) * step)) for v in values]
    return out[:count]


def describe(path: str) -> dict:
    with h5py.File(path, "r") as f:
        var = _find_variable(f)
        return {"variable": var.name.lstrip("/"), "unit": _text(var.attrs.get("units", "")),
                "times": _times(f, var.shape[0])}


def read_cf(path: str, clip4326: tuple) -> Iterator[Step]:
    minx, miny, maxx, maxy = clip4326
    with h5py.File(path, "r") as f:
        var = _find_variable(f)
        lon = np.asarray(f["lon"][...], dtype="float64")
        lat = np.asarray(f["lat"][...], dtype="float64")
        cols = np.where((lon >= minx) & (lon <= maxx))[0]
        rows = np.where((lat >= miny) & (lat <= maxy))[0]
        if cols.size == 0 or rows.size == 0:
            raise UserFacingError("Vùng cắt nằm ngoài phạm vi của tệp NetCDF.")
        c0, c1, r0, r1 = int(cols[0]), int(cols[-1]) + 1, int(rows[0]), int(rows[-1]) + 1
        dx = (lon[-1] - lon[0]) / (lon.size - 1)
        dy = (lat[-1] - lat[0]) / (lat.size - 1)  # negative when lat descends
        fill = var.attrs.get("_FillValue")
        fill = float(np.asarray(fill).flat[0]) if fill is not None else None
        times = _times(f, var.shape[0])
        for i, t in enumerate(times):
            arr = np.asarray(var[i, r0:r1, c0:c1], dtype="float32").copy()
            if fill is not None:
                arr[arr == np.float32(fill)] = np.nan
            if dy > 0:  # ascending lat: flip so row 0 is the northern edge
                arr = arr[::-1].copy()
                north = lat[r1 - 1]
            else:
                north = lat[r0]
            transform = Affine(dx, 0, lon[c0] - dx / 2, 0, -abs(dy), north + abs(dy) / 2)
            yield Step(time=t, array=arr, transform=transform, crs="EPSG:4326")
