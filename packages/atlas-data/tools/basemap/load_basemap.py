"""
Load a self-hosted basemap into PostGIS from the Geofabrik Vietnam OSM extract.

Two tiers, matching the agreed scope:
  * NATIONAL  (coarse) - major roads / railways / big places, whole country.
  * REGION    (detailed) - everything, clipped to the six working-region provinces.

Source: a dated Geofabrik Vietnam extract, pinned by sha256 in packages/atlas-data/src/descriptors/basemap.ts (OpenStreetMap, ODbL)
Attribution "(c) OpenStreetMap contributors" is REQUIRED wherever these render.

Read straight out of the .zip via GDAL's /vsizip/ so nothing is expanded to disk.
"""
import json
import os
import pathlib
import sys
import time

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import shape
from shapely.ops import unary_union
from sqlalchemy import create_engine, text

try:
    import resource  # Linux and macOS only; the script also runs by hand on Windows
except ImportError:
    resource = None

# Repo root is four levels up: packages/atlas-data/tools/basemap/load_basemap.py
ROOT = pathlib.Path(__file__).resolve().parents[4]

# The registry passes the downloaded extract as argv[1] (a path, never a secret); BASEMAP_ZIP stays
# for running the script by hand.
ZIP = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BASEMAP_ZIP", "vietnam-free.shp.zip")
DB = os.environ.get(
    "BASEMAP_DB_URL",
    "postgresql+psycopg2://webatlas:change_me_dev@localhost:5432/webatlas",
)
PROVINCES = str(ROOT / "apps" / "web" / "public" / "provinces-34.geojson")
REGION_CODES = {"48", "51", "52", "56", "66", "68"}  # REGION_PROVINCE_CODES

MAJOR_ROADS = ("motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link")
MAJOR_PLACES = ("city", "town")

# Rows per to_postgis call. One call for the whole 527k-row roads_region table held the table's
# EWKB and COPY buffer in memory at once; in the atlas-tools container (Docker Desktop's VM,
# 3.7 GiB here) that load was OOM-killed at 2 GB RSS (Task 12, 2026-09-30).
WRITE_CHUNK = 50_000


def vsi(layer: str) -> str:
    return f"/vsizip/{ZIP}/{layer}"


def region_polygon():
    """Union of the six working-region provinces. Polygons, not bbox: the bbox
    reaches lon 117.8 because Hoang Sa / Truong Sa belong to Da Nang / Khanh Hoa,
    so a bbox clip would drag in a vast area of sea."""
    with open(PROVINCES, encoding="utf-8") as fh:
        fc = json.load(fh)
    geoms = [
        shape(f["geometry"])
        for f in fc["features"]
        if str(f["properties"].get("code")) in REGION_CODES
    ]
    if len(geoms) != len(REGION_CODES):
        sys.exit(f"expected {len(REGION_CODES)} provinces, matched {len(geoms)}")
    return unary_union(geoms)


def clip_to_region(gdf: gpd.GeoDataFrame, region) -> gpd.GeoDataFrame:
    """The rows of `gdf` whose geometry intersects `region`, in their original order.

    Through the spatial index, not `gdf[gdf.intersects(region)]`: that tests every row against the
    unprepared province union (~10k vertices, 225 parts) and measured 17.6 s per 5,000 roads, about
    36 minutes for the 616k roads in the region's bbox. The index query takes under a second
    (Task 12, 2026-09-30) and selects the same rows."""
    if gdf.empty:
        return gdf
    hits = gdf.sindex.query(region, predicate="intersects")
    return gdf.iloc[np.sort(hits)]


def write_chunks(n: int, size: int = WRITE_CHUNK) -> list[tuple[int, int, str]]:
    """(start, stop, if_exists) per to_postgis call: the first replaces the table, the rest append."""
    return [(i, min(i + size, n), "replace" if i == 0 else "append") for i in range(0, n, size)]


def column_geometry_type(gdf: gpd.GeoDataFrame) -> str:
    """The column type one to_postgis call over these rows creates: their single type, else GEOMETRY;
    with a Z suffix when any of them is 3D, as geopandas does."""
    kinds = [k for k in gdf.geom_type.unique() if k is not None]
    base = kinds[0].upper() if len(kinds) == 1 else "GEOMETRY"
    return base + ("Z" if bool(gdf.has_z.any()) else "")


