"""Keeps catalogue.resources in step with GeoNode (S1 catalogue-to-map).

GeoNode's WebATLAS bridge lists its resources; sync() writes them into the table. Rows the worker
wrote itself (origin 'webatlas-upload') keep their origin, kind, managing unit and time-series
columns: the sync only refreshes title, abstract, publish/approve flags, bbox and synced_at.

Dagster's image does not contain packages/atlas-data, so the bridge call is a small client here.
Environment: GEONODE_BRIDGE_URL, WEBATLAS_BRIDGE_TOKEN.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator

import psycopg
import requests

_LIST_TIMEOUT = 120
_OVERLAP = timedelta(minutes=2)
# Managing unit of a resource that has no extent.
_NATIONAL_UNIT = "VN"


@dataclass(frozen=True)
class SyncReport:
    inserted: int
    updated: int
    removed: int


def kind_of(r: dict) -> str:
    """Catalogue kind of a new GeoNode item. sync() never changes the kind of an existing row."""
    rtype = r.get("resourceType")
    if rtype == "map":
        return "map"
    if rtype == "document":
        return "document"
    return "raster" if r.get("subtype") == "raster" else "vector"


def fetch_resources(since: datetime | None = None) -> Iterator[dict]:
    """Every resource GeoNode changed at or after `since` (all of them when None), following pages."""
    if since is not None and since.tzinfo is None:
        raise ValueError("since must be timezone-aware")
    base = os.environ["GEONODE_BRIDGE_URL"].rstrip("/") + "/webatlas-bridge/resources"
    headers = {"Authorization": f"Bearer {os.environ['WEBATLAS_BRIDGE_TOKEN']}"}
    params = {} if since is None else {"since": since.astimezone(timezone.utc).isoformat()}
    page = 1
    while page is not None:
        r = requests.get(base, headers=headers, params={**params, "page": page}, timeout=_LIST_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        yield from body["resources"]
        page = body["next"]


def last_synced(conn: psycopg.Connection) -> datetime | None:
    return conn.execute("SELECT max(synced_at) FROM catalogue.resources").fetchone()[0]


def sync(conn: psycopg.Connection, resources: Iterable[dict], now: datetime, full: bool = False) -> SyncReport:
    """
    Write `resources` into catalogue.resources. Only items GeoNode reports PROCESSED are inserted or
    updated. With full=True the iterable is the complete listing: rows whose pk is absent from it
    (in any state) are deleted; an incremental run never deletes.
    """
    listed: set[int] = set()
    inserted = updated = 0
    for r in resources:
        listed.add(r["pk"])
        if r.get("state") != "PROCESSED":
            continue
        bbox = list(r["bbox4326"]) if r.get("bbox4326") else None
        abstract = r.get("abstract") or ""
        exists = conn.execute("SELECT 1 FROM catalogue.resources WHERE geonode_pk = %s", (r["pk"],)).fetchone()
        if exists:
            conn.execute(
                """
                UPDATE catalogue.resources
                   SET title = %s, abstract = %s, is_published = %s, is_approved = %s,
                       bbox4326 = COALESCE(%s::float8[], bbox4326), synced_at = %s, updated_at = %s
                 WHERE geonode_pk = %s
                """,
                (r["title"], abstract, bool(r["isPublished"]), bool(r["isApproved"]), bbox, now, now, r["pk"]),
            )
            updated += 1
            continue
        unit = _NATIONAL_UNIT
        if bbox:
            unit = conn.execute("SELECT catalogue.unit_for_bbox(%s, %s, %s, %s)", bbox).fetchone()[0] or unit
        conn.execute(
            """
            INSERT INTO catalogue.resources
              (geonode_pk, geonode_uuid, alternate, kind, title, abstract, owner_sub, managing_unit,
               is_published, is_approved, bbox4326, origin, synced_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::float8[], 'geonode-upload', %s)
            """,
            (r["pk"], r["uuid"], r["alternate"], kind_of(r), r["title"], abstract, r.get("ownerSub"), unit,
             bool(r["isPublished"]), bool(r["isApproved"]), bbox, now),
        )
        inserted += 1
    removed = 0
    if full:
        removed = conn.execute(
            "DELETE FROM catalogue.resources WHERE NOT (geonode_pk = ANY(%s))", (sorted(listed),)
        ).rowcount
    return SyncReport(inserted, updated, removed)


def run(conn: psycopg.Connection, now: datetime, full: bool) -> SyncReport:
    """One scheduled run: incremental from the last sync (minus an overlap), or the full listing."""
    since = None if full else last_synced(conn)
    if since is None:
        full = True
    else:
        since -= _OVERLAP
    report = sync(conn, fetch_resources(since), now, full=full)
    conn.commit()
    return report
