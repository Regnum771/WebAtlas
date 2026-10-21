"""
What the workspace worker and its handlers share: the GDAL restrictions, the file store, the
user-facing error and copy, and the write rules every import applies to the target map.

A leaf module: it imports neither worker.py nor a handler (import_vector, import_raster), and no
GDAL binding at import time, so any of them can import it first without an import cycle. Importing
it runs configure_gdal(), so a handler that imports this module before pyogrio or rasterio gets a
restricted GDAL whichever module was loaded first.
"""
import os
import pathlib
import sys

# GDAL drivers the worker never needs. Each can make GDAL open other files or fetch URLs merely
# because an upload's content names them (an <OGRVRTDataSource> in a .geojson, a <VRTDataset> in a
# .tif, a WFS/WMS service description, ...). PostgreSQL is listed even though this build's pyogrio
# has no such driver, so a future build that does stays covered (GDAL warns once about the missing name).
GDAL_SKIP_DRIVERS = ("VRT", "OGR_VRT", "WFS", "OAPIF", "WMS", "WMTS", "PostgreSQL", "CSV", "SQLite", "GML", "HTTP")
GDAL_CONFIG = {
    "GDAL_SKIP": " ".join(GDAL_SKIP_DRIVERS),
    # No network: /vsicurl/ only opens names ending in one of these extensions, and none will.
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".webatlas-no-network",
    # ... but that governs /vsi* only. CPLHTTPFetch (used e.g. by OSR for a GeoJSON "crs" of type
    # link or url) ignores it, so every GDAL HTTP request is sent to a proxy that does not exist
    # (port 9, discard): it fails at once and nothing reaches any host.
    "GDAL_HTTP_PROXY": "127.0.0.1:9",
    "GDAL_HTTP_TIMEOUT": "1",
    "GDAL_HTTP_CONNECTTIMEOUT": "1",
    "GDAL_HTTP_MAX_RETRY": "0",
    # PROJ (bundled with GDAL, rasterio and pyproj) may fetch grids from its CDN when enabled.
    "PROJ_NETWORK": "OFF",
}


def configure_gdal():
    """
    Restrict every GDAL the worker loads (pyogrio's and rasterio's; each wheel bundles its own) as
    GDAL_CONFIG says. Set through the environment: GDAL reads the network options on each use, but
    reads GDAL_SKIP only once, when it registers its drivers (pyogrio on import, rasterio when its
    first Env starts). So this must run before either is imported, and refuses to go on if one of
    them already registered its drivers.
    """
    os.environ.update(GDAL_CONFIG)
    # curl skips the proxy for hosts listed in NO_PROXY; the worker makes no HTTP request of its own.
    for name in ("NO_PROXY", "no_proxy"):
        os.environ.pop(name, None)
    if "pyogrio" in sys.modules:
        import pyogrio

        if "OGR_VRT" in pyogrio.list_drivers():
            raise RuntimeError("GDAL was loaded before configure_gdal(); import worker before pyogrio")
    if "rasterio" in sys.modules:
        import rasterio

        # Starting an Env registers the drivers if that has not happened yet, now with GDAL_SKIP
        # set; VRT is then present only if rasterio registered them before this ran.
        with rasterio.Env() as env:
            if "VRT" in env.drivers():
                raise RuntimeError("GDAL was loaded before configure_gdal(); import worker before rasterio")


configure_gdal()


# --- the file store, errors and copy ---------------------------------------------------------

def store_root() -> pathlib.Path:
    """The file store root, shared with the API (WORKSPACE_FILES_DIR)."""
    return pathlib.Path(os.environ.get("WORKSPACE_FILES_DIR", "/repo/var/workspace-files"))


class UserFacingError(Exception):
    """An error whose message (Vietnamese, for the user) becomes the job's error as is."""

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


UNSUPPORTED = "Định dạng tệp không được hỗ trợ."
NO_CRS = "Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn."
MAP_GONE = "Bản đồ không còn."
OVER_QUOTA = "Vượt hạn mức dung lượng."
OUT_OF_RANGE = "Toạ độ nằm ngoài phạm vi kinh độ/vĩ độ; hãy kiểm tra hệ toạ độ nguồn."

TITLE_MAX = 200


def import_extension(params: dict) -> str:
    """The upload's extension, lower case: from its original name, else from its store path."""
    for name in (params.get("originalName"), params.get("path")):
        if isinstance(name, str):
            ext = pathlib.PurePosixPath(name.replace("\\", "/")).suffix.lower()
            if ext:
                return ext
    return ""


def resolve_upload(rel: str) -> str:
    """The upload's absolute path; refuses one that is missing or outside the store."""
    root = os.path.realpath(store_root())
    full = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
        raise RuntimeError(f"import file {rel!r} is missing or outside the store")
    return full


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


def file_stem(name: str) -> str:
    return pathlib.PurePosixPath(name.replace("\\", "/")).stem


def layer_title(*candidates) -> str:
    """The first non-blank candidate, trimmed and cut to a layer title's length."""
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c.strip()[:TITLE_MAX]
    raise RuntimeError("no usable layer title")


def crs_label(crs, fallback: str | None) -> str:
    """source_crs of a pyproj CRS: the authority code when pyproj finds one, otherwise the proj4."""
    try:
        auth = crs.to_authority(min_confidence=90)
    except Exception:
        auth = None
    if auth:
        return f"{auth[0]}:{auth[1]}"
    if fallback:
        return fallback
    try:
        return crs.to_proj4()
    except Exception:
        return crs.to_wkt()


# --- the target map ----------------------------------------------------------------------------

def lock_owned_map(cur, map_id, owner_id) -> int:
    """
    Lock the target map for the rest of the job's transaction and return the position after its
    last layer. Fails with MAP_GONE when the map no longer exists, was archived, or is not the
    job owner's.
    """
    cur.execute("SELECT owner_id::text, archived_at FROM workspace.maps WHERE id = %s FOR UPDATE", (map_id,))
    found = cur.fetchone()
    if found is None or found[1] is not None or found[0] != str(owner_id):
        raise UserFacingError(MAP_GONE)
    cur.execute("SELECT COALESCE(max(position), -1) + 1 FROM workspace.map_layers WHERE map_id = %s", (map_id,))
    return cur.fetchone()[0]


def finish_map_write(cur, map_id, owner_id):
    """Bump the map's revision once, then fail with OVER_QUOTA if the owner's usage, with
    everything this job wrote, is over their quota."""
    cur.execute("SELECT workspace.bump_map(%s)", (map_id,))
    cur.execute(
        "SELECT workspace.usage_bytes(id) > quota_bytes FROM app.users WHERE id = %s",
        (owner_id,),
    )
    over = cur.fetchone()
    if over is None or over[0]:
        raise UserFacingError(OVER_QUOTA)
