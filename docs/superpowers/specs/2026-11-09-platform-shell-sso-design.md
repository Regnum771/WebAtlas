# Platform shell, single sign-on and service connectivity

Status: in progress, 2026-11-09. Companion to `2026-11-09-geonode-data-platform-plan.md`.

## Decisions (user, 2026-11-09)

| # | Decision |
|---|---|
| S1 | **A landing hub becomes the front door at `/`; the interactive map moves to `/ban-do`.** This replaces the 2026-10-06 "the map is the front door" decision. |
| S2 | **Stand the services up for real**: GeoNode 5 and the orchestrator run in Compose, wired to the nav. |
| S3 | **Dagster** is the orchestration engine (plan decision D1). |
| S4 | **Single sign-on now** (replaces plan decision D2's "separate logins"). |
| S5 | **Lean stack on this PC** (8 GB RAM): one GeoServer (GeoNode's replaces ours now), GeoNode shares our PostGIS, Java heaps capped. |
| S6 | **Keycloak** owns sign-in for WebAtlas, GeoNode and Dagster. |

## Addresses (development)

Ports on `localhost`, not `*.localhost` subdomains: Windows' own resolver does not resolve subdomains of `localhost`, and the API runs on the host.

| Service | Browser URL | In-network URL |
|---|---|---|
| WebAtlas web | `http://localhost:5173` | — |
| WebAtlas API | `http://localhost:3001` | — |
| Keycloak (realm `webatlas`) | `http://localhost:8180` | `http://keycloak:8080` |
| GeoNode | `http://localhost:8000` | `http://django:8000` |
| GeoServer (GeoNode's, the only one) | `http://localhost:8000/geoserver/` and `:8080` | `http://geoserver:8080/geoserver` |
| Dagster (behind oauth2-proxy) | `http://localhost:3070` | `http://dagster-webserver:3000` |

Keycloak runs with `KC_HOSTNAME=http://localhost:8180` and a dynamic back channel, so the issuer is the browser URL everywhere while containers reach the token, user-info and key endpoints through `keycloak:8080`.

## Single sign-on

- **Accounts and passwords live in Keycloak.** WebAtlas keeps its users table for roles, access groups and jurisdiction (P1); GeoNode keeps its own view/download permissions.
- **WebAtlas** is a confidential OIDC client and the API does the code flow (PKCE + state + nonce in a short-lived signed cookie). On callback the API verifies the ID token, finds the user by `oidc_subject`, else links an existing user by email, else creates a `viewer`, and issues the usual WebAtlas token. The web app receives it in the URL fragment at `/dang-nhap/xong`.
- **Local password login stays** for tests, CI and as an admin break-glass when Keycloak is down. With SSO configured, the sign-in dialog leads with SSO and keeps "Tài khoản cục bộ" as a secondary path.
- **Sign-out** clears the WebAtlas token and ends the Keycloak session (RP-initiated logout). GeoNode and Dagster keep their own cookies until they expire; back-channel single logout is later work.
- **GeoNode** uses its generic `geonode_openid_connect` provider against Keycloak. **Dagster** has no authentication of its own, so oauth2-proxy sits in front of it.

## Pages and nav

| Route | Content |
|---|---|
| `/` | Hub: tiles for Bản đồ tương tác, Danh mục bản đồ (GeoNode/MapStore), Điều phối dữ liệu (Dagster, admins), Dữ liệu, Quản lý (permitted users), Hồ sơ (signed in). External tiles show live status. |
| `/ban-do` | The interactive map (still mounted under every route, as before). |
| `/ho-so` | Profile: account, sign-in method, access groups and jurisdiction, links to the Keycloak account console and to GeoNode. |
| `/dang-nhap/xong` | SSO callback landing. |

Top bar nav: Bản đồ · Danh mục ↗ · Điều phối ↗ (admins) · Dữ liệu · Quản lý. External areas open in a new tab, so the map's state survives. GeoNode's top bar gets links back to WebATLAS (admin menu placeholders).

## Service connectivity

`GET /api/platform/services` lists each external service with its public URL and a cached health probe (`up`, `down` or `unconfigured`). Probes: Keycloak discovery document, GeoNode `/api/v2/`, Dagster `/server_info` (the one path oauth2-proxy lets through unauthenticated). The hub and nav read this, so URLs come from API configuration, not the web build.

## Dagster (first pass)

A code location reads the registry's records in PostGIS (`app.dataset_lineage`, `app.dataset_stage_state`) and shows each dataset as an observable asset with its stage states. Running builds from Dagster, schedules and new pipelines are the next pass.

## Build order

1. Web: hub, `/ban-do`, nav, profile.
2. API: platform services endpoint.
3. Keycloak + WebAtlas SSO (migration: `oidc_subject`, nullable `password_hash`).
4. GeoNode + its GeoServer replacing ours, republish the layers, GeoNode SSO and back-links.
5. Dagster + oauth2-proxy + code location.
6. Browser check end to end, with screenshots.
