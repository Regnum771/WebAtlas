"""One COG per time step: EPSG:3857, float32, nodata -9999, DEFLATE, internal overviews."""
import os
from types import SimpleNamespace

import import_raster  # from tools/workspace; the package import has already configured GDAL

import numpy as np
import rasterio
import rasterio.shutil
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.transform import array_bounds
from rasterio.warp import reproject

NODATA = -9999.0


def step_filename(name, t):
    return f"{name}_{t.strftime('%Y%m%dT%H%M%SZ')}.tif"


def write_step(step, out_dir, name):
    """Warp the step to EPSG:3857 and write it as a COG in out_dir; returns the path."""
    h, w = step.array.shape
    left, bottom, right, top = array_bounds(h, w, step.transform)
    # target_grid only needs bounds, width and height from the source.
    shim = SimpleNamespace(bounds=(left, bottom, right, top), width=w, height=h)
    transform, width, height, _ = import_raster.target_grid(shim, step.crs)
    out = np.full((height, width), NODATA, dtype="float32")
    reproject(
        source=step.array.astype("float32"), destination=out,
        src_transform=step.transform, src_crs=step.crs, src_nodata=np.nan,
        dst_transform=transform, dst_crs=import_raster.DST_CRS, dst_nodata=NODATA,
        resampling=Resampling.nearest,
    )
    os.makedirs(out_dir, exist_ok=True)
    final = os.path.join(out_dir, step_filename(name, step.time))
    part = final + ".part"
    profile = {"driver": "GTiff", "width": width, "height": height, "count": 1, "dtype": "float32",
               "crs": import_raster.DST_CRS, "transform": transform, "nodata": NODATA}
    try:
        with rasterio.Env(**import_raster.GDAL_OPTIONS), MemoryFile() as mem:
            with mem.open(**profile) as ds:
                ds.write(out, 1)
                rasterio.shutil.copy(ds, part, driver="COG", **import_raster.COG_OPTIONS,
                                     OVERVIEW_COUNT=import_raster.overview_count(width, height))
        os.replace(part, final)
    finally:
        for t in (part, part + ".ovr.tmp", part + ".msk.ovr.tmp"):
            if os.path.exists(t):
                os.remove(t)
    return final
