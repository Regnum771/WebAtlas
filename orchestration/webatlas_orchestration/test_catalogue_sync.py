"""Checks for catalogue_sync against the dev database.

Run: python -m webatlas_orchestration.test_catalogue_sync
"""

import json
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import psycopg

from . import catalogue_sync, registry

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(hours=1)
LONG_AGO = datetime(2026, 1, 1, tzinfo=timezone.utc)


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def item(pk, **kw):
    base = dict(pk=pk, uuid=str(uuid.uuid4()), alternate=f"geonode:t{pk}", resourceType="dataset",
                subtype="vector", title=f"T{pk}", abstract="", ownerSub="sub-1", isPublished=False,
                isApproved=False, bbox4326=[105.0, 20.0, 106.0, 21.0], state="PROCESSED")
    base.update(kw)
    return base


def clean(conn):
    conn.execute("DELETE FROM catalogue.resources WHERE geonode_pk >= 900000")


def put(conn, pk, created=LONG_AGO, synced=None, missing=None, **kw):
    """A row as the worker would write it (or an older sync), with explicit timestamps."""
    v = dict(kind="timeseries", title="old", unit_code="01", origin="webatlas-upload", variable="depth", unit="m")
    v.update(kw)
    conn.execute(
        """INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title, managing_unit,
           is_published, is_approved, origin, time_steps, variable, unit, created_at, synced_at, missing_since)
           VALUES (%s, gen_random_uuid(), %s, %s, %s, %s, false, false, %s,
                   ARRAY['2026-01-01T00:00Z']::timestamptz[], %s, %s, %s, %s, %s)""",
        (pk, f"geonode:t{pk}", v["kind"], v["title"], v["unit_code"], v["origin"], v["variable"], v["unit"],
         created, synced, missing))


def row(conn, pk, cols="origin, kind, managing_unit, time_steps, title, is_published, is_approved"):
    return conn.execute(f"SELECT {cols} FROM catalogue.resources WHERE geonode_pk = %s", (pk,)).fetchone()


def others(conn):
    """Listing entries (RUNNING, so never written) that keep every non-test row listed."""
    pks = [r[0] for r in conn.execute("SELECT geonode_pk FROM catalogue.resources WHERE geonode_pk < 900000")]
    return [item(p, state="RUNNING") for p in pks]


def missing_since(conn, pk):
    return conn.execute("SELECT missing_since FROM catalogue.resources WHERE geonode_pk = %s", (pk,)).fetchone()[0]


def test_kind():
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector"}) == "vector", "vector")
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "raster"}) == "raster", "raster")
    # M15: GeoNode's vector_time covers time-enabled coverages too.
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector_time", "layerType": "coverage",
                                  "alternate": "geonode:mua"}) == "raster", "vector_time coverage is raster")
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector_time", "layerType": "featureType",
                                  "alternate": "geonode:tram"}) == "vector", "vector_time feature type is vector")
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector_time",
                                  "alternate": "geonode:ts_0123456789abcdef"}) == "raster",
          "vector_time ts_ without layerType is raster")
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector_time",
                                  "alternate": "geonode:tram"}) == "vector", "vector_time other without layerType is vector")
    check(catalogue_sync.kind_of({"resourceType": "map"}) == "map", "map")
    check(catalogue_sync.kind_of({"resourceType": "document"}) == "document", "document")


