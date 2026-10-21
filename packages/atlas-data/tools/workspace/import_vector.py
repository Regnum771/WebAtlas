"""
Vector import (P3b Task 6): the `import` job for a GeoPackage, GeoJSON, zipped Shapefile or KML
upload. Every layer of the file is read with GDAL (pyogrio), reprojected to EPSG:4326 2D, and
written into the user's personal map as a free layer whose features keep every original column in
`properties`.

Steps: read (list and read the layers, check the row limit), transform (CRS, 2D, skip rows without
geometry), write (map layers and features, revision, quota). All database writes go through the
handler's connection, inside the worker's one transaction, so any failure (row limit, missing CRS,
archived map, quota) leaves the map untouched.

Zipped Shapefiles are read in place through GDAL's /vsizip/: nothing is extracted to disk. The
archive's entry names are listed with zipfile to find the .shp members and skip unsafe entries
(absolute names, names containing '..', symlinks); the only bytes Python reads from an entry are
the 4-byte header of each .shp (the magic check) and a tiny .cpg, in memory.

GDAL picks its driver from a file's content, and some drivers open whatever the content names
(an <OGRVRTDataSource> in a ".geojson" reads another user's file; WFS/WMS descriptions fetch
URLs). So a file is only read when its content matches its extension (check_magic), GDAL opened it
with that extension's driver (check_driver), and the worker has skipped the dangerous drivers and
the network (worker.configure_gdal). Anything else is "Định dạng tệp không được hỗ trợ.".
"""
import base64
import codecs
import datetime
import decimal
import json
import math
import os
import pathlib
import unicodedata
import zipfile
from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd
import psycopg2.extras
import pyogrio
import shapely
from pyogrio.errors import DataSourceError
from pyproj import CRS

from worker import UserFacingError, import_extension, store_root

TOO_MANY_ROWS = "Tệp có hơn 200.000 dòng."
NO_CRS = "Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn."
MAP_GONE = "Bản đồ không còn."
OVER_QUOTA = "Vượt hạn mức dung lượng."
UNSUPPORTED = "Định dạng tệp không được hỗ trợ."


OUT_OF_RANGE = "Toạ độ nằm ngoài phạm vi kinh độ/vĩ độ; hãy kiểm tra hệ toạ độ nguồn."


def skipped_message(n: int) -> str:
    return f"Bỏ qua {n} dòng không có hình học."


def empty_layer_message(name: str) -> str:
    return f'Bỏ qua lớp "{name}" vì không có hình học.'


def _within_lon_lat(geoms) -> bool:
    """Every geometry's bounds are finite and inside lon [-180, 180] / lat [-90, 90]."""
    if len(geoms) == 0:
        return True
    b = shapely.bounds(geoms)  # (n, 4): xmin, ymin, xmax, ymax
    return bool(np.isfinite(b).all()
                and (b[:, 0] >= -180).all() and (b[:, 2] <= 180).all()
                and (b[:, 1] >= -90).all() and (b[:, 3] <= 90).all())


# The table a GeoPackage exported by this app carries (export_vector.py, Task 8).
METADATA_TABLE = "webatlas_metadata"
# Features are inserted this many at a time, with a progress update between batches, so no single
# call holds the GIL long enough to starve the heartbeat thread.
BATCH_ROWS = 1000
TITLE_MAX = 200
# A .cpg holds a code page name ("UTF-8", "1258"); anything longer is not one.
CPG_MAX_BYTES = 64
# Overall progress: reading 0-30, transforming 30-40, writing 40-100.
PROGRESS_READ, PROGRESS_TRANSFORM, PROGRESS_WRITE = 30, 40, 100

# Content checks (check_magic) and the only GDAL driver each extension may be read with (check_driver).
MAGIC_READ_BYTES = 64 * 1024
SQLITE_MAGIC = b"SQLite format 3\x00"
SHP_MAGIC = b"\x00\x00\x27\x0a"  # the shapefile main header's file code, 9994 big-endian
ALLOWED_DRIVERS = {
    ".gpkg": ("GPKG",),
    ".geojson": ("GeoJSON",),
    ".json": ("GeoJSON",),
    ".kml": ("KML", "LIBKML"),
    ".zip": ("ESRI Shapefile",),
}

