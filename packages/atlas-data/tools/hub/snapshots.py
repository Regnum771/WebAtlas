"""
Renders the four layers of the hub's hero stack (spec "Surfaces -> Hub") as square WebP images of the same
extent: terrain, basemap, rivers, flood depth. Run by hand in the atlas-tools image when the data changes;
the images are committed under apps/web/src/pages/trang-chu/assets/.

    python3 packages/atlas-data/tools/hub/snapshots.py --out apps/web/src/pages/trang-chu/assets

- terrain: a hillshade of the FABDEM raster in PostGIS (basemap.dem_region), tinted light, with the 100 m
  contours (webatlas:contours_100, style contours_plain) over it;
- basemap: the self-hosted OSM basemap as the map draws it: land, then land use, water, railways, roads;
- rivers: the river network (webatlas:rivers) in three widths by kind (stream, canal, river), in the water
  colour, on a transparent ground (no basin layer exists yet);
- flood: the peak depth of a HEC-RAS run (--flood-layer, default the 10/2025 Thu Bồn - Vu Gia run) in the
  spec's violet ramp, on a transparent ground.

Environment (tools service): GEOSERVER_URL, GEOSERVER_ADMIN_USER, GEOSERVER_ADMIN_PASSWORD, PG* for the DEM.
"""
import argparse
import io
import math
import os
import sys

import numpy as np
import requests

# The extent of the 10/2025 HEC-RAS run (its catalogue bbox), which frames every layer.
EXTENT_4326 = (107.585, 15.268, 108.321, 15.978)
SIZE = 900
FLOOD_LAYER = "geonode:ts_7cba03198bc64faf_peak"
# The street basemap's stack in the app (MapModel CONTEXT_LAYERS over the basemap tiles), bottom to top.
BASEMAP_LAYERS = "webatlas:basemap,webatlas:bm_landuse,webatlas:bm_water,webatlas:bm_railways,webatlas:basemap_roads"
# Flood depth, violet so it never reads as basemap water (tokens depth-1..4), from 0.1 m.
DEPTH_RAMP = [(0.1, "#C9C3EA"), (0.5, "#9A8FD6"), (1.5, "#6B5BB8"), (3.0, "#3F2E8C")]
# Terrain tint: hillshade blended toward the panel ground (surface-2) so it reads as relief, not a photo.
TINT_LIGHT = (247, 248, 245)
TINT_DARK = (120, 128, 118)
R = 6378137.0


def to_mercator(lon, lat):
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    return x, y


def square_box_3857(extent_4326, pad=0.04):
    """The extent in EPSG:3857, grown to a square around its centre, plus `pad` of its side on each edge."""
    x0, y0 = to_mercator(extent_4326[0], extent_4326[1])
    x1, y1 = to_mercator(extent_4326[2], extent_4326[3])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = max(x1 - x0, y1 - y0) / 2 * (1 + 2 * pad)
    return (cx - half, cy - half, cx + half, cy + half)


def getmap_params(layer, box, size=SIZE, style="", transparent=True, sld_body=None):
    """WMS 1.1.1 GetMap parameters for one PNG of the square box."""
    params = {
        "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": layer, "styles": style,
        "srs": "EPSG:3857", "bbox": ",".join(f"{v:.3f}" for v in box), "width": str(size), "height": str(size),
        "format": "image/png", "transparent": "true" if transparent else "false",
    }
    if sld_body:
        params["sld_body"] = sld_body
    return params


def depth_sld(layer, ramp=DEPTH_RAMP):
    """An SLD for the depth raster: transparent below the first stop, the violet ramp above."""
    entries = ['<ColorMapEntry color="#000000" quantity="0" opacity="0"/>']
    entries.append(f'<ColorMapEntry color="{ramp[0][1]}" quantity="{ramp[0][0] - 0.0001:.4f}" opacity="0"/>')
    entries += [f'<ColorMapEntry color="{c}" quantity="{q}" opacity="0.92"/>' for q, c in ramp]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">'
        f'<NamedLayer><Name>{layer}</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer>'
        f'<ColorMap type="ramp">{"".join(entries)}</ColorMap>'
        '</RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>'
    )


