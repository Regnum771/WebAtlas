"""
Checks for import_vector.py (P3b Task 6): a vector upload becomes free layers of a personal map.

No pytest (see flood_scenario/test_depth.py). Runs inside the atlas-tools image against the dev
database (DATABASE_URL):

    python3 packages/atlas-data/tools/workspace/test_import_vector.py

Fixtures are generated here with geopandas into temp directories (nothing binary is committed),
and the worker's file store (WORKSPACE_FILES_DIR) points at one of them. Every check creates its
own app.users row and map (deleting the user cascades to maps, layers, features and jobs) and
claims only its own job ids, so a live worker or another suite's queue is untouched.
"""
import base64
import datetime
import http.server
import json
import os
import pathlib
import sys
import tempfile
import threading
import time
import uuid
import warnings
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# worker first: it configures GDAL (skipped drivers, no network), which only takes effect when it
# runs before GDAL registers its drivers, i.e. before pyogrio is imported.
import worker  # noqa: E402
import jobs_db  # noqa: E402

import geopandas as gpd  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pyogrio  # noqa: E402
from pyogrio.errors import DataSourceError  # noqa: E402
from pyproj import Transformer  # noqa: E402
from shapely.geometry import LineString, Point, Polygon  # noqa: E402

# geopandas warns when a frame without a CRS is written; those fixtures are deliberate.
warnings.simplefilter("ignore", UserWarning)

# Copied verbatim from packages/shared/src/crs.ts: tm3('da-nang', ..., 107.75) with VN2000_DATUM.
VN2000_TM3_DA_NANG = (
    "+proj=tmerc +lat_0=0 +lon_0=107.75 +k=0.9999 +x_0=500000 +y_0=0 "
    "+ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 "
    "+units=m +no_defs"
)
KNOWN_LON, KNOWN_LAT = 108.2022, 16.0544

MSG_TOO_MANY = "Tệp có hơn 200.000 dòng."
MSG_NO_CRS = "Tệp không ghi hệ toạ độ; hãy chọn hệ toạ độ nguồn."
MSG_MAP_GONE = "Bản đồ không còn."
MSG_QUOTA = "Vượt hạn mức dung lượng."
MSG_UNSUPPORTED = "Định dạng tệp không được hỗ trợ."
MSG_OUT_OF_RANGE = "Toạ độ nằm ngoài phạm vi kinh độ/vĩ độ; hãy kiểm tra hệ toạ độ nguồn."

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


# --- temp directories: the worker's store and a scratch dir for generating fixtures ---------

STORE = tempfile.mkdtemp(prefix="p3b-import-store-")
WORK = tempfile.mkdtemp(prefix="p3b-import-work-")
os.environ["WORKSPACE_FILES_DIR"] = STORE


def cleanup_dir(root):
    """Remove the files directly inside root one by one, then the (now empty) directory itself."""
    real_root = os.path.realpath(root)
    for name in os.listdir(real_root):
        path = os.path.realpath(os.path.join(real_root, name))
        if os.path.dirname(path) == real_root and os.path.isfile(path):
            os.remove(path)
    try:
        os.rmdir(real_root)
    except OSError:
        pass  # something unexpected is left; leave the directory rather than recurse


def work(name):
    return os.path.join(WORK, name)


def store(name):
    return os.path.join(STORE, name)


def zip_files(zip_name, members):
    """A zip in the store holding the given (source path, archive name) pairs."""
    with zipfile.ZipFile(store(zip_name), "w", zipfile.ZIP_DEFLATED) as zf:
        for src, arcname in members:
            zf.write(src, arcname)
    return zip_name


def shapefile(stem, gdf, encoding="UTF-8"):
    """Write <stem>.shp (and sidecars) to the work dir; returns {ext: path} of what exists."""
    gdf.to_file(work(stem + ".shp"), driver="ESRI Shapefile", encoding=encoding)
    return {ext: work(f"{stem}.{ext}") for ext in ("shp", "shx", "dbf", "prj", "cpg") if os.path.exists(work(f"{stem}.{ext}"))}


# --- database --------------------------------------------------------------------------------

conn = jobs_db.connect()
watch = jobs_db.connect(autocommit=True)  # an observer outside every transaction under test
users = []


