"""Checks for catalogue_sync against the dev database.

Run: python -m webatlas_orchestration.test_catalogue_sync
"""

import uuid
from datetime import datetime, timezone

from . import catalogue_sync, registry

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


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


def row(conn, pk):
    return conn.execute(
        "SELECT origin, kind, managing_unit, time_steps, title, is_published, is_approved"
        " FROM catalogue.resources WHERE geonode_pk = %s", (pk,)).fetchone()


def main():
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "vector"}) == "vector", "vector")
    check(catalogue_sync.kind_of({"resourceType": "dataset", "subtype": "raster"}) == "raster", "raster")
    check(catalogue_sync.kind_of({"resourceType": "map"}) == "map", "map")
    check(catalogue_sync.kind_of({"resourceType": "document"}) == "document", "document")

    with registry.connect() as conn:
        clean(conn)
        try:
            # A new resource is inserted with its origin and a unit from its bbox.
            rep = catalogue_sync.sync(conn, [item(900001)], NOW)
            check(rep == catalogue_sync.SyncReport(1, 0, 0), f"insert report {rep}")
            origin, kind, unit, *_ = row(conn, 900001)
            check(origin == "geonode-upload" and kind == "vector", "origin/kind")
            expect = conn.execute("SELECT catalogue.unit_for_bbox(105,20,106,21)").fetchone()[0]
            check(unit and unit == expect, "unit from bbox")

            # Not PROCESSED: never inserted.
            rep = catalogue_sync.sync(conn, [item(900002, state="RUNNING")], NOW)
            check(rep.inserted == 0 and row(conn, 900002) is None, "RUNNING skipped")

            # A worker-written row keeps origin/kind/unit/time_steps; title and flags update.
            conn.execute(
                """INSERT INTO catalogue.resources (geonode_pk, geonode_uuid, alternate, kind, title,
                   managing_unit, is_published, is_approved, origin, time_steps, variable)
                   VALUES (900003, gen_random_uuid(), 'geonode:t900003', 'timeseries', 'old', '01', false,
                   false, 'webatlas-upload', ARRAY['2026-01-01T00:00Z']::timestamptz[], 'depth')""")
            rep = catalogue_sync.sync(conn, [item(900003, title="new", subtype="raster", isPublished=True,
                                                  isApproved=True)], NOW)
            check(rep.updated == 1, "update count")
            origin, kind, unit, steps, title, pub, appr = row(conn, 900003)
            check((origin, kind, unit) == ("webatlas-upload", "timeseries", "01"), "kept origin/kind/unit")
            check(steps and len(steps) == 1, "kept time_steps")
            check((title, pub, appr) == ("new", True, True), "title/flags updated")

            # An incremental run never deletes.
            rep = catalogue_sync.sync(conn, [], NOW)
            check(rep.removed == 0 and row(conn, 900001) and row(conn, 900003), "incremental no delete")

            # A full listing keeps pks still listed in any state, and deletes the absent ones.
            others = [r[0] for r in conn.execute(
                "SELECT geonode_pk FROM catalogue.resources WHERE geonode_pk < 900000").fetchall()]
            keep = [item(p, state="RUNNING") for p in others]
            rep = catalogue_sync.sync(conn, keep + [item(900001, state="RUNNING"), item(900003)], NOW, full=True)
            check(rep.removed == 0 and row(conn, 900001), "full keeps listed pks")
            rep = catalogue_sync.sync(conn, keep + [item(900003)], NOW, full=True)
            check(rep.removed == 1 and row(conn, 900001) is None and row(conn, 900003), "full deletes absent")
        finally:
            conn.rollback()
            clean(conn)
            conn.commit()
    print("ok")


if __name__ == "__main__":
    main()
