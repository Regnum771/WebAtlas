# GeoNode data platform — first-pass plan

Status: draft for review, 2026-11-09. Built from the 2026-11-08 discussion; nothing here is implemented.

## 1. Decisions already made (user, 2026-11-08)

| # | Decision |
|---|---|
| G1 | The next phase adds a **data platform** to WebAtlas: GeoNode (with MapStore), **orchestration** and **governance**. |
| G2 | Long-term target is the **hybrid**: GeoNode is the platform; WebAtlas keeps per-feature jurisdiction, drafts, review, version history and rollback for the official layers. |
| G3 | **First pass:** use GeoNode's own model as it comes and put the effort into orchestration. |
| G4 | **Editing stays in the WebAtlas interactive map.** Official layers are read-only in GeoNode. |
| G5 | "Orchestration" = scheduled data pipelines: definitions, schedules, run history, logs, outputs. |
| G6 | **Single source of truth:** existing data is *registered* in GeoNode, not imported. Tables stay in PostGIS; **GeoNode's GeoServer becomes the only GeoServer**. |
| G7 | The **basemap is the pilot**, then every other dataset follows the same rule. |

Guardrails that keep the first pass cheap to turn into the hybrid (agreed 2026-11-08):
1. Official layers stay read-only in GeoNode; nobody gets GeoNode's "edit data" on them.
2. One national dataset per layer — never split by jurisdiction.
3. Pipelines publish through WebAtlas versioning (load a version → activate → refresh GeoNode), never by uploading files into GeoNode.

## 2. What the first pass builds

```
                 ┌──────────────── GeoNode 5.0.x ────────────────┐
 browser ──────▶ │ landing · catalogue · dataset pages · ISO     │
                 │ metadata · CSW (pycsw) · MapStore maps,       │
                 │ dashboards, GeoStory · accounts (first pass)  │
                 │ Django + Celery + Redis + nginx               │
                 │        │                                      │
                 │        ▼                                      │
                 │ GeoServer 2.27.3 (GeoNode's, GeoFence + OAuth)│◀── WMS/WMTS/WFS ── WebAtlas map
                 └────────┬──────────────────────────────────────┘
                          │ PostGIS datastore (read-only role)
                          ▼
   PostgreSQL ── webatlas DB (water.*, basemap.*, workspace.*, …)  ◀── WebAtlas API (edit, drafts, tiles)
             └── geonode DB (GeoNode's own catalogue tables)
                          ▲
   Orchestrator ──────────┘ runs atlas-data stages → new version → activate → GWC refresh → GeoNode refresh
```

What changes and what doesn't:

| Piece | First pass |
|---|---|
| PostGIS tables, `packages/versioning`, WebAtlas API, editing, P1–P3 | **Unchanged** |
| Standalone GeoServer 2.26.0 (`infra/docker-compose.yml`) | **Retired** after M3; its contents move into GeoNode's GeoServer |
| `atlas-data` publish stages | Same code, pointed at GeoNode's GeoServer (`GEOSERVER_URL`, credentials) |
| New registry stage | `register-geonode`: create/refresh the GeoNode record, metadata, thumbnail |
| WebAtlas web app | `VITE_GEOSERVER_URL` points at GeoNode's GeoServer; nothing else |
| Orchestration | New engine that schedules and runs the existing registry stages |

Facts checked (2026-11-09):
- GeoNode **5.0** was released December 2025 (5.0.2 is current): Django 5, Python 3.12, GeoServer **2.27.3**, Redis replaces RabbitMQ, new JSON-Schema metadata engine, pycsw 3, rule-based permissions, field-level constraints, MapStore dashboards and GeoStory. Docker configs moved to the `geonode-docker` repo. The 5.0 documentation is still being rewritten, so several details below need the spike (M0) to confirm.
- `updatelayers` registers layers that already exist in GeoServer (`-w` workspace, `-s` store, `--skip-geonode-registered`). It registers **layers only, not layer groups**.
- GeoFence defaults to deny: a layer GeoNode doesn't know about may be unreadable, which would blank the WebAtlas map. Hence "register everything WebAtlas requests".
- Datasets **not on GeoServer today**: `admin_boundaries`, `dem`, `reference_entities`, `demo` (the API serves them). Registering them means adding publish stages first.

## 3. Pages

| Page | Lives in | Notes |
|---|---|---|
| Landing | GeoNode | Custom pages/sections are supported in 5.0 |
| Map catalogue | GeoNode | Replaces the planned P6 catalogue |
| Dataset detail | GeoNode | Metadata, licence, lineage, dictionary fields, download; **"Mở trên bản đồ"** deep-links into WebAtlas |
| Dashboards / GeoStory | GeoNode (MapStore) | Superset only if BI-grade dashboards are needed later |
| Map viewer + edit mode | **WebAtlas** | Today's app, analysis tools, flood scenario, editing (G4) |
| Bản của tôi | **WebAtlas** | P3 personal maps stay; GeoNode's personal datasets are not used for official-layer work |
| Review queue | **WebAtlas** | P4, unchanged |
| Quản lý | **WebAtlas** | Jurisdiction groups, managing units (P1) |
| Orchestration | Engine's own UI (first pass) | See D3 |

## 4. Migration (registration) phases

**M0 — Spike (throwaway).** GeoNode 5.0.x in a separate Compose project next to today's stack. Answer, with evidence:
1. Can `updatelayers` register layers from a PostGIS store in a `webatlas` workspace, or does GeoNode require its `geonode` workspace? (Decides D5.)
2. Do the five basemap layer groups and their GWC WMTS caches serve anonymously through GeoNode's GeoServer, and with CORS for the WebAtlas origin?
3. What happens to an unregistered layer (GeoFence default deny)?
4. Which GeoNode REST endpoint sets metadata in 5.0's new engine (for `register-geonode`)?
5. Vietnamese UI coverage of GeoNode and MapStore.
6. MapStore's React/OpenLayers versions (for moving tools in as plugins later).
7. Memory footprint of the whole stack on the target on-prem server.

