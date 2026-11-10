# Platform stack (GeoNode, Keycloak, Dagster)

The data platform beside WebATLAS, in `infra/docker-compose.platform.yml`. Design:
`docs/superpowers/specs/2026-11-09-platform-shell-sso-design.md`.

| Service | Address | What it is |
|---|---|---|
| Keycloak | http://localhost:8180 (realm `webatlas`) | Single sign-on for WebATLAS, GeoNode and Dagster |
| GeoNode | http://localhost:8000 | Catalogue, metadata, CSW, MapStore maps and dashboards |
| GeoServer | http://localhost:8080/geoserver (also `:8000/geoserver`) | GeoNode's; **replaces** the standalone one |
| Dagster | http://localhost:3070 | Orchestration, behind oauth2-proxy (realm role `dieu-phoi`) |

The stack is sized for an 8 GB machine: GeoNode shares the `db` PostGIS, every Java heap is capped
and GeoNode runs two web workers. Give Docker about 5.5 GB (`%UserProfile%\.wslconfig`,
`memory=5632MB`, then `wsl --shutdown` and start Docker Desktop again).

## First start

1. Secrets. Add these to `infra/.env` (any random values; see `infra/.env.example`):
   `KC_ADMIN_PASSWORD KC_WEBATLAS_API_SECRET KC_GEONODE_SECRET KC_DAGSTER_SECRET KC_DEV_USERNAME
   KC_DEV_EMAIL KC_DEV_PASSWORD GEONODE_DB_PASSWORD GEONODE_DATA_DB_PASSWORD GEONODE_SECRET_KEY
   GEONODE_ADMIN_PASSWORD ORCHESTRATOR_DB_PASSWORD MOSAIC_INDEX_DB_PASSWORD WEBATLAS_BRIDGE_TOKEN
   OAUTH2_PROXY_COOKIE_SECRET` (the last exactly 32 characters). `KC_DEV_EMAIL` should be the email of an existing WebATLAS admin: the first SSO
   sign-in links the two by that verified email.
2. Databases and roles in the shared PostGIS (idempotent):
   ```sh
   docker exec -i webatlas-db-1 psql -U webatlas -d webatlas \
     -v geonode_pw=$GEONODE_DB_PASSWORD -v geonode_data_pw=$GEONODE_DATA_DB_PASSWORD \
     -v orchestrator_pw=$ORCHESTRATOR_DB_PASSWORD -v mosaic_pw=$MOSAIC_INDEX_DB_PASSWORD \
     -f - < infra/platform/postgis/platform-databases.sql
   ```
