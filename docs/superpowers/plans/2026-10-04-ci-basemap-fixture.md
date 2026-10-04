# CI Basemap Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `api` CI job green on PR #19 by loading a committed fixture of real basemap data, so the reference, search, ROI and `locate_place` tests run in CI unchanged.

**Architecture:** One standard-library Python tool, `basemap_fixture.py`, with three subcommands: `build` cuts five gzipped PostgreSQL COPY files plus a schema file and a manifest from a built atlas; `load` puts them into an empty database through `psql`; `verify` checks that the entities built from the fixture equal the digest recorded from the real atlas. Two API fixes make that possible and correct: reference entity cluster numbers become independent of table row order, and `demAvailable` means "has rows".

**Tech Stack:** Python 3 standard library, `psql` and `pg_dump` 16, PostgreSQL 16 + PostGIS 3.4, TypeScript, Vitest 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md`

## Global Constraints

- Branch `feat/registry-plan-b`, stacked on PR #19 (spec D5). Do not create another branch.
- Commit messages are Vietnamese Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The fixture holds every row with a name or a route number, six provinces, nothing simplified (spec D2, §4). Do not trim it.
- No DEM data in CI (spec D3).
- The fixture must never overwrite a real atlas: `load` refuses when any target table holds rows, and there is no force flag (spec §7).
- No password in any argv (repo rule since Plan A): the connection reaches `psql` through `PG*` environment variables.
- `.sh`, `.py` and generated files are LF (`.gitattributes`).
- Only the dev stack exists on this machine (`webatlas-db-1`, `webatlas-geoserver-1`). Tasks 4 and 5 run against it and are **controller-run**, not delegated.

**Deviation from the spec's file names:** the spec lists three shell scripts. This plan implements them as one Python file with three subcommands, because all three need JSON, sha256 and gzip, and Python is present on the CI runner, in the atlas-tools image and on the dev host. The spec is updated in Task 5.

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/db/referenceEntities.ts` (modify) | Renumber DBSCAN clusters deterministically |
| `apps/api/src/db/referenceEntities.test.ts` (modify) | Numbering properties |
| `apps/api/src/modules/analysis/analysis.test.ts` (modify) | Hard-coded 699D entity id, if it moved |
| `apps/api/src/modules/analysis/dem.ts` (modify) | `demAvailable` = exists and has rows |
| `apps/api/src/modules/analysis/dem.test.ts` (create) | Unit test for the three cases |
| `packages/atlas-data/tools/fixtures/basemap_fixture.py` (create) | `build`, `load`, `verify` |
| `packages/atlas-data/tools/fixtures/basemap_fixture.test.mjs` (create) | `load` and `verify` against a stubbed `psql` |
| `packages/atlas-data/fixtures/basemap/*` (create, generated) | `schema.sql`, five `*.copy.gz`, `MANIFEST.json` |
| `packages/atlas-data/fixtures/basemap/README.md` (create) | What it is, attribution, how to regenerate |
| `packages/atlas-data/src/fixtures.test.ts` (create) | Manifest agrees with the committed files |
| `.gitattributes` (modify) | `*.copy.gz binary` |
| `.github/workflows/ci.yml` (modify) | Load, build, verify before `test:api` |

---

### Task 1: Deterministic reference entity numbering

**Files:**
- Modify: `apps/api/src/db/referenceEntities.ts` (the `c` CTE and the `FROM c` of the INSERT, about lines 80–100)
- Modify: `apps/api/src/db/referenceEntities.test.ts` (add two tests inside `describe('reference entity dissolve', …)`)
- Modify: `apps/api/src/modules/analysis/analysis.test.ts:324` (only if the id moved)

**Interfaces:**
- Consumes: nothing.
- Produces: `basemap.reference_entities.cluster_id` numbered from 0 per `(layer_key, entity_key)` in ascending order of each cluster's smallest member `osm_id` under the `"C"` collation. Entity ids keep the form `<layer>:<md5(entity_key)>:<cluster_id>`. Task 3's digest and Task 4's manifest depend on this being a function of the data only.

Background for the implementer: `ST_ClusterDBSCAN(…) OVER (PARTITION BY entity_key)` has no window ordering, so the numbers it hands out follow the table's physical row order. The grouping is stable; only the numbers move. Measured on the dev database: 1,206 road keys have more than one cluster and 11,005 member rows get a different number under ascending `osm_id` order.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('reference entity dissolve', () => {` in `apps/api/src/db/referenceEntities.test.ts`, after the test `'gives every entity a deterministic id and a non-empty member list'`:

```ts
  it('numbers the clusters of one key from 0 with no gaps', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT 1 FROM basemap.reference_entities
          GROUP BY layer_key, entity_key
         HAVING min(cluster_id) <> 0 OR max(cluster_id) <> count(*) - 1
       ) x`
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it('orders the clusters of one key by their smallest member id, not by table row order', async () => {
    // DBSCAN numbers clusters in the order rows reach its window, which follows the table's
    // physical order. The same data loaded in another order then produced other entity ids
    // (measured 2026-10-04: 11,005 road member rows numbered differently). Ties on the member id
    // are broken by geometry, so they are sorted by cluster_id here and cannot count as violations.
    const { rows } = await pool.query<{ n: string }>(
      `WITH e AS (
         SELECT layer_key, entity_key, cluster_id,
                (SELECT min(m COLLATE "C") FROM unnest(member_ids) AS m) AS first_member
           FROM basemap.reference_entities
       ), o AS (
         SELECT cluster_id,
                lag(cluster_id) OVER (PARTITION BY layer_key, entity_key ORDER BY first_member, cluster_id) AS prev
           FROM e
       )
       SELECT count(*)::text AS n FROM o WHERE prev IS NOT NULL AND cluster_id < prev`
    );
    expect(Number(rows[0].n)).toBe(0);
  });
