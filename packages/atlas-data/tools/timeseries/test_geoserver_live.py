"""
Live check for publishing a time series to GeoServer as an ImageMosaic with a time dimension.

Opt-in (needs the platform stack: GeoNode's GeoServer and the geonode_data database). Runs in the
atlas-tools image, which shares the Compose network:

    docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml \
      --profile tools run --rm -T -e GEONODE_E2E=1 tools \
      python3 packages/atlas-data/tools/timeseries/test_geoserver_live.py

The layer lives in workspace `geonode`, where GeoFence denies unknown layers: every WMS request
here goes as the GeoServer admin (basic auth). Files under TIMESERIES_DIR/s1-e2e-* may stay.
"""
import os
import pathlib
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone

if os.environ.get("GEONODE_E2E") != "1":
    print("skip: set GEONODE_E2E=1 to run the live GeoServer check")
    sys.exit(0)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import cog, geoserver  # noqa: E402
from timeseries.model import Step  # noqa: E402

import numpy as np  # noqa: E402
import psycopg2  # noqa: E402
import rasterio  # noqa: E402
import requests  # noqa: E402
from affine import Affine  # noqa: E402
from rasterio.io import MemoryFile  # noqa: E402

UTC = timezone.utc
failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


GS = os.environ["GEOSERVER_URL"].rstrip("/")
ADMIN = (os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"])


def index_table_exists(table):
    conn = psycopg2.connect(
        host=os.environ["TIMESERIES_INDEX_DB_HOST"], port=os.environ["TIMESERIES_INDEX_DB_PORT"],
        dbname=os.environ["TIMESERIES_INDEX_DB_NAME"], user=os.environ["TIMESERIES_INDEX_DB_USER"],
        password=os.environ["TIMESERIES_INDEX_DB_PASSWORD"])
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
t0 = datetime(2025, 10, 26, 1, tzinfo=UTC)
step_times = [t0 + timedelta(hours=i) for i in range(3)]

# 40 x 40 cells of 50 m in UTM 49N (Vietnam); depth rises with each hour, one corner stays dry.
for i, t in enumerate(step_times):
    arr = np.full((40, 40), 0.3 + 1.2 * i, dtype="float32")
    arr[:10, :10] = np.nan
    cog.write_step(Step(time=t, array=arr, transform=Affine(50, 0, 500000, 0, -50, 2000000),
                        crs="EPSG:32649"), folder, name)
with rasterio.open(os.path.join(folder, cog.step_filename(name, step_times[0]))) as ds:
    bbox = ",".join(str(v) for v in ds.bounds)

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

    # A single GeoTIFF (the peak-depth raster): one of the steps, by its GeoServer path.
    peak = f"{name}_peak"
    gs_file = (f"{os.environ['GEOSERVER_TIMESERIES_DIR']}/{name}/"
               f"{cog.step_filename(name, step_times[2])}")
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
    check("its GeoTIFF stays", os.path.isfile(os.path.join(folder, cog.step_filename(name, step_times[2]))))
finally:
    geoserver.delete_mosaic(name)

r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}.json", auth=ADMIN, timeout=30)
check("delete_mosaic removes the store", r.status_code == 404)
check("delete_mosaic drops the index table", not index_table_exists(name))
check("delete_mosaic keeps the steps", len([f for f in os.listdir(folder) if f.endswith(".tif")]) == 3)
geoserver.delete_mosaic(name)
check("delete_mosaic of a missing mosaic is a no-op", True)

# The steps are still there: the same name publishes again from scratch.
try:
    geoserver.publish_mosaic(name, "rain")
    r = requests.get(f"{GS}/rest/layers/geonode:{name}.json", auth=ADMIN, timeout=30)
    check("republish after delete, with the rain style",
          r.status_code == 200 and r.json()["layer"]["defaultStyle"]["name"].endswith("webatlas_rain"))
finally:
    geoserver.delete_mosaic(name)
check("second delete drops the index table again", not index_table_exists(name))

# A database GeoServer's purge would drop must still be there.
check("geonode_data database still exists", index_table_exists("spatial_ref_sys"))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
