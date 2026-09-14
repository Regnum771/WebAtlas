# Horizontal Toolbar, Zoom Slider, and Zoom-Based Level of Detail — Design

**Date:** 2026-09-08
**Status:** Approved design — ready for implementation planning
**Branch:** builds on `feat/map-assistant`
**Scope:** Move the map toolbar to a horizontal floating bar, add a notched zoom slider, and make four context layers thin out as the map zooms out.

## Problem

Three things, asked together because they are all "the map is hard to read and hard to drive":

1. **The toolbar is a vertical rail on the right.** It was placed there by Plan A. A horizontal bar at the bottom is the conventional position for map controls and leaves the right edge free.
2. **There is no zoom slider.** Zoom is two buttons. `zoomScale.ts` already carries a constant named `ZOOM_SCALE_LEVELS` whose comment reads *"Các nấc tỷ lệ tròn số cho slider zoom"* — the slider was anticipated and never built.
3. **Four context layers render every feature at every scale.** At 1:7.500.000 the map draws all 510,000 road segments and all 9,486 river segments, most of which are invisible at that scale and serve only to slow rendering and clutter the picture.

## The finding that shapes this design

**The four layers are rendered by two different mechanisms, and only one of them can be filtered in the browser.**

| Layer | Rendering | Where LOD must live |
|---|---|---|
| Mạng lưới sông ngòi | Vector, WFS → `VectorLayer`, styled by `riversStyle` | Client-side style function |
| Giao thông đường bộ | **Pre-rendered raster tiles** from GWC (`TileLayer<XYZ>`, layer group `webatlas:basemap_roads`) | GeoServer SLD |
| Đường sắt | Same | GeoServer SLD |
| Mặt nước nền | Same | GeoServer SLD |

A rendered raster tile cannot be filtered client-side — the features are already pixels. So the three basemap layers need scale-dependent rules (`MinScaleDenominator` / `MaxScaleDenominator`) inside a GeoServer style, and **`apps/api/src/geoserver/` has no style or SLD handling at all today** (only `client.ts` and `publish.ts`, neither of which mentions styles). That is a new capability, not a parameter change.

It also means a cache step that is easy to forget: every tile currently in GWC was rendered under the old style. Changing the style without truncating the cache leaves the old tiles serving indefinitely.

**The data supports the split well.** `roads_region.fclass` carries the full OSM highway hierarchy, distributed very unevenly:

| fclass | rows |
|---|---|
| residential | 304,700 |
| track | 79,352 |
| service | 76,806 |
| unclassified | 21,262 |
| tertiary | 9,405 |
| secondary | 5,108 |
| trunk | 3,729 |
| primary | 3,475 |

Roughly 460,000 of ~510,000 rows are minor roads. Drawing only trunk and primary when zoomed out removes about 90% of the rendered geometry — this is a performance change as much as a cartographic one.

## Goals

1. A horizontal toolbar that does not fight the docked flyout.
2. A zoom slider whose every position is a round scale a surveyor recognises.
3. Four layers whose detail follows the scale, without a second rendering path or a second source of truth for "what is visible".
4. The command-layer discipline preserved: the slider issues a `MapCommand` like every other control.

## Non-goals

- **No change to what the WFS downloads.** River LOD is display-only in this work; see "Display LOD, not load LOD" below.
- **No new zoom bounds.** `MIN_SCALE` 1:7.500.000 and `MAX_SCALE` 1:100.000 are unchanged.
- **No responsive redesign.** The app's documented minimum viewport (~768px) is unchanged; the toolbar must simply not overflow it.
- **No change to the layers panel, legend, or assistant.**

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Slider snapping | The 8 existing `ZOOM_SCALE_LEVELS` stops | User's choice. Matches what the +/- buttons already step through; a native `<input type="range" step="1">` over 8 indices does the snapping for free |
| Toolbar placement | Floating pill over the map area | User's choice. No collision with the full-height docked flyout, map stays full-bleed |
| Overflow behaviour | `flex-wrap` to a second row | With the flyout open at 768px the map area is ~400px; a single-row pill would overflow. Wrapping is two lines of CSS and cannot overflow |
| Wheel zoom | Continuous **while moving**, snaps to the nearest 1.000 of the scale denominator **once it settles** | User's choice. Keeps the wheel smooth — a notched wheel feels broken — while guaranteeing the readout always lands on a clean number (1:1.247.000, never 1:1.247.331). The correction is at most 500 in the denominator, imperceptible on screen even at the coarse end |
| Slider command | Reuses the existing `zoomTo` `MapCommand` | Already in the shared contract; no contract change needed |
| River LOD keying | The existing `riverBucket` buckets, not raw `stream_order` | `styles.ts` already reduces the OSM class to 4 buckets; keying LOD to the same buckets keeps one classification, not two |
| Raster LOD keying | `fclass` in the SLD | The only classification the raster layers have |

## Phase 1 — Frontend

### The toolbar

