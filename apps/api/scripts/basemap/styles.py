"""
Generate + upload SLD styles for the self-hosted basemap.

Palette is deliberately muted (CARTO Positron lineage): the WebATLAS design
language frames the map in dark chrome so that DATA colours read as data. A
busy basemap would fight the hazard-layer palette, which is the whole reason
we are not just swapping in Esri World_Street_Map.

Scale denominators (EPSG:3857, 96 DPI, approx):
    z6 ~ 1:4,300,000   z8 ~ 1:1,100,000   z10 ~ 1:270,000
    z12 ~ 1:68,000     z14 ~ 1:17,000
"""
import os
import pathlib
import re
import subprocess
import sys

GS = os.environ.get("GEOSERVER_URL", "http://localhost:8080/geoserver") + "/rest"
WS = os.environ.get("GEOSERVER_WORKSPACE", "webatlas")

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
        "layer_bm_water": ("color", "stroke"),
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
WATER_LINE = _P["layer_bm_water"]["stroke"]
LANDUSE_GREEN = _P["layer_bm_landuse"]["color"]
LANDUSE_GREY = _P["layer_bm_landuse"]["secondary"]
ROAD_FILL = _P["layer_bm_roads"]["color"]
ROAD_CASING = _P["layer_bm_roads"]["stroke"]
RAIL = _P["layer_bm_railways"]["color"]
# Nhan duong: xam dam hon net duong de doc duoc tren nen sang.
ROAD_LABEL = "#5b5145"

# Local shade variants, not identity colours — the same reason styles.ts builds
# its own opacity variants from the shared hex instead of storing them shared.
ROAD_MAJOR = "#fdfdfd"
ROAD_MAJOR_CASING = "#d8d8d8"
LABEL = "#7a7a7a"
LABEL_HALO = "#ffffff"

HEAD = """<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer><Name>{name}</Name><UserStyle><Title>{name}</Title><FeatureTypeStyle>
{rules}
  </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>"""


def scale(min_=None, max_=None):
    s = ""
    if min_ is not None:
        s += f"<MinScaleDenominator>{min_}</MinScaleDenominator>"
    if max_ is not None:
        s += f"<MaxScaleDenominator>{max_}</MaxScaleDenominator>"
    return s


def line(colour, width, cap="round", dash=None):
    d = f'<CssParameter name="stroke-dasharray">{dash}</CssParameter>' if dash else ""
    return (f'<LineSymbolizer><Stroke>'
            f'<CssParameter name="stroke">{colour}</CssParameter>'
            f'<CssParameter name="stroke-width">{width}</CssParameter>'
            f'<CssParameter name="stroke-linecap">{cap}</CssParameter>{d}</Stroke></LineSymbolizer>')


def polygon(fill, stroke=None, sw=0.4):
    st = (f'<Stroke><CssParameter name="stroke">{stroke}</CssParameter>'
          f'<CssParameter name="stroke-width">{sw}</CssParameter></Stroke>') if stroke else ""
    return (f'<PolygonSymbolizer><Fill>'
            f'<CssParameter name="fill">{fill}</CssParameter></Fill>{st}</PolygonSymbolizer>')


def label(size, colour=LABEL, weight="normal", field="name"):
    return f"""<TextSymbolizer>
      <Label><ogc:PropertyName>{field}</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
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


def road_label(size, colour=None, repeat=400):
    """Nhan ten duong, dat DOC theo tuyen.

    Khac label() cua dia danh o ba cho:
      - LinePlacement + followLine: chu uon theo hinh dang duong, khong phai mot
        diem giua tuyen.
      - group=yes: OSM cat mot con duong thanh rat nhieu doan roi nhau; khong gom
        lai thi moi doan tu ve mot nhan, vua xau vua ton cong dung hinh.
      - repeat: voi tuyen dai, lap lai nhan moi ngan nay pixel de keo toi dau cung
        doc duoc ten.
    """
    colour = colour or ROAD_LABEL
    return f"""<TextSymbolizer>
      <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
      <Font><CssParameter name="font-family">Arial</CssParameter>
        <CssParameter name="font-size">{size}</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter></Font>
      <LabelPlacement><LinePlacement><PerpendicularOffset>0</PerpendicularOffset></LinePlacement></LabelPlacement>
      <Halo><Radius>1.8</Radius><Fill><CssParameter name="fill">{LABEL_HALO}</CssParameter></Fill></Halo>
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

