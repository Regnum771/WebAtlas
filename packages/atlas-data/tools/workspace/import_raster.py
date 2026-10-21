"""
Raster import (P3b Task 7): the `import` job for a GeoTIFF upload. The image is warped to
EPSG:3857 and written as a Cloud-Optimized GeoTIFF (DEFLATE, internal overviews) at
cog/<ownerId>/<fileId>.tif in the file store, with a workspace.files row of kind 'cog' and a
'raster' layer in the user's personal map. The upload itself is kept as it is.

Steps: read (content and driver checks, source CRS, extent), transform (warp to EPSG:3857, chunk by
chunk), write (the COG, then the files row, the layer, the revision and the quota check). Database
writes go through the handler's connection, inside the worker's one transaction. Files are not
transactional, so: the COG is written under a temporary name and renamed when complete; the
temporaries are removed whatever happens; and the finished COG is removed again (Steps.on_rollback)
if the job's transaction does not commit.

Security, as for vectors (import_vector.py): the content must start with a TIFF signature before
GDAL sees it, GDAL may open it with the GTiff driver only, and worker.configure_gdal has skipped
the dangerous drivers (the raster VRT driver among them) and the network. rasterio's
calculate_default_transform and WarpedVRT both need the VRT driver, so the target grid is computed
here and rasterio.warp.reproject warps arrays.

Memory: the destination is warped CHUNK x CHUNK pixels at a time into a tiled intermediate GTiff.
For each chunk only the source window under it (plus a small margin) is read, as an array, and
warped with an explicit source transform and CRS (a Band source would take the CRS from the file,
which a GeoTIFF without one does not have). The COG driver then copies that file block by block
and builds the overviews. Nothing holds the whole image in memory.
"""
import math
import os
import uuid

import numpy as np
import psycopg2.extras
from pyproj import CRS as ProjCRS

# worker before rasterio: configure_gdal must run before rasterio registers its GDAL drivers.
from worker import UserFacingError, store_root
from import_vector import (
    NO_CRS, OUT_OF_RANGE, UNSUPPORTED, _crs_label, _file_stem, _resolve_upload, _title,
    finish_map_write, lock_owned_map,
)

import rasterio  # noqa: E402
import rasterio.shutil  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.crs import CRS  # noqa: E402
from rasterio.enums import ColorInterp, Resampling  # noqa: E402
from rasterio.errors import RasterioError  # noqa: E402
from rasterio.warp import reproject, transform_bounds  # noqa: E402
from rasterio.windows import Window  # noqa: E402

# Little-endian and big-endian TIFF, then BigTIFF.
TIFF_MAGICS = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
DST_CRS = "EPSG:3857"
# Web Mercator's latitude limit: the part of an image beyond it is not shown.
MERCATOR_MAX_LAT = 85.0511287798066
# Destination pixels warped per chunk, in each direction (CHUNK^2 x bands x item size bytes, plus
# the source window under it, of a similar size since the warp keeps the pixel count).
CHUNK = 1024
# Source pixels read around each chunk's footprint, so that nearest neighbour at its edge has data.
SOURCE_MARGIN = 2
BLOCKSIZE = 512
# Nearest neighbour for the warp and the overviews: it never invents a value, so classes, palette
# indexes and nodata stay what they were.
COG_OPTIONS = {"COMPRESS": "DEFLATE", "BLOCKSIZE": BLOCKSIZE, "RESAMPLING": "NEAREST", "BIGTIFF": "IF_SAFER"}
# No directory listing on open (no sidecar files are looked for) and no .aux.xml written beside a file.
GDAL_OPTIONS = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_PAM_ENABLED": "NO"}
# Overall progress: reading 0-10, warping 10-70, writing the COG 70-90, the rows after that.
PROGRESS_READ, PROGRESS_WARP, PROGRESS_COG = 10, 70, 90


def check_magic(path: str):
    """Refuse a file that does not start with a TIFF signature, before GDAL picks a driver for it."""
    with open(path, "rb") as f:
        if f.read(4) not in TIFF_MAGICS:
            raise UserFacingError(UNSUPPORTED)


def open_source(path: str):
    """The upload as a GTiff dataset; anything GDAL reads otherwise, or cannot read, is refused."""
    try:
        src = rasterio.open(path, driver="GTiff")  # GDAL tries no other driver
    except RasterioError:
        raise UserFacingError(UNSUPPORTED)
    if src.driver != "GTiff":
        src.close()
        raise UserFacingError(UNSUPPORTED)
    return src


