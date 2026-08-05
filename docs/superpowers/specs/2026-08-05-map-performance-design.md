# Map Load Performance — Measure, Then Optimize

**Date:** 2026-08-05
**Status:** Approved design
**Predecessor:** [2026-07-15-map-perf-and-real-dam-status-design.md](./2026-07-15-map-perf-and-real-dam-status-design.md), which optimized *style allocation* and explicitly deferred "WFS bbox strategy / zoom-gated loading" to a separate spec (§ Out of scope, line 20). This is that spec.

## 1. Problem

The map loads eagerly and globally. Every vector source fetches its entire national
extent when the map initializes, regardless of the viewport or of zoom gates that hide
the layer anyway.

Static file sizes are exact (measured on disk, `feat/region-scoping-osm-water`). The
rivers/lakes figures come from the **seed GeoJSON files**, which stand in for the WFS
response — the wire payload will differ, since GeoServer emits its own property naming
and formatting. Establishing the real WFS numbers is the harness's first job (§4.1).

| Source | Size | Features / vertices | Loaded when |
|---|---|---|---|
| `wards-region.geojson` | 6.9 MB (exact) | — | Map init, though it renders only at zoom ≥ 10 |
| Rivers (WFS) | ~18 MB (seed proxy) | 9,486 / 675,151 | Map init, unbounded extent |
| Lakes (WFS) | ~4.7 MB (seed proxy) | 3,868 / 169,840 | Map init, unbounded extent |
| `provinces-34.geojson` | 1.2 MB (exact) | — | Map init |
| `thuyhe.geojson` | 5.3 MB (exact) | — | Never — dead file, zero references |

Three structural causes:

1. **No loading strategy.** `createWfsVectorSource` builds a `VectorSource` with a bare
   `url` string and no `strategy`, so OpenLayers loads everything on first render.
2. **Zoom gates render, but do not gate loading.** `MapModel.init()` fetches the wards
   file immediately; `recomputeVisibility()` only decides whether to *draw* it.
3. **Post-load mutation over every feature.** The `featuresloadend` handler unsets and
   re-sets properties on each loaded feature — main-thread churn across ~13k features.

Style allocation is *not* a current bottleneck: the predecessor spec already cached the
river, dam, and select styles. The remaining cost is transfer and parse.

## 2. Goal

Cut the bytes and main-thread work on the critical path to first usable map, without
changing the layer model, the visual output, or the admin editing flows.

Every optimization must be justified by a before/after number from the same harness.

## 3. Approach

Two phases with a hard dependency: **measure, then optimize.**

Rejected alternatives:

- **Vector tiles (MVT).** Best raw performance and scales indefinitely, but features are
  clipped per tile, which breaks the `Select`/`Modify`/`Draw` controllers that admin
  editing depends on. Too large a change for the gain available from bbox loading.
- **`ST_Simplify` on stored geometry.** Cheapest to ship, but it is a one-time win that
  degrades the data for every consumer and does not scale as coverage grows.

## 4. Components

Three components change. Everything else — styles, the edit controllers, the layer
registry, the API, GeoServer configuration — is untouched.

### 4.1 Profiling harness (new)

`apps/web/scripts/profile-map.mjs`, driving system Chrome via `puppeteer-core` (the
established workaround for this project). Committed and run on demand; **not** wired
into CI.

It runs a fixed scenario so runs are comparable:

```
cold load at MIN_ZOOM → settle → scripted pan → zoom to 10 → settle
```

It captures per-request transfer bytes grouped by layer, time to first render,
main-thread long tasks, and frame timings during the pan. Output is a JSON file plus a
short printed table. The harness knows nothing about the fixes — it only measures, which
is what makes the rest falsifiable.

### 4.2 `wfsSource.ts` — bbox loading

`createWfsVectorSource` switches from a static `url` string to a `url(extent)` function
plus `strategy: bboxStrategy`, adding a WFS `bbox` parameter in EPSG:3857. Its contract
to callers is unchanged: it still returns a `VectorSource` for a layer key. Only *when*
it fetches changes.

