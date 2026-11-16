"""
Generate + upload SLD styles for the self-hosted basemap.

The look follows the standard OpenStreetMap map (OSM Carto): each road class has its own colour
(motorway red-pink, trunk orange, primary light orange, secondary pale yellow, the rest white),
roads widen as the map zooms in, and landuse, water and railways use that map's colours.
What the basemap tables do not hold is not drawn: buildings, waterway lines, points of interest.

Scale denominators are GeoServer's for an EPSG:3857 tile (0.28 mm pixel, at the equator):
    z7 4,367,830   z8 2,183,915   z9 1,091,958   z10 545,979   z11 272,989
    z12 136,495    z13 68,247     z14 34,124     z15 17,062
They are not the scales the web app shows (zoomScale.ts uses 96 DPI at 16 N): the app's closest
view, 1:25,000, draws z15 tiles.

Usage: GEOSERVER_ADMIN_PASSWORD=... python styles.py   (write .sld and upload; exits non-zero on non-2xx)
       python styles.py --write-only                   (regenerate the .sld files only, no upload)
Env: GEOSERVER_URL, GEOSERVER_ADMIN_USER (default admin), GEOSERVER_ADMIN_PASSWORD (required to upload)
"""
import os
import pathlib
import re
import subprocess
import sys

GS = os.environ.get("GEOSERVER_URL", "http://localhost:8080/geoserver") + "/rest"
WS = os.environ.get("GEOSERVER_WORKSPACE", "webatlas")
USER = os.environ.get("GEOSERVER_ADMIN_USER", "admin")
SLD_DIR = pathlib.Path(__file__).resolve().parent

# --- palette ------------------------------------------------------------
# READ from packages/shared/src/layer-palette.ts — the SAME values the legend
# swatches use. Keeping a second copy here would be the exact drift bug that
# palette exists to prevent, except across a Python/TypeScript boundary where
# no TS test could ever catch it. Parse is deliberately strict: a missing key
# raises rather than silently falling back to a stale colour.
PALETTE_TS = (
    pathlib.Path(__file__).resolve().parents[4]
    / "packages" / "shared" / "src" / "layer-palette.ts"
)


def _palette() -> dict:
    src = PALETTE_TS.read_text(encoding="utf-8")
    out = {}
    for key, body in re.findall(r"(layer_bm_\w+):\s*\{([^}]*)\}", src):
        entry = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", body))
        out[key] = entry
    required = {
        "layer_bm_roads": ("color", "stroke"),
        "layer_bm_railways": ("color",),
        "layer_bm_water": ("color",),
        "layer_bm_landuse": ("color", "secondary"),
    }
    for key, fields in required.items():
        if key not in out:
            raise SystemExit(f"layer-palette.ts: missing {key} — cannot generate SLD")
        for f in fields:
            if f not in out[key]:
                raise SystemExit(f"layer-palette.ts: {key} missing '{f}'")
    return out


_P = _palette()

WATER = _P["layer_bm_water"]["color"]
LANDUSE_GREEN = _P["layer_bm_landuse"]["color"]
LANDUSE_GREY = _P["layer_bm_landuse"]["secondary"]
# The legend's one road swatch is the primary road: fill and casing.
ROAD_PRIMARY = _P["layer_bm_roads"]["color"]
ROAD_PRIMARY_CASING = _P["layer_bm_roads"]["stroke"]
RAIL = _P["layer_bm_railways"]["color"]

# Land is the base everything else is drawn on, not a legend entry, so it has no palette key.
# land_vn holds Vietnam only, so the sea is not drawn: no table separates it from the neighbouring
# countries, and a sea-coloured background would paint Laos and Cambodia as water.
LAND = "#f2efe9"
LABEL = "#333333"
LABEL_HALO = "#ffffff"
# DejaVu Sans is the one sans-serif family in the GeoServer image. A family the server lacks
# (Arial, before) silently falls back to a serif face.
FONT = "DejaVu Sans"

HEAD = """<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>{name}</Name><UserStyle><Title>{name}</Title>
{passes}
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>"""


