#!/usr/bin/env python3
"""Generate and upload the contour SLDs. Companion to publish-contours.sh.

Two styles per interval: plain, and labelled. Labels are a separate STYLE rather than a
toggle inside one style because GWC caches per style - a labelled and an unlabelled tile
are two cache entries, and switching is then free at the client.

Colour is chosen per basemap by the client (it requests a different style), so these are
neutral browns that read on both street and satellite.

Usage: python styles.py <geoserver-admin-password>
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

PLAIN = """<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" version="1.0.0">
 <NamedLayer><Name>contours_plain</Name><UserStyle><FeatureTypeStyle>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>false</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#9C7A4F</CssParameter>
     <CssParameter name="stroke-width">0.5</CssParameter>
     <CssParameter name="stroke-opacity">0.7</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
  <Rule>
   <Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>
     <PropertyName>is_index</PropertyName><Literal>true</Literal>
   </PropertyIsEqualTo></Filter>
   <LineSymbolizer><Stroke>
     <CssParameter name="stroke">#8A6534</CssParameter>
     <CssParameter name="stroke-width">1.1</CssParameter>
   </Stroke></LineSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>
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


def upload(name: str, body: str, pw: str) -> None:
    import requests  # see note above import block

    auth = (USER, pw)
    r = requests.post(
        f"{GS}/workspaces/{WS}/styles",
        params={"name": name},
        data=body.encode("utf-8"),
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
            data=body.encode("utf-8"),
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
    password = sys.argv[1]
    upload("contours_plain", PLAIN, password)
    upload("contours_labelled", LABELLED, password)
