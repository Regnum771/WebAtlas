"""
Publish a time-series folder to GeoNode's GeoServer: an ImageMosaic with a time dimension, or a
single GeoTIFF (the peak-depth raster), with the WebATLAS raster styles.

Everything goes in workspace `geonode`, never `webatlas`: the `webatlas` workspace has a catch-all
public GeoFence rule, while GeoFence denies unknown `geonode` layers until GeoNode grants them.

Environment (worker and tools services, infra/docker-compose.yml):
  GEOSERVER_URL, GEOSERVER_ADMIN_USER, GEOSERVER_ADMIN_PASSWORD
  TIMESERIES_DIR            the folder of mosaics as this process sees it (/repo/var/timeseries)
  GEOSERVER_TIMESERIES_DIR  the same folder as GeoServer sees it (/webatlas-timeseries)
  TIMESERIES_INDEX_DB_HOST/PORT/NAME/SCHEMA/USER/PASSWORD
                            the PostGIS granule index (GeoNode's geonode_data), as GeoServer
                            reaches it; this process uses the same address to drop the table
"""
import os
import re
import xml.etree.ElementTree as ET

import psycopg2
import requests
from psycopg2 import sql

from timeseries import mosaic

WORKSPACE = "geonode"
STYLES = {"webatlas_depth": "depth.sld", "webatlas_rain": "rain.sld"}
# `value` has no ramp of its own: GeoServer's built-in grey raster style.
STYLE_OF = {"depth": "webatlas_depth", "rain": "webatlas_rain", "value": "raster"}
_STYLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "styles")
# A store, coverage, layer and index table name at once: no quoting surprises, fits PostgreSQL's 63.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")
_TIMEOUT = 120
# acceptableInterval "before/after": search up to a century back, never forward.
NEAREST_BACKWARDS = "P100Y/PT0S"


def _base():
    return os.environ["GEOSERVER_URL"].rstrip("/") + "/rest"


def _auth():
    return (os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"])


def _request(method, path, ok=(200, 201), **kw):
    r = requests.request(method, _base() + path, auth=_auth(), timeout=_TIMEOUT, **kw)
    if r.status_code not in ok:
        raise RuntimeError(f"GeoServer {method} {path} -> {r.status_code}: {r.text[:500]}")
    return r


def _exists(path):
    r = requests.get(_base() + path, auth=_auth(), timeout=_TIMEOUT)
    if r.status_code == 404:
        return False
    if r.status_code != 200:
        raise RuntimeError(f"GeoServer GET {path} -> {r.status_code}: {r.text[:500]}")
    return True


def _check_name(name):
    if not _NAME.match(name):
        raise ValueError(f"invalid time-series name: {name!r}")


def _check_variable(variable):
    if variable not in STYLE_OF:
        raise ValueError(f"unknown variable: {variable!r}")


def index_db():
    """The granule index database, as GeoServer reaches it (written into datastore.properties)."""
    e = os.environ
    return mosaic.IndexDb(
        host=e["TIMESERIES_INDEX_DB_HOST"], port=int(e.get("TIMESERIES_INDEX_DB_PORT", "5432")),
        database=e["TIMESERIES_INDEX_DB_NAME"], schema=e.get("TIMESERIES_INDEX_DB_SCHEMA", "public"),
        user=e["TIMESERIES_INDEX_DB_USER"], password=e["TIMESERIES_INDEX_DB_PASSWORD"])


def _drop_index_table(name):
    db = index_db()
    conn = psycopg2.connect(host=db.host, port=db.port, dbname=db.database, user=db.user,
                            password=db.password)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql.SQL("DROP TABLE IF EXISTS {}.{} CASCADE").format(
                sql.Identifier(db.schema), sql.Identifier(name)))
    finally:
        conn.close()


URL_CHECK = "webatlas-timeseries"


def ensure_url_check():
    """
    Let `external` REST uploads read GEOSERVER_TIMESERIES_DIR. GeoServer's URL checks are on with
    no rules, so it refuses every file:// URL (reported as "Failed to locate the input file").
    Path segments must start with a letter or digit: no `..` out of the folder.
    """
    root = re.escape(os.environ["GEOSERVER_TIMESERIES_DIR"].strip("/"))
    seg = r"[A-Za-z0-9][A-Za-z0-9_.-]*"
    body = (f"<regexUrlCheck><name>{URL_CHECK}</name>"
            f"<description>WebATLAS time series (packages/atlas-data/tools/timeseries)</description>"
            f"<enabled>true</enabled><regex>^file:/{{1,3}}{root}(/{seg})*/?$</regex></regexUrlCheck>")
    xml = {"Content-Type": "application/xml"}
    if _exists(f"/urlchecks/{URL_CHECK}.json"):
        _request("PUT", f"/urlchecks/{URL_CHECK}", data=body.encode(), headers=xml)
    else:
        _request("POST", "/urlchecks", data=body.encode(), headers=xml)


def ensure_styles():
    """Create or refresh webatlas_depth and webatlas_rain in workspace geonode from styles/*.sld."""
    sld_type = {"Content-Type": "application/vnd.ogc.sld+xml"}
    for style, fname in STYLES.items():
        with open(os.path.join(_STYLE_DIR, fname), "rb") as f:
            body = f.read()
        path = f"/workspaces/{WORKSPACE}/styles"
        if _exists(f"{path}/{style}.json"):
            _request("PUT", f"{path}/{style}", data=body, headers=sld_type)
        else:
            _request("POST", path, params={"name": style}, data=body, headers=sld_type)


def _set_default_style(name, variable):
    style = STYLE_OF[variable]
    ws = f"<workspace>{WORKSPACE}</workspace>" if style in STYLES else ""
    body = f"<layer><defaultStyle><name>{style}</name>{ws}</defaultStyle></layer>"
    _request("PUT", f"/layers/{WORKSPACE}:{name}", data=body.encode(),
             headers={"Content-Type": "application/xml"})


