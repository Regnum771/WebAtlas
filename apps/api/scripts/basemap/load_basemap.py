"""
Load a self-hosted basemap into PostGIS from the Geofabrik Vietnam OSM extract.

Two tiers, matching the agreed scope:
  * NATIONAL  (coarse) - major roads / railways / big places, whole country.
  * REGION    (detailed) - everything, clipped to the six working-region provinces.

Source: https://download.geofabrik.de/asia/vietnam-latest-free.shp.zip  (OpenStreetMap, ODbL)
Attribution "(c) OpenStreetMap contributors" is REQUIRED wherever these render.

Read straight out of the .zip via GDAL's /vsizip/ so nothing is expanded to disk.
"""
import json
import os
import pathlib
import sys
import time

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape
from shapely.ops import unary_union
from sqlalchemy import create_engine, text

# Repo root is four levels up: apps/api/scripts/basemap/load_basemap.py
ROOT = pathlib.Path(__file__).resolve().parents[4]

ZIP = os.environ.get("BASEMAP_ZIP", "vietnam-free.shp.zip")
DB = os.environ.get(
    "BASEMAP_DB_URL",
    "postgresql+psycopg2://webatlas:change_me_dev@localhost:5432/webatlas",
)
PROVINCES = str(ROOT / "apps" / "web" / "public" / "provinces-34.geojson")
REGION_CODES = {"48", "51", "52", "56", "66", "68"}  # REGION_PROVINCE_CODES

MAJOR_ROADS = ("motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link")
MAJOR_PLACES = ("city", "town")


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


def write(gdf: gpd.GeoDataFrame, table: str, engine) -> None:
    if gdf.empty:
        print(f"   !! {table}: 0 features, skipped")
        return
    gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    gdf.to_postgis(table, engine, schema="basemap", if_exists="replace", index=False)
    with engine.connect() as c:
        # KHONG tu tao index hinh hoc o day: to_postgis cua GeoPandas da tao san
        # idx_<table>_geometry. Truoc day dong nay tao them mot GiST thu hai y het
        # tren moi bang, chi ton thoi gian ghi va dung luong, khong giup doc.
        #
        # Index fclass moi la thu thuc su thieu. Moi luat trong SLD loc theo fclass;
        # voi bbox rong (tile o muc thu nho) PostgreSQL bo qua index hinh hoc va
        # quet ca bang 527k dong. Do tren roads_region: 998ms -> 199ms cho luat
        # 'secondary' khi co index nay.
        if "fclass" in gdf.columns:
            c.execute(text(f'CREATE INDEX IF NOT EXISTS {table}_fclass_idx ON basemap."{table}" (fclass)'))
        c.execute(text(f'ANALYZE basemap."{table}"'))
        c.commit()
    print(f"   -> basemap.{table}: {len(gdf):,} features")


def load_national(engine) -> None:
    print("NATIONAL (coarse, whole country)")

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
        if not gdf.empty:
            # precise clip against the province polygons
            gdf = gdf[gdf.intersects(region)]
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


if __name__ == "__main__":
    main()
