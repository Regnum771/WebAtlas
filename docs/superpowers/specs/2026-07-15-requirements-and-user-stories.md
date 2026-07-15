# WebGIS Water Resources — Requirements & User Stories

**Date:** 2026-07-15
**Status:** Living document — consolidates requirements reverse-engineered from the design specs and the shipped code.
**Purpose:** The single place for **user stories**, **functional requirements (FR)**, and **non-functional requirements (NFR)**. It does not restate the detailed backend/frontend/database *design* — those live in the specs indexed in §7. Where a requirement is already designed or built, this doc points to the authoritative section/plan.

---

## 1. Product summary

A WebGIS for Vietnam water resources. A **public viewer** browses thematic water/hazard layers (dams, rivers, monitoring stations, flood zones, drought points, saltwater intrusion, flood-generation zones) over administrative boundaries. An authenticated **administrator** manages the data: logs in, edits map features (create now; modify/delete planned), and — planned — manages users. Feature data is a single source of truth in PostGIS, published read-only to the public via GeoServer WFS; the API is the only writer.

---

## 2. Actors

| Actor | Description | Auth |
|---|---|---|
| **Public viewer** | Anonymous visitor; reads thematic layers read-only. | None |
| **Administrator** | Provisioned account with `role='admin'`; full data + (planned) user management. | JWT |
| **Editor / Viewer** (roles reserved) | `role` column supports `admin`\|`editor`\|`viewer`; only `admin` is exercised today. Editor/viewer behavior is **not yet specified** — reserved for a future plan. | JWT |
| **System / async worker** (planned) | The deferred EO pipeline's Python worker (not built). | Service |

---

## 3. User stories

Stories are grouped by capability. Each carries a status: **✅ Shipped**, **🔵 In review** (open PR), **⚪ Planned** (designed, not built), **🟡 Reserved** (mentioned, not designed).

### 3.1 Public viewing

- **US-V1** ✅ As a public viewer, I want to see the thematic water/hazard layers on a map without logging in, so I can explore Vietnam's water resources. *(FR-1, FR-2)*
- **US-V2** ✅ As a public viewer, I want each layer styled meaningfully (dam marker size by capacity, dam color by operational status, river width by stream order), so the map communicates at a glance. *(FR-3)*
- **US-V3** ✅ As a public viewer, I want to click a feature and see its attributes in a popup with human-readable (ISO/INSPIRE) names, so I understand what I'm looking at. *(FR-4)*
- **US-V4** ✅ As a public viewer, I want to toggle layers, switch basemaps, read a legend, and search, so I can focus on what matters. *(FR-5)*
- **US-V5** ✅ As a public viewer, I want administrative boundaries (provinces at low zoom, wards at high zoom) as context. *(FR-6)*
- **US-V6** ✅ As a public viewer, I want the map to stay responsive while panning/zooming across thousands of features. *(NFR-Perf-1)*

### 3.2 Authentication & session

- **US-A1** ✅ As an admin, I want to log in with email + password and receive a session, so I can access admin tools. *(FR-7)*
- **US-A2** ✅ As an admin, I want to stay logged in across a page refresh, so I don't re-authenticate constantly. *(FR-8)*
- **US-A3** ✅ As an admin, I want a clear error on wrong credentials / network failure, so I know what went wrong. *(FR-9)*
- **US-A4** ✅ As an admin, I want to log out, so I can end my session. *(FR-10)*
- **US-A5** ✅ As a logged-in admin, I want admin-only UI to appear only for me, so the interface is role-appropriate (UX only — the backend is the real gate). *(FR-11, NFR-Sec-2)*

### 3.3 Admin map editing

