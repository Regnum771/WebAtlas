# WebAtlas — Product Roadmap (long-term feature planning)

**Date:** 2026-07-15
**Status:** Living document — revise as direction shifts
**Audience:** Developer (dev-sequencing). Terse, technical, dependency-ordered.
**Scope:** Forward-looking plan covering the specs' already-named follow-ons **plus** verified platform gaps, reframed in Phase 2 around **canonical stakeholders** (who uses WaterAtlas, their user stories, and the complex-system UI approach that serves them). Not a vision doc and not a backlog dump — it names the remaining work, groups it into dependency-ordered phases, and states why each phase precedes the next.

---

## 1. Where we are (baseline)

Delivered across 8 plans (Plans 1–8 + map-perf). Stack: React 19 + OpenLayers 10 (`apps/web`), Fastify + PostGIS + GeoServer (`apps/api`), shared types (`packages/shared`), Docker Compose. Feature-Sliced Design + MVP; OL quarantined to `features/map/model/`.

**On `main`:** backend infra + spatial DB + WFS, API control plane (auth/JWT/user-CRUD/admin guards), layer feature-CRUD API, frontend auth foundation, admin draw-to-create editing, map-perf + real dam status.
**On branch `feat/admin-editing-modify-delete` (11 commits ahead, tests green):** admin modify/move + delete (Part 2).

**Verified facts that shape this roadmap (checked against code 2026-07-15):**

- `app.user_role` enum is `admin | editor | viewer` and the DB default is `viewer`, but **only `admin` is exercised** anywhere. `editor`/`viewer` exist and are forbidden-tested, yet grant nothing distinct. Half-built.
- `/api/users` has full CRUD (create/update/deactivate, role, dup-email) with tests, but **no frontend UI**.
- **No CI.** No `.github/workflows`. `apps/api` and `apps/web` both carry real test suites (80 web tests, API module tests) run only manually; `test:web` isn't even a root script.

---

## 2. Sequencing principle

Dependency-phased. A feature lands in the earliest phase whose prerequisites are met; phase boundaries mark "you can't sensibly build X before Y." Priority is absorbed into ordering — foundational and high-value work is early. Within a phase, items are independent and may be reordered freely. Phase 3 (editing polish) depends on nothing in 1–2 and can start early if priorities change; it is later only because 1–2 are higher-value-per-effort. The Satellite EO pipeline is **parked** (§6), not scheduled, at the user's direction.

Each roadmap item becomes its own spec → plan → implementation cycle when picked up. This doc does **not** replace those; it decides order and records rationale.

---

## 3. Phase 1 — Close the half-built loops

**Why first:** these are foundational, cheap relative to value, and unblock Phase 2. Two of the three are "the backend already exists, wire the front / the pipeline." Doing them first also de-risks everything after by giving the repo a green gate.

| Item | What | Prereq | Notes |
|---|---|---|---|
| **1.0 Merge Part 2** | Land `feat/admin-editing-modify-delete` on `main` (after a manual `/run` pass). | Manual `/run` verification | Not a feature — housekeeping that unblocks a clean baseline. |
| **1.1 User-management UI** | Frontend for the existing `/api/users` CRUD: list users, create, edit (role, active), deactivate. `RequireRole('admin')`-gated. | none (API done) | Reuses the auth-foundation `apiClient`/TanStack-Query/`RequireRole` patterns. First consumer of a role other than the current admin-only surface. |
| **1.2 CI pipeline** | `.github/workflows` running `test:api` + web + shared tests + `lint:web` on PR/push. Add a root `test:web` script. | none | Turns the existing suites into a gate. Prereq for confidently doing everything below. |

**Exit criteria:** Part 2 on `main`; an admin can manage users from the UI; PRs run tests + lint automatically.

---

## 4. Phase 2 — Stakeholders, user stories & the adaptive UI

**Why here:** the role vocabulary (`admin | editor | viewer` + anonymous public) is defined but inert — only `admin` does anything distinct. Making the roles mean something is not just an access-control change; it is the point at which the system must serve *real people with real jobs*. So Phase 2 is reframed around **canonical stakeholders**: name who uses WaterAtlas, derive their user stories, and build the features + UI those stories demand. Phase 1's user-management UI is the prerequisite — it is what lets an admin actually *assign* editor/viewer to a person.

### 4.1 Canonical stakeholders (role → persona)