def test_insert_and_update(conn):
    rep = catalogue_sync.sync(conn, [item(900001)], NOW)
    check((rep.inserted, rep.updated, rep.removed) == (1, 0, 0), f"insert report {rep}")
    origin, kind, unit, *_ = row(conn, 900001)
    check(origin == "geonode-upload" and kind == "vector", "origin/kind")
    expect = conn.execute("SELECT catalogue.unit_for_bbox(105,20,106,21)").fetchone()[0]
    check(unit and unit == expect, "unit from bbox")

    # Not PROCESSED: never inserted.
    rep = catalogue_sync.sync(conn, [item(900002, state="RUNNING")], NOW)
    check(rep.inserted == 0 and row(conn, 900002) is None, "RUNNING skipped")

    # Bad bbox: that item is skipped, the run goes on.
    rep = catalogue_sync.sync(conn, [item(900002, bbox4326=[1, 2, 3]), item(900004)], NOW)
    check(rep.inserted == 1 and row(conn, 900002) is None and row(conn, 900004), "bad bbox skipped")

    # Rulings 3 and 5: worker row keeps origin/kind/unit/time_steps/variable/unit; text and flags update.
    put(conn, 900003)
    rep = catalogue_sync.sync(conn, [item(900003, title="new", abstract="mô tả", subtype="vector",
                                          isPublished=True, isApproved=True)], NOW)
    check(rep.updated == 1, "update count")
    origin, kind, unit, steps, title, pub, appr = row(conn, 900003)
    check((origin, kind, unit) == ("webatlas-upload", "timeseries", "01"), "kept origin/kind/unit")
    check(steps and len(steps) == 1, "kept time_steps")
    check((title, pub, appr) == ("new", True, True), "title/flags updated")
    check(row(conn, 900003, "abstract, variable, unit") == ("mô tả", "depth", "m"), "abstract updated, variable/unit kept")


def test_alternate_and_ghosts(conn):
    # M4: an item without an alternate is skipped; the run goes on.
    rep = catalogue_sync.sync(conn, [item(900050, alternate=None), item(900051, alternate=""), item(900052)], NOW)
    check(rep.inserted == 1 and row(conn, 900050) is None and row(conn, 900051) is None and row(conn, 900052),
          f"no alternate skipped {rep}")
    # A Map (or Document) has no GeoServer layer, so GeoNode gives it no alternate either: that is
    # expected, not an error, and it is still written (kind_of chooses by resourceType).
    rep = catalogue_sync.sync(conn, [item(900056, resourceType="map", alternate=None),
                                     item(900057, resourceType="document", alternate=None)], NOW)
    check(rep.inserted == 2 and row(conn, 900056, "kind")[0] == "map"
          and row(conn, 900057, "kind")[0] == "document", f"map/document without alternate inserted {rep}")
    # I3: a ts_ series with no GeoServer layer and no worker row is skipped ...
    ghost = item(900053, alternate="geonode:ts_0123456789abcdef", subtype="raster", hasLayer=False)
    rep = catalogue_sync.sync(conn, [ghost], NOW)
    check(rep.inserted == 0 and row(conn, 900053) is None, "ghost ts_ skipped")
    # ... with its layer, it is inserted ...
    rep = catalogue_sync.sync(conn, [{**ghost, "hasLayer": True}], NOW)
    check(rep.inserted == 1 and row(conn, 900053), "ts_ with its layer inserted")
    # ... a worker row is still updated when the layer is reported missing ...
    put(conn, 900054)
    rep = catalogue_sync.sync(conn, [item(900054, title="t", hasLayer=False,
                                          alternate="geonode:ts_900054")], NOW)
    check(rep.updated == 1 and row(conn, 900054, "title")[0] == "t", "worker row updated without its layer")
    # ... and a non-ts_ item is never skipped for hasLayer false.
    rep = catalogue_sync.sync(conn, [item(900055, hasLayer=False)], NOW)
    check(rep.inserted == 1, "hasLayer false outside ts_ inserted")


def test_permissions_and_owner(conn):
    # I1: GeoNode's anonymous view/download are stored and refreshed; absent means not granted.
    catalogue_sync.sync(conn, [item(900060, isPublished=True, anonymousView=True, anonymousDownload=True),
                               item(900061, isPublished=True)], NOW)
    check(row(conn, 900060, "public_view, public_download") == (True, True), "flags stored")
    check(row(conn, 900061, "public_view, public_download") == (False, False), "absent flags are false")
    catalogue_sync.sync(conn, [item(900060, isPublished=True, anonymousView=True, anonymousDownload=False)], NOW)
    check(row(conn, 900060, "public_view, public_download") == (True, False), "flags refreshed on conflict")
    # M5: ownership moved in GeoNode moves here, except on the worker's rows.
    catalogue_sync.sync(conn, [item(900060, ownerSub="sub-2")], NOW)
    check(row(conn, 900060, "owner_sub")[0] == "sub-2", "owner refreshed")
    put(conn, 900062)
    conn.execute("UPDATE catalogue.resources SET owner_sub = 'uploader' WHERE geonode_pk = 900062")
    catalogue_sync.sync(conn, [item(900062, ownerSub="sub-2", anonymousView=True)], NOW)
    check(row(conn, 900062, "owner_sub, public_view") == ("uploader", True), "worker row keeps its owner, takes flags")


