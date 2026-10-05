"""Time WFS GetFeature per layer and view (cold = first request, warm = second), plain and gzip.

Columns: cold_s / warm_s = seconds for the first / second identical request; bytes = plain
response size; gzip = size with Accept-Encoding: gzip ("(no-gz)" if the server did not compress);
feats = number of features returned. Views z7 / z10 / z12 are fixed EPSG:3857 bboxes.
Base URL: WEBATLAS_GEOSERVER (default http://127.0.0.1:8080/geoserver). Use 127.0.0.1, not localhost.
"""
import gzip
import os
import json
import time
import urllib.request

GS = os.environ.get('WEBATLAS_GEOSERVER', 'http://127.0.0.1:8080/geoserver')
VIEWS = {
    'z7': '11243269,893464,12913061,2154936',
    'z10': '11977977,1379870,12089297,1471159',
    'z12': '12016939,1414070,12044769,1436892',
}
LAYERS = ['dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation',
          'lakes', 'rivers', 'rivers_overview']


def get(url, gz):
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'gzip'} if gz else {})
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=300) as r:
        body = r.read()
        enc = r.headers.get('Content-Encoding')
    return time.perf_counter() - t, body, enc


print(f"{'layer':20} {'view':4} {'cold_s':>7} {'warm_s':>7} {'bytes':>10} {'gzip':>9} {'feats':>6}")
for view, box in VIEWS.items():
    for layer in LAYERS:
        url = (f'{GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:{layer}'
               f'&outputFormat=application/json&srsName=EPSG:4326&bbox={box},EPSG:3857')
        cold, body, _ = get(url, False)
        warm, _, _ = get(url, False)
        _, gbody, enc = get(url, True)
        feats = len(json.loads(body).get('features', []))
        gz_size = len(gbody) if enc == 'gzip' else f'{len(gbody)}(no-gz)'
        print(f'{layer:20} {view:4} {cold:7.2f} {warm:7.2f} {len(body):>10} {gz_size!s:>9} {feats:>6}', flush=True)