```

- [ ] **Step 2: Run the tests to see the second one fail**

Run: `npm run test -w @webatlas/api -- src/db/referenceEntities.test.ts`
Expected: `numbers the clusters of one key from 0 with no gaps` PASSES (DBSCAN already numbers from 0; this test guards the renumbering). `orders the clusters of one key by their smallest member id…` FAILS with a count greater than 0.

- [ ] **Step 3: Renumber the clusters**

In `apps/api/src/db/referenceEntities.ts`, replace the `c` CTE:

```ts
      c AS (
        SELECT src.*,
               ST_ClusterDBSCAN(geometry, $2, 1) OVER (PARTITION BY entity_key) AS cluster_id
          FROM src
      )
```

with:

```ts
      raw AS (
        SELECT src.*,
               ST_ClusterDBSCAN(geometry, $2, 1) OVER (PARTITION BY entity_key) AS raw_cluster
          FROM src
      ),
      -- DBSCAN numbers clusters in the order rows reach its window, which follows the table's
      -- physical order: the same data loaded in another order got other numbers, and the number
      -- is part of the entity id. The grouping itself is stable, so each key's clusters are
      -- renumbered by their smallest member id ("C" collation: independent of the database
      -- locale). OSM ids repeat in the area tables, hence the geometry tie-break; raw_cluster
      -- comes last only so two numbers can never collide.
      k AS (
        SELECT entity_key, raw_cluster,
               (row_number() OVER (
                  PARTITION BY entity_key
                  ORDER BY min(osm_id COLLATE "C"),
                           min(md5(ST_AsEWKB(geometry)) COLLATE "C"),
                           raw_cluster
                ) - 1)::int AS cluster_id
          FROM raw
         GROUP BY entity_key, raw_cluster
      ),
      c AS (
        SELECT raw.*, k.cluster_id
          FROM raw JOIN k USING (entity_key, raw_cluster)
      )
```

Nothing below it changes: the INSERT still selects `FROM c … GROUP BY c.entity_key, c.cluster_id`.

- [ ] **Step 4: Run the tests to see both pass**

Run: `npm run test -w @webatlas/api -- src/db/referenceEntities.test.ts`
Expected: every test in the file passes. The file's `beforeAll` rebuilds all five layers, so the table now holds the new numbering.

- [ ] **Step 5: Re-check the hard-coded entity id**

`analysis.test.ts:324` sets `bigRoadEntityId = 'roads:82ccce28b3c34d80ee4f3e80fd438e39:1'`: the single-segment, roughly 18 km part of Đường tỉnh 699D. Find where it is now:

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT entity_id, member_count, round((ST_Length(geom::geography)/1000)::numeric, 1) FROM basemap.reference_entities WHERE entity_id LIKE 'roads:82ccce28b3c34d80ee4f3e80fd438e39:%' ORDER BY 1"
```

Expected: two rows, one with `member_count` 1 and about 18 km. If that row's id ends in `:1`, change nothing. If it ends in `:0`, edit line 324 to `'roads:82ccce28b3c34d80ee4f3e80fd438e39:0'`.

- [ ] **Step 6: Run the suites that read reference entities**

Run: `npm run test -w @webatlas/api -- src/db/referenceEntities.test.ts src/modules/analysis/analysis.test.ts src/modules/reference/reference.test.ts src/modules/search/search.test.ts src/modules/roi/resolve.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/referenceEntities.ts apps/api/src/db/referenceEntities.test.ts apps/api/src/modules/analysis/analysis.test.ts
git commit -m "fix(api): số cụm của thực thể tham chiếu không còn phụ thuộc thứ tự dòng trong bảng

ST_ClusterDBSCAN đánh số cụm theo thứ tự dòng tới cửa sổ, tức theo thứ tự
vật lý của bảng, mà số cụm nằm trong entity_id. Cùng một dữ liệu nạp theo
thứ tự khác cho ra id khác (đo 2026-10-04: 1.206 khoá đường có hơn một
cụm, 11.005 dòng thành viên đổi số). Nay cụm của mỗi khoá được đánh số lại
theo osm_id nhỏ nhất của cụm.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `demAvailable` means the DEM has rows

**Files:**
- Modify: `apps/api/src/modules/analysis/dem.ts`
- Create: `apps/api/src/modules/analysis/dem.test.ts`

**Interfaces:**
- Consumes: `Queryable` from `apps/api/src/modules/assistant/tools/data/helpers.ts` (`Pick<Pool, 'query'>`).
- Produces: `demAvailable(db: Queryable): Promise<boolean>`, unchanged signature. True only when `basemap.dem_region` exists and holds at least one row.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/analysis/dem.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { demAvailable } from './dem';
import type { Queryable } from '../assistant/tools/data/helpers';

/** Answers each query in turn with one row `{ ok }`, and records the SQL it was asked. */
function fakeDb(answers: boolean[]) {
  const asked: string[] = [];
  const db = {
    query: async (sql: string) => {
      asked.push(sql);
      return { rows: [{ ok: answers[asked.length - 1] }] };
    },
  } as unknown as Queryable;
  return { db, asked };
}

describe('demAvailable', () => {
  it('is false when the relation does not exist, and never queries it', async () => {
    // Querying a missing relation inside the analysis transaction would abort it (25P02).
    const { db, asked } = fakeDb([false]);
    expect(await demAvailable(db)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('to_regclass');
  });

  it('is false when the table exists but is empty, which is what migrations leave behind', async () => {
    const { db, asked } = fakeDb([true, false]);
    expect(await demAvailable(db)).toBe(false);
    expect(asked).toHaveLength(2);
  });

  it('is true when the table holds a row', async () => {
    const { db } = fakeDb([true, true]);
    expect(await demAvailable(db)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test -w @webatlas/api -- src/modules/analysis/dem.test.ts`
Expected: `is false when the table exists but is empty…` FAILS (`expected true to be false`). The other two pass.

- [ ] **Step 3: Implement**

Replace the function and its comment in `apps/api/src/modules/analysis/dem.ts`:

