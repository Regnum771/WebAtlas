"""
Client for GeoNode's WebATLAS bridge (infra/platform/geonode/webatlas_bridge): register a coverage
the worker published in workspace `geonode` as a GeoNode dataset, and list GeoNode's resources.

Environment (worker and tools services, infra/docker-compose.yml):
  GEONODE_BRIDGE_URL     GeoNode's Django inside the Compose network (http://django:8000)
  WEBATLAS_BRIDGE_TOKEN  the shared bearer token (infra/.env)
"""
import os
from datetime import timezone

import requests

# Registration syncs GeoNode with GeoServer and sets GeoFence rules: about a minute on the 8 GB PC.
_REGISTER_TIMEOUT = 600
_LIST_TIMEOUT = 120


class BridgeError(RuntimeError):
    def __init__(self, status, detail):
        super().__init__(f"GeoNode bridge -> {status}: {detail}")
        self.status = status
        self.detail = detail


def _url(path):
    return os.environ["GEONODE_BRIDGE_URL"].rstrip("/") + path


def _headers():
    return {"Authorization": f"Bearer {os.environ['WEBATLAS_BRIDGE_TOKEN']}"}


def _raise_for(r, ok):
    if r.status_code in ok:
        return
    try:
        detail = r.json().get("detail", r.text[:500])
    except ValueError:
        detail = r.text[:500]
    raise BridgeError(r.status_code, detail)


def register_dataset(name, title, abstract, owner):
    """
    Register coverage geonode:<name> as a dataset owned by `owner` = {sub, username, email} (the
    Keycloak subject; GeoNode creates the user when it has never signed in). Unpublished and
    unapproved until a reviewer publishes it. Returns {pk, uuid, alternate}; registering the same
    name again for the same owner returns the same ids.
    """
    r = requests.post(_url("/webatlas-bridge/datasets"), headers=_headers(), timeout=_REGISTER_TIMEOUT,
                      json={"name": name, "title": title, "abstract": abstract,
                            "owner": {k: owner.get(k) for k in ("sub", "username", "email")}})
    _raise_for(r, (200, 201))
    return r.json()


def list_resources(since=None):
    """Every GeoNode resource changed at or after `since` (all of them when None), following pages."""
    params = {}
    if since is not None:
        if since.tzinfo is None:
            raise ValueError("since must be timezone-aware")
        params["since"] = since.astimezone(timezone.utc).isoformat()
    page = 1
    while page is not None:
        r = requests.get(_url("/webatlas-bridge/resources"), headers=_headers(), timeout=_LIST_TIMEOUT,
                         params={**params, "page": page})
        _raise_for(r, (200,))
        body = r.json()
        yield from body["resources"]
        page = body["next"]