def write(gdf: gpd.GeoDataFrame, table: str, engine) -> None:
    if gdf.empty:
        # Every table this script writes is counted by the basemap probe. Skipping would keep the
        # previous load's table and let that count pass for an extract that no longer has the layer.
        sys.exit(f"basemap.{table}: the extract yielded 0 features; refusing to keep the previous table")
    gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    # One transaction for the whole table. Handed the engine, to_postgis commits per call, so a
    # load killed between chunks left a committed part-table that the row-count probe accepted and
    # the live map drew. Handed a connection that is already in a transaction, geopandas reuses it:
    # memory stays bounded by the chunk, and a failed load leaves the previous table in place.
    whole = column_geometry_type(gdf)
    geom = gdf.geometry.name
    # Write to <table>__new and swap by rename. Replacing the live table in place held its lock for
    # the whole load (about 4 minutes for roads_region), and every GeoServer tile request that read
    # it waited that long. Now the live table is locked only for the DROP and the renames, so tile
    # requests wait milliseconds. A leftover <table>__new from a crashed run is replaced by the
    # first chunk.
    new = f"{table}__new"
    with engine.begin() as c:
        for start, stop, if_exists in write_chunks(len(gdf)):
            chunk = gdf.iloc[start:stop]
            chunk.to_postgis(new, c, schema="basemap", if_exists=if_exists, index=False)
            # to_postgis types the column from the rows of the call that creates the table (it
            # overrides a dtype it is given). When the first chunk happens to hold one geometry
            # type and a later one another, the column would refuse the later rows. Give it the
            # type a single call over the whole table would have chosen.
            if if_exists == "replace" and column_geometry_type(chunk) != whole:
                c.execute(text(
                    f'ALTER TABLE basemap."{new}" ALTER COLUMN "{geom}" '
                    f'TYPE geometry({"GeometryZ" if whole.endswith("Z") else "Geometry"}, 4326)'))
        # KHONG tu tao index hinh hoc o day: to_postgis cua GeoPandas da tao san
        # idx_<table>__new_<geom>, doi ten thanh idx_<table>_geometry sau khi hoan doi.
        # Truoc day dong nay tao them mot GiST thu hai y het
        # tren moi bang, chi ton thoi gian ghi va dung luong, khong giup doc.
        #
        # Index fclass moi la thu thuc su thieu. Moi luat trong SLD loc theo fclass;
        # voi bbox rong (tile o muc thu nho) PostgreSQL bo qua index hinh hoc va
        # quet ca bang 527k dong. Do tren roads_region: 998ms -> 199ms cho luat
        # 'secondary' khi co index nay.
        has_fclass = "fclass" in gdf.columns
        if has_fclass:
            c.execute(text(f'CREATE INDEX IF NOT EXISTS {new}_fclass_idx ON basemap."{new}" (fclass)'))
        c.execute(text(f'ANALYZE basemap."{new}"'))
        # No CASCADE: a view that depends on the old table must fail the load loudly, not vanish.
        c.execute(text(f'DROP TABLE IF EXISTS basemap."{table}"'))
        c.execute(text(f'ALTER TABLE basemap."{new}" RENAME TO "{table}"'))
        # Index names are schema-wide; the old table's are free now that it is dropped.
        c.execute(text(f'ALTER INDEX basemap."idx_{new}_{geom}" RENAME TO "idx_{table}_{geom}"'))
        if has_fclass:
            c.execute(text(f'ALTER INDEX basemap."{new}_fclass_idx" RENAME TO "{table}_fclass_idx"'))
    print(f"   -> basemap.{table}: {len(gdf):,} features")


def national_land() -> gpd.GeoDataFrame:
    """basemap.land_vn: the 34 provinces as the land fill of the national tier.

    publish-basemap.sh publishes it, the basemap probe counts it and the runbook lists it, but
    until Task 12 no committed step produced it: the dev machine's table came from a manual load
    of this same file (identical 34 rows, 58,431 vertices, columns code/name), and a fresh clone
    failed with "featuretype land_vn returned 400"."""
    land = gpd.read_file(PROVINCES, columns=["code", "name"])
    return land.set_crs("EPSG:4326", allow_override=True)


def load_national(engine) -> None:
    print("NATIONAL (coarse, whole country)")

    write(national_land(), "land_vn", engine)

    t = time.time()
    roads = gpd.read_file(
        vsi("gis_osm_roads_free_1.shp"),
        where="fclass IN " + str(MAJOR_ROADS),
        columns=["osm_id", "code", "fclass", "name", "ref"],
    )
    print(f"   read major roads in {time.time() - t:.1f}s")
    write(roads, "roads_vn", engine)

    rail = gpd.read_file(vsi("gis_osm_railways_free_1.shp"), columns=["osm_id", "code", "fclass", "name"])
    write(rail, "railways_vn", engine)

    places = gpd.read_file(
        vsi("gis_osm_places_free_1.shp"),
        where="fclass IN " + str(MAJOR_PLACES),
        columns=["osm_id", "code", "fclass", "population", "name"],
    )
    write(places, "places_vn", engine)


def load_region(engine, region) -> None:
    print("REGION (detailed, six provinces)")
    bbox = region.bounds  # read filter only; precise clip follows

    jobs = [
        ("gis_osm_roads_free_1.shp", ["osm_id", "code", "fclass", "name", "ref", "oneway", "maxspeed", "bridge", "tunnel"], "roads_region"),
        ("gis_osm_places_free_1.shp", ["osm_id", "code", "fclass", "population", "name"], "places_region"),
        ("gis_osm_landuse_a_free_1.shp", ["osm_id", "code", "fclass", "name"], "landuse_region"),
        ("gis_osm_water_a_free_1.shp", ["osm_id", "code", "fclass", "name"], "water_region"),
    ]

    for layer, cols, table in jobs:
        t = time.time()
        gdf = gpd.read_file(vsi(layer), bbox=bbox, columns=cols)
        read_n, read_s = len(gdf), time.time() - t
        gdf = clip_to_region(gdf, region)  # precise clip against the province polygons
        print(f"   {layer}: read {read_n:,} in bbox ({read_s:.1f}s) -> {len(gdf):,} in region")
        write(gdf, table, engine)


def main() -> None:
    engine = create_engine(DB)
    with engine.connect() as c:
        c.execute(text("CREATE SCHEMA IF NOT EXISTS basemap"))
        c.commit()

    region = region_polygon()
    print(f"region polygon: {region.geom_type}, bounds {tuple(round(v, 2) for v in region.bounds)}\n")

    load_national(engine)
    print()
    load_region(engine, region)

    print("\nsummary:")
    with engine.connect() as c:
        rows = c.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='basemap' ORDER BY table_name
        """)).fetchall()
        for (t_,) in rows:
            n = c.execute(text(f'SELECT count(*) FROM basemap."{t_}"')).scalar()
            print(f"   basemap.{t_:<18} {n:>10,}")
    # ru_maxrss is in KiB on Linux. Printed so a memory regression shows up in the build log.
    if resource is not None:
        print(f"\npeak memory: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024} MB")


if __name__ == "__main__":
    main()