```ts
/**
 * Checked up front with to_regclass rather than by catching 42P01: the analysis runs
 * inside a transaction, and a caught error there aborts it — every later statement
 * would fail with 25P02. A deployment that never ran the DEM runbook is an ordinary
 * outcome (200 + status), not an error.
 *
 * "Available" means the table holds tiles, not that it exists: a migration creates
 * basemap.dem_region empty, so existence alone is true on every database, including one
 * built with `atlas:up -- --except dem`, where the ops then returned summaries with no numbers.
 */
export async function demAvailable(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT to_regclass('basemap.dem_region') IS NOT NULL AS ok`);
  if (!rows[0].ok) return false;
  const loaded = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM basemap.dem_region) AS ok`);
  return loaded.rows[0].ok;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w @webatlas/api -- src/modules/analysis/dem.test.ts src/modules/analysis/analysis.test.ts src/modules/analysis/ops/elevationProfile.test.ts`
Expected: all pass (the dev stack has the DEM loaded, so the DEM tests take the loaded branch).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/analysis/dem.ts apps/api/src/modules/analysis/dem.test.ts
git commit -m "fix(api): demAvailable đúng khi bảng DEM có dữ liệu, không chỉ khi bảng tồn tại

Migration luôn tạo basemap.dem_region rỗng, nên kiểm tra tồn tại luôn
đúng: trên cơ sở dữ liệu chưa nạp DEM (CI, hoặc atlas:up --except dem)
elevation_profile và zonal_elevation trả về tóm tắt không có số thay vì
'Chưa nạp dữ liệu độ cao'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `basemap_fixture.py` — build, load, verify

**Files:**
- Create: `packages/atlas-data/tools/fixtures/basemap_fixture.py`
- Create: `packages/atlas-data/tools/fixtures/basemap_fixture.test.mjs`

**Interfaces:**
- Consumes: `basemap.reference_entities` numbered as Task 1 leaves it.
- Produces:
  - CLI `python3 packages/atlas-data/tools/fixtures/basemap_fixture.py <build|load|verify>`; exit 0 on success, 1 on a fixture error (message on stderr starting `ERROR: `), 2 on bad usage.
  - Environment: `DATABASE_URL` (optional; split into `PG*` for `psql`), `BASEMAP_FIXTURE_DIR` (default `packages/atlas-data/fixtures/basemap`), `ATLAS_PSQL` and `ATLAS_PG_DUMP` (default `psql`, `pg_dump`; shell-split, used by the tests to substitute a stub).
  - `MANIFEST.json` shape, read by Task 4's test:
    ```json
    {
      "source": { "extract": "vietnam-261001-free.shp.zip", "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors, via Geofabrik" },
      "files": [ { "table": "basemap.roads_region", "file": "roads_region.copy.gz", "rule": "name IS NOT NULL OR ref IS NOT NULL", "columns": ["bridge", "…"], "rows": 33637, "sha256": "<64 hex>" } ],
      "referenceEntities": { "roads": { "count": 13658, "sha256": "<64 hex>" } }
    }
    ```

`build` is not covered by the stubbed tests: it needs a real `pg_dump` and a full atlas. It is exercised for real in Task 4, and its output is then held by Task 4's manifest test and by `verify` in CI.

- [ ] **Step 1: Write the failing tests**

Create `packages/atlas-data/tools/fixtures/basemap_fixture.test.mjs`:

```js
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
      ATLAS_PSQL: `bash "${stub.replaceAll('\\', '/')}"`,
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/fixtures/basemap_fixture.test.mjs` from `packages/atlas-data`
Expected: every test FAILS, because `basemap_fixture.py` does not exist (`python3: can't open file`, status 2 everywhere; the usage test fails on the missing usage text).

- [ ] **Step 3: Write the tool**

Create `packages/atlas-data/tools/fixtures/basemap_fixture.py`:

```python
#!/usr/bin/env python3
"""
The committed basemap fixture for CI: cut it from a built atlas, load it into an empty database,
and check that the entities built from it are the real atlas's.

    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build    # needs a fully built atlas
    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load     # CI: before reference:build
    python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify   # CI: after reference:build

Standard library only, so it runs on a CI runner, in the atlas-tools image and on a developer's host.
All SQL goes through psql. The connection comes from DATABASE_URL when it is set (split into PG*
variables for the child, so the password never appears in an argv), otherwise from the PG* variables
already in the environment.

Design: docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md
"""
import gzip
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
# packages/atlas-data/tools/fixtures/basemap_fixture.py -> packages/atlas-data/fixtures/basemap
FIXTURE_DIR = pathlib.Path(os.environ.get("BASEMAP_FIXTURE_DIR") or HERE.parents[1] / "fixtures" / "basemap")
DESCRIPTOR = HERE.parents[1] / "src" / "descriptors" / "basemap.ts"
MANIFEST = "MANIFEST.json"
SCHEMA = "schema.sql"

# Table -> the rows the fixture keeps. A superset of what buildReferenceEntities reads (a row whose
# route number or name is not null), so the entities built from the fixture are the real atlas's.
# railways_vn and places_region are small enough to keep whole; locate_place reads places_region.
TABLES = {
    "roads_region": "name IS NOT NULL OR ref IS NOT NULL",
    "water_region": "name IS NOT NULL",
    "landuse_region": "name IS NOT NULL",
    "railways_vn": "TRUE",
    "places_region": "TRUE",
}

# One line per layer: key, entity count, sha256 over the sorted lines "entity_id|member_count".
DIGEST_SQL = """/* fixture:digest */
SELECT layer_key, count(*),
       encode(sha256(convert_to(
         string_agg(entity_id || '|' || member_count, E'\\n' ORDER BY entity_id COLLATE "C"), 'UTF8')), 'hex')
  FROM basemap.reference_entities
 GROUP BY layer_key
 ORDER BY layer_key"""

# The member rows buildReferenceEntities would read, per layer (apps/api/src/db/referenceEntities.ts).
# Used only by `build`, to notice a reference_entities that is older than the tables it came from.
MEMBER_ROWS_SQL = {
    "roads": """SELECT count(*) FROM basemap.roads_region t
                  LEFT JOIN LATERAL (SELECT nullif(btrim(x), '') AS tok
                                       FROM unnest(string_to_array(coalesce(t.ref, ''), ';')) AS x) k ON true
                 WHERE coalesce(k.tok, t.name) IS NOT NULL AND t.geometry IS NOT NULL""",
    "railways": "SELECT count(*) FROM basemap.railways_vn WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "water": "SELECT count(*) FROM basemap.water_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "landuse": "SELECT count(*) FROM basemap.landuse_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
    "places": "SELECT count(*) FROM basemap.places_region WHERE name IS NOT NULL AND geometry IS NOT NULL",
}

SAFE_TABLE = re.compile(r"^basemap\.[a-z_]+$")
SAFE_COLUMN = re.compile(r"^[a-z_][a-z0-9_]*$")


class FixtureError(Exception):
    pass


def child_env() -> dict:
    """The environment for psql and pg_dump: DATABASE_URL, when set, becomes PG* variables."""
    env = dict(os.environ)
    url = env.get("DATABASE_URL", "")
    if url:
        u = urllib.parse.urlsplit(url)
        if u.hostname:
            env["PGHOST"] = u.hostname
        if u.port:
            env["PGPORT"] = str(u.port)
        if u.username:
            env["PGUSER"] = urllib.parse.unquote(u.username)
        if u.password:
            env["PGPASSWORD"] = urllib.parse.unquote(u.password)
        if u.path.strip("/"):
            env["PGDATABASE"] = u.path.strip("/")
    return env


def psql_argv(*args: str) -> list:
    # ATLAS_PSQL is split like a shell command; the tests point it at a stub.
    return shlex.split(os.environ.get("ATLAS_PSQL") or "psql") + ["-X", "-q", "-v", "ON_ERROR_STOP=1", *args]


def query(sql: str) -> bytes:
    """One statement; its unaligned, tuples-only output as bytes."""
    r = subprocess.run(psql_argv("-At", "-c", sql), env=child_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("psql failed: " + r.stderr.decode("utf-8", "replace").strip())
    return r.stdout


def rows(sql: str) -> list:
    return [line.split("|") for line in query(sql).decode("utf-8").splitlines() if line.strip()]


def scalar(sql: str) -> str:
    return query(sql).decode("utf-8").strip()


def read_manifest() -> dict:
    path = FIXTURE_DIR / MANIFEST
    if not path.exists():
        raise FixtureError(f"{path} is missing")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    for f in manifest["files"]:
        if not SAFE_TABLE.match(f["table"]) or not all(SAFE_COLUMN.match(c) for c in f["columns"]):
            raise FixtureError(f"{MANIFEST}: unexpected table or column name in the entry for {f['file']}")
    return manifest


def checked_files(manifest: dict) -> dict:
    """File name -> its bytes, once every file has matched its sha256."""
    blobs = {}
    for f in manifest["files"]:
        path = FIXTURE_DIR / f["file"]
        if not path.exists():
            raise FixtureError(f"{f['file']} is missing from {FIXTURE_DIR}; nothing was loaded")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != f["sha256"]:
            raise FixtureError(f"{f['file']} does not match its sha256 in {MANIFEST}; nothing was loaded")
        blobs[f["file"]] = raw
    return blobs


# --- load ---------------------------------------------------------------------------------------

def cmd_load() -> None:
    manifest = read_manifest()
    blobs = checked_files(manifest)
    schema_path = FIXTURE_DIR / SCHEMA
    if not schema_path.exists():
        raise FixtureError(f"{SCHEMA} is missing from {FIXTURE_DIR}; nothing was loaded")
    schema = schema_path.read_text(encoding="utf-8")

    # Never over a real atlas: a target table may exist (an earlier fixture load), but it must be empty.
    names = ", ".join("'" + f["table"].split(".")[1] + "'" for f in manifest["files"])
    existing = [r[0] for r in rows(
        "/* fixture:existing */ SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        f"WHERE n.nspname = 'basemap' AND c.relkind = 'r' AND c.relname IN ({names}) ORDER BY 1")]
    for name in existing:
        if scalar(f"/* fixture:rows */ SELECT EXISTS (SELECT 1 FROM basemap.{name})") == "t":
            raise FixtureError(
                f"basemap.{name} already holds rows. The fixture is for an empty database (CI); "
                "it never replaces a loaded basemap. Nothing was loaded.")

    parts = [b"/* fixture:load */\n"]
    for f in manifest["files"]:
        parts.append(f"DROP TABLE IF EXISTS {f['table']};\n".encode())
    parts.append(schema.encode("utf-8"))
    parts.append(b"\n")
    for f in manifest["files"]:
        table, want = f["table"], int(f["rows"])
        columns = ", ".join(f'"{c}"' for c in f["columns"])
        data = gzip.decompress(blobs[f["file"]])
        parts.append(f"COPY {table} ({columns}) FROM STDIN;\n".encode())
        parts.append(data if data.endswith(b"\n") or not data else data + b"\n")
        parts.append(b"\\.\n")
        # Inside the transaction: a short or long load rolls everything back.
        parts.append((
            f"DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM {table}; "
            f"IF n <> {want} THEN RAISE EXCEPTION '{table}: loaded % rows, the manifest says {want}', n; "
            "END IF; END $$;\n").encode())
        parts.append(f"ANALYZE {table};\n".encode())

    r = subprocess.run(psql_argv("--single-transaction", "-f", "-"), env=child_env(),
                       input=b"".join(parts), stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("psql failed and the transaction was rolled back, so nothing was loaded: "
                           + r.stderr.decode("utf-8", "replace").strip())
    for f in manifest["files"]:
        print(f"loaded {f['table']}: {int(f['rows']):,} rows")
    print(f"fixture cut from {manifest['source']['extract']}")


# --- verify -------------------------------------------------------------------------------------

def built_entities() -> dict:
    return {layer: {"count": int(n), "sha256": digest} for layer, n, digest in rows(DIGEST_SQL)}


def cmd_verify() -> None:
    want = read_manifest()["referenceEntities"]
    got = built_entities()
    problems = []
    for layer in sorted(set(want) | set(got)):
        w = want.get(layer, {"count": 0, "sha256": ""})
        g = got.get(layer, {"count": 0, "sha256": ""})
        if g["count"] != w["count"]:
            problems.append(f"{layer}: built {g['count']} entities, the manifest says {w['count']}")
        elif g["sha256"] != w["sha256"]:
            problems.append(f"{layer}: {g['count']} entities as expected, but their ids or member counts differ")
        else:
            print(f"ok   {layer}: {g['count']:,} entities match the atlas the fixture was cut from")
    if problems:
        raise FixtureError(
            "the entities built from the fixture are not those of the atlas it was cut from:\n  "
            + "\n  ".join(problems)
            + "\n  Rebuild them (npm run reference:build -w @webatlas/api), or regenerate the fixture: "
              "see packages/atlas-data/fixtures/basemap/README.md")


# --- build --------------------------------------------------------------------------------------

def dump_schema() -> str:
    argv = shlex.split(os.environ.get("ATLAS_PG_DUMP") or "pg_dump") + ["--schema-only", "--no-owner", "--no-privileges"]
    for table in TABLES:
        argv += ["-t", f"basemap.{table}"]
    r = subprocess.run(argv, env=child_env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise FixtureError("pg_dump failed: " + r.stderr.decode("utf-8", "replace").strip())
    # Keep only the CREATE TABLE and CREATE INDEX statements. pg_dump also writes session SETs and,
    # in recent versions, \restrict lines carrying a random token, which an older psql rejects and
    # which would change the file on every run.
    lines = [l for l in r.stdout.decode("utf-8").splitlines() if l.strip() and not l.startswith(("--", "\\"))]
    statements = [s.strip() for s in "\n".join(lines).split(";\n")]
    kept = [s.rstrip(";") for s in statements if s.startswith(("CREATE TABLE basemap.", "CREATE INDEX "))]
    created = [s for s in kept if s.startswith("CREATE TABLE")]
    if len(created) != len(TABLES):
        raise FixtureError(f"pg_dump described {len(created)} tables, expected {len(TABLES)}")
    header = (
        "-- The five basemap tables of the CI fixture, as load_basemap.py (through geopandas) creates them.\n"
        "-- Generated by packages/atlas-data/tools/fixtures/basemap_fixture.py build. Do not edit by hand.\n"
        "CREATE SCHEMA IF NOT EXISTS basemap;\n\n")
    return header + ";\n".join(kept) + ";\n"


def pinned_extract() -> str:
    m = re.search(r"const DATE = '(\d{6})'", DESCRIPTOR.read_text(encoding="utf-8"))
    if not m:
        raise FixtureError(f"cannot read the pinned DATE from {DESCRIPTOR}")
    return f"vietnam-{m.group(1)}-free.shp.zip"


def cmd_build() -> None:
    for table in TABLES:
        if scalar(f"SELECT to_regclass('basemap.{table}') IS NOT NULL") != "t":
            raise FixtureError(f"basemap.{table} does not exist: build the atlas first (npm run atlas:up)")
    if scalar("SELECT EXISTS (SELECT 1 FROM basemap.roads_region WHERE name IS NULL AND ref IS NULL)") != "t":
        raise FixtureError(
            "basemap.roads_region holds no unnamed road, so this database was loaded from the fixture, "
            "not built from the extract. Cut the fixture from a full atlas.")
    for layer, sql in MEMBER_ROWS_SQL.items():
        source = int(scalar(sql))
        stored = int(scalar(f"SELECT coalesce(sum(member_count), 0) FROM basemap.reference_entities WHERE layer_key = '{layer}'"))
        if source != stored:
            raise FixtureError(
                f"basemap.reference_entities is stale for {layer}: its entities hold {stored} members, the table "
                f"now yields {source}. Run: npm run atlas:build -- --force reference_entities")

    staged = {SCHEMA: dump_schema().encode("utf-8")}
    files = []
    for table, rule in TABLES.items():
        columns = [r[0] for r in rows(
            "SELECT column_name FROM information_schema.columns "
            f"WHERE table_schema = 'basemap' AND table_name = '{table}' ORDER BY ordinal_position")]
        column_list = ", ".join(f'"{c}"' for c in columns)
        # A total order, so unchanged data gives identical bytes: OSM ids repeat in the area tables.
        data = query(
            f"COPY (SELECT {column_list} FROM basemap.{table} WHERE {rule} "
            'ORDER BY osm_id COLLATE "C", md5(ST_AsEWKB(geometry)) COLLATE "C") TO STDOUT')
        blob = gzip.compress(data, compresslevel=9, mtime=0)
        name = f"{table}.copy.gz"
        count = data.count(b"\n")
        staged[name] = blob
        files.append({
            "table": f"basemap.{table}", "file": name, "rule": rule, "columns": columns,
            "rows": count, "sha256": hashlib.sha256(blob).hexdigest(),
        })
        print(f"{name}: {count:,} rows, {len(blob) / 1048576:.2f} MB")

    manifest = {
        "description": "Every named feature of the six working-region provinces, for the api CI job. "
                       "See README.md beside this file.",
        "source": {
            "extract": pinned_extract(),
            "licence": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors, via Geofabrik",
        },
        "files": files,
        "referenceEntities": built_entities(),
    }
    staged[MANIFEST] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    # Written only now: a failure above leaves the previous fixture untouched.
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, blob in staged.items():
        (FIXTURE_DIR / name).write_bytes(blob)
    total = sum(len(b) for n, b in staged.items() if n.endswith(".gz"))
    print(f"wrote {len(staged)} files to {FIXTURE_DIR} ({total / 1048576:.1f} MB of table data)")


COMMANDS = {"build": cmd_build, "load": cmd_load, "verify": cmd_verify}


def main(argv: list) -> int:
    if len(argv) != 2 or argv[1] not in COMMANDS:
        print("usage: basemap_fixture.py <build|load|verify>", file=sys.stderr)
        return 2
    try:
        COMMANDS[argv[1]]()
    except FixtureError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run tools/fixtures/basemap_fixture.test.mjs` from `packages/atlas-data`
