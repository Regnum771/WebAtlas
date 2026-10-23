"""
Round trip (P3b Task 9): a map exported as a GeoPackage and imported back into a new map restores
its layer titles, styles and order, and keeps the edit-copy features' external ids.

No pytest (see flood_scenario/test_depth.py). Runs inside the atlas-tools image against the dev
database (DATABASE_URL):

    python3 packages/atlas-data/tools/workspace/test_round_trip.py

The worker's file store (WORKSPACE_FILES_DIR) is a temp directory. The check creates its own
app.users row and maps (deleting the user cascades to maps, layers, features, jobs and files rows)
and claims only its own job ids.

The edit copy needs a dams draft. Like test_export_vector.py, this file pins every existing dams
version, makes its own synthetic root (dams 901111-901120) the active version in one transaction,
and restores the prior active version in one transaction afterwards, before anything of its own is
deleted.
"""
import json
import os
import pathlib
import sys
import tempfile
import uuid

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# worker first: it configures GDAL (skipped drivers, no network) before pyogrio is imported.
import worker  # noqa: E402
import jobs_db  # noqa: E402

# packages/shared/src/crs.ts WGS84.
CRS_WGS84 = {"id": "wgs84-dd", "proj4": "+proj=longlat +datum=WGS84 +no_defs"}

EXPORT_STEPS = [
    {"key": "read", "label": "Đọc dữ liệu", "status": "pending"},
    {"key": "write", "label": "Ghi tệp", "status": "pending"},
    {"key": "package", "label": "Đóng gói", "status": "pending"},
]
IMPORT_STEPS = [
    {"key": "read", "label": "Đọc tệp", "status": "pending"},
    {"key": "transform", "label": "Chuyển hệ toạ độ", "status": "pending"},
    {"key": "write", "label": "Ghi vào bản đồ", "status": "pending"},
]

LAYER = "dams"
PIN = "test_round_trip.py"
SOURCE = "test_round_trip.py"
DAMS = list(range(901111, 901121))
EDITED = 901113
DAM_Y = 16.15
DAM_COLUMNS = ["name", "name_en", "wattage_mw", "annual_output", "year_launched", "year_operational", "status",
               "managing_unit"]


def dam_x(ext):
    return 108 + (ext - 901110) * 0.01


MAP_TITLE, MAP_SLUG = "Bản đồ khứ hồi", "ban-do-khu-hoi"
FREE_TITLE = "Trạm quan trắc mặn"
FREE_STYLE = {"color": "#e31a1c", "width": 3, "opacity": 0.8}
EDIT_TITLE = "Sửa lớp Đập & hồ chứa"
EDIT_STYLE = {"color": "#33a02c", "radius": 6}

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


STORE = tempfile.mkdtemp(prefix="p3b-roundtrip-store-")
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


def run_job(owner_id, map_id, kind, params, steps):
    """Queue a job as the API would, claim only it, and return its row."""
    job_id = q(
        """INSERT INTO workspace.jobs (owner_id, map_id, kind, params, steps)
           VALUES (%s, %s, %s, %s, %s) RETURNING id::text""",
        (owner_id, map_id, kind, json.dumps(params), json.dumps(steps)),
    )[0][0]
    if kind == "export":
        job_dirs.append((str(owner_id), job_id))
    worker.run_once(conn, only_ids=[job_id])
    with watch.cursor() as cur:
        cur.execute("SELECT status, error, result, steps FROM workspace.jobs WHERE id = %s", (job_id,))
        row = dict(zip([d[0] for d in cur.description], cur.fetchone()))
    if row["status"] != "succeeded":
        print(f"     {kind} job {job_id}: {row['status']} {row['error']} {row['steps']}")
    return row


def map_layers(map_id):
    """(id, kind, title, style) of a map's layers, in position order."""
    return q("""SELECT id::text, kind, title, style FROM workspace.map_layers
                 WHERE map_id = %s ORDER BY position""", (map_id,))


prior_active = None
root_id = None
draft_id = None
restored = False
pinned = False

