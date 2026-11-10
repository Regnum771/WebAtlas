"""
Live check for GeoNode's WebATLAS bridge: register a published time-series mosaic as a GeoNode
dataset for a Keycloak subject, list it back, and see that moderation hides it from the public.

Opt-in (needs the platform stack: GeoNode with webatlas_bridge, its GeoServer and the
webatlas_mosaic_index database). Runs in the atlas-tools image, which shares the Compose network:

    docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml \
      --profile tools run --rm -T -e GEONODE_E2E=1 tools \
      python3 packages/atlas-data/tools/timeseries/test_bridge_live.py

Clean-up: the dataset through GeoNode's API (DELETE /api/v2/resources/<pk>/delete, run by
Celery), the user the bridge created, the GeoServer store and index table (delete_mosaic, never
purge) and the check's own files, one by one by name.
"""
import os
import pathlib
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

if os.environ.get("GEONODE_E2E") != "1":
    print("skip: set GEONODE_E2E=1 to run the live GeoNode bridge check")
    sys.exit(0)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from timeseries import geoserver, geonode_bridge  # noqa: E402
from timeseries.live_fixtures import mosaic_files, remove_files, write_depth_series  # noqa: E402

import requests  # noqa: E402

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


GN = os.environ["GEONODE_BRIDGE_URL"].rstrip("/")
GS = os.environ["GEOSERVER_URL"].rstrip("/")
GN_ADMIN = ("admin", os.environ["GEONODE_ADMIN_PASSWORD"])
TIMEOUT = 120

hexid = uuid.uuid4().hex
name = f"s1-bridge-{hexid}"
folder = os.path.join(os.environ["TIMESERIES_DIR"], name)
owner = {"sub": str(uuid.uuid4()), "username": f"s1-e2e-{hexid[:10]}", "email": f"s1-e2e-{hexid[:10]}@example.invalid"}
alternate = f"geonode:{name}"
step_files = []
registered = None


def json_of(r):
    try:
        body = r.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def gn_datasets(auth=None):
    r = requests.get(f"{GN}/api/v2/datasets", params={"filter{alternate}": alternate}, auth=auth, timeout=TIMEOUT)
    return r.status_code, (r.json().get("datasets", []) if r.status_code == 200 else None)


def gn_delete(pk):
    """GeoNode's own delete (queued to Celery); waits for its execution request to finish."""
    r = requests.delete(f"{GN}/api/v2/resources/{pk}/delete", auth=GN_ADMIN, timeout=TIMEOUT)
    if r.status_code != 200:
        return f"delete -> {r.status_code}: {r.text[:200]}"
    exec_id = r.json()["execution_id"]
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        s = requests.get(f"{GN}/api/v2/resource-service/execution-status/{exec_id}", auth=GN_ADMIN,
                         timeout=TIMEOUT).json()
        if s.get("status") in ("finished", "failed"):
            return s.get("status")
        time.sleep(3)
    return "timeout"