def fts(rules, sort_by=None):
    """One drawing pass. GeoServer draws the passes of a style in order, each over the whole layer,
    so a later pass always lies on top of an earlier one. `sort_by` orders the features in the pass."""
    opt = f'<VendorOption name="sortBy">{sort_by}</VendorOption>' if sort_by else ""
    return "  <FeatureTypeStyle>\n" + "\n".join(rules) + opt + "\n  </FeatureTypeStyle>"


def sld(name, *passes):
    return HEAD.format(name=name, passes="\n".join(passes))


def scale(min_=None, max_=None):
    s = ""
    if min_ is not None:
        s += f"<MinScaleDenominator>{min_}</MinScaleDenominator>"
    if max_ is not None:
        s += f"<MaxScaleDenominator>{max_}</MaxScaleDenominator>"
    return s


# "From tile zoom z inwards" as a MaxScaleDenominator: each value lies between the scale of zoom z
# and of zoom z - 1 (see the table at the top). 5M to 50k are the thresholds of the 2026-09-08
# design. Every value must stay above 25,000, the app's closest scale (styles.test.ts).
GATE = {7: 5000000, 8: 3000000, 9: 1500000, 10: 1000000, 11: 500000, 12: 250000, 13: 100000, 14: 50000, 15: 26000}


def tiers(steps):
    """[(zoom, value), ...] -> [(scale xml, zoom, value), ...]: each value holds from its zoom up to
    the next step's zoom. Zoom 0 means "from the farthest scale", with no upper gate."""
    out = []
    for i, (z, value) in enumerate(steps):
        nxt = steps[i + 1][0] if i + 1 < len(steps) else None
        out.append((scale(min_=GATE[nxt] if nxt else None, max_=GATE[z] if z else None), z, value))
    return out


def line(colour, width, cap="round", dash=None):
    d = f'<CssParameter name="stroke-dasharray">{dash}</CssParameter>' if dash else ""
    return (f'<LineSymbolizer><Stroke>'
            f'<CssParameter name="stroke">{colour}</CssParameter>'
            f'<CssParameter name="stroke-width">{width}</CssParameter>'
            f'<CssParameter name="stroke-linejoin">round</CssParameter>'
            f'<CssParameter name="stroke-linecap">{cap}</CssParameter>{d}</Stroke></LineSymbolizer>')


def polygon(fill, stroke=None, sw=0.4):
    st = (f'<Stroke><CssParameter name="stroke">{stroke}</CssParameter>'
          f'<CssParameter name="stroke-width">{sw}</CssParameter></Stroke>') if stroke else ""
    return (f'<PolygonSymbolizer><Fill>'
            f'<CssParameter name="fill">{fill}</CssParameter></Fill>{st}</PolygonSymbolizer>')


def label(size, colour=LABEL, weight="normal", field="name"):
    return f"""<TextSymbolizer>
      <Label><ogc:PropertyName>{field}</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">{FONT}</CssParameter>
        <CssParameter name="font-size">{size}</CssParameter>
        <CssParameter name="font-weight">{weight}</CssParameter></Font>
      <LabelPlacement><PointPlacement><AnchorPoint>
        <AnchorPointX>0.5</AnchorPointX><AnchorPointY>0.5</AnchorPointY></AnchorPoint>
      </PointPlacement></LabelPlacement>
      <Halo><Radius>1.6</Radius><Fill><CssParameter name="fill">{LABEL_HALO}</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">{colour}</CssParameter></Fill>
      <Priority><ogc:PropertyName>population</ogc:PropertyName></Priority>
      <VendorOption name="autoWrap">70</VendorOption>
      <VendorOption name="spaceAround">6</VendorOption>
    </TextSymbolizer>"""


