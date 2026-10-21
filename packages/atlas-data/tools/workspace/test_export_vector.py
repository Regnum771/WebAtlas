"""
Checks for export_vector.py (P3b Task 8): an `export` job writes a map's free layers and edit
copies as a GeoPackage, GeoJSON or zipped Shapefile, in the coordinate system the API chose, and
records the result as an expiring `export` file.

No pytest (see flood_scenario/test_depth.py). Runs inside the atlas-tools image against the dev
database (DATABASE_URL):

    python3 packages/atlas-data/tools/workspace/test_export_vector.py

The worker's file store (WORKSPACE_FILES_DIR) and a scratch directory are temp directories. The
check creates its own app.users row and map (deleting the user cascades to maps, layers, features,
jobs and files rows) and claims only its own job ids.

The edit copy needs a dams draft. Like apps/api/src/modules/workspace/editCopies.test.ts, this file
pins every existing dams version, makes its own synthetic root (dams 901101-901110) the active
version in one transaction, and restores the prior active version in one transaction afterwards,
before anything of its own is deleted.
"""
import json
import os
import pathlib
import sys
import tempfile
import uuid
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# worker first: it configures GDAL (skipped drivers, no network) before pyogrio is imported.
import worker  # noqa: E402
import jobs_db  # noqa: E402

import pyogrio  # noqa: E402
from pyproj import CRS, Geod  # noqa: E402