Expected: 10 tests pass.

- [ ] **Step 5: Run the whole atlas-data suite and the type check**

Run: `npm run test -w @webatlas/atlas-data` and `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`
Expected: all pass (301 before this task, plus the 10 new ones), no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-data/tools/fixtures/basemap_fixture.py packages/atlas-data/tools/fixtures/basemap_fixture.test.mjs
git commit -m "feat(atlas-data): basemap_fixture.py — cắt, nạp và kiểm chứng fixture bản đồ nền cho CI

build cắt năm bảng (mọi đối tượng có tên hoặc số hiệu) thành tệp COPY nén,
kèm schema.sql và MANIFEST.json; load nạp vào cơ sở dữ liệu rỗng trong một
transaction và từ chối ghi đè bảng đã có dữ liệu; verify so thực thể tham
chiếu dựng từ fixture với digest lấy từ atlas thật.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cut and commit the fixture (controller-run, dev stack)

**Files:**
- Create (generated): `packages/atlas-data/fixtures/basemap/schema.sql`, `MANIFEST.json`, `roads_region.copy.gz`, `water_region.copy.gz`, `landuse_region.copy.gz`, `railways_vn.copy.gz`, `places_region.copy.gz`
- Create: `packages/atlas-data/fixtures/basemap/README.md`
- Create: `packages/atlas-data/src/fixtures.test.ts`
- Modify: `.gitattributes`

