# Role → Capability Semantics (Roadmap 2.1) — Design

**Date:** 2026-07-15
**Status:** Approved design — ready for implementation planning
**Roadmap:** Phase 2, item 2.1 (see `2026-07-15-product-roadmap.md` §4.3). Foundation the adaptive shell (2.2) sits on.
**Scope:** Make the `editor` and `viewer` roles grant **distinct, tested capabilities end-to-end**, replacing today's reality where the `app.user_role` enum has `admin | editor | viewer` but only `admin` does anything. Backend stays the authorization boundary; the frontend gate is widened as UX only. Frontend + API only — no DB change. The spec also records a **persona metric-focus catalogue** (§3) — which thematic-layer metrics each persona cares about — as product context/demand-signal for the downstream persona panels; that section is non-normative for the access-control code delivered here.

---

## 1. Context & goal

The authorization primitives already exist and are role-capable; they are simply only ever *called* with `'admin'`:

- **API:** `authorize(...roles: Role[])` (`apps/api/src/hooks/authorization.ts`) is already variadic — throws `AuthError` (401) when unauthenticated, `ForbiddenError` (403) when the current user's role isn't in the allowed set. Every layer/user route currently passes `authorize('admin')` via a shared `adminOnly` bundle.
- **Frontend:** `RequireRole` (`apps/web/src/features/auth/ui/RequireRole.tsx`) already accepts `role | role[]`; `apiClient` attaches the JWT and applies the 401→logout / 403→keep-session rule (auth-foundation §2). The edit slice `features/admin-editing/` is gated `RequireRole role="admin"`.
- **DB:** `app.user_role` enum already contains all three roles; `users` default is `viewer`. `layers.test.ts`/`users.test.ts` already seed an `editor` and assert it is currently **forbidden** everywhere.

**Goal:** turn the inert role vocabulary into real capabilities: an `editor` can create/modify/delete features (the existing edit loop, un-gated from admin-only); a `viewer` is an authenticated role that can reach the feature **read** API that anonymous public cannot; `admin` retains everything plus user management. This is the access-control layer the Governance/Research/Data-Steward personas (roadmap §4.1) are built on.

### Non-goals (deferred)

- **Private-layer concept.** The public map keeps reading all thematic layers directly from GeoServer WFS (no login). "Viewer authenticated-read" in 2.1 means only *un-gating the feature API endpoint* — it does **not** introduce layers that are hidden from the public. (Roadmap §6/§7.)
- **Per-layer editor scoping** (a user↔layer assignment model). Editor can write to all editable layers, same set as admin today.
- **Delete reserved to admin** — editor may delete (decided; destructive-op reservation is not wanted here).
- **New viewer UI** — the panels that *consume* viewer read access (filter/query/export) are 2.3/2.4. 2.1 gives viewer the authenticated read *capability*, no new screens.
- **The adaptive shell** (2.2) and any user-management UI (Phase 1, item 1.1).

---

## 2. Capability matrix (the core policy)

| Capability | Route(s) | admin | editor | viewer | public/anon |
|---|---|:--:|:--:|:--:|:--:|
| Read layer catalog | `GET /api/layers` | ✅ | ✅ | ✅ | ✅ (already public) |
| Read features via API | `GET /api/layers/:key/features` | ✅ | ✅ | ✅ | ❌ (anon reads via GeoServer WFS) |
| Write features (create/modify/delete) | `POST` / `PUT` / `DELETE /api/layers/:key/features[/:id]` | ✅ | ✅ | ❌ | ❌ |
| Manage users | `GET/POST/PUT/DELETE /api/users*` | ✅ | ❌ | ❌ | ❌ |

**Invariant (unchanged):** the backend is the real authorization boundary. `RequireRole` and any hidden UI are UX only — a viewer who forces the edit UI open is still rejected with **403** by the write routes, and a 403 keeps the session (does not log out) per the auth foundation.

---

## 3. Persona metric focus (product context — non-normative for 2.1 code)

**Purpose:** define, per persona, *which* thematic-layer metrics each one monitors, filters, and reports on. This is the demand signal for the downstream persona panels (roadmap 2.2/2.3/2.4); it does **not** change the access-control code in this spec's §4–§7. It lives here because it belongs with the stakeholder work and the roadmap requested it (roadmap §4.1 personas).