def source_crs(src, chosen):
    """The CRS to warp from and its label: the file's own, else the chosen sourceCrs, else NO_CRS."""
    if src.crs:
        return src.crs, _crs_label(ProjCRS.from_wkt(src.crs.to_wkt()), None)
    if chosen and chosen.get("proj4"):
        proj4 = chosen["proj4"]
        return CRS.from_user_input(proj4), _crs_label(ProjCRS.from_user_input(proj4), proj4)
    raise UserFacingError(NO_CRS)


def json_number(value, dtype: str):
    """A nodata value as JSON: null, an integer for integer types, a float, or "NaN" / "Infinity"
    / "-Infinity", which jsonb cannot hold as numbers (JavaScript's Number() reads them back)."""
    if value is None:
        return None
    f = float(value)
    if math.isnan(f):
        return "NaN"
    if math.isinf(f):
        return "Infinity" if f > 0 else "-Infinity"
    if np.issubdtype(np.dtype(dtype), np.integer) and f.is_integer():
        return int(f)
    return f


def target_grid(src, crs):
    """
    The EPSG:3857 grid to warp to, and the image's extent in EPSG:4326 (clipped to Web Mercator's
    latitudes). Square pixels; their size keeps the source's pixel count along the diagonal, as
    GDAL's suggested warp output does.
    """
    b = transform_bounds(crs, "EPSG:4326", *src.bounds, densify_pts=21)
    # A wrong source CRS shows as an extent off the globe (or across the antimeridian).
    if not (all(math.isfinite(v) for v in b) and -180 <= b[0] <= b[2] <= 180 and -90 <= b[1] <= b[3] <= 90):
        raise UserFacingError(OUT_OF_RANGE)
    shown = (b[0], max(b[1], -MERCATOR_MAX_LAT), b[2], min(b[3], MERCATOR_MAX_LAT))
    if shown[1] >= shown[3]:
        raise UserFacingError(OUT_OF_RANGE)
    if shown == tuple(b):
        m = transform_bounds(crs, DST_CRS, *src.bounds, densify_pts=21)
    else:
        m = transform_bounds("EPSG:4326", DST_CRS, *shown, densify_pts=21)
    dx, dy = m[2] - m[0], m[3] - m[1]
    res = math.hypot(dx, dy) / math.hypot(src.width, src.height)
    if not (math.isfinite(res) and res > 0):
        raise UserFacingError(OUT_OF_RANGE)
    width, height = max(1, round(dx / res)), max(1, round(dy / res))
    return Affine(res, 0, m[0], 0, -res, m[3]), width, height, [float(v) for v in shown]


def overview_count(width: int, height: int) -> int:
    """Halvings until the smallest overview fits one block; at least one."""
    return max(1, math.ceil(math.log2(max(width, height) / BLOCKSIZE)))


def remove_in_store(path: str):
    """Remove one file, after checking it lies inside the store. A missing file is not an error."""
    root = os.path.realpath(store_root())
    full = os.path.realpath(path)
    if full == root or os.path.commonpath([root, full]) != root:
        raise RuntimeError(f"refusing to remove {path!r}: outside the store")
    try:
        os.remove(full)
    except FileNotFoundError:
        pass


def source_window(src, crs, dst_bounds):
    """
    The window of src under a destination chunk (its bounds in EPSG:3857), with SOURCE_MARGIN pixels
    around it, clipped to the image; None when the chunk covers none of it.
    """
    left, bottom, right, top = transform_bounds(DST_CRS, crs, *dst_bounds, densify_pts=21)
    if not all(math.isfinite(v) for v in (left, bottom, right, top)):
        return None  # no point of the chunk has a place in the source CRS
    inv = ~src.transform
    cols, rows = zip(*(inv * (x, y) for x in (left, right) for y in (bottom, top)))
    col0 = max(0, math.floor(min(cols)) - SOURCE_MARGIN)
    row0 = max(0, math.floor(min(rows)) - SOURCE_MARGIN)
    col1 = min(src.width, math.ceil(max(cols)) + SOURCE_MARGIN)
    row1 = min(src.height, math.ceil(max(rows)) + SOURCE_MARGIN)
    if col1 <= col0 or row1 <= row0:
        return None
    return Window(col0, row0, col1 - col0, row1 - row0)