FAMILY_BY_TYPE_ID ={0: "point", 4: "point", 1: "line", 2: "line", 5: "line", 3: "polygon", 6: "polygon"}
S_IFMT, S_IFLNK = 0o170000, 0o120000


@dataclass
class Source:
    """One layer of the upload, as GDAL opens it."""

    path: str  # a file path, or /vsizip/{zip}/member.shp
    layer: str
    shapefile: bool = False  # a zipped Shapefile member: text is decoded here, not by GDAL
    cpg_codec: str | None = None  # the Python codec named by its .cpg, when there is one


@dataclass
class Prepared:
    """One layer ready to write."""

    title: str
    style: dict
    geometry_type: str | None
    wkb: list
    properties: list  # JSON text per kept row
    source_rows: list
    source_crs: str


# --- property values ---------------------------------------------------------------------------


def json_value(v):
    """A value from a GDAL field as plain JSON: numbers, bools, strings, lists, or None."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, str):
        # PostgreSQL's jsonb cannot hold U+0000.
        return v.replace("\x00", "") if "\x00" in v else v
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating, decimal.Decimal)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, np.datetime64):
        if np.isnat(v):
            return None
        return pd.Timestamp(v).isoformat()
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):  # includes pd.Timestamp
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        # Binary fields (GPKG BLOBs) are kept as base64 text.
        return base64.b64encode(bytes(v)).decode("ascii")
    if isinstance(v, np.ndarray):  # GDAL list fields
        return [json_value(x) for x in v.tolist()]
    if isinstance(v, (list, tuple)):
        return [json_value(x) for x in v]
    if isinstance(v, dict):
        return {str(k): json_value(x) for k, x in v.items()}
    return str(v)


def _column_json(values, kind):
    """A column's values as JSON. kind 'date' prints dates without a time; 'int' undoes the float
    pyogrio turns an integer column with nulls into."""
    if kind == "date":
        return [v.date().isoformat() if isinstance(v, datetime.datetime) and v is not pd.NaT else json_value(v)
                for v in values]
    if kind == "int":
        return [int(v) if isinstance(v, float) and v.is_integer() else json_value(v) for v in values]
    return [json_value(v) for v in values]


def _field_kinds(info) -> dict:
    kinds = {}
    for name, dtype in zip(info.get("fields", []), info.get("dtypes", [])):
        dtype = str(dtype)
        if dtype == "datetime64[D]":
            kinds[name] = "date"
        elif dtype.startswith(("int", "uint")):
            kinds[name] = "int"
    return kinds


# --- Shapefile text ------------------------------------------------------------------------------


def _cpg_codec(text: str):
    """The Python codec a .cpg names, as GDAL reads it ("UTF-8", "1258", "ANSI 1258", "88591"), or None."""
    t = text.strip().upper().replace(" ", "")
    if t.startswith("ANSI"):
        t = t[4:]
    if t.isdigit():
        if t == "65001":
            t = "UTF-8"
        elif t.startswith("8859") and len(t) > 4:
            t = f"ISO-8859-{t[4:]}"
        else:
            t = f"CP{t}"
    try:
        return codecs.lookup(t).name
    except LookupError:
        return None


def _decode(s: str, codec: str, errors: str = "strict") -> str:
    # The layer was read with GDAL ENCODING=ISO-8859-1, so each character is one byte of the file.
    try:
        raw = s.encode("latin-1")
    except UnicodeEncodeError:
        return s
    out = raw.decode(codec, errors)
    # Windows-1258 writes a base letter followed by a combining tone mark.
    return unicodedata.normalize("NFC", out) if codec == "cp1258" else out


def _decode_shapefile_text(df: gpd.GeoDataFrame, cpg_codec, kinds: dict):
    """
    Decode a zipped Shapefile's names and text with its .cpg's codec, or else UTF-8, falling back to
    Windows-1258 on a decode error. GDAL's own CP1258 recoding (glibc iconv) drops the last
    character of every value, so GDAL hands over bytes and Python decodes them.
    Returns the renamed frame and the kinds keyed by the decoded names.
    """
    geom = df.geometry.name
    columns = [c for c in df.columns if c != geom]
    text_columns = [c for c in columns if df[c].dtype == object]
    candidates = []
    for codec in (cpg_codec, "utf-8", "cp1258"):
        if codec and codec not in candidates:
            candidates.append(codec)
    for i, codec in enumerate(candidates):
        # The last candidate never fails: Windows-1258 leaves a few bytes undefined, replaced here.
        errors = "replace" if i == len(candidates) - 1 else "strict"
        try:
            names = {c: _decode(c, codec, errors) for c in columns}
            values = {
                c: [_decode(v, codec, errors) if isinstance(v, str) else v for v in df[c].tolist()]
                for c in text_columns
            }
        except UnicodeDecodeError:
            continue
        for c, vals in values.items():
            df[c] = pd.Series(vals, index=df.index, dtype=object)
        df = df.rename(columns=names)
        return df, {names.get(k, k): v for k, v in kinds.items()}
    return df, kinds  # unreachable: the last candidate decodes with errors='replace'


# --- sources ------------------------------------------------------------------------------------


def _unsafe_entry(info: zipfile.ZipInfo) -> bool:
    name = info.filename.replace("\\", "/")
    if name.startswith("/") or (len(name) > 1 and name[1] == ":") or ".." in name:
        return True
    return ((info.external_attr >> 16) & S_IFMT) == S_IFLNK


def _zip_sources(zip_path: str) -> list:
    """Every safe .shp in the archive, opened through /vsizip/ (never extracted)."""
    try:
        zf = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        raise UserFacingError(UNSUPPORTED)
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        by_stem = {}
        for info in infos:
            name = info.filename.replace("\\", "/")
            stem, dot, ext = name.rpartition(".")
            if dot:
                by_stem.setdefault(stem.lower(), []).append((ext.lower(), info))
        sources = []
        for info in infos:
            name = info.filename
            if not name.lower().endswith(".shp") or name.startswith("__MACOSX/") or _unsafe_entry(info):
                continue
            siblings = by_stem.get(name.replace("\\", "/")[:-4].lower(), [])
            if any(_unsafe_entry(s) for _, s in siblings):
                continue  # a sidecar that is a link: skip the whole set
            with zf.open(info) as f:
                if f.read(len(SHP_MAGIC)) != SHP_MAGIC:
                    raise UserFacingError(UNSUPPORTED)  # not a shapefile (e.g. VRT XML named .shp)
            cpg_codec = None
            cpg = next((s for ext, s in siblings if ext == "cpg"), None)
            if cpg is not None and cpg.file_size <= CPG_MAX_BYTES:
                with zf.open(cpg) as f:
                    cpg_codec = _cpg_codec(f.read(CPG_MAX_BYTES + 1).decode("ascii", "ignore"))
            sources.append((name, cpg_codec))
    out = []
    for name, cpg_codec in sources:
        gdal_path = f"/vsizip/{{{zip_path}}}/{name}"
        for layer, geometry_type in _list_layers(gdal_path):
            if geometry_type is not None:
                out.append(Source(gdal_path, layer, shapefile=True, cpg_codec=cpg_codec))
    return out


def _looks_like_kml(head: bytes) -> bool:
    """XML whose root element is <kml>, after an optional BOM, declaration, processing
    instructions and comments."""
    s = head[3:] if head.startswith(b"\xef\xbb\xbf") else head
    while True:
        s = s.lstrip()
        if s.startswith(b"<?"):
            end = s.find(b"?>")
            if end < 0:
                return False
            s = s[end + 2:]
        elif s.startswith(b"<!--"):
            end = s.find(b"-->", 4)
            if end < 0:
                return False
            s = s[end + 3:]
        else:
            return s.startswith(b"<kml") and s[4:5] in (b">", b"/", b" ", b"\t", b"\r", b"\n")


def check_magic(path: str, ext: str):
    """
    Refuse a file whose content is not the format its extension names, before GDAL sees it: GDAL
    picks its driver from the content, and some drivers (OGR VRT, WFS, ...) open other files or
    URLs that the content names. Zips are checked per .shp member in _zip_sources.
    """
    with open(path, "rb") as f:
        head = f.read(MAGIC_READ_BYTES)
    if ext == ".gpkg":
        ok = head.startswith(SQLITE_MAGIC)
    elif ext in (".geojson", ".json"):
        ok = (head[3:] if head.startswith(b"\xef\xbb\xbf") else head).lstrip()[:1] == b"{"
    elif ext == ".kml":
        ok = _looks_like_kml(head)
    else:
        ok = ext == ".zip"
    if not ok:
        raise UserFacingError(UNSUPPORTED)


def check_driver(info: dict, ext: str):
    """Refuse a layer GDAL opened with any driver but the one the extension allows."""
    if info.get("driver") not in ALLOWED_DRIVERS.get(ext, ()):
        raise UserFacingError(UNSUPPORTED)


def _list_layers(path: str):
    try:
        return [(str(name), gt) for name, gt in pyogrio.list_layers(path)]
    except DataSourceError:
        raise UserFacingError(UNSUPPORTED)


def list_sources(path: str, ext: str) -> list:
    """The upload's vector layers: every .shp of a zip, every layer (KML folder) of anything else.
    Tables without geometry, and this app's metadata table, are not layers."""
    if ext == ".zip":
        sources = _zip_sources(path)
    else:
        sources = [Source(path, name) for name, gt in _list_layers(path)
                   if gt is not None and name != METADATA_TABLE]
    if not sources:
        raise UserFacingError(UNSUPPORTED)
    return sources


