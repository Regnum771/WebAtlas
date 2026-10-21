"""
The workspace import/export worker: claims jobs the API queued in workspace.jobs, runs the handler
for the job's kind, and records per-step progress, the result or the error.

    python3 packages/atlas-data/tools/workspace/worker.py          # run forever (Compose service `worker`)
    python3 packages/atlas-data/tools/workspace/worker.py --once   # run at most one job, then exit

Two connections per job:
- the main connection carries the handler's database writes in ONE transaction, committed together
  with the job's success, or rolled back on any error;
- a second, autocommit connection carries step updates, progress and heartbeats, so a client polling
  the job sees them while that transaction is still open.

A worker that dies mid-job leaves its job `running` with a heartbeat that stops moving; the database
rolls back its open transaction, and fail_stale (run at start and every minute by any worker) fails
the job with STALE_MESSAGE.
"""
import argparse
import os
import pathlib
import signal
import sys
import threading
import time
import traceback
from typing import Callable

import psycopg2
from psycopg2.extensions import connection

if __name__ == "__main__":
    # Handler modules import this one as `worker`; let them get the running module rather than a
    # second copy with its own UserFacingError.
    sys.modules.setdefault("worker", sys.modules[__name__])

import jobs_db

# GDAL drivers the worker never needs. Each can make GDAL open other files or fetch URLs merely
# because an upload's content names them (an <OGRVRTDataSource> in a .geojson, a WFS/WMS service
# description, ...). PostgreSQL is listed even though this build's pyogrio has no such driver, so a
# future build that does stays covered (GDAL warns once about the missing name).
GDAL_SKIP_DRIVERS = ("VRT", "OGR_VRT", "WFS", "OAPIF", "WMS", "WMTS", "PostgreSQL", "CSV", "SQLite", "GML", "HTTP")
GDAL_CONFIG = {
    "GDAL_SKIP": " ".join(GDAL_SKIP_DRIVERS),
    # No network: /vsicurl/ only opens names ending in one of these extensions, and none will.
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".webatlas-no-network",
    "GDAL_HTTP_TIMEOUT": "1",
    "GDAL_HTTP_CONNECTTIMEOUT": "1",
    "GDAL_HTTP_MAX_RETRY": "0",
}


def configure_gdal():
    """
    Restrict every GDAL the worker loads (pyogrio's, and rasterio's for Task 7) as GDAL_CONFIG says.
    Set through the environment: GDAL reads the network options on each use, but reads GDAL_SKIP only
    once, when it registers its drivers, i.e. when pyogrio is imported. So this must run before
    pyogrio is imported, and refuses to go on if that already happened.
    """
    os.environ.update(GDAL_CONFIG)
    if "pyogrio" in sys.modules:
        import pyogrio

        if "OGR_VRT" in pyogrio.list_drivers():
            raise RuntimeError("GDAL was loaded before configure_gdal(); import worker before pyogrio")


configure_gdal()

UNEXPECTED_MESSAGE = "Lỗi không mong đợi khi xử lý tệp."
STALE_MESSAGE = jobs_db.STALE_MESSAGE

IDLE_SLEEP_SECONDS = 2
STALE_CHECK_SECONDS = 60
STALE_AFTER_SECONDS = 600
HEARTBEAT_SECONDS = 30
RECONNECT_SECONDS = 5


def store_root() -> pathlib.Path:
    """The file store root, shared with the API (WORKSPACE_FILES_DIR)."""
    return pathlib.Path(os.environ.get("WORKSPACE_FILES_DIR", "/repo/var/workspace-files"))


class UserFacingError(Exception):
    """An error whose message (Vietnamese, for the user) becomes the job's error as is."""

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


class Steps:
    """
    The handler's progress reporter. Writes on the autocommit side connection, so every update is
    visible at once; a lock serialises it with the heartbeat thread.
    """

    def __init__(self, conn: connection, job: dict):
        self._conn = conn
        self._job_id = job["id"]
        self._keys = {s["key"] for s in job.get("steps") or []}
        self._lock = threading.Lock()

    def _check(self, key):
        if key not in self._keys:
            raise ValueError(f"job {self._job_id} has no step {key!r}")

    def start(self, key: str):
        self._check(key)
        with self._lock:
            jobs_db.set_step(self._conn, self._job_id, key, "running")

    def done(self, key: str, message: str | None = None):
        self._check(key)
        with self._lock:
            jobs_db.set_step(self._conn, self._job_id, key, "done", message)

    def progress(self, pct):
        with self._lock:
            jobs_db.set_progress(self._conn, self._job_id, pct)

    def heartbeat(self):
        with self._lock:
            jobs_db.heartbeat(self._conn, self._job_id)

    def fail(self, message: str):
        """Fail the job: the running step becomes failed with the message."""
        with self._lock:
            jobs_db.fail(self._conn, self._job_id, message)