def _enable_time(name):
    """Turn on the coverage's time dimension: listed values, ISO 8601, earliest by default."""
    path = f"/workspaces/{WORKSPACE}/coveragestores/{name}/coverages/{name}"
    # Read-modify-write: a partial PUT of <metadata> would replace the map, and an ImageMosaic
    # coverage keeps other entries (dirName, ...) there.
    cov = ET.fromstring(_request("GET", path + ".xml").content)
    meta = cov.find("metadata")
    if meta is None:
        meta = ET.SubElement(cov, "metadata")
    for entry in meta.findall("entry"):
        if entry.get("key") == "time":
            meta.remove(entry)
    entry = ET.SubElement(meta, "entry", key="time")
    dim = ET.SubElement(entry, "dimensionInfo")
    ET.SubElement(dim, "enabled").text = "true"
    ET.SubElement(dim, "presentation").text = "LIST"
    ET.SubElement(dim, "units").text = "ISO8601"
    ET.SubElement(ET.SubElement(dim, "defaultValue"), "strategy").text = "MINIMUM"
    # A TIME with no step would otherwise be an InvalidDimensionValue exception. Nearest match
    # looking only backwards gives the latest step at or before TIME; before the first step
    # nothing matches and IGNORE keeps the requested time, so the map is empty, not the first frame.
    ET.SubElement(dim, "nearestMatchEnabled").text = "true"
    ET.SubElement(dim, "acceptableInterval").text = NEAREST_BACKWARDS
    ET.SubElement(dim, "nearestFailBehavior").text = "IGNORE"
    enabled = cov.find("enabled")
    if enabled is None:
        enabled = ET.SubElement(cov, "enabled")
    enabled.text = "true"
    _request("PUT", path, data=ET.tostring(cov), headers={"Content-Type": "application/xml"})


def publish_mosaic(name, variable):
    """
    Publish TIMESERIES_DIR/<name> (a folder of <name>_<YYYYMMDDTHHMMSSZ>.tif COGs) as ImageMosaic
    geonode:<name> with a time dimension and the variable's default style. Idempotent: a mosaic
    that is already there only has its time dimension and style set again. Returns the alternate.
    """
    _check_name(name)
    _check_variable(variable)
    folder = os.path.join(os.environ["TIMESERIES_DIR"], name)
    if not os.path.isdir(folder) or not any(f.endswith(".tif") for f in os.listdir(folder)):
        raise RuntimeError(f"no .tif steps in {folder}")
    ensure_styles()
    ensure_url_check()
    store = f"/workspaces/{WORKSPACE}/coveragestores/{name}"
    if not _exists(f"{store}/coverages/{name}.json"):
        if _exists(f"{store}.json"):
            # A store without its coverage (an earlier run that stopped half-way): start again.
            _delete_store(name)
        _drop_index_table(name)
        _forget_mosaic_files(folder, name)
        mosaic.write_config(folder, name, index_db())
        gs_folder = os.environ["GEOSERVER_TIMESERIES_DIR"].rstrip("/") + "/" + name
        _request("PUT", f"{store}/external.imagemosaic", params={"configure": "first"},
                 data=f"file://{gs_folder}".encode(), headers={"Content-Type": "text/plain"})
    _enable_time(name)
    _set_default_style(name, variable)
    return f"{WORKSPACE}:{name}"


def publish_coverage(name, gs_file, variable):
    """
    Publish one GeoTIFF as coverage geonode:<name>; `gs_file` is its path as GeoServer sees it
    (under GEOSERVER_TIMESERIES_DIR). Idempotent; returns the alternate.
    """
    _check_name(name)
    _check_variable(variable)
    if not gs_file.startswith("/"):
        raise ValueError(f"gs_file must be an absolute GeoServer path: {gs_file!r}")
    ensure_styles()
    ensure_url_check()
    store = f"/workspaces/{WORKSPACE}/coveragestores/{name}"
    if not _exists(f"{store}/coverages/{name}.json"):
        if _exists(f"{store}.json"):
            _delete_store(name)
        _request("PUT", f"{store}/external.geotiff", params={"configure": "first", "coverageName": name},
                 data=f"file://{gs_file}".encode(), headers={"Content-Type": "text/plain"})
    _set_default_style(name, variable)
    return f"{WORKSPACE}:{name}"


def _delete_store(name):
    # Never with `purge`: ImageMosaicReader.delete() then calls GranuleCatalog.drop(), which runs
    # the PostGIS factory's dropDatabase, i.e. DROP DATABASE geonode_data (it only fails while other
    # sessions are connected). GeoNode avoids purging ImageMosaic stores for the same reason (#8671).
    _request("DELETE", f"/workspaces/{WORKSPACE}/coveragestores/{name}",
             ok=(200, 404), params={"recurse": "true"})


def _forget_mosaic_files(folder, name):
    """Remove the two files GeoServer writes when it builds the mosaic, so a rebuild starts clean."""
    for fname in (f"{name}.properties", "sample_image.dat"):
        path = os.path.join(folder, fname)
        if os.path.isfile(path):
            os.remove(path)


def delete_mosaic(name):
    """
    Remove store geonode:<name> with its coverage and layer, and drop its granule index table.
    The step files stay in TIMESERIES_DIR/<name> (only GeoServer's own mosaic files go), so the
    caller decides what happens to them. A missing store is fine.
    """
    _check_name(name)
    _delete_store(name)
    _drop_index_table(name)
    folder = os.path.join(os.environ["TIMESERIES_DIR"], name)
    if os.path.isdir(folder):
        _forget_mosaic_files(folder, name)
