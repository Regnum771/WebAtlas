"""
Vector export (P3b Task 8): the `export` job. A map's free layers and edit copies are written as a
GeoPackage, GeoJSON (one file, or a zip of one file per layer) or zipped Shapefile, reprojected to
the coordinate system the API chose from packages/shared/src/crs.ts (its proj4 is in the job's
params; the worker keeps no CRS table of its own), and recorded as a workspace.files row of kind
'export' that expires after 7 days.

Steps:
- read: check that the user may still read the map (workspace.map_role, the API's rule), that
  every layer is still in the map and an edit copy still on the draft the API saw, and settle
  each layer's columns;
- write: layer by layer, read its rows from the database, reproject them and write them through
  GDAL (GPKG, GeoJSON or ESRI Shapefile), with a progress update (a heartbeat) between layers, so
  only one layer is in memory at a time;
- package: the GeoPackage's webatlas_metadata table, or the zip; then the file is moved into
  exports/<ownerId>/<jobId>/<downloadName> and its files row inserted.

Files are not transactional, so everything is written in a work directory created inside the job's
own directory of the store (the final rename stays on one filesystem), the finished file is
renamed into place only when complete, the work files are removed one by one whatever happens,
and the final file is removed again (Steps.on_rollback) if the job's transaction does not commit.

The export is never refused for quota: the file is temporary. While it lives it counts toward the
user's usage (workspace.usage_bytes counts files whose delete_after is still in the future).
"""
# First: importing workspace_common restricts GDAL (configure_gdal) before pyogrio registers its
# drivers. It imports no handler and not worker, so there is no import cycle.
from workspace_common import UserFacingError, remove_in_store, store_root

import json
import os
import re
import tempfile
import unicodedata
import uuid
import zipfile

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
from pyproj import CRS

# The API's copy (apps/api/src/modules/workspace/jobs.ts NOTHING_TO_EXPORT, warnDraftGone;
# access.ts MAP_NOT_FOUND).
NOTHING_TO_EXPORT = "Bản đồ không có lớp nào để xuất."
MAP_NOT_FOUND = "Không tìm thấy bản đồ."


def draft_gone_message(title: str) -> str:
    return f'Lớp "{title}" không còn bản nháp nên không được xuất.'


def layer_gone_message(title: str) -> str:
    return f'Lớp "{title}" không còn trong bản đồ nên không được xuất.'


# The table import_vector.py reads back from a GeoPackage this app exported (_read_metadata).
METADATA_TABLE = "webatlas_metadata"
CONTENT_TYPES = {".gpkg": "application/geopackage+sqlite3", ".geojson": "application/geo+json", ".zip": "application/zip"}
# jobs.ts downloadNameFor: titleSlug plus the format's extension.
DOWNLOAD_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:gpkg|geojson|zip)$")
# Shapefile sets by geometry family, and the files of each set.
SHP_FAMILY_NAMES = {"point": "diem", "line": "duong", "polygon": "vung"}
SHP_SIDECARS = ("shp", "shx", "dbf", "prj", "cpg")
FAMILY_OF = {
    "Point": "point", "MultiPoint": "point",
    "LineString": "line", "MultiLineString": "line",
    "Polygon": "polygon", "MultiPolygon": "polygon",
}
# The GDAL geometry type of a layer that holds no geometry to infer one from.
GEOMETRY_TYPE_OF_FAMILY = {"point": "Point", "line": "LineString", "polygon": "Polygon"}
# The frame's geometry column: a name no property is expected to take (GDAL names the geometry
# column of the file itself; see _gpkg_options).
GEOM = "_webatlas_geometry"
SLUG_MAX = 50
INT64_MIN, INT64_MAX = -(2 ** 63), 2 ** 63 - 1
# Overall progress: reading 0-10, writing 10-90, packaging after that.
PROGRESS_READ, PROGRESS_WRITE = 10, 90


# --- names --------------------------------------------------------------------------------------