**M1 — Basemap pilot.**
- GeoNode joins `infra/docker-compose.yml` (its own profile at first); its GeoServer gets the `webatlas` PostGIS datastore through a read-only role.
- Run the basemap publish stages against it: featuretypes → styles → groups → GWC seed (existing order).
- `register-geonode` creates 8 dataset records (one per basemap table) with ISO metadata from lineage (source, ODbL licence) and the data dictionary; the 5 groups become MapStore's default background.
- WebAtlas web switches `VITE_GEOSERVER_URL`. Acceptance: `atlas:verify` passes, before/after screenshots identical at the standard views, CSW returns the 8 records.

**M2 — Every other dataset.** Rivers, contours, the 8 thematic layers (already published), then new publish stages for admin boundaries, DEM and reference entities. Official layers are registered from their `_active` views, read-only.

**M3 — Retire the standalone GeoServer.** Remove the `geoserver` service, move CI's GeoServer-gated tests to GeoNode's GeoServer, update runbooks and `atlas:up`.

## 5. Orchestration

The registry in `atlas-data` already has datasets, dependencies, a stage runner, run state, a build lock, lineage, probes and verification. The engine does not replace it. It adds **schedules, triggers, a runs page (history, logs, retries, alerts) and new pipelines**, and it calls `atlas:build --only <dataset>`, so the registry stays the one place a dataset is defined.

Every pipeline ends the same way: **load as a new version → activate → truncate/seed GWC → `register-geonode` refresh.** Pipeline data therefore gets version history and rollback from day one (guardrail 3).

First pipelines:
| Pipeline | Trigger | Note |
|---|---|---|
| Basemap refresh | Monthly (first-of-month Geofabrik file) | Today the pin (date + SHA256) is bumped by hand; see D4 |
| KTTV hydro-met + stations | Schedule (hourly or as the API allows) | Data arrives over ~6 months; build against a sample feed first |
| Contours / DEM | Manual | Heavy; rarely re-run |
| Satellite extraction | Later | Parked; still blocked on the GPU question |

## 6. Governance — one source per concern

| Concern | Source of truth | Shown in GeoNode as |
|---|---|---|
| Field definitions | Data dictionary (`packages/shared`) | Attribute descriptions on the dataset record |
| Lineage, source, licence | `dataset_lineage` (ISO 19115-shaped) | Lineage / constraints metadata |
| Versions | `packages/versioning` | Version note + last-updated date (history panel comes with the hybrid) |
| View/download rights | GeoNode (first pass) | Native |
| Edit rights | WebAtlas P1 jurisdiction | Not shown (official layers read-only in GeoNode) |

GeoNode metadata is **generated** from these sources by `register-geonode` and never edited by hand for official datasets, or the two will drift.

## 7. Effect on P4–P11

| Item | Effect |
|---|---|
| P4 submit/review/publish | Keep, unchanged |
| P5 flow 1 (vector into the 8 layers) | Keep |
| P6 catalogue (redesign sub-project 2) | **Replaced** by GeoNode's catalogue and dataset pages |
| P7 catalogue-map management (flow 2) | **Mostly replaced**: GeoNode upload/replace for thematic maps; versioned updates go through pipelines |
| P8 drawing, P9 attribute table, P10 compare/time, P11 annotation | Keep in WebAtlas |
| New | GeoNode stack, `register-geonode` stage, missing publish stages, orchestration engine + pipelines; SSO with the hybrid |

## 8. Costs and risks

- A heavy extra stack (Django, Celery, Redis, nginx, pycsw, MapStore) and a second backend to operate, on an on-prem server.
- GeoServer upgrades follow GeoNode's release cycle (2.26.0 → 2.27.3 now).
- GeoNode 5.0 docs are mid-rewrite; behaviour must be proven in M0, not assumed.
- Two logins in the first pass (D2) are confusing for agency users.
- The ~mid-December 2026 seminar is about upload and edit (P4–P5). GeoNode work competes for the same weeks (D6).

## 9. Open decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Orchestration engine: Dagster, Prefect or Airflow? | **Dagster.** Its asset model maps 1:1 to registry datasets with dependencies and lineage, it is Python like the tools image and the satellite work, and it is lighter to self-host than Airflow. Note: Prefect reportedly acquired Dagster Labs in July 2026 (unverified); Dagster OSS continues. |
| D2 | First-pass login: separate accounts, or SSO now? | **Separate**, with official layers publicly readable. SSO (GeoNode as the OAuth2/OIDC provider) comes with the hybrid. |
| D3 | Orchestration page: the engine's UI, or a WebAtlas/GeoNode page? | **Engine's UI** for operators first; a run-status block on GeoNode's dataset page later. |
| D4 | Basemap refresh: auto-bump the pin, or a run that waits for approval? | **Auto-run monthly**, recording the new date + SHA256 as the lineage source; the version can be rolled back. |
| D5 | GeoServer workspace: keep `webatlas` or move to `geonode`? | Decide from M0 finding 1; keep `webatlas` if GeoNode allows it (fewer URL changes). |
| D6 | Order against the seminar: GeoNode M0–M1 before P4, after it, or in parallel? | **M0 spike now, M1 after the seminar**, so P4–P5 stay the seminar focus. |

## 10. Next step

On approval: M0 spike, reported as findings 1–7 above, then a detailed M1 implementation plan.
