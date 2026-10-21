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

import jobs_db

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


if __name__ == "__main__":
    sys.exit(main())
