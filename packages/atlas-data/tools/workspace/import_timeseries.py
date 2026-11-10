"""
Time-series import (S1 Task 6): the `timeseries_import` job. An upload made for the catalogue (a
GeoTIFF or a zip of them, a NetCDF-4 file or a zip of them, a HEC-RAS 2D result .hdf) becomes one
COG per time step in TIMESERIES_DIR/<name>/, published on GeoNode's GeoServer as ImageMosaic
geonode:<name>, registered in GeoNode for its owner, and written to catalogue.resources so the
uploader sees the entry at once (ruling R2). <name> is ts_<first 8 characters of the fileId>.

A HEC-RAS result also gives a peak-depth raster, TIMESERIES_DIR/<name>_peak/<name>_peak.tif: in a
folder of its own beside the mosaic (never inside it, where the mosaic would take it for a step),
published as a single coverage geonode:<name>_peak and registered as a second, `raster` entry.

Steps: read (what the upload holds and the time of each grid), transform (the step COGs; for
HEC-RAS the cell grid on FABDEM and the peak too), publish (GeoServer, GeoNode, the catalogue rows).

GeoServer and GeoNode are reached only through the module attributes publish, publish_single,
unpublish and register (the checks replace them). Neither is transactional, so what the job did
there and on disk is undone through Steps.on_rollback when its transaction does not commit: the
published stores are deleted (never with purge, see geoserver._delete_store), then the files this
job wrote are removed one by one by name and their folders with os.rmdir. A GeoNode registration
that succeeded before such a rollback stays in GeoNode (the bridge never deletes); the catalogue
sync (Task 7) will see it, and a new run of the same upload registers it again under the same ids.
"""
import os
import pathlib
import sys

# tools/, for the timeseries package (it sits beside this folder).
_TOOLS = str(pathlib.Path(__file__).resolve().parent.parent)
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

# workspace_common before rasterio: importing it runs configure_gdal before rasterio registers its
# GDAL drivers. It imports neither worker nor a handler, so there is no import cycle.
from workspace_common import (  # noqa: E402
    NO_CRS, UNSUPPORTED, UserFacingError, file_stem, import_extension, layer_title, resolve_upload,
)

import tempfile  # noqa: E402
import traceback  # noqa: E402
import uuid  # noqa: E402
import zipfile  # noqa: E402

import sqlalchemy  # noqa: E402
from rasterio.transform import array_bounds  # noqa: E402
from rasterio.warp import transform_bounds  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import import_raster  # noqa: E402
import jobs_db  # noqa: E402
from timeseries import cog, dem, geonode_bridge, geoserver, geotiff_series, hecras, netcdf_series, times  # noqa: E402

# The only ways out to GeoServer and GeoNode (replaced by the checks).
publish = geoserver.publish_mosaic
publish_single = geoserver.publish_coverage
unpublish = geoserver.delete_mosaic
register = geonode_bridge.register_dataset

REGISTER_FAILED = "Không đưa được lên Danh mục; thử lại sau."
ALREADY_IN_CATALOGUE = "Tệp này đã được đưa lên Danh mục."
NO_SERIES_IN_ZIP = "Tệp nén không có tệp GeoTIFF hay NetCDF nào."
MIXED_ZIP = "Tệp nén chứa cả GeoTIFF lẫn NetCDF; hãy tải từng loại riêng."
ZIP_TOO_LARGE = "Tệp nén quá lớn khi giải nén."
NOT_NETCDF4 = "Tệp NetCDF phải ở dạng NetCDF-4 (HDF5)."
UNITS_DIFFER = "Các tệp NetCDF ghi đơn vị khác nhau."
BAD_PATTERN = "Mẫu thời gian không hợp lệ."
HDF_LABEL = "nội suy từ .hdf trên FABDEM"
PEAK_TITLE_SUFFIX = " – độ sâu lớn nhất"