def table_slug(title: str, taken: set) -> str:
    """
    The layer's table (GeoPackage), file (GeoJSON) and set (Shapefile) name: the title lower case,
    diacritics removed (đ to d), every run of characters outside [a-z0-9] turned into one '_', no
    '_' at either end; 'lop' when nothing is left. Names GeoPackage reserves get a 'lop_' prefix,
    and a name already taken gets a counter (_2, _3, ...).
    """
    s = unicodedata.normalize("NFD", title.lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("đ", "d")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:SLUG_MAX].strip("_") or "lop"
    if s == METADATA_TABLE or s.startswith(("gpkg_", "rtree_", "sqlite_")):
        s = f"lop_{s}"[:SLUG_MAX]
    base, name, n = s, s, 2
    while name in taken:
        suffix = f"_{n}"
        name = base[:SLUG_MAX - len(suffix)] + suffix
        n += 1
    taken.add(name)
    return name


# --- values ---------------------------------------------------------------------------------------


def column_values(values: list):
    """
    One attribute's JSON values as an array GDAL writes with a fitting field type: booleans,
    integers (64-bit) and numbers keep their type, with nulls; anything else is text, and values
    that are not strings (objects, lists, mixed types) are written as JSON text.
    """
    present = [v for v in values if v is not None]
    if present and all(isinstance(v, bool) for v in present):
        return pd.array(values, dtype="boolean")
    if present and all(isinstance(v, int) and not isinstance(v, bool) and INT64_MIN <= v <= INT64_MAX
                       for v in present):
        return pd.array(values, dtype="Int64")
    if present and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in present):
        return np.array([np.nan if v is None else float(v) for v in values], dtype="float64")
    return np.array([v if v is None or isinstance(v, str) else json.dumps(v, ensure_ascii=False) for v in values],
                    dtype=object)


def frame(columns, props, geoms, crs) -> gpd.GeoDataFrame:
    """A GeoDataFrame of the given (output name, property key) columns and geometries."""
    data = {out: column_values([p.get(key) for p in props]) for out, key in columns}
    df = pd.DataFrame(data, index=pd.RangeIndex(len(geoms)))
    df[GEOM] = gpd.GeoSeries(geoms, crs=crs).values
    return gpd.GeoDataFrame(df, geometry=GEOM, crs=crs)


# --- reading -------------------------------------------------------------------------------------


def free_columns(cur, layer) -> list:
    """
    A free layer's attribute names, as the API's fieldNamesOf lists them: its declared fields, or,
    for a layer that declares none (an imported one), the keys its features carry, ordered by the
    first feature that has them.
    """
    declared = [f["name"] for f in layer.get("fields") or []
                if isinstance(f, dict) and isinstance(f.get("name"), str)]
    if declared:
        return declared
    cur.execute(
        """SELECT k.key
             FROM workspace.features f, jsonb_object_keys(f.properties) AS k(key)
            WHERE f.layer_id = %s
            GROUP BY k.key
            ORDER BY min(f.id), k.key""",
        (layer["layerId"],),
    )
    return [r[0] for r in cur.fetchall()]


def read_rows(cur, layer):
    """The layer's geometries (EPSG:4326, None where a row has none) and property dicts."""
    if layer["kind"] == "free":
        cur.execute(
            "SELECT ST_AsBinary(geom), properties FROM workspace.features WHERE layer_id = %s ORDER BY id",
            (layer["layerId"],),
        )
    else:
        e = layer["editCopy"]
        # Every row of the edit copy: no bbox, no limit.
        cur.execute(
            """SELECT ST_AsBinary(ST_GeomFromGeoJSON(geometry)), properties
                 FROM workspace.edit_copy_rows(%s::regclass, %s::regclass, %s::uuid, %s, %s::text[])""",
            (e["table"], e["relation"], e["draftId"], e["geomColumn"], list(e["columns"])),
        )
    rows = cur.fetchall()
    geoms = shapely.from_wkb(np.array([None if w is None else bytes(w) for w, _ in rows], dtype=object))
    props = [p if isinstance(p, dict) else {} for _, p in rows]
    return geoms, props