# The river network in three levels by kind (rivers.stream_order ranks kinds, osm-water.ts): streams and
# ditches thin, canals middling, rivers wide. One FeatureTypeStyle per level, so the wider draw on top.
RIVER_LAYER = "webatlas:rivers"
RIVER_LEVELS = [((None, 3), 0.55), ((3, 5), 1.1), ((5, None), 2.0)]
WATER = "#0F6E8C"


def _order_filter(lo, hi):
    """stream_order in [lo, hi), either end open when None."""
    parts = []
    if lo is not None:
        parts.append(f"<ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyName>stream_order</ogc:PropertyName>"
                     f"<ogc:Literal>{lo}</ogc:Literal></ogc:PropertyIsGreaterThanOrEqualTo>")
    if hi is not None:
        parts.append(f"<ogc:PropertyIsLessThan><ogc:PropertyName>stream_order</ogc:PropertyName>"
                     f"<ogc:Literal>{hi}</ogc:Literal></ogc:PropertyIsLessThan>")
    inner = parts[0] if len(parts) == 1 else f"<ogc:And>{''.join(parts)}</ogc:And>"
    return f"<ogc:Filter>{inner}</ogc:Filter>"


def river_sld(layer=RIVER_LAYER, levels=RIVER_LEVELS, colour=WATER):
    """An SLD drawing the network in three widths by kind, thinnest first."""
    styles = "".join(
        f"<FeatureTypeStyle><Rule>{_order_filter(lo, hi)}<LineSymbolizer><Stroke>"
        f"<CssParameter name=\"stroke\">{colour}</CssParameter>"
        f"<CssParameter name=\"stroke-width\">{width}</CssParameter>"
        f"<CssParameter name=\"stroke-linecap\">round</CssParameter>"
        f"</Stroke></LineSymbolizer></Rule></FeatureTypeStyle>"
        for (lo, hi), width in levels
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">'
        f"<NamedLayer><Name>{layer}</Name><UserStyle>{styles}</UserStyle></NamedLayer></StyledLayerDescriptor>"
    )


def hillshade(elevation, cell, azimuth=315.0, altitude=45.0, z=4.0):
    """Hillshade in 0..1 of an elevation grid with square cells of `cell` metres (nodata as NaN gives 1).
    `z` exaggerates the relief: at about 90 m a pixel, true heights shade too faintly to read."""
    dy, dx = np.gradient(np.nan_to_num(elevation, nan=0.0) * z, cell)
    slope = np.pi / 2 - np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    az, alt = np.radians(azimuth), np.radians(altitude)
    shade = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    shade[np.isnan(elevation)] = 1.0
    return shade


def tint(shade):
    """RGB uint8 from a 0..1 hillshade, between the dark and light terrain tints."""
    s = shade[..., None]
    return (np.array(TINT_DARK) + (np.array(TINT_LIGHT) - np.array(TINT_DARK)) * s).astype(np.uint8)


# ---- I/O --------------------------------------------------------------------------------------------------


def _wms_png(layer, box, **kw):
    import rasterio
    url = os.environ["GEOSERVER_URL"].rstrip("/") + "/wms"
    auth = (os.environ["GEOSERVER_ADMIN_USER"], os.environ["GEOSERVER_ADMIN_PASSWORD"])
    params = getmap_params(layer, box, **kw)
    # SLD_BODY can pass the URL limit: POST it as a form.
    r = requests.post(url, data=params, auth=auth, timeout=300) if "sld_body" in params else requests.get(url, params=params, auth=auth, timeout=300)
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        raise RuntimeError(f"GetMap {layer} -> {r.status_code} {r.headers.get('content-type')}: {r.text[:300]}")
    with rasterio.MemoryFile(r.content) as mem, mem.open() as src:
        return to_rgba(src.read(), _colormap(src))


def _colormap(src):
    try:
        return src.colormap(1) if src.count == 1 else None
    except ValueError:
        return None


def to_rgba(a, colormap=None):
    """Any PNG GeoServer returns (paletted, grey, grey + alpha, RGB, RGBA), as RGBA band first."""
    if a.shape[0] == 1 and colormap:
        lut = np.zeros((256, 4), np.uint8)
        for i, rgba in colormap.items():
            lut[i] = rgba
        return np.moveaxis(lut[a[0]], -1, 0)
    if a.shape[0] == 1:
        a = np.concatenate([a, a, a])
    elif a.shape[0] == 2:
        a = np.concatenate([a[:1], a[:1], a[:1], a[1:]])
    if a.shape[0] == 3:
        a = np.concatenate([a, np.full((1,) + a.shape[1:], 255, np.uint8)])
    return a