def q(sql, args=()):
    with watch.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None


def new_map(tag):
    """A fresh user and map for one check."""
    email = f"p3b-import-{tag}-{uuid.uuid4().hex[:8]}@webatlas.test"
    user_id = q("INSERT INTO app.users (email, password_hash, role) VALUES (%s, 'x', 'viewer') RETURNING id", (email,))[0][0]
    users.append(user_id)
    map_id = q("INSERT INTO workspace.maps (owner_id, title) VALUES (%s, 'P3b import') RETURNING id", (user_id,))[0][0]
    return user_id, map_id


def run_import(user_id, map_id, rel_path, original_name, **overrides):
    """Queue an import job for a file in the store, run it, and return the job row."""
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


def step(row, key):
    return next(s for s in row["steps"] if s["key"] == key)


def layers(map_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT id::text, kind, title, position, style, geometry_type, fields
                 FROM workspace.map_layers WHERE map_id = %s ORDER BY position""",
            (map_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def features(layer_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT properties, source_row, source_crs, ST_NDims(geom) AS ndims, ST_SRID(geom) AS srid,
                      ST_X(ST_PointOnSurface(geom)) AS x, ST_Y(ST_PointOnSurface(geom)) AS y
                 FROM workspace.features WHERE layer_id = %s ORDER BY source_row""",
            (layer_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def revision(map_id):
    return q("SELECT revision FROM workspace.maps WHERE id = %s", (map_id,))[0][0]


try:
    # --- geojson import makes one free layer with all columns
    user_id, map_id = new_map("geojson")
    gpd.GeoDataFrame(
        {
            "ten": ["Hồ Phú Ninh", "Hồ Kẻ Gỗ", "Hồ Dầu Tiếng"],
            "dung_tich": [344.0, 345.5, 1580.25],
            "ngay": pd.to_datetime(["2026-01-02", "2026-02-03", "2026-03-04"]).date,
        },
        geometry=[Point(108.2, 16.05), Point(105.9, 18.2), Point(106.3, 11.4)],
        crs=4326,
    ).to_file(store("ho_chua.geojson"), driver="GeoJSON")
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson")
    ls = layers(map_id)
    fs = features(ls[0]["id"]) if ls else []
    check("geojson import makes one free layer with all columns: the job succeeds",
          row["status"] == "succeeded" and row["error"] is None)
    check("geojson import: one free point layer titled after the file, no declared fields",
          len(ls) == 1 and ls[0]["kind"] == "free" and ls[0]["title"] == "ho_chua"
          and ls[0]["geometry_type"] == "point" and ls[0]["fields"] == [])
    check("geojson import: 3 features with source_row 1..3", [f["source_row"] for f in fs] == [1, 2, 3])
    p = fs[0]["properties"] if fs else {}
    check("geojson import: properties hold the three columns with their types",
          set(p) == {"ten", "dung_tich", "ngay"} and p["ten"] == "Hồ Phú Ninh"
          and isinstance(p["dung_tich"], float) and p["dung_tich"] == 344.0 and p["ngay"] == "2026-01-02")
    check("geojson import: geometry is 2D EPSG:4326 at the right place",
          fs and fs[0]["srid"] == 4326 and fs[0]["ndims"] == 2
          and abs(fs[0]["x"] - 108.2) < 1e-9 and abs(fs[0]["y"] - 16.05) < 1e-9)
    check("geojson import: source_crs is the authority code", fs and all(f["source_crs"] == "EPSG:4326" for f in fs))
    check("geojson import: the map revision is bumped once", revision(map_id) == rev0 + 1)
    check("geojson import: the result names the layer and the row count",
          row["result"] == {"layerIds": [ls[0]["id"]] if ls else None, "rows": 3})
    check("geojson import: every step is done", [s["status"] for s in row["steps"]] == ["done"] * 3)

    # --- a shapefile without .prj needs a source CRS and then lands within a metre
    user_id, map_id = new_map("noprj")
    to_tm3 = Transformer.from_crs("EPSG:4326", VN2000_TM3_DA_NANG, always_xy=True)
    x, y = to_tm3.transform(KNOWN_LON, KNOWN_LAT)
    files = shapefile("tm3", gpd.GeoDataFrame({"ten": ["Mốc"]}, geometry=[Point(x, y)]))
    check("fixture: the TM-3 shapefile has no .prj", "prj" not in files)
    zip_files("tm3.zip", [(path, f"tm3.{ext}") for ext, path in files.items()])
    row = run_import(user_id, map_id, "tm3.zip", "moc_tm3.zip")
    check("a shapefile without .prj needs a source CRS: the job fails with the exact copy",
          row["status"] == "failed" and row["error"] == MSG_NO_CRS)
    check("a shapefile without .prj: nothing is written", layers(map_id) == [])
    row = run_import(user_id, map_id, "tm3.zip", "moc_tm3.zip",
                     sourceCrs={"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG})
    ls = layers(map_id)
    check("with sourceCrs the TM-3 shapefile imports", row["status"] == "succeeded" and len(ls) == 1)
    dist = q(
        """SELECT ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography)
             FROM workspace.features f WHERE f.layer_id = %s""",
        (KNOWN_LON, KNOWN_LAT, ls[0]["id"] if ls else None),
    )
    check("a shapefile without .prj needs a source CRS and then lands within a metre",
          dist is not None and len(dist) == 1 and dist[0][0] < 1.0)
    fs = features(ls[0]["id"]) if ls else []
    check("the source CRS of a chosen proj4 is recorded as that proj4",
          fs and fs[0]["source_crs"] == VN2000_TM3_DA_NANG)
    check("a single-layer shapefile is titled after the uploaded file", ls and ls[0]["title"] == "moc_tm3")

    # --- dbf text is decoded by its cpg
    user_id, map_id = new_map("cpg")
    files = shapefile("utf8", gpd.GeoDataFrame({"ten": ["Hồ Phú Ninh"]}, geometry=[Point(108.5, 15.5)], crs=4326))
    with open(work("utf8.cpg"), "w", encoding="ascii") as f:
        f.write("UTF-8")
    files["cpg"] = work("utf8.cpg")
    zip_files("utf8_cpg.zip", [(path, f"utf8.{ext}") for ext, path in files.items()])
    zip_files("utf8_nocpg.zip", [(path, f"utf8.{ext}") for ext, path in files.items() if ext != "cpg"])
    # Windows-1258 writes Vietnamese as a base letter plus a combining tone mark.
    files = shapefile("w1258", gpd.GeoDataFrame({"ten": ["Hồ Phú Ninh"]},
                                                geometry=[Point(108.5, 15.5)], crs=4326), encoding="cp1258")
    with open(work("w1258.dbf"), "rb") as f:
        check("fixture: the cp1258 dbf holds Windows-1258 bytes", b"H\xf4\xcc Phu\xec Ninh" in f.read())
    zip_files("w1258_nocpg.zip", [(path, f"w1258.{ext}") for ext, path in files.items() if ext != "cpg"])
    zip_files("w1258_cpg.zip", [(path, f"w1258.{ext}") for ext, path in files.items()])
    for zip_name, label in (
        ("utf8_cpg.zip", "UTF-8 with a .cpg"),
        ("utf8_nocpg.zip", "UTF-8 without a .cpg"),
        ("w1258_nocpg.zip", "Windows-1258 without a .cpg"),
        ("w1258_cpg.zip", "Windows-1258 with a .cpg"),
    ):
        before = {l["id"] for l in layers(map_id)}
        row = run_import(user_id, map_id, zip_name, zip_name)
        new = [l for l in layers(map_id) if l["id"] not in before]
        fs = features(new[0]["id"]) if new else []
        check(f"dbf text is decoded by its cpg: {label} imports", row["status"] == "succeeded" and len(fs) == 1)
        check(f"dbf text is decoded by its cpg: {label} reads 'Hồ Phú Ninh' exactly",
              fs and fs[0]["properties"] == {"ten": "Hồ Phú Ninh"})

    # --- a multi-layer gpkg makes one layer per source layer
    user_id, map_id = new_map("gpkg")
    q("""INSERT INTO workspace.map_layers (map_id, kind, title, position) VALUES (%s, 'free', 'Có sẵn', 0)""", (map_id,))
    gpd.GeoDataFrame({"ten": ["a", "b"]}, geometry=[Point(108, 16), Point(108.1, 16.1)], crs=4326) \
        .to_file(store("nhieu_lop.gpkg"), layer="diem", driver="GPKG")
    gpd.GeoDataFrame({"ma": [7]}, geometry=[Polygon([(108, 16), (108.1, 16), (108.1, 16.1)])], crs=4326) \
        .to_file(store("nhieu_lop.gpkg"), layer="vung", driver="GPKG")
    gpd.GeoDataFrame({"ma": [1]}, geometry=[LineString([(108, 16), (108.2, 16.2)])], crs=32649) \
        .to_file(store("nhieu_lop.gpkg"), layer="duong_utm", driver="GPKG")
    row = run_import(user_id, map_id, "nhieu_lop.gpkg", "nhieu_lop.gpkg")
    ls = layers(map_id)
    check("a multi-layer gpkg makes one layer per source layer",
          row["status"] == "succeeded" and [l["title"] for l in ls] == ["Có sẵn", "diem", "vung", "duong_utm"])
    check("multi-layer gpkg: positions are appended after the existing layer", [l["position"] for l in ls] == [0, 1, 2, 3])
    check("multi-layer gpkg: each layer gets its geometry family",
          [l["geometry_type"] for l in ls[1:]] == ["point", "polygon", "line"])
    check("multi-layer gpkg: the result counts every row", row["result"] and row["result"]["rows"] == 4
          and row["result"]["layerIds"] == [l["id"] for l in ls[1:]])
    fs = features(ls[3]["id"]) if len(ls) == 4 else []
    check("multi-layer gpkg: a UTM layer is reprojected and records EPSG:32649",
          fs and fs[0]["source_crs"] == "EPSG:32649" and 100 < fs[0]["x"] < 120 and -1 < fs[0]["y"] < 1)

    # --- too many rows fails and writes nothing
    user_id, map_id = new_map("toomany")
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson", maxRows=2)
    check("too many rows fails with the exact copy", row["status"] == "failed" and row["error"] == MSG_TOO_MANY)
    check("too many rows fails and writes nothing", layers(map_id) == [] and revision(map_id) == rev0)

    # --- rows without geometry are skipped and reported
    user_id, map_id = new_map("nogeom")
    gpd.GeoDataFrame({"ten": ["a", "b", "c", "d"]},
                     geometry=[Point(108, 16), None, Point(108.2, 16.2), Point()], crs=4326) \
        .to_file(store("thieu.geojson"), driver="GeoJSON")
    row = run_import(user_id, map_id, "thieu.geojson", "thieu.geojson")
    ls = layers(map_id)
    fs = features(ls[0]["id"]) if ls else []
    check("rows without geometry are skipped", row["status"] == "succeeded" and [f["source_row"] for f in fs] == [1, 3])
    check("rows without geometry are reported in the transform step",
          step(row, "transform").get("message") == "Bỏ qua 2 dòng không có hình học.")
    check("skipped rows are not counted in the result", row["result"] and row["result"]["rows"] == 2)

    # --- 3D input is stored 2D
    user_id, map_id = new_map("3d")
    gpd.GeoDataFrame({"ten": ["z"]}, geometry=[LineString([(108, 16, 12.5), (108.1, 16.1, 20)])], crs=4326) \
        .to_file(store("ba_chieu.gpkg"), layer="ba_chieu", driver="GPKG")
    check("fixture: the gpkg layer is 3D", pyogrio.read_info(store("ba_chieu.gpkg"))["geometry_type"].endswith("Z"))
    row = run_import(user_id, map_id, "ba_chieu.gpkg", "ba_chieu.gpkg")
    ls = layers(map_id)
    fs = features(ls[0]["id"]) if ls else []
    check("3D input is stored 2D", row["status"] == "succeeded" and fs and fs[0]["ndims"] == 2
          and ls[0]["geometry_type"] == "line")

    # --- importing into an archived map fails with Bản đồ không còn.
    user_id, map_id = new_map("archived")
    q("UPDATE workspace.maps SET archived_at = now() WHERE id = %s", (map_id,))
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson")
    check("importing into an archived map fails with Bản đồ không còn.",
          row["status"] == "failed" and row["error"] == MSG_MAP_GONE and layers(map_id) == [])

    # --- a GeoPackage written by this app restores titles, styles and order from webatlas_metadata
    user_id, map_id = new_map("restore")
    gpd.GeoDataFrame({"ten": ["Sông Vu Gia"]}, geometry=[LineString([(108, 16), (108.2, 15.9)])], crs=4326) \
        .to_file(store("khoi_phuc.gpkg"), layer="song", driver="GPKG")
    gpd.GeoDataFrame({"external_id": ["901101"], "ten": ["Đập thử"]}, geometry=[Point(108.1, 15.8)], crs=4326) \
        .to_file(store("khoi_phuc.gpkg"), layer="dap", driver="GPKG")
    pyogrio.write_dataframe(
        pd.DataFrame({
            "layer_table": ["song", "dap"],
            "layer_id": [str(uuid.uuid4()), str(uuid.uuid4())],
            "kind": ["free", "edit_copy"],
            "title": ["Sông chính", "Đập (bản sửa)"],
            "style": [json.dumps({"color": "#1f78b4", "width": 2}), json.dumps({"color": "#e31a1c"})],
            "position": [1, 0],
            "map_title": ["Bản đồ gốc", "Bản đồ gốc"],
        }),
        store("khoi_phuc.gpkg"), layer="webatlas_metadata", driver="GPKG",
    )
    row = run_import(user_id, map_id, "khoi_phuc.gpkg", "khoi_phuc.gpkg")
    ls = layers(map_id)
    check("a gpkg from this app restores titles in the saved order",
          row["status"] == "succeeded" and [l["title"] for l in ls] == ["Đập (bản sửa)", "Sông chính"])
    check("a gpkg from this app restores styles",
          [l["style"] for l in ls] == [{"color": "#e31a1c"}, {"color": "#1f78b4", "width": 2}])
    check("a gpkg from this app imports every layer as free", all(l["kind"] == "free" for l in ls))
    fs = features(ls[0]["id"]) if ls else []
    check("external_id stays a plain property", fs and fs[0]["properties"] == {"external_id": "901101", "ten": "Đập thử"})

    # --- over the quota, everything is rolled back
    user_id, map_id = new_map("quota")
    q("UPDATE app.users SET quota_bytes = 10 WHERE id = %s", (user_id,))
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson")
    check("an import over the quota fails with the exact copy", row["status"] == "failed" and row["error"] == MSG_QUOTA)
    check("an import over the quota writes nothing", layers(map_id) == [] and revision(map_id) == rev0)

    # --- an archived map's original imported again: only a successful import clears its date
    def upload_row(owner):
        """A workspace.files upload row expiring in 30 days (an archived map's original)."""
        return q(
            """INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
               VALUES (%s, 'upload', %s, 'ho_chua.geojson', 'application/geo+json', 1, now() + interval '30 days')
               RETURNING id::text""",
            (owner, f"uploads/{owner}/{uuid.uuid4()}/original.geojson"),
        )[0][0]

    def delete_after(file_id):
        return q("SELECT delete_after FROM workspace.files WHERE id = %s", (file_id,))[0][0]

    # The quota check fails this one: the date is kept, so the sweep removes the file when due.
    failed_file = upload_row(user_id)
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson", fileId=failed_file)
    check("a failed import keeps its upload's delete_after",
          row["status"] == "failed" and delete_after(failed_file) is not None)
    user_id, map_id = new_map("keep")
    kept_file = upload_row(user_id)
    row = run_import(user_id, map_id, "ho_chua.geojson", "ho_chua.geojson", fileId=kept_file)
    check("a successful import clears its upload's delete_after (it feeds a live map again)",
          row["status"] == "succeeded" and delete_after(kept_file) is None)

    # --- a zip is read in place; unsafe entries are ignored
    user_id, map_id = new_map("zip")
    files = shapefile("an_toan", gpd.GeoDataFrame({"ten": ["ok"]}, geometry=[Point(108, 16)], crs=4326))
    with zipfile.ZipFile(store("lan.zip"), "w") as zf:
        for ext, path in files.items():
            zf.write(path, f"thu_muc/an_toan.{ext}")
            zf.write(path, f"../thoat.{ext}")
            link = zipfile.ZipInfo(f"lien_ket.{ext}")
            link.create_system = 3
            link.external_attr = (0o120777 << 16)
            zf.writestr(link, f"/etc/passwd.{ext}")
    row = run_import(user_id, map_id, "lan.zip", "lan.zip")
    ls = layers(map_id)
    check("a zip with traversal and symlink entries imports only the safe shapefile",
          row["status"] == "succeeded" and [l["title"] for l in ls] == ["lan"])
    check("nothing is extracted next to the zip", sorted(n for n in os.listdir(STORE) if "thoat" in n or "lien_ket" in n) == [])

    # --- a kml makes one layer per folder
    user_id, map_id = new_map("kml")
    with open(store("tram.kml"), "w", encoding="utf-8") as f:
        f.write("""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Trạm đo</name>
<Placemark><name>T1</name><Point><coordinates>108.2,16.0,5</coordinates></Point></Placemark>
<Placemark><name>T2</name><Point><coordinates>108.3,16.1</coordinates></Point></Placemark>
</Folder>
<Folder><name>Tuyến</name>
<Placemark><name>L1</name><LineString><coordinates>108,16 108.1,16.1</coordinates></LineString></Placemark>
</Folder></Document></kml>""")
    row = run_import(user_id, map_id, "tram.kml", "tram.kml")
    ls = layers(map_id)
    check("a kml makes one layer per folder",
          row["status"] == "succeeded" and [l["title"] for l in ls] == ["Trạm đo", "Tuyến"]
          and [l["geometry_type"] for l in ls] == ["point", "line"])

    # --- a projected geojson without crs is refused by the bounds check
    user_id, map_id = new_map("bounds")
    gpd.GeoDataFrame({"ten": ["mét"]}, geometry=[Point(500000, 1800000)]) \
        .to_file(store("met.geojson"), driver="GeoJSON")
    with open(store("met.geojson"), encoding="utf-8") as f:
        check("fixture: the metre geojson has no crs member", '"crs"' not in f.read())
    rev0 = revision(map_id)
    row = run_import(user_id, map_id, "met.geojson", "met.geojson")
    check("a projected geojson without crs is refused by the bounds check",
          row["status"] == "failed" and row["error"] == MSG_OUT_OF_RANGE)
    check("the bounds check writes nothing", layers(map_id) == [] and revision(map_id) == rev0)

    # --- a layer with no geometry is skipped
    user_id, map_id = new_map("emptylayer")
    gpd.GeoDataFrame({"ten": ["a"]}, geometry=[Point(108, 16)], crs=4326) \
        .to_file(store("co_trong.gpkg"), layer="co_hinh", driver="GPKG")
    gpd.GeoDataFrame({"ten": ["b", "c"]}, geometry=gpd.GeoSeries([None, None]), crs=4326) \
        .to_file(store("co_trong.gpkg"), layer="trong", driver="GPKG", geometry_type="Point")
    check("fixture: the empty gpkg layer is spatial",
          dict((str(n), g) for n, g in pyogrio.list_layers(store("co_trong.gpkg"))).get("trong") is not None)
    row = run_import(user_id, map_id, "co_trong.gpkg", "co_trong.gpkg")
    ls = layers(map_id)
    check("a layer with no geometry is skipped",
          row["status"] == "succeeded" and [l["title"] for l in ls] == ["co_trong"]
          and row["result"] == {"layerIds": [ls[0]["id"]] if ls else None, "rows": 1})
    check("a skipped layer is reported in the read step",
          step(row, "read").get("message") == 'Bỏ qua lớp "trong" vì không có hình học.')
    gpd.GeoDataFrame({"ten": ["b"]}, geometry=gpd.GeoSeries([None]), crs=4326) \
        .to_file(store("chi_trong.gpkg"), layer="trong", driver="GPKG", geometry_type="Point")
    row = run_import(user_id, map_id, "chi_trong.gpkg", "chi_trong.gpkg")
    check("a file whose every layer lacks geometry is refused",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and len(layers(map_id)) == 1)

    # --- a projected geojson without crs plus sourceCrs lands within a metre
    user_id, map_id = new_map("geojson-tm3")
    gpd.GeoDataFrame({"ten": ["Mốc"]}, geometry=[Point(x, y)]).to_file(store("moc_tm3.geojson"), driver="GeoJSON")
    with open(store("moc_tm3.geojson"), encoding="utf-8") as f:
        check("fixture: the TM-3 geojson has no crs member", '"crs"' not in f.read())
    row = run_import(user_id, map_id, "moc_tm3.geojson", "moc_tm3.geojson",
                     sourceCrs={"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG})
    ls = layers(map_id)
    dist = q(
        """SELECT ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography), f.source_crs
             FROM workspace.features f WHERE f.layer_id = %s""",
        (KNOWN_LON, KNOWN_LAT, ls[0]["id"] if ls else None),
    )
    check("a projected geojson without crs plus sourceCrs lands within a metre",
          row["status"] == "succeeded" and dist is not None and len(dist) == 1 and dist[0][0] < 1.0
          and dist[0][1] == VN2000_TM3_DA_NANG)
    user_id, map_id = new_map("geojson-declared")
    gpd.GeoDataFrame({"ma": [1]}, geometry=[Point(108.2, 16.0)], crs=4326).to_crs(32649) \
        .to_file(store("utm_khai_bao.geojson"), driver="GeoJSON")
    row = run_import(user_id, map_id, "utm_khai_bao.geojson", "utm_khai_bao.geojson",
                     sourceCrs={"id": "vn2000-tm3-da-nang", "proj4": VN2000_TM3_DA_NANG})
    ls = layers(map_id)
    fs = features(ls[0]["id"]) if ls else []
    check("a geojson that declares a projected crs keeps it over sourceCrs",
          row["status"] == "succeeded" and fs and fs[0]["source_crs"] == "EPSG:32649"
          and abs(fs[0]["x"] - 108.2) < 1e-6 and abs(fs[0]["y"] - 16.0) < 1e-6)

    # --- GDAL is configured to open no VRT and fetch nothing
    drivers = pyogrio.list_drivers()
    check("GDAL drivers the worker never needs are skipped",
          not any(d in drivers for d in ("VRT", "OGR_VRT", "WFS", "OAPIF", "WMS", "WMTS", "CSV", "SQLite", "HTTP"))
          and all(d in drivers for d in ("GPKG", "GeoJSON", "KML", "ESRI Shapefile")))
    t0 = time.monotonic()
    try:
        pyogrio.read_info("/vsicurl/https://example.com/webatlas-probe.geojson")
        refused = False
    except DataSourceError as e:
        refused = "HTTP" not in str(e)  # refused before any request, not answered by the server
    check("/vsicurl/ is refused without a request", refused and time.monotonic() - t0 < 5)

    # --- a geojson crs link does not reach the network
    hits = []

    class Listener(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (http.server's name)
            hits.append(self.path)
            body = b'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    listener = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Listener)
    threading.Thread(target=listener.serve_forever, daemon=True).start()
    try:
        port = listener.server_address[1]
        user_id, map_id = new_map("crslink")
        for crs_type in ("link", "url"):
            name = f"crs_{crs_type}.geojson"
            with open(store(name), "w", encoding="utf-8") as f:
                json.dump({
                    "type": "FeatureCollection",
                    "crs": {"type": crs_type, "properties": {"href": f"http://127.0.0.1:{port}/crs-{crs_type}",
                                                             "url": f"http://127.0.0.1:{port}/crs-{crs_type}"}},
                    "features": [{"type": "Feature", "properties": {"ten": "a"},
                                  "geometry": {"type": "Point", "coordinates": [108.2, 16.0]}}],
                }, f)
            run_import(user_id, map_id, name, name)
        print(f"     (the listener saw {len(hits)} request(s): {hits})")
        check("a geojson crs link does not reach the network", hits == [])
    finally:
        listener.shutdown()
        listener.server_close()

    # --- a geojson holding VRT XML that points at another store file is refused
    user_id, map_id = new_map("vrt")
    gpd.GeoDataFrame({"bi_mat": ["của người khác"]}, geometry=[Point(108, 16)], crs=4326) \
        .to_file(store("nan_nhan.geojson"), driver="GeoJSON")
    # A declared geometry type, so the VRT layer lists as spatial and would be imported.
    vrt = (f'<OGRVRTDataSource><OGRVRTLayer name="lay"><SrcDataSource>{store("nan_nhan.geojson")}</SrcDataSource>'
           f'<SrcLayer>nan_nhan</SrcLayer><GeometryType>wkbPoint</GeometryType><LayerSRS>EPSG:4326</LayerSRS>'
           f'</OGRVRTLayer></OGRVRTDataSource>')
    with open(store("tan_cong.geojson"), "w", encoding="utf-8") as f:
        f.write(vrt)
    row = run_import(user_id, map_id, "tan_cong.geojson", "tan_cong.geojson")
    check("a geojson holding VRT XML that points at another store file is refused",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])
    with open(store("tan_cong.kml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0"?>\n<!-- kml -->\n' + vrt)
    row = run_import(user_id, map_id, "tan_cong.kml", "tan_cong.kml")
    check("a kml whose root is not <kml> is refused",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])
    with zipfile.ZipFile(store("tan_cong.zip"), "w") as zf:
        zf.writestr("lay.shp", vrt)
        zf.writestr("lay.dbf", b"")
    row = run_import(user_id, map_id, "tan_cong.zip", "tan_cong.zip")
    check("a zipped .shp that is not a shapefile is refused",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])
    with open(store("gia.gpkg"), "w", encoding="utf-8") as f, open(store("nan_nhan.geojson"), encoding="utf-8") as g:
        f.write(g.read())
    row = run_import(user_id, map_id, "gia.gpkg", "gia.gpkg")
    check("a .gpkg-named file holding GeoJSON is refused by the magic check",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])
    with open(store("esri.json"), "w", encoding="utf-8") as f:
        json.dump({"geometryType": "esriGeometryPoint", "spatialReference": {"wkid": 4326},
                   "fields": [{"name": "ma", "type": "esriFieldTypeInteger"}],
                   "features": [{"attributes": {"ma": 1}, "geometry": {"x": 108, "y": 16}}]}, f)
    check("fixture: GDAL reads the .json as ESRIJSON", pyogrio.read_info(store("esri.json"))["driver"] == "ESRIJSON")
    row = run_import(user_id, map_id, "esri.json", "esri.json")
    check("a .json read by a driver other than GeoJSON is refused by the driver allowlist",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])

    # --- the import handler dispatches on the extension
    user_id, map_id = new_map("dispatch")
    with open(store("anh.tif"), "wb") as f:
        f.write(b"II*\x00")
    row = run_import(user_id, map_id, "anh.tif", "anh.tif")
    check("a .tif goes to the raster import, which refuses a bare TIFF header",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED)
    with open(store("bang.csv"), "w", encoding="utf-8") as f:
        f.write("a,b\n1,2\n")
    row = run_import(user_id, map_id, "bang.csv", "bang.csv")
    check("an extension neither import reads is refused",
          row["status"] == "failed" and row["error"] == MSG_UNSUPPORTED and layers(map_id) == [])

    # --- property values become plain JSON
    import import_vector  # noqa: E402

    jv = import_vector.json_value
    out = json.loads(json.dumps([
        jv(np.int64(7)), jv(np.float32(1.5)), jv(np.bool_(True)), jv(float("nan")), jv(float("inf")),
        jv(pd.NaT), jv(pd.NA), jv(None), jv(pd.Timestamp("2026-10-21 08:30:00")),
        jv(datetime.date(2026, 10, 21)), jv(b"\x00\x01"), jv(np.array([1, 2], dtype=np.int32)), jv("a\x00b"),
    ], allow_nan=False))
    check("property values become plain JSON (numpy, NaN/NaT, dates, bytes as base64, lists, NUL)",
          out == [7, 1.5, True, None, None, None, None, None, "2026-10-21T08:30:00", "2026-10-21",
                  base64.b64encode(b"\x00\x01").decode("ascii"), [1, 2], "ab"])
finally:
    conn.rollback()
    for uid in users:
        q("DELETE FROM app.users WHERE id = %s", (uid,))
    conn.close()
    watch.close()
    cleanup_dir(STORE)
    cleanup_dir(WORK)

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