def test_full_listing_due():
    from . import definitions
    due = [m for m in range(60) if definitions.full_listing_due(NOW.replace(minute=m))]
    check(due == [0, 10, 20, 30, 40, 50], f"M6: full listing every 10 minutes {due}")


def test_ruling2_incremental_non_processed(conn):
    put(conn, 900005, title="keep")
    rep = catalogue_sync.sync(conn, [item(900005, state="RUNNING", title="changed", isPublished=True)], NOW)
    check(rep.updated == 0 and row(conn, 900005, "title, is_published") == ("keep", False), "non-PROCESSED row unchanged")


def test_ruling4_full_updates_flags(conn):
    put(conn, 900006, title="old")
    rep = catalogue_sync.sync(conn, others(conn) + [item(900006, title="t2", isPublished=True, isApproved=True)],
                              NOW, full=True)
    check(row(conn, 900006, "title, is_published, is_approved") == ("t2", True, True), "full run updates flags")


def test_two_step_deletion(conn):
    put(conn, 900010)
    put(conn, 900011)
    base = others(conn) + [item(900010, state="RUNNING")]
    # Incremental: never marks.
    catalogue_sync.sync(conn, [], NOW)
    check(missing_since(conn, 900011) is None, "incremental does not mark")
    # First full run only marks.
    rep = catalogue_sync.sync(conn, base, NOW, full=True)
    check(rep.removed == 0 and rep.marked == 1 and missing_since(conn, 900011) == NOW, "first full marks")
    check(row(conn, 900010) and missing_since(conn, 900010) is None, "listed row untouched")
    # The same run time again must not delete (marked by this run start, not earlier).
    rep = catalogue_sync.sync(conn, base, NOW, full=True)
    check(rep.removed == 0 and row(conn, 900011), "same-start run does not delete")
    # Re-listed: unmarked.
    catalogue_sync.sync(conn, base + [item(900011, state="RUNNING")], LATER, full=True)
    check(row(conn, 900011) and missing_since(conn, 900011) is None, "re-listed row unmarked")
    # Absent again: marked, then deleted by a later full run about an hour on, not 10 minutes on.
    catalogue_sync.sync(conn, base, LATER, full=True)
    check(missing_since(conn, 900011) == LATER, "marked again")
    rep = catalogue_sync.sync(conn, base, LATER + timedelta(minutes=10), full=True)
    check(rep.removed == 0 and row(conn, 900011), "a full run 10 minutes after the mark does not delete")
    rep = catalogue_sync.sync(conn, base, LATER + timedelta(hours=1), full=True)
    check(rep.removed == 1 and row(conn, 900011) is None and row(conn, 900010), "second full deletes")


def test_listing_start_race(conn):
    put(conn, 900020, created=NOW + timedelta(minutes=1))
    put(conn, 900021, synced=NOW + timedelta(minutes=1))
    base = others(conn) + [item(900022, state="RUNNING")]
    catalogue_sync.sync(conn, base, NOW, full=True)
    catalogue_sync.sync(conn, base, LATER, full=True)
    check(row(conn, 900020) and row(conn, 900021), "rows created/synced after listing start are untouched")
    # The second run (LATER) is after both, so they are now fair game: marked, not deleted.
    check(missing_since(conn, 900020) == LATER, "later run marks them")


