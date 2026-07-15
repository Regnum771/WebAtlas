# Map Performance + Real Dam Status — Design

**Date:** 2026-07-15
**Status:** Approved design — ready for implementation planning
**Scope:** Two coupled threads in the map layer: (1) eliminate per-feature-per-frame OpenLayers `Style` allocation via caching, and (2) make the DB the source of truth for dam operational status (canonical slugs), seeding all dams and driving the map style + popup + legend + reservoir filter from one shared slug→{label,color} map.

---

## 1. Context & goal

The map (`apps/web/src/features/map/model/`) renders 7 WFS thematic layers + 2 GADM base layers. Two problems motivate this work:

- **Per-frame allocation:** every style function in `styles.ts` (`riversStyle`, `provincesStyle`, `wardsStyle`, `makeDamsStyle`, `makeRiverSelectStyle`) calls `new Style(...)`/`new Stroke(...)`/`new Fill(...)`/`new CircleStyle(...)` for **every feature on every redraw**. With rivers (~2013 features) and wards (thousands), pan/zoom triggers tens of thousands of allocations per frame → GC churn and jank.
- **Fabricated dam status:** `makeDamsStyle` derives each dam's status from `id % 5`/`id % 3` at style time and writes it back with `feature.set('operationalStatus', ...)` — a per-frame side effect that also ignores the real DB-backed `status` column (which is **NULL for all 371 seeded dams**, because the dams seed never populated it). Three status vocabularies are scattered across the code with no single source of truth: DB slugs, Vietnamese display strings (`'Nguy hiểm'` etc.), and the reservoir filter's slug keys (`nguy_hiem` etc.).

**Goal:** the map renders with the same visual *vocabulary* (dams still show a red/amber/green spread by status; rivers/wards/provinces unchanged) but (a) styles are cached instead of re-allocated per frame, and (b) dam status is sourced from real DB data through one shared slug→{label,color} map consumed by the style, popup, legend, and filter. Note: the *specific* dams that are red/amber/green will change, because status becomes real seeded data rather than an `id%` formula.

### Non-goals (deferred, YAGNI)

- **WFS loading optimization** (bbox strategy / server-side simplification / `maxFeatures`) — separate concern, separate spec.
- **Bundle splitting / lazy-loading the map** (the 635 kB chunk warning) — separate concern.
- **Real status for the other 6 layers** — this spec only makes `dams` status real; stations/drought/saltwater already carry real (free-text) `status` from their seeds and are untouched.
- **Editable status labels** at runtime — the slug→label map stays a compile-time constant.

---

## 2. Canonical decisions (locked)

- **Canonical stored value = slug.** `dams.status` in the DB holds `'binh_thuong' | 'xa_lu' | 'nguy_hiem'`. This matches what the reservoir filter already uses and what the Plan 7 admin form already submits. Display strings and colors are pure presentation, derived on the frontend.
- **Seed assignment = deterministic random.** The dam seed has no source status field, so it assigns one per dam using a **deterministic** hash of `external_id` into a weighted distribution (majority `binh_thuong`, minority `xa_lu`/`nguy_hiem`). Deterministic so the `ON CONFLICT` upsert re-seed stays reproducible (INV: seeds are idempotent/re-run-stable).
- **Null status → `binh_thuong`.** Any dam with a null/absent/unknown status renders and reports as normal (the safe default).

---

## 3. Architecture — components

### A. Shared status vocabulary — `packages/shared/src/dam-status.ts` (new)

One source of truth, pure and OL-free:

```ts
export const DAM_STATUS_SLUGS = ['binh_thuong', 'xa_lu', 'nguy_hiem'] as const;
export type DamStatusSlug = (typeof DAM_STATUS_SLUGS)[number];

export interface DamStatusDisplay { label: string; color: string; }

export const DAM_STATUS_DISPLAY: Record<DamStatusSlug, DamStatusDisplay> = {
  binh_thuong: { label: 'Bình thường', color: '#10b981' },
  xa_lu:       { label: 'Xả lũ',       color: '#f59e0b' },
  nguy_hiem:   { label: 'Nguy hiểm',   color: '#ef4444' },
};

// Coerce any DB/user value to a known slug (null/unknown -> binh_thuong).
export function toDamStatusSlug(v: unknown): DamStatusSlug;
// Convenience: slug -> display (label + color), with the safe default.
export function damStatusDisplay(v: unknown): DamStatusDisplay;
```

Exported from the shared barrel; `dist` rebuilt and committed (consumers import from `dist`).

### B. Seed — `apps/api/src/db/seeds/registry.ts` (modify dams entry)

Add `status` to the dams `columns` mapper, assigned deterministically from `external_id`:

```ts
columns: (p) => ({
  external_id: p.ID,
  name: p.Vietnamese,
  // …existing…
  status: assignDamStatus(p.ID),   // -> 'binh_thuong' | 'xa_lu' | 'nguy_hiem'
});
```

`assignDamStatus(externalId)` is a small deterministic function (stable hash of the id → weighted bucket). It lives in the seed module (or a tiny helper it imports) and uses `DAM_STATUS_SLUGS` from shared so the vocabulary can't drift. Re-seeding produces identical statuses.

### C. WFS load-time status — `apps/web/src/features/map/model/wfsSource.ts` (modify)

In the existing `featuresloadend` normalization, for the dams layer set the display status **once** from the DB slug:

