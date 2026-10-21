"""
psycopg2 helpers for workspace.jobs, the queue the API fills (apps/api/src/modules/workspace/jobs.ts)
and worker.py drains.

A job's `steps` is the API's array of { key, label, status, message? }, created all `pending`.
These helpers change an entry's status and message in place, by key, and never touch its label.

Transactions: every helper here commits its own write (on a non-autocommit connection), except
`succeed`, which joins the caller's open transaction so that a handler's writes and the job's
success commit together or not at all.
"""
import os

import psycopg2
import psycopg2.extras

STALE_MESSAGE = "Máy xử lý đã dừng giữa chừng; hãy chạy lại."
STEP_STATUSES = ("pending", "running", "done", "failed")

# The job's steps with every `running` entry turned `failed` with %(message)s.
_FAIL_RUNNING_STEPS = """
    COALESCE((SELECT jsonb_agg(CASE WHEN s->>'status' = 'running'
                                    THEN s || jsonb_build_object('status', 'failed', 'message', %(message)s::text)
                                    ELSE s END ORDER BY o)
                FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(s, o)), '[]'::jsonb)
"""


def connect(autocommit=False):
    """A connection to DATABASE_URL (in-network `db:5432` inside Compose)."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    conn = psycopg2.connect(url, application_name="webatlas-worker")
    conn.autocommit = autocommit
    return conn


def _commit(conn):
    if not conn.autocommit:
        conn.commit()


def _ids_filter(only_ids, column="id"):
    """An extra WHERE clause limiting a statement to the given job ids (tests claim only their own)."""
    if only_ids is None:
        return "", {}
    return f" AND {column} = ANY(%(only_ids)s::uuid[])", {"only_ids": [str(i) for i in only_ids]}


def claim(conn, only_ids=None):
    """
    Take the oldest queued job and mark it running, or return None when there is none.
    SKIP LOCKED lets several workers claim at once without waiting on, or sharing, a row.
    Commits, so the job shows as running before its handler starts.
    """
    extra, args = _ids_filter(only_ids)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            f"""
            WITH next AS (
              SELECT id FROM workspace.jobs
               WHERE status = 'queued'{extra}
               ORDER BY created_at, id
               FOR UPDATE SKIP LOCKED
               LIMIT 1
            )
            UPDATE workspace.jobs j
               SET status = 'running', started_at = now(), heartbeat_at = now()
              FROM next
             WHERE j.id = next.id
            RETURNING j.id, j.owner_id, j.map_id, j.kind, j.status, j.params, j.steps, j.progress,
                      j.created_at, j.started_at
            """,
            args,
        )
        row = cur.fetchone()
    _commit(conn)
    return dict(row) if row else None


def heartbeat(conn, job_id):
    """Record that the worker running this job is still alive."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE workspace.jobs SET heartbeat_at = now() WHERE id = %s AND status = 'running'",
            (str(job_id),),
        )
    _commit(conn)


def clamp_progress(pct):
    return max(0, min(100, int(pct)))


def set_step(conn, job_id, key, status, message=None, progress=None):
    """
    Set one step's status (and message, when given) by key; optionally the job's progress too.
    Also counts as a heartbeat. Only a running job is changed.
    """
    if status not in STEP_STATUSES:
        raise ValueError(f"unknown step status: {status}")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE workspace.jobs
               SET steps = COALESCE((
                     SELECT jsonb_agg(CASE WHEN s->>'key' = %(key)s
                                           THEN s || jsonb_strip_nulls(jsonb_build_object(
                                                       'status', %(status)s::text, 'message', %(message)s::text))
                                           ELSE s END ORDER BY o)
                       FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(s, o)), '[]'::jsonb),
                   progress = COALESCE(%(progress)s::integer, progress),
                   heartbeat_at = now()
             WHERE id = %(id)s AND status = 'running'
            """,
            {
                "id": str(job_id),
                "key": key,
                "status": status,
                "message": message,
                "progress": None if progress is None else clamp_progress(progress),
            },
        )
    _commit(conn)


def set_progress(conn, job_id, pct):
    """Set the job's overall progress (0-100); also counts as a heartbeat."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE workspace.jobs SET progress = %s, heartbeat_at = now() WHERE id = %s AND status = 'running'",
            (clamp_progress(pct), str(job_id)),
        )
    _commit(conn)


def succeed(conn, job_id, result):
    """
    Mark a running job succeeded with its result, inside the caller's transaction (no commit).
    Returns False when the job is no longer running (failed as stale meanwhile): the caller must
    then roll back, so a job never shows failed while its writes are in the map.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE workspace.jobs
               SET status = 'succeeded', result = %s, progress = 100,
                   finished_at = now(), heartbeat_at = now()
             WHERE id = %s AND status = 'running'
            """,
            (psycopg2.extras.Json(result), str(job_id)),
        )
        return cur.rowcount == 1


def fail(conn, job_id, message):
    """Mark a running job failed: its running step becomes failed with the message, and so does the job."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE workspace.jobs
               SET steps = {_FAIL_RUNNING_STEPS},
                   status = 'failed', error = %(message)s, finished_at = now()
             WHERE id = %(id)s AND status = 'running'
            """,
            {"id": str(job_id), "message": message},
        )
    _commit(conn)


def fail_stale(conn, older_than_seconds=600, message=STALE_MESSAGE, only_ids=None):
    """
    Fail every running job whose heartbeat is older than the threshold (its worker died; the
    database already rolled back that worker's open transaction). Returns how many were failed.
    """
    extra, args = _ids_filter(only_ids)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE workspace.jobs
               SET steps = {_FAIL_RUNNING_STEPS},
                   status = 'failed', error = %(message)s, finished_at = now()
             WHERE status = 'running'
               AND COALESCE(heartbeat_at, started_at, created_at) < now() - make_interval(secs => %(secs)s){extra}
            """,
            {"message": message, "secs": older_than_seconds, **args},
        )
        n = cur.rowcount
    _commit(conn)
    return n