3. Start everything (GeoNode's first start migrates and collects statics: allow 10–20 minutes):
   ```sh
   docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml up -d
   ```
   `geonode-init` runs once after GeoNode is healthy: it registers Keycloak as GeoNode's sign-in
   app and adds the WebATLAS links to GeoNode's top bar. Re-run it with
   `docker compose ... run --rm --no-deps geonode-init`.
4. Let the public read the WebATLAS layers on GeoNode's GeoServer (GeoFence denies by default):
   `GEOSERVER_ADMIN_PASSWORD=... bash infra/platform/geoserver/webatlas-access.sh`
5. Publish the datasets into that GeoServer, without reloading any data: `npm run atlas:publish`.
6. API: copy the `OIDC_*`, `WEB_ORIGIN` and `PLATFORM_*` lines from `apps/api/.env.example` into
   `apps/api/.env`, with `OIDC_CLIENT_SECRET` = `KC_WEBATLAS_API_SECRET`. Restart the API.

Back to the standalone GeoServer: start without the platform file
(`docker compose -p webatlas -f infra/docker-compose.yml up -d geoserver`), then `npm run atlas:publish`.

## Time series (ImageMosaic)

Catalogue time series (rain grids, HEC-RAS depth) are ImageMosaics with a time dimension in
workspace **`geonode`** (never `webatlas`, whose GeoFence rule is public). The worker writes
`/repo/var/timeseries/<name>/` (repo `var/timeseries/`, git-ignored; create it before the first
start); GeoServer reads the same folder through the bind mount
`../var/timeseries:/webatlas-timeseries`. The granule index is one PostGIS table per mosaic in
its own database `webatlas_mosaic_index`, as role `webatlas_mosaic`. That database belongs to the
cluster superuser; the role can connect and create tables in `public`, owns no database and has no
CREATEDB. After changing the mount, recreate only GeoServer:
`docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml up -d geoserver`.

From the `tools` or `worker` container (`packages/atlas-data/tools` on `sys.path`):

```python
from timeseries import geoserver
geoserver.publish_mosaic("lu_2025", "depth")   # -> "geonode:lu_2025"; idempotent; styles too
# The peak raster goes in a sibling folder, never inside a mosaic's folder.
geoserver.publish_coverage("lu_2025_peak", "/webatlas-timeseries/lu_2025_peak/lu_2025_peak.tif", "depth")
geoserver.delete_mosaic("lu_2025")             # removes store + layer, drops the index table;
                                               # the step files stay in var/timeseries/lu_2025
```

- **Never delete a time-series store with `purge`** (REST `?purge=metadata|all`): GeoTools'
  ImageMosaic then deletes the granule files and runs the PostGIS factory's `dropDatabase`, i.e.
  `DROP DATABASE` on the whole index database. That is why the index has its own database and a
  role that owns none (the drop fails with "must be owner"); in `geonode_data`, which its role
  owns, the drop failed only because other sessions were connected. GeoNode itself skips purge
  for ImageMosaic stores. `delete_mosaic` deletes without purge and drops the one index table.
- GeoServer's URL checks refuse every `file://` URL by default ("Failed to locate the input file");
  publishing adds the URL check `webatlas-timeseries`, which allows only a mosaic directory
  `file:///webatlas-timeseries/<name>` and the `.tif` files in it, never `datastore.properties`
  (it holds the index password).
- The time dimension uses backward-only nearest match: a TIME between steps shows the step before,
  and one before the first step gives an empty image instead of an `InvalidDimensionValue` error.

GeoFence denies the new layer to everyone but the admin until GeoNode grants it. Live check:
`docker compose ... --profile tools run --rm -T -e GEONODE_E2E=1 tools python3 packages/atlas-data/tools/timeseries/test_geoserver_live.py`.

## Đăng ký dữ liệu từ mã

The WebATLAS worker registers a coverage it published (above) as a GeoNode dataset through the
bridge app `platform/geonode/webatlas_bridge`, mounted into `django`, `celery` and `geonode-init`
at `/usr/src/webatlas/webatlas_bridge` (`ROOT_URLCONF = 'webatlas_bridge.urls'` adds its two routes
in front of all of GeoNode's). Both routes want `Authorization: Bearer $WEBATLAS_BRIDGE_TOKEN`
(`infra/.env`, shared with `worker` and `tools`), else 401.

- `POST /webatlas-bridge/datasets` `{name, title, abstract, owner: {sub, username, email}}` →
  `201 {pk, uuid, alternate}` (200 with the same ids when that owner registered it already; 404
  when GeoServer has no coverage `geonode:<name>`; 409 when another owner has it; 502 with a fixed
  message when GeoNode fails half-way, details in GeoNode's log). The owner is the
  GeoNode user whose allauth `SocialAccount` has `provider = 'geonode_openid_connect'`
  (`settings.SOCIALACCOUNT_OIDC_PROVIDER`) and `uid` = the Keycloak `sub`; when missing, the bridge
  creates both (a free variant of `username`, unusable password), so the user's first Keycloak
  sign-in lands on that account.
  **The bridge never deletes a dataset**: deleting one cascades into GeoServer (see below). When a
  registration fails after the dataset row exists, the row stays, private (no permissions, GeoFence
  denies by default), and sending the same request again finishes it (GeoServer sync if needed,
  time dimension, permissions) and answers 200. The bridge knows an unfinished registration by its
  own marker, an `ExtraMetadata` row `{"webatlas_bridge": "registration-pending"}` on the dataset
  (not linked into the dataset's metadata list, so GeoNode's pages do not show it), written with the
  row and deleted on success. Not by permissions: GeoNode's `resourcebase_post_save` already gives
  the owner view and change rights before the moderation permissions are set. A completed
  registration is never touched again (re-applying the default permissions would unpublish a
  dataset a reviewer published); a lost marker errs the same, safe way.
- `GET /webatlas-bridge/resources?since=<ISO>&page=<n>` → `{resources: [...], next}`: every
  resource (published or not), 200 per page, ordered by `last_updated`. Each item:
  `{pk, uuid, alternate, resourceType, subtype, title, abstract, ownerSub, isPublished, isApproved,
  state, bbox4326, lastUpdated}`; `state` is GeoNode's processing state (`PROCESSED`, `RUNNING`,
  `INVALID`, ...), and only `PROCESSED` is a complete resource (the catalogue sync skips the rest).

From the worker or `tools`: `from timeseries import geonode_bridge`;
`geonode_bridge.register_dataset(name, title, abstract, owner)`,
`geonode_bridge.list_resources(since)` (follows pages).

Moderation is on (`RESOURCE_PUBLISHING`, `ADMIN_MODERATE_UPLOADS`: GeoNode's advanced workflow).
A new dataset is unpublished and unapproved; the anonymous API and GeoFence hide it until a group
manager or admin publishes it. The `webatlas` basemap layers are not GeoNode resources and keep
their public GeoFence rule.

Step 1 spike (2026-11-10, GeoNode 5.0.3, on a 3-step Task 4 mosaic):

- `gs_slurp(owner=…, workspace='geonode', store=name, filter=name)` registers the coverage, but
  took 299 s: it builds a thumbnail over OpenStreetMap tiles, and the containers resolve no
  outside names, so every tile is retried. The dataset came out with `subtype = 'vector_time'` and
  `has_time = False` (and published: moderation was still off).
- `resource_manager.create(uuid, resource_type=Dataset, defaults={name, workspace, store,
  subtype: 'raster', alternate, title, abstract, owner, ...})` works: about 60 s (GeoServer sync,
  CSW record, GWC style filters), no thumbnail. But on any error it deletes the dataset, which
  cascades into GeoServer, so the bridge runs the same steps itself (insert the row,
  `sync_instance_with_geoserver`, `save`, `resourcebase_post_save`) without that clean-up. Then
  `set_default_permissions(owner, created=True)` applies the moderation workflow and the GeoFence
  rules (about 15 s). It never raises: on error GeoNode rolls back, sets the state `INVALID` and
  returns False, so the bridge checks the return value, the state `PROCESSED` and the owner's view
  permission afterwards. GeoNode's own API hides an `INVALID` (dirty) resource even from admins;
  the bridge listing shows it. Its own
  sync steps mark the dataset `INVALID` on any error (GeoNode's sync sets `PROCESSED` half-way), so
  a retry runs the whole sync again whenever the state is not `PROCESSED`.
- **Time dimension.** GeoNode 5 keeps no time values for a raster: the dimension stays in
  GeoServer (the coverage's `time` metadata set by `publish_mosaic`). The dataset only has the flag
  `has_time`, plus the metadata fields `temporal_extent_start/_end`. The bridge sets `has_time` from
  the coverage's time metadata and the extent from the first and last time GeoServer lists. Never
  use GeoNode's `PUT /api/v2/datasets/<pk>/timeseries`: it rewrites GeoServer's dimension from a
  vector attribute and would drop the nearest-match settings.
- **`subtype` drift.** GeoNode's GeoServer sync (`sync_instance_with_geoserver`, on create and on
  every metadata update) labels any time-enabled resource `vector_time`, coverages included. The
  bridge resets it to `raster` after registering. A later metadata edit in GeoNode turns it back
  to `vector_time`.
- Deleting a dataset through GeoNode's API (`DELETE /api/v2/resources/<pk>/delete`) runs in
  Celery (`cascading_delete`): it removes the GeoServer layer and store, without purge for an
  ImageMosaic store (then `geoserver.delete_mosaic(name)` drops the index table), but **with
  `purge=all` for a single GeoTIFF store, which deletes the `.tif`**. It also deletes the layer's
  default style when no other layer uses it (`webatlas_depth`/`webatlas_rain`): `publish_mosaic`
  and `publish_coverage` create them again.
- The image ships `/usr/src/geonode/celery-cmd` without the execute bit, so `celery` was in a
  restart loop ("Permission denied") and no queued task ever ran. Compose now starts it with
  `bash /usr/src/geonode/celery-cmd`.

Live check (needs `GEONODE_ADMIN_PASSWORD` in `infra/.env` for the clean-up through GeoNode's API):
`docker compose ... --profile tools run --rm -T -e GEONODE_E2E=1 tools python3 packages/atlas-data/tools/timeseries/test_bridge_live.py`.
Its forced-failure part (the permissions step takes GeoNode's failure branch: state `INVALID`, no
permissions, False returned; the GeoServer store and files must survive,
a retry must finish the registration) needs the test hook in `django`, off by default: recreate it
with `WEBATLAS_BRIDGE_TEST_HOOKS=1 docker compose ... up -d --no-deps django`, run the check, then
recreate it again without the variable. With the hook off the check says it skipped that part.

## Known limits (first pass)

- Signing out of WebATLAS ends the Keycloak session; GeoNode and Dagster keep their own session
  cookies until they expire (no back-channel logout yet).
- Keycloak runs `start-dev` with its own H2 file database; the realm file is imported only when
  the realm does not exist yet (delete the `keycloak_data` volume to re-import).
- GeoNode's OIDC adapter does not check the ID token's signature; it relies on receiving the
  token straight from Keycloak's token endpoint over the internal network.
- The GeoNode entrypoint prints its environment, secrets included, into
  `/usr/src/geonode/invoke.log` inside the container.
- After `wsl --shutdown`, a published port can stop forwarding (seen on 5432): restart that container.