def _read_metadata(path: str) -> dict:
    """webatlas_metadata of a GeoPackage this app exported: {layer_table: {title, style, position}}."""
    try:
        if METADATA_TABLE not in {str(n) for n, _ in pyogrio.list_layers(path)}:
            return {}
        rows = pyogrio.read_dataframe(path, layer=METADATA_TABLE, read_geometry=False).to_dict("records")
    except DataSourceError:
        return {}
    out = {}
    for r in rows:
        table = r.get("layer_table")
        if not isinstance(table, str):
            continue
        title, style, position = r.get("title"), r.get("style"), r.get("position")
        try:
            style = json.loads(style) if isinstance(style, str) else None
        except ValueError:
            style = None
        try:
            position = float(position)
            position = position if math.isfinite(position) else None
        except (TypeError, ValueError):
            position = None
        out[table] = {
            "title": title.strip() if isinstance(title, str) and title.strip() else None,
            "style": style if isinstance(style, dict) else None,
            "position": position,
        }
    return out


# --- CRS ----------------------------------------------------------------------------------------


def _crs_label(crs: CRS, fallback: str | None) -> str:
    """source_crs: the authority code when pyproj finds one, otherwise the proj4."""
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


def _is_wgs84_lon_lat(crs) -> bool:
    try:
        auth = crs.to_authority(min_confidence=90)
    except Exception:
        auth = None
    return auth in (("EPSG", "4326"), ("OGC", "CRS84")) or crs.equals(CRS.from_epsg(4326), ignore_axis_order=True)


