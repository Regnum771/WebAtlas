import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Exercises publish-contours.sh against a STUBBED `curl` on PATH, never a real
 * GeoServer — same "test the artifact/script itself" precedent as
 * contours/styles.test.ts, just for a shell script instead of a generated file.
 *
 * The real `python3` runs unmodified (styles.py --print-intervals only reads
 * packages/shared/src/contours.ts; no `requests` import on that path, so it needs
 * nothing installed — see the deferred-import comment in styles.py).
 *
 * The stub returns canned HTTP status codes read from env vars, keyed by which
 * REST endpoint the real script is calling (matched by URL substring), and
 * echoes back whatever `-w` format string it was given (curl itself interprets
 * a literal "\n" in that format as a newline, so the stub must too).
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'publish-contours.sh');

let stubDir;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'publish-contours-stub-'));
  const curlStub = `#!/usr/bin/env bash
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
  "GET "*/layergroups/basemap)                code="\${STUB_GROUP_GET:-404}" ;;
  "POST "*/layergroups)                       code="\${STUB_GROUP_CREATE:-201}" ;;
  "PUT "*/layergroups/basemap)                code="\${STUB_GROUP_UPDATE:-200}" ;;
  "PUT "*/layers/*)                           code="\${STUB_STYLE:-200}" ;;
  "POST "*/gwc/rest/masstruncate)             code="\${STUB_TRUNCATE:-200}" ;;
  "POST "*/gwc/rest/seed/*)                   code="\${STUB_SEED:-200}" ;;
  *) code="000" ;;
esac
if [ -n "\${STUB_LOG:-}" ] && [ "$method" != GET ]; then
  printf '%s %s %s\n' "$method" "$url" "$(printf '%s' "$body" | tr -d '\n')" >> "$STUB_LOG"
fi
out="\${fmt//%\\{http_code\\}/\$code}"
printf '%b' "\$out"
`;
  const curlPath = join(stubDir, 'curl');
  writeFileSync(curlPath, curlStub);
  chmodSync(curlPath, 0o755);
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

function run(env, args = []) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
      GEOSERVER_URL: 'http://fake-geoserver.invalid/geoserver',
      GEOSERVER_ADMIN_USER: 'admin',
      GEOSERVER_ADMIN_PASSWORD: 'wrong-password',
      GEOSERVER_DB_PASSWORD: 'pw',
      ...env,
    },
  });
}

describe('publish-contours.sh — REST call failures must fail the publish', { timeout: 60000 }, () => {
  it('publishes every interval and truncates each', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Done.');
  });

  it('exits non-zero and stops before truncating when a featuretype call 401s', () => {
    const r = run({ STUB_FT_CREATE: '401' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/featuretype contours_\d+: 401/);
    expect(r.stdout).not.toContain('truncate:');
  });

  it('exits non-zero and stops before truncating when the style assignment 403s', () => {
    const r = run({ STUB_STYLE: '403' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('style: 403');
    expect(r.stdout).not.toContain('truncate:');
  });

  it('updates an existing featuretype with PUT', () => {
    const r = run({ STUB_FT_GET: '200', STUB_FT_UPDATE: '200' });
    expect(r.status).toBe(0);
  });

  it('creates the basemap_pg store itself when the basemap was never published', () => {
    const r = run({ STUB_STORE_GET: '404', STUB_STORE_CREATE: '201' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('datastore: 201');
  });

  it('seed starts one background GWC seed per interval with its zoom range, and publishes nothing', () => {
    const log = join(stubDir, 'seed.log');
    rmSync(log, { force: true });
    const r = run({ STUB_LOG: log }, ['seed']);
    expect(r.status).toBe(0);
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    const expected = { contours_250: [5, 8], contours_100: [9, 10], contours_50: [11, 12] };
    expect(lines).toHaveLength(3);
    for (const [name, [z0, z1]] of Object.entries(expected)) {
      const line = lines.find((l) =>
        l.startsWith(`POST http://fake-geoserver.invalid/geoserver/gwc/rest/seed/webatlas:${name}.json `)
      );
      expect(line, `no seed POST for ${name}`).toBeDefined();
      for (const part of [
        '"type":"seed"', '"gridSetId":"EPSG:900913"', '"format":"image/png"', '"threadCount":2',
        `"zoomStart":${z0}`, `"zoomStop":${z1}`,
        '"coords":{"double":[11855526,1175453,12245144,1874312]}',
      ]) expect(line).toContain(part);
      expect(line).not.toContain('parameters');
    }
  });

  it('seed fails on a non-2xx from GeoServer', () => {
    const r = run({ STUB_SEED: '500' }, ['seed']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('seed contours_250: 500');
  });
});