Two consequences must be handled deliberately:

- **Normalization now runs per extent fetch, not once.** The handler currently falls back
  to iterating `source.getFeatures()`, which would re-normalize every previously loaded
  feature on every pan. It must process only `evt.features` and be **idempotent** — safe
  if the same feature is seen twice.
- **`refreshLayer()`** calls `source.refresh()`, which under a bbox strategy clears and
  refetches the current extent. Still correct for the post-edit refresh, but it needs an
  explicit test.

### 4.3 `MapModel.ts` — zoom-gated wards load

OpenLayers' `setMinZoom`/`setMaxZoom` stop a layer *rendering*, but a source with a `url`
still fetches. So the gate must sit at the source level: the wards layer is constructed
with a source that has no URL, and the fetch is triggered on the first `moveend` at
zoom ≥ 10, then never again.

The existing `recomputeVisibility()` keeps owning render visibility unchanged. This adds
a **load** gate beside it; it does not replace the render gate.

### 4.4 Delete `apps/web/public/thuyhe.geojson`

5.3 MB, tracked in git, superseded by the OSM rivers layer. Verified safe:

- No import, fetch, or path reference anywhere in `apps/web/src`.
- Surviving repo references are historical plan/spec documents, plus tests in
  `seed.test.ts` that *assert its absence*.
- The `'thuyhe.geojson'` string in `apps/api/scripts/prune-hydrosheds-versions.mjs` is a
  database `source` value, not a file path. **It stays.**
- The copy under `apps/web/dist/` is git-ignored build output and regenerates.

## 5. Data flow

Map init creates the **WFS and wards sources empty**. (`provinces-34.geojson` still loads
eagerly at init — it is small, always visible at every zoom, and out of scope here.)

First render resolves the viewport extent; each bbox source requests only that extent;
arriving features pass through the idempotent normalizer that stamps ISO property names;
styles render.

Panning requests only newly-uncovered extents — OpenLayers tracks what it already holds.
Crossing zoom 10 upward triggers the one-time wards fetch.

## 6. Error handling

A failed extent fetch currently fails silently. Under bbox loading there are many more
requests, so a transient failure is likelier and leaves a visible hole in the map.

Each source gets a `featuresloaderror` handler that logs the layer key and the failed
extent.

We deliberately add **no** retry logic and **no** user-facing error UI. That is a
behavioral change beyond a performance fix and deserves its own decision.

## 7. Testing

**Regression signal.** The existing suites must pass unchanged — especially
`styles.test.ts`, `boundaries.test.ts`, and the `Draw`/`Modify`/`Select` controller
tests, which cover the admin editing flows most at risk from bbox loading.

Note `boundaries.test.ts` asserts a *ceiling* on the wards file size (< 20 MB); lazy
loading does not affect it.

**New unit tests.**

- The bbox URL builder emits a correct `bbox` parameter for a given extent.
- The normalizer is idempotent — a feature processed twice yields identical properties.
- The wards load gate fires exactly once across repeated crossings of zoom 10.

**Numeric evidence.** Supplied separately by the harness (§4.1), as a before/after table.

## 8. Success criteria

- Initial transfer drops substantially against the measured baseline.
- Time to first render improves against the measured baseline.
- Admin create/edit/delete and the rivers click-highlight still work.
- All existing tests pass.

## 9. Out of scope

- Vector tiles (MVT).
- `ST_Simplify` or any geometry simplification, server- or build-side.
- Simplifying `provinces-34.geojson` / `wards-region.geojson`.
- Moving boundary files into PostGIS to serve them via WFS.
- Retry logic or user-facing load-error UI.
- A CI byte-budget gate.
- **Wards style caching.** The predecessor spec (§ Component B) flagged `wardsStyle` as
  the one uncached style function, "lower priority; include if clean." It remains
  uncached. Still a valid follow-up, but this spec targets transfer, not allocation.