- After ISO normalization, dams carry `operationalStatus` = the **label** for `toDamStatusSlug(dbStatus)` (so the popup's existing label display keeps working), and also retain the raw slug (e.g. as `statusSlug`) for the style/filter to compare against without re-deriving.
- This removes the need for `feature.set()` inside the style function.
- Null/absent status → `binh_thuong` label + slug.

(Only the dams source needs this; other layers are unchanged.)

### D. Style caching — `apps/web/src/features/map/model/styles.ts` (modify)

- **Rivers:** precompute the 4 stream-order-bucket `Style[]` arrays at module scope; `riversStyle` returns the cached array for the feature's bucket. `makeRiverSelectStyle` likewise returns cached highlight arrays per bucket.
- **Dams:** `makeDamsStyle` no longer computes/writes status or does id math. It reads the pre-computed `statusSlug` (component C) → color via `DAM_STATUS_DISPLAY`, computes the radius from `ratedPower`, and returns a **cached** `CircleStyle` keyed by `${slug}|${roundedRadius}` (radius rounded to integer px, its natural granularity). The reservoir filter compares the slug directly (`currentFilter === statusSlug`), no label round-trip.
- **Provinces:** memoize the computed largest-polygon interior-point label geometry on the feature (`feature.get('_labelGeom') ?? compute-and-set`) so the area loop runs once per feature, not per frame.
- **Wards:** style is already close to minimal (one `Style` per feature); cache by the hashed hue bucket to avoid re-allocating identical styles across the thousands of features. (Lower priority; include if clean.)

### E. Popup + legend + filter — `apps/web/src/components/DynamicPopup.tsx`, `DynamicLegend.tsx` (modify)

- `DynamicPopup`: replace the hardcoded `props.operationalStatus === 'Nguy hiểm' ? … ` color logic with `damStatusDisplay(props.statusSlug ?? props.operationalStatus)` → `{label, color}`. The reservoir-filter buttons already use slugs and stay as-is.
- `DynamicLegend`: the three hardcoded label/color rows read from `DAM_STATUS_DISPLAY` (single source), so legend, map, and popup can never disagree.

---

## 4. Data flow

1. **Seed** writes `dams.status` = deterministic slug for all 371 dams (+ any admin-created dams already store slugs).
2. **WFS** serves dams with the `status` slug; `wfsSource.featuresloadend` stamps `statusSlug` + `operationalStatus` (label) once per feature.
3. **Style** reads `statusSlug` → cached `CircleStyle` (color from shared map, radius from `ratedPower`); reservoir filter compares slugs. No per-frame allocation, no `feature.set`.
4. **Popup/legend** render label + color from the shared map.

Result: the dams show a red/amber/green spread (a different specific assignment than today's `id%`-based one, since the seed distributes randomly-but-deterministically), now driven by real DB data through one vocabulary, and pan/zoom allocates no styles.

---

## 5. Error handling / edge cases

- Unknown/null/malformed `status` → `binh_thuong` (via `toDamStatusSlug`). No throw, no blank marker.
- A dam with null `ratedPower` → radius uses the existing `|| 50` default (unchanged).
- Cache keys are bounded: rivers 4 buckets; dams `3 slugs × ~13 integer radii` ≈ 40 objects max; provinces/wards memoize per feature. No unbounded growth.

---

## 6. Testing

- **Shared (`dam-status.test.ts`):** all 3 slugs present; `DAM_STATUS_DISPLAY` has a label+color for each; `toDamStatusSlug` coerces known slugs, and maps null/unknown/`'Bình thường'`-ish input → `binh_thuong`; `damStatusDisplay` returns the right pair.
- **Seed (`seed.test.ts` or a focused unit):** `assignDamStatus` is deterministic (same id → same slug across calls) and the assignment across a representative id range yields all 3 slugs (variety preserved).
- **styles.ts:** focused unit tests where practical — same input feature → **same `Style` object reference** (proves caching); a dam with `statusSlug='nguy_hiem'` → style fill color `#ef4444`; reservoir filter returns `undefined` (hidden) for a non-matching slug. (These functions take `any`; tests build minimal fake features with `get()`.)
- **`/run` (visual, needs the stack):** dams render the same red/amber/green spread from real data; popup shows correct status label + color; legend matches; reservoir filter buttons work; pan/zoom is visibly smoother (no per-frame allocation). Re-seed first so the 371 dams have statuses.

---

## 7. Convention / scope rules

1. OpenLayers stays quarantined to `features/map/model/`; `dam-status.ts` is OL-free shared code (no `ol/*`).
2. The slug→{label,color} map is the **single** source; no component may re-hardcode a status string/color after this change (popup, legend, style all read the map).
3. `@webatlas/shared` `dist` is rebuilt and committed after editing `src`.
4. Seed stays idempotent/re-run-stable (deterministic assignment).
5. Scope is style-caching + dam-status-as-real-data only — no WFS-loading or bundle changes.

---

## 8. Rollout notes

- New branch off `main` (not the Plan 7 PR branch). Its own plan → implementation.
- Applying real statuses to the 371 existing dams requires **re-running the seed** against the live DB (`npm run seed`). The code + unit tests do not need the stack; the visual `/run` verification does.
- No schema migration: `dams.status` column already exists (nullable); this only starts populating it.

---

## 9. Follow-on (out of scope here)

- WFS bbox/zoom-gated loading + server-side geometry simplification for rivers/wards.
- Map bundle code-splitting (OpenLayers is the bulk of the 635 kB chunk).
- Real, curated (non-random) dam statuses if/when authoritative data exists — the pipeline built here (slug column + shared map) accepts them with no code change.