`MapToolbar` keeps its container / passive-view split (`MapToolbarView` stays passive, the container turns callbacks into `MapCommand`s). Only layout and the new slider change. Contents, left to right:

```
[ ✋ 📏 ⬛ ]  [ ⊖ ──────●──── ⊕ ]  [ 1:250.000 ]  [ ⌂ ]  [ 🗺 🛰 ⛰ ]
  chế độ          thu phóng          tỷ lệ      về vùng    nền
```

`.map-toolbar` moves from `top / right` column to a bottom-centred row over the map area: `bottom`, `left: calc(var(--rail-width) + flyout offset)`, `transform: translateX(-50%)`, `flex-direction: row`, `flex-wrap: wrap`. It must clear the flyout when open and re-centre when closed.

### The slider

A native range input over the eight stops:

```tsx
<input type="range" min={0} max={ZOOM_SCALE_LEVELS.length - 1} step={1} value={nearestStopIndex} />
```

- **Direction:** index 0 = 1:7.500.000 (zoomed out, left), index 7 = 1:100.000 (zoomed in, right).
- **Outward:** on change, emit `{ kind: 'zoomTo', zoom: zoomForScale(ZOOM_SCALE_LEVELS[i]) }`.
- **Inward:** the handle position follows the map via `useMapZoom` → nearest stop. The scale label continues to show the *true* scale from `scaleAtZoom`, not the stop's scale.

`nearestStopIndex` already exists in `MapToolbar` for the +/- buttons. It moves into `zoomScale.ts` as an exported pure function so the slider and the buttons share one definition and it can be tested without a map.

### Settle-snap on free zoom

The wheel, pinch, double-click and keyboard zooms all stay continuous while the user is acting. When the view **settles**, the scale denominator is rounded to the nearest 1.000 and the view is corrected to match.

- **Hook:** OpenLayers' `moveend` on the view. It fires after any interaction *and* after programmatic animations, which is what makes one hook cover every zoom path rather than special-casing the wheel.
- **The correction:** `snapScaleToNearestThousand(scale)` → `Math.round(scale / 1000) * 1000`, clamped to `[MAX_SCALE, MIN_SCALE]`, converted back with `zoomForScale`. A new pure function in `zoomScale.ts`.
- **Loop guard, and it is load-bearing.** Setting the zoom in a `moveend` handler triggers another `moveend`. The handler must return without touching the view when the current scale is already within half a thousand of its snapped value, so the second pass is a no-op and the cycle terminates. Without this the map oscillates.
- **No animation.** The correction is applied directly, not with `animate()` — at most a 500-unit change in the denominator it is invisible, and animating it would both look like a twitch and stretch the loop-guard window.
- **Panning is unaffected.** A pan fires `moveend` with an unchanged scale, so the guard makes it a no-op.

**The two snappings do not fight.** Every value in `ZOOM_SCALE_LEVELS` (7.500.000 · 5.000.000 · 3.000.000 · 1.750.000 · 1.000.000 · 500.000 · 250.000 · 100.000) is already a multiple of 1.000, so a slider-driven or button-driven zoom settles on a value the wheel-snap leaves untouched. That is a property worth asserting in a test, because it stops holding the moment someone adds a stop like 1.250.500.

**What the user sees between stops.** The readout always shows a clean thousand; the slider handle shows the *nearest of the eight stops*, which after a free zoom is usually not where the map is. That gap is inherent to having a coarse slider over a continuous map, and is the behaviour you asked for — the handle is an approximate position indicator, the number is the truth.

### River LOD

`riversStyle` currently ignores the second argument OpenLayers passes to every style function. Taking `resolution` and returning `null` for buckets below the threshold hides those features with no extra state, no new layer, and no change to loading:

Thresholds are written as **scale-denominator ranges** to avoid the "larger scale" trap: 1:100.000 is the *larger* scale despite the smaller number, so throughout this document a **bigger denominator means more zoomed out**.

| Denominator range | Buckets drawn |
|---|---|
| ≥ 1.000.000 (most zoomed out) | 3 — sông chính |
| 500.000 – 999.999 | 3, 2 — + kênh đào |
| 250.000 – 499.999 | 3, 2, 1 — + suối |
| < 250.000 (most zoomed in) | all — + mương, chưa xác định |

Note this sits *above* the existing `minZoom: 8.5` gate in `LAYER_DISPLAY`: below that zoom the layer does not load at all, so LOD only governs behaviour above it.

**Display LOD, not load LOD.** Hidden features are still fetched over WFS. Cutting the download would mean a `CQL_FILTER` on the WFS request, which interacts with the bbox loading strategy and the zoom gate; it is deliberately out of scope. Rendering gets lighter, network does not.

## Phase 2 — Raster LOD

New capability in `apps/api/src/geoserver/`:

