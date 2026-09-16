#!/usr/bin/env python3
"""Generate and upload the contour SLDs. Companion to publish-contours.sh.

Two styles per interval: plain, and labelled. Labels are a separate STYLE rather than a
toggle inside one style because GWC caches per style - a labelled and an unlabelled tile
are two cache entries, and switching is then free at the client.

ONE set of colours serves all three basemaps. The lines are neutral brown, and legibility
over dark satellite imagery comes from a white CASING under each line rather than from a
per-basemap colour. The casing was chosen over per-basemap styles because it fixes the only
basemap that was broken (satellite; street and dem read fine) without doubling the style
count, which would have meant 12 GWC tile sets instead of 6 and would have taught the client
to re-request tiles on every basemap change. It is also the treatment already proven on this
layer: the labels survive over imagery precisely because they carry a white halo.

Both styles are also WRITTEN TO DISK as <name>.sld and committed, so
apps/api/src/geoserver/contourStyles.test.ts can assert against what this generator produces
without needing Python or a live GeoServer in the test run.

Changing anything here does NOT invalidate cached tiles. Truncate GWC for the contour layers
afterwards or you will keep looking at the old render.

Usage: python styles.py <geoserver-admin-password>
       python styles.py --write-only        (regenerate the .sld artifacts only, no upload)
       python styles.py --print-intervals   (no password needed; used by publish-contours.sh)
Env:
  GEOSERVER_URL         default http://localhost:8080/geoserver
  GEOSERVER_ADMIN_USER  default admin
"""
import os
import pathlib
import re
import sys

# Deferred: --print-intervals (used by publish-contours.sh, possibly via a different
# python3 than the one `requests` was installed into) has no need for it.

GS = os.environ.get("GEOSERVER_URL", "http://localhost:8080/geoserver") + "/rest"
WS = "webatlas"
USER = os.environ.get("GEOSERVER_ADMIN_USER", "admin")

# The published buckets are 250/100/50 m today; a 20 m bucket is expected later (see
# packages/shared/src/contours.ts). Parsing here — rather than hand-copying the list a
# second time — is the same precedent as apps/api/scripts/basemap/styles.py's _palette():
# a missing/empty match raises instead of silently drifting from the shared source.
CONTOURS_TS = (
    pathlib.Path(__file__).resolve().parents[4]
    / "packages" / "shared" / "src" / "contours.ts"
)


def _intervals() -> list:
    src = CONTOURS_TS.read_text(encoding="utf-8")
    m = re.search(r"CONTOUR_INTERVALS\s*=\s*\[([^\]]*)\]", src)
    if not m:
        raise SystemExit(f"{CONTOURS_TS}: could not find CONTOUR_INTERVALS — cannot generate styles")
    values = [int(v.strip()) for v in m.group(1).split(",") if v.strip()]
    if not values:
        raise SystemExit(f"{CONTOURS_TS}: CONTOUR_INTERVALS parsed empty — cannot generate styles")
    return values


INTERVALS = _intervals()

# Line colours. The index (every 5th) line is the darker, heavier one.
NON_INDEX_COLOUR = "#9C7A4F"
INDEX_COLOUR = "#8A6534"

# Casing: a white stroke laid under each line so it reads against dark satellite imagery.
# Width is line width + 1.5, i.e. 0.75px of white each side, matching the label halo's 1.5
# radius so the layer reads as one treatment. Kept translucent rather than the halo's opaque
# white: at full strength these become white ribbons over the light street basemap.
CASING_COLOUR = "#FFFFFF"


def _line_rule(is_index: bool, colour: str, width: str, opacity: str | None = None) -> str:
    """One is_index-filtered LineSymbolizer rule. Four of these differ only in those values."""
    op = (
        f'\n     <CssParameter name="stroke-opacity">{opacity}</CssParameter>'
        if opacity is not None
        else ""
    )
    return f"""  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>{'true' if is_index else 'false'}</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">{colour}</CssParameter>
     <CssParameter name="stroke-width">{width}</CssParameter>{op}
   </Stroke></LineSymbolizer>
  </Rule>
"""


# TWO FeatureTypeStyles, and the split is load-bearing. Putting the casing and the line in
# one Rule instead renders them per feature - casing, line, casing, line - so a neighbouring
# contour's white casing overdraws the previous contour's brown, biting chunks out of the
# lines exactly where terrain is steep and contours crowd together. GeoServer completes each
# FeatureTypeStyle across every feature before starting the next, so a separate FTS lays all
# the casings down first. Asserted by apps/api/src/geoserver/contourStyles.test.ts.
#
# The final line MUST keep `</FeatureTypeStyle></UserStyle></NamedLayer>` unbroken: LABELLED
# below is derived by replacing that exact sequence, and splitting it across lines would
# leave LABELLED silently identical to PLAIN, with no labels at all.
PLAIN = f"""<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0">
 <NamedLayer><Name>contours_plain</Name><UserStyle>
 <FeatureTypeStyle>
{_line_rule(False, CASING_COLOUR, "2.0", "0.45")}{_line_rule(True, CASING_COLOUR, "2.6", "0.55")} </FeatureTypeStyle>
 <FeatureTypeStyle>
{_line_rule(False, NON_INDEX_COLOUR, "0.5", "0.7")}{_line_rule(True, INDEX_COLOUR, "1.1")} </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>
"""