# Handlers by job kind. A handler writes only through `conn` (never commits it, never writes
# workspace.jobs on it) and reports through `steps`; it returns the job's result. Tasks 6-8
# register `import` and `export`.
HANDLERS: dict[str, Callable[[connection, dict, Steps], dict]] = {}

UNSUPPORTED_FORMAT_MESSAGE = "Định dạng tệp không được hỗ trợ."
# Upload extensions by import path (Global Constraints: the formats read).
VECTOR_EXTENSIONS = (".gpkg", ".geojson", ".json", ".zip", ".kml")
RASTER_EXTENSIONS = (".tif", ".tiff")


def import_extension(params: dict) -> str:
    """The upload's extension, lower case: from its original name, else from its store path."""
    for name in (params.get("originalName"), params.get("path")):
        if isinstance(name, str):
            ext = pathlib.PurePosixPath(name.replace("\\", "/")).suffix.lower()
            if ext:
                return ext
    return ""


def run_import(conn: connection, job: dict, steps: Steps) -> dict:
    """The one `import` handler: dispatches on the upload's extension."""
    ext = import_extension(job.get("params") or {})
    if ext in VECTOR_EXTENSIONS:
        return import_vector.run_import_vector(conn, job, steps)
    # Rasters (RASTER_EXTENSIONS) are refused until the raster import (Task 7) replaces this branch.
    steps.start("read")
    raise UserFacingError(UNSUPPORTED_FORMAT_MESSAGE)


def _beat(steps: Steps, stop: threading.Event):
    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            steps.heartbeat()
        except Exception:  # a missed beat is harmless; the next step update beats too
            traceback.print_exc(file=sys.stdout)


def run_once(conn: connection, only_ids=None) -> bool:
    """Claim one job and run it. Returns False when nothing was queued."""
    job = jobs_db.claim(conn, only_ids)
    if job is None:
        return False
    job_id = job["id"]
    print(f"job {job_id}: {job['kind']} started", flush=True)
    side = jobs_db.connect(autocommit=True)
    steps = Steps(side, job)
    stop = threading.Event()
    beat = threading.Thread(target=_beat, args=(steps, stop), daemon=True)
    beat.start()
    try:
        try:
            handler = HANDLERS.get(job["kind"])
            if handler is None:
                raise RuntimeError(f"no handler for job kind {job['kind']!r}")
            result = handler(conn, job, steps)
            if jobs_db.succeed(conn, job_id, result if result is not None else {}):
                conn.commit()
                print(f"job {job_id}: succeeded", flush=True)
            else:
                # Failed as stale while we worked: drop the writes, keep the failure.
                conn.rollback()
                print(f"job {job_id}: no longer running; its writes were rolled back", flush=True)
        except Exception as e:
            conn.rollback()
            message = getattr(e, "user_message", None)
            if isinstance(message, str) and message:
                print(f"job {job_id}: failed: {message}", flush=True)
            else:
                message = UNEXPECTED_MESSAGE
                print(f"job {job_id}: failed unexpectedly", flush=True)
                traceback.print_exc(file=sys.stdout)
            steps.fail(message)
        except BaseException:
            # Stopped mid-job (SIGTERM, Ctrl-C): say so now rather than after the stale timeout.
            conn.rollback()
            steps.fail(STALE_MESSAGE)
            raise
    finally:
        stop.set()
        beat.join()
        side.close()
    return True


def _on_sigterm(signum, frame):
    raise SystemExit(0)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="WebAtlas workspace import/export worker")
    parser.add_argument("--once", action="store_true", help="run at most one job, then exit")
    args = parser.parse_args(argv)
    signal.signal(signal.SIGTERM, _on_sigterm)

    if args.once:
        conn = jobs_db.connect()
        try:
            jobs_db.fail_stale(conn, STALE_AFTER_SECONDS)
            ran = run_once(conn)
            print("ran one job" if ran else "no queued job", flush=True)
        finally:
            conn.close()
        return 0

    print(f"worker started; store root {store_root()}", flush=True)
    conn = None
    last_stale_check = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = jobs_db.connect()
            now = time.monotonic()
            if last_stale_check is None or now - last_stale_check >= STALE_CHECK_SECONDS:
                n = jobs_db.fail_stale(conn, STALE_AFTER_SECONDS)
                if n:
                    print(f"failed {n} stale job(s)", flush=True)
                last_stale_check = now
            if not run_once(conn):
                time.sleep(IDLE_SLEEP_SECONDS)
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            print("database unavailable; reconnecting", flush=True)
            traceback.print_exc(file=sys.stdout)
            if conn is not None and not conn.closed:
                conn.close()
            conn = None
            time.sleep(RECONNECT_SECONDS)


# Imported after everything above exists: the handler modules import UserFacingError and
# store_root from this module.
import import_vector  # noqa: E402

HANDLERS["import"] = run_import

if __name__ == "__main__":
    sys.exit(main())