def road_label(size, colour=None, repeat=400, halo=LABEL_HALO):
    """Nhan ten duong, dat DOC theo tuyen.

    Khac label() cua dia danh o ba cho:
      - LinePlacement + followLine: chu uon theo hinh dang duong, khong phai mot
        diem giua tuyen.
      - group=yes: OSM cat mot con duong thanh rat nhieu doan roi nhau; khong gom
        lai thi moi doan tu ve mot nhan, vua xau vua ton cong dung hinh.
      - repeat: voi tuyen dai, lap lai nhan moi ngan nay pixel de keo toi dau cung
        doc duoc ten.
    """
    colour = colour or LABEL
    return f"""<TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">{FONT}</CssParameter>
        <CssParameter name="font-size">{size}</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><LinePlacement><PerpendicularOffset>0</PerpendicularOffset></LinePlacement></LabelPlacement>
      <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">{halo}</CssParameter></Fill></Halo>
      <Fill><CssParameter name="fill">{colour}</CssParameter></Fill>
      <VendorOption name="followLine">true</VendorOption>
      <VendorOption name="group">yes</VendorOption>
      <VendorOption name="repeat">{repeat}</VendorOption>
      <VendorOption name="maxDisplacement">40</VendorOption>
      <VendorOption name="spaceAround">4</VendorOption>
      <VendorOption name="maxAngleDelta">30</VendorOption>
    </TextSymbolizer>"""


def rule(name, symbolizers, filt="", sc=""):
    return f"<Rule><Name>{name}</Name>{sc}{filt}{symbolizers}</Rule>"


def fclass_in(*values):
    ors = "".join(f"<ogc:PropertyIsEqualTo><ogc:PropertyName>fclass</ogc:PropertyName>"
                  f"<ogc:Literal>{v}</ogc:Literal></ogc:PropertyIsEqualTo>" for v in values)
    inner = ors if len(values) == 1 else f"<ogc:Or>{ors}</ogc:Or>"
    return f"<ogc:Filter>{inner}</ogc:Filter>"


# --- styles --------------------------------------------------------------
STYLES = {}

# land: the 34 province polygons, at every scale. It is the whole of the base layer group
# `webatlas:basemap`; the sea is the map's background colour. The outline is in the land colour:
# it only closes the hairline gaps antialiasing leaves between neighbouring provinces.
STYLES["basemap_land"] = sld("basemap_land", fts([rule("land", polygon(LAND, LAND, 0.5))]))

# water: open water at every scale, wetlands only from 1:500.000 in (2026-09-08 design). OSM draws
# a wetland as a pattern of reeds; a plain pale green-blue keeps it legible without that bitmap.
# A larger denominator means farther out, so MaxScaleDenominator reads "only closer than this".
WETLAND = "#d4e6dc"
STYLES["basemap_water"] = sld("basemap_water",
    fts([rule("wetland", polygon(WETLAND),
              fclass_in("wetland", "wetland_marsh", "wetland_mangrove", "wetland_tidalflat",
                        "wetland_reedbed", "wetland_swamp", "wetland_wet_meadow"),
              scale(max_=500000))]),
    fts([rule("water", polygon(WATER),
              fclass_in("water", "reservoir", "riverbank", "dock"))]))

# landuse, in OSM Carto's colours. Three passes, because the polygons overlap (a park inside a
# residential area, a wood inside farmland): built-up and farmed ground first, vegetation over it,
# then the small managed greens on top. Vegetation shows from 1:400.000 in, the rest from 1:200.000.
def _landuse(colour, classes, gate):
    return [rule(c, polygon(colour), fclass_in(c), scale(max_=gate)) for c in classes]

STYLES["basemap_landuse"] = sld("basemap_landuse",
    fts(_landuse(LANDUSE_GREY, ["residential"], 200000)
        + _landuse("#eef0d5", ["farmland"], 200000)
        + _landuse("#f5dcba", ["farmyard"], 200000)
        + _landuse("#ebdbe8", ["industrial"], 200000)
        + _landuse("#f2dad9", ["commercial"], 200000)
        + _landuse("#ffd6d1", ["retail"], 200000)
        + _landuse("#f3e3dd", ["military"], 200000)
        + _landuse("#c5c3c3", ["quarry"], 200000)
        + _landuse("#b6b592", ["landfill"], 200000)),
    fts(_landuse(LANDUSE_GREEN, ["forest"], 400000)
        + _landuse("#c8d7ab", ["scrub"], 400000)
        + _landuse("#d6d99f", ["heath"], 400000)
        + _landuse("#cdebb0", ["grass", "meadow"], 400000)
        + _landuse("#aedfa3", ["orchard", "vineyard"], 400000)),
    fts(_landuse("#c8facc", ["park"], 400000)
        + _landuse("#dffce2", ["recreation_ground"], 200000)
        + _landuse("#c9e1bf", ["allotments"], 200000)
        + _landuse("#aacbaf", ["cemetery"], 200000)))

