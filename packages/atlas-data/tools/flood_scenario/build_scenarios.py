"""
Builds the flood scenario demo into the `scenario` schema and the PNG frames.

Runs inside the atlas-tools image (reads BASEMAP_DB_URL):

    docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
        python3 packages/atlas-data/tools/flood_scenario/build_scenarios.py

Rebuilds the whole schema on every run: this is a demo replay of the October 2025 flood with no
versions to keep. See docs/runbooks/flood-scenario-demo.md for what the printed checks mean.
"""
import os
import pathlib
import shutil
import sys
import time
import warnings
from datetime import timedelta

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio import features
from rasterio.errors import NotGeoreferencedWarning
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, calculate_default_transform, reproject
from scipy import ndimage
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import ARRAY, DOUBLE_PRECISION, TEXT

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import depth  # noqa: E402
import exposure  # noqa: E402
import levels  # noqa: E402

REPO = HERE.parents[3]
BOX = (107.95, 15.70, 108.40, 15.98)
OSM_ZIP = REPO / "packages/atlas-data/data/cache/basemap/vietnam-261001-free.shp.zip"
WARDS = REPO / "packages/atlas-data/data/seeds/wards-region.geojson"
CSV = REPO / "packages/atlas-data/data/seeds/flood-2025-10-levels.csv"
FRAMES = REPO / "packages/atlas-data/data/cache/flood/frames"
WET_M = 0.2
CUT_M = 0.3
MAX_FRAMES_BYTES = 25 * 1024 * 1024
FRAME_SCALE = 2  # frames at half the DEM resolution (~60 m): 97 full-size frames were ~72 MB
DEPTH_STEP = 0.25  # metres; quantised so the PNGs compress

failures = []


def log(msg):
    print(msg, flush=True)


def check(name, cond, hard=True):
    print(("ok   " if cond else ("FAIL " if hard else "note ")) + name, flush=True)
    if hard and not cond:
        failures.append(name)


def osm(layer, **kw):
    return gpd.read_file(f"/vsizip/{OSM_ZIP}/{layer}.shp", bbox=BOX, **kw)


def read_dem(engine):
    w, s, e, n = BOX
    with engine.connect() as c:
        c.execute(text("SET postgis.gdal_enabled_drivers = 'GTiff'"))
        blob = c.execute(text(
            "SELECT ST_AsGDALRaster(ST_Union(ST_Clip(rast, env, true)), 'GTiff') "
            "FROM basemap.dem_region, (SELECT ST_MakeEnvelope(:w, :s, :e, :n, 4326) env) b "
            "WHERE ST_Intersects(rast, env)"), dict(w=w, s=s, e=e, n=n)).scalar()
    with MemoryFile(bytes(blob)) as mf, mf.open() as src:
        dem = src.read(1, masked=True).astype("float32").filled(np.nan)
        return dem, src.transform, src.crs


def channel_mask(shape, transform):
    ways = osm("gis_osm_waterways_free_1", columns=["fclass"])
    ways = ways[ways["fclass"].isin(["river", "canal"])]
    water = osm("gis_osm_water_a_free_1", columns=["fclass"])
    # Rivers only: fish ponds and lakes as seeds flooded every low hollow beside them.
    water = water[water["fclass"].isin(["river", "riverbank"])]
    shapes = [(g, 1) for g in list(ways.geometry) + list(water.geometry) if g is not None]
    mask = features.rasterize(shapes, out_shape=shape, transform=transform, all_touched=True, dtype="uint8")
    return mask.astype(bool)


def coast_distance_km(dem, transform):
    """Distance of every cell from the sea; DEM nodata inside the box is the sea (the DEM is
    clipped to the mainland provinces)."""
    sea = np.isnan(dem)
    cell_km = (abs(transform.a) * 111.32 * np.cos(np.radians((BOX[1] + BOX[3]) / 2)) + abs(transform.e) * 110.57) / 2
    return (ndimage.distance_transform_edt(~sea) * cell_km).astype("float32")