def _layer_crs(file_crs, driver: str, source_crs):
    """
    The layer's CRS and its label.
    - GeoJSON: GDAL reports EPSG:4326 (OGC:CRS84) both for a file that says so and for one with no
      crs member (RFC 7946), so the two cannot be told apart. A chosen sourceCrs therefore wins over
      a reported EPSG:4326 / OGC:CRS84; any other reported CRS was declared by the file and wins.
      Without a sourceCrs, WGS 84.
    - Every other format: the file's own CRS, else the chosen sourceCrs, else fail with NO_CRS.
    """
    chosen = None
    if source_crs and source_crs.get("proj4"):
        chosen = CRS.from_user_input(source_crs["proj4"]), source_crs["proj4"]
    if driver == "GeoJSON" and chosen and (file_crs is None or _is_wgs84_lon_lat(file_crs)):
        return chosen[0], _crs_label(chosen[0], chosen[1])
    if file_crs is not None:
        return file_crs, _crs_label(file_crs, None)
    if chosen:
        return chosen[0], _crs_label(chosen[0], chosen[1])
    if driver == "GeoJSON":
        return CRS.from_epsg(4326), "EPSG:4326"
    raise UserFacingError(NO_CRS)


# --- the handler ---------------------------------------------------------------------------------


def _resolve_upload(rel: str) -> str:
    root = os.path.realpath(store_root())
    full = os.path.realpath(os.path.join(root, rel))
    if os.path.commonpath([root, full]) != root or not os.path.isfile(full):
        raise RuntimeError(f"import file {rel!r} is missing or outside the store")
    return full


