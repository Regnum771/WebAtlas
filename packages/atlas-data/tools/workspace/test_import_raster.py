"""
Checks for import_raster.py (P3b Task 7): an uploaded GeoTIFF becomes a Cloud-Optimized GeoTIFF in
EPSG:3857 and a raster layer of a personal map.

No pytest (see flood_scenario/test_depth.py). Runs inside the atlas-tools image against the dev
database (DATABASE_URL):

    python3 packages/atlas-data/tools/workspace/test_import_raster.py

Fixtures are generated here with rasterio into a temp store (nothing binary is committed). Every
check creates its own app.users row and map (deleting the user cascades to maps, layers, files rows
and jobs) and claims only its own job ids, so a live worker or another suite's queue is untouched.
"""
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile
import uuid
import warnings

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# worker first: it configures GDAL (skipped drivers, no network) before rasterio registers its drivers.
import worker  # noqa: E402
import jobs_db  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.enums import ColorInterp  # noqa: E402
from rasterio.errors import NotGeoreferencedWarning  # noqa: E402
from rasterio.transform import from_bounds  # noqa: E402
from pyproj import Transformer  # noqa: E402

# A fixture without georeferencing is deliberate.
warnings.simplefilter("ignore", NotGeoreferencedWarning)

# Copied verbatim from packages/shared/src/crs.ts: tm3('da-nang', ..., 107.75) with VN2000_DATUM.
VN2000_TM3_DA_NANG = (
    "+proj=tmerc +lat_0=0 +lon_0=107.75 +k=0.9999 +x_0=500000 +y_0=0 "
    "+ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 "
    "+units=m +no_defs"
)
KNOWN_LON, KNOWN_LAT = 108.2022, 16.0544
# A transverse Mercator far from the image (central meridian 125 E): its grid is turned in EPSG:3857.
SKEWED_TM = "+proj=tmerc +lat_0=0 +lon_0=125 +k=1 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs"

MSG_NO_CRS = "Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn."
MSG_MAP_GONE = "Bản đồ không còn."
MSG_QUOTA = "Vượt hạn mức dung lượng."
MSG_UNSUPPORTED = "Định dạng tệp không được hỗ trợ."

STEPS = [
    {"key": "read", "label": "Đọc tệp", "status": "pending"},
    {"key": "transform", "label": "Chuyển hệ toạ độ", "status": "pending"},
    {"key": "write", "label": "Ghi vào bản đồ", "status": "pending"},
]

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


# --- the worker's store, in a temp directory ------------------------------------------------

STORE = tempfile.mkdtemp(prefix="p3b-raster-store-")
os.environ["WORKSPACE_FILES_DIR"] = STORE


def store(*parts):
    return os.path.join(STORE, *parts)


def remove_files_in(directory):
    """Remove the regular files directly inside directory one by one, then the directory if empty."""
    real = os.path.realpath(directory)
    if not os.path.isdir(real):
        return
    for name in os.listdir(real):
        path = os.path.realpath(os.path.join(real, name))
        if os.path.dirname(path) == real and os.path.isfile(path):
            os.remove(path)
    try:
        os.rmdir(real)
    except OSError:
        pass  # something unexpected is left; leave the directory rather than recurse


def cog_files(user_id):
    """The names in the user's COG directory (cog/<ownerId>/), or [] when it does not exist."""
    d = store("cog", str(user_id))
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


def pattern(height, width, count=1, dtype="uint8"):
    """Distinct, non-zero pixel values, so a sample tells where it came from."""
    rows, cols = np.mgrid[0:height, 0:width]
    band = ((rows * 7 + cols * 3) % 251 + 1).astype(dtype)
    return np.stack([band + i for i in range(count)]).astype(dtype)