def check_layers(cur, params) -> tuple:
    """
    The layers to export, each still in the map (an edit copy still on the draft the API read),
    and the messages for the ones left out since the export was queued.
    """
    ids = [layer["layerId"] for layer in params["layers"]]
    cur.execute(
        "SELECT id::text, draft_id::text FROM workspace.map_layers WHERE map_id = %s AND id = ANY(%s::uuid[])",
        (params["mapId"], ids),
    )
    present = dict(cur.fetchall())
    layers, messages = [], []
    for layer in params["layers"]:
        if layer["layerId"] not in present:
            messages.append(layer_gone_message(layer["title"]))
        elif layer["kind"] == "edit_copy" and present[layer["layerId"]] != (layer.get("editCopy") or {}).get("draftId"):
            messages.append(draft_gone_message(layer["title"]))
        elif layer["kind"] in ("free", "edit_copy"):
            layers.append(layer)
        else:
            raise RuntimeError(f"cannot export a layer of kind {layer['kind']!r}")
    return layers, messages


# --- writing -------------------------------------------------------------------------------------


def _gpkg_options(columns) -> dict:
    """The GeoPackage's geometry and FID column names, kept clear of the layer's own attributes."""
    lower = {name.lower() for name, _ in columns}
    return {
        "GEOMETRY_NAME": "webatlas_geom" if "geom" in lower else "geom",
        "FID": "webatlas_fid" if "fid" in lower else "fid",
    }


def _geometry_type(geoms, layer):
    """None to let GDAL infer the type from the geometries; the declared family when there are none."""
    if any(g is not None for g in geoms):
        return None
    return GEOMETRY_TYPE_OF_FAMILY.get(layer.get("geometryType"), "Unknown")


def write_gpkg_layer(path, slug, layer, columns, geoms, props, crs):
    gdf = frame(columns, props, geoms, crs)
    pyogrio.write_dataframe(gdf, path, layer=slug, driver="GPKG", geometry_type=_geometry_type(geoms, layer),
                            layer_options=_gpkg_options(columns))


def write_geojson_layer(work_dir, slug, layer, columns, geoms, props, crs, wgs84, proj4) -> str:
    """Write <slug>.geojson in work_dir; returns its path. Outside WGS 84 the file carries a crs member."""
    gdf = frame(columns, props, geoms, crs)
    raw = os.path.join(work_dir, f"{slug}.raw.geojson")
    out = os.path.join(work_dir, f"{slug}.geojson")
    # RFC 7946 output is WGS 84 longitude/latitude; anything else is written as is, with RFC7946=NO.
    pyogrio.write_dataframe(gdf, raw, layer=slug, driver="GeoJSON", geometry_type=_geometry_type(geoms, layer),
                            layer_options={"RFC7946": "YES" if wgs84 else "NO"})
    if wgs84:
        os.replace(raw, out)
    else:
        add_crs_member(raw, out, proj4)
        remove_in_store(raw)
    return out


def add_crs_member(src, dst, proj4):
    """
    Copy GDAL's GeoJSON with a crs member naming the proj4 (GDAL reads it back) placed before
    "features", unless GDAL wrote one itself (when it found an EPSG code for the CRS). GDAL writes
    each top-level member on a line of its own and each feature on one line, so the header is read
    line by line and the rest copied as it is.
    """
    member = ('"crs": ' + json.dumps({"type": "name", "properties": {"name": proj4}}) + ",\n").encode("utf-8")
    with open(src, "rb") as f, open(dst, "wb") as out:
        while True:
            line = f.readline()
            if not line:
                raise RuntimeError("GeoJSON written without a features member")
            if line.startswith(b'"features"'):
                out.write(member)
                out.write(line)
                break
            out.write(line)
            if line.startswith(b'"crs"'):
                break
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)


def _simple_parts(g):
    """A geometry's single-part pieces, collections and multi-geometries flattened."""
    parts = []
    for p in shapely.get_parts(g):
        if p.geom_type == "GeometryCollection" or p.geom_type.startswith("Multi"):
            parts.extend(_simple_parts(p))
        elif not p.is_empty:
            parts.append(p)
    return parts


MULTI_OF_FAMILY = {"point": shapely.MultiPoint, "line": shapely.MultiLineString, "polygon": shapely.MultiPolygon}


