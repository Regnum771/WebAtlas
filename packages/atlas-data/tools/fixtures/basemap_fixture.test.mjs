import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * basemap_fixture.py against a STUBBED psql, in the style of publish-basemap.test.mjs: the stub
 * records what it was given and answers by the `fixture:<tag>` comment in the statement. What only
 * a real server can show (a row-count guard that rolls the load back, the digest itself) is proven
 * by the CI job, which runs load → reference:build → verify on every push.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'basemap_fixture.py');
const HAS_PYTHON = spawnSync('python3', ['--version']).status === 0;
// The absolute path of the bash these tests run under. On Windows a native python3 resolves a bare
// "bash" to System32's WSL launcher, not to Git Bash, so the stub is started through this path.
const BASH = spawnSync(
  'bash',
  ['-c', 'if command -v cygpath >/dev/null 2>&1; then cygpath -m "$(command -v bash)"; else command -v bash; fi'],
  { encoding: 'utf8' }
).stdout.trim();

const PSQL_STUB = `#!/usr/bin/env bash
sql=""; file=""; prev=""
for a in "$@"; do
  [ "$prev" = "-c" ] && sql="$a"
  [ "$prev" = "-f" ] && file="$a"
  prev="$a"
done
{ printf 'ARGV'; printf ' %s' "$@"; printf '\\n'; printf 'ENV %s %s %s %s\\n' "$PGHOST" "$PGPORT" "$PGUSER" "$PGDATABASE"; } >> "$STUB_LOG"
if [ "$file" = "-" ]; then cat > "$STUB_STDIN"; exit "\${STUB_LOAD_EXIT:-0}"; fi
case "$sql" in
  *fixture:existing*) printf '%s' "\${STUB_EXISTING:-}" ;;
  *fixture:rows*)     printf '%s\\n' "\${STUB_ROWS:-f}" ;;
  *fixture:digest*)   printf '%s' "\${STUB_DIGEST:-}" ;;
  *) echo "unexpected sql: $sql" >&2; exit 3 ;;
esac
`;

const PLACES = '1\tBuôn Ma Thuột\t0101\n2\t\\N\t0102\n';
const RAILWAYS = '7\t0103\n';
const DIGESTS = { places: 'a'.repeat(64), railways: 'b'.repeat(64) };

let dir, fixtureDir, log, stdinFile, stub;

function makeFixture() {
  const files = [
    { table: 'basemap.places_region', file: 'places_region.copy.gz', columns: ['osm_id', 'name', 'geometry'], body: PLACES },
    { table: 'basemap.railways_vn', file: 'railways_vn.copy.gz', columns: ['osm_id', 'geometry'], body: RAILWAYS },
  ];
  const manifest = {
    source: { extract: 'test-extract', licence: 'ODbL-1.0', attribution: 'test' },
    files: files.map(({ table, file, columns, body }) => {
      const gz = gzipSync(Buffer.from(body, 'utf8'));
      writeFileSync(join(fixtureDir, file), gz);
      return { table, file, rule: 'TRUE', columns, rows: body.split('\n').length - 1, sha256: createHash('sha256').update(gz).digest('hex') };
    }),
    referenceEntities: {
      places: { count: 2, sha256: DIGESTS.places },
      railways: { count: 1, sha256: DIGESTS.railways },
    },
  };
  writeFileSync(join(fixtureDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(fixtureDir, 'schema.sql'),
    'CREATE SCHEMA IF NOT EXISTS basemap;\nCREATE TABLE basemap.places_region (osm_id text, name text, geometry text);\nCREATE TABLE basemap.railways_vn (osm_id text, geometry text);\n'
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'basemap-fixture-'));
  fixtureDir = dir;
  log = join(dir, 'psql.log');
  stdinFile = join(dir, 'psql.stdin');
  stub = join(dir, 'psql-stub.sh');
  writeFileSync(stub, PSQL_STUB);
  makeFixture();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(command, env = {}) {
  return spawnSync('python3', command === null ? [SCRIPT] : [SCRIPT, command], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ATLAS_PSQL: `"${BASH}" "${stub.replaceAll('\\', '/')}"`,
      BASEMAP_FIXTURE_DIR: fixtureDir,
      STUB_LOG: log,
      STUB_STDIN: stdinFile,
      DATABASE_URL: 'postgres://ci_user:s3cret@db.example:6543/ci_db',
      ...env,
    },
  });
}