def test_guards(conn):
    # Empty listing marks and deletes nothing.
    put(conn, 900030)
    put(conn, 900031, missing=LONG_AGO)
    rep = catalogue_sync.sync(conn, [], LATER, full=True)
    check(rep == catalogue_sync.SyncReport(0, 0, 0, 0) and row(conn, 900031) and missing_since(conn, 900030) is None,
          "empty listing does nothing")
    # More than half of the table absent: nothing marked.
    n = len(others(conn)) + 6
    for k in range(n):
        put(conn, 900100 + k)
    rep = catalogue_sync.sync(conn, others(conn) + [item(900030, state="RUNNING")], LATER, full=True)
    check(rep.marked == 0 and missing_since(conn, 900100) is None, f"over-half guard {rep}")


def test_fetch():
    seen = []

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            seen.append((u.path, q, self.headers.get("Authorization")))
            page = int(q["page"][0])
            body = {"resources": [item(page)], "next": 2 if page == 1 else 1}  # page 2 points back at 1
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.environ["GEONODE_BRIDGE_URL"] = f"http://127.0.0.1:{srv.server_port}/"
    os.environ["WEBATLAS_BRIDGE_TOKEN"] = "tok"
    try:
        since = datetime(2026, 11, 10, 19, 0, tzinfo=timezone(timedelta(hours=7)))
        got = list(catalogue_sync.fetch_resources(since))
        check([g["pk"] for g in got] == [1, 2], f"pagination and loop guard {[g['pk'] for g in got]}")
        check(len(seen) == 2, f"requests {len(seen)}")
        check(all(s[0] == "/webatlas-bridge/resources" and s[2] == "Bearer tok" for s in seen), "path/bearer")
        check(seen[0][1]["since"] == ["2026-11-10T12:00:00+00:00"], f"since {seen[0][1]['since']}")
        seen.clear()
        list(catalogue_sync.fetch_resources(None))
        check("since" not in seen[0][1], "no since for the full listing")
        try:
            catalogue_sync.fetch_resources(datetime(2026, 11, 10))
            check(False, "naive since must raise")
        except ValueError:
            pass
    finally:
        srv.shutdown()
        srv.server_close()


def composition(conn, map_pk):
    return conn.execute(
        """SELECT mc.position, r.geonode_pk, mc.visible, mc.opacity
             FROM catalogue.map_composition mc
             JOIN catalogue.resources m ON m.id = mc.map_resource_id
        LEFT JOIN catalogue.resources r ON r.id = mc.layer_resource_id
            WHERE m.geonode_pk = %s ORDER BY mc.position""",
        (map_pk,)
    ).fetchall()


def test_sync_map_composition(conn):
    catalogue_sync.sync(conn, [item(900070, resourceType="map"), item(900071), item(900072)], NOW)
    map_id = conn.execute("SELECT id FROM catalogue.resources WHERE geonode_pk = 900070").fetchone()[0]

    layers = [
        {"datasetPk": 900072, "order": 0, "visible": True, "opacity": 1.0},
        {"datasetPk": 900071, "order": 1, "visible": False, "opacity": 0.5},
        {"datasetPk": 999999, "order": 2, "visible": True, "opacity": 1.0},  # not in the catalogue
    ]
    catalogue_sync.sync_map_composition(conn, map_id, layers)
    rows = composition(conn, 900070)
    check(rows == [(0, 900072, True, 1.0), (1, 900071, False, 0.5), (2, None, True, 1.0)],
          f"composition resolved, unresolved layer kept as a gap: {rows}")

    # A second sync fully replaces the first (fewer layers, a different order).
    catalogue_sync.sync_map_composition(conn, map_id, [{"datasetPk": 900071, "order": 0, "visible": True, "opacity": 1.0}])
    rows = composition(conn, 900070)
    check(rows == [(0, 900071, True, 1.0)], f"second sync replaces the first: {rows}")

    catalogue_sync.sync_map_composition(conn, map_id, [])
    check(composition(conn, 900070) == [], "empty layers clears the composition")