**Source data:** the 7 editable thematic layers and their attributes are fixed in `packages/shared/src/layer-attributes.ts` (`LAYER_ATTRIBUTE_MAP`), ISO/INSPIRE-named. Layers: `dams`, `rivers`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`.

**Metric kinds & feasibility tags** — every *derived* metric carries one:
- `[available now]` — computable from current per-feature attributes (count, avg/min/max, distribution, filter).
- `[needs aggregation]` — requires a spatial join to admin boundaries (per-province/ward rollup) not built yet.
- `[needs time-series]` — requires temporal history the model doesn't hold (features are single-row snapshots; only the audit trail is temporal).

### 3.1 Community & Water Users (public) — orientation, not analysis

- **Priority attributes:** `geographicalName`; `operationalStatus` (dams, stations); `riskLevel` (flood_zones, drought_points, saltwater_intrusion, flood_generation); `observedStatus` (drought_points, saltwater_intrusion).
- **Derived:** nearest-feature distance `[available now]`; simple risk badge (low/med/high) from `riskLevel` on nearby hazard points `[available now]`.

### 3.2 Governance (viewer) — oversight & reporting, status/risk-centric

- **Priority attributes:** Dams — `operationalStatus`, `ratedPower`; Stations — `operationalStatus`, `measurementType`; Hazard layers — `riskLevel`, `hazardType`, `affectedArea` / `catchmentArea`.
- **Derived:** count of dams by `operationalStatus` per province `[needs aggregation]`; count of hazard points by `riskLevel` per admin boundary `[needs aggregation]`; total affected/catchment area per province `[needs aggregation]`; share of stations reporting (operational vs not) `[available now]` (system-wide) / `[needs aggregation]` (per boundary).

### 3.3 Research & Academia (viewer) — quantitative modeling variables

- **Priority attributes:** Dams — `ratedPower`, `annualGeneration`, `commissioningYear`; Rivers — `streamOrder`, `length`; Stations — `measurementValue`, `measurementType`; Drought — `observationDate` (the only dated attribute, on `drought_points`); Saltwater — `salinity`; Drought / flood_generation — `riskLevel`, `catchmentArea`, `flowCharacteristics`.
- **Derived:** avg/min/max `measurementValue` by station type `[available now]`; `annualGeneration` distribution across dams `[available now]`; raw attribute-table export for offline modeling `[available now]` (roadmap 2.4); salinity trend over time `[needs time-series]`; `measurementValue` series over time `[needs time-series]`.

### 3.4 Data Steward / Producer (editor) — completeness & correctness, not analytics

- **Priority attributes:** *all* editable attributes on the layers they maintain (the full attribute form), plus data-quality signals.
- **Derived:** % features with missing required attributes per layer `[available now]`; stale-record age from `observationDate` / `survey_date` `[available now]`; count of features edited recently `[needs time-series]` (relies on audit timestamps — available via the audit trail, not feature rows).

### 3.5 System Operator / Admin — governance rollups

- **Priority attributes:** everything the Data Steward sees.
- **Derived:** features-per-layer totals `[available now]`; edit volume per user `[needs time-series]` (from the existing audit trail); user/role/active counts `[available now]`.

**Scope note:** only `[available now]` metrics are candidates for the near-term persona panels; `[needs aggregation]` waits on a boundary spatial-join capability and `[needs time-series]` on a temporal data model — both are separate future specs, explicitly **not** part of 2.1. This section is the target catalogue, not an implementation commitment.

---

## 4. Architecture — components

### 4.1 API — a named capability policy (single source of truth)

The role→capability mapping must live in **one auditable place**, not scattered as inline `authorize('admin','editor')` calls across route files (matches the roadmap's "document the matrix" note).

- **New module** `apps/api/src/hooks/capabilities.ts` exporting named role sets:
  - `CAN_READ_FEATURES: Role[] = ['admin', 'editor', 'viewer']`
  - `CAN_WRITE_FEATURES: Role[] = ['admin', 'editor']`
  - `CAN_MANAGE_USERS: Role[] = ['admin']`
- `Role` is imported from `modules/users/repository` (existing type). Constants are typed `Role[]` (or `readonly Role[]`) so a typo is a compile error.
- `authorize()` is **unchanged** — routes call `authorize(...CAN_WRITE_FEATURES)` etc.

### 4.2 API — route wiring

- **`modules/layers/routes.ts`:** replace the single `adminOnly` bundle with per-route policy:
  - `GET /layers` — public (unchanged, no `preHandler`).
  - `GET /layers/:key/features` — `preHandler: [app.authenticate, authorize(...CAN_READ_FEATURES)]`.
  - `POST /layers/:key/features`, `PUT /layers/:key/features/:id`, `DELETE /layers/:key/features/:id` — `preHandler: [app.authenticate, authorize(...CAN_WRITE_FEATURES)]`.
- **`modules/users/routes.ts`:** reference `authorize(...CAN_MANAGE_USERS)` (behavior identical to today — the change documents intent and routes the policy through the same module).

No controller, schema, or DB change — only which roles each `preHandler` accepts.

### 4.3 Frontend — rename the slice + widen the gate

The editing slice is named for `admin` but the capability now belongs to `editor` + `admin`. Rename so the name stays honest (decided in brainstorming):

- **Rename** `apps/web/src/features/admin-editing/` → `apps/web/src/features/feature-editing/`; the default export `AdminEditing` → `FeatureEditing`. Update all imports (the app shell + tests that reference the slice/component).
- **Widen the gate** in the slice's `index.tsx`: `RequireRole role="admin"` → `role={['admin', 'editor']}`. Update the "admin route" comment to say editor/admin, keeping the UX-only-not-a-security-control note.
- `RequireRole`, `apiClient`, `useSession`, and the session entity are **unchanged** — all already role-capable.
- **Viewer gains no new UI here.** It becomes a role the API read endpoints accept; the screens that use that come in 2.3/2.4.

---

## 5. Data flow

Identical to today except which roles a `preHandler` admits — the JWT already carries the role (`request.currentUser.role`), set by `app.authenticate`.

1. Editor logs in → JWT carries `role: 'editor'`. The app shell shows the (renamed) `FeatureEditing` slice because `RequireRole ['admin','editor']` matches.
2. Editor draws/modifies/deletes a feature → `apiClient` `POST/PUT/DELETE` with the JWT → `authorize(...CAN_WRITE_FEATURES)` admits `editor` → the existing create/modify/delete controller runs → WFS refetch renders the change (unchanged from Plans 7/8).
3. Viewer logs in → JWT carries `role: 'viewer'`. `FeatureEditing` is hidden (gate doesn't match). Any authenticated read the app performs against `GET /api/layers/:key/features` is admitted by `authorize(...CAN_READ_FEATURES)`.
4. Viewer attempts a write (forced UI or direct call) → `authorize(...CAN_WRITE_FEATURES)` rejects with **403** → session kept, "no permission" surfaced (auth foundation), **not** logged out.
5. Anon (no token) hits any feature endpoint → `app.authenticate` → **401**.

---

## 6. Error handling

Reuses the established rules — no new machinery:

- **401** (missing/expired/invalid token) → `apiClient` clears session, prompts login.
- **403** (valid token, insufficient role — e.g. viewer writing) → keep session, surface "no permission" (toast/inline), do **not** log out.
- Existing feature-CRUD error mapping (400 field/form, 422 geometry, 404 concurrent-delete) is unchanged — 2.1 only changes *who is admitted*, not what the controllers return.

---

## 7. Testing (mirrors existing API/web test patterns)

**API** — extend `apps/api/src/modules/layers/layers.test.ts` (already seeds `ADMIN` + `EDITOR`; add a `VIEWER` seed):

- `editor` can `POST` / `PUT` / `DELETE` a feature → 201 / 200 / 204.
- `viewer` → **403** on each write; **200** on `GET /layers/:key/features`.
- `editor` → **200** on `GET /layers/:key/features`.
- no token → **401** on every guarded route.
- `admin` → unchanged (still passes all).
- `users.test.ts`: `editor` and `viewer` remain **403** on `/api/users` (assert `CAN_MANAGE_USERS` is admin-only).
- A small unit test on `capabilities.ts` (the constants contain the expected roles) is optional but cheap — guards against an accidental matrix edit.

**Web** — `RequireRole`/`FeatureEditing`:

- renders the editing toolbar for `role: 'editor'` and `role: 'admin'`.
- hides it for `role: 'viewer'` and for anon (no `currentUser`).
- Update any test that imported `admin-editing`/`AdminEditing` to the new path/name.

**Manual `/run`** — seed an `editor` and a `viewer` (via `create-admin`-style script or a seed). Log in as editor → edit a feature → save succeeds + renders. Log in as viewer → the editing UI is absent; a direct write call returns 403 with the session intact; a `GET /api/layers/dams/features` returns 200. Use `@webatlas.test` accounts; clean up.

---

## 8. Convention rules (enforced in review)

1. The role→capability matrix lives only in `capabilities.ts`; routes reference the named constants, never inline role literals.
2. Backend remains the authorization boundary; `RequireRole` and hidden UI are UX only and carry the standard comment.
3. No DB/enum change — all three roles already exist.
4. The public GeoServer WFS read path is untouched; "viewer read" is API-endpoint access only, not a new private-data surface.
5. `authorize()` stays generic/variadic — capability meaning lives in the constants, not the primitive.

---

## 9. Scope boundaries (YAGNI — deferred)

- Private layers / public-vs-authenticated data surfaces → a later spec if a real need appears.
- Per-layer editor scoping (user↔layer assignment) → deferred; editor writes to the full editable set.
- Reserving delete (or any specific op) to admin → not wanted now; revisit only on a concrete driver.
- Viewer-facing panels (filter/query/export/saved views) → roadmap 2.3/2.4.
- Adaptive shell + persona workspaces → roadmap 2.2.
- **Computing** the persona metrics of §3 → downstream panel specs. Only `[available now]` metrics are near-term; `[needs aggregation]` (boundary spatial-join) and `[needs time-series]` (temporal data model) are separate future specs. §3 is a target catalogue, not a build commitment in 2.1.

---

## 10. Follow-on

- **2.2 Adaptive shell + persona panels** consumes this: it reveals Governance/Research/Edit/Management panels by the now-meaningful roles, the viewer read capability un-gated here is what the analysis panels query, and the **§3 persona metric-focus catalogue** is the demand signal for what each panel surfaces (start with the `[available now]` metrics).
- If per-layer stewardship is ever needed, `capabilities.ts` is the natural place to grow from static role sets to a capability check that also consults a user↔layer assignment.
