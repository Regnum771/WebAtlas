"""
What a flood scenario reaches: roads cut, buildings and xa wet, dry gathering points, and the
evacuation plan built from them. Inputs are the per-cell running arrays the build keeps per
scenario (first wet hour, first road-cutting hour, max depth) on the DEM grid.
"""
import math

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from rasterio.transform import rowcol
from shapely.geometry import LineString, Point

UTM = "EPSG:32649"
ROAD_CLASSES = [
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
]
ROAD_RANK = {c: i for i, c in enumerate(ROAD_CLASSES)}
SHELTER_CLASSES = ["school", "college", "university", "community_centre", "town_hall", "kindergarten"]
SAMPLE_M = 30.0
PEOPLE_PER_BUILDING = 4
LEAD_HOURS = 3
WARD_SHARE = 0.05
OPEN_ROADS_MAX = 5


def cells(transform, shape, lons, lats):
    """(rows, cols, inside) for coordinate arrays on the DEM grid."""
    r, c = rowcol(transform, lons, lats)
    r = np.asarray(r)
    c = np.asarray(c)
    inside = (r >= 0) & (r < shape[0]) & (c >= 0) & (c < shape[1])
    return np.clip(r, 0, shape[0] - 1), np.clip(c, 0, shape[1] - 1), inside


def floodable_roads(roads):
    """Roads in the listed classes that sit on the ground. Bridges and tunnels are dropped: a bridge
    sampled over the river reads the riverbed and came out "8.9 m deep"."""
    keep = roads["fclass"].isin(ROAD_CLASSES) & (roads["bridge"] != "T") & (roads["tunnel"] != "T")
    return roads[keep].reset_index(drop=True)


def road_samples(roads):
    """Points every 30 m along each road, in EPSG:4326, with the index of their road."""
    utm = roads.to_crs(UTM)
    idx, pts = [], []
    for i, geom in zip(range(len(utm)), utm.geometry):
        n = max(1, int(geom.length // SAMPLE_M))
        dists = np.linspace(0, geom.length, n + 1)
        pts.extend(shapely.line_interpolate_point(geom, dists))
        idx.extend([i] * len(dists))
    back = gpd.GeoSeries(pts, crs=UTM).to_crs(4326)
    return np.array(idx), back.x.to_numpy(), back.y.to_numpy()


def roads_exposure(roads, samples, arrays, transform):
    """Per road: first hour any sample is road-cutting deep (or None) and max depth."""
    idx, lons, lats = samples
    first_cut, max_depth = arrays["first_cut"], arrays["max_depth"]
    r, c, inside = cells(transform, first_cut.shape, lons, lats)
    cut = np.where(inside, first_cut[r, c], -1)
    dep = np.where(inside, max_depth[r, c], 0.0)
    cut_hour = np.full(len(roads), -1, dtype=int)
    road_max = np.zeros(len(roads))
    for i in range(len(roads)):
        sel = idx == i
        hours = cut[sel]
        hours = hours[hours >= 0]
        cut_hour[i] = hours.min() if len(hours) else -1
        road_max[i] = dep[sel].max() if sel.any() else 0.0
    out = roads[["osm_id", "name", "ref", "fclass", "geometry"]].copy()
    out["length_m"] = np.round(roads.to_crs(UTM).length.to_numpy(), 1)
    out["cut_hour"] = [None if h < 0 else int(h) for h in cut_hour]
    out["max_depth"] = np.round(road_max, 2)
    return out


def buildings_exposure(buildings, arrays, transform):
    first_wet, max_depth = arrays["first_wet"], arrays["max_depth"]
    r, c, inside = cells(transform, first_wet.shape, buildings.geometry.x.to_numpy(), buildings.geometry.y.to_numpy())
    out = buildings[["ward_code", "geometry"]].copy()
    out["first_hour"] = np.where(inside, first_wet[r, c], -1)
    out["max_depth"] = np.where(inside, max_depth[r, c], 0.0)
    return out


def ward_first_hour(hours, total):
    """First hour at which >= 5 % of the xa's buildings are wet, else its earliest wet building."""
    hours = np.sort(hours)
    need = math.ceil(WARD_SHARE * total)
    if need >= 1 and len(hours) >= need:
        return int(hours[need - 1])
    return int(hours[0])


def wards_exposure(bexp, wards):
    rows = []
    for code, grp in bexp.groupby("ward_code"):
        wet = grp[grp["first_hour"] >= 0]
        if wet.empty:
            continue
        first = ward_first_hour(wet["first_hour"].to_numpy(), len(grp))
        ward = wards.loc[code]
        rows.append({
            "ward_code": code,
            "ward_name": ward["fullName"],
            "short_name": ward["name"],
            "buildings_total": int(len(grp)),
            "buildings_flooded": int(len(wet)),
            "people_est": int(len(wet) * PEOPLE_PER_BUILDING),
            "first_hour": first,
            "deadline_hour": max(first - LEAD_HOURS, 0),
            "max_depth": round(float(wet["max_depth"].max()), 2),
            "geometry": Point(wet.geometry.x.mean(), wet.geometry.y.mean()),
        })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)


def dry_shelters(pois, worst_max_depth, transform):
    r, c, inside = cells(transform, worst_max_depth.shape, pois.geometry.x.to_numpy(), pois.geometry.y.to_numpy())
    dry = inside & (worst_max_depth[r, c] <= 0)
    out = pois[dry][["osm_id", "name", "fclass", "geometry"]].copy()
    out = out.rename(columns={"osm_id": "id", "fclass": "kind"})
    return out.reset_index(drop=True)


def evacuation_plan(wexp, shelters, roads_exp, wards):
    if wexp.empty or shelters.empty:
        return gpd.GeoDataFrame(columns=["ward_code", "priority", "shelter_id", "distance_m", "open_roads", "geometry"],
                                geometry="geometry", crs=4326)
    to_utm = Transformer.from_crs(4326, UTM, always_xy=True)
    sx, sy = to_utm.transform(shelters.geometry.x.to_numpy(), shelters.geometry.y.to_numpy())
    named = roads_exp[roads_exp["name"].notna()]
    joined = gpd.sjoin(named, wards[["geometry"]].reset_index(names="ward_code"), predicate="intersects")
    ordered = wexp.sort_values(["deadline_hour", "people_est"], ascending=[True, False]).reset_index(drop=True)
    rows = []
    for i, w in ordered.iterrows():
        wx, wy = to_utm.transform(w.geometry.x, w.geometry.y)
        dist = np.hypot(sx - wx, sy - wy)
        k = int(np.argmin(dist))
        shelter = shelters.iloc[k]
        mine = joined[joined["ward_code"] == w["ward_code"]]
        open_ = mine[mine["cut_hour"].isna() | (mine["cut_hour"] > w["deadline_hour"])]
        open_ = open_.assign(rank=open_["fclass"].map(ROAD_RANK)).sort_values("rank")
        names = list(dict.fromkeys(open_["name"].tolist()))[:OPEN_ROADS_MAX]
        rows.append({
            "ward_code": w["ward_code"],
            "priority": i + 1,
            "shelter_id": shelter["id"],
            "distance_m": round(float(dist[k])),
            "open_roads": names,
            "geometry": LineString([w.geometry, shelter.geometry]),
        })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)


def wet_wards_at(wexp, hour):
    return set(wexp[wexp["first_hour"] <= hour]["short_name"])