**Interfaces:**
- Consumes: `basemap_fixture.py build|load|verify` (Task 3); the dev atlas with `reference_entities` rebuilt by Task 1's code.
- Produces: the committed fixture directory, which Task 5's CI steps load.

- [ ] **Step 1: Write the failing manifest test**

Create `packages/atlas-data/src/fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { REFERENCE_LAYER_KEYS } from '@webatlas/shared';
import { REPO_ROOT } from './paths';

/**
 * The committed CI fixture (spec 2026-10-04-ci-basemap-fixture-design.md): what MANIFEST.json says
 * must be what the directory holds. That the fixture reproduces a real atlas's reference entities
 * is checked in CI by `basemap_fixture.py verify`, not here.
 */
const DIR = join(REPO_ROOT, 'packages/atlas-data/fixtures/basemap');

interface FixtureFile { table: string; file: string; rule: string; columns: string[]; rows: number; sha256: string }
interface Manifest {
  source: { extract: string; licence: string; attribution: string };
  files: FixtureFile[];
  referenceEntities: Record<string, { count: number; sha256: string }>;
}
const manifest = JSON.parse(readFileSync(join(DIR, 'MANIFEST.json'), 'utf8')) as Manifest;

describe('the committed basemap fixture', () => {
  it('holds exactly the five tables the reference layers and locate_place read', () => {
    expect(manifest.files.map((f) => f.table).sort()).toEqual([
      'basemap.landuse_region', 'basemap.places_region', 'basemap.railways_vn',
      'basemap.roads_region', 'basemap.water_region',
    ]);
  });

  it('keeps every row the reference build can read: named or numbered roads, named areas, all rail and places', () => {
    const rule = Object.fromEntries(manifest.files.map((f) => [f.table, f.rule]));
    expect(rule).toEqual({
      'basemap.roads_region': 'name IS NOT NULL OR ref IS NOT NULL',
      'basemap.water_region': 'name IS NOT NULL',
      'basemap.landuse_region': 'name IS NOT NULL',
      'basemap.railways_vn': 'TRUE',
      'basemap.places_region': 'TRUE',
    });
  });

  it('each file matches its sha256, row count and column list', () => {
    for (const f of manifest.files) {
      const gz = readFileSync(join(DIR, f.file));
      expect(createHash('sha256').update(gz).digest('hex'), f.file).toBe(f.sha256);
      const lines = gunzipSync(gz).toString('utf8').split('\n');
      expect(lines.pop(), `${f.file} ends with a newline`).toBe('');
      expect(lines.length, f.file).toBe(f.rows);
      expect(f.rows, f.file).toBeGreaterThan(0);
      expect(lines[0].split('\t').length, `${f.file} columns`).toBe(f.columns.length);
      expect(f.columns).toContain('osm_id');
      expect(f.columns).toContain('geometry');
    }
  });

  it('has no dump that the manifest does not name', () => {
    const dumps = readdirSync(DIR).filter((n) => n.endsWith('.copy.gz')).sort();
    expect(dumps).toEqual(manifest.files.map((f) => f.file).sort());
  });

  it('schema.sql creates exactly the five tables, with their geometry and fclass indexes', () => {
    const schema = readFileSync(join(DIR, 'schema.sql'), 'utf8');
    const tables = [...schema.matchAll(/^CREATE TABLE (basemap\.[a-z_]+) \(/gm)].map((m) => m[1]).sort();
    expect(tables).toEqual(manifest.files.map((f) => f.table).sort());
    expect([...schema.matchAll(/^CREATE INDEX /gm)]).toHaveLength(10);
    // Statements a different pg_dump version would add, and that an older psql rejects.
    expect(schema).not.toMatch(/^(SET |SELECT pg_catalog|\\)/m);
  });

  it('records the entity count and digest of every reference layer', () => {
    expect(Object.keys(manifest.referenceEntities).sort()).toEqual([...REFERENCE_LAYER_KEYS].sort());
    for (const [layer, e] of Object.entries(manifest.referenceEntities)) {
      expect(e.count, layer).toBeGreaterThan(0);
      expect(e.sha256, layer).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('names the extract it was cut from and its licence', () => {
    expect(manifest.source.extract).toMatch(/^vietnam-\d{6}-free\.shp\.zip$/);
    expect(manifest.source.licence).toBe('ODbL-1.0');
    expect(manifest.source.attribution).toContain('OpenStreetMap');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/fixtures.test.ts` from `packages/atlas-data`
