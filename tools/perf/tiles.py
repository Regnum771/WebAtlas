"""Time GWC WMTS tiles: a 4x4 block per layer and zoom, first request then repeat (cache).

Columns: first_med_s / first_max_s = median / max seconds of the 16 first requests; repeat_med_s =
median of the 16 repeat requests (should be a cache hit); first_hits = how many first requests
were already cached (geowebcache-cache-result: HIT); kB/tile = mean tile size.
Base URL: WEBATLAS_GEOSERVER (default http://127.0.0.1:8080/geoserver). Use 127.0.0.1, not localhost.
Zooms: WEBATLAS_TILE_ZOOMS (default 9,11,13, the baseline's). The seed covers zooms 5-12, so add 12 to
check it: WEBATLAS_TILE_ZOOMS=9,11,12,13.
"""
import math
import os
import statistics
import time
import urllib.error
import urllib.request

GS = os.environ.get('WEBATLAS_GEOSERVER', 'http://127.0.0.1:8080/geoserver')
LAYERS = ['webatlas:basemap', 'webatlas:basemap_roads', 'webatlas:bm_water', 'webatlas:bm_landuse',
          'webatlas:bm_railways', 'webatlas:contours_100', 'webatlas:contours_50']
# Around Buon Ma Thuot (108.05E, 12.68N); zooms the app actually shows
LON, LAT = 108.05, 12.68
ZOOMS = [int(z) for z in os.environ.get('WEBATLAS_TILE_ZOOMS', '9,11,13').split(',')]


def tile_xy(z):
    n = 2 ** z
    x = int((LON + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(LAT))) / math.pi) / 2 * n)
    return x, y


def fetch(layer, z, x, y):
    url = (f'{GS}/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER={layer}&STYLE='
           f'&TILEMATRIXSET=EPSG:900913&FORMAT=image/png&TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}')
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            body = r.read()
            cache = r.headers.get('geowebcache-cache-result', '?')
    except urllib.error.HTTPError as e:
        return time.perf_counter() - t, 0, f'HTTP{e.code}'
    return time.perf_counter() - t, len(body), cache


print(f"{'layer':24} {'z':>2} {'first_med_s':>11} {'first_max_s':>11} {'repeat_med_s':>12} {'first_hits':>10} {'kB/tile':>8}")
for layer in LAYERS:
    for z in ZOOMS:
        cx, cy = tile_xy(z)
        coords = [(cx + dx, cy + dy) for dx in range(-2, 2) for dy in range(-2, 2)]
        first = [fetch(layer, z, x, y) for x, y in coords]
        repeat = [fetch(layer, z, x, y) for x, y in coords]
        f_times = [t for t, _, _ in first]
        hits = sum(1 for _, _, c in first if c == 'HIT')
        kb = statistics.mean(b for _, b, _ in first) / 1024
        errs = {c for _, _, c in first if c.startswith('HTTP')}
        print(f'{layer:24} {z:>2} {statistics.median(f_times):11.3f} {max(f_times):11.3f} '
              f'{statistics.median(t for t, _, _ in repeat):12.3f} {hits:>7}/16 {kb:8.1f} {" ".join(errs)}', flush=True)
