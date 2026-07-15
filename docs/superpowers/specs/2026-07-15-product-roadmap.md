# WebAtlas — Product Roadmap (long-term feature planning)

**Date:** 2026-07-15
**Status:** Living document — revise as direction shifts
**Audience:** Developer (dev-sequencing). Terse, technical, dependency-ordered.
**Scope:** Forward-looking plan covering the specs' already-named follow-ons **plus** verified platform gaps. Not a vision doc and not a backlog dump — it names the remaining work, groups it into dependency-ordered phases, and states why each phase precedes the next.

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

Dependency-phased. A feature lands in the earliest phase whose prerequisites are met; phase boundaries mark "you can't sensibly build X before Y." Priority is absorbed into ordering — foundational and high-value work is early. Within a phase, items are independent and may be reordered freely. Phases 3 and 4 depend on nothing in 1–2 and can start early if priorities change; they are later only because 1–2 are higher-value-per-effort.

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

## 4. Phase 2 — Make roles mean something

**Why here:** the role vocabulary is defined but inert. Phase 1's user-management UI is what lets you *assign* editor/viewer, so making those roles do something is only useful once you can hand them out. Editable labels is grouped here because it's the other "control-plane maturity" follow-on and shares the admin-config surface.

| Item | What | Prereq | Notes |
|---|---|---|---|
| **2.1 Editor/viewer semantics** | Give `editor` real editing capability (today only `admin` writes) and `viewer` an authenticated read surface. Extend API `authorize()` beyond admin-only where appropriate; extend frontend `RequireRole` past the admin-only gate. Backend stays the authorization boundary. | 1.1 (assign roles) | Decide per-route which role each write requires; document the matrix. The `RequireRole` UX-only comment discipline (auth foundation §2) still holds. |
| **2.2 Editable attribute labels** | `app.layer_attribute_labels` table + admin GET/PUT API + runtime label fetch. The attribute form swaps its label source from the compile-time `LAYER_ATTRIBUTE_MAP` to the API — **no change to the DB-keyed save path**, so it works for both create and edit. | none (independent) | Named follow-on in draw-create §9 and modify-delete §9. Sits here as control-plane config maturity. |

**Exit criteria:** editor/viewer roles grant distinct, tested capabilities end-to-end; attribute labels are admin-editable at runtime without touching the save path.

---

## 5. Phase 3 — Editing UX depth

**Why here:** pure polish and convenience on top of the now-complete edit loop. Independent of Phases 1–2 — could slot anytime after Part 2 lands — but lower value-per-effort than closing the half-built loops, so it follows. Break into small independent specs; pick opportunistically.

| Item | What | Prereq | Notes |
|---|---|---|---|
| **3.1 Selection/edit polish** | Hover-highlight the hit feature before click; an "editing this feature" chip; vertex **snapping**; **undo/redo**. Optionally disable the rivers-highlight `Select` during edit if `/run` shows interference. | Part 2 | Explicit deferred non-goals from modify-delete §9. Each is its own small spec. |
| **3.2 Data export** | Download a layer (or a selection) as GeoJSON from the viewer. | none | Obvious platform gap — data goes in via editing but has no first-class way out beyond raw WFS. |
| **3.3 Filtering & search** | Attribute filter / feature search over the editable layers in the viewer. | none | Obvious gap once layers hold real, growing data. |

**Exit criteria:** editing feels polished (snapping/undo/hover); users can get data out (export) and find features (search/filter).

---

## 6. Phase 4 — Analytical platform

**Why last:** largest and most speculative, depends on nothing above, and is the biggest single lift in the whole design (backend design §8, §14 — never started). Deliberately deferred until the editable-platform core (Phases 1–3) is solid. Its own prerequisite — observability — is folded in because running an async worker pipeline blind is a mistake.

| Item | What | Prereq | Notes |
|---|---|---|---|
| **4.0 Observability** | Structured logging + error tracking across API and worker. | none | Prerequisite for 4.1: an async pipeline needs to be debuggable. Also retroactively useful for Phases 1–3. |
| **4.1 Satellite EO pipeline** | Admin-triggered async Python worker fetches Sentinel-2/Landsat (later Sentinel-1) for an AOI, computes derived products, publishes COGs as GeoServer coverages. | 4.0; a job/queue mechanism | Backend design §14, decision #8. New service + worker + coverage publishing. The largest expansion of the system's surface. Should get a full design of its own before planning. |

**Exit criteria:** an admin can request EO processing for an AOI and see derived raster products appear as GeoServer coverages, with the pipeline observable end-to-end.

---

## 7. Explicitly out of scope (YAGNI, not on the roadmap)

- Editing GADM base/boundary layers — static reference, no write path, forbidden by design.
- Multi-feature/batch edit — deferred non-goal; revisit only if a concrete need appears.
- Optimistic rendering — the WFS-refetch-after-write pattern stands until refetch latency is a demonstrated problem.
- Public-facing accounts / self-service signup — the platform is admin-managed; no signup flow planned.

---

## 8. How to use this doc

- **Picking next work:** take the topmost unblocked item whose prereqs are met. Default order is 1.0 → 1.1 → 1.2 → 2.x → 3.x → 4.x, but Phase 3/4 items may be pulled forward if priorities shift.
- **Starting an item:** brainstorm it into its own `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, then a plan, then implement. This roadmap only decides order and records why.
- **Revising:** this is a living doc. When a phase completes or priorities change, update §1 baseline and re-order. Move shipped items into the baseline; don't leave them in the phase tables.