# --- roads ---------------------------------------------------------------
# One entry per road class: the fclass values it covers, fill and casing colour, and the widths
# as [(from tile zoom, (fill px, fill + casing px))]. The first zoom is where the class appears.
# The classes appear at the scales of the 2026-09-08 design: motorway at every scale, trunk from
# 1:5.000.000, primary 1:3.000.000, secondary 1:1.000.000, tertiary and unclassified 1:500.000,
# residential 1:250.000, tracks and paths 1:100.000. Service roads moved from 1:250.000 to
# 1:100.000: OSM draws them late, and 77.000 driveways at zoom 12 are only clutter.
ROADS = {
    "motorway": (["motorway", "motorway_link"], "#e892a2", "#dc2a67",
                 [(0, (1.0, 1.8)), (8, (1.6, 2.6)), (10, (2.4, 3.6)), (12, (3.6, 5.0)), (13, (5.0, 6.6)), (14, (7.0, 8.8)), (15, (10.0, 12.0))]),
    "trunk": (["trunk", "trunk_link"], "#f9b29c", "#c84e2f",
              [(7, (1.0, 1.8)), (9, (1.5, 2.5)), (10, (2.2, 3.4)), (12, (3.4, 4.8)), (13, (4.8, 6.4)), (14, (6.5, 8.3)), (15, (9.5, 11.5))]),
    "primary": (["primary", "primary_link"], ROAD_PRIMARY, ROAD_PRIMARY_CASING,
                [(8, (1.0, 1.8)), (10, (2.0, 3.2)), (12, (3.2, 4.6)), (13, (4.6, 6.2)), (14, (6.5, 8.3)), (15, (9.5, 11.5))]),
    "secondary": (["secondary", "secondary_link"], "#f7fabf", "#707d05",
                  [(10, (1.4, 2.4)), (12, (2.8, 4.0)), (13, (4.2, 5.6)), (14, (6.0, 7.6)), (15, (9.0, 10.8))]),
    "tertiary": (["tertiary", "tertiary_link"], "#ffffff", "#8f8f8f",
                 [(11, (1.0, 1.9)), (12, (2.2, 3.3)), (13, (3.4, 4.6)), (14, (5.0, 6.4)), (15, (8.0, 9.6))]),
    "unclassified": (["unclassified"], "#ffffff", "#bbbbbb",
                     [(11, (0.8, 1.5)), (12, (1.4, 2.3)), (13, (2.4, 3.4)), (14, (3.6, 4.8)), (15, (6.0, 7.4))]),
    "residential": (["residential"], "#ffffff", "#bbbbbb",
                    [(12, (1.0, 1.8)), (13, (2.0, 3.0)), (14, (3.4, 4.6)), (15, (5.5, 6.9))]),
    "living_street": (["living_street"], "#ededed", "#bbbbbb",
                      [(12, (1.0, 1.8)), (13, (2.0, 3.0)), (14, (3.4, 4.6)), (15, (5.5, 6.9))]),
    "pedestrian": (["pedestrian"], "#dddde8", "#999999",
                   [(13, (1.2, 2.0)), (14, (2.4, 3.4)), (15, (4.0, 5.0))]),
    "service": (["service"], "#ffffff", "#bbbbbb",
                [(13, (1.0, 1.8)), (14, (1.6, 2.6)), (15, (2.8, 3.8))]),
}
MAJOR = ["motorway", "trunk", "primary"]
MINOR = [k for k in ROADS if k not in MAJOR]

# Unpaved and foot ways: a dashed line with no casing, as [(from tile zoom, width px)].
# track_grade1..5 are variants of track in the real data; left unnamed, 4.193 ways go undrawn.
DASHED = {
    "track": (["track", "track_grade1", "track_grade2", "track_grade3", "track_grade4", "track_grade5"],
              "#996600", "5 3", [(13, 0.8), (15, 1.4)]),
    "path": (["path", "footway", "steps"], "#fa8072", "3 2", [(13, 0.8), (15, 1.3)]),
    "cycleway": (["cycleway"], "#0000ff", "3 2", [(13, 0.8), (15, 1.3)]),
}


