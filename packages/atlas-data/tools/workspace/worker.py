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
import sys

# Exactly one `worker` module, however this file is loaded: as the Compose script (`__main__`),
# through runpy under another name, or imported as `worker`. A second copy would carry its own
# HANDLERS and Steps. Registered before anything else is imported.
sys.modules.setdefault("worker", sys.modules[__name__])

import argparse  # noqa: E402
import signal  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402
from typing import Callable  # noqa: E402

import psycopg2  # noqa: E402
from psycopg2.extensions import connection  # noqa: E402

import jobs_db  # noqa: E402

# The leaf module first: importing it restricts GDAL (configure_gdal) before any handler loads
# pyogrio or rasterio. Its names are re-exported here for the handlers' callers and the tests.
from workspace_common import (  # noqa: E402,F401
    GDAL_CONFIG, GDAL_SKIP_DRIVERS, UNSUPPORTED, UserFacingError, configure_gdal, import_extension, store_root,
)
# The handlers import only workspace_common (never this module), so they load here without a cycle.
import import_raster  # noqa: E402
import import_vector  # noqa: E402

UNEXPECTED_MESSAGE = "Lỗi không mong đợi khi xử lý tệp."
STALE_MESSAGE = jobs_db.STALE_MESSAGE

IDLE_SLEEP_SECONDS = 2
STALE_CHECK_SECONDS = 60
STALE_AFTER_SECONDS = 600
HEARTBEAT_SECONDS = 30
RECONNECT_SECONDS = 5


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
        self._undo = []

    def on_rollback(self, fn: Callable[[], None]):
        """
        Run fn if the job's transaction is rolled back rather than committed: the handler failed,
        the job was failed as stale meanwhile, the commit failed, or the worker was stopped. For
        work the database cannot undo, such as a file the handler wrote to the store.
        """
        self._undo.append(fn)

    def rolled_back(self):
        """Called by run_once after a rollback: run every on_rollback callback, newest first."""
        undo, self._undo = self._undo, []
        for fn in reversed(undo):
            try:
                fn()
            except Exception:  # one failed undo must not keep the others from running
                traceback.print_exc(file=sys.stdout)

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

UNSUPPORTED_FORMAT_MESSAGE = UNSUPPORTED
# Upload extensions by import path (Global Constraints: the formats read).
VECTOR_EXTENSIONS = (".gpkg", ".geojson", ".json", ".zip", ".kml")
RASTER_EXTENSIONS = (".tif", ".tiff")


def run_import(conn: connection, job: dict, steps: Steps) -> dict:
    """The one `import` handler: dispatches on the upload's extension."""
    ext = import_extension(job.get("params") or {})
    if ext in VECTOR_EXTENSIONS:
        return import_vector.run_import_vector(conn, job, steps)
    if ext in RASTER_EXTENSIONS:
        return import_raster.run_import_raster(conn, job, steps)
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
                steps.rolled_back()
                print(f"job {job_id}: no longer running; its writes were rolled back", flush=True)
        except Exception as e:
            conn.rollback()
            steps.rolled_back()
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
            steps.rolled_back()
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


HANDLERS["import"] = run_import

if __name__ == "__main__":
    sys.exit(main())