# water: open water at every scale, wetlands only from 1:500.000 in.
# Ngưỡng theo bản thiết kế 2026-09-08. Mẫu số CÀNG LỚN nghĩa là CÀNG THU NHỎ, nên
# MaxScaleDenominator = "chỉ vẽ khi đã phóng gần hơn mức này".
STYLES["basemap_water"] = HEAD.format(name="basemap_water", rules="\n".join([
    rule("water", polygon(WATER, WATER_LINE, 0.3),
         fclass_in("water", "reservoir", "riverbank", "dock")),
    rule("wetland", polygon(WATER, WATER_LINE, 0.3),
         fclass_in("wetland", "wetland_marsh", "wetland_mangrove", "wetland_tidalflat",
                   "wetland_reedbed", "wetland_swamp", "wetland_wet_meadow"),
         scale(max_=500000)),
]))

# landuse: only close in, very subtle
STYLES["basemap_landuse"] = HEAD.format(name="basemap_landuse", rules="\n".join([
    rule("green", polygon(LANDUSE_GREEN), fclass_in("forest", "park", "nature_reserve", "grass", "meadow", "orchard", "vineyard", "scrub", "heath"), scale(max_=400000)),
    rule("built", polygon(LANDUSE_GREY), fclass_in("residential", "industrial", "commercial", "retail", "military"), scale(max_=200000)),
]))

# national major roads. Chỉ motorway vẽ ở MỌI tỷ lệ; trunk và primary lần lượt
# hiện ra khi phóng gần hơn.
# Vì sao chia tầng: dải nay lùi ra tới 1:12.800.000, mà vẽ trọn 62.598 đoạn quốc
# lộ ở đó thì thành một mớ rối. Riêng motorway (9.946 đoạn) mới là bộ khung đọc
# được khi nhìn toàn quốc.
STYLES["basemap_roads_vn"] = HEAD.format(name="basemap_roads_vn", rules="\n".join([
    rule("motorway_casing", line(ROAD_MAJOR_CASING, 4.0), fclass_in("motorway", "motorway_link")),
    rule("motorway", line(ROAD_MAJOR, 2.4), fclass_in("motorway", "motorway_link")),
    rule("trunk_casing", line(ROAD_MAJOR_CASING, 3.0), fclass_in("trunk", "trunk_link"), scale(max_=5000000)),
    rule("trunk", line(ROAD_MAJOR, 1.8), fclass_in("trunk", "trunk_link"), scale(max_=5000000)),
    rule("primary_casing", line(ROAD_MAJOR_CASING, 2.8), fclass_in("primary", "primary_link"), scale(max_=3000000)),
    rule("primary", line(ROAD_MAJOR, 1.7), fclass_in("primary", "primary_link"), scale(max_=3000000)),
    rule("major_label", road_label(11), fclass_in("motorway", "trunk", "primary"), scale(max_=1000000)),
]))

