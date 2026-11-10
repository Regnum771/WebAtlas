"""
Checks for import_timeseries.py (S1 Task 6): the `timeseries_import` job turns an uploaded series
(a zip of GeoTIFFs, a NetCDF file, a HEC-RAS .hdf) into time-step COGs under TIMESERIES_DIR,
publishes and registers them, and writes their catalogue.resources rows.

No pytest. Runs inside the atlas-tools image against the dev database (DATABASE_URL), with the
catalogue migration applied:

    python3 packages/atlas-data/tools/workspace/test_import_timeseries.py

GeoServer and GeoNode are never called: the handler reaches them only through its module
attributes publish, publish_single, unpublish and register, which these checks replace with
recording fakes. The FABDEM read for the HEC-RAS case is real (basemap.dem_region; an empty
table only makes every pixel nodata). The suite creates its own app.users row (deleting it
cascades to its jobs and files rows), deletes the catalogue rows of its own owner subject, and
claims only its own job ids.
"""
import json
import os
import pathlib
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))  # tools/, for the timeseries package

# worker first: it configures GDAL before rasterio registers its drivers.
import worker  # noqa: E402
import jobs_db  # noqa: E402
import import_timeseries  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.transform import from_bounds  # noqa: E402

from timeseries import dem as demmod  # noqa: E402
from timeseries import geonode_bridge  # noqa: E402
from timeseries.fixtures import make_nc_fixture, make_ras_fixture  # noqa: E402

UTC = timezone.utc
MSG_REGISTER = "Không đưa được lên Danh mục; thử lại sau."
MSG_DONE_BEFORE = "Tệp này đã được đưa lên Danh mục."
HDF_LABEL = "(nội suy từ .hdf trên FABDEM)"
STEPS = [
    {"key": "read", "label": "Đọc tệp", "status": "pending"},
    {"key": "transform", "label": "Tạo các bước thời gian", "status": "pending"},
    {"key": "publish", "label": "Đưa lên Danh mục", "status": "pending"},
]
TIF_BOUNDS = (108.0, 15.9, 108.064, 15.964)
NC_CLIP = (107.2, 14.9, 108.8, 16.2)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


# --- the store and the time-series folder, in temp directories ----------------------------------

STORE = tempfile.mkdtemp(prefix="s1-ts-store-")
TS_DIR = tempfile.mkdtemp(prefix="s1-ts-out-")
os.environ["WORKSPACE_FILES_DIR"] = STORE
os.environ["TIMESERIES_DIR"] = TS_DIR
GS_DIR = os.environ.setdefault("GEOSERVER_TIMESERIES_DIR", "/webatlas-timeseries")


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


def listing(*parts):
    d = os.path.join(TS_DIR, *parts)
    return sorted(os.listdir(d)) if os.path.isdir(d) else None


def geotiff(path, value, bounds=TIF_BOUNDS, size=16):
    data = np.full((1, size, size), value, dtype="float32")
    data[0, 0, 0] = -9999.0
    with rasterio.open(path, "w", driver="GTiff", width=size, height=size, count=1, dtype="float32",
                       crs="EPSG:4326", transform=from_bounds(*bounds, size, size), nodata=-9999.0) as dst:
        dst.write(data)


def tif_zip(names):
    """A zip in the store holding one GeoTIFF per name; returns its store-relative path."""
    rel = f"up/{uuid.uuid4()}.zip"
    os.makedirs(os.path.join(STORE, "up"), exist_ok=True)
    work = tempfile.mkdtemp(prefix="s1-ts-src-")
    with zipfile.ZipFile(os.path.join(STORE, rel), "w") as z:
        for i, n in enumerate(names):
            p = os.path.join(work, n)
            geotiff(p, float(i + 1))
            z.write(p, f"series/{n}")
    remove_files_in(work)
    return rel


# --- fakes for GeoServer and GeoNode -------------------------------------------------------------

calls = {"publish": [], "publish_single": [], "unpublish": [], "register": []}
fail_register_on = {"n": None}  # 1-based index of the register call that raises, or None


