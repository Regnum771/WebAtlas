"""
Live check for publishing a time series to GeoServer as an ImageMosaic with a time dimension.

Opt-in (needs the platform stack: GeoNode's GeoServer and the webatlas_mosaic_index database). Runs in the
atlas-tools image, which shares the Compose network:

    docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml \
      --profile tools run --rm -T -e GEONODE_E2E=1 tools \
      python3 packages/atlas-data/tools/timeseries/test_geoserver_live.py

The layer lives in workspace `geonode`, where GeoFence denies unknown layers: every WMS request
here goes as the GeoServer admin (basic auth). The test removes its own files under TIMESERIES_DIR at the end.
"""
import os
import pathlib
import re
import shutil
import sys
import uuid
from datetime import timedelta

if os.environ.get("GEONODE_E2E") != "1":
    print("skip: set GEONODE_E2E=1 to run the live GeoServer check")
    sys.exit(0)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import cog, geoserver  # noqa: E402
from timeseries.live_fixtures import mosaic_files, remove_files, write_depth_series  # noqa: E402
from timeseries.model import Step  # noqa: E402

import numpy as np  # noqa: E402
import psycopg2  # noqa: E402
import psycopg2.sql  # noqa: E402
import rasterio  # noqa: E402
import requests  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.io import MemoryFile  # noqa: E402

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


GS = os.environ["GEOSERVER_URL"].rstrip("/")
ADMIN = (os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"])


def index_conn():
    return psycopg2.connect(
        host=os.environ["TIMESERIES_INDEX_DB_HOST"], port=os.environ["TIMESERIES_INDEX_DB_PORT"],
        dbname=os.environ["TIMESERIES_INDEX_DB_NAME"], user=os.environ["TIMESERIES_INDEX_DB_USER"],
        password=os.environ["TIMESERIES_INDEX_DB_PASSWORD"])


def index_table_exists(table):
    conn = index_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass(%s)",
                        (f'{os.environ.get("TIMESERIES_INDEX_DB_SCHEMA", "public")}."{table}"',))
            return cur.fetchone()[0] is not None
    finally:
        conn.close()


def alpha_of_png(content):
    """Alpha channel of a PNG (RGBA or paletted with transparency)."""
    with MemoryFile(content) as mem, mem.open() as ds:
        if ds.count == 4:
            return ds.read(4)
        if ds.count == 2:
            return ds.read(2)
        if ds.count == 1:
            idx = ds.read(1)
            try:
                cmap = ds.colormap(1)
            except ValueError:
                return np.full(idx.shape, 255)
            lut = np.array([cmap.get(i, (0, 0, 0, 255))[3] for i in range(256)])
            return lut[idx]
        return np.full((ds.height, ds.width), 255)


name = f"s1-e2e-{uuid.uuid4().hex}"
root = os.environ["TIMESERIES_DIR"]
folder = os.path.join(root, name)
# 40 x 40 cells of 50 m in UTM 49N (Vietnam); depth rises with each hour, one corner stays dry.
step_times, step_files = write_depth_series(folder, name)
t0 = step_times[0]
with rasterio.open(os.path.join(folder, step_files[0])) as ds:
    bbox = ",".join(str(v) for v in ds.bounds)
# Strays in the mosaic folder that must not become time steps: a timestamp-less peak.tif and a
# timestamped file of another series (both would match the time regex or the *.tif default).
stray_arr = np.full((40, 40), 9.0, dtype="float32")
for stray_name, stray_time in (("peak", t0 + timedelta(hours=6)), ("stray", t0 + timedelta(hours=7))):
    cog.write_step(Step(time=stray_time, array=stray_arr, transform=Affine(50, 0, 500000, 0, -50, 2000000),
                        crs="EPSG:32649"), folder, stray_name)
os.replace(os.path.join(folder, cog.step_filename("peak", t0 + timedelta(hours=6))),
           os.path.join(folder, "peak.tif"))
stray_files = ["peak.tif", cog.step_filename("stray", t0 + timedelta(hours=7))]
peak = f"{name}_peak"
peak_folder = os.path.join(root, peak)


def index_rows(table):
    conn = index_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(psycopg2.sql.SQL("SELECT count(*) FROM {}.{}").format(
                psycopg2.sql.Identifier(os.environ.get("TIMESERIES_INDEX_DB_SCHEMA", "public")),
                psycopg2.sql.Identifier(table)))
            return cur.fetchone()[0]
    finally:
        conn.close()


def remove_test_files():
    """The test's own files, one by one by name, then the emptied folders (no recursive delete)."""
    remove_files({folder: step_files + stray_files + mosaic_files(name), peak_folder: [f"{peak}.tif"]})

