"""
Checks for the hub snapshot tool's pure parts: the square box, the GetMap parameters, the depth SLD and the
hillshade. No GeoServer, no database.

No pytest (see workspace/test_worker.py). Runs inside the atlas-tools image:

    python3 packages/atlas-data/tools/hub/test_snapshots.py
"""
import math
import pathlib
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

import snapshots as s  # noqa: E402

failures = []


def check(name, cond):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


box = s.square_box_3857(s.EXTENT_4326)
check("the box is square", math.isclose(box[2] - box[0], box[3] - box[1], rel_tol=1e-9))
x0, y0 = s.to_mercator(s.EXTENT_4326[0], s.EXTENT_4326[1])
x1, y1 = s.to_mercator(s.EXTENT_4326[2], s.EXTENT_4326[3])
check("the box holds the whole extent", box[0] < x0 and box[1] < y0 and box[2] > x1 and box[3] > y1)
check("the box is centred on the extent", math.isclose((box[0] + box[2]) / 2, (x0 + x1) / 2) and math.isclose((box[1] + box[3]) / 2, (y0 + y1) / 2))

p = s.getmap_params("webatlas:rivers", box, size=512)
check("GetMap asks for a square PNG in 3857", p["srs"] == "EPSG:3857" and p["width"] == p["height"] == "512" and p["format"] == "image/png")
check("GetMap is transparent unless told otherwise", p["transparent"] == "true"
      and s.getmap_params("webatlas:basemap", box, transparent=False)["transparent"] == "false")
check("GetMap carries an SLD body only when given one", "sld_body" not in p and "sld_body" in s.getmap_params("x", box, sld_body="<x/>"))

sld = s.depth_sld("geonode:ts_x_peak")
root = ET.fromstring(sld)
ns = {"sld": "http://www.opengis.net/sld"}
entries = root.findall(".//sld:ColorMapEntry", ns)
colors = [e.get("color") for e in entries if e.get("opacity") != "0"]
check("the depth ramp is the violet depth-1..4", colors == ["#C9C3EA", "#9A8FD6", "#6B5BB8", "#3F2E8C"])
check("depths below 0.1 m are transparent", all(e.get("opacity") == "0" for e in entries if float(e.get("quantity")) < 0.1))
check("the SLD names its layer", root.find(".//sld:NamedLayer/sld:Name", ns).text == "geonode:ts_x_peak")

rsld = ET.fromstring(s.river_sld())
ftss = rsld.findall(".//sld:FeatureTypeStyle", ns)
widths = [float(c.text) for c in rsld.iter("{http://www.opengis.net/sld}CssParameter") if c.get("name") == "stroke-width"]
check("three levels, thinnest first so the rivers draw on top", len(ftss) == 3 and widths == sorted(widths) and len(set(widths)) == 3)
check("rivers draw in the water colour", {c.text for c in rsld.iter("{http://www.opengis.net/sld}CssParameter") if c.get("name") == "stroke"} == {s.WATER})
lits = [l.text for l in rsld.iter("{http://www.opengis.net/ogc}Literal")]
check("the levels split stream_order at 3 and 5", lits == ["3", "3", "5", "5"])

flat = s.hillshade(np.zeros((5, 5)), 30.0)
check("flat ground shades evenly at sin(altitude)", np.allclose(flat, math.sin(math.radians(45))))
east_up = np.tile(np.arange(5, dtype=float) * 3, (5, 1))  # gentle (3 m per 30 m cell), rises eastwards: faces west, towards the NW light
check("a slope facing the north-west light is brighter than flat", s.hillshade(east_up, 30.0).mean() > flat.mean())
check("a slope facing away from it is darker than flat", s.hillshade(east_up[:, ::-1], 30.0).mean() < flat.mean())
north_up = np.tile((np.arange(5, dtype=float) * 3)[::-1, None], (1, 5))  # rows run south: rises northwards, faces south
check("a south-facing slope is darker than flat", s.hillshade(north_up, 30.0).mean() < flat.mean())
nan = np.full((3, 3), np.nan)
check("no DEM shades as full light", np.allclose(s.hillshade(nan, 30.0), 1.0))
t = s.tint(np.array([[0.0, 1.0]]))
check("the tint runs from the dark to the light terrain colour", tuple(t[0, 0]) == s.TINT_DARK and tuple(t[0, 1]) == s.TINT_LIGHT)

base = np.zeros((4, 1, 1), np.uint8); base[:, 0, 0] = (10, 20, 30, 255)
top = np.zeros((4, 1, 1), np.uint8); top[:, 0, 0] = (200, 100, 0, 0)
check("a transparent top leaves the base as it is", tuple(s._over(base, top)[:, 0, 0]) == (10, 20, 30, 255))
top[3] = 255
check("an opaque top replaces the base", tuple(s._over(base, top)[:, 0, 0]) == (200, 100, 0, 255))

grey = np.full((1, 2, 2), 7, np.uint8)
check("a grey PNG becomes opaque RGBA", s.to_rgba(grey).shape == (4, 2, 2) and s.to_rgba(grey)[3].min() == 255)
paletted = np.array([[[0, 1]]], np.uint8)
rgba = s.to_rgba(paletted, {0: (0, 0, 0, 0), 1: (201, 195, 234, 235)})
check("a paletted PNG takes its palette's colours and alpha", tuple(rgba[:, 0, 1]) == (201, 195, 234, 235) and rgba[3, 0, 0] == 0)
check("grey with alpha keeps its alpha", tuple(s.to_rgba(np.array([[[9]], [[100]]], np.uint8))[:, 0, 0]) == (9, 9, 9, 100))

if failures:
    print(f"\n{len(failures)} failed")
    sys.exit(1)
print("\nall ok")
