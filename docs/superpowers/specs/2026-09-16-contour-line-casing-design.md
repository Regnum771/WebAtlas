# Contour Line Casing — Design

**Goal:** Make contour lines readable over the satellite basemap, without growing the GWC
tile cache and without teaching the client anything about basemaps.

**Status:** Design approved 2026-09-16. Follows the terrain-contours work
([plan](../plans/2026-09-15-terrain-contours.md)) on `feat/terrain-contours`.

## The problem

Contours ship in three intervals (250 / 100 / 50 m), each with a plain and a labelled
style, drawn over street, satellite and dem. Over **satellite imagery the lines are
effectively invisible** — dark, busy photography swallows a 0.5 px brown stroke at 0.7
opacity. Street and dem read fine; satellite is the only broken case.

The labels, however, stay readable over the same imagery. That is not luck: the
`TextSymbolizer` is the one element in the SLD carrying a white halo
(`<Halo><Radius>1.5</Radius>` over `#6B4E26`). The treatment that fixes this is already
present in the file and already proven on screen — the lines simply never got it.

## Approach

Give the lines the same thing the labels have: a **white casing** — a wider, semi-transparent
white stroke laid down beneath the brown one.

This was chosen over the alternative of per-basemap styles (which `styles.py`'s docstring
already, falsely, describes as existing). Per-basemap would mean two extra styles,
12 GWC tile sets instead of 6, and new basemap→style wiring in `MapModel`, which currently
ignores basemap changes for this layer. A casing fixes the one broken basemap at zero cache
cost and zero client change, and is near-invisible against the light street basemap. It does
not foreclose per-basemap colour later if satellite ever wants its own hue.

A client-side CSS filter on the tile layer was also considered and rejected: it brightens the
whole raster indiscriminately, labels and halos included, and cannot treat index and
non-index lines differently.

## The load-bearing detail: two FeatureTypeStyles, not two symbolizers

The obvious implementation is wrong. Adding a white `<LineSymbolizer>` above the brown one
**inside each existing `<Rule>`** produces a visible defect.

GeoServer renders feature-by-feature within a single `<FeatureTypeStyle>`: feature A's
casing, then A's line, then feature B's casing, then B's line. Where contours run close
together — which is precisely where terrain is steep, so: constantly — feature B's white
casing overdraws feature A's brown line. The result is contours with chunks bitten out of
them, worst in exactly the areas the layer exists to describe.

The correct form is the standard GeoServer cased-line idiom: **two `<FeatureTypeStyle>`
blocks**. GeoServer completes each FTS across all features before beginning the next, so
every casing is laid down before any brown line is drawn.

## Structure

```
FTS 1 — casings   Rule is_index=false → #FFFFFF, width 2.0, opacity 0.45
                  Rule is_index=true  → #FFFFFF, width 2.6, opacity 0.55

FTS 2 — lines     Rule is_index=false → #9C7A4F, width 0.5, opacity 0.7   (unchanged)
                  Rule is_index=true  → #8A6534, width 1.1                (unchanged)
                  Rule labels          → appended in LABELLED only        (unchanged)
```

Casing width is line width + 1.5, i.e. 0.75 px of white on each side, matching the label
halo's 1.5 radius so the layer reads as one treatment.

**The brown strokes are deliberately untouched.** The casing is the only new variable, so if
the result looks wrong on screen there is exactly one thing to adjust.

## Scope

- **`apps/api/scripts/contours/styles.py`** — `PLAIN` gains the casing FTS.
  - `LABELLED` needs no change. It is derived from `PLAIN` by replacing the trailing
    `</FeatureTypeStyle></UserStyle></NamedLayer>`, which still anchors to the *last* FTS —
    so the label rule lands in FTS 2, on top, exactly as it does today.
  - **The module docstring is currently false** and must be rewritten. It claims *"Colour is
    chosen per basemap by the client (it requests a different style), so these are neutral
    browns that read on both street and satellite."* No such per-basemap styles exist, and
    after this change the mechanism is a casing, not a colour choice. Say what the casing is
    and why one style serves all three basemaps.

- **`apps/api/scripts/contours/styles.py`, second change** — write each SLD to
  `<name>.sld` on disk as a side effect of uploading, and commit the two artifacts.
  This adopts the existing precedent from `scripts/basemap/styles.py`, which does exactly
  this so that `apps/api/src/geoserver/basemapStyles.test.ts` can assert against committed
  artifacts without needing Python or a live GeoServer in the test run. The contours
  generator currently only POSTs its SLDs, leaving nothing to test against. A committed
  `.sld` also makes style changes visible in review diffs, which this change is itself an
  argument for.

- **`apps/api/src/geoserver/contourStyles.test.ts`** — new, following
  `basemapStyles.test.ts` but with no database: these assertions are pure text over the
  artifacts.

- **Nothing else.** No change to `packages/shared`, no change to `apps/web`, no new style
  names, no `contourStyle()` signature change, no `MapModel` change, no GWC cache growth.

## Verification

Unit tests cannot see pixels, so the checks split in two.

**Automated** — over the committed `.sld` artifacts, assert that each style has two
`<FeatureTypeStyle>` blocks and that the casing block precedes the line block. This is cheap
and it catches the one regression that matters: a future edit collapsing back to the
single-FTS form, which would look correct in the file and wrong only on rendered tiles where
nobody is watching. Assert too that `contours_labelled` still carries its `TextSymbolizer` in
the *second* FTS, since that placement is a side effect of the string-replace derivation and
would break silently if the trailing anchor ever moved.

**On screen** — run the app and look at two basemaps, not one:
- **satellite**, to confirm the lines are now readable;
- **street**, to confirm the casing has not turned the light basemap into a mesh of white
  ribbons. This is the failure mode of the approach and the reason opacity starts at 0.45 /
  0.55 rather than the label halo's opaque white.

**Re-running `styles.py` is not enough to see the change.** Per the terrain-contours plan's
global constraints: changing a style does not invalidate cached tiles. Truncate GWC for the
three contour layers, or you will keep looking at the old render and concluding the casing
did not work.
