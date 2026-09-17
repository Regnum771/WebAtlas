import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

/**
 * Exercises publish-contours.sh against a STUBBED `curl` on PATH, never a real
 * GeoServer — same "test the artifact/script itself" precedent as
 * contourStyles.test.ts, just for a shell script instead of a generated file.
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

const SCRIPT = join(process.cwd(), 'scripts', 'contours', 'publish-contours.sh');

let stubDir;

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'publish-contours-stub-'));
  const curlStub = `#!/usr/bin/env bash
url=""
fmt=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-w" ]; then
    fmt="$arg"
  fi
  case "$arg" in
    http*) url="$arg" ;;
  esac
  prev="$arg"
done

case "$url" in
  */featuretypes) code="\${STUB_FEATURETYPE_CREATE_CODE:-201}" ;;
  */featuretypes/*) code="\${STUB_FEATURETYPE_RETRY_CODE:-201}" ;;
  */layers/*) code="\${STUB_STYLE_CODE:-200}" ;;
  */gwc/rest/masstruncate) code="\${STUB_TRUNCATE_CODE:-200}" ;;
  *) code="000" ;;
esac

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

function run(env) {
  return spawnSync('bash', [SCRIPT], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubDir}${delimiter}${process.env.PATH}`,
      GEOSERVER_URL: 'http://fake-geoserver.invalid/geoserver',
      GEOSERVER_ADMIN_USER: 'admin',
      GEOSERVER_ADMIN_PASSWORD: 'wrong-password',
      ...env,
    },
  });
}

describe('publish-contours.sh — REST call failures must fail the publish', () => {
  it('exits non-zero and stops before truncating when GeoServer answers 401 (wrong password)', () => {
    const result = run({ STUB_FEATURETYPE_CREATE_CODE: '401' });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('featuretype: 401');
    // Must stop at the first failing call — a truncate after a failed publish
    // would blow away good cached tiles for nothing.
    expect(result.stdout).not.toContain('truncate:');
    expect(result.stdout).not.toContain('Done.');
  });

  it('exits non-zero when the featuretype call succeeds but the style assignment 403s', () => {
    const result = run({ STUB_FEATURETYPE_CREATE_CODE: '201', STUB_STYLE_CODE: '403' });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('style: 403');
    expect(result.stdout).not.toContain('truncate:');
    expect(result.stdout).not.toContain('Done.');
  });

  it('still succeeds through the existing 409 conflict-retry path', () => {
    const result = run({
      STUB_FEATURETYPE_CREATE_CODE: '409',
      STUB_FEATURETYPE_RETRY_CODE: '200',
      STUB_STYLE_CODE: '200',
      STUB_TRUNCATE_CODE: '200',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Done.');
  });
});