# Copied verbatim from packages/shared/src/crs.ts: tm3('da-nang', ..., 107.75) with VN2000_DATUM.
VN2000_TM3_DA_NANG = (
    "+proj=tmerc +lat_0=0 +lon_0=107.75 +k=0.9999 +x_0=500000 +y_0=0 "
    "+ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 "
    "+units=m +no_defs"
)
# packages/shared/src/crs.ts WGS84.
WGS84 = "+proj=longlat +datum=WGS84 +no_defs"
CRS_WGS84 = {"id": "wgs84-dd", "proj4": WGS84}
CRS_TM3 = {"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG}

STEPS = [
    {"key": "read", "label": "Đọc dữ liệu", "status": "pending"},
    {"key": "write", "label": "Ghi tệp", "status": "pending"},
    {"key": "package", "label": "Đóng gói", "status": "pending"},
]

LAYER = "dams"
PIN = "test_export_vector.py"
SOURCE = "test_export_vector.py"
DAMS = list(range(901101, 901111))
EDITED = 901103
DAM_Y = 16.05


def dam_x(ext):
    return 108 + (ext - 901100) * 0.01


DAM_COLUMNS = ["name", "name_en", "wattage_mw", "annual_output", "year_launched", "year_operational", "status",
               "managing_unit"]
# shapefileFieldNames (packages/shared/src/shapefileNames.ts) of the two layers, as the API computes them.
FREE_SHP_NAMES = [
    {"from": "ghi_chu_dai_hon", "to": "ghi_chu_da"},
    {"from": "ma", "to": "ma"},
    {"from": "tên_công_trình", "to": "ten_cong_t"},
]
DAMS_SHP_NAMES = [
    {"from": "external_id", "to": "external_i"}, {"from": "name", "to": "name"},
    {"from": "name_en", "to": "name_en"}, {"from": "wattage_mw", "to": "wattage_mw"},
    {"from": "annual_output", "to": "annual_out"}, {"from": "year_launched", "to": "year_launc"},
    {"from": "year_operational", "to": "year_opera"}, {"from": "status", "to": "status"},
    {"from": "managing_unit", "to": "managing_u"},
]

FREE_TITLE, FREE_SLUG = "Công trình thủy lợi", "cong_trinh_thuy_loi"
EDIT_TITLE, EDIT_SLUG = "Sửa lớp Đập & hồ chứa", "sua_lop_dap_ho_chua"
FREE_STYLE = {"color": "#1f78b4", "width": 2}
MAP_TITLE, MAP_SLUG = "Bản đồ xuất thử", "ban-do-xuat-thu"
POINT_1 = (108.2022, 16.0544)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


# --- temp directories: the worker's store and a scratch dir for reading results back --------

STORE = tempfile.mkdtemp(prefix="p3b-export-store-")
WORK = tempfile.mkdtemp(prefix="p3b-export-work-")
os.environ["WORKSPACE_FILES_DIR"] = STORE


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


def work(name):
    return os.path.join(WORK, name)


def unzip(path):
    """Extract a zip's (flat) members into WORK; returns their names."""
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        for n in names:
            if "/" in n or "\\" in n or n.startswith("."):
                raise AssertionError(f"unexpected member {n!r}")
            with zf.open(n) as src, open(work(n), "wb") as dst:
                dst.write(src.read())
    return sorted(names)


# --- database --------------------------------------------------------------------------------

conn = jobs_db.connect()
watch = jobs_db.connect(autocommit=True)  # an observer outside every transaction under test
users = []
job_dirs = []  # (ownerId, jobId) of every export run, for cleanup


def q(sql, args=()):
    with watch.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None


# packages/versioning/src/resolve.ts resolvedSql('dams'), with %(v)s for the version id.
RESOLVED = """
    WITH RECURSIVE chain AS (
      SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = %(v)s
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.dams t JOIN chain c ON t.dataset_version_id = c.id
       ORDER BY t.external_id, c.depth
    )
    SELECT id FROM resolved WHERE NOT deleted"""


def set_active(cur, version_id):
    """
    Make version_id the active dams version and move the current flag to its rows, as
    packages/versioning/src/testLayerGuard.ts restoreActive does. The caller commits: the layer
    never has two active versions, or none.
    """
    cur.execute("UPDATE app.dataset_versions SET is_active = false WHERE layer_key = %s AND is_active", (LAYER,))
    cur.execute("UPDATE app.dataset_versions SET is_active = true WHERE id = %s AND layer_key = %s",
                (version_id, LAYER))
    if cur.rowcount != 1:
        raise RuntimeError(f"dams: version {version_id} to activate is gone")
    cur.execute(f"""UPDATE water.dams t SET is_current = false
                     WHERE t.is_current AND NOT EXISTS (SELECT 1 FROM ({RESOLVED}) r WHERE r.id = t.id)""",
                {"v": version_id})
    cur.execute(f"UPDATE water.dams SET is_current = true WHERE NOT is_current AND id IN ({RESOLVED})",
                {"v": version_id})


def in_tx(fn):
    """Run fn(cursor) in one committed transaction on a fresh connection."""
    c = jobs_db.connect()
    try:
        with c.cursor() as cur:
            out = fn(cur)
        c.commit()
        return out
    finally:
        c.rollback()
        c.close()


def insert_dam(cur, version_id, ext, name, x=None, y=DAM_Y):
    cur.execute(
        """INSERT INTO water.dams
             (external_id, name, geom, dataset_version_id, province_codes, ward_codes, managing_unit, deleted)
           VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, '{}', '{}', '48', false)""",
        (ext, name, dam_x(ext) if x is None else x, y, version_id),
    )


def run_export(user_id, map_id, fmt, crs, layers, **overrides):
    """Queue an export job as the API would, run it, and return (job row, job id)."""
    n = len(layers)
    ext = "gpkg" if fmt == "gpkg" else "geojson" if fmt == "geojson" and n == 1 else "zip"
    params = {
        "mapId": str(map_id), "ownerId": str(user_id), "mapTitle": MAP_TITLE, "format": fmt, "crs": crs,
        "downloadName": f"{MAP_SLUG}.{ext}",
        "layers": [dict(layer, shpNames=layer["shpNames"] if fmt == "shp" else None) for layer in layers],
        **overrides,
    }
    job_id = q(
        """INSERT INTO workspace.jobs (owner_id, map_id, kind, params, steps)
           VALUES (%s, %s, 'export', %s, %s) RETURNING id::text""",
        (user_id, map_id, json.dumps(params), json.dumps(STEPS)),
    )[0][0]
    job_dirs.append((str(user_id), job_id))
    return job_id, params


def run_job(job_id):
    worker.run_once(conn, only_ids=[job_id])
    with watch.cursor() as cur:
        cur.execute("SELECT status, error, result, steps, progress FROM workspace.jobs WHERE id = %s", (job_id,))
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, cur.fetchone()))