def test_sync_maps(conn):
    catalogue_sync.sync(conn, [item(900080, resourceType="map"), item(900081, resourceType="map"),
                               item(900082), item(900083, state="RUNNING", resourceType="map")], NOW)
    calls = []

    def fake_fetch(pk):
        calls.append(pk)
        if pk == 900081:
            raise RuntimeError("bridge unreachable")
        return [{"datasetPk": 900082, "order": 0, "visible": True, "opacity": 1.0}]

    resources = [item(900080, resourceType="map"), item(900081, resourceType="map"), item(900082),
                 item(900083, state="RUNNING", resourceType="map"), item(900084, resourceType="map")]
    n = catalogue_sync.sync_maps(conn, resources, fetch_layers=fake_fetch)
    check(sorted(calls) == [900080, 900081], f"only the two written Maps are fetched: {calls}")
    check(n == 1, f"a fetch failure is caught and does not count: {n}")
    check(composition(conn, 900080) == [(0, 900082, True, 1.0)], "the surviving Map's composition is written")
    check(composition(conn, 900081) == [], "the failed fetch leaves no composition")


def test_fetch_map_layers():
    seen = []

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("Authorization")))
            body = json.dumps({"layers": [{"datasetPk": 1, "order": 0, "visible": True, "opacity": 1.0}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.environ["GEONODE_BRIDGE_URL"] = f"http://127.0.0.1:{srv.server_port}/"
    os.environ["WEBATLAS_BRIDGE_TOKEN"] = "tok"
    try:
        got = catalogue_sync.fetch_map_layers(42)
        check(got == [{"datasetPk": 1, "order": 0, "visible": True, "opacity": 1.0}], f"layers {got}")
        check(seen == [("/webatlas-bridge/maps/42/layers", "Bearer tok")], f"path/bearer {seen}")
    finally:
        srv.shutdown()
        srv.server_close()


def test_plan_and_run(conn):
    check(catalogue_sync.plan(None, False) == (True, None), "empty table forces a full run")
    check(catalogue_sync.plan(NOW, True) == (True, None), "forced full")
    check(catalogue_sync.plan(NOW, False) == (False, NOW - timedelta(minutes=2)), "2-minute overlap")
    # run(): since = max(synced_at) - 2 min; synced_at far in the future so it is the table's maximum.
    future = datetime(2030, 1, 1, tzinfo=timezone.utc)
    put(conn, 900040, synced=future)
    conn.commit()
    asked = []
    rep = catalogue_sync.run(conn, NOW, False, fetch=lambda since: asked.append(since) or [item(900041)])
    check(asked == [future - timedelta(minutes=2)] and rep.inserted == 1 and rep.maps_synced == 0,
          f"run since {asked} {rep}")
    check(row(conn, 900041), "run committed")
    # A Map in the listing is synced too, in the same run.
    map_calls = []
    rep = catalogue_sync.run(
        conn, NOW, False,
        fetch=lambda since: [item(900042, resourceType="map")],
        fetch_layers=lambda pk: map_calls.append(pk) or [],
    )
    check(map_calls == [900042] and rep.maps_synced == 1, f"run syncs the Map's composition too: {rep} {map_calls}")
    # A concurrent holder of the lock makes the run skip.
    with psycopg.connect(registry.database_url()) as other:
        other.execute("SELECT pg_advisory_xact_lock(%s)", (catalogue_sync._LOCK_KEY,))
        called = []
        rep = catalogue_sync.run(conn, NOW, False, fetch=lambda since: called.append(1) or [])
        check(rep is None and not called, "overlapping run skipped")


def main():
    test_kind()
    test_fetch()
    test_fetch_map_layers()
    test_full_listing_due()
    with registry.connect() as conn:
        clean(conn)
        conn.commit()
        try:
            for t in (test_insert_and_update, test_alternate_and_ghosts, test_permissions_and_owner,
                      test_ruling2_incremental_non_processed, test_ruling4_full_updates_flags,
                      test_two_step_deletion, test_listing_start_race, test_guards,
                      test_sync_map_composition, test_sync_maps):
                t(conn)
                conn.rollback()
            test_plan_and_run(conn)
        finally:
            conn.rollback()
            clean(conn)
            conn.commit()
    print("ok")


if __name__ == "__main__":
    main()
