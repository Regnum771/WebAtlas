"""Builds a NetCDF-4-like file with the MSWEP layout and attached dimension scales (for checks only)."""
import h5py
import numpy as np


def build(path, descending=True, with_var=True):
    """Global 0.1-degree grid, one day (2026-10-27), 201 mm at (15.85 N, 108.05 E), fill just east of it."""
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