DEFAULT_TIMESERIES_DIR = "/repo/var/timeseries"
DEFAULT_GEOSERVER_TIMESERIES_DIR = "/webatlas-timeseries"
TIFF_EXTENSIONS = (".tif", ".tiff")
HDF5_MAGIC = b"\x89HDF\r\n\x1a\n"
# What a zip may hold once unpacked; the upload itself is capped at 2 GiB by the API.
MAX_UNZIPPED_BYTES = 8 * 1024 ** 3
DEM_RES = 30.0
DEFAULT_EVERY = 4  # hourly from HEC-RAS's 15-minute output
WORLD = (-180.0, -90.0, 180.0, 90.0)
# Files GeoServer and mosaic.write_config put in a mosaic folder, besides the steps.
MOSAIC_FILES = ("indexer.properties", "timeregex.properties", "datastore.properties", "sample_image.dat")
# Overall progress: read 0-10, the steps 10-80, publishing after that.
PROGRESS_READ, PROGRESS_STEPS = 10, 80


# --- folders ---------------------------------------------------------------------------------

def timeseries_dir() -> str:
    root = os.environ.get("TIMESERIES_DIR") or DEFAULT_TIMESERIES_DIR
    if not os.path.isabs(root):
        raise RuntimeError(f"TIMESERIES_DIR must be an absolute path, not {root!r}")
    return os.path.realpath(root)


def geoserver_dir() -> str:
    return (os.environ.get("GEOSERVER_TIMESERIES_DIR") or DEFAULT_GEOSERVER_TIMESERIES_DIR).rstrip("/")


def _inside(root: str, path: str) -> str:
    full = os.path.realpath(path)
    if full == root or os.path.commonpath([root, full]) != root:
        raise RuntimeError(f"refusing to touch {path!r}: outside {root}")
    return full


def clear_folder(root: str, folder: str, prefix: str, rmdir: bool):
    """
    Remove, one by one by name, the files of a series folder: those starting with `prefix` that are
    steps or their temporaries (`<prefix>*.tif*`), and the mosaic's own files. Then, when asked,
    the folder itself with os.rmdir; a folder still holding something else is left (and said so).
    Never recursive.
    """
    folder = _inside(root, folder)
    if not os.path.isdir(folder):
        return
    known = set(MOSAIC_FILES) | {f"{prefix}.properties", f"{prefix}.xml"}
    for fname in os.listdir(folder):
        if (fname.startswith(prefix) and ".tif" in fname) or fname in known:
            path = os.path.join(folder, fname)
            if os.path.isfile(path) and not os.path.islink(path):
                os.remove(path)
    if rmdir:
        try:
            os.rmdir(folder)
        except OSError:
            print(f"left {folder}: it holds files this job did not write", flush=True)


