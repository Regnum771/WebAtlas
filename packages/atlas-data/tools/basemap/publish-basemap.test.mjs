import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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

const CURL_STUB = `#!/usr/bin/env bash
method=GET; url=""; fmt=""; prev=""
for arg in "$@"; do
  [ "$prev" = "-w" ] && fmt="$arg"
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
  "GET "*/layergroups/basemap)                code="\${STUB_GROUP_GET:-404}" ;;
  "POST "*/layergroups)                       code="\${STUB_GROUP_CREATE:-201}" ;;
  "PUT "*/layergroups/basemap)                code="\${STUB_GROUP_UPDATE:-200}" ;;
  "POST "*/gwc/rest/masstruncate)             code="\${STUB_TRUNCATE:-200}" ;;
  *) code="000" ;;
esac
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
    expect(g.stdout).toContain('layergroup: 201');
    expect(g.stdout).toContain('truncate: 200');
    expect(g.stdout).toContain('Done.');
  });

  it('updates existing feature types with PUT', () => {
    const r = run({ STUB_FT_GET: '200' }, 'featuretypes');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('featuretype land_vn: 200');
  });

  it('updates an existing layer group with PUT', () => {
    const r = run({ STUB_GROUP_GET: '200' }, 'group');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('layergroup: 200');
  });

  it('exits 2 with a usage line when the mode is missing or unknown', () => {
    for (const mode of [null, 'bogus']) {
      const r = run({}, mode);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage: publish-basemap.sh <featuretypes|group>');
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