Expected: FAIL at import time with `ENOENT … fixtures/basemap/MANIFEST.json`.

- [ ] **Step 3: Record the registry rebuild of the reference entities**

Task 1's test run already rebuilt `basemap.reference_entities` with the new numbering. Run the registry stage too, so its lineage records it:

Run: `npm run atlas:build -- --force reference_entities`
Expected: `executed 1, skipped 23` (only `reference_entities/0`), exit 0.

- [ ] **Step 4: Mark the dumps binary**

Append to `.gitattributes`:

```
# The CI basemap fixture: gzipped PostgreSQL COPY data. Never text-converted, never diffed.
*.copy.gz  binary
```

- [ ] **Step 5: Cut the fixture in the tools image**

```bash
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build
```

Expected output, with the row counts measured on 2026-10-04:

```
roads_region.copy.gz: 33,637 rows, about 8.9 MB
water_region.copy.gz: 680 rows, about 4.4 MB
landuse_region.copy.gz: 812 rows, about 0.3 MB
railways_vn.copy.gz: 3,764 rows, about 0.7 MB
places_region.copy.gz: 6,040 rows, about 0.15 MB
wrote 7 files to /repo/packages/atlas-data/fixtures/basemap (about 14.4 MB of table data)
```

- [ ] **Step 6: Cut it a second time and confirm the bytes are identical**

```bash
sha256sum packages/atlas-data/fixtures/basemap/* > /tmp/fixture-1.sha
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build
sha256sum packages/atlas-data/fixtures/basemap/* | diff - /tmp/fixture-1.sha && echo IDENTICAL
```

Expected: `IDENTICAL`. If it is not, the dump order is not total: stop and find which file differs before committing anything.

- [ ] **Step 7: Run the manifest test to see it pass**

Run: `npx vitest run src/fixtures.test.ts` from `packages/atlas-data`
Expected: 7 tests pass.

- [ ] **Step 8: Prove load → build → verify on a scratch database**

This is the CI sequence, run locally against a new empty database on the dev server, so a failure costs a minute here and not a CI round trip. It does not touch the `webatlas` database.

```bash
docker exec webatlas-db-1 createdb -U webatlas -T template_postgis fixture_check
# The dev URL with only the database name changed; never echo it.
export DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '\r' | sed -E 's#/[^/?]+(\?.*)?$#/fixture_check\1#')"
npm run migrate
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load
npm run reference:build -w @webatlas/api
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load; echo "second load exit: $?"
```

Expected:
- `load` prints five `loaded basemap.<table>: N rows` lines.
- `verify` prints five `ok   <layer>: N entities match the atlas the fixture was cut from` lines and exits 0. **This is the acceptance of Tasks 1 and 3 together:** rows loaded in `osm_id` order give the same entity ids as the real atlas, whose tables are in loader order.
- The second `load` exits 1 with `basemap.roads_region already holds rows` (or another of the five), and changes nothing.

Then remove the scratch database and the variable:

```bash
unset DATABASE_URL
docker exec webatlas-db-1 dropdb -U webatlas fixture_check
```

If `createdb -T template_postgis` reports that the template does not exist, use `createdb -U webatlas fixture_check` followed by `docker exec webatlas-db-1 psql -U webatlas -d fixture_check -c "CREATE EXTENSION postgis"`.

- [ ] **Step 9: Write the README**

Create `packages/atlas-data/fixtures/basemap/README.md`:

```markdown
# Basemap fixture for CI

Real OpenStreetMap data, cut from a built atlas, so the `api` CI job can run the reference, search,
ROI and `locate_place` tests without the 720 MB Geofabrik extract. Design:
`docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md`.

**Data © OpenStreetMap contributors, ODbL 1.0, via Geofabrik.** `MANIFEST.json` names the extract.

## What is in it

Every row the reference build can read, for the six working-region provinces:

| Table | Rows kept |
|---|---|
| `basemap.roads_region` | those with a name or a route number |
| `basemap.water_region`, `basemap.landuse_region` | those with a name |
| `basemap.railways_vn`, `basemap.places_region` | all |

Unnamed roads, the national `*_vn` road and place tables, land, the DEM and contours are not here:
no API test reads them. Because the reference build skips rows with neither a name nor a route
number, the entities built from this fixture are the same as a full atlas's. CI checks that on
every run (`verify`, below).

## Files

- `schema.sql`: the real table and index definitions, dumped from a built atlas.
- `<table>.copy.gz`: PostgreSQL COPY text, gzipped. Binary in git.
- `MANIFEST.json`: the source extract; each file's selection rule, columns, row count and sha256;
  and for each reference layer, the entity count and a digest of the real atlas's entity ids.

## Using it

```bash
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load     # into an EMPTY database
npm run reference:build -w @webatlas/api
python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
```

`load` reads `DATABASE_URL` (or the `PG*` variables), needs `psql`, and **refuses to run when any
of the five tables already holds rows**. It is for CI and scratch databases. It never replaces a
basemap built by `atlas:up`.

## Regenerating

Only when a test needs newer data, or when `load_basemap.py` changes what it writes. A new basemap
pin alone is not a reason: CI stays on the frozen extract. Each regeneration adds about 14 MB to
the repository's history.

On a machine with the full atlas built:

```bash
npm run atlas:build -- --force reference_entities
docker compose -f infra/docker-compose.yml --profile tools run --rm -T --no-deps tools \
  python3 packages/atlas-data/tools/fixtures/basemap_fixture.py build