class _Work:
    """A temporary folder for unpacked members; its files are removed one by one on close."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="ts-import-")
        self.files = []

    def path(self, ext: str) -> str:
        p = os.path.join(self.dir, f"{len(self.files):05d}{ext}")
        self.files.append(p)
        return p

    def close(self):
        for p in self.files:
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
        try:
            os.rmdir(self.dir)
        except OSError:
            pass


# --- read ------------------------------------------------------------------------------------

def _basename(name: str) -> str:
    return pathlib.PurePosixPath(name.replace("\\", "/")).name


def unpack(path: str, work: _Work) -> list:
    """The GeoTIFF and NetCDF members of a zip as [(member file name, unpacked path)], flat.
    Other members (world files, readme, macOS metadata) are ignored."""
    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise UserFacingError(UNSUPPORTED)
    out, seen, total = [], set(), 0
    with z:
        for info in z.infolist():
            name = _basename(info.filename)
            ext = pathlib.PurePosixPath(name).suffix.lower()
            if info.is_dir() or not name or name.startswith(".") or info.filename.startswith("__MACOSX/"):
                continue
            if ext not in TIFF_EXTENSIONS + (".nc",):
                continue
            if info.flag_bits & 0x1:  # encrypted
                raise UserFacingError(UNSUPPORTED)
            if name in seen:
                raise UserFacingError(f"Tệp nén có hai tệp cùng tên: {name}.")
            seen.add(name)
            total += info.file_size
            if total > MAX_UNZIPPED_BYTES:
                raise UserFacingError(ZIP_TOO_LARGE)
            target = work.path(ext)
            try:
                # ZipExtFile never returns more than the member's recorded size and checks its CRC.
                with z.open(info) as src, open(target, "wb") as dst:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        dst.write(chunk)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError):
                raise UserFacingError(UNSUPPORTED)
            out.append((name, target))
    return out


def detect(params: dict, path: str, work: _Work):
    """(source, [(file name, path)]): source is 'geotiff', 'netcdf' or 'hecras', by extension."""
    ext = import_extension(params)
    shown = _basename(params.get("originalName") or params["path"])
    if ext in TIFF_EXTENSIONS:
        return "geotiff", [(shown, path)]
    if ext == ".nc":
        return "netcdf", [(shown, path)]
    if ext == ".hdf":
        return "hecras", [(shown, path)]
    if ext == ".zip":
        members = unpack(path, work)
        tifs = [m for m in members if pathlib.PurePosixPath(m[0]).suffix.lower() in TIFF_EXTENSIONS]
        ncs = [m for m in members if m[0].lower().endswith(".nc")]
        if tifs and ncs:
            raise UserFacingError(MIXED_ZIP)
        if not members:
            raise UserFacingError(NO_SERIES_IN_ZIP)
        return ("geotiff", tifs) if tifs else ("netcdf", ncs)
    raise UserFacingError(UNSUPPORTED)


def read_geotiffs(files: list, params: dict) -> list:
    """[(path, time)] sorted by time; every file a georeferenced GeoTIFF with a CRS and one time."""
    for _, p in files:
        import_raster.check_magic(p)
        with import_raster.open_source(p) as src:
            if src.transform.is_identity:
                raise UserFacingError(UNSUPPORTED)
            if not src.crs:
                raise UserFacingError(NO_CRS)
    pattern = params.get("timePattern") or None
    if pattern is not None and pattern not in times.PATTERNS:
        raise UserFacingError(BAD_PATTERN)
    csv_times = None
    if params.get("timesCsvPath"):
        with open(resolve_upload(params["timesCsvPath"]), "rb") as f:
            csv_times = times.times_from_csv(f.read().decode("utf-8-sig", "replace"))
    by_name = dict(files)
    return [(by_name[n], t) for n, t in times.assign_times(list(by_name), pattern, csv_times)]


def read_netcdfs(files: list) -> tuple:
    """(paths ordered by their first time, unit). Two grids with the same time fail the series."""
    described, seen, units = [], {}, set()
    for shown, p in files:
        with open(p, "rb") as f:
            if f.read(8) != HDF5_MAGIC:
                raise UserFacingError(NOT_NETCDF4)
        d = netcdf_series.describe(p)
        for t in d["times"]:
            if t in seen:
                raise UserFacingError(f"Trùng thời điểm {t.isoformat()}: {seen[t]}, {shown}")
            seen[t] = shown
        units.add(d["unit"])
        if d["times"]:
            described.append((min(d["times"]), p))
    if len(units) > 1:
        raise UserFacingError(UNITS_DIFFER)
    if not described:
        raise UserFacingError(netcdf_series.NO_VARIABLE)
    return [p for _, p in sorted(described)], (units.pop() or None)


# --- transform -------------------------------------------------------------------------------

class Extent:
    """The union of the steps' extents in EPSG:4326."""

    def __init__(self):
        self.box = None

    def add(self, step):
        h, w = step.array.shape
        b = transform_bounds(step.crs, "EPSG:4326", *array_bounds(h, w, step.transform), densify_pts=21)
        self.box = b if self.box is None else (
            min(self.box[0], b[0]), min(self.box[1], b[1]), max(self.box[2], b[2]), max(self.box[3], b[3]))

    def value(self):
        return [float(v) for v in self.box]


def write_steps(step_iter, total: int, root: str, folder: str, name: str, steps) -> tuple:
    """Write every step as a COG in folder; ([times], [w, s, e, n]). Files are removed on rollback."""
    if os.path.isdir(folder):
        # A run that was stopped before its rollback could run: start the folder afresh.
        clear_folder(root, folder, name, rmdir=False)
    steps.on_rollback(lambda: clear_folder(root, folder, name, rmdir=True))
    written, extent = [], Extent()
    for step in step_iter:
        cog.write_step(step, folder, name)
        extent.add(step)
        written.append(step.time)
        steps.progress(PROGRESS_READ + (PROGRESS_STEPS - PROGRESS_READ) * len(written) / max(total, len(written)))
    return written, extent.value()


