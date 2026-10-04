"""
Checks for load_basemap.py's region clip and chunked write plan. No database, no extract.

No pytest: this repo has no Python test runner (see contours/test_styles_upload.py). Runs inside
the atlas-tools image, from the gated tools suite (ATLAS_TOOLS_TESTS=1, tools.docker.test.ts):

    python3 packages/atlas-data/tools/basemap/test_load_basemap.py
"""
import importlib.util
import pathlib
import sys

import geopandas as gpd
from shapely.geometry import LineString, Polygon, box

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("load_basemap", HERE / "load_basemap.py")
lb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lb)

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


# An L-shaped region: its bbox contains points that are NOT in the region, which is the case the
# precise clip exists for (the real region's bbox reaches far out to sea).
region = Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)])
lines = [
    LineString([(0.5, 0.5), (0.5, 3.5)]),  # inside
    LineString([(3, 3), (3.5, 3.5)]),      # in the bbox, outside the L
    LineString([(3.5, 0.5), (5, 0.5)]),    # crosses the edge
    LineString([(2, 2), (2.5, 2.5)]),      # in the bbox, outside the L
    LineString([(0.2, 0.2), (0.3, 0.3)]),  # inside
]
gdf = gpd.GeoDataFrame({"osm_id": ["a", "b", "c", "d", "e"]}, geometry=lines, crs="EPSG:4326")

clipped = lb.clip_to_region(gdf, region)
check("clip keeps exactly the rows that intersect the region", list(clipped["osm_id"]) == ["a", "c", "e"])
check("clip selects the same rows as the per-row intersects it replaces",
      list(clipped["osm_id"]) == list(gdf[gdf.intersects(region)]["osm_id"]))
check("clip keeps the original row order and index", list(clipped.index) == [0, 2, 4])
check("clip of an empty frame is empty",
      lb.clip_to_region(gdf.iloc[0:0], region).empty)
check("clip with nothing inside is empty",
      lb.clip_to_region(gdf, box(10, 10, 11, 11)).empty)

check("write plan: one replace for a small table", lb.write_chunks(3, 50_000) == [(0, 3, "replace")])
check("write plan: replace, then appends, covering every row once",
      lb.write_chunks(120_001, 50_000) == [(0, 50_000, "replace"), (50_000, 100_000, "append"), (100_000, 120_001, "append")])
check("write plan: nothing for an empty table", lb.write_chunks(0) == [])


# write(): one transaction per table. to_postgis commits per call when handed an engine, so chunked
# writes through the engine left a committed half-table behind a failed load, and the probe (which
# only counts rows) accepted it. A connection already in a transaction is reused by geopandas, so
# the chunks must all be handed that one connection.
class FakeConn:
    def __init__(self):
        self.executed = []

    def execute(self, stmt):
        self.executed.append(str(stmt))


class FakeTx:
    def __init__(self, engine):
        self.engine = engine

    def __enter__(self):
        self.engine.begun += 1
        return self.engine.conn

    def __exit__(self, exc_type, exc, tb):
        self.engine.exits.append(exc_type)
        return False


class FakeEngine:
    def __init__(self):
        self.conn, self.begun, self.exits = FakeConn(), 0, []

    def begin(self):
        return FakeTx(self)


def run_write(frame, fail_on_call=None):
    """lb.write with 2-row chunks and a recording to_postgis; returns (engine, calls, error)."""
    engine, calls = FakeEngine(), []

    def fake_to_postgis(self, name, con, schema=None, if_exists="fail", index=False, **kw):
        calls.append((name, con, schema, if_exists, len(self)))
        if fail_on_call == len(calls):
            raise RuntimeError("chunk failed")

    real_to_postgis, real_chunks = gpd.GeoDataFrame.to_postgis, lb.write_chunks
    gpd.GeoDataFrame.to_postgis = fake_to_postgis
    lb.write_chunks = lambda n: real_chunks(n, 2)
    error = None
    try:
        lb.write(frame, "roads_test", engine)
    except (Exception, SystemExit) as e:
        error = e
    finally:
        gpd.GeoDataFrame.to_postgis, lb.write_chunks = real_to_postgis, real_chunks
    return engine, calls, error