try:
    # --- the source map: a styled free layer (two points and a line) and an edit copy of dams
    email = f"p3b-roundtrip-owner-{uuid.uuid4().hex[:8]}@webatlas.test"
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
    FREE_ROWS = [
        ("POINT(108.2022 16.0544)", {"tên_trạm": "Cầu Đỏ", "độ_mặn": 1.5}),
        ("POINT(108.21 16.06)", {"tên_trạm": "An Trạch", "độ_mặn": 0.4}),
        ("LINESTRING(108.2 16.0, 108.25 16.02)", {"tên_trạm": "Tuyến đo", "độ_mặn": None}),
    ]
    for wkt, props in FREE_ROWS:
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
               VALUES (%s, 'ingest', %s, 'test_round_trip root', false) RETURNING id::text""",
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
           VALUES (%s, 'edit', %s, 'draft', 'test_round_trip nháp', %s, false, 'personal', 1) RETURNING id::text""",
        (LAYER, root_id, user_id),
    )[0][0]
    with watch.cursor() as cur:
        insert_dam(cur, draft_id, EDITED, "Đập đã sửa", x=108.035, y=16.17)
    edit_id = q(
        """INSERT INTO workspace.map_layers (map_id, kind, title, position, style, layer_key, draft_id)
           VALUES (%s, 'edit_copy', %s, 1, %s, 'dams', %s) RETURNING id::text""",
        (map_id, EDIT_TITLE, json.dumps(EDIT_STYLE), draft_id),
    )[0][0]

    # --- export the map as a GeoPackage (params as jobs.ts enqueueExport writes them)
    layers = [
        {"layerId": free_id, "kind": "free", "title": FREE_TITLE, "style": FREE_STYLE, "geometryType": None,
         "fields": [], "editCopy": None, "shpNames": None},
        {"layerId": edit_id, "kind": "edit_copy", "title": EDIT_TITLE, "style": EDIT_STYLE, "geometryType": "point",
         "fields": None,
         "editCopy": {"table": "water.dams", "relation": "water.dams_active", "draftId": draft_id,
                      "geomColumn": "geom", "columns": DAM_COLUMNS},
         "shpNames": None},
    ]
    exported = run_job(user_id, map_id, "export", {
        "mapId": map_id, "ownerId": user_id, "mapTitle": MAP_TITLE, "format": "gpkg", "crs": CRS_WGS84,
        "downloadName": f"{MAP_SLUG}.gpkg", "layers": layers,
    }, EXPORT_STEPS)
    export_file = (exported.get("result") or {}).get("fileId")
    file_rows = q("SELECT path, original_name FROM workspace.files WHERE id = %s", (export_file,)) if export_file else []
    check("gpkg round trip: the export succeeds", exported["status"] == "succeeded" and len(file_rows) == 1)

    # --- import the GeoPackage into a new map (params as jobs.ts enqueueImport writes them)
    new_map = q("INSERT INTO workspace.maps (owner_id, title) VALUES (%s, %s) RETURNING id::text",
                (user_id, "Bản đồ nhập lại"))[0][0]
    imported = {"status": "not run"}
    if file_rows:
        rel_path, original_name = file_rows[0]
        imported = run_job(user_id, new_map, "import", {
            "fileId": export_file, "path": rel_path, "originalName": original_name, "mapId": new_map,
            "ownerId": user_id, "maxRows": 200000, "sourceCrs": None,
        }, IMPORT_STEPS)
    check("gpkg round trip: the import succeeds", imported["status"] == "succeeded")

    source = map_layers(map_id)
    back = map_layers(new_map)
    check("gpkg round trip restores titles, styles and external ids: titles and styles, in order",
          [(t, s) for _, _, t, s in back] == [(t, s) for _, _, t, s in source]
          == [(FREE_TITLE, FREE_STYLE), (EDIT_TITLE, EDIT_STYLE)])
    check("gpkg round trip: imported layers are free layers", [k for _, k, _, _ in back] == ["free", "free"])

    edit_back = q("SELECT properties FROM workspace.features WHERE layer_id = %s", (back[1][0],)) if len(back) == 2 else []
    props = [p for (p,) in edit_back]
    by_ext = {str(p.get("external_id")): p.get("name") for p in props}
    check("gpkg round trip restores titles, styles and external ids: every edit-copy feature keeps its external_id",
          len(props) == len(DAMS) and all(p.get("external_id") not in (None, "") for p in props)
          and sorted(by_ext) == [str(d) for d in DAMS] and by_ext.get(str(EDITED)) == "Đập đã sửa")

    free_back = q("SELECT properties FROM workspace.features WHERE layer_id = %s", (back[0][0],)) if len(back) == 2 else []
    check("gpkg round trip: the free layer's rows and Vietnamese field names come back",
          sorted(p.get("tên_trạm") for (p,) in free_back) == sorted(r[1]["tên_trạm"] for r in FREE_ROWS))
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
    if first_failure is not None:
        failures.append(f"cleanup: {first_failure!r}")

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
