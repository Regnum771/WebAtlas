"""Read-only access to the dataset registry that packages/atlas-data writes to PostGIS."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from datetime import datetime

import psycopg


@dataclass(frozen=True)
class StageState:
    stage: str
    status: str
    input_hash: str
    produced_at: datetime


@dataclass(frozen=True)
class Dataset:
    dataset_id: str
    statement: str
    licence: str


def database_url() -> str:
    return os.environ["WEBATLAS_DATABASE_URL"]


def connect() -> psycopg.Connection:
    return psycopg.connect(database_url(), connect_timeout=5)


def list_datasets(conn: psycopg.Connection) -> list[Dataset]:
    rows = conn.execute(
        "SELECT dataset_id, statement, licence FROM app.dataset_lineage ORDER BY dataset_id"
    ).fetchall()
    return [Dataset(*r) for r in rows]


def stage_states(conn: psycopg.Connection, dataset_id: str) -> list[StageState]:
    rows = conn.execute(
        "SELECT stage, status, input_hash, produced_at FROM app.dataset_stage_state"
        " WHERE dataset_id = %s ORDER BY stage",
        (dataset_id,),
    ).fetchall()
    return [StageState(*r) for r in rows]


def asset_name(dataset_id: str) -> str:
    """Dagster asset keys allow letters, digits and underscores only."""
    name = re.sub(r"[^A-Za-z0-9_]", "_", dataset_id)
    return name if not name[:1].isdigit() else f"d_{name}"


def data_version(states: list[StageState]) -> str:
    """Changes whenever any stage reran with different inputs or changed status."""
    h = hashlib.sha256()
    for s in states:
        h.update(f"{s.stage}\0{s.status}\0{s.input_hash}\n".encode())
    return h.hexdigest()[:16]