def export(user_id, map_id, fmt, crs, layers):
    job_id, params = run_export(user_id, map_id, fmt, crs, layers)
    row = run_job(job_id)
    if row["status"] != "succeeded":
        print(f"     job {job_id}: {row['status']} {row['error']} {row['steps']}")
    return row, job_id, params


def file_row(file_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT id::text, owner_id::text, kind, path, original_name, content_type, size_bytes,
                      EXTRACT(EPOCH FROM delete_after - created_at) AS ttl_seconds
                 FROM workspace.files WHERE id = %s""",
            (file_id,),
        )
        r = cur.fetchone()
        return dict(zip([d[0] for d in cur.description], r)) if r else {}


def stored(row):
    """The absolute path of a succeeded export's file."""
    f = file_row((row.get("result") or {}).get("fileId"))
    return os.path.join(STORE, *f["path"].split("/")) if f else None


prior_active = None
root_id = None
draft_id = None
restored = False
pinned = False

try:
    # --- fixtures: a user, a map with a free layer (2 points, 1 line) and an edit copy of dams
    email = f"p3b-export-owner-{uuid.uuid4().hex[:8]}@webatlas.test"
    user_id = q("INSERT INTO app.users (email, password_hash, role) VALUES (%s, 'x', 'viewer') RETURNING id::text",
                (email,))[0][0]
    users.append(user_id)
    map_id = q("INSERT INTO workspace.maps (owner_id, title) VALUES (%s, %s) RETURNING id::text",
               (user_id, MAP_TITLE))[0][0]
    free_id = q(
        """INSERT INTO workspace.map_layers (map_id, kind, title, position, style, geometry_type, fields)
           VALUES (%s, 'free', %s, 0, %s, NULL, '[]'::jsonb) RETURNING id::text""",
        (map_id, FREE_TITLE, json.dumps(FREE_STYLE)),
    )[0][0]
    for wkt, props in [
        (f"POINT({POINT_1[0]} {POINT_1[1]})", {"tên_công_trình": "Trạm bơm Hòa Phước", "ma": 1, "ghi_chu_dai_hon": "a"}),
        ("POINT(108.21 16.06)", {"tên_công_trình": "Cống Cẩm Lệ", "ma": 2}),
        ("LINESTRING(108.2 16.0, 108.25 16.02, 108.3 16.05)", {"tên_công_trình": "Kênh N1", "ma": 3}),
    ]:
        q("INSERT INTO workspace.features (layer_id, geom, properties) VALUES (%s, ST_GeomFromText(%s, 4326), %s)",
          (free_id, wkt, json.dumps(props, ensure_ascii=False)))

    # Pin every dams version, then make a synthetic root the active version (one transaction).
    prior_active = (q("SELECT id::text FROM app.dataset_versions WHERE layer_key = %s AND is_active", (LAYER,))
                    or [[None]])[0][0]
    restored = prior_active is None
    q("""INSERT INTO app.version_pins (version_id, holder)
         SELECT id, %s FROM app.dataset_versions WHERE layer_key = %s ON CONFLICT DO NOTHING""", (PIN, LAYER))
    pinned = True

    def make_root(cur):
        cur.execute(
            """INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
               VALUES (%s, 'ingest', %s, 'test_export_vector root', false) RETURNING id::text""",
            (LAYER, SOURCE),
        )
        rid = cur.fetchone()[0]
        for ext in DAMS:
            insert_dam(cur, rid, ext, f"dam-{ext}")
        set_active(cur, rid)
        return rid

    root_id = in_tx(make_root)

    # The owner's personal draft on it (packages/versioning/src/drafts.ts openDraft), with one dam edited.
    draft_id = q(
        """INSERT INTO app.dataset_versions
             (layer_key, kind, parent_version_id, source, label, ingested_by, is_active, draft_status, revision)
           VALUES (%s, 'edit', %s, 'draft', 'test_export_vector nháp', %s, false, 'personal', 1) RETURNING id::text""",
        (LAYER, root_id, user_id),
    )[0][0]
    with watch.cursor() as cur:
        insert_dam(cur, draft_id, EDITED, "Đập đã sửa", x=108.035, y=16.07)
    edit_id = q(
        """INSERT INTO workspace.map_layers (map_id, kind, title, position, layer_key, draft_id)
           VALUES (%s, 'edit_copy', %s, 1, 'dams', %s) RETURNING id::text""",
        (map_id, EDIT_TITLE, draft_id),
    )[0][0]

    FREE = {"layerId": free_id, "kind": "free", "title": FREE_TITLE, "style": FREE_STYLE, "geometryType": None,
            "fields": [], "editCopy": None, "shpNames": FREE_SHP_NAMES}
    EDIT = {"layerId": edit_id, "kind": "edit_copy", "title": EDIT_TITLE, "style": {}, "geometryType": "point",
            "fields": None,
            "editCopy": {"table": "water.dams", "relation": "water.dams_active", "draftId": draft_id,
                         "geomColumn": "geom", "columns": DAM_COLUMNS},
            "shpNames": DAMS_SHP_NAMES}

    # --- gpkg holds every layer, the metadata table and external ids
    row, job_id, params = export(user_id, map_id, "gpkg", CRS_WGS84, [FREE, EDIT])
    path = stored(row)
    ok = row["status"] == "succeeded" and path is not None and os.path.isfile(path)
    names = [str(n) for n, _ in pyogrio.list_layers(path)] if ok else []
    meta = pyogrio.read_dataframe(path, layer="webatlas_metadata", read_geometry=False) if ok else None
    free_df = pyogrio.read_dataframe(path, layer=FREE_SLUG) if ok else None
    edit_df = pyogrio.read_dataframe(path, layer=EDIT_SLUG) if ok else None
    check("gpkg holds every layer, the metadata table and external ids: tables",
          sorted(names) == sorted([FREE_SLUG, EDIT_SLUG, "webatlas_metadata"]))
    meta_rows = meta.sort_values("position").to_dict("records") if meta is not None else []
    check("gpkg holds every layer, the metadata table and external ids: metadata rows",
          [(m["layer_table"], m["layer_id"], m["kind"], m["title"], json.loads(m["style"]), int(m["position"]),
            m["map_title"]) for m in meta_rows]
          == [(FREE_SLUG, free_id, "free", FREE_TITLE, FREE_STYLE, 0, MAP_TITLE),
              (EDIT_SLUG, edit_id, "edit_copy", EDIT_TITLE, {}, 1, MAP_TITLE)])
    check("gpkg holds every layer, the metadata table and external ids: metadata columns",
          meta is not None and list(meta.columns) == ["layer_table", "layer_id", "kind", "title", "style", "position",
                                                      "map_title"])
    check("gpkg holds every layer, the metadata table and external ids: free layer rows and columns",
          free_df is not None and len(free_df) == 3
          and {"tên_công_trình", "ma", "ghi_chu_dai_hon"} <= set(free_df.columns)
          and sorted(free_df["tên_công_trình"]) == sorted(["Trạm bơm Hòa Phước", "Cống Cẩm Lệ", "Kênh N1"])
          and sorted(free_df.geometry.geom_type) == ["LineString", "Point", "Point"])
    by_ext = dict(zip(edit_df["external_id"].astype(str), edit_df["name"])) if edit_df is not None else {}
    check("gpkg holds every layer, the metadata table and external ids: edit copy external ids and the edit",
          edit_df is not None and sorted(by_ext) == [str(d) for d in DAMS] and by_ext.get(str(EDITED)) == "Đập đã sửa"
          and list(edit_df.columns[:len(DAM_COLUMNS) + 1]) == ["external_id", *DAM_COLUMNS])
    check("gpkg export reports its three steps done",
          [s["status"] for s in row["steps"]] == ["done", "done", "done"] and row["progress"] == 100)
    import import_vector  # noqa: E402

    check("gpkg metadata reads back through import_vector (titles, styles, positions)",
          ok and import_vector._read_metadata(path) == {
              FREE_SLUG: {"title": FREE_TITLE, "style": FREE_STYLE, "position": 0.0},
              EDIT_SLUG: {"title": EDIT_TITLE, "style": {}, "position": 1.0},
          })
    gpkg_job, gpkg_row = job_id, row

    # --- geojson of one layer is a single file in WGS 84
    row, job_id, params = export(user_id, map_id, "geojson", CRS_WGS84, [FREE])
    path = stored(row)
    ok = row["status"] == "succeeded" and path is not None and path.endswith(f"{MAP_SLUG}.geojson")
    doc = json.load(open(path, encoding="utf-8")) if ok else {}
    first = next((f for f in doc.get("features", []) if f["properties"].get("ma") == 1), None)
    check("geojson of one layer is a single file in WGS 84",
          ok and doc.get("type") == "FeatureCollection" and len(doc["features"]) == 3
          and "crs" not in doc
          and first is not None and abs(first["geometry"]["coordinates"][0] - POINT_1[0]) < 1e-7
          and abs(first["geometry"]["coordinates"][1] - POINT_1[1]) < 1e-7
          and first["properties"].get("tên_công_trình") == "Trạm bơm Hòa Phước"
          and file_row(row["result"]["fileId"]).get("content_type") == "application/geo+json")

    # --- geojson of several layers is a zip, and outside WGS 84 each file carries a crs member
    row, job_id, params = export(user_id, map_id, "geojson", CRS_TM3, [FREE, EDIT])
    path = stored(row)
    ok = row["status"] == "succeeded" and path is not None and path.endswith(f"{MAP_SLUG}.zip")
    members = unzip(path) if ok else []
    docs = {m: json.load(open(work(m), encoding="utf-8")) for m in members}
    check("geojson of several layers is a zip of one file per layer",
          members == sorted([f"{FREE_SLUG}.geojson", f"{EDIT_SLUG}.geojson"]))
    tm3_read = pyogrio.read_dataframe(work(f"{FREE_SLUG}.geojson")) if ok else None
    check("geojson outside WGS 84 carries a crs member that GDAL reads back",
          all(d.get("crs") for d in docs.values()) and tm3_read is not None
          and tm3_read.crs is not None and tm3_read.crs.equals(CRS.from_user_input(VN2000_TM3_DA_NANG)))

    # --- shapefile zip splits by geometry and uses the given short names
    row, job_id, params = export(user_id, map_id, "shp", CRS_WGS84, [FREE, EDIT])
    path = stored(row)
    ok = row["status"] == "succeeded" and path is not None and path.endswith(f"{MAP_SLUG}.zip")
    members = unzip(path) if ok else []
    expected = sorted(f"{stem}.{ext}" for stem in (f"{FREE_SLUG}_diem", f"{FREE_SLUG}_duong", f"{EDIT_SLUG}_diem")
                      for ext in ("shp", "shx", "dbf", "prj", "cpg"))
    check("shapefile zip splits by geometry and uses the given short names: the sets",
          members == expected)
    infos = {stem: pyogrio.read_info(work(f"{stem}.shp")) for stem in
             (f"{FREE_SLUG}_diem", f"{FREE_SLUG}_duong", f"{EDIT_SLUG}_diem")} if members == expected else {}
    check("shapefile zip splits by geometry and uses the given short names: dbf field names",
          bool(infos)
          and list(infos[f"{FREE_SLUG}_diem"]["fields"]) == [n["to"] for n in FREE_SHP_NAMES]
          and list(infos[f"{FREE_SLUG}_duong"]["fields"]) == [n["to"] for n in FREE_SHP_NAMES]
          and list(infos[f"{EDIT_SLUG}_diem"]["fields"]) == [n["to"] for n in DAMS_SHP_NAMES])
    check("shapefile zip splits by geometry and uses the given short names: rows per family",
          bool(infos) and infos[f"{FREE_SLUG}_diem"]["features"] == 2 and infos[f"{FREE_SLUG}_duong"]["features"] == 1
          and infos[f"{EDIT_SLUG}_diem"]["features"] == len(DAMS))
    cpgs = [open(work(m), encoding="ascii").read().strip() for m in members if m.endswith(".cpg")]
    shp_text = pyogrio.read_dataframe(work(f"{FREE_SLUG}_diem.shp")) if infos else None
    check("shapefile zip splits by geometry and uses the given short names: cpg is UTF-8 and text reads back",
          len(cpgs) == 3 and all(c == "UTF-8" for c in cpgs) and shp_text is not None
          and sorted(shp_text["ten_cong_t"]) == sorted(["Trạm bơm Hòa Phước", "Cống Cẩm Lệ"]))

    # --- vn2000 tm-3 export round-trips within a metre
    row, job_id, params = export(user_id, map_id, "gpkg", CRS_TM3, [FREE, EDIT])
    path = stored(row)
    ok = row["status"] == "succeeded" and path is not None
    back = pyogrio.read_dataframe(path, layer=FREE_SLUG) if ok else None
    dist = None
    if back is not None:
        projected = back[back["ma"] == 1].geometry.iloc[0]
        p = back[back["ma"] == 1].to_crs(4326).geometry.iloc[0]
        dist = Geod(ellps="WGS84").inv(p.x, p.y, POINT_1[0], POINT_1[1])[2]
    check("vn2000 tm-3 export round-trips within a metre",
          dist is not None and dist < 1.0 and back.crs.equals(CRS.from_user_input(VN2000_TM3_DA_NANG))
          and 500000 < projected.x < 600000)  # metres in the TM-3 zone, not degrees

    # --- the export file row expires in 7 days
    f = file_row((gpkg_row.get("result") or {}).get("fileId"))
    check("the export file row expires in 7 days",
          f.get("kind") == "export" and f.get("owner_id") == user_id
          and f.get("path") == f"exports/{user_id}/{gpkg_job}/{MAP_SLUG}.gpkg"
          and f.get("original_name") == f"{MAP_SLUG}.gpkg" and f.get("content_type") == "application/geopackage+sqlite3"
          and f.get("size_bytes") == os.path.getsize(os.path.join(STORE, *f["path"].split("/")))
          and abs(float(f.get("ttl_seconds") or 0) - 7 * 86400) < 1)

    # --- a failed export leaves no file behind
    job_id, params = run_export(user_id, map_id, "gpkg", CRS_WGS84, [FREE, EDIT])
    taken = f"exports/{user_id}/{job_id}/{MAP_SLUG}.gpkg"
    # A files row already holding the export's path: the worker's own insert fails after the file is in place.
    q("""INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
         VALUES (%s, 'export', %s, 'x', 'x', 0)""", (user_id, taken))
    row = run_job(job_id)
    job_dir = os.path.join(STORE, "exports", user_id, job_id)
    # The package step failed: the file had been renamed into place, and the files row came after.
    check("a failed export leaves no file behind",
          row["status"] == "failed" and [s["status"] for s in row["steps"]] == ["done", "done", "failed"]
          and (not os.path.isdir(job_dir) or os.listdir(job_dir) == []))

    # --- an edit copy whose draft changed since the export was queued is left out, and said so
    gone = dict(EDIT, editCopy=dict(EDIT["editCopy"], draftId=str(uuid.uuid4())))
    row, job_id, params = export(user_id, map_id, "geojson", CRS_WGS84, [FREE, gone])
    read_step = next(s for s in row["steps"] if s["key"] == "read")
    path = stored(row)
    check("an edit copy whose draft is gone is left out of the export, with a message",
          row["status"] == "succeeded" and read_step.get("message") == f'Lớp "{EDIT_TITLE}" không còn bản nháp nên không được xuất.'
          and path is not None and unzip(path) == [f"{FREE_SLUG}.geojson"])
    row, job_id, params = export(user_id, map_id, "geojson", CRS_WGS84, [gone])
    check("an export left with no layer fails with the API's message",
          row["status"] == "failed" and row["error"] == "Bản đồ không có lớp nào để xuất.")

    # --- access is checked again when the job runs (workspace.map_role)
    r_email = f"p3b-export-recipient-{uuid.uuid4().hex[:8]}@webatlas.test"
    recipient = q("INSERT INTO app.users (email, password_hash, role) VALUES (%s, 'x', 'viewer') RETURNING id::text",
                  (r_email,))[0][0]
    users.append(recipient)
    share = q("INSERT INTO workspace.map_shares (map_id, user_id) VALUES (%s, %s) RETURNING id", (map_id, recipient))[0][0]
    row, job_id, params = export(recipient, map_id, "geojson", CRS_WGS84, [FREE])
    f = file_row((row.get("result") or {}).get("fileId"))
    check("a recipient may export a map shared with them; the file is theirs",
          row["status"] == "succeeded" and f.get("owner_id") == recipient
          and f.get("path", "").startswith(f"exports/{recipient}/{job_id}/"))
    job_id, params = run_export(recipient, map_id, "geojson", CRS_WGS84, [FREE])
    q("DELETE FROM workspace.map_shares WHERE id = %s", (share,))
    row = run_job(job_id)
    job_dir = os.path.join(STORE, "exports", recipient, job_id)
    check("a recipient whose share was revoked after queueing gets nothing",
          row["status"] == "failed" and row["error"] == "Không tìm thấy bản đồ."
          and [s["status"] for s in row["steps"]] == ["failed", "pending", "pending"]
          and row["result"] is None
          and q("SELECT count(*) FROM workspace.files WHERE owner_id = %s AND path LIKE %s",
                (recipient, f"exports/{recipient}/{job_id}/%"))[0][0] == 0
          and (not os.path.isdir(job_dir) or os.listdir(job_dir) == []))
finally:
    conn.rollback()
    stages = []
    if prior_active is not None and root_id is not None:
        def restore():
            global restored
            in_tx(lambda cur: set_active(cur, prior_active))
            restored = True
        stages.append(restore)
    if pinned:
        stages.append(lambda: q("DELETE FROM app.version_pins WHERE holder = %s", (PIN,)))
    if draft_id is not None:
        # discardDraft (drafts.ts): the draft's rows, then the draft.
        stages.append(lambda: in_tx(lambda cur: (
            cur.execute("DELETE FROM water.dams WHERE dataset_version_id = %s", (draft_id,)),
            cur.execute("DELETE FROM app.dataset_versions WHERE id = %s", (draft_id,)))))
    if root_id is not None:
        def drop_root():
            # Never delete a version that is still active: the layer would have none.
            if not restored or q("SELECT is_active FROM app.dataset_versions WHERE id = %s", (root_id,))[0][0]:
                raise RuntimeError(f"synthetic root {root_id} is still active; left in place")
            in_tx(lambda cur: (
                cur.execute("DELETE FROM water.dams WHERE dataset_version_id = %s", (root_id,)),
                cur.execute("DELETE FROM app.dataset_versions WHERE id = %s", (root_id,))))
        stages.append(drop_root)
    for uid in users:
        stages.append(lambda uid=uid: q("DELETE FROM app.users WHERE id = %s", (uid,)))
    first_failure = None
    for stage in stages:
        try:
            stage()
        except Exception as e:  # run every stage; report the first failure
            print(f"cleanup failed: {e!r}")
            first_failure = first_failure or e
    conn.close()
    watch.close()
    for owner, job in job_dirs:
        remove_files_in(os.path.join(STORE, "exports", owner, job))
    for d in {os.path.join(STORE, "exports", owner) for owner, _ in job_dirs} | {os.path.join(STORE, "exports")}:
        try:
            os.rmdir(d)
        except OSError:
            pass
    remove_files_in(STORE)
    remove_files_in(WORK)
    if first_failure is not None:
        failures.append(f"cleanup: {first_failure!r}")

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