def geotiff(name, *, crs="EPSG:4326", bounds=(108.0, 15.9, 108.064, 15.964), width=64, height=64,
            count=1, dtype="uint8", nodata=None, data=None, georeferenced=True, colorinterp=None):
    profile = {"driver": "GTiff", "width": width, "height": height, "count": count, "dtype": dtype}
    if crs is not None:
        profile["crs"] = crs
    if georeferenced:
        profile["transform"] = from_bounds(*bounds, width, height)
    if nodata is not None:
        profile["nodata"] = nodata
    with rasterio.open(store(name), "w", **profile) as dst:
        dst.write(pattern(height, width, count, dtype) if data is None else data)
        if colorinterp:
            dst.colorinterp = colorinterp
    return name


# --- database --------------------------------------------------------------------------------

conn = jobs_db.connect()
watch = jobs_db.connect(autocommit=True)  # an observer outside every transaction under test
users = []


def q(sql, args=()):
    with watch.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None


def new_map(tag):
    email = f"p3b-raster-{tag}-{uuid.uuid4().hex[:8]}@webatlas.test"
    user_id = q("INSERT INTO app.users (email, password_hash, role) VALUES (%s, 'x', 'viewer') RETURNING id", (email,))[0][0]
    users.append(user_id)
    map_id = q("INSERT INTO workspace.maps (owner_id, title) VALUES (%s, 'P3b raster') RETURNING id", (user_id,))[0][0]
    return user_id, map_id


def run_import(user_id, map_id, rel_path, original_name, **overrides):
    params = {
        "fileId": str(uuid.uuid4()),
        "path": rel_path,
        "originalName": original_name,
        "mapId": str(map_id),
        "ownerId": str(user_id),
        "maxRows": 200000,
        "sourceCrs": None,
        **overrides,
    }
    job_id = q(
        """INSERT INTO workspace.jobs (owner_id, map_id, kind, params, steps)
           VALUES (%s, %s, 'import', %s, %s) RETURNING id""",
        (user_id, map_id, json.dumps(params), json.dumps(STEPS)),
    )[0][0]
    worker.run_once(conn, only_ids=[job_id])
    with watch.cursor() as cur:
        cur.execute("SELECT status, error, result, steps, progress FROM workspace.jobs WHERE id = %s", (job_id,))
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, cur.fetchone()))