def station_distances(coast_km, transform):
    out = {}
    inv = ~transform
    for s in levels.STATIONS:
        col, row = inv * (s["lon"], s["lat"])
        out[s["id"]] = float(coast_km[int(row), int(col)])
    return out


def frame_grid(shape, transform, crs):
    h, w = shape
    left, top = transform * (0, 0)
    right, bottom = transform * (w, h)
    dst_t, dst_w, dst_h = calculate_default_transform(crs, "EPSG:3857", w, h, left, bottom, right, top,
                                                      dst_width=w // FRAME_SCALE, dst_height=h // FRAME_SCALE)
    extent = [dst_t.c, dst_t.f + dst_t.e * dst_h, dst_t.c + dst_t.a * dst_w, dst_t.f]
    return dst_t, dst_w, dst_h, extent


def write_frame(path, dep, transform, crs, grid):
    dst_t, dst_w, dst_h, _ = grid
    warped = np.zeros((dst_h, dst_w), dtype="float32")
    reproject(dep, warped, src_transform=transform, src_crs=crs, dst_transform=dst_t,
              dst_crs="EPSG:3857", resampling=Resampling.average)
    rgba = depth.depth_rgba(np.where(warped > 0, np.maximum(np.round(warped / DEPTH_STEP), 1) * DEPTH_STEP, 0))
    with warnings.catch_warnings(), rasterio.Env(GDAL_PAM_ENABLED="NO"):
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(path, "w", driver="PNG", width=dst_w, height=dst_h, count=4, dtype="uint8", ZLEVEL=9) as dst:
            dst.write(np.moveaxis(rgba, 2, 0))


def cell_km2(transform):
    lat = (BOX[1] + BOX[3]) / 2
    return abs(transform.a) * 111.320 * np.cos(np.radians(lat)) * abs(transform.e) * 110.574


def run_scenario(sid, lv, dem, transform, crs, channel, coast_km, station_km, grid):
    out_dir = FRAMES / sid
    out_dir.mkdir(parents=True, exist_ok=True)
    first_wet = np.full(dem.shape, -1, dtype="int16")
    first_cut = np.full(dem.shape, -1, dtype="int16")
    max_depth = np.zeros(dem.shape, dtype="float32")
    hourly = []
    km2 = cell_km2(transform)
    for h in range(levels.HOURS + 1):
        surface = depth.profile_surface({k: v[h] for k, v in lv.items()}, station_km, coast_km)
        dep = depth.flood_depth(surface, dem, channel)
        first_wet[(first_wet < 0) & (dep >= WET_M)] = h
        first_cut[(first_cut < 0) & (dep >= CUT_M)] = h
        np.maximum(max_depth, dep, out=max_depth)
        hourly.append({"scenario_id": sid, "hour": h, "flooded_km2": round(float((dep > 0).sum() * km2), 2)})
        write_frame(out_dir / f"{h:03d}.png", dep, transform, crs, grid)
    return {"first_wet": first_wet, "first_cut": first_cut, "max_depth": max_depth}, hourly


def main():
    t0 = time.time()
    engine = create_engine(os.environ["BASEMAP_DB_URL"])
    log("reading DEM ...")
    dem, transform, crs = read_dem(engine)
    log(f"  DEM {dem.shape}, {np.isfinite(dem).sum()} cells with data")
    channel = channel_mask(dem.shape, transform)
    log(f"  channel cells: {int(channel.sum())}")
    coast_km = coast_distance_km(dem, transform)
    station_km = station_distances(coast_km, transform)
    log(f"  station distance from the sea (km): { {k: round(v, 1) for k, v in station_km.items()} }")
    grid = frame_grid(dem.shape, transform, crs)

    readings = levels.load_readings(str(CSV))
    forecast = levels.load_forecast(str(CSV))
    all_levels = {s["id"]: levels.scenario_levels(s["id"], readings) for s in levels.SCENARIOS}

    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    arrays, hourly = {}, []
    for s in levels.SCENARIOS:
        sid = s["id"]
        if sid == "preset-1000":
            continue  # identical levels to kttv-2025-10; copied below
        log(f"scenario {sid} ...")
        arrays[sid], rows = run_scenario(sid, all_levels[sid], dem, transform, crs, channel, coast_km, station_km, grid)
        hourly += rows
    arrays["preset-1000"] = arrays["kttv-2025-10"]
    shutil.copytree(FRAMES / "kttv-2025-10", FRAMES / "preset-1000")
    hourly += [{**r, "scenario_id": "preset-1000"} for r in hourly if r["scenario_id"] == "kttv-2025-10"]

    log("reading OSM layers ...")
    roads = osm("gis_osm_roads_free_1", columns=["osm_id", "fclass", "name", "ref"])
    roads = roads[roads["fclass"].isin(exposure.ROAD_CLASSES)].reset_index(drop=True)
    samples = exposure.road_samples(roads)
    wards = gpd.read_file(WARDS).set_index("code")
    buildings = osm("gis_osm_buildings_a_free_1", columns=["osm_id"])
    buildings = gpd.GeoDataFrame(geometry=buildings.geometry.centroid, crs=4326)
    buildings = gpd.sjoin(buildings, wards[["geometry"]].reset_index(names="ward_code"), predicate="within")
    pois = pd.concat([osm("gis_osm_pois_free_1", columns=["osm_id", "fclass", "name"]),
                      osm("gis_osm_pois_a_free_1", columns=["osm_id", "fclass", "name"])])
    pois = pois[pois["fclass"].isin(exposure.SHELTER_CLASSES)].copy()
    pois["geometry"] = pois.geometry.centroid
    log(f"  roads {len(roads)}, buildings {len(buildings)}, candidate shelters {len(pois)}")
    shelters = exposure.dry_shelters(pois, arrays["preset-1300"]["max_depth"], transform)
    log(f"  dry shelters {len(shelters)}")

    road_rows, ward_rows, plan_rows = [], [], []
    for s in levels.SCENARIOS:
        sid = s["id"]
        rexp = exposure.roads_exposure(roads, samples, arrays[sid], transform).assign(scenario_id=sid)
        wexp = exposure.wards_exposure(exposure.buildings_exposure(buildings, arrays[sid], transform), wards)
        plan = exposure.evacuation_plan(wexp, shelters, rexp, wards).assign(scenario_id=sid)
        road_rows.append(rexp[rexp["cut_hour"].notna()])
        ward_rows.append(wexp.assign(scenario_id=sid))
        plan_rows.append(plan)

        peak = max((r for r in hourly if r["scenario_id"] == sid), key=lambda r: r["flooded_km2"])
        log(f"{sid}: peak {peak['flooded_km2']} km2 at hour {peak['hour']}; roads cut {int(rexp['cut_hour'].notna().sum())}; "
            f"xa wet {len(wexp)}; plan rows {len(plan)}")
        if sid == "kttv-2025-10":
            check("kttv peak flooded area within 40-600 km2", 40 <= peak["flooded_km2"] <= 600)
            wet = exposure.wet_wards_at(wexp, peak["hour"])
            in_box = set(wards["name"]) & set(levels.BULLETIN_AT_RISK)
            log(f"  vs bulletin at-risk (in data): matched {sorted(wet & in_box)}")
            log(f"  missing {sorted(in_box - wet)}; extra {sorted(wet - in_box)}")
        size = sum(p.stat().st_size for p in (FRAMES / sid).glob("*.png"))
        check(f"{sid}: 97 frames, {size / 1e6:.1f} MB <= 25 MB",
              len(list((FRAMES / sid).glob("*.png"))) == 97 and size <= MAX_FRAMES_BYTES)

    write_db(engine, all_levels, forecast, hourly, grid[3], road_rows, ward_rows, shelters, plan_rows)
    log(f"done in {time.time() - t0:.0f} s")
    if failures:
        log(f"{len(failures)} hard check(s) failed")
        sys.exit(1)


def write_db(engine, all_levels, forecast, hourly, extent, road_rows, ward_rows, shelters, plan_rows):
    log("writing scenario schema ...")
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA IF EXISTS scenario CASCADE"))
        c.execute(text("CREATE SCHEMA scenario"))

    start = levels.START
    pd.DataFrame([{
        "id": s["id"], "name": s["name"], "kind": s["kind"], "rain_total_mm": s["rain_total_mm"],
        "start_time": start, "hours": levels.HOURS, "bulletin_hour": levels.BULLETIN_HOUR,
        "description": "Tái hiện trận lũ 26–31/10/2025 trên Vu Gia – Thu Bồn",
        "basis": s["basis"], "frame_extent": extent,
    } for s in levels.SCENARIOS]).to_sql("flood_scenario", engine, schema="scenario", index=False,
                                          dtype={"frame_extent": ARRAY(DOUBLE_PRECISION)})

    st = gpd.GeoDataFrame(
        [{k: s[k] for k in ("id", "name", "river", "bd1", "bd2", "bd3", "record_m", "record_year", "derived")}
         for s in levels.STATIONS],
        geometry=gpd.points_from_xy([s["lon"] for s in levels.STATIONS], [s["lat"] for s in levels.STATIONS]),
        crs=4326).rename_geometry("geom")
    st.to_postgis("flood_station", engine, schema="scenario", index=False)

    fc_hours = {sid: {round((t - start) / timedelta(hours=1)): v for t, v in pts} for sid, pts in forecast.items()}
    series = []
    for sid, lv in all_levels.items():
        for station, values in lv.items():
            for h, v in enumerate(values):
                fc = fc_hours.get(station, {}).get(h) if sid == "kttv-2025-10" else None
                series.append({"scenario_id": sid, "station_id": station, "hour": h,
                               "level_m": round(v, 3), "forecast_m": fc})
    pd.DataFrame(series).to_sql("flood_series", engine, schema="scenario", index=False)
    pd.DataFrame(hourly).to_sql("flood_hourly", engine, schema="scenario", index=False)

    roads = pd.concat(road_rows)
    roads["cut_hour"] = roads["cut_hour"].astype("Int64")
    gpd.GeoDataFrame(roads, geometry="geometry", crs=4326).rename_geometry("geom").to_postgis(
        "flood_road", engine, schema="scenario", index=False)
    wards = pd.concat(ward_rows).rename(columns={"geometry": "centroid"})
    gpd.GeoDataFrame(wards, geometry="centroid", crs=4326).to_postgis(
        "flood_ward", engine, schema="scenario", index=False)
    shelters.rename_geometry("geom").to_postgis("shelter", engine, schema="scenario", index=False)
    plan = pd.concat(plan_rows).rename(columns={"geometry": "arrow"})
    # to_postgis writes with COPY, which needs Postgres' own array literal, not Python's repr.
    plan["open_roads"] = plan["open_roads"].map(
        lambda names: "{" + ",".join('"' + n.replace("\\", "\\\\").replace('"', '\\"') + '"' for n in names) + "}")
    gpd.GeoDataFrame(plan, geometry="arrow", crs=4326).to_postgis(
        "flood_plan", engine, schema="scenario", index=False, dtype={"open_roads": ARRAY(TEXT)})

    with engine.begin() as c:
        c.execute(text("ALTER TABLE scenario.flood_scenario ADD PRIMARY KEY (id)"))
        for t in ("flood_series", "flood_hourly"):
            c.execute(text(f"CREATE INDEX ON scenario.{t} (scenario_id, hour)"))
        for t in ("flood_road", "flood_ward", "flood_plan"):
            c.execute(text(f"CREATE INDEX ON scenario.{t} (scenario_id)"))
        c.execute(text("CREATE TABLE scenario.flood_history (event_id text, event_name text, observed_on date, "
                       "source text, sensor text, licence text, url text, geom geometry(MultiPolygon, 4326))"))
        for t in ("flood_scenario", "flood_station", "flood_series", "flood_hourly", "flood_road",
                  "flood_ward", "shelter", "flood_plan"):
            n = c.execute(text(f"SELECT count(*) FROM scenario.{t}")).scalar()
            log(f"  scenario.{t}: {n} rows")


if __name__ == "__main__":
    main()
