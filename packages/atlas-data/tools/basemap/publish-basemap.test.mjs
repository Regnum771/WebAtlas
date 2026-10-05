import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * publish-basemap.sh against a STUBBED curl: the stub answers by METHOD and URL from env vars,
 * never a real GeoServer. Since Plan B the script runs unattended as a registry stage, so any
 * non-2xx must fail it — a silent failure would be recorded as a successful build.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'publish-basemap.sh');
let stubDir;
/** The layer groups apps/web requests from GWC (MapModel.ts): the base and the four context layers. */
const GROUPS = ['basemap', 'bm_landuse', 'bm_water', 'bm_railways', 'basemap_roads'];

const CURL_STUB = `#!/usr/bin/env bash
method=GET; url=""; fmt=""; prev=""; body=""
for arg in "$@"; do
  [ "$prev" = "-w" ] && fmt="$arg"
  if [ "$prev" = "-d" ] || [ "$prev" = "--data" ]; then body="$arg"; fi
  case "$arg" in -XPOST) method=POST ;; -XPUT) method=PUT ;; -XDELETE) method=DELETE ;; http*) url="$arg" ;; esac
  prev="$arg"
done
case "$method $url" in
  "GET "*/workspaces/webatlas)                code="\${STUB_WS_GET:-200}" ;;
  "POST "*/workspaces)                        code="\${STUB_WS_CREATE:-201}" ;;
  "GET "*/datastores/basemap_pg)              code="\${STUB_STORE_GET:-200}" ;;
  "POST "*/datastores)                        code="\${STUB_STORE_CREATE:-201}" ;;
  "GET "*/featuretypes/*)                     code="\${STUB_FT_GET:-404}" ;;
  "POST "*/featuretypes)                      code="\${STUB_FT_CREATE:-201}" ;;
  "PUT "*/featuretypes/*)                     code="\${STUB_FT_UPDATE:-200}" ;;
  "GET "*/styles/*.json)                      code="\${STUB_STYLE_GET:-200}" ;;
  # Measured on GeoServer 2.26 (2026-10-04): a style URL with no extension answers 500 under curl's
  # default Accept, whether or not the style exists. Only the .json form says 200 or 404.
  "GET "*/styles/*)                           code="500" ;;
  "GET "*/layergroups/*)                      code="\${STUB_GROUP_GET:-404}" ;;
  "POST "*/layergroups)                       code="\${STUB_GROUP_CREATE:-201}" ;;
  "PUT "*/layergroups/*)                      code="\${STUB_GROUP_UPDATE:-200}" ;;
  "POST "*/gwc/rest/masstruncate)             code="\${STUB_TRUNCATE:-200}" ;;
  "POST "*/gwc/rest/seed/*)                   code="\${STUB_SEED:-200}" ;;
  *) code="000" ;;
esac
# Every write is logged with its body on one line, so a test can assert what was sent.
if [ -n "\${STUB_LOG:-}" ] && [ "$method" != GET ]; then
  printf '%s %s %s\\n' "$method" "$url" "$(printf '%s' "$body" | tr -d '\\n')" >> "$STUB_LOG"
fi
out="\${fmt//%\\{http_code\\}/\$code}"
printf '%b' "\$out"
`;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'publish-basemap-stub-'));
  writeFileSync(join(stubDir, 'curl'), CURL_STUB);
  chmodSync(join(stubDir, 'curl'), 0o755);
});
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

function run(env, mode = 'featuretypes') {
  return spawnSync('bash', mode === null ? [SCRIPT] : [SCRIPT, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
      GEOSERVER_URL: 'http://fake-geoserver.invalid/geoserver',
      GEOSERVER_ADMIN_USER: 'admin',
      GEOSERVER_ADMIN_PASSWORD: 'pw',
      GEOSERVER_DB_PASSWORD: 'pw',
      ...env,
    },
  });
}