Five stakeholder groups (from the domain), mapped onto the four existing roles. **No DB role change** — Governance and Research share the authenticated `viewer` role but are distinct *personas* (different stories, different workspace panels). The backend `authorize()` matrix stays the authorization boundary; personas differ in UX intent, not in enforced permissions beyond their role.

| Role | Persona | Stakeholder group | Core job |
|---|---|---|---|
| **public** (anon) | **Community & Water Users** | Water users & local community (internal & local) | See water resources near them — read-only, no login, lean map. |
| **viewer** (auth) | **Governance** | Government & authorities: MONRE, MARD, Ministry of Construction, People's Committees (province / city / ward) | Oversight & decision-making: monitor status, filter, compare, produce reports. Not data editors. |
| **viewer** (auth) | **Research & Academia** | Research institutes & universities | Analyze trends, model climate-change scenarios, export datasets, propose science-based solutions. |
| **editor** (auth) | **Data Steward / Producer** | Map-data producers & providers | Keep feature data current — create / modify / delete features on assigned layers, in a focused edit workspace. |
| **admin** | **System Operator (GIS & IT)** | GIS & IT specialists — build the DB (CSDL), the WebGIS app, and mobile apps | Run the platform: manage users/roles, layers, attribute labels, config & governance. Superset of editor. |

### 4.2 User stories (per persona)

Representative stories; each is tagged to the feature(s) in §4.3 that satisfy it. Full story sets belong in each feature's own spec.

- **Community & Water Users (public):**
  - Search for the nearest reservoir/river and see its basic status without logging in.
  - Read a layer's public attributes via the info popup on a lean, uncluttered map.
- **Governance (viewer):**
  - Filter dams by operational status across a province and read a summary for oversight.
  - Compare hazard layers (flood/drought/saltwater) over an administrative boundary and export a report.
  - Land on a governance panel scoped to my jurisdiction's layers by default.
- **Research & Academia (viewer):**
  - Filter/query features by attribute and **export** the result (GeoJSON) for offline modeling.
  - Save named views/queries to return to a scenario later.
  - Access authenticated (non-public) analytical layers the public viewer does not see.
- **Data Steward / Producer (editor):**
  - Edit only the layers I am responsible for, in a focused edit workspace, with validation before save.
  - Create/modify/delete features and see the change live (the existing draw / modify / delete loop), gated to `editor`.
- **System Operator / Admin:**
  - Create a user and assign the `editor` role so a producer can maintain hazard layers (Phase 1 UI).
  - Edit attribute labels at runtime without a redeploy.
  - Do everything an editor can, plus governance of users/layers/config.

### 4.3 Derived features

| Item | What | Serves | Prereq | Notes |
|---|---|---|---|---|
| **2.1 Role → capability semantics** | Give `editor` real editing capability (today only `admin` writes) and `viewer` an authenticated read surface distinct from the anonymous public. Extend API `authorize()` beyond admin-only per route; extend frontend `RequireRole` past the admin-only gate. Backend stays the authorization boundary. | Data Steward, Governance, Research | 1.1 (assign roles) | Document the per-route role matrix. `RequireRole` UX-only discipline (auth foundation §2) holds. |
| **2.2 Adaptive shell + persona panels** | One map-centric app shell that reveals tools/panels/layers by role & persona (see §4.4). Public → lean viewer; Governance → oversight/report panel; Research → analysis/query panel; Data Steward → edit workspace; Admin → management console. | all personas | 2.1 | The structural UI change that makes personas real. Panels are dismissible, task-oriented. |
| **2.3 Query, filter & search** | Attribute filter + feature search over the layers, surfaced in the Governance & Research panels. | Governance, Research, (public: search) | 2.2 | Pulled up from the old Phase 3 — it is a core analyst/governance story, not polish. |
| **2.4 Data export & saved views** | Export a layer/selection as GeoJSON; save named views/queries. | Research, Governance | 2.3 | Research's offline-modeling and Governance's reporting stories. |
| **2.5 Editable attribute labels** | `app.layer_attribute_labels` table + admin GET/PUT API + runtime label fetch. The attribute form swaps its label source from the compile-time `LAYER_ATTRIBUTE_MAP` to the API — **no change to the DB-keyed save path**, so it works for create and edit. | Admin, Data Steward | none (independent) | Named follow-on (draw-create §9, modify-delete §9). Control-plane config maturity. |

### 4.4 UI design approaches for a complex system