try:
    try:
        step_times, step_files = write_depth_series(folder, name)
        check("mosaic published", geoserver.publish_mosaic(name, "depth") == alternate)

        url = f"{GN}/webatlas-bridge/datasets"
        body = {"name": name, "title": "x", "abstract": "", "owner": owner}
        r_none = requests.post(url, json=body, timeout=TIMEOUT)
        r_wrong = requests.post(url, json=body, headers={"Authorization": "Bearer not-the-token"}, timeout=TIMEOUT)
        r_list = requests.get(f"{GN}/webatlas-bridge/resources", headers={"Authorization": "Bearer nope"},
                              timeout=TIMEOUT)
        check("no token / wrong token -> 401 on both routes",
              (r_none.status_code, r_wrong.status_code, r_list.status_code) == (401, 401, 401))
        check("401 says why, in Vietnamese", "mã truy cập" in json_of(r_wrong).get("detail", ""))

        r = requests.post(url, json={**body, "name": "no/such"}, headers=geonode_bridge._headers(), timeout=TIMEOUT)
        check("invalid name -> 400", r.status_code == 400)
        try:
            geonode_bridge.register_dataset(f"s1-missing-{hexid}", "x", "", owner)
            missing = None
        except geonode_bridge.BridgeError as e:
            missing = e.status
        check("a coverage GeoServer does not have -> 404", missing == 404)

        before = datetime.now(timezone.utc)
        title, abstract = "Độ sâu ngập thử nghiệm", "Kiểm tra cầu nối"
        # Ask the bridge to fail its permissions step. Honoured only when django runs with
        # WEBATLAS_BRIDGE_TEST_HOOKS=1; otherwise the header is ignored and this is a plain 201.
        r = requests.post(url, json={"name": name, "title": title, "abstract": abstract, "owner": owner},
                          headers={**geonode_bridge._headers(), "X-Webatlas-Bridge-Fail": "permissions"},
                          timeout=600)
        if r.status_code == 201:
            registered = r.json()
            print("     test hooks off in django: forced-failure checks skipped "
                  "(WEBATLAS_BRIDGE_TEST_HOOKS=1 in infra/.env, recreate django, run again)")
        else:
            check("forced permissions failure -> 502", r.status_code == 502)
            detail = json_of(r).get("detail", "")
            check("502 detail is the fixed Vietnamese text, no exception text",
                  "hãy gửi lại" in detail and "test hook" not in detail and "Error" not in detail)
            status, admin = gn_datasets(GN_ADMIN)
            check("after the failure the dataset stays in GeoNode (not deleted)", status == 200 and len(admin) == 1)
            # GeoNode's API gives pk as a string.
            registered = {"pk": int(admin[0]["pk"])} if admin else {}  # for the clean-up below
            r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}/coverages/{name}.json",
                             auth=(os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"]),
                             timeout=TIMEOUT)
            check("after the failure the GeoServer store and coverage still exist", r.status_code == 200)
            check("after the failure the step files still exist",
                  all(os.path.isfile(os.path.join(folder, f)) for f in step_files))
            status, anon = gn_datasets()
            check("after the failure the dataset is private (anonymous API: 0)", status == 200 and anon == [])
            retried = geonode_bridge.register_dataset(name, title, abstract, owner)
            check("a retry finishes it: 200 with the same pk", retried.get("pk") == registered.get("pk"))
            registered = retried
        print(f"     registered in {(datetime.now(timezone.utc) - before).total_seconds():.0f} s: {registered}")
        check("register_dataset returns alternate geonode:<name>", registered.get("alternate") == alternate)
        check("register_dataset returns pk and uuid",
              isinstance(registered.get("pk"), int) and len(str(registered.get("uuid", ""))) == 36)
        check("registering again for the same owner returns the same dataset",
              geonode_bridge.register_dataset(name, title, abstract, owner) == registered)

        r = requests.get(f"{GN}/api/v2/resources/{registered.get('pk')}/permissions", auth=GN_ADMIN, timeout=TIMEOUT)
        spec = json_of(r)
        print(f"     permissions: {spec}")
        users = {u.get("username"): u.get("permissions") for u in spec.get("users", [])}
        # GeoNode always lists superusers (here `admin`) with "manage"; they bypass permissions anyway.
        superusers = {u.get("username") for u in spec.get("users", []) if u.get("is_superuser")}
        groups = {g.get("name"): g.get("permissions") for g in spec.get("groups", [])}
        check("permissions: the owner has them (permissions applied)",
              users.get(owner["username"]) not in (None, "none"))
        check("permissions: no other user has any (superusers aside)",
              all(p in (None, "none") for u, p in users.items() if u != owner["username"] and u not in superusers))
        check("permissions: no anonymous or registered-members access",
              all(groups.get(g) in (None, "none") for g in ("anonymous", "registered-members")))
        try:
            geonode_bridge.register_dataset(name, "x", "", {**owner, "sub": str(uuid.uuid4()),
                                                            "username": owner["username"] + "-b"})
            other = None
        except geonode_bridge.BridgeError as e:
            other = e.status
        check("registering it for another owner -> 409", other == 409)

        # "now - 1 min" taken when the registration started: it alone takes about a minute here.
        listed = list(geonode_bridge.list_resources(since=before - timedelta(minutes=1)))
        mine = [x for x in listed if x["pk"] == registered.get("pk")]
        item = mine[0] if mine else {}
        check("list_resources(since) contains it", len(mine) == 1)
        check("ownerSub is the Keycloak subject", item.get("ownerSub") == owner["sub"])
        check("isPublished false, isApproved false",
              item.get("isPublished") is False and item.get("isApproved") is False)
        check("resourceType dataset, subtype raster, alternate, title",
              (item.get("resourceType"), item.get("subtype"), item.get("alternate"), item.get("title"))
              == ("dataset", "raster", alternate, "Độ sâu ngập thử nghiệm"))
        bbox = item.get("bbox4326") or []
        check("bbox4326 is the series' extent (lon 111, lat 18)",
              len(bbox) == 4 and 110.9 < bbox[0] < bbox[2] < 111.1 and 18.0 < bbox[1] < bbox[3] < 18.2)
        check("lastUpdated is ISO 8601", bool(item.get("lastUpdated"))
              and datetime.fromisoformat(item["lastUpdated"]) >= before - timedelta(minutes=1))
        everything = list(geonode_bridge.list_resources(since=None))
        check("list_resources(None) lists every resource once, ordered by lastUpdated",
              registered.get("pk") in {x["pk"] for x in everything}
              and len({x["pk"] for x in everything}) == len(everything)
              and [x["lastUpdated"] for x in everything] == sorted(x["lastUpdated"] for x in everything))
        future = list(geonode_bridge.list_resources(since=datetime.now(timezone.utc) + timedelta(days=1)))
        check("list_resources(tomorrow) is empty", future == [])
        r = requests.get(f"{GN}/webatlas-bridge/resources", params={"since": "yesterday"},
                         headers=geonode_bridge._headers(), timeout=TIMEOUT)
        check("bad since -> 400", r.status_code == 400)

        status, anon = gn_datasets()
        check("anonymous GeoNode API: 0 results (moderation hides it)", status == 200 and anon == [])
        status, admin = gn_datasets(GN_ADMIN)
        ds = admin[0] if admin else {}
        check("admin GeoNode API: 1 result (the filter works)", status == 200 and len(admin or []) == 1)
        check("GeoNode records the time dimension (has_time, temporal extent = first..last step)",
              ds.get("has_time") is True
              and (ds.get("temporal_extent_start") or "").startswith(step_times[0].strftime("%Y-%m-%dT%H:%M"))
              and (ds.get("temporal_extent_end") or "").startswith(step_times[-1].strftime("%Y-%m-%dT%H:%M")))
        check("GeoNode owner is the bridge-created user", (ds.get("owner") or {}).get("username") == owner["username"])

        r = requests.get(f"{GS}/geonode/wms", params={
            "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": alternate, "styles": "",
            "srs": "EPSG:4326", "bbox": "110.9,18.0,111.1,18.2", "width": 32, "height": 32, "format": "image/png",
            "time": step_times[0].strftime("%Y-%m-%dT%H:%M:%SZ")}, timeout=TIMEOUT)
        check("anonymous WMS GetMap of the unpublished layer is refused",
              not (r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/png")))
        r = requests.get(f"{GS}/webatlas/wms", params={
            "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": "webatlas:dams", "styles": "",
            "srs": "EPSG:4326", "bbox": "102,8,110,24", "width": 64, "height": 128, "format": "image/png"},
            timeout=TIMEOUT)
        check("anonymous WMS GetMap of a webatlas basemap layer still answers 200 image/png",
              r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/png"))
    finally:
        if registered and registered.get("pk"):
            outcome = gn_delete(registered["pk"])
            check("GeoNode API delete finishes", outcome == "finished")
            status, admin = gn_datasets(GN_ADMIN)
            check("dataset gone from GeoNode", status == 200 and admin == [])
        geoserver.delete_mosaic(name)
        r = requests.get(f"{GS}/rest/workspaces/geonode/coveragestores/{name}.json",
                         auth=(os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"]),
                         timeout=TIMEOUT)
        check("GeoServer store gone", r.status_code == 404)
        for username in (owner["username"], owner["username"] + "-b"):
            r = requests.get(f"{GN}/api/v2/users", params={"filter{username}": username}, auth=GN_ADMIN,
                             timeout=TIMEOUT)
            for u in (r.json().get("users", []) if r.status_code == 200 else []):
                d = requests.delete(f"{GN}/api/v2/users/{u['pk']}", auth=GN_ADMIN, timeout=TIMEOUT)
                check(f"bridge-created user {username} deleted", d.status_code in (200, 204))
finally:
    remove_files({folder: step_files + mosaic_files(name)})

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