def _file_stem(name: str) -> str:
    return pathlib.PurePosixPath(name.replace("\\", "/")).stem


def _title(*candidates) -> str:
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return c.strip()[:TITLE_MAX]
    raise RuntimeError("no usable layer title")


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


def run_import_vector(conn, job, steps) -> dict:
    params = job["params"]
    map_id, owner_id = params["mapId"], params["ownerId"]
    original_name = params.get("originalName") or params["path"]
    ext = import_extension(params)
    max_rows = int(params.get("maxRows") or 200000)

    # --- read
    steps.start("read")
    path = _resolve_upload(params["path"])
    # Three defences against a file that makes GDAL open something else: the content must match
    # the extension (check_magic here, per .shp in _zip_sources), the driver GDAL picked must be the
    # extension's (check_driver), and worker.configure_gdal skips the dangerous drivers and the network.
    check_magic(path, ext)
    sources = list_sources(path, ext)
    infos = []
    for s in sources:
        options = {"ENCODING": "ISO-8859-1"} if s.shapefile else {}
        try:
            info = pyogrio.read_info(s.path, layer=s.layer, force_feature_count=True, **options)
        except DataSourceError:
            raise UserFacingError(UNSUPPORTED)
        check_driver(info, ext)
        infos.append(info)
    if sum(max(int(i.get("features") or 0), 0) for i in infos) > max_rows:
        raise UserFacingError(TOO_MANY_ROWS)
    metadata = _read_metadata(path) if infos and infos[0].get("driver") == "GPKG" else {}

    layers = []  # (source, info, frame, kinds, rows-with-geometry mask), for layers that are imported
    empty_layers = []
    total = 0
    for n, (s, info) in enumerate(zip(sources, infos)):
        options = {"ENCODING": "ISO-8859-1"} if s.shapefile else {}
        df = pyogrio.read_dataframe(s.path, layer=s.layer, **options)
        kinds = _field_kinds(info)
        if s.shapefile:
            df, kinds = _decode_shapefile_text(df, s.cpg_codec, kinds)
        total += len(df)
        if total > max_rows:
            raise UserFacingError(TOO_MANY_ROWS)
        geoms = np.asarray(df.geometry.array, dtype=object)
        keep = ~(shapely.is_missing(geoms) | shapely.is_empty(geoms))
        if keep.any():
            layers.append((s, info, df, kinds, keep))
        else:
            # A layer without a single geometry becomes no map layer.
            empty_layers.append(s.layer)
        steps.progress(PROGRESS_READ * (n + 1) / len(sources))
    if not layers:
        raise UserFacingError(UNSUPPORTED)
    steps.done("read", " ".join(empty_layer_message(name) for name in empty_layers) or None)

    # --- transform
    steps.start("transform")
    single = len(layers) == 1
    order = sorted(
        range(len(layers)),
        key=lambda i: (0, metadata[layers[i][0].layer]["position"], i)
        if layers[i][0].layer in metadata and metadata[layers[i][0].layer]["position"] is not None
        else (1, 0, i),
    )
    prepared = []
    skipped = 0
    for i in order:
        s, info, df, kinds, keep = layers[i]
        crs, label = _layer_crs(df.crs, info.get("driver", ""), params.get("sourceCrs"))
        geoms = np.asarray(df.geometry.array, dtype=object)
        skipped += int((~keep).sum())
        kept = gpd.GeoSeries(geoms[keep], crs=crs)
        if not crs.equals(CRS.from_epsg(4326)):
            kept = kept.to_crs(4326)
        geoms2d = shapely.force_2d(np.asarray(kept.array, dtype=object))
        # A wrong (or absent, read as WGS 84) source CRS shows as coordinates off the globe.
        if not _within_lon_lat(geoms2d):
            raise UserFacingError(OUT_OF_RANGE)
        families = {FAMILY_BY_TYPE_ID.get(int(t)) for t in np.unique(shapely.get_type_id(geoms2d))}
        geometry_type = next(iter(families)) if len(families) == 1 else None

        columns = [c for c in df.columns if c != df.geometry.name]
        kept_df = df.loc[keep, columns]
        values = [_column_json(kept_df[c].tolist(), kinds.get(c)) for c in columns]
        properties = [json.dumps(dict(zip(columns, row)), ensure_ascii=False, allow_nan=False)
                      for row in zip(*values)] if columns else ["{}"] * int(keep.sum())

        meta = metadata.get(s.layer) or {}
        title = _title(meta.get("title"), _file_stem(original_name) if single else s.layer,
                       s.layer, _file_stem(original_name), original_name)
        prepared.append(Prepared(
            title=title,
            style=meta.get("style") or {},
            geometry_type=geometry_type,
            wkb=list(shapely.to_wkb(geoms2d, output_dimension=2)),
            properties=properties,
            source_rows=(np.flatnonzero(keep) + 1).tolist(),
            source_crs=label,
        ))
    steps.progress(PROGRESS_TRANSFORM)
    steps.done("transform", skipped_message(skipped) if skipped else None)

    # --- write
    steps.start("write")
    rows_total = sum(len(p.wkb) for p in prepared)
    written = 0
    layer_ids = []
    with conn.cursor() as cur:
        position = lock_owned_map(cur, map_id, owner_id)
        for p in prepared:
            cur.execute(
                """INSERT INTO workspace.map_layers (map_id, kind, title, position, style, geometry_type, fields)
                   VALUES (%s, 'free', %s, %s, %s, %s, '[]'::jsonb) RETURNING id::text""",
                (map_id, p.title, position, psycopg2.extras.Json(p.style), p.geometry_type),
            )
            layer_id = cur.fetchone()[0]
            layer_ids.append(layer_id)
            position += 1
            for start in range(0, len(p.wkb), BATCH_ROWS):
                end = start + BATCH_ROWS
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO workspace.features (layer_id, geom, properties, source_row, source_crs) VALUES %s",
                    [(layer_id, w, props, r, p.source_crs)
                     for w, props, r in zip(p.wkb[start:end], p.properties[start:end], p.source_rows[start:end])],
                    template="(%s, ST_GeomFromWKB(%s, 4326), %s::jsonb, %s, %s)",
                    page_size=BATCH_ROWS,
                )
                written += min(end, len(p.wkb)) - start
                steps.progress(PROGRESS_TRANSFORM + (PROGRESS_WRITE - PROGRESS_TRANSFORM) * written / max(rows_total, 1))
        finish_map_write(cur, map_id, owner_id)
    steps.done("write")
    return {"layerIds": layer_ids, "rows": rows_total}
