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
   GEONODE_ADMIN_PASSWORD ORCHESTRATOR_DB_PASSWORD OAUTH2_PROXY_COOKIE_SECRET` (the last exactly 32
   characters). `KC_DEV_EMAIL` should be the email of an existing WebATLAS admin: the first SSO
   sign-in links the two by that verified email.
2. Databases and roles in the shared PostGIS (idempotent):
   ```sh
   docker exec -i webatlas-db-1 psql -U webatlas -d webatlas \
     -v geonode_pw=$GEONODE_DB_PASSWORD -v geonode_data_pw=$GEONODE_DATA_DB_PASSWORD \
     -v orchestrator_pw=$ORCHESTRATOR_DB_PASSWORD -f - < infra/platform/postgis/platform-databases.sql
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