# Nhan CHI tren duong cai: ghi nhan moi duong thi ban do thanh mot bai chu.
LABELLED = PLAIN.replace("<Name>contours_plain</Name>", "<Name>contours_labelled</Name>").replace(
    "</FeatureTypeStyle></UserStyle></NamedLayer>",
    """<Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <TextSymbolizer>
    <Label>
     <!-- elevation_m is real (500.0); round() renders it as a whole number (500). -->
     <Function xmlns="http://www.opengis.net/ogc" name="round">
       <PropertyName>elevation_m</PropertyName>
     </Function>
    </Label>
    <Font><CssParameter name="font-size">10</CssParameter></Font>
    <LabelPlacement><LinePlacement/></LabelPlacement>
    <Fill><CssParameter name="fill">#6B4E26</CssParameter></Fill>
    <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo>
    <VendorOption name="followLine">true</VendorOption>
    <!-- Contours are OGC MultiLineString fragments, not one continuous line per index
         value (same fragmentation basemap's road_label() hits with OSM ways). Without
         group=yes, GWC's 4x4 metatiling renders a 1024x1024 canvas and followLine's
         label-merging step throws NullPointerException on the ungrouped parts:
         "Cannot invoke java.util.List.isEmpty() because merged is null". -->
    <VendorOption name="group">yes</VendorOption>
    <VendorOption name="repeat">300</VendorOption>
    <VendorOption name="maxDisplacement">50</VendorOption>
   </TextSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>""",
)


def write(name: str, body: str) -> None:
    """Write the SLD next to this script so the artifact can be committed and asserted on.

    Same precedent as scripts/basemap/styles.py, which writes each `<name>.sld` so that
    apps/api/src/geoserver/basemapStyles.test.ts can assert against committed artifacts
    without needing Python or a live GeoServer in the test run.

    Resolved from __file__, NOT the process CWD as basemap's does — that one only lands in
    the right place if you happen to have cd'd into its directory first.
    """
    path = pathlib.Path(__file__).resolve().parent / f"{name}.sld"
    path.write_text(body, encoding="utf-8")
    print(f"  {path.name}: written")


def upload(name: str, body: str, pw: str) -> None:
    import requests  # see note above import block

    # Write first, then read the bytes back off disk and send exactly those — not
    # `body.encode()` straight from memory. `write()` is idempotent, so calling it again
    # here (main() already called it once, for --write-only) costs nothing, but it turns
    # "upload sends what write() wrote" from an incidental fact of call order into
    # something upload() itself guarantees: it is now IMPOSSIBLE for GeoServer to receive
    # a style that the committed .sld (and contourStyles.test.ts, which asserts against
    # that file) does not also hold.
    write(name, body)
    path = pathlib.Path(__file__).resolve().parent / f"{name}.sld"
    data = path.read_bytes()

    auth = (USER, pw)
    r = requests.post(
        f"{GS}/workspaces/{WS}/styles",
        params={"name": name},
        data=data,
        headers={"Content-Type": "application/vnd.ogc.sld+xml"},
        auth=auth,
    )
    if r.status_code != 201:
        # Already there: replace it via PUT. Checked empirically against this GeoServer:
        # a style-name collision on POST returns 403 ("Style X already exists"), not the
        # 409/500 publish-contours.sh and publish-basemap.sh tolerate on the *featuretype*
        # endpoint — POST failure modes differ per REST resource in this GeoServer version.
        # Falling back on anything but 201, rather than hand-picking a status code, is what
        # actually survives a second run regardless of which code a given endpoint uses.
        r = requests.put(
            f"{GS}/workspaces/{WS}/styles/{name}",
            data=data,
            headers={"Content-Type": "application/vnd.ogc.sld+xml"},
            auth=auth,
        )
    print(f"  {name}: {r.status_code}")
    r.raise_for_status()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--print-intervals":
        # Consumed by publish-contours.sh, which cannot parse contours.ts itself.
        print(" ".join(str(i) for i in INTERVALS))
        sys.exit(0)
    # Artifacts are written first and unconditionally: regenerating them after a style
    # edit must not require a running GeoServer, or the committed .sld drifts from the
    # generator and the tests start asserting against a stale file.
    write("contours_plain", PLAIN)
    write("contours_labelled", LABELLED)

    if len(sys.argv) > 1 and sys.argv[1] == "--write-only":
        sys.exit(0)

    # Say what is missing rather than dying on IndexError. The runbook shipped this command
    # without its password argument once already (e06e805); the next person to do it should
    # be told, not handed a traceback.
    if len(sys.argv) < 2:
        raise SystemExit(
            "usage: python styles.py <geoserver-admin-password>\n"
            "       python styles.py --write-only        (regenerate .sld only, no upload)\n"
            "       python styles.py --print-intervals"
        )

    password = sys.argv[1]
    upload("contours_plain", PLAIN, password)
    upload("contours_labelled", LABELLED, password)