1. **SLD generation** — one style per basemap layer group, with `<Rule>` elements carrying `MinScaleDenominator` / `MaxScaleDenominator` and an `fclass` filter.
2. **Upload and assignment** — through the existing REST client: create/update the style, then set it as the layer's default.
3. **GWC truncate** — invalidate the cached tiles for each affected layer group. Without this, the visible map does not change no matter how correct the SLD is.

Provisional thresholds (see "Provisional" below):

Denominator ranges as above — bigger means more zoomed out.

| Layer | ≥ 1.000.000 | 500.000–999.999 | 250.000–499.999 | < 250.000 |
|---|---|---|---|---|
| Giao thông đường bộ | motorway, trunk, primary | + secondary | + tertiary, unclassified | + residential, service, track, footway, path |
| Đường sắt | all (only a few thousand rows) | all | all | all |
| Mặt nước nền | water, reservoir, riverbank | same | + wetland, wetland_marsh, wetland_mangrove | same |

`fclass` values above are taken from the live database. Any value not named in a rule is **not drawn at that scale** — so a class that appears in the data later (an OSM import adding `living_street`, say) is invisible until it is added to the rules. The publish step should fail loudly on an unmapped `fclass` rather than silently dropping it.

## Testing

The pattern that has worked on this branch — extract the decision as a pure function, test it without a browser or a live service — applies to both halves:

- **`nearestStopIndex(zoom)`** and the index↔scale mapping: unit tests, no map. Includes the boundary cases (below `MIN_ZOOM`, above `MAX_ZOOM`, exactly on a stop, midway between two).
- **`snapScaleToNearestThousand(scale)`**: rounds up and down, is idempotent (snapping an already-snapped value changes nothing — the property the loop guard depends on), and clamps at both `MIN_SCALE` and `MAX_SCALE` rather than snapping past them.
- **The two snappings agree**: assert every entry in `ZOOM_SCALE_LEVELS` is unchanged by `snapScaleToNearestThousand`. This is the test that fails the day someone adds a stop that is not a multiple of 1.000, which would otherwise show up only as a slider that drifts off its own notch after settling.
- **The loop guard**: a fake view whose `moveend` handler is invoked twice must issue at most one correction — the regression test for an oscillating map.
- **River bucket threshold** as `riverBucketsVisibleAt(resolution)`: unit tests asserting the table above, including that the coarsest scale never hides bucket 3 and the finest hides nothing.
- **`MapToolbarView`**: render tests in the existing passive-view style — the slider reports the index it was moved to, the buttons still report their actions, and the view renders at a narrow width without overflowing.
- **Container**: asserts the slider emits `zoomTo` with the zoom for the selected stop, through `createCommandExecutor` like every other control.
- **SLD generation**: assert the produced XML contains the expected scale rules and `fclass` filters per layer — a pure string-in/string-out test needing no GeoServer.
- **GWC truncate**: assert the publish flow issues the truncate call for each changed layer group. This is the step whose omission is invisible until someone wonders why the map looks the same.

## Provisional — expect these to change

**The scale thresholds in both phases are proposals, not derived from cartographic standards.** They are one line each to adjust and should be reviewed by someone who knows the domain. Getting them wrong is a visual annoyance, not a defect.

**The settle-snap tolerance.** Rounding to the nearest 1.000 is uniform across the whole range, so at 1:100.000 it is a 1% grid and at 1:7.500.000 a 0.013% one — the correction is proportionally much coarser when zoomed in. If 1:100.000-to-1:101.000 steps ever feel chunky, a proportional grid (round to 3 significant figures, say) is a one-line change to `snapScaleToNearestThousand`. Starting uniform because it is what was asked for and it is predictable.

## Risks

| Risk | Standing |
|---|---|
| GWC truncate forgotten or partial → the map looks unchanged and the SLD is blamed | Mitigated by a test asserting the call, and by naming it explicitly in phase 2's steps |
| Toolbar overflows at 768px with the flyout open | Mitigated by `flex-wrap`; a render test at narrow width guards it |
| Settle-snap oscillates — the correction re-triggers `moveend` forever | The one genuine failure mode here. Mitigated by the idempotence guard and its two-invocation test; a map that jitters after every wheel stop is the symptom to look for |
| Raster thresholds hide something operationally important (a road someone needs) | Accepted: reviewable, one line per class, and reversible without a data change |
| Phase 2 slips | Accepted by design — phase 1 ships independently and is what was asked for first |

## Phasing

Frontend first, so the toolbar, slider and river LOD are usable before the SLD work begins:

1. Toolbar layout — horizontal floating pill, existing controls, no behaviour change.
2. Zoom slider — shared `nearestStopIndex`, `zoomTo` emission, two-way binding.
3. Settle-snap — `snapScaleToNearestThousand` plus the `moveend` hook and its loop guard. Separate from step 2 deliberately: it touches the map view's event wiring rather than the toolbar, and it is the step with a real failure mode worth reviewing on its own.
4. River LOD — resolution-aware `riversStyle`.
5. SLD generation and assignment for the three raster layers.
6. GWC truncate wired into the publish flow.