def road_rules(part, classes, from_zoom=0):
    """The casing or the fill rules ('casing' / 'fill') of the given classes. `from_zoom` drops the
    steps that end before that zoom and starts the first kept step there."""
    rules = []
    for key in classes:
        fclasses, fill, casing, steps = ROADS[key]
        kept = [s for i, s in enumerate(steps) if i + 1 == len(steps) or steps[i + 1][0] > from_zoom]
        kept[0] = (max(kept[0][0], from_zoom), kept[0][1])
        for sc, z, (fill_w, casing_w) in tiers(kept):
            sym = line(casing, casing_w) if part == "casing" else line(fill, fill_w)
            rules.append(rule(f"{key}_{part}_z{z}", sym, fclass_in(*fclasses), sc))
    return rules


def dashed_rules():
    rules = []
    for key, (fclasses, colour, dash, steps) in DASHED.items():
        for sc, z, width in tiers(steps):
            rules.append(rule(f"{key}_z{z}", line(colour, width, cap="butt", dash=dash), fclass_in(*fclasses), sc))
    return rules


# Casing and fill are separate passes: all casings, then all fills. In one pass GeoServer draws
# way by way, so each way's casing lands on the fill of the way before it and leaves a blob at
# every joint and a line across every junction. The fill pass is sorted by `code` (Geofabrik's
# class code: 5111 motorway ... 5155 steps), highest first, so a bigger road's fill is drawn
# over a smaller one's where they meet.
BY_CLASS = "code D"

# national major roads: the layer under the region roads, and the only one outside the region.
# Only motorways draw at every scale; trunk and primary join closer in, because all 62.598
# national segments at 1:12.800.000 are a tangle and the motorways alone are the readable frame.
# The label's halo is the road's own fill, as on OSM, so a name reads as lying on its road.
STYLES["basemap_roads_vn"] = sld("basemap_roads_vn",
    fts(road_rules("casing", MAJOR)),
    fts(road_rules("fill", MAJOR), sort_by=BY_CLASS),
    fts([rule(f"{key}_label", road_label(10, halo=ROADS[key][1]), fclass_in(key), scale(max_=1000000))
         for key in MAJOR]))

# region roads: every class, drawn over the national layer. roads_region holds the region's major
# roads too, and they are drawn again here from zoom 10 (where secondary roads appear), so that
# inside the region a junction of a major and a minor road is drawn in one casing pass and one
# fill pass. Left to the national layer alone, a major road's casing would cut across every minor
# road joining it. Major road names stay with the national layer, or they would be drawn twice.
STYLES["basemap_roads_region"] = sld("basemap_roads_region",
    fts(road_rules("casing", MINOR) + road_rules("casing", MAJOR, from_zoom=10)),
    fts(dashed_rules() + road_rules("fill", MINOR) + road_rules("fill", MAJOR, from_zoom=10), sort_by=BY_CLASS),
    fts([
        rule("secondary_label", road_label(10), fclass_in("secondary", "tertiary"), scale(max_=250000)),
        # Minor road names only from zoom 14. MaxScaleDenominator is a strict comparison, and a
        # gate at or below 25.000 would never fire (styles.test.ts). group=yes joins the segments
        # of one street under one name, which is right but costs about 3x on a zoom-15 tile
        # (0,07-0,13 s without, 0,21-0,51 s with), so it is paid only at the closest zooms.
        rule("minor_label", road_label(9), fclass_in("residential", "living_street", "unclassified"), scale(max_=50000)),
    ]))