def split_by_family(geoms, declared) -> dict:
    """
    {family: ([row index], [geometry])} for a Shapefile, one geometry type per file. A multi-
    geometry goes into its single family; a geometry collection is split into one multi-geometry
    per family it holds; a row without geometry goes into the layer's declared family, if any.
    """
    out = {}
    for i, g in enumerate(geoms):
        if g is None or g.is_empty:
            if declared in SHP_FAMILY_NAMES:
                rows, gs = out.setdefault(declared, ([], []))
                rows.append(i)
                gs.append(None)
            continue
        family = FAMILY_OF.get(g.geom_type)
        if family is not None:
            pieces = {family: g}
        else:
            by_family = {}
            for p in _simple_parts(g):
                by_family.setdefault(FAMILY_OF[p.geom_type], []).append(p)
            pieces = {f: MULTI_OF_FAMILY[f](ps) for f, ps in by_family.items()}
        for f, piece in pieces.items():
            rows, gs = out.setdefault(f, ([], []))
            rows.append(i)
            gs.append(piece)
    return out


def write_shp_layer(work_dir, slug, layer, geoms, props, crs) -> list:
    """
    Write <slug>_<diem|duong|vung>.shp/.shx/.dbf/.prj/.cpg in work_dir for each geometry family
    the layer holds (the declared one when it holds no rows at all); returns the files written.
    Fields are renamed exactly by the layer's shpNames, which are already at most 10 ASCII bytes,
    so GDAL never launders them; a property without a shpNames entry is not written.
    """
    names = layer.get("shpNames")
    if not isinstance(names, list):
        raise RuntimeError(f"layer {layer['layerId']} has no shpNames for a Shapefile export")
    columns = [(n["to"], n["from"]) for n in names]
    groups = split_by_family(geoms, layer.get("geometryType"))
    if not groups and len(geoms) == 0 and layer.get("geometryType") in SHP_FAMILY_NAMES:
        groups = {layer["geometryType"]: ([], [])}
    written = []
    for family, (rows, gs) in groups.items():
        stem = f"{slug}_{SHP_FAMILY_NAMES[family]}"
        if family == "point":
            multi = any(g is not None and g.geom_type == "MultiPoint" for g in gs)
            geometry_type = "MultiPoint" if multi else "Point"
        else:
            multi, geometry_type = True, {"line": "MultiLineString", "polygon": "MultiPolygon"}[family]
        gdf = frame(columns, [props[i] for i in rows], np.array(gs, dtype=object), crs)
        path = os.path.join(work_dir, f"{stem}.shp")
        pyogrio.write_dataframe(gdf, path, driver="ESRI Shapefile", encoding="UTF-8",
                                geometry_type=geometry_type, promote_to_multi=multi)
        cpg = os.path.join(work_dir, f"{stem}.cpg")
        with open(cpg, "w", encoding="ascii") as f:  # GDAL writes it too; make sure of the content
            f.write("UTF-8")
        written.extend(os.path.join(work_dir, f"{stem}.{ext}") for ext in SHP_SIDECARS
                       if os.path.exists(os.path.join(work_dir, f"{stem}.{ext}")))
    return written


def write_metadata(path, entries, map_title):
    """The webatlas_metadata table import_vector.py reads back (title, style as JSON text, position)."""
    md = pd.DataFrame({
        "layer_table": [e["table"] for e in entries],
        "layer_id": [e["layer"]["layerId"] for e in entries],
        "kind": [e["layer"]["kind"] for e in entries],
        "title": [e["layer"]["title"] for e in entries],
        "style": [json.dumps(e["layer"].get("style") or {}, ensure_ascii=False) for e in entries],
        "position": np.array([e["position"] for e in entries], dtype="int64"),
        "map_title": [map_title for _ in entries],
    })
    pyogrio.write_dataframe(md, path, layer=METADATA_TABLE, driver="GPKG")


def zip_members(zip_path, members):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for m in members:
            zf.write(m, os.path.basename(m))


def remove_work_dir(work_dir):
    """Remove the work directory's files one by one (never recursively), then the directory."""
    if not os.path.isdir(work_dir):
        return
    for name in os.listdir(work_dir):
        path = os.path.join(work_dir, name)
        if os.path.isfile(path) and not os.path.islink(path):
            remove_in_store(path)
    try:
        os.rmdir(work_dir)
    except OSError:
        pass  # something unexpected is left; leave it rather than recurse


# --- the handler ---------------------------------------------------------------------------------


