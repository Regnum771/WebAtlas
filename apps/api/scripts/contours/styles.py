#!/usr/bin/env python3
"""Generate and upload the contour SLDs. Companion to publish-contours.sh.

Two styles per interval: plain, and labelled. Labels are a separate STYLE rather than a
toggle inside one style because GWC caches per style - a labelled and an unlabelled tile
are two cache entries, and switching is then free at the client.

Colour is chosen per basemap by the client (it requests a different style), so these are
neutral browns that read on both street and satellite.

Usage: python styles.py <geoserver-admin-password>
Env:
  GEOSERVER_URL         default http://localhost:8080/geoserver
  GEOSERVER_ADMIN_USER  default admin
"""
import os
import sys
import requests

GS = os.environ.get("GEOSERVER_URL", "http://localhost:8080/geoserver") + "/rest"
WS = "webatlas"
USER = os.environ.get("GEOSERVER_ADMIN_USER", "admin")

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
    <Label><PropertyName>elevation_m</PropertyName></Label>
    <Font><CssParameter name="font-size">10</CssParameter></Font>
    <LabelPlacement><LinePlacement/></LabelPlacement>
    <Fill><CssParameter name="fill">#6B4E26</CssParameter></Fill>
    <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></Halo>
    <VendorOption name="followLine">true</VendorOption>
    <VendorOption name="repeat">300</VendorOption>
    <VendorOption name="maxDisplacement">50</VendorOption>
   </TextSymbolizer>
  </Rule>
 </FeatureTypeStyle></UserStyle></NamedLayer>""",
)


def upload(name: str, body: str, pw: str) -> None:
    auth = (USER, pw)
    r = requests.post(
        f"{GS}/workspaces/{WS}/styles",
        params={"name": name},
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/vnd.ogc.sld+xml"},
        auth=auth,
    )
    if r.status_code == 409:  # already there: replace it
        r = requests.put(
            f"{GS}/workspaces/{WS}/styles/{name}",
            data=body.encode("utf-8"),
            headers={"Content-Type": "application/vnd.ogc.sld+xml"},
            auth=auth,
        )
    print(f"  {name}: {r.status_code}")
    r.raise_for_status()


if __name__ == "__main__":
    password = sys.argv[1]
    upload("contours_plain", PLAIN, password)
    upload("contours_labelled", LABELLED, password)