def dem_for(ras, area: str):
    """FABDEM on the area's 30 m grid, asserted to be the cell grid (hecras.area_grid)."""
    transform, shape = hecras.area_grid(ras, area, DEM_RES)
    engine = sqlalchemy.create_engine("postgresql+psycopg2://", creator=jobs_db.connect, poolclass=NullPool)
    try:
        with engine.connect() as c:
            arr, dem_transform = dem.read_dem(c, ras.extent(area), ras.crs_wkt, DEM_RES)
    finally:
        engine.dispose()
    # The 30 m grid formula exists in both dem.read_dem and hecras.area_grid: depth is WSE minus
    # DEM pixel by pixel, so both must be the same grid.
    if arr.shape != tuple(shape) or dem_transform != transform:
        raise RuntimeError(f"DEM grid {arr.shape} {dem_transform} differs from the cell grid {shape} {transform}")
    return arr, transform


# --- publish ---------------------------------------------------------------------------------

_UPSERT = """
    INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub,
                                     managing_unit, is_published, is_approved, variable, unit, time_steps,
                                     bbox4326, origin)
    VALUES (%(pk)s, %(uuid)s, %(alternate)s, %(kind)s, %(title)s, %(abstract)s, %(owner_sub)s,
            catalogue.unit_for_bbox(%(w)s, %(s)s, %(e)s, %(n)s), false, false, %(variable)s, %(unit)s,
            %(time_steps)s::timestamptz[], %(bbox)s::float8[], 'webatlas-upload')
    -- A sync may have inserted the GeoNode resource already (a run registered it, then rolled back).
    -- The worker knows the series; publication stays as GeoNode says.
    ON CONFLICT (geonode_pk) DO UPDATE SET
      geonode_uuid = EXCLUDED.geonode_uuid, alternate = EXCLUDED.alternate, kind = EXCLUDED.kind,
      title = EXCLUDED.title, abstract = EXCLUDED.abstract, owner_sub = EXCLUDED.owner_sub,
      managing_unit = EXCLUDED.managing_unit, variable = EXCLUDED.variable, unit = EXCLUDED.unit,
      time_steps = EXCLUDED.time_steps, bbox4326 = EXCLUDED.bbox4326, origin = EXCLUDED.origin,
      updated_at = now()
    RETURNING id::text
"""


def write_row(cur, reg: dict, kind: str, title: str, abstract: str, owner_sub, variable, unit, time_steps, bbox):
    w, s, e, n = bbox
    cur.execute(_UPSERT, {
        "pk": int(reg["pk"]), "uuid": str(reg["uuid"]), "alternate": reg["alternate"], "kind": kind,
        "title": title, "abstract": abstract, "owner_sub": owner_sub, "w": w, "s": s, "e": e, "n": n,
        "variable": variable, "unit": unit, "time_steps": time_steps, "bbox": bbox,
    })
    return cur.fetchone()[0]


# --- the handler -----------------------------------------------------------------------------