def _dem_3857(box, size=SIZE):
    """The DEM under the box, warped onto the square 3857 grid; NaN where there is none."""
    import psycopg2
    import rasterio
    from rasterio.warp import Resampling, reproject, transform_bounds
    from rasterio.transform import from_bounds
    w, s, e, n = transform_bounds("EPSG:3857", "EPSG:4326", *box)
    sql = """
        SELECT ST_AsGDALRaster(ST_Union(ST_Clip(rast, env)), 'GTiff')
        FROM basemap.dem_region, ST_MakeEnvelope(%s, %s, %s, %s, 4326) AS env
        WHERE ST_Intersects(rast, env)
    """
    with psycopg2.connect() as conn, conn.cursor() as cur:
        # PostGIS ships with its GDAL output drivers off; this session needs GTiff.
        cur.execute("SET postgis.gdal_enabled_drivers = 'GTiff'")
        cur.execute(sql, (w, s, e, n))
        blob = cur.fetchone()[0]
    if blob is None:
        raise RuntimeError("no DEM under the hub extent")
    out = np.full((size, size), np.nan, np.float32)
    with rasterio.MemoryFile(bytes(blob)) as mem, mem.open() as src:
        reproject(
            source=rasterio.band(src, 1), destination=out, dst_transform=from_bounds(*box, size, size),
            dst_crs="EPSG:3857", src_nodata=src.nodata, dst_nodata=np.nan, resampling=Resampling.bilinear,
        )
    return out


def _over(base_rgba, top_rgba):
    """Alpha-composites `top` over `base` (both RGBA, band first, uint8)."""
    b, t = base_rgba.astype(np.float32) / 255, top_rgba.astype(np.float32) / 255
    a = t[3] + b[3] * (1 - t[3])
    rgb = (t[:3] * t[3] + b[:3] * b[3] * (1 - t[3])) / np.where(a == 0, 1, a)
    return (np.concatenate([rgb, a[None]]) * 255).round().astype(np.uint8)


def _write_webp(path, rgba, opaque):
    import rasterio
    bands = rgba[:3] if opaque else rgba
    with rasterio.open(path, "w", driver="WEBP", width=bands.shape[2], height=bands.shape[1], count=bands.shape[0],
                       dtype="uint8", QUALITY=82) as dst:
        dst.write(bands)


def render(out_dir, flood_layer=FLOOD_LAYER, size=SIZE):
    box = square_box_3857(EXTENT_4326)
    os.makedirs(out_dir, exist_ok=True)
    cell = (box[2] - box[0]) / size

    # 1. Terrain: tinted hillshade, contours over it.
    shade = tint(hillshade(_dem_3857(box, size), cell))
    terrain = np.concatenate([np.moveaxis(shade, -1, 0), np.full((1, size, size), 255, np.uint8)])
    terrain = _over(terrain, _wms_png("webatlas:contours_100", box, size=size, style="contours_plain"))
    _write_webp(os.path.join(out_dir, "stack-terrain.webp"), terrain, opaque=True)

    # 2. Basemap, opaque. 3. Rivers and 4. flood depth, transparent.
    _write_webp(os.path.join(out_dir, "stack-basemap.webp"), _wms_png(BASEMAP_LAYERS, box, size=size, transparent=False), opaque=True)
    _write_webp(os.path.join(out_dir, "stack-rivers.webp"), _wms_png(RIVER_LAYER, box, size=size, sld_body=river_sld()), opaque=False)
    _write_webp(os.path.join(out_dir, "stack-flood.webp"),
                _wms_png(flood_layer, box, size=size, sld_body=depth_sld(flood_layer)), opaque=False)
    for name in ("terrain", "basemap", "rivers", "flood"):
        p = os.path.join(out_dir, f"stack-{name}.webp")
        print(f"{p}: {os.path.getsize(p) // 1024} KiB")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--flood-layer", default=FLOOD_LAYER)
    ap.add_argument("--size", type=int, default=SIZE)
    args = ap.parse_args(argv)
    render(args.out, args.flood_layer, args.size)


if __name__ == "__main__":
    sys.exit(main())