npm run test -w @webatlas/atlas-data
```

`build` refuses a database that was itself loaded from the fixture, and one whose
`reference_entities` is older than its tables. Unchanged data gives byte-identical files.
```

- [ ] **Step 10: Run the atlas-data suite, then commit**

Run: `npm run test -w @webatlas/atlas-data`
Expected: all pass.

```bash
git add .gitattributes packages/atlas-data/fixtures/basemap packages/atlas-data/src/fixtures.test.ts
git status --short   # the seven fixture files, README.md, fixtures.test.ts, .gitattributes; nothing else
git commit -m "feat(atlas-data): fixture bản đồ nền cho CI — mọi đối tượng có tên của sáu tỉnh

Năm bảng basemap cắt từ atlas dựng bằng vietnam-261001: đường có tên hoặc
số hiệu, mặt nước và sử dụng đất có tên, toàn bộ đường sắt và địa danh.
Khoảng 14 MB nén. Dữ liệu © OpenStreetMap contributors, ODbL 1.0.

MANIFEST.json ghi sha256, số dòng từng tệp và digest thực thể tham chiếu
của atlas thật để CI đối chiếu.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire CI, verify, and bring the documents in line (controller-run)

**Files:**
- Modify: `.github/workflows/ci.yml` (the `api` job's steps)
- Modify: `docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md` (file names, test row)
- Modify: `docs/superpowers/plans/2026-10-04-ci-basemap-fixture.md` (execution notes at the end)

**Interfaces:**
- Consumes: the committed fixture (Task 4), `basemap_fixture.py load|verify` (Task 3).
- Produces: a green `api` job on PR #19.

- [ ] **Step 1: Add the fixture steps to the `api` job**

In `.github/workflows/ci.yml`, replace the last two steps of the `api` job:

```yaml
      - run: npm run ingest:rivers -w @webatlas/api
      - run: npm run test:api
```

with:

```yaml
      - run: npm run ingest:rivers -w @webatlas/api
      # Bản đồ nền thật cần bản trích Geofabrik 720 MB nên CI không dựng được. Thay vào đó nạp
      # fixture đã commit (mọi đối tượng có tên của sáu tỉnh, packages/atlas-data/fixtures/basemap),
      # dựng thực thể tham chiếu như atlas:up vẫn làm, rồi đối chiếu với digest lấy từ atlas thật:
      # nếu thực thể dựng từ fixture khác atlas thật thì dừng ở đây, trước khi kiểm thử chạy.
      - run: python3 packages/atlas-data/tools/fixtures/basemap_fixture.py load
      - run: npm run reference:build -w @webatlas/api
      - run: python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
      - run: npm run test:api
```

- [ ] **Step 2: Bring the spec's file names in line**

In `docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md`:
- §5 layout: replace the three `*.sh` lines under `packages/atlas-data/tools/fixtures/` with `basemap_fixture.py        build | load | verify`.
- §6 and §7 headings and text: `build-basemap-fixture.sh` → `basemap_fixture.py build`, `load-basemap-fixture.sh` → `basemap_fixture.py load`, `verify-basemap-fixture.sh` → `basemap_fixture.py verify`; the §6 command becomes the one in Task 4 Step 5.
- §7: replace "Needs `psql`, `gzip` and `sha256sum`" with "Needs `python3` (standard library only) and `psql`".
- §10, row "Entity numbering": replace its check with "Cluster numbers of one key run from 0 with no gaps and ascend with each cluster's smallest member id. Order independence itself is proven in CI by `verify`: the fixture is loaded in `osm_id` order, the real atlas in loader order."
- Add after the decisions table: "Implementation note: the three scripts this document first named are one Python tool with three subcommands (plan 2026-10-04-ci-basemap-fixture.md)."

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/ci.yml docs/superpowers/specs/2026-10-04-ci-basemap-fixture-design.md
git commit -m "ci: nạp fixture bản đồ nền và dựng thực thể tham chiếu trước khi chạy kiểm thử API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Watch the run**

```bash
gh run list --branch feat/registry-plan-b --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch <id> --interval 20
gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
```

Expected: `shared`, `web`, `atlas-data`, `api` all `success`.

If `api` fails, read the failures before changing anything (`gh run view <id> --log-failed`), and separate three cases:
- `load` or `verify` failed: the fixture or the numbering is wrong; reproduce with Task 4 Step 8.
- A test fails on data the fixture does not hold (an unnamed road, a `*_vn` table): report it. Widening the fixture is a change to spec D2 and is the user's decision.
- A test fails for a reason unrelated to basemap data: it was hidden behind the earlier failures; fix it as its own commit, with the test output in the message.

- [ ] **Step 5: Confirm the formerly failing tests ran, and none was skipped**

```bash
gh run view <id> --log 2>/dev/null | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E 'Test Files|Tests  |locatePlace|referenceEntities|reference\.test|resolve\.test|search\.test|analysis\.test' | sed -E 's/^.*Z //' | tail -20
```

Expected: the six files listed as passed; the totals line shows no failed tests. Record the totals.

- [ ] **Step 6: Run the full API suite on the dev stack**

Run: `npm run test:api`
Expected: all pass (482 before this plan, plus the 5 new tests of Tasks 1 and 2).

- [ ] **Step 7: Record the outcome**

Append an `## Execution notes` section to this plan with: the commit of each task, the fixture's file sizes and row counts, the `verify` output of Task 4 Step 8, the CI run id and its totals, and any deviation. Add a `## CI` section to the body of PR #19 (`gh pr edit 19 --body-file …`) saying that the `api` job is green, what the fixture is, and that entity ids of multi-cluster entities changed once (Task 1). Commit and push the plan notes:

```bash
git add docs/superpowers/plans/2026-10-04-ci-basemap-fixture.md
git commit -m "docs: ghi kết quả thực thi kế hoạch fixture bản đồ nền cho CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
