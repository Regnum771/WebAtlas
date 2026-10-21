"""
Checks for worker.py and jobs_db.py: claim, steps, success, failure, stale recovery.

No pytest (see flood_scenario/test_depth.py). Runs inside the atlas-tools image against the dev
database (DATABASE_URL):

    python3 packages/atlas-data/tools/workspace/test_worker.py

The suite creates its own app.users row (deleting it cascades to its maps, layers and jobs) and
only ever claims its own jobs (only_ids), so a live worker or another suite's queue is untouched.
"""
import json
import pathlib
import sys
import uuid

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import jobs_db  # noqa: E402
import worker  # noqa: E402

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


STEPS = [
    {"key": "read", "label": "Đọc tệp", "status": "pending"},
    {"key": "transform", "label": "Chuyển hệ toạ độ", "status": "pending"},
    {"key": "write", "label": "Ghi vào bản đồ", "status": "pending"},
]
EMAIL = f"p3b-worker-{uuid.uuid4().hex[:8]}@webatlas.test"

conn = jobs_db.connect()
watch = jobs_db.connect(autocommit=True)  # an observer outside every transaction under test


def q(sql, args=()):
    with watch.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None


def new_job(age_seconds=0):
    return q(
        """INSERT INTO workspace.jobs (owner_id, map_id, kind, params, steps, created_at)
           VALUES (%s, %s, 'import', '{}', %s, now() - make_interval(secs => %s)) RETURNING id""",
        (user_id, map_id, json.dumps(STEPS), age_seconds),
    )[0][0]


def job_row(job_id):
    with watch.cursor() as cur:
        cur.execute(
            """SELECT status, error, result, steps, progress, started_at, finished_at, heartbeat_at
                 FROM workspace.jobs WHERE id = %s""",
            (job_id,),
        )
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, cur.fetchone()))


def step(row, key):
    return next(s for s in row["steps"] if s["key"] == key)


def layer_count(title):
    return q("SELECT count(*) FROM workspace.map_layers WHERE map_id = %s AND title = %s", (map_id, title))[0][0]


def insert_layer(c, title):
    with c.cursor() as cur:
        cur.execute(
            """INSERT INTO workspace.map_layers (map_id, kind, title, position)
               VALUES (%s, 'free', %s, (SELECT COALESCE(max(position), -1) + 1
                                          FROM workspace.map_layers WHERE map_id = %s))""",
            (map_id, title, map_id),
        )