# railways, every scale: a few thousand segments nationwide, so nothing is gained by hiding them.
# Far out a thin grey line; from zoom 12 the OSM pattern, a dark line with white dashes on it.
# Underground and light lines are a thin dashed grey line from zoom 12.
HEAVY_RAIL = fclass_in("rail", "narrow_gauge")
LIGHT_RAIL = fclass_in("light_rail", "subway", "funicular", "monorail", "miniature_railway")
STYLES["basemap_railways"] = sld("basemap_railways",
    fts([rule(f"rail_z{z}", line(RAIL, w, cap="butt"), HEAVY_RAIL, sc)
         for sc, z, w in tiers([(0, 0.7), (9, 1.2), (12, 2.4), (14, 3.2)])]
        + [rule("light_rail", line("#999999", 1.4, cap="butt", dash="5 3"), LIGHT_RAIL, scale(max_=GATE[12]))]),
    fts([rule(f"rail_dash_z{z}", line("#ffffff", w, cap="butt", dash="8 8"), HEAVY_RAIL, sc)
         for sc, z, w in tiers([(12, 1.2), (14, 1.8)])]))

# national places: cities early, towns a bit closer
STYLES["basemap_places_vn"] = sld("basemap_places_vn", fts([
    rule("city", label(13, weight="bold"), fclass_in("national_capital", "city"), scale(max_=13000000)),
    rule("town", label(11), fclass_in("town"), scale(max_=3000000)),
]))

# region places: villages/hamlets only when close in
STYLES["basemap_places_region"] = sld("basemap_places_region", fts([
    rule("suburb", label(10), fclass_in("suburb"), scale(max_=200000)),
    rule("village", label(10), fclass_in("village"), scale(max_=120000)),
    rule("hamlet", label(9), fclass_in("hamlet"), scale(max_=45000)),
]))


def upload(name, xml, pw):
    auth = f"{USER}:{pw}"
    path = SLD_DIR / f"{name}.sld"
    path.write_text(xml, encoding="utf-8")
    # create (ignore 500/409 if exists), then PUT the body
    subprocess.run(["curl", "-s", "-o", os.devnull, "-u", auth, "-XPOST",
                    "-H", "Content-Type: application/json", f"{GS}/workspaces/{WS}/styles",
                    "-d", f'{{"style":{{"name":"{name}","filename":"{name}.sld"}}}}'], check=False)
    r = subprocess.run(["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", "-u", auth, "-XPUT",
                        "-H", "Content-Type: application/vnd.ogc.sld+xml",
                        f"{GS}/workspaces/{WS}/styles/{name}", "--data-binary", f"@{path}"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def assign(layer, style, pw):
    r = subprocess.run(["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", "-u", f"{USER}:{pw}",
                        "-XPUT", "-H", "Content-Type: application/json",
                        f"{GS}/layers/{WS}:{layer}",
                        "-d", f'{{"layer":{{"defaultStyle":{{"name":"{WS}:{style}"}}}}}}'],
                       capture_output=True, text=True)
    return r.stdout.strip()


PAIRS = [
    ("land_vn", "basemap_land"),
    ("water_region", "basemap_water"),
    ("landuse_region", "basemap_landuse"),
    ("roads_vn", "basemap_roads_vn"),
    ("roads_region", "basemap_roads_region"),
    ("railways_vn", "basemap_railways"),
    ("places_vn", "basemap_places_vn"),
    ("places_region", "basemap_places_region"),
]

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--write-only":
        for name, xml in STYLES.items():
            (SLD_DIR / f"{name}.sld").write_text(xml, encoding="utf-8")
        sys.exit(0)
    # From the environment, never argv: a registry `run` stage's argv is written to lineage
    # (append-only) and shows in process listings.
    pw = os.environ.get("GEOSERVER_ADMIN_PASSWORD")
    if not pw:
        raise SystemExit("GEOSERVER_ADMIN_PASSWORD is not set (the password is read from the environment)")
    failed = []
    for name, xml in STYLES.items():
        code = upload(name, xml, pw)
        print(f"style {name:<24} upload {code}")
        if not code.startswith("2"):
            failed.append(f"style {name}: {code}")
    print()
    for layer, style in PAIRS:
        code = assign(layer, style, pw)
        print(f"assign {layer:<18} -> {style:<24} {code}")
        if not code.startswith("2"):
            failed.append(f"assign {layer}: {code}")
    if failed:
        raise SystemExit("GeoServer rejected: " + "; ".join(failed))