# region roads: three tiers by scale, per the 2026-09-08 design.
#   < 1.000.000  + secondary
#   <   500.000  + tertiary, unclassified
#   <   250.000  + residential, living_street, service
#   <   100.000  + tracks, paths, footways
# Ngưỡng cũ (400.000 / 100.000 / 35.000) có hai nấc KHÔNG BAO GIỜ chạy: ứng dụng
# kẹp ở MAX_SCALE = 1:100.000 nên mẫu số không bao giờ xuống dưới 100.000, khiến
# đường nhỏ và đường mòn vô hình ở mọi mức thu phóng bấm tới được.
STYLES["basemap_roads_region"] = HEAD.format(name="basemap_roads_region", rules="\n".join([
    rule("secondary_casing", line(ROAD_CASING, 2.6), fclass_in("secondary", "secondary_link"), scale(max_=1000000)),
    rule("secondary", line(ROAD_FILL, 1.6), fclass_in("secondary", "secondary_link"), scale(max_=1000000)),
    rule("tertiary_casing", line(ROAD_CASING, 2.2), fclass_in("tertiary", "tertiary_link", "unclassified"), scale(max_=500000)),
    rule("tertiary", line(ROAD_FILL, 1.4), fclass_in("tertiary", "tertiary_link", "unclassified"), scale(max_=500000)),
    rule("minor_casing", line(ROAD_CASING, 2.0), fclass_in("residential", "living_street", "service"), scale(max_=250000)),
    rule("minor", line(ROAD_FILL, 1.2), fclass_in("residential", "living_street", "service"), scale(max_=250000)),
    # track_grade1..5 là biến thể của track trong dữ liệu thật; không kể tên thì
    # 4.193 đoạn sẽ bị bỏ vẽ mà không báo gì.
    # Đẩy xuống 1:100.000 (trước là 250.000) cho hai mục đích: bớt rối ở dải giữa,
    # và để hai nấc mới ở đầu gần (100.000 / 50.000 / 25.000) thật sự lộ thêm thứ
    # gì đó — trước khi dải nới ra thì dưới 1:200.000 không còn gì mới để hiện.
    rule("track_path", line("#e8e4dd", 0.8, dash="3 3"),
         fclass_in("track", "track_grade1", "track_grade2", "track_grade3", "track_grade4", "track_grade5",
                   "path", "footway", "cycleway", "steps", "pedestrian"),
         scale(max_=100000)),
    rule("secondary_label", road_label(10), fclass_in("secondary", "tertiary"), scale(max_=250000)),
    # Nguong 50.000 nghia la nhan chi hien o nac 1:25.000: MaxScaleDenominator la
    # so sanh NGHIEM NGAT, nen o dung nac 1:50.000 luat khong chay. Dat thang
    # 25.000 thi luat CHET han vi ung dung kep o 1:25.000 — ca kiem thu
    # "moi nguong phai lon hon MAX_SCALE" bat dung loi do khi thu.
    # group=yes gom cac doan cung ten lam mot nhan — dung ve mat ban do, nhung do
    # tren tile z15: 0,07-0,13s khong gom so voi 0,21-0,51s co gom, tuc dat gap ~3
    # lan. Gioi han o nac gan nhat de chi tra gia cho do o dung mot muc ty le.
    rule("minor_label", road_label(9), fclass_in("residential", "living_street"), scale(max_=50000)),
]))

# railways: every scale. Cả nước chỉ vài nghìn đoạn nên không có lý do hiệu năng
# để ẩn bớt, và bản thiết kế yêu cầu vẽ ở mọi tỷ lệ.
STYLES["basemap_railways"] = HEAD.format(name="basemap_railways", rules="\n".join([
    rule("rail", line(RAIL, 1.0, dash="6 4"),
         fclass_in("rail", "narrow_gauge", "light_rail", "subway", "funicular", "monorail", "miniature_railway")),
]))

# national places: cities early, towns a bit closer
STYLES["basemap_places_vn"] = HEAD.format(name="basemap_places_vn", rules="\n".join([
    rule("city", label(13, weight="bold"), fclass_in("national_capital", "city"), scale(max_=13000000)),
    rule("town", label(11), fclass_in("town"), scale(max_=3000000)),
]))

# region places: villages/hamlets only when close in
STYLES["basemap_places_region"] = HEAD.format(name="basemap_places_region", rules="\n".join([
    rule("suburb", label(10), fclass_in("suburb"), scale(max_=200000)),
    rule("village", label(10), fclass_in("village"), scale(max_=120000)),
    rule("hamlet", label(9), fclass_in("hamlet"), scale(max_=45000)),
]))


def upload(name, xml, pw):
    auth = f"admin:{pw}"
    path = f"{name}.sld"
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(xml)
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
    r = subprocess.run(["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", "-u", f"admin:{pw}",
                        "-XPUT", "-H", "Content-Type: application/json",
                        f"{GS}/layers/{WS}:{layer}",
                        "-d", f'{{"layer":{{"defaultStyle":{{"name":"{WS}:{style}"}}}}}}'],
                       capture_output=True, text=True)
    return r.stdout.strip()


PAIRS = [
    ("water_region", "basemap_water"),
    ("landuse_region", "basemap_landuse"),
    ("roads_vn", "basemap_roads_vn"),
    ("roads_region", "basemap_roads_region"),
    ("railways_vn", "basemap_railways"),
    ("places_vn", "basemap_places_vn"),
    ("places_region", "basemap_places_region"),
]

if __name__ == "__main__":
    pw = sys.argv[1]
    for name, xml in STYLES.items():
        print(f"style {name:<24} upload {upload(name, xml, pw)}")
    print()
    for layer, style in PAIRS:
        print(f"assign {layer:<18} -> {style:<24} {assign(layer, style, pw)}")