def fake_publish(name, variable):
    calls["publish"].append((name, variable))
    return f"geonode:{name}"


def fake_publish_single(name, gs_file, variable):
    calls["publish_single"].append((name, gs_file, variable))
    return f"geonode:{name}"


def fake_unpublish(name):
    calls["unpublish"].append(name)


def fake_register(name, title, abstract, owner):
    calls["register"].append((name, title, abstract, dict(owner)))
    if fail_register_on["n"] == len(calls["register"]):
        raise geonode_bridge.BridgeError(502, "GeoNode chưa sẵn sàng")
    return {"pk": 900000 + int(uuid.uuid4().int % 90000), "uuid": str(uuid.uuid4()), "alternate": f"geonode:{name}"}


import_timeseries.publish = fake_publish
import_timeseries.publish_single = fake_publish_single
import_timeseries.unpublish = fake_unpublish
import_timeseries.register = fake_register


def reset_calls(fail_on=None):
    for v in calls.values():
        v.clear()
    fail_register_on["n"] = fail_on


# --- database ------------------------------------------------------------------------------------

conn = jobs_db.connect()
watch = jobs_db.connect(autocommit=True)  # an observer outside every transaction under test
SUB = f"s1-ts-sub-{uuid.uuid4().hex[:12]}"
EMAIL = f"s1-ts-{uuid.uuid4().hex[:8]}@webatlas.test"
OWNER = {"sub": SUB, "username": "kiem-thu", "email": EMAIL}


def q(sql, args=()):
    with watch.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None


def run_job(rel_path, original_name, source, file_id=None, **overrides):
    file_id = file_id or str(uuid.uuid4())
    params = {
        "fileId": file_id, "path": rel_path, "originalName": original_name, "ownerId": str(user_id),
        "owner": OWNER, "title": "Mưa tháng 10", "abstract": "Thử nghiệm", "source": source,
        "timePattern": None, "timesCsvPath": None, "hdfArea": None, "every": 4, "clip4326": None,
        **overrides,
    }
    job_id = q(
        """INSERT INTO workspace.jobs (owner_id, kind, params, steps)
           VALUES (%s, 'timeseries_import', %s, %s) RETURNING id""",
        (user_id, json.dumps(params), json.dumps(STEPS)),
    )[0][0]
    worker.run_once(conn, only_ids=[job_id])
    with watch.cursor() as cur:
        cur.execute("SELECT status, error, result, steps FROM workspace.jobs WHERE id = %s", (job_id,))
        cols = [d[0] for d in cur.description]
        row = dict(zip(cols, cur.fetchone()))
    row["name"] = f"ts_{file_id[:8]}"
    return row