WaterAtlas is a many-layer, many-role GIS — the standing risk is an overcrowded, one-size-fits-all UI. These named principles are **binding conventions** each persona-feature's own spec must follow:

- **Adaptive shared shell, not per-persona apps.** One map-centric shell; panels/tools/layers are shown/hidden by role & persona (progressive disclosure). Complexity is opt-in: the public sees the least; each authenticated persona reveals only the tools its jobs need. Least duplication, one coherent product.
- **Shneiderman's mantra — *overview first, zoom & filter, details-on-demand*** — is the map-interaction spine: start with the overview, let the user zoom/filter to their area of interest, and surface feature detail only on demand (popup/panel).
- **Task-oriented panels over a monolithic toolbar.** Each persona's jobs live in a dedicated, dismissible workspace panel (Governance / Analysis / Edit / Management), rather than one crowded toolbar. A user sees a workspace organized around *their* tasks.
- **Information hierarchy & role-scoped defaults.** Each role lands on the layers and tools relevant to it (e.g. Governance defaults to its jurisdiction/oversight layers). Sensible defaults first; depth is reachable but not in the way.
- **Backend stays the authorization boundary.** The shell only *reveals* UX per role; it is never the access-control decision (auth-foundation §2). A hidden panel is not a protected resource — the API still enforces.

**Exit criteria:** each persona has a distinct, tested workspace in the adaptive shell; editor/viewer roles grant distinct end-to-end capabilities; Governance & Research can filter/export; attribute labels are admin-editable at runtime without touching the save path.

---

## 5. Phase 3 — Editing UX polish

**Why here:** pure polish on top of the now-complete edit loop. Independent of Phases 1–2 — could slot anytime after Part 2 lands — but lower value-per-effort than the stakeholder work, so it follows. (Data export and filter/search moved up into Phase 2 §4.3, where they serve concrete Governance/Research stories rather than being generic "gaps.") Break into small independent specs; pick opportunistically.

| Item | What | Prereq | Notes |
|---|---|---|---|
| **3.1 Selection/edit polish** | Hover-highlight the hit feature before click; an "editing this feature" chip; vertex **snapping**; **undo/redo**. Optionally disable the rivers-highlight `Select` during edit if `/run` shows interference. | Part 2 | Explicit deferred non-goals from modify-delete §9. Each is its own small spec. |

**Exit criteria:** editing feels polished — hover, snapping, undo/redo, and a clear "editing this feature" affordance.

---

## 6. Parked — not scheduled

Kept for reference; **not** in the current sequence. Revisit only after Phases 1–3 land and there is a concrete driver.

- **Satellite EO pipeline** — admin-triggered async Python worker fetches Sentinel-2/Landsat (later Sentinel-1) for an AOI, computes derived products, publishes COGs as GeoServer coverages (backend design §14, decision #8). The largest single expansion of the system's surface — a new service + worker + coverage publishing. Would need its own full design, and **observability** (structured logging + error tracking across API and worker) as a prerequisite so an async pipeline isn't run blind. Parked at the user's direction until the stakeholder-facing platform (Phases 1–3) is solid. *This is the Research persona's most ambitious future need — when it returns, it belongs to that persona.*

---

## 7. Explicitly out of scope (YAGNI, not on the roadmap)

- Editing GADM base/boundary layers — static reference, no write path, forbidden by design.
- Multi-feature/batch edit — deferred non-goal; revisit only if a concrete need appears.
- Optimistic rendering — the WFS-refetch-after-write pattern stands until refetch latency is a demonstrated problem.
- Public-facing accounts / self-service signup — the platform is admin-managed; no signup flow planned. (Public is anonymous read-only by design.)
- New DB roles — Governance and Research share the `viewer` role as distinct *personas*; adding an enum role is deferred unless enforced permission separation is actually needed.

---

## 8. How to use this doc

- **Picking next work:** take the topmost unblocked item whose prereqs are met. Default order is 1.0 → 1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 2.4/2.5 → 3.1. Phase 3 may be pulled forward if priorities shift; the Parked EO pipeline is out of sequence.
- **Starting an item:** brainstorm it into its own `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, then a plan, then implement. This roadmap only decides order and records why. The §4.4 UI conventions are binding on every persona-facing feature spec.
- **Revising:** this is a living doc. When a phase completes or priorities change, update §1 baseline and re-order. Move shipped items into the baseline; don't leave them in the phase tables.