engine, calls, error = run_write(gdf.assign(fclass="track"))
check("write: every chunk goes through one transaction's connection, never the engine",
      error is None and engine.begun == 1 and len(calls) == 3 and all(c[1] is engine.conn for c in calls))
check("write: the first chunk replaces, the rest append, into the basemap schema",
      [(c[2], c[3], c[4]) for c in calls] == [("basemap", "replace", 2), ("basemap", "append", 2), ("basemap", "append", 1)])
check("write: the fclass index is created inside the same transaction",
      any("roads_test_fclass_idx" in s for s in engine.conn.executed) and engine.exits == [None])

engine, calls, error = run_write(gdf, fail_on_call=2)
check("write: a failed chunk leaves the transaction through the exception, so the old table survives",
      isinstance(error, RuntimeError) and engine.begun == 1 and engine.exits == [RuntimeError] and len(calls) == 2)

engine, calls, error = run_write(gdf.iloc[0:0])
check("write: an empty layer fails the load instead of keeping yesterday's table",
      isinstance(error, SystemExit) and "roads_test" in str(error) and engine.begun == 0 and calls == [])

# The column type. to_postgis decides it from the rows of the call that creates the table, so with
# chunks it was decided by the first chunk alone: a table whose first 50,000 rows are all LineString
# got a LineString column, and a MultiLineString further down would have failed the append.
from shapely.geometry import MultiLineString  # noqa: E402

mixed_later = gpd.GeoDataFrame(
    {"osm_id": ["a", "b", "c"]},
    geometry=[lines[0], lines[1], MultiLineString([lines[2], lines[3]])], crs="EPSG:4326")
mixed_first = gpd.GeoDataFrame(
    {"osm_id": ["a", "b", "c"]},
    geometry=[lines[0], MultiLineString([lines[2], lines[3]]), lines[1]], crs="EPSG:4326")
is_alter = lambda s: s.startswith('ALTER TABLE basemap."roads_test" ALTER COLUMN "geometry" TYPE geometry(Geometry, 4326)')  # noqa: E731

check("column type: one type is that type, several are GEOMETRY",
      lb.column_geometry_type(gdf) == "LINESTRING" and lb.column_geometry_type(mixed_later) == "GEOMETRY")
engine, calls, error = run_write(mixed_later)
check("write: a type that first appears after the first chunk widens the column before the appends",
      error is None and [is_alter(s) for s in engine.conn.executed][:1] == [True] and len(calls) == 2)
engine, calls, error = run_write(mixed_first)
check("write: a first chunk that is already mixed needs no widening (geopandas made it GEOMETRY)",
      error is None and not any(is_alter(s) for s in engine.conn.executed))
check("column type: a 3D row makes it Z, as geopandas does",
      lb.column_geometry_type(gpd.GeoDataFrame(geometry=[LineString([(0, 0, 1), (1, 1, 1)])], crs="EPSG:4326")) == "LINESTRINGZ")
engine, calls, error = run_write(gdf)
check("write: a table of one type keeps that type",
      error is None and not any(is_alter(s) for s in engine.conn.executed))

land = lb.national_land()
check("land_vn is the 34 provinces", len(land) == 34)
check("land_vn keeps code and name, as publish-basemap.sh and the dev table have them",
      list(land.columns) == ["code", "name", "geometry"])
check("land_vn is polygons in EPSG:4326",
      set(land.geom_type) <= {"Polygon", "MultiPolygon"} and land.crs.to_epsg() == 4326)

if failures:
    sys.exit(f"{len(failures)} check(s) failed")
print("load_basemap checks passed")