describe.skipIf(!HAS_PYTHON)('basemap_fixture.py load', { timeout: 60000 }, () => {
  it('loads every table in one transaction: drop, schema, COPY, row-count guard, ANALYZE', () => {
    const r = run('load');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const sent = readFileSync(stdinFile, 'utf8');
    const order = [
      'DROP TABLE IF EXISTS basemap.places_region;',
      'CREATE TABLE basemap.places_region',
      'COPY basemap.places_region ("osm_id", "name", "geometry") FROM STDIN;',
      '1\tBuôn Ma Thuột\t0101',
      '\\.',
      'basemap.places_region: loaded % rows, the manifest says 2',
      'ANALYZE basemap.places_region;',
      'COPY basemap.railways_vn ("osm_id", "geometry") FROM STDIN;',
    ].map((needle) => sent.indexOf(needle));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const argv = readFileSync(log, 'utf8');
    expect(argv).toContain('--single-transaction');
    expect(argv).toContain('ON_ERROR_STOP=1');
  });

  it('hands psql the connection through PG* variables, never the password in argv', () => {
    expect(run('load').status).toBe(0);
    const seen = readFileSync(log, 'utf8');
    expect(seen).toContain('ENV db.example 6543 ci_user ci_db');
    expect(seen).not.toContain('s3cret');
  });

  it('stops before calling psql when a file does not match its sha256', () => {
    writeFileSync(join(fixtureDir, 'railways_vn.copy.gz'), gzipSync(Buffer.from('8\t0104\n')));
    const r = run('load');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('railways_vn.copy.gz');
    expect(r.stderr).toContain('sha256');
    expect(existsSync(log)).toBe(false);
  });

  it('refuses to load over a table that already holds rows', () => {
    // The fixture must never replace a real atlas. There is no force flag.
    const r = run('load', { STUB_EXISTING: 'places_region\n', STUB_ROWS: 't' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('basemap.places_region already holds rows');
    expect(existsSync(stdinFile)).toBe(false);
  });

  it('replaces a table that exists but is empty', () => {
    const r = run('load', { STUB_EXISTING: 'places_region\n', STUB_ROWS: 'f' });
    expect(r.status).toBe(0);
    expect(existsSync(stdinFile)).toBe(true);
  });

  it('fails when psql fails', () => {
    const r = run('load', { STUB_LOAD_EXIT: '3' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nothing was loaded');
  });
});

describe.skipIf(!HAS_PYTHON)('basemap_fixture.py verify', { timeout: 60000 }, () => {
  const built = (places, railways) => `places|2|${places}\n${railways === null ? '' : `railways|1|${railways}\n`}`;

  it('passes when every layer has the manifest count and digest', () => {
    const r = run('verify', { STUB_DIGEST: built(DIGESTS.places, DIGESTS.railways) });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('places');
  });

  it('fails and names the layer whose entity ids differ', () => {
    const r = run('verify', { STUB_DIGEST: built('c'.repeat(64), DIGESTS.railways) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('places');
    expect(r.stderr).not.toContain('railways');
  });

  it('fails when a layer was not built at all', () => {
    const r = run('verify', { STUB_DIGEST: built(DIGESTS.places, null) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('railways: built 0 entities, the manifest says 1');
  });
});

describe.skipIf(!HAS_PYTHON)('basemap_fixture.py usage', () => {
  it('exits 2 with a usage line when the command is missing or unknown', () => {
    for (const command of [null, 'bogus']) {
      const r = run(command);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage: basemap_fixture.py <build|load|verify>');
    }
  });
});
