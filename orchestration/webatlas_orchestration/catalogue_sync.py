"""Keeps catalogue.resources in step with GeoNode (S1 catalogue-to-map).

GeoNode's WebATLAS bridge lists its resources; sync() writes them into the table. Rows the worker
wrote itself (origin 'webatlas-upload') keep their origin, kind, managing unit and time-series
columns: the sync only refreshes title, abstract, publish/approve flags, bbox and synced_at.

Dagster's image does not contain packages/atlas-data, so the bridge call is a small client here.
Environment: GEONODE_BRIDGE_URL, WEBATLAS_BRIDGE_TOKEN.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator, Optional

import psycopg
import requests

log = logging.getLogger(__name__)

_LIST_TIMEOUT = 120
_OVERLAP = timedelta(minutes=2)
# Fixed key of the advisory lock that keeps two sync runs from overlapping.
_LOCK_KEY = 7_203_001
# Managing unit of a resource that has no extent.
_NATIONAL_UNIT = "VN"


@dataclass(frozen=True)
class SyncReport:
    inserted: int
    updated: int
    removed: int
    marked: int = 0


def kind_of(r: dict) -> str:
    """Catalogue kind of a new GeoNode item. sync() never changes the kind of an existing row."""
    rtype = r.get("resourceType")
    if rtype == "map":
        return "map"
    if rtype == "document":
        return "document"
    return "raster" if r.get("subtype") == "raster" else "vector"


def fetch_resources(since: datetime | None = None, session=None) -> Iterator[dict]:
    """Every resource GeoNode changed at or after `since` (all of them when None), following pages."""
    if since is not None and since.tzinfo is None:
        raise ValueError("since must be timezone-aware")
    return _pages(since, session or requests)


def _pages(since, http) -> Iterator[dict]:
    base = os.environ["GEONODE_BRIDGE_URL"].rstrip("/") + "/webatlas-bridge/resources"
    headers = {"Authorization": f"Bearer {os.environ['WEBATLAS_BRIDGE_TOKEN']}"}
    params = {} if since is None else {"since": since.astimezone(timezone.utc).isoformat()}
    page, seen = 1, set()
    while page is not None and page not in seen:
        seen.add(page)
        r = http.get(base, headers=headers, params={**params, "page": page}, timeout=_LIST_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        yield from body["resources"]
        page = body["next"]
    if page is not None:
        log.warning("bridge listing repeats page %s: stopped", page)


def last_synced(conn: psycopg.Connection) -> datetime | None:
    return conn.execute("SELECT max(synced_at) FROM catalogue.resources").fetchone()[0]


def _valid_bbox(b) -> bool:
    return (isinstance(b, (list, tuple)) and len(b) == 4
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in b))


def sync(conn: psycopg.Connection, resources: Iterable[dict], now: datetime, full: bool = False) -> SyncReport:
    """
    Write `resources` into catalogue.resources. `now` is the start of the listing. Only items GeoNode
    reports PROCESSED are inserted or updated; an existing row keeps its kind, origin, unit and
    time-series columns. With full=True the iterable is the complete listing and absent rows are
    reconciled in two steps (see _reconcile); an incremental run never marks or deletes.
    """
    listed: set[int] = set()
    inserted = updated = 0
    for r in resources:
        listed.add(r["pk"])
        if r.get("state") != "PROCESSED":
            continue
        bbox = r.get("bbox4326")
        if bbox is not None and not _valid_bbox(bbox):
            log.warning("resource %s: bbox4326 %r is not four numbers, skipped", r["pk"], bbox)
            continue
        b = list(bbox) if bbox is not None else [None] * 4
        fresh = conn.execute(
            """
            INSERT INTO catalogue.resources
              (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
               is_published, is_approved, bbox4326, origin, synced_at, updated_at)
            VALUES (%(pk)s, %(uuid)s, %(alternate)s, %(kind)s, %(title)s, %(abstract)s, %(owner)s,
                    COALESCE(CASE WHEN %(w)s::float8 IS NULL THEN NULL
                                  ELSE catalogue.unit_for_bbox(%(w)s::float8, %(s)s::float8, %(e)s::float8, %(n)s::float8) END,
                             %(national)s),
                    %(pub)s, %(appr)s,
                    CASE WHEN %(w)s::float8 IS NULL THEN NULL
                         ELSE ARRAY[%(w)s::float8, %(s)s::float8, %(e)s::float8, %(n)s::float8] END,
                    'geonode-upload', %(now)s, %(now)s)
            ON CONFLICT (geonode_pk) DO UPDATE
               SET title = EXCLUDED.title, abstract = EXCLUDED.abstract,
                   is_published = EXCLUDED.is_published, is_approved = EXCLUDED.is_approved,
                   bbox4326 = COALESCE(EXCLUDED.bbox4326, catalogue.resources.bbox4326),
                   synced_at = EXCLUDED.synced_at, updated_at = EXCLUDED.updated_at
            RETURNING (xmax = 0)
            """,
            dict(pk=r["pk"], uuid=r["uuid"], alternate=r["alternate"], kind=kind_of(r), title=r["title"],
                 abstract=r.get("abstract") or "", owner=r.get("ownerSub"), pub=bool(r["isPublished"]),
                 appr=bool(r["isApproved"]), w=b[0], s=b[1], e=b[2], n=b[3], national=_NATIONAL_UNIT, now=now),
        ).fetchone()[0]
        if fresh:
            inserted += 1
        else:
            updated += 1
    removed = marked = 0
    if full:
        removed, marked = _reconcile(conn, listed, now)
    return SyncReport(inserted, updated, removed, marked)


def _reconcile(conn: psycopg.Connection, listed: set[int], now: datetime) -> tuple[int, int]:
    """
    Two-step deletion after a full listing: a row listed again is unmarked; an absent row already
    marked by an earlier run (missing_since < now) is deleted; an absent unmarked row is marked.
    Rows created or synced at or after `now` (a worker insert racing the listing) are left alone.
    An empty listing, or one that would mark over half of a table of more than four rows, does nothing.
    """
    if not listed:
        log.warning("full listing is empty: nothing marked or deleted")
        return 0, 0
    pks = sorted(listed)
    conn.execute("UPDATE catalogue.resources SET missing_since = NULL "
                 "WHERE geonode_pk = ANY(%s) AND missing_since IS NOT NULL", (pks,))
    absent = "geonode_pk <> ALL(%(pks)s) AND created_at < %(now)s AND (synced_at IS NULL OR synced_at < %(now)s)"
    args = dict(pks=pks, now=now)
    removed = conn.execute(
        f"DELETE FROM catalogue.resources WHERE {absent} AND missing_since < %(now)s", args).rowcount
    to_mark = conn.execute(
        f"SELECT count(*) FROM catalogue.resources WHERE {absent} AND missing_since IS NULL", args).fetchone()[0]
    total = conn.execute("SELECT count(*) FROM catalogue.resources").fetchone()[0]
    if total > 4 and to_mark * 2 > total:
        log.warning("full listing lacks %d of %d rows: nothing marked", to_mark, total)
        return removed, 0
    conn.execute(
        f"UPDATE catalogue.resources SET missing_since = %(now)s WHERE {absent} AND missing_since IS NULL", args)
    return removed, to_mark


def plan(last: datetime | None, full: bool) -> tuple[bool, Optional[datetime]]:
    """(full, since) of a run: incremental from the last sync minus an overlap; full when forced or never synced."""
    if full or last is None:
        return True, None
    return False, last - _OVERLAP


def run(conn: psycopg.Connection, now: datetime, full: bool, fetch=fetch_resources) -> Optional[SyncReport]:
    """One scheduled run in one transaction; None when another run holds the lock."""
    if not conn.execute("SELECT pg_try_advisory_xact_lock(%s)", (_LOCK_KEY,)).fetchone()[0]:
        log.warning("another catalogue sync is running: skipped")
        conn.rollback()
        return None
    full, since = plan(last_synced(conn), full)
    report = sync(conn, fetch(since), now, full=full)
    conn.commit()
    return report