user_id = q(
    "INSERT INTO app.users (email, password_hash, role) VALUES (%s, 'x', 'viewer') RETURNING id", (EMAIL,)
)[0][0]
original_import = worker.HANDLERS.get("import")
try:
    map_id = q("INSERT INTO workspace.maps (owner_id, title) VALUES (%s, 'P3b worker') RETURNING id", (user_id,))[0][0]

    # --- claim takes the oldest queued job once
    older, newer = new_job(age_seconds=20), new_job(age_seconds=10)
    other = jobs_db.connect()
    a = jobs_db.claim(conn, only_ids=[older, newer])
    b = jobs_db.claim(other, only_ids=[older, newer])
    c = jobs_db.claim(conn, only_ids=[older, newer])
    check("claim takes the oldest queued job first", a is not None and a["id"] == older)
    check("a second claimant gets the next job, not the same one", b is not None and b["id"] == newer)
    check("a job is claimed once", c is None)
    row = job_row(older)
    check("a claimed job is running with started_at and heartbeat_at",
          row["status"] == "running" and row["started_at"] is not None and row["heartbeat_at"] is not None)
    check("claim hands the handler kind, params and steps",
          a["kind"] == "import" and a["params"] == {} and [s["key"] for s in a["steps"]] == ["read", "transform", "write"])

    locked = new_job()
    with other.cursor() as cur:  # another worker is mid-claim on this row
        cur.execute("SELECT id FROM workspace.jobs WHERE id = %s FOR UPDATE", (locked,))
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = '5s'")
    conn.commit()
    check("claim skips a job another worker has locked, without waiting",
          jobs_db.claim(conn, only_ids=[locked]) is None)
    other.rollback()
    check("the job is claimable once the lock is gone", (jobs_db.claim(conn, only_ids=[locked]) or {}).get("id") == locked)
    other.close()

    # --- a succeeding handler commits its writes and records the result
    def succeeding(c, job, steps):
        steps.start("read")
        insert_layer(c, "ok-layer")
        steps.done("read", "Đã đọc 1 lớp.")
        return {"layerIds": ["x"]}

    worker.HANDLERS["import"] = succeeding
    job = new_job()
    ran = worker.run_once(conn, only_ids=[job])
    row = job_row(job)
    check("run_once reports that it ran a job", ran is True)
    check("a succeeding handler's writes are committed", layer_count("ok-layer") == 1)
    check("a succeeding job records its result",
          row["status"] == "succeeded" and row["result"] == {"layerIds": ["x"]} and row["error"] is None)
    check("a succeeding job is finished at 100%", row["finished_at"] is not None and row["progress"] == 100)
    check("a done step keeps its label and gets its message",
          step(row, "read") == {"key": "read", "label": "Đọc tệp", "status": "done", "message": "Đã đọc 1 lớp."})
    check("steps the handler never started stay pending", step(row, "write")["status"] == "pending")
    check("run_once with nothing queued returns False", worker.run_once(conn, only_ids=[job]) is False)

    # --- a failing handler rolls back its writes and records the user message
    def failing(c, job, steps):
        steps.start("read")
        steps.done("read")
        steps.start("transform")
        insert_layer(c, "failed-layer")
        raise worker.UserFacingError("X")

    worker.HANDLERS["import"] = failing
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    row = job_row(job)
    check("a failing handler's writes are rolled back", layer_count("failed-layer") == 0)
    check("a failing job records the user message", row["status"] == "failed" and row["error"] == "X")
    check("the running step is failed with the message",
          step(row, "transform") == {"key": "transform", "label": "Chuyển hệ toạ độ", "status": "failed", "message": "X"})
    check("finished steps stay done", step(row, "read")["status"] == "done")
    check("a failed job is finished", row["finished_at"] is not None and row["result"] is None)

    def crashing(c, job, steps):
        steps.start("read")
        raise ValueError("internal detail")

    worker.HANDLERS["import"] = crashing
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    row = job_row(job)
    check("an unexpected error shows the generic message, not the internal one",
          row["status"] == "failed" and row["error"] == "Lỗi không mong đợi khi xử lý tệp."
          and step(row, "read")["message"] == "Lỗi không mong đợi khi xử lý tệp.")
    check("the connection is usable after a failed job", q("SELECT 1")[0][0] == 1 and conn.closed == 0)

    # --- a stale running job is failed and its partial writes are rolled back
    stale, fresh = new_job(), new_job()
    dying = jobs_db.connect()
    dead_job = jobs_db.claim(dying, only_ids=[stale])
    jobs_db.set_step(dying, stale, "read", "running", progress=10)
    insert_layer(dying, "stale-layer")  # the handler's open transaction ...
    dying.close()                       # ... dies with the worker
    jobs_db.claim(conn, only_ids=[fresh])
    before = job_row(fresh)["heartbeat_at"]
    jobs_db.heartbeat(conn, fresh)
    check("heartbeat moves heartbeat_at forward", job_row(fresh)["heartbeat_at"] > before)
    q("UPDATE workspace.jobs SET heartbeat_at = now() - interval '11 minutes' WHERE id = %s", (stale,))
    n = jobs_db.fail_stale(conn, 600, only_ids=[stale, fresh])
    row = job_row(stale)
    check("fail_stale fails exactly the stale job", n == 1 and job_row(fresh)["status"] == "running")
    check("a stale job gets the exact copy",
          row["status"] == "failed" and row["error"] == "Máy xử lý đã dừng giữa chừng; hãy chạy lại."
          and row["finished_at"] is not None)
    check("the stale job's running step is failed with the same copy",
          step(row, "read") == {"key": "read", "label": "Đọc tệp", "status": "failed",
                                "message": "Máy xử lý đã dừng giữa chừng; hãy chạy lại."})
    check("a dead worker's partial writes are not left in the map", layer_count("stale-layer") == 0)
    check("fail_stale is a no-op the second time", jobs_db.fail_stale(conn, 600, only_ids=[stale, fresh]) == 0)
    check("a job failed as stale cannot be succeeded afterwards",
          jobs_db.succeed(conn, stale, {}) is False and job_row(stale)["status"] == "failed")
    conn.rollback()

    # --- steps and progress are visible while running
    seen = {}

    def watching(c, job, steps):
        steps.start("read")
        steps.progress(40)
        insert_layer(c, "watch-layer")
        mid = job_row(job["id"])
        seen.update(status=mid["status"], read=step(mid, "read")["status"], progress=mid["progress"],
                    layer_visible=layer_count("watch-layer"))
        steps.done("read")
        return {}

    worker.HANDLERS["import"] = watching
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    check("steps and progress are visible while running",
          seen.get("status") == "running" and seen.get("read") == "running" and seen.get("progress") == 40)
    check("the handler's writes stay invisible until the job succeeds",
          seen.get("layer_visible") == 0 and layer_count("watch-layer") == 1)

    def unknown_step(c, job, steps):
        steps.start("nope")
        return {}

    worker.HANDLERS["import"] = unknown_step
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    check("an unknown step key fails the job instead of being ignored", job_row(job)["status"] == "failed")

    # --- on_rollback undoes work outside the database only when the transaction is rolled back
    undone = []

    def undo_then(fail):
        def handler(c, job, steps):
            steps.start("read")
            steps.on_rollback(lambda: undone.append("first"))
            steps.on_rollback(lambda: undone.append("second"))
            if fail:
                raise worker.UserFacingError("Z")
            steps.done("read")
            return {}
        return handler

    worker.HANDLERS["import"] = undo_then(False)
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    check("on_rollback callbacks do not run when the job commits",
          job_row(job)["status"] == "succeeded" and undone == [])
    worker.HANDLERS["import"] = undo_then(True)
    job = new_job()
    worker.run_once(conn, only_ids=[job])
    check("on_rollback callbacks run, newest first, when the job fails",
          job_row(job)["status"] == "failed" and undone == ["second", "first"])

    err = worker.UserFacingError("Y")
    check("UserFacingError carries user_message", err.user_message == "Y" and str(err) == "Y")
finally:
    if original_import is None:
        worker.HANDLERS.pop("import", None)
    else:
        worker.HANDLERS["import"] = original_import
    conn.rollback()
    q("DELETE FROM app.users WHERE id = %s", (user_id,))
    conn.close()
    watch.close()

if failures:
    print(f"{len(failures)} failed")
    sys.exit(1)
print("all ok")