def layers(map_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT id::text, kind, title, position, style, geometry_type, fields, file_id::text, raster
                 FROM workspace.map_layers WHERE map_id = %s ORDER BY position""",
            (map_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def cog_rows(user_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT id::text, path, original_name, content_type, size_bytes, delete_after
                 FROM workspace.files WHERE owner_id = %s AND kind = 'cog' ORDER BY created_at""",
            (user_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def revision(map_id):
    return q("SELECT revision FROM workspace.maps WHERE id = %s", (map_id,))[0][0]


def close_to(a, b, tol):
    return a is not None and len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def sample_match(cog_path, src_path, src_crs):
    """
    The share of the COG's valid pixels whose value is the source pixel under the COG pixel's
    centre (nearest neighbour), found by transforming each centre back into the source.
    """
    with rasterio.open(cog_path) as cog, rasterio.open(src_path) as src:
        got = cog.read(1)
        want = src.read(1)
        back = Transformer.from_crs("EPSG:3857", src_crs, always_xy=True)
        rows, cols = np.mgrid[0:cog.height, 0:cog.width]
        xs, ys = rasterio.transform.xy(cog.transform, rows.ravel(), cols.ravel(), offset="center")
        sx, sy = back.transform(np.asarray(xs), np.asarray(ys))
        inv = ~src.transform
        c, r = inv * (sx, sy)
        r, c = np.floor(r).astype(int), np.floor(c).astype(int)
        inside = (r >= 0) & (r < src.height) & (c >= 0) & (c < src.width)
        g = got.ravel()[inside]
        w = want[r[inside], c[inside]]
        return (g == w).mean() if inside.any() else 0.0, int(inside.sum())


import import_raster  # noqa: E402

try:
    # --- a geotiff becomes a 3857 COG with metadata
    user_id, map_id = new_map("cog")
    src_name = geotiff("anh.tif")
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, src_name, "Ảnh vệ tinh.tif")
    ls = layers(map_id)
    files = cog_rows(user_id)
    layer = ls[0] if ls else {}
    meta = layer.get("raster") or {}
    check("a geotiff becomes a 3857 COG: the job succeeds", row["status"] == "succeeded" and row["error"] is None)
    check("a geotiff import: the result names the layer and zero rows",
          row["result"] == {"layerIds": [layer.get("id")], "rows": 0})
    check("a geotiff import: one raster layer titled after the file, linked to the COG's files row",
          len(ls) == 1 and layer["kind"] == "raster" and layer["title"] == "Ảnh vệ tinh"
          and len(files) == 1 and layer["file_id"] == files[0]["id"])
    f = files[0] if files else {}
    check("a geotiff import: the files row is a cog at cog/<ownerId>/<fileId>.tif",
          f.get("path") == f"cog/{user_id}/{f.get('id')}.tif" and f.get("content_type") == "image/tiff"
          and f.get("delete_after") is None and f.get("original_name") == "Ảnh vệ tinh.tif")
    cog_path = store(f["path"]) if f else ""
    check("a geotiff import: the COG is on disk with the recorded size",
          bool(f) and os.path.isfile(cog_path) and os.path.getsize(cog_path) == f["size_bytes"])
    check("a geotiff import: nothing but the COG is left in the owner's COG directory",
          cog_files(user_id) == [f"{f.get('id')}.tif"])
    check("a geotiff import: the original upload is kept", os.path.isfile(store(src_name)))
    if os.path.isfile(cog_path):
        with rasterio.open(cog_path) as cog:
            check("a geotiff becomes a 3857 COG with metadata: driver GTiff, EPSG:3857, overviews",
                  cog.driver == "GTiff" and cog.crs.to_epsg() == 3857 and len(cog.overviews(1)) >= 1)
            check("the COG is a cloud-optimized, DEFLATE-compressed tiff",
                  cog.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
                  and cog.tags(ns="IMAGE_STRUCTURE").get("COMPRESSION") == "DEFLATE")
            check("raster metadata: width, height, bands, dtype, nodata match the COG",
                  meta.get("width") == cog.width and meta.get("height") == cog.height and meta.get("bands") == 1
                  and meta.get("dtype") == "uint8" and "nodata" in meta and meta["nodata"] is None)
    else:
        check("a geotiff becomes a 3857 COG with metadata: driver GTiff, EPSG:3857, overviews", False)
    check("raster metadata: exactly the documented keys",
          set(meta) == {"width", "height", "bands", "dtype", "nodata", "bounds4326", "sourceCrs", "stats"})
    check("raster.bounds4326 is within 1e-6 of the input bounds",
          close_to(meta.get("bounds4326"), [108.0, 15.9, 108.064, 15.964], 1e-6))
    check("raster.sourceCrs is the file's authority code", meta.get("sourceCrs") == "EPSG:4326")
    check("a geotiff import: the map revision is bumped once", revision(map_id) == rev0 + 1)
    check("a geotiff import: every step is done", [s["status"] for s in row["steps"]] == ["done"] * 3)
    if os.path.isfile(cog_path):
        share, n = sample_match(cog_path, store(src_name), "EPSG:4326")
        check(f"the COG samples the source at the right place ({share:.4f} of {n} pixels)", share > 0.99 and n > 3000)

    # --- a tiff without crs needs a source crs
    user_id, map_id = new_map("nocrs")
    to_tm3 = Transformer.from_crs("EPSG:4326", VN2000_TM3_DA_NANG, always_xy=True)
    x, y = to_tm3.transform(KNOWN_LON, KNOWN_LAT)
    tm3_name = geotiff("tm3.tif", crs=None, bounds=(x - 320, y - 320, x + 320, y + 320))
    with rasterio.open(store(tm3_name)) as probe:
        check("fixture: the TM-3 tiff has no CRS", probe.crs is None)
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, tm3_name, "tm3.tif")
    check("a tiff without crs needs a source crs: the job fails with the exact copy",
          row["status"] == "failed" and row["error"] == MSG_NO_CRS)
    check("a tiff without crs: nothing is written",
          layers(map_id) == [] and cog_rows(user_id) == [] and cog_files(user_id) == [] and revision(map_id) == rev0)
    # With the source CRS chosen, warped in small chunks so that seams between chunks are exercised.
    chunk = import_raster.CHUNK
    import_raster.CHUNK = 24
    try:
        row = run_import(user_id, map_id, tm3_name, "tm3.tif",
                         sourceCrs={"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG})
    finally:
        import_raster.CHUNK = chunk
    ls = layers(map_id)
    meta = ls[0]["raster"] if ls else {}
    b = meta.get("bounds4326") or [0, 0, 0, 0]
    check("with sourceCrs the TM-3 tiff imports", row["status"] == "succeeded" and len(ls) == 1)
    check("with sourceCrs the TM-3 tiff lands around the known point",
          abs((b[0] + b[2]) / 2 - KNOWN_LON) < 1e-4 and abs((b[1] + b[3]) / 2 - KNOWN_LAT) < 1e-4)
    check("the source CRS of a chosen proj4 is recorded as that proj4", meta.get("sourceCrs") == VN2000_TM3_DA_NANG)
    files = cog_rows(user_id)
    if files:
        share, n = sample_match(store(files[0]["path"]), store(tm3_name), VN2000_TM3_DA_NANG)
        check(f"a raster warped in chunks samples the source at the right place ({share:.4f} of {n} pixels)",
              share > 0.99 and n > 3000)
    else:
        check("a raster warped in chunks samples the source at the right place", False)

    # --- nodata, float NaN and an alpha band survive the warp
    user_id, map_id = new_map("nodata")
    data = pattern(64, 64, 1, "float32")
    data[0, :8, :8] = np.nan
    run_import(user_id, map_id, geotiff("nan.tif", dtype="float32", nodata=float("nan"), data=data), "nan.tif")
    run_import(user_id, map_id, geotiff("u16.tif", dtype="uint16", nodata=65535), "u16.tif")
    rgba = pattern(64, 64, 4)
    rgba[3] = 255
    rgba[3, :, :10] = 0
    run_import(user_id, map_id, geotiff("rgba.tif", count=4, data=rgba,
                                        colorinterp=[ColorInterp.red, ColorInterp.green, ColorInterp.blue,
                                                     ColorInterp.alpha]), "rgba.tif")
    ls = layers(map_id)
    metas = [l["raster"] for l in ls]
    check("a float raster with NaN nodata records nodata as \"NaN\"",
          len(metas) == 3 and metas[0]["dtype"] == "float32" and metas[0]["nodata"] == "NaN")
    check("an integer nodata is kept", len(metas) == 3 and metas[1]["dtype"] == "uint16" and metas[1]["nodata"] == 65535)
    files = cog_rows(user_id)
    if len(files) == 3:
        with rasterio.open(store(files[1]["path"])) as cog:
            check("the COG carries the source's nodata", cog.nodata == 65535)
        with rasterio.open(store(files[2]["path"])) as cog:
            alpha = cog.read(4)
            check("an RGBA raster keeps four bands and its alpha band",
                  metas[2]["bands"] == 4 and cog.colorinterp[3] == ColorInterp.alpha
                  and (alpha == 0).any() and (alpha == 255).any())
    else:
        check("the COG carries the source's nodata", False)

    # --- transparent warped edges: an image in a transverse Mercator centred 17 degrees east is turned
    # about 4.6 degrees in EPSG:3857, so the COG's corners lie outside it and hold only the warp's fill
    user_id, map_id = new_map("alpha")
    to_skewed = Transformer.from_crs("EPSG:4326", SKEWED_TM, always_xy=True)
    sx, sy = to_skewed.transform(KNOWN_LON, KNOWN_LAT)
    skewed = (sx - 3200, sy - 3200, sx + 3200, sy + 3200)
    rgb = pattern(64, 64, 3)
    run_import(user_id, map_id, geotiff("tm_rgb.tif", crs=SKEWED_TM, bounds=skewed, count=3, data=rgb), "tm_rgb.tif")
    dem = pattern(64, 64, 1, "float32") * 10
    dem[0, 20:30, 20:30] = -9999
    run_import(user_id, map_id, geotiff("tm_dem.tif", crs=SKEWED_TM, bounds=skewed, dtype="float32", nodata=-9999,
                                        data=dem), "tm_dem.tif")
    # Not 8-bit and without nodata: GDAL makes no mask of a uint16 alpha band, yet its 0s are transparent.
    run_import(user_id, map_id, geotiff("tm_u16.tif", crs=SKEWED_TM, bounds=skewed, dtype="uint16",
                                        data=pattern(64, 64, 1, "uint16") * 100), "tm_u16.tif")
    ls = layers(map_id)
    files = cog_rows(user_id)
    metas = [l["raster"] for l in ls]
    if len(files) == 3:
        with rasterio.open(store(files[0]["path"])) as cog:
            alpha = cog.read(cog.count)
            corners = [alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]]
            check("a source without nodata or alpha gets an alpha band; its corners are transparent after warping",
                  cog.count == 4 and cog.colorinterp[3] == ColorInterp.alpha and cog.nodata is None
                  and all(c == 0 for c in corners) and alpha[cog.height // 2, cog.width // 2] == 255
                  and metas[0]["bands"] == 3)
        with rasterio.open(store(files[1]["path"])) as cog:
            check("a source with nodata gets no alpha band: its nodata marks the edges",
                  cog.count == 1 and cog.nodata == -9999 and cog.read(1)[0, 0] == -9999)
    else:
        check("a source without nodata or alpha gets an alpha band; its corners are transparent after warping", False)

    # --- per-band value range, from the smallest overview, without nodata or transparent pixels
    def stats_ok(stats, want_bands, lo, hi):
        return (isinstance(stats, list) and len(stats) == want_bands
                and all(set(s) == {"min", "max"} and lo <= s["min"] <= s["max"] <= hi for s in stats))
    stats = [m.get("stats") for m in metas]
    rgb_stats = stats[0] if stats else None
    check("stats hold one min/max per data band and exclude nodata",
          len(stats) == 3
          # RGB: three data bands (not the added alpha); the warp's 0 fill is transparent, not a value.
          and stats_ok(rgb_stats, 3, 1, 253) and all(s["min"] > 0 for s in rgb_stats)
          and rgb_stats[2]["max"] > rgb_stats[0]["min"]
          # Float with nodata -9999: the nodata block and edges are left out.
          and stats_ok(stats[1], 1, 10, 2510) and stats[1][0]["max"] > stats[1][0]["min"]
          # uint16 with an added alpha band: its 0 fill is left out too.
          and stats_ok(stats[2], 1, 100, 25100) and stats[2][0]["max"] > stats[2][0]["min"])
    user_id, map_id = new_map("rgba")
    rgba = pattern(64, 64, 4)
    rgba[3] = 255
    rgba[3, :, :10] = 0
    rgba[0, :, :10] = 0  # what a transparent pixel holds must not count
    run_import(user_id, map_id, geotiff("rgba2.tif", count=4, data=rgba,
                                        colorinterp=[ColorInterp.red, ColorInterp.green, ColorInterp.blue,
                                                     ColorInterp.alpha]), "rgba2.tif")
    ls = layers(map_id)
    rgba_stats = ls[0]["raster"].get("stats") if ls else None
    check("an RGBA source has stats for its three colour bands; pixels its alpha hides are left out",
          stats_ok(rgba_stats, 3, 1, 254) and rgba_stats[0]["min"] > 0 and ls[0]["raster"]["bands"] == 4)

    # --- content that is not a GeoTIFF is refused before GDAL picks a driver
    user_id, map_id = new_map("content")
    vrt = (f'<VRTDataset rasterXSize="64" rasterYSize="64"><VRTRasterBand dataType="Byte" band="1">'
           f'<SimpleSource><SourceFilename>{store(src_name)}</SourceFilename><SourceBand>1</SourceBand>'
           f'</SimpleSource></VRTRasterBand></VRTDataset>')
    with open(store("tan_cong.tif"), "w", encoding="utf-8") as fh:
        fh.write(vrt)
    with open(store("anh.png.tif"), "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    with open(store("cut.tif"), "wb") as fh:
        fh.write(b"II*\x00" + b"\x00" * 4)
    for name, label in (("tan_cong.tif", "VRT XML named .tif"), ("anh.png.tif", "a PNG named .tif"),
                        ("cut.tif", "a truncated TIFF")):
        row = run_import(user_id, map_id, name, name)
        check(f"{label} is refused", row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED)
    plain = geotiff("phang.tif", crs=None, georeferenced=False)
    row = run_import(user_id, map_id, plain, plain, sourceCrs={"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG})
    check("a TIFF without georeferencing is refused even with a source CRS",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED)
    check("refused content writes nothing", layers(map_id) == [] and cog_rows(user_id) == [] and cog_files(user_id) == [])

    # --- over the quota, everything is rolled back and the COG is removed
    user_id, map_id = new_map("quota")
    q("UPDATE app.users SET quota_bytes = 10 WHERE id = %s", (user_id,))
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, src_name, "anh.tif")
    check("a raster import over the quota fails with the exact copy",
          row["status"] == "failed" and row["error"] == MSG_QUOTA)
    check("a raster import over the quota leaves no layer, no files row and no file on disk",
          layers(map_id) == [] and cog_rows(user_id) == [] and cog_files(user_id) == [] and revision(map_id) == rev0)

    # --- importing into an archived map fails with Bản đồ không còn.
    user_id, map_id = new_map("archived")
    q("UPDATE workspace.maps SET archived_at = now() WHERE id = %s", (map_id,))
    row = run_import(user_id, map_id, src_name, "anh.tif")
    check("a raster import into an archived map fails with Bản đồ không còn. and leaves no file",
          row["status"] == "failed" and row["error"] == MSG_MAP_GONE and layers(map_id) == [] and cog_files(user_id) == [])

    # --- a job that cannot be marked succeeded (failed as stale meanwhile) leaves no COG behind
    user_id, map_id = new_map("stale")
    original_succeed = jobs_db.succeed
    jobs_db.succeed = lambda c, job_id, result: False
    try:
        run_import(user_id, map_id, src_name, "anh.tif")
    finally:
        jobs_db.succeed = original_succeed
    check("a COG whose job does not commit is removed from disk",
          layers(map_id) == [] and cog_rows(user_id) == [] and cog_files(user_id) == [])

    # --- GDAL is configured to open no VRT and fetch nothing, in rasterio's GDAL too
    with rasterio.Env() as env:
        drivers = env.drivers()
    check("rasterio's GDAL skips the drivers the worker never needs",
          not any(d in drivers for d in ("VRT", "WMS", "WMTS", "HTTP")) and "GTiff" in drivers and "COG" in drivers)
    check("PROJ network access is off", os.environ.get("PROJ_NETWORK") == "OFF"
          and worker.GDAL_CONFIG.get("PROJ_NETWORK") == "OFF")
    clean_env = {k: v for k, v in os.environ.items() if k not in worker.GDAL_CONFIG}
    probe = subprocess.run(
        [sys.executable, "-c", "import rasterio\nwith rasterio.Env():\n    pass\nimport worker"],
        cwd=str(HERE), env=clean_env, capture_output=True, text=True, timeout=120,
    )
    check("configure_gdal refuses to run after rasterio's GDAL was loaded",
          probe.returncode != 0 and "RuntimeError" in probe.stderr and "rasterio" in probe.stderr)
finally:
    conn.rollback()
    for uid in users:
        q("DELETE FROM app.users WHERE id = %s", (uid,))
        remove_files_in(store("cog", str(uid)))
    conn.close()
    watch.close()
    try:
        os.rmdir(store("cog"))
    except OSError:
        pass
    remove_files_in(STORE)

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