describe('publish-basemap.sh — fail closed, idempotent', { timeout: 60000 }, () => {
  it('publishes from scratch: featuretypes, then group with truncate', () => {
    const f = run({}, 'featuretypes');
    expect(f.status).toBe(0);
    expect(f.stdout).not.toContain('layergroup');
    expect(f.stdout).not.toContain('truncate:');
    const g = run({}, 'group');
    expect(g.status).toBe(0);
    for (const name of GROUPS) {
      expect(g.stdout).toContain(`layergroup ${name}: 201`);
      expect(g.stdout).toContain(`truncate ${name}: 200`);
    }
    expect(g.stdout).toContain('Done.');
  });

  it('publishes the land-only base and one group per context layer, as the web app requests them', () => {
    // MapModel.ts asks GWC for webatlas:basemap plus these four. A composite base would draw the
    // context layers twice and make their toggles do nothing.
    const log = join(stubDir, 'group-bodies.log');
    rmSync(log, { force: true });
    expect(run({ STUB_LOG: log }, 'group').status).toBe(0);
    const posts = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('POST') && l.includes('/layergroups '));
    const layersOf = (name) => {
      const line = posts.find((l) => l.includes(`"layerGroup":{"name":"${name}"`));
      expect(line, `no POST for group ${name}`).toBeDefined();
      return [...line.matchAll(/"@type":"layer","name":"webatlas:([a-z_]+)"/g)].map((m) => m[1]);
    };
    expect(layersOf('basemap')).toEqual(['land_vn']);
    expect(layersOf('bm_landuse')).toEqual(['landuse_region']);
    expect(layersOf('bm_water')).toEqual(['water_region']);
    expect(layersOf('bm_railways')).toEqual(['railways_vn']);
    expect(layersOf('basemap_roads')).toEqual(['roads_region', 'roads_vn']);
    // Identical national bounds on every group: OpenLayers asks for tiles on the national grid, and
    // a tighter group would answer 400 TileOutOfRange.
    for (const line of posts) expect(line).toContain('"minx":102.0,"maxx":117.9,"miny":8.0,"maxy":23.5');
    expect(posts).toHaveLength(GROUPS.length);
  });

  it('refuses to build a group whose style is missing, before creating anything', () => {
    // GeoServer accepts a group that names a missing style (2xx) and then draws the layer unstyled.
    const log = join(stubDir, 'no-style.log');
    rmSync(log, { force: true });
    const r = run({ STUB_STYLE_GET: '404', STUB_LOG: log }, 'group');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('basemap_land');
    expect(r.stderr).toContain('styles.py');
    expect(existsSync(log)).toBe(false);
  });

  it('never truncates when a layer group is rejected', () => {
    const r = run({ STUB_GROUP_CREATE: '500' }, 'group');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('layergroup basemap: 500');
    expect(r.stdout).not.toContain('truncate');
  });

  it('updates existing feature types with PUT', () => {
    const r = run({ STUB_FT_GET: '200' }, 'featuretypes');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('featuretype land_vn: 200');
  });

  it('updates an existing layer group with PUT', () => {
    const r = run({ STUB_GROUP_GET: '200' }, 'group');
    expect(r.status).toBe(0);
    for (const name of GROUPS) expect(r.stdout).toContain(`layergroup ${name}: 200`);
  });

  it('seed starts one GWC seed per group over the working region and does nothing else', () => {
    const log = join(stubDir, 'seed.log');
    rmSync(log, { force: true });
    const r = run({ STUB_LOG: log, GEOSERVER_ADMIN_PASSWORD: 'sekrit-pw' }, 'seed');
    expect(r.status).toBe(0);
    const text = readFileSync(log, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(GROUPS.length);
    for (const name of GROUPS) {
      const line = lines.find((l) =>
        l.startsWith(`POST http://fake-geoserver.invalid/geoserver/gwc/rest/seed/webatlas:${name}.json `)
      );
      expect(line, `no seed POST for ${name}`).toBeDefined();
      for (const part of [
        '"type":"seed"', '"gridSetId":"EPSG:900913"', '"format":"image/png"',
        '"zoomStart":5', '"zoomStop":12', '"threadCount":2',
        '"coords":{"double":[11855526,1175453,12245144,1874312]}',
      ]) expect(line).toContain(part);
    }
    // The password reaches curl through -u only, never in the URL or body.
    expect(text).not.toContain('sekrit-pw');
  });

  it('seed fails on a non-2xx from GeoServer', () => {
    const r = run({ STUB_SEED: '500' }, 'seed');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('seed basemap: 500');
  });

  it('exits 2 with a usage line when the mode is missing or unknown', () => {
    for (const mode of [null, 'bogus']) {
      const r = run({}, mode);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage: publish-basemap.sh <featuretypes|group|seed>');
    }
  });

  it('fails fast when the store must be created without GEOSERVER_DB_PASSWORD', () => {
    const r = run({ STUB_STORE_GET: '404', GEOSERVER_DB_PASSWORD: '' }, 'featuretypes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('GEOSERVER_DB_PASSWORD');
    expect(r.stdout).not.toContain('datastore:');
  });

  it('fails and never truncates when the datastore cannot be created', () => {
    const r = run({ STUB_STORE_GET: '404', STUB_STORE_CREATE: '401' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('datastore: 401');
    expect(r.stdout).not.toContain('truncate:');
  });

  it('fails on an existence check that is neither 200 nor 404', () => {
    const r = run({ STUB_WS_GET: '500' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('returned 500');
  });

  it('refuses to run without the admin password in the environment', () => {
    const r = run({ GEOSERVER_ADMIN_PASSWORD: '' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('GEOSERVER_ADMIN_PASSWORD');
  });
});