def warp(src, crs, transform, width, height, out_path, steps):
    """Warp every band of src onto the target grid, chunk by chunk, into a tiled GTiff at out_path."""
    count, dtype, nodata = src.count, src.dtypes[0], src.nodata
    alpha = next((i + 1 for i, ci in enumerate(src.colorinterp) if ci == ColorInterp.alpha), 0)
    fill = 0 if nodata is None else nodata
    profile = {
        "driver": "GTiff", "width": width, "height": height, "count": count, "dtype": dtype,
        "crs": DST_CRS, "transform": transform, "nodata": nodata,
        "tiled": True, "blockxsize": BLOCKSIZE, "blockysize": BLOCKSIZE,
        # Temporary: fast compression only to keep it small on disk.
        "compress": "DEFLATE", "zlevel": 1, "bigtiff": "IF_SAFER",
    }
    windows = [Window(col, row, min(CHUNK, width - col), min(CHUNK, height - row))
               for row in range(0, height, CHUNK) for col in range(0, width, CHUNK)]
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.colorinterp = src.colorinterp
        try:
            dst.write_colormap(1, src.colormap(1))
        except ValueError:
            pass  # no palette
        for n, window in enumerate(windows):
            out = np.full((count, window.height, window.width), fill, dtype=dtype)
            read = source_window(src, crs, dst.window_bounds(window))
            if read is not None:
                reproject(
                    source=src.read(window=read), destination=out,
                    src_transform=src.window_transform(read), src_crs=crs, src_nodata=nodata, src_alpha=alpha,
                    dst_transform=dst.window_transform(window), dst_crs=DST_CRS, dst_nodata=nodata,
                    dst_alpha=alpha, resampling=Resampling.nearest,
                )
            dst.write(out, window=window)
            # Between chunks: progress (a heartbeat too) and a moment for the heartbeat thread.
            steps.progress(PROGRESS_READ + (PROGRESS_WARP - PROGRESS_READ) * (n + 1) / len(windows))


def run_import_raster(conn, job, steps) -> dict:
    params = job["params"]
    map_id, owner_id = params["mapId"], str(uuid.UUID(params["ownerId"]))
    original_name = params.get("originalName") or params["path"]

    with rasterio.Env(**GDAL_OPTIONS):
        # --- read
        steps.start("read")
        path = _resolve_upload(params["path"])
        check_magic(path)
        with open_source(path) as src:
            # An identity transform: no georeferencing (GCP-only images are not supported).
            if src.transform.is_identity:
                raise UserFacingError(UNSUPPORTED)
            crs, crs_label = source_crs(src, params.get("sourceCrs"))
            transform, width, height, bounds4326 = target_grid(src, crs)
            steps.progress(PROGRESS_READ)
            steps.done("read")

            # --- transform
            file_id = str(uuid.uuid4())
            rel = f"cog/{owner_id}/{file_id}.tif"
            final = os.path.join(os.path.realpath(store_root()), *rel.split("/"))
            os.makedirs(os.path.dirname(final), exist_ok=True)
            warped, part = f"{final}.warp.tmp", f"{final}.part"
            # The COG driver's own temporaries, named after its output.
            temporaries = (warped, part, f"{part}.ovr.tmp", f"{part}.msk.ovr.tmp")
            try:
                steps.start("transform")
                warp(src, crs, transform, width, height, warped, steps)
                steps.done("transform")

                # --- write
                steps.start("write")
                rasterio.shutil.copy(warped, part, driver="COG",
                                     OVERVIEW_COUNT=overview_count(width, height), **COG_OPTIONS)
                os.replace(part, final)
                steps.on_rollback(lambda: remove_in_store(final))
            finally:
                for t in temporaries:
                    remove_in_store(t)
            steps.progress(PROGRESS_COG)
            raster = {
                "width": width,
                "height": height,
                "bands": src.count,
                "dtype": src.dtypes[0],
                "nodata": json_number(src.nodata, src.dtypes[0]),
                "bounds4326": bounds4326,
                "sourceCrs": crs_label,
            }

    with conn.cursor() as cur:
        position = lock_owned_map(cur, map_id, owner_id)
        cur.execute(
            """INSERT INTO workspace.files (id, owner_id, kind, path, original_name, content_type, size_bytes)
               VALUES (%s, %s, 'cog', %s, %s, 'image/tiff', %s)""",
            (file_id, owner_id, rel, original_name, os.path.getsize(final)),
        )
        cur.execute(
            """INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
               VALUES (%s, 'raster', %s, %s, %s, %s) RETURNING id::text""",
            (map_id, _title(_file_stem(original_name), original_name), position, file_id,
             psycopg2.extras.Json(raster)),
        )
        layer_id = cur.fetchone()[0]
        finish_map_write(cur, map_id, owner_id)
    steps.done("write")
    return {"layerIds": [layer_id], "rows": 0}
