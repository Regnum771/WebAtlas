"""FABDEM from the basemap database, warped onto a metric grid."""
import math

import numpy as np
from affine import Affine
from pyproj import CRS, Transformer
from rasterio.crs import CRS as RioCRS
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, reproject
from sqlalchemy import text

PAD_DEG = 0.01  # margin around the box so bilinear sampling has neighbours at the edges


def read_dem(conn, bounds: tuple, crs_wkt: str, res: float = 30.0) -> tuple:
    """FABDEM (basemap.dem_region) over `bounds` = (xmin, ymin, xmax, ymax) in `crs_wkt`, as a float32
    grid of `res`-metre pixels, bilinear. Returns (array, transform); NaN where FABDEM has no data."""
    xmin, ymin, xmax, ymax = bounds
    shape = (math.ceil((ymax - ymin) / res), math.ceil((xmax - xmin) / res))
    dst_tr = Affine(res, 0, xmin, 0, -res, ymin + shape[0] * res)
    out = np.full(shape, np.nan, dtype="float32")

    to4326 = Transformer.from_crs(CRS.from_wkt(crs_wkt), 4326, always_xy=True)
    # sample the box edges so a rotated lon/lat footprint is still covered
    xs = np.linspace(xmin, xmax, 9)
    ys = np.linspace(ymin, ymax, 9)
    px = np.concatenate([xs, xs, np.full(9, xmin), np.full(9, xmax)])
    py = np.concatenate([np.full(9, ymin), np.full(9, ymax), ys, ys])
    lon, lat = to4326.transform(px, py)
    w, e = float(min(lon)) - PAD_DEG, float(max(lon)) + PAD_DEG
    s, n = float(min(lat)) - PAD_DEG, float(max(lat)) + PAD_DEG

    conn.execute(text("SET postgis.gdal_enabled_drivers = 'GTiff'"))
    blob = conn.execute(text(
        "SELECT ST_AsGDALRaster(ST_Union(ST_Clip(rast, env, true)), 'GTiff') "
        "FROM basemap.dem_region, (SELECT ST_MakeEnvelope(:w, :s, :e, :n, 4326) env) b "
        "WHERE ST_Intersects(rast, env)"), dict(w=w, s=s, e=e, n=n)).scalar()
    if blob is None:
        return out, dst_tr

    with MemoryFile(bytes(blob)) as mf, mf.open() as src:
        data = src.read(1, masked=True).astype("float32").filled(np.nan)
        reproject(
            source=data, destination=out,
            src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
            dst_transform=dst_tr, dst_crs=RioCRS.from_wkt(crs_wkt), dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    return out, dst_tr