def rows():
    with watch.cursor() as cur:
        cur.execute(
            """SELECT id::text, geonode_pk, geonode_uuid::text, alternate, kind, title, abstract, owner_sub,
                      managing_unit, is_published, is_approved, variable, unit, time_steps, bbox4326, origin
                 FROM catalogue.resources WHERE owner_sub = %s ORDER BY kind DESC, created_at""",
            (SUB,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def clear_rows():
    q("DELETE FROM catalogue.resources WHERE owner_sub = %s", (SUB,))


def close_to(a, b, tol):
    return a is not None and len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def step_status(row):
    return {s["key"]: s["status"] for s in row["steps"]}


user_id = q(
    "INSERT INTO app.users (email, password_hash, role, oidc_subject) VALUES (%s, 'x', 'viewer', %s) RETURNING id",
    (EMAIL, SUB),
)[0][0]
names_made = []
original_read_dem = demmod.read_dem
try:
    # --- the handler is registered for the job kind
    check("worker.HANDLERS has timeseries_import",
          worker.HANDLERS.get("timeseries_import") is import_timeseries.run_timeseries_import)

    # --- a zip of three daily GeoTIFFs
    reset_calls()
    rel = tif_zip(["r_20251025.tif", "r_20251026.tif", "r_20251027.tif"])
    row = run_job(rel, "mua.zip", "geotiff", timePattern="YYYYMMDD")
    name = row["name"]
    names_made.append(name)
    check("geotiff zip: job succeeds", row["status"] == "succeeded")
    if row["status"] != "succeeded":
        print("     error:", row["error"])
    check("geotiff zip: every step done",
          step_status(row) == {"read": "done", "transform": "done", "publish": "done"})
    expect_files = [f"{name}_2025102{d}T000000Z.tif" for d in (5, 6, 7)]
    check("geotiff zip: three COGs under TIMESERIES_DIR/<name>/", listing(name) == expect_files)
    if listing(name):
        with rasterio.open(os.path.join(TS_DIR, name, expect_files[0])) as cog:
            check("geotiff zip: a step is a float32 EPSG:3857 COG with nodata -9999 and overviews",
                  cog.crs.to_epsg() == 3857 and cog.dtypes[0] == "float32" and cog.nodata == -9999.0
                  and cog.overviews(1) != [])
    found = rows()
    check("geotiff zip: one catalogue row", len(found) == 1)
    r = found[0] if found else {}
    expected_unit = q("SELECT catalogue.unit_for_bbox(%s, %s, %s, %s)", TIF_BOUNDS)[0][0]
    check("geotiff zip: row kind timeseries, origin webatlas-upload, unpublished and unapproved",
          r.get("kind") == "timeseries" and r.get("origin") == "webatlas-upload"
          and r.get("is_published") is False and r.get("is_approved") is False)
    check("geotiff zip: three time steps, in order",
          r.get("time_steps") == [datetime(2025, 10, d, tzinfo=UTC) for d in (25, 26, 27)])
    check("geotiff zip: managing unit is unit_for_bbox of the extent",
          r.get("managing_unit") == expected_unit and expected_unit is not None)
    check("geotiff zip: bbox4326 is the extent", close_to(r.get("bbox4326"), TIF_BOUNDS, 1e-6))
    check("geotiff zip: variable 'value', no unit", r.get("variable") == "value" and r.get("unit") is None)
    check("geotiff zip: owner, title, abstract, alternate",
          r.get("owner_sub") == SUB and r.get("title") == "Mưa tháng 10" and r.get("abstract") == "Thử nghiệm"
          and r.get("alternate") == f"geonode:{name}")
    check("geotiff zip: publish called once with (name, 'value')", calls["publish"] == [(name, "value")])
    check("geotiff zip: register called with the owner dict",
          calls["register"] == [(name, "Mưa tháng 10", "Thử nghiệm", OWNER)])
    check("geotiff zip: no single-raster publish, nothing unpublished",
          calls["publish_single"] == [] and calls["unpublish"] == [])
    check("geotiff zip: result {resourceId, alternate, steps}",
          row["result"] == {"resourceId": r.get("id"), "alternate": f"geonode:{name}", "steps": 3})
    check("geotiff zip: name is ts_ + the first 8 characters of fileId",
          name.startswith("ts_") and len(name) == 11)

    # --- the same upload again: refused, the published series untouched
    reset_calls()
    file_id = row["name"][3:] + str(uuid.uuid4())[8:]
    again = run_job(rel, "mua.zip", "geotiff", file_id=file_id, timePattern="YYYYMMDD")
    check("an upload already in the catalogue is refused with the exact copy",
          again["status"] == "failed" and again["error"] == MSG_DONE_BEFORE)
    check("... and its series, row and stores are left alone",
          listing(name) == expect_files and len(rows()) == 1 and calls["unpublish"] == [] and calls["publish"] == [])
    clear_rows()

    # --- a leftover folder from a stopped run: only this run's steps are in the mosaic folder
    reset_calls()
    file_id = str(uuid.uuid4())
    left = f"ts_{file_id[:8]}"
    names_made.append(left)
    os.makedirs(os.path.join(TS_DIR, left))
    for stale in (f"{left}_19990101T000000Z.tif", "indexer.properties"):
        with open(os.path.join(TS_DIR, left, stale), "w") as f:
            f.write("stale")
    row = run_job(tif_zip(["r_20251025.tif", "r_20251026.tif"]), "mua.zip", "geotiff",
                  file_id=file_id, timePattern="YYYYMMDD")
    check("a stopped run's leftover step files are cleared before the new steps are written",
          row["status"] == "succeeded"
          and listing(left) == [f"{left}_20251025T000000Z.tif", f"{left}_20251026T000000Z.tif"])
    clear_rows()

    # --- file names that do not match the pattern: the job fails and writes nothing
    reset_calls()
    row = run_job(tif_zip(["r_20251025.tif", "r_khong_ngay.tif"]), "mua.zip", "geotiff", timePattern="YYYYMMDD")
    names_made.append(row["name"])
    check("a file with no time fails the job naming it",
          row["status"] == "failed" and row["error"] is not None and "r_khong_ngay.tif" in row["error"])
    check("... and leaves no folder, no row, no publish",
          listing(row["name"]) is None and rows() == [] and calls["publish"] == [])

    # --- registration fails: the job fails, the folder and the store go, no row
    reset_calls(fail_on=1)
    row = run_job(tif_zip(["r_20251025.tif", "r_20251026.tif", "r_20251027.tif"]), "mua.zip", "geotiff",
                  timePattern="YYYYMMDD")
    names_made.append(row["name"])
    check("registration raising fails the job with the exact copy",
          row["status"] == "failed" and row["error"] == MSG_REGISTER)
    check("... the publish step is the failed one", step_status(row).get("publish") == "failed")
    check("... the COG folder is removed (on_rollback)", listing(row["name"]) is None)
    check("... the published mosaic is deleted again", calls["unpublish"] == [row["name"]])
    check("... and no catalogue row is written", rows() == [])

    # --- a NetCDF file clipped to the basin
    reset_calls()
    nc_rel = f"up/{uuid.uuid4()}.nc"
    make_nc_fixture.build(os.path.join(STORE, nc_rel))
    row = run_job(nc_rel, "mswep_20261027.nc", "netcdf", clip4326=list(NC_CLIP))
    names_made.append(row["name"])
    check("netcdf: job succeeds", row["status"] == "succeeded")
    if row["status"] != "succeeded":
        print("     error:", row["error"])
    check("netcdf: one step COG", listing(row["name"]) == [f"{row['name']}_20261027T000000Z.tif"])
    found = rows()
    r = found[0] if found else {}
    check("netcdf: variable 'rain', unit 'mm/d'", r.get("variable") == "rain" and r.get("unit") == "mm/d")
    check("netcdf: one time step", r.get("time_steps") == [datetime(2026, 10, 27, tzinfo=UTC)])
    check("netcdf: bbox is the clip (to the pixel edges)", close_to(r.get("bbox4326"), NC_CLIP, 0.1))
    check("netcdf: published with (name, 'rain')", calls["publish"] == [(row["name"], "rain")])
    clear_rows()

    # --- the HEC-RAS fixture, hourly from 15-minute output
    reset_calls()
    hdf_rel = f"up/{uuid.uuid4()}.hdf"
    wse = np.full((9, 5), 10.0)
    make_ras_fixture.build(os.path.join(STORE, hdf_rel), wse=wse)
    row = run_job(hdf_rel, "lu.p01.hdf", "hecras", title="Lũ tháng 10", every=4)
    name = row["name"]
    names_made += [name, f"{name}_peak"]
    check("hecras: job succeeds", row["status"] == "succeeded")
    if row["status"] != "succeeded":
        print("     error:", row["error"])
    check("hecras: three hourly steps in the mosaic folder (and nothing else)",
          listing(name) == [f"{name}_20251025T0{h}0000Z.tif" for h in (0, 1, 2)])
    check("hecras: the peak raster sits in its own folder beside the mosaic",
          listing(f"{name}_peak") == [f"{name}_peak.tif"])
    found = rows()
    check("hecras: two catalogue rows", len(found) == 2)
    ts = next((x for x in found if x["kind"] == "timeseries"), {})
    peak = next((x for x in found if x["kind"] == "raster"), {})
    check("hecras: series row variable 'depth', unit 'm', title with the FABDEM label",
          ts.get("variable") == "depth" and ts.get("unit") == "m" and ts.get("title") == f"Lũ tháng 10 {HDF_LABEL}")
    check("hecras: series row has the three step times",
          ts.get("time_steps") == [datetime(2025, 10, 25, h, tzinfo=UTC) for h in (0, 1, 2)])
    check("hecras: peak row is a raster titled '<title> – độ sâu lớn nhất'",
          peak.get("title") == "Lũ tháng 10 – độ sâu lớn nhất" and peak.get("alternate") == f"geonode:{name}_peak"
          and peak.get("variable") == "depth" and peak.get("unit") == "m" and peak.get("origin") == "webatlas-upload"
          and peak.get("is_published") is False)
    check("hecras: peak published with publish_single from its sibling folder",
          calls["publish_single"] == [(f"{name}_peak", f"{GS_DIR.rstrip('/')}/{name}_peak/{name}_peak.tif", "depth")])
    check("hecras: mosaic published with (name, 'depth')", calls["publish"] == [(name, "depth")])
    check("hecras: both registered for the owner",
          [c[0] for c in calls["register"]] == [name, f"{name}_peak"] and all(c[3] == OWNER for c in calls["register"]))
    check("hecras: series bbox lies around the fixture (UTM 49N ~ 108.2 E, 15.4 N)",
          ts.get("bbox4326") is not None and 107.5 < ts["bbox4326"][0] < 109 and 15 < ts["bbox4326"][1] < 16)
    clear_rows()

    # --- HEC-RAS: the peak's registration fails, so both stores and both folders go
    reset_calls(fail_on=2)
    row = run_job(hdf_rel, "lu.p01.hdf", "hecras", title="Lũ tháng 10", every=4)
    names_made += [row["name"], f"{row['name']}_peak"]
    check("hecras: a failed peak registration fails the job with the exact copy",
          row["status"] == "failed" and row["error"] == MSG_REGISTER)
    check("... both folders are removed",
          listing(row["name"]) is None and listing(f"{row['name']}_peak") is None)
    check("... both stores are deleted again, the peak's first",
          calls["unpublish"] == [f"{row['name']}_peak", row["name"]])
    check("... and no catalogue row is written", rows() == [])

    # --- HEC-RAS: a DEM grid that does not line up with the cell grid stops the job
    reset_calls()
    demmod.read_dem = lambda c, bounds, crs_wkt, res=30.0: (
        lambda arr, tr: (arr[:-1], tr))(*original_read_dem(c, bounds, crs_wkt, res))
    try:
        row = run_job(hdf_rel, "lu.p01.hdf", "hecras", title="Lũ tháng 10", every=4)
    finally:
        demmod.read_dem = original_read_dem
    names_made += [row["name"], f"{row['name']}_peak"]
    check("hecras: a DEM grid unlike the cell grid fails the job before any step is written",
          row["status"] == "failed" and listing(row["name"]) is None and calls["publish"] == [])

    # --- a time-series upload does not count toward the quota
    before = q("SELECT workspace.usage_bytes(%s)", (user_id,))[0][0]
    q("""INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, purpose)
         VALUES (%s, 'upload', %s, 'lu.p01.hdf', 'application/x-hdf5', 1500000000, 'timeseries')""",
      (user_id, f"up/{uuid.uuid4()}.hdf"))
    after = q("SELECT workspace.usage_bytes(%s)", (user_id,))[0][0]
    check("usage_bytes is unchanged by a purpose='timeseries' file", after == before)
    q("""INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
         VALUES (%s, 'upload', %s, 'a.geojson', 'application/geo+json', 1000)""",
      (user_id, f"up/{uuid.uuid4()}.geojson"))
    check("... while a map upload still counts", q("SELECT workspace.usage_bytes(%s)", (user_id,))[0][0] == before + 1000)
finally:
    conn.rollback()
    clear_rows()
    q("DELETE FROM app.users WHERE id = %s", (user_id,))
    conn.close()
    watch.close()
    for n in names_made:
        remove_files_in(os.path.join(TS_DIR, n))
    remove_files_in(TS_DIR)
    remove_files_in(os.path.join(STORE, "up"))
    remove_files_in(STORE)

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