try:
    try:
        geoserver.ensure_styles()
        for style in ("webatlas_depth", "webatlas_rain"):
            r = requests.get(f"{GS}/rest/workspaces/geonode/styles/{style}.json", auth=ADMIN, timeout=30)
            check(f"style {style} in workspace geonode", r.status_code == 200)

        alternate = geoserver.publish_mosaic(name, "depth")
        check("publish_mosaic returns geonode:<name>", alternate == f"geonode:{name}")
        check("publish_mosaic is idempotent", geoserver.publish_mosaic(name, "depth") == alternate)

        r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}/coverages/{name}.json",
                         auth=ADMIN, timeout=30)
        check("coverage exists in workspace geonode", r.status_code == 200)

        # URL check: GeoServer matches the whole URL against the rule's regex (Matcher.matches()).
        r = requests.get(f"{GS}/rest/urlchecks/{geoserver.URL_CHECK}.json", auth=ADMIN, timeout=30)
        rule = r.json().get("regexUrlCheck", {}) if r.status_code == 200 else {}
        regex = rule.get("regex", "")
        check("URL check rule installed and enabled",
              regex == geoserver.url_check_regex() and str(rule.get("enabled")).lower() == "true")
        gs_dir = f"{os.environ['GEOSERVER_TIMESERIES_DIR']}/{name}"
        granule = f"{gs_dir}/{cog.step_filename(name, step_times[0])}"
        accepted = [f"file://{gs_dir}", f"file:{gs_dir}", f"file://{gs_dir}/", f"file://{granule}",
                    f"file:{granule}"]
        refused = [f"file://{gs_dir}/datastore.properties", f"file:{gs_dir}/indexer.properties",
                   f"file://{gs_dir}/{name}.properties", f"file://{gs_dir}/sample_image.dat",
                   f"file://{os.environ['GEOSERVER_TIMESERIES_DIR']}/../etc/x.tif",
                   f"file://{gs_dir}/../{name}/datastore.properties", f"file://{gs_dir}/sub/x.tif",
                   f"file://{os.environ['GEOSERVER_TIMESERIES_DIR']}", "file:///etc/passwd"]
        check("URL check accepts the mosaic directory and its granules",
              all(re.fullmatch(regex, u) for u in accepted))
        check("URL check refuses .properties, other files, `..` and other folders",
              not any(re.fullmatch(regex, u) for u in refused))
        # And GeoServer itself refuses to open datastore.properties (it exists, so this is the check).
        check("datastore.properties is there", os.path.isfile(os.path.join(folder, "datastore.properties")))
        probe = f"{name}_probe"
        try:
            r = requests.put(f"{GS}/rest/workspaces/geonode/coveragestores/{probe}/external.geotiff",
                             params={"configure": "none"}, data=f"file://{gs_dir}/datastore.properties".encode(),
                             headers={"Content-Type": "text/plain"}, auth=ADMIN, timeout=60)
            check("GeoServer refuses an external upload of datastore.properties",
                  r.status_code == 400 and "Failed to locate the input file" in r.text)
        finally:
            geoserver.delete_mosaic(probe)
        r = requests.get(f"{GS}/rest/layers/geonode:{name}.json", auth=ADMIN, timeout=30)
        check("default style is webatlas_depth",
              r.status_code == 200 and r.json()["layer"]["defaultStyle"]["name"] in
              ("webatlas_depth", "geonode:webatlas_depth"))
        check("index table created", index_table_exists(name))

        wms = f"{GS}/geonode/wms"
        r = requests.get(wms, params={"service": "WMS", "version": "1.3.0", "request": "GetCapabilities"},
                         auth=ADMIN, timeout=60)
        caps = r.text
        layer = re.search(r"<Layer[^>]*>\s*<Name>" + re.escape(name) + r"</Name>.*?</Layer>", caps, re.S)
        check("GetCapabilities lists the layer", r.status_code == 200 and layer is not None)
        dim = re.search(r'<Dimension name="time"[^>]*>([^<]*)</Dimension>', layer.group(0)) if layer else None
        listed = dim.group(1) if dim else ""
        check("time dimension lists the 3 ISO times",
              all(t.strftime("%Y-%m-%dT%H:%M:%S") in listed for t in step_times))
        check("stray .tif files in the folder are not time steps",
              len([v for v in listed.split(",") if v.strip()]) == 3 and "T07:00:00" not in listed
              and "T08:00:00" not in listed and index_rows(name) == 3)

        def get_map(time_value):
            return requests.get(wms, params={
                "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": f"geonode:{name}",
                "styles": "", "srs": "EPSG:3857", "bbox": bbox, "width": 64, "height": 64,
                "format": "image/png", "transparent": "true", "time": time_value}, auth=ADMIN, timeout=60)

        r = get_map(step_times[1].strftime("%Y-%m-%dT%H:%M:%SZ"))
        check("GetMap at the second step is image/png",
              r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/png"))
        if r.headers.get("Content-Type", "").startswith("image/png"):
            a = alpha_of_png(r.content)
            check("second step paints wet cells and leaves the dry corner clear",
                  (a > 0).any() and a[0, 0] == 0)
        step2 = r.content if r.headers.get("Content-Type", "").startswith("image/png") else None
        first = get_map(step_times[0].strftime("%Y-%m-%dT%H:%M:%SZ"))
        third = get_map(step_times[2].strftime("%Y-%m-%dT%H:%M:%SZ"))
        check("TIME selects the step (first, second, third differ)",
              step2 is not None and len({first.content, step2, third.content}) == 3)
        r = get_map((step_times[1] + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        check("GetMap between steps shows the step before (not the next one)",
              step2 is not None and r.headers.get("Content-Type", "").startswith("image/png")
              and r.content == step2)
        r = get_map((t0 - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        before_png = r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/png")
        check("GetMap before the first step is fully transparent",
              before_png and (alpha_of_png(r.content) == 0).all())
        if not before_png:
            print("     got", r.status_code, r.headers.get("Content-Type"), r.text[:300])

        r = requests.get(wms, params={"service": "WMS", "version": "1.3.0", "request": "GetCapabilities"},
                         timeout=60)
        check("anonymous capabilities do not list the layer", f"<Name>{name}</Name>" not in r.text)

        # A single GeoTIFF (the peak-depth raster) in its own sibling folder, by its GeoServer path.
        os.makedirs(peak_folder, exist_ok=True)
        shutil.copyfile(os.path.join(folder, step_files[2]), os.path.join(peak_folder, f"{peak}.tif"))
        gs_file = f"{os.environ['GEOSERVER_TIMESERIES_DIR']}/{peak}/{peak}.tif"
        try:
            check("publish_coverage returns geonode:<name>",
                  geoserver.publish_coverage(peak, gs_file, "depth") == f"geonode:{peak}")
            check("publish_coverage is idempotent",
                  geoserver.publish_coverage(peak, gs_file, "depth") == f"geonode:{peak}")
            r = requests.get(f"{GS}/rest/layers/geonode:{peak}.json", auth=ADMIN, timeout=30)
            check("single coverage has the depth style",
                  r.status_code == 200 and r.json()["layer"]["defaultStyle"]["name"].endswith("webatlas_depth"))
            r = requests.get(wms, params={
                "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": f"geonode:{peak}",
                "styles": "", "srs": "EPSG:3857", "bbox": bbox, "width": 64, "height": 64,
                "format": "image/png", "transparent": "true"}, auth=ADMIN, timeout=60)
            check("single coverage GetMap paints",
                  r.headers.get("Content-Type", "").startswith("image/png") and (alpha_of_png(r.content) > 0).any())
        finally:
            geoserver.delete_mosaic(peak)
        r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{peak}.json", auth=ADMIN, timeout=30)
        check("delete_mosaic removes the single-coverage store", r.status_code == 404)
        check("its GeoTIFF stays", os.path.isfile(os.path.join(peak_folder, f"{peak}.tif")))
    finally:
        geoserver.delete_mosaic(name)

    r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}.json", auth=ADMIN, timeout=30)
    check("delete_mosaic removes the store", r.status_code == 404)
    check("delete_mosaic drops the index table", not index_table_exists(name))
    check("delete_mosaic keeps the steps", all(os.path.isfile(os.path.join(folder, f)) for f in step_files))
    try:
        geoserver.delete_mosaic(name)
        again = None
    except Exception as e:  # noqa: BLE001 - the check reports it
        again = e
    r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}.json", auth=ADMIN, timeout=30)
    check("delete_mosaic of a missing mosaic raises nothing and leaves no store",
          again is None and r.status_code == 404 and not index_table_exists(name))

    # The steps are still there: the same name publishes again from scratch.
    try:
        geoserver.publish_mosaic(name, "rain")
        r = requests.get(f"{GS}/rest/layers/geonode:{name}.json", auth=ADMIN, timeout=30)
        check("republish after delete, with the rain style",
              r.status_code == 200 and r.json()["layer"]["defaultStyle"]["name"].endswith("webatlas_rain"))
    finally:
        geoserver.delete_mosaic(name)
    check("second delete drops the index table again", not index_table_exists(name))

    check("index database still there", index_table_exists("spatial_ref_sys"))

    # The index role cannot drop the index database (what a GeoTools purge would try). Attempted only
    # once the catalog shows the role owns no database and is no superuser, so it cannot succeed.
    conn = index_conn()
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT r.rolsuper, r.rolcreatedb,
                                  (SELECT count(*) FROM pg_database d WHERE d.datdba = r.oid)
                             FROM pg_roles r WHERE r.rolname = current_user""")
            superuser, createdb, owned = cur.fetchone()
            check("index role: no superuser, no CREATEDB, owns no database",
                  not superuser and not createdb and owned == 0)
            if not superuser and owned == 0:
                code = None
                try:
                    cur.execute(psycopg2.sql.SQL("DROP DATABASE {}").format(
                        psycopg2.sql.Identifier(os.environ["TIMESERIES_INDEX_DB_NAME"])))
                except psycopg2.Error as e:
                    code = e.pgcode
                check("DROP DATABASE as the index role fails with insufficient privilege", code == "42501")
    finally:
        conn.close()
    check("index database survives", index_table_exists("spatial_ref_sys"))

finally:
    remove_test_files()

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