def run_timeseries_import(conn, job, steps) -> dict:
    params = job["params"]
    file_id = str(uuid.UUID(params["fileId"]))
    name = f"ts_{file_id[:8]}"
    owner = params["owner"]
    original_name = params.get("originalName") or params["path"]
    title = layer_title(params.get("title"), file_stem(original_name))
    abstract = params.get("abstract") or ""
    every = params.get("every")
    every = every if isinstance(every, int) and not isinstance(every, bool) and every >= 1 else DEFAULT_EVERY
    clip = tuple(params.get("clip4326") or WORLD)
    root = timeseries_dir()
    folder = _inside(root, os.path.join(root, name))

    # --- read
    steps.start("read")
    with conn.cursor() as cur:
        # One run per upload at a time, until this job's transaction ends.
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"timeseries_import:{name}",))
        cur.execute("SELECT 1 FROM catalogue.resources WHERE alternate = %s AND origin = 'webatlas-upload'",
                    (f"geonode:{name}",))
        if cur.fetchone():
            raise UserFacingError(ALREADY_IN_CATALOGUE)
    work = _Work()
    try:
        source, files = detect(params, resolve_upload(params["path"]), work)
        peak = None
        if source == "geotiff":
            series = read_geotiffs(files, params)
            variable, unit, entry_title = "value", None, title
            steps.progress(PROGRESS_READ)
            steps.done("read")
            steps.start("transform")
            time_steps, bbox = write_steps(geotiff_series.read_series(series), len(series), root, folder, name, steps)
            steps.done("transform")
        elif source == "netcdf":
            paths, unit = read_netcdfs(files)
            variable = "rain" if unit and "mm" in unit.lower() else "value"
            entry_title = title
            steps.progress(PROGRESS_READ)
            steps.done("read")
            steps.start("transform")
            total = sum(len(netcdf_series.describe(p)["times"]) for p in paths)
            grids = (s for p in paths for s in netcdf_series.read_cf(p, clip))
            time_steps, bbox = write_steps(grids, total, root, folder, name, steps)
            steps.done("transform")
        else:
            variable, unit, entry_title = "depth", "m", f"{title} ({HDF_LABEL})"
            with hecras.RasFile(files[0][1]) as ras:
                area = hecras.pick_area(ras, params.get("hdfArea") or None)
                ras_times = ras.times  # a geometry-only file fails here, with its own message
                dem_arr, transform = dem_for(ras, area)
                steps.progress(PROGRESS_READ)
                steps.done("read")

                steps.start("transform")
                grid = hecras.cell_index_grid(ras, area, transform, dem_arr.shape)  # once, for both
                total = len(range(0, len(ras_times), every))
                time_steps, bbox = write_steps(hecras.depth_steps(ras, area, dem_arr, transform, every, grid=grid),
                                               total, root, folder, name, steps)
                peak_name = f"{name}_peak"
                peak_folder = _inside(root, os.path.join(root, peak_name))
                if os.path.isdir(peak_folder):
                    clear_folder(root, peak_folder, peak_name, rmdir=False)
                steps.on_rollback(lambda: clear_folder(root, peak_folder, peak_name, rmdir=True))
                written = cog.write_step(hecras.peak_depth(ras, area, dem_arr, transform, grid=grid),
                                         peak_folder, peak_name)
                os.replace(written, os.path.join(peak_folder, f"{peak_name}.tif"))
                peak = peak_name
            steps.done("transform")
    finally:
        work.close()
    steps.progress(PROGRESS_STEPS)

    # --- publish
    steps.start("publish")
    try:
        steps.on_rollback(lambda: unpublish(name))
        alternate = publish(name, variable)
        reg = register(name, entry_title, abstract, owner)
        peak_reg = None
        if peak:
            steps.on_rollback(lambda: unpublish(peak))
            peak_alternate = publish_single(peak, f"{geoserver_dir()}/{peak}/{peak}.tif", variable)
            peak_reg = register(peak, f"{title}{PEAK_TITLE_SUFFIX}", abstract, owner)
            peak_reg = {**peak_reg, "alternate": peak_reg.get("alternate") or peak_alternate}
    except UserFacingError:
        raise
    except Exception as e:
        traceback.print_exc(file=sys.stdout)
        raise UserFacingError(REGISTER_FAILED) from e
    reg = {**reg, "alternate": reg.get("alternate") or alternate}

    with conn.cursor() as cur:
        resource_id = write_row(cur, reg, "timeseries", entry_title, abstract, owner.get("sub"),
                                variable, unit, time_steps, bbox)
        if peak_reg is not None:
            write_row(cur, peak_reg, "raster", f"{title}{PEAK_TITLE_SUFFIX}", abstract, owner.get("sub"),
                      variable, unit, None, bbox)
    steps.done("publish")
    return {"resourceId": resource_id, "alternate": reg["alternate"], "steps": len(time_steps)}