def run_export(conn, job, steps) -> dict:
    params = job["params"]
    fmt = params["format"]
    owner_id = str(uuid.UUID(params["ownerId"]))
    job_id = str(uuid.UUID(str(job["id"])))
    download_name = params["downloadName"]
    ext = os.path.splitext(download_name)[1]
    allowed = {"gpkg": (".gpkg",), "geojson": (".geojson", ".zip"), "shp": (".zip",)}.get(fmt)
    if not allowed or not DOWNLOAD_NAME.match(download_name) or ext not in allowed:
        raise RuntimeError(f"export {fmt!r} to {download_name!r} is not supported")
    proj4 = params["crs"]["proj4"]
    crs = CRS.from_user_input(proj4)
    wgs84 = crs.equals(CRS.from_epsg(4326), ignore_axis_order=True)
    if wgs84:
        crs = CRS.from_epsg(4326)  # tagged as EPSG:4326, and GeoJSON written to RFC 7946

    with conn.cursor() as cur:
        # READ COMMITTED, like every job: each layer is read by one statement, so one layer is
        # consistent in itself. Not REPEATABLE READ: jobs_db.succeed updates, in this transaction,
        # the job row that the side connection keeps updating while it is open, and that update
        # would then fail to serialize.

        # --- read
        steps.start("read")
        # The user may have lost the map since the export was queued (a share revoked, the map
        # archived): check again, by the API's own rule, before anything is read.
        cur.execute("SELECT workspace.map_role(%s, %s)", (params["mapId"], owner_id))
        if cur.fetchone()[0] is None:
            raise UserFacingError(MAP_NOT_FOUND)
        layers, skipped = check_layers(cur, params)
        if not layers:
            raise UserFacingError(NOTHING_TO_EXPORT)
        if fmt == "geojson" and ext == ".geojson" and len(layers) != 1:
            raise RuntimeError("a single GeoJSON file holds one layer")
        taken = set()
        entries = []
        for position, layer in enumerate(layers):
            if layer["kind"] == "edit_copy":
                keys = ["external_id", *layer["editCopy"]["columns"]]
            else:
                keys = free_columns(cur, layer)
            entries.append({"layer": layer, "table": table_slug(layer["title"], taken), "position": position,
                            "columns": [(k, k) for k in keys]})
        steps.progress(PROGRESS_READ)
        steps.done("read", " ".join(skipped) or None)

        rel = f"exports/{owner_id}/{job_id}/{download_name}"
        root = os.path.realpath(store_root())
        final = os.path.join(root, *rel.split("/"))
        job_dir = os.path.dirname(final)
        os.makedirs(job_dir, exist_ok=True)
        work_dir = tempfile.mkdtemp(prefix=".work-", dir=job_dir)
        try:
            # --- write
            steps.start("write")
            out_path = os.path.join(work_dir, download_name)
            members = []
            for n, e in enumerate(entries):
                layer = e["layer"]
                geoms, props = read_rows(cur, layer)
                if not wgs84:
                    geoms = np.asarray(gpd.GeoSeries(geoms, crs=4326).to_crs(crs).array, dtype=object)
                if fmt == "gpkg":
                    write_gpkg_layer(out_path, e["table"], layer, e["columns"], geoms, props, crs)
                elif fmt == "geojson":
                    members.append(write_geojson_layer(work_dir, e["table"], layer, e["columns"], geoms, props,
                                                       crs, wgs84, proj4))
                else:
                    members.extend(write_shp_layer(work_dir, e["table"], layer, geoms, props, crs))
                del geoms, props
                steps.progress(PROGRESS_READ + (PROGRESS_WRITE - PROGRESS_READ) * (n + 1) / len(entries))
            steps.done("write")

            # --- package
            steps.start("package")
            if fmt == "gpkg":
                write_metadata(out_path, entries, params.get("mapTitle"))
            elif ext == ".geojson":
                os.replace(members[0], out_path)
            else:
                zip_members(out_path, members)
            os.replace(out_path, final)
            steps.on_rollback(lambda: remove_in_store(final))
        finally:
            remove_work_dir(work_dir)

        file_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO workspace.files
                 (id, owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
               VALUES (%s, %s, 'export', %s, %s, %s, %s, now() + interval '7 days')""",
            (file_id, owner_id, rel, download_name, CONTENT_TYPES[ext], os.path.getsize(final)),
        )
    steps.done("package")
    return {"fileId": file_id}
