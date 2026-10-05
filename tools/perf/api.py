"""Time representative API requests end to end: 5 runs each, report first, median and max.

Columns: status = HTTP status of the first run; first_s / med_s / max_s = seconds for the first
run / median / slowest of 5; kB = response size. Feature ids (a dam, the longest level-1 river, the
largest lake, the biggest roads reference entity) are looked up in the dev database at start via
`docker exec webatlas-db-1 psql`, so the db container must be running.
Base URL: WEBATLAS_API (default http://127.0.0.1:3001/api). Use 127.0.0.1, not localhost.
"""
import json
import os
import subprocess
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get('WEBATLAS_API', 'http://127.0.0.1:3001/api')


def db(query):
    """Run one scalar query in the dev database container and return the single value."""
    out = subprocess.run(
        ['docker', 'exec', 'webatlas-db-1', 'psql', '-U', 'webatlas', '-d', 'webatlas', '-At', '-c', query],
        env={**os.environ, 'MSYS_NO_PATHCONV': '1'}, capture_output=True, text=True, check=True).stdout.strip()
    if not out:
        raise SystemExit(f'no row for query: {query}')
    return out


DAM = db('SELECT id FROM water.dams_active WHERE geom IS NOT NULL ORDER BY external_id LIMIT 1')
RIVER = db('SELECT id FROM water.rivers_active WHERE feature_level = 1 ORDER BY ST_Length(geom::geography) DESC LIMIT 1')
LAKE = db('SELECT id FROM water.lakes_active ORDER BY area_km2 DESC NULLS LAST LIMIT 1')
REF_LAYER = 'roads'
REF_ID = db("SELECT entity_id FROM basemap.reference_entities WHERE layer_key = 'roads' ORDER BY member_count DESC LIMIT 1")


def square(lon, lat, d):
    return {'type': 'Polygon', 'coordinates': [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]]}


LINE = {'type': 'LineString', 'coordinates': [[108.0, 12.65], [108.06, 12.7]]}
ALL4 = ['dams', 'rivers', 'lakes', 'stations']

CASES = [
    ('GET', 'search "thu"', '/search?' + urllib.parse.urlencode({'q': 'thu'}), None),
    ('GET', 'search "buon ma"', '/search?' + urllib.parse.urlencode({'q': 'buon ma'}), None),
    ('GET', 'layers list', '/layers', None),
    ('GET', 'admin units', '/admin-units?level=province', None),
    ('GET', 'reference layers', '/reference/layers', None),
    ('GET', 'reference entity', f'/reference/{REF_LAYER}/entities/{urllib.parse.quote(REF_ID, safe="")}', None),
    ('GET', 'feature geometry (river)', f'/features/rivers/{RIVER}/geometry', None),
    ('POST', 'roi/resolve province 66', '/roi/resolve', {'roi': {'source': 'admin', 'level': 'province', 'code': '66'}}),
    ('POST', 'roi/resolve longest river +10km', '/roi/resolve', {'roi': {'source': 'feature', 'layerKey': 'rivers', 'featureId': RIVER, 'radiusKm': 10}}),
    ('POST', 'select_within drawn 4km', '/analysis/select_within', {'roi': {'source': 'drawn', 'geometry': square(108.05, 12.68, 0.02)}, 'layerKeys': ALL4}),
    ('POST', 'select_within province 68', '/analysis/select_within', {'roi': {'source': 'admin', 'level': 'province', 'code': '68'}, 'layerKeys': ALL4}),
    ('POST', 'select_within river +10km', '/analysis/select_within', {'roi': {'source': 'feature', 'layerKey': 'rivers', 'featureId': RIVER, 'radiusKm': 10}, 'layerKeys': ALL4}),
    ('POST', 'select_within lake (own area)', '/analysis/select_within', {'roi': {'source': 'feature', 'layerKey': 'lakes', 'featureId': LAKE}, 'layerKeys': ALL4}),
    ('POST', 'nearest 5 dams from dam', '/analysis/nearest', {'roi': {'source': 'feature', 'layerKey': 'dams', 'featureId': DAM}, 'layerKey': 'dams', 'k': 5}),
    ('POST', 'nearest 5 rivers from point', '/analysis/nearest', {'roi': {'source': 'drawn', 'geometry': {'type': 'Point', 'coordinates': [108.05, 12.68]}, 'radiusKm': 1}, 'layerKey': 'rivers', 'k': 5}),
    ('POST', 'elevation_profile 6 km line', '/analysis/elevation_profile', {'roi': {'source': 'drawn', 'geometry': LINE}}),
    ('POST', 'zonal_elevation 4 km square', '/analysis/zonal_elevation', {'roi': {'source': 'drawn', 'geometry': square(108.05, 12.68, 0.02)}}),
    ('GET', 'elevation at point', '/elevation?' + urllib.parse.urlencode({'lon': 108.05, 'lat': 12.68}), None),
]


def call(method, path, body):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'} if data else {})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        payload = e.read()
        status = e.code
    return time.perf_counter() - t, status, len(payload)


print(f"{'request':34} {'status':>6} {'first_s':>8} {'med_s':>7} {'max_s':>7} {'kB':>8}")
for method, label, path, body in CASES:
    runs = [call(method, path, body) for _ in range(5)]
    times = [t for t, _, _ in runs]
    print(f'{label:34} {runs[0][1]:>6} {times[0]:8.3f} {statistics.median(times):7.3f} {max(times):7.3f} {runs[0][2] / 1024:8.1f}', flush=True)