- **US-E1** ✅ As an admin, I want to pick one of the editable layers, draw its geometry, fill a schema-driven attribute form, and save, so I can add a new feature. *(FR-12 — Plan 7 / PR #7)*
- **US-E2** ✅ As an admin, I want the new feature to appear on the map immediately after saving, so I get confirmation. *(FR-13)*
- **US-E3** ✅ As an admin, I want to only ever edit the 7 editable thematic layers, never the GADM base layers, so I can't corrupt reference data. *(FR-14, INV in §6)*
- **US-E4** ✅ As an admin, I want validation errors (bad geometry, invalid attribute) surfaced clearly on the form, so I can correct and retry. *(FR-15)*
- **US-E5** ⚪ As an admin, I want to select an existing feature and modify/move its geometry or edit its attributes, so I can correct data. *(FR-16 — designed as "next editing plan", not built)*
- **US-E6** ⚪ As an admin, I want to delete a feature, so I can remove obsolete data. *(FR-17 — same follow-on plan)*

### 3.4 Data integrity & audit

- **US-D1** ✅ As the system owner, I want every admin write (create/update/delete) recorded in an audit log with before/after, so changes are traceable. *(FR-18)*
- **US-D2** ✅ As the system owner, I want all feature geometry validated in PostGIS before it's stored, so invalid geometry never persists. *(FR-19)*
- **US-D3** ✅ As the system owner, I want feature data to have exactly one source of truth (PostGIS), with the public reading a read-through projection (WFS), so there's no divergent copy. *(NFR-Data-1, INV-1)*

### 3.5 User management

- **US-U1** 🟡 As an admin, I want to list, create, update, and deactivate other admin/user accounts, so I can manage who has access. *(FR-20 — API designed in §6.4; no admin-users UI built; `POST /api/users` exists for provisioning)*

### 3.6 Earth-observation (satellite) — deferred

- **US-EO1** ⚪ As an admin, I want to trigger an async job that fetches satellite imagery for an area of interest and produces derived products (NDWI/NDVI, later SAR flood extent), so the viewer can show remote-sensing layers. *(FR-21 — fully designed in backend spec §14; NOT built. The plan slots originally numbered for EO were reused for frontend auth/editing.)*
- **US-EO2** ⚪ As a public viewer, I want a date slider to browse time-aware EO coverages. *(FR-22 — designed §14.8, not built)*

---

## 4. Functional requirements

Status legend as in §3. "Source" points to the authoritative design section (§7 index) and/or the plan that delivers it.

| ID | Requirement | Status | Source |
|---|---|---|---|
| **FR-1** | Serve the 7 thematic layers to anonymous users as GeoJSON via GeoServer WFS (EPSG:4326, reprojected to 3857 client-side). | ✅ | Backend §3, §5.2; Plan 2, Plan 3 |
| **FR-2** | The public viewer requires no authentication for reads. | ✅ | Backend §1; `GET /api/layers` public |
| **FR-3** | Client-side vector styling: dam size∝capacity, dam color∝operational status, river width∝stream order; styles cached (no per-frame allocation). | ✅ | Frontend §7.4; map-perf spec / PR #8 |
| **FR-4** | Feature popups display ISO/INSPIRE attribute names (via `normalizeFeatureProperties`). | ✅ | Plan 3; `packages/shared` |
| **FR-5** | Layer toggle, basemap switch, legend, search UI. | ✅ | Frontend §7.2 (`layers-panel`) |
| **FR-6** | GADM province (low zoom) + ward (high zoom) boundaries as static reference layers, not in DB. | ✅ | Backend §5.2; Plan 3b |
| **FR-7** | `POST /api/auth/login` → JWT + user for valid email/password (argon2-hashed). | ✅ | Backend §6.4; Plan 4, Plan 6 |
| **FR-8** | Session rehydration on load via `GET /api/auth/me`; JWT persisted (localStorage). | ✅ | Plan 6 (documented deviation from in-memory) |
| **FR-9** | Login error mapping: 401→"invalid credentials", 429→rate-limit, network→"cannot reach server". | ✅ | Plan 6 |
| **FR-10** | Logout clears session + token. | ✅ | Plan 6 |
| **FR-11** | `RequireRole('admin')` gates admin UI (UX only; not a security control). | ✅ | Plan 6; Frontend §7.3 |
| **FR-12** | Admin create-a-feature: pick layer → draw geometry → attribute form (DB-column keyed, ISO labels) → `POST /api/layers/:key/features` (JWT, 4326 GeoJSON, DB-column props). | ✅ 🔵 | Admin-editing spec; Plan 7 / PR #7 |
| **FR-13** | After a successful write, the layer's WFS source refetches so the feature renders live. | ✅ 🔵 | Admin-editing spec §4; Plan 7 |
| **FR-14** | Only the 7 editable layers are editable; the picker is sourced only from `GET /api/layers`; GADM layers have no write path. | ✅ 🔵 | Admin-editing spec §2 (INV-1) |
| **FR-15** | API validation errors surfaced on the form: 400 field errors (from Zod `flatten()`), 422 geometry, 409 conflict. | ✅ 🔵 | Plan 7 (+ numeric-coerce fix) |
| **FR-16** | Admin modify/move existing feature geometry + edit attributes (`PUT /api/layers/:key/features/:id`). | ⚪ | Admin-editing spec §9 (next plan) |
| **FR-17** | Admin delete feature (`DELETE /api/layers/:key/features/:id`). | ⚪ | Admin-editing spec §9 |
| **FR-18** | Every create/update/delete recorded in `app.audit_log` with before/after jsonb. | ✅ | Backend §5.1; Plan 5 |
| **FR-19** | Geometry validated in PostGIS (`ST_IsValid`) before insert/update → 422 on failure, not 500. | ✅ | Plan 5 (`geometry.ts`) |
| **FR-20** | User-management API: list/create/update/deactivate users (admin-only). UI not built. | ✅ (API) / 🟡 (UI) | Backend §6.4; `modules/users` |
| **FR-21** | Admin-triggered async EO pipeline (Sentinel-2/Landsat → NDWI/NDVI COGs → GeoServer coverages). | ⚪ | Backend §14 (designed, not built) |
| **FR-22** | Viewer EO layers with a time/date slider. | ⚪ | Backend §14.8 |

---

## 5. Non-functional requirements

| ID | Requirement | Status | Source / note |
|---|---|---|---|
| **NFR-Sec-1** | The backend is the authorization boundary: 401 unauthenticated, 403 non-admin, enforced on every admin route — unbypassable from the client. | ✅ | Backend §10; Plan 4/5/6 |
| **NFR-Sec-2** | Client-side role gating (`RequireRole`) and admin UI are **UX only**, never a security control (code comment required). | ✅ | Frontend §7.3; Plan 6 |
| **NFR-Sec-3** | Passwords hashed with argon2; JWT short-lived (no refresh-token rotation — re-login). | ✅ | Backend §5.1, §12 |
| **NFR-Sec-4** | CORS locked to the configured web origin; helmet + rate-limit as global plugins. | ✅ | Backend §6.5 |
| **NFR-Data-1** | Feature data lives only in PostGIS (INV-1); GeoServer is a read-through projection; the frontend holds only a transient cache refetched after each write. | ✅ | Backend §4 |
| **NFR-Data-2** | Attribute schema has one definition in `packages/shared`, consumed by migrations, API registry, and frontend forms (INV-4). | ✅ | Backend §4; `packages/shared` |
| **NFR-Data-3** | The API layer registry is the one authoritative layer catalog; the frontend layer list is derived from `GET /api/layers` (INV-2). | ✅ | Backend §4 |
| **NFR-Data-4** | Dam operational status is a canonical slug (`binh_thuong`\|`xa_lu`\|`nguy_hiem`) with a single frontend slug→{label,color} map; seeds idempotent/deterministic. | ✅ 🔵 | map-perf spec; PR #8 |
| **NFR-Arch-1** | Frontend follows MVP + Feature-Sliced Design; OpenLayers quarantined to `features/map/model/`; `*.view.tsx` props-only; presenters no JSX/fetch; only Models touch `apiClient`/`ol/*`. | ✅ | Frontend §7.1–§7.3 |
| **NFR-Arch-2** | Backend is layered vertical slices (plugins/hooks global, modules own their slice); generic CRUD across layers via the registry. | ✅ | Backend §6 |
| **NFR-Perf-1** | Map stays responsive under pan/zoom over thousands of features — styles cached, no per-frame allocation, no per-frame feature mutation. | ✅ 🔵 | map-perf spec; PR #8 |
| **NFR-Test-1** | API: integration tests (auth, CRUD, validation, RBAC, audit, migration/seed idempotency) + unit tests. Frontend: presenters as pure hooks, views via render, Models against test doubles. | ✅ | Backend §11 |
| **NFR-Ops-1** | Monorepo + Docker Compose (PostGIS + GeoServer + API); reproducible dev stack. | ✅ | Backend §6, §3; Plan 1 |

---

## 6. Key invariants (binding constraints)

These are cross-cutting rules every requirement inherits (full text in backend spec §4):

- **INV-1** Feature data lives only in PostGIS; all writes go through the API; GeoServer WFS-T disabled.
- **INV-2** The API layer registry is the authoritative layer catalog; frontend + GeoServer publication derive from it.
- **INV-3** Vector styling lives in exactly one place (the frontend).
- **INV-4** Attribute schema has one definition (`packages/shared`).
- **INV-5** Raster EO data lives as COGs + GeoServer coverages, never in PostGIS (EO deferred).

---

## 7. Design document index (where each view lives)

This doc holds requirements; the **design** for each area is authoritative in these specs:

| View | Authoritative source |
|---|---|
| **Backend design** | [Master spec §3, §6, §9, §10](2026-07-10-webgis-water-resources-backend-design.md) (architecture, Fastify layering, plugins/hooks, API surface §6.4, error handling, security) |
| **Database design** | [Master spec §5](2026-07-10-webgis-water-resources-backend-design.md) (`app` + `water` schemas), §14.4 (`eo` schema); live schema in `apps/api/migrations` |
| **Frontend design** | [Master spec §7](2026-07-10-webgis-water-resources-backend-design.md) (MVP + FSD, convention rules) + feature specs: [admin-auth](2026-07-14-frontend-admin-auth-foundation-design.md), [admin-editing](2026-07-14-admin-editing-draw-create-design.md), [map-perf + dam-status](2026-07-15-map-perf-and-real-dam-status-design.md) |
| **EO subsystem** (deferred) | [Master spec §14](2026-07-10-webgis-water-resources-backend-design.md) |
| **Implementation plans** | `docs/superpowers/plans/` (Plans 1–7 + map-perf) |

---

## 8. Delivery status (what's actually built)

The master spec's §13 roadmap listed Plans 6–7 as the **EO subsystem**; during execution those slots were **reused for frontend work** (auth foundation, admin editing), and EO was deferred. Actual state:

| Plan / branch | Scope | Status |
|---|---|---|
| Plan 1 | Monorepo + infra (PostGIS + GeoServer + Compose) | ✅ Merged |
| Plan 2 | Vector schema + seeds + GeoServer WFS | ✅ Merged |
| Plan 3 / 3b | Frontend WFS swap + MVP/FSD refactor | ✅ Merged |
| Plan 4 | API control plane (middleware + auth + users) | ✅ Merged |
| Plan 5 | Vector feature CRUD + audit + geometry validation | ✅ Merged |
| Plan 6 | Frontend admin auth foundation (session/login/apiClient) | ✅ Merged (PR #6) |
| Plan 7 | Admin editing — draw-to-create | 🔵 Open PR #7 |
| map-perf + dam-status | Style caching + real dam status | 🔵 Open PR #8 |
| Modify/move + delete | Next editing plan | ⚪ Planned (FR-16, FR-17) |
| Admin-users UI | User management frontend | 🟡 Reserved (FR-20 API exists) |
| EO subsystem | Satellite pipeline | ⚪ Deferred (FR-21, FR-22) |

---

## 9. Open questions / gaps to resolve

- **Editor/Viewer roles** (US actors) are reserved in the schema but their behavior is unspecified — needs a plan if non-admin roles become real.
- **Admin-users UI** (FR-20): the API exists; no frontend. Decide if/when to build it.
- **Modify/move + delete** (FR-16/17): designed as the next editing plan; not yet planned in detail.
- **EO subsystem** (FR-21/22): fully designed but unbuilt and unscheduled; confirm whether it's still in the roadmap.
