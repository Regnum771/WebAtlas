# Plan C-3: the switch-over — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Plan C: tests and CI seed the database through the registry's loader, the old `seed`, `ingest:rivers` and `publish:geoserver` commands and their code are removed, and a fresh clone still reaches a verified atlas with one command.

**Architecture:** One function in `packages/atlas-data`, `ensureSeeded(pool)`, brings a database's thematic data to the committed seed content using the same core the `load-geojson` stage uses: it re-labels a version the old command loaded, loads what is missing, and does nothing when the content is already there. It writes no build state and never talks to GeoServer. A small CLI (`atlas:seed`) runs it for CI; the API's Vitest global setup calls it so every suite starts from seeded data. With nothing left calling them, the old commands and `apps/api/src/db/seeds` are deleted.

**Tech Stack:** TypeScript 6, Node 22, `pg` 8, Vitest 3 (`globalSetup`), GitHub Actions, Docker Compose (acceptance).

**Spec:** `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md` §11 "Test setup" and "Old commands", §12 "Acceptance", §14 Plan C. Third of three (C-1 `…plan-C1-versioning-package.md`, C-2 `…plan-C2-load-geojson.md`).

## Global Constraints

- Branch `feat/registry-plan-c3`, cut from `feat/registry-plan-c2` (PR #21, which is stacked on #20). The PR targets `main`.
- Done when (spec §14): **the fresh-clone acceptance passes again, and a second API test run adds no versions.**
- `npm run rivers:hierarchy -w @webatlas/api`, the read-only check, stays (spec §11).
- `ensureSeeded` never hides steward edits: it calls the loader with `supersedeEdits: false`. If a layer has edits on top of *different* content it fails with the loader's message; with the same content it does nothing.
- `ensureSeeded` and `atlas:seed` write nothing to `app.dataset_stage_state` or the lineage tables, and make no GeoServer call. They are not a build.
- The acceptance runs in a throwaway compose project with its own name, ports and volumes, from a clean clone. It must not touch the dev stack (`webatlas-db-1`, `webatlas-geoserver-1`).
- Commit messages are Vietnamese Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Baseline, dev stack: `test:api` 439, `test:versioning` 51, `test:shared` 119, atlas-data 350 passed and 38 skipped plus 12 database tests, `test:web` 543; `atlas:verify` 50 checks.

**Decisions this plan makes where the spec has been overtaken:**

1. *CI needs a seed command.* The spec parked CI and says only that API suites call a helper. CI now exists, and the `packages/versioning` tests, which cannot import `atlas-data`, also need seeded data. So besides the helper there is a command, `npm run atlas:seed`, that CI runs once before the suites.
2. *One global setup, not a call per suite.* The spec's `ensureSeeded(layers)` is called by "the suites that need it". Nearly every API suite reads the seeded layers and none says so today. A Vitest `globalSetup` calls `ensureSeeded` once per run for everything; when the data is already there it costs a few queries.
3. *`ensureSeeded` adopts before it loads.* A database seeded by the old commands holds the right content under the old `source` labels. `ensureSeeded` re-labels such a version (the check `atlas:adopt` uses) and only loads when that is not possible. On a dev machine the switch therefore creates no versions.
4. *Deferred items of Plan B stay deferred.* The Minor items carried from Plan B's reviews (`--compose` on the other commands, the shared compose project name, a build lock, the `--only` success hint, old cache files) are not in this plan; it would no longer be the spec's Plan C. They are listed at the end for a follow-up.

## File Structure

| File | Responsibility |
|---|---|
| `packages/atlas-data/src/ensureSeeded.ts` (create) | Bring the thematic data to the committed content; no state, no GeoServer |
| `packages/atlas-data/src/ensureSeeded.db.test.ts` (create) | Its behaviour against the database, under rollback where it can |
| `packages/atlas-data/src/cli/seed.ts` (create) | `atlas:seed` |
| `packages/atlas-data/src/index.ts`, `package.json` (modify) | The package's public entry |
| `apps/api/src/test/globalSetup.ts` (create), `apps/api/vitest.config.ts` (modify) | Seed once per test run |
| `apps/api/src/db/seededLayers.test.ts` (from `db/seeds/seed.test.ts`) | What the seeded layers hold |
| `apps/api/src/db/adminBoundaries.test.ts`, `riversStamping.test.ts`, `reachSeed.test.ts` (from `db/seeds/`) | Data assertions that outlive the old loader |
| `apps/api/src/geoserver/publication.test.ts` (from `publish.test.ts`) | The served layers, without the old publisher |
| `apps/api/src/db/seeds/`, `apps/api/src/geoserver/publish.ts` (delete) | The old commands' code |
| `.github/workflows/ci.yml`, both `package.json`, README, runbooks, architecture, spec (modify) | The switch |

---

### Task 1: `ensureSeeded` and `atlas:seed`

**Files:**
- Create: `packages/atlas-data/src/ensureSeeded.ts`, `packages/atlas-data/src/ensureSeeded.db.test.ts`, `packages/atlas-data/src/cli/seed.ts`
- Modify: `packages/atlas-data/src/index.ts`, `packages/atlas-data/package.json`, root `package.json`

**Interfaces:**
- Consumes: `resolveLoad`, `applyLoadGeojson`, `ResolvedLoad` (`stages/loadGeojson.ts`); `adoptLegacySource` (`adoptLegacy.ts`); `topologicalOrder` (`graph.ts`); `ALL_DATASETS` (`registry.ts`).
- Produces, from `@webatlas/atlas-data`:

  ```ts
  export type SeedAction = 'unchanged' | 'relabelled' | 'loaded' | 'replaced';
  export interface SeedOutcome { id: string; action: SeedAction; detail: string }
  /** Every dataset that has a load-geojson stage, in dependency order. */
  export function ensureSeeded(pool: Pool, datasets?: Dataset[]): Promise<SeedOutcome[]>;
  export { ALL_DATASETS } from './registry';
  export { resolveStageFile } from './paths';
  ```
- CLI: `npm run atlas:seed` (root) → `tsx src/cli/seed.ts`; prints one line per dataset; exit 1 on failure.

- [ ] **Step 1: Write the failing test**

`packages/atlas-data/src/ensureSeeded.db.test.ts`. `ensureSeeded` commits, so the tests work on the real layers of a seeded database and assert that it changes nothing there; the loading and re-labelling paths themselves are covered under rollback by `loadGeojson.db.test.ts` and `adoptLegacy.db.test.ts`.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureSeeded } from './ensureSeeded';
import { ALL_DATASETS } from './registry';

const DB = process.env.DATABASE_URL;
let pool: pg.Pool;
beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => { await pool?.end(); });

const versions = async () =>
  Number((await pool.query(`SELECT count(*)::text AS n FROM app.dataset_versions`)).rows[0].n);
const activeIds = async () =>
  (await pool.query<{ layer_key: string; id: string }>(
    `SELECT layer_key, id FROM app.dataset_versions WHERE is_active ORDER BY layer_key`)).rows;

describe.skipIf(!DB)('ensureSeeded', () => {
  it('covers admin_boundaries, the seven layers and rivers, boundaries first', async () => {
    const out = await ensureSeeded(pool);
    expect(out.map((o) => o.id)).toEqual([
      'admin_boundaries', 'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion',
      'flood_generation', 'lakes', 'rivers',
    ]);
  }, 600_000);

  it('on a seeded database it creates no version, moves no active pointer, and says unchanged', async () => {
    await ensureSeeded(pool);                       // whatever the first call had to do is done
    const before = { n: await versions(), active: await activeIds() };
    const out = await ensureSeeded(pool);
    expect(out.every((o) => o.action === 'unchanged'), JSON.stringify(out)).toBe(true);
    expect(await versions()).toBe(before.n);
    expect(await activeIds()).toEqual(before.active);
  }, 600_000);

  it('leaves every layer resting on its committed content, whatever was on top', async () => {
    await ensureSeeded(pool);
    const { rows } = await pool.query<{ layer_key: string; source: string }>(
      `WITH RECURSIVE chain AS (
         SELECT layer_key, id, kind, source, parent_version_id FROM app.dataset_versions WHERE is_active
         UNION ALL
         SELECT v.layer_key, v.id, v.kind, v.source, v.parent_version_id
           FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
       )
       SELECT layer_key, source FROM chain WHERE kind = 'ingest' ORDER BY layer_key`);
    for (const r of rows) expect(r.source, r.layer_key).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(rows.map((r) => r.layer_key)).toEqual(
      ['dams', 'drought_points', 'flood_generation', 'flood_zones', 'lakes', 'rivers', 'saltwater_intrusion', 'stations']);
  }, 600_000);

  it('writes no build state: it is not a build', async () => {
    const count = async () =>
      Number((await pool.query(`SELECT count(*)::text AS n FROM app.dataset_stage_state`)).rows[0].n);
    const before = await count();
    await ensureSeeded(pool);
    expect(await count()).toBe(before);
  }, 600_000);

  it('ignores datasets with no load-geojson stage', async () => {
    const out = await ensureSeeded(pool, ALL_DATASETS.filter((d) => ['demo', 'basemap', 'dem'].includes(d.id)));
    expect(out).toEqual([]);
  });
});
```

Run: `DATABASE_URL=… npx vitest run src/ensureSeeded.db.test.ts` from `packages/atlas-data`
Expected: FAIL, cannot import `./ensureSeeded`.

- [ ] **Step 2: Implement**

`packages/atlas-data/src/ensureSeeded.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Dataset, Stage } from './types';
import { topologicalOrder } from './graph';
import { ALL_DATASETS } from './registry';
import { adoptLegacySource } from './adoptLegacy';
import { applyLoadGeojson, resolveLoad, type ResolvedLoad } from './stages/loadGeojson';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

export type SeedAction = 'unchanged' | 'relabelled' | 'loaded' | 'replaced';

export interface SeedOutcome {
  id: string;
  action: SeedAction;
  detail: string;
}

const featureCount = (path: string): number =>
  (JSON.parse(readFileSync(path, 'utf8')) as { features: unknown[] }).features.length;

/** A non-versioned load is in place when each target table holds exactly its file's features. */
async function replacedTablesCurrent(pool: Pool, load: ResolvedLoad): Promise<boolean> {
  for (const f of load.files) {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${f.target}`);
    if (rows[0].n !== featureCount(f.path)) return false;
  }
  return true;
}

async function seedOne(pool: Pool, stage: LoadStage): Promise<{ action: SeedAction; detail: string }> {
  const load = resolveLoad(stage);

  if (!stage.versioned) {
    if (await replacedTablesCurrent(pool, load)) return { action: 'unchanged', detail: `${stage.layer}: already loaded` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let result: { action: SeedAction; detail: string };
    if (stage.versioned) {
      // First ask whether what is there is already this content: under the content-derived source
      // (nothing to do) or under the old seed command's label (re-label it, load nothing).
      const adoption = await adoptLegacySource(client, stage, load);
      if (adoption.result === 'current') {
        result = { action: 'unchanged', detail: `${stage.layer}: already loaded` };
      } else if (adoption.result === 'relabelled') {
        result = { action: 'relabelled', detail: `${stage.layer}: existing version re-labelled with its content source` };
      } else {
        // Missing, or different content. Never over steward edits: the loader refuses, and the
        // caller sees its message.
        const out = await applyLoadGeojson(pool, client, load, { supersedeEdits: false });
        result = { action: 'loaded', detail: out.summary };
      }
    } else {
      const out = await applyLoadGeojson(pool, client, load, { supersedeEdits: false });
      result = { action: 'replaced', detail: out.summary };
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bring the thematic data to the committed seed content: the boundaries, then every versioned
 * layer. For tests and CI, which need the data but not a build (spec §11, "Test setup").
 *
 * It uses the load-geojson core, so an unchanged file creates no version: a second call, and a
 * second test run, change nothing. It is NOT atlas:build: no stage state, no lineage, no GeoServer.
 * And it never hides steward edits: a layer with edits on top of other content fails here with the
 * loader's message, where `npm run seed` used to load over it.
 */
export async function ensureSeeded(pool: Pool, datasets: Dataset[] = ALL_DATASETS): Promise<SeedOutcome[]> {
  const out: SeedOutcome[] = [];
  for (const d of topologicalOrder(datasets)) {
    for (const stage of d.stages) {
      if (stage.type !== 'load-geojson') continue;
      out.push({ id: d.id, ...(await seedOne(pool, stage)) });
    }
  }
  return out;
}
```

`topologicalOrder` throws when a dataset's dependency is not in the list it is given. The last test passes `demo`, `basemap` and `dem`, none of which depends on another: fine. Callers that pass a subset must pass a closed one.

`packages/atlas-data/src/index.ts`, replace the file:

```ts
/**
 * What other workspaces may import. The pipeline itself is run through its CLIs (`atlas:*`); this
 * entry exists for the API's test setup, which seeds through the same loader the build uses.
 */
export const PACKAGE_NAME = '@webatlas/atlas-data';
export { ensureSeeded, type SeedAction, type SeedOutcome } from './ensureSeeded';
export { ALL_DATASETS } from './registry';
export { resolveStageFile } from './paths';
```

`packages/atlas-data/package.json`: add `"exports": { ".": "./src/index.ts" },` after `"type": "module",`, and `"atlas:seed": "tsx src/cli/seed.ts",` to `scripts`.

`packages/atlas-data/src/cli/seed.ts`:

```ts
import pg from 'pg';
import { loadDevEnv } from './env';
import { validateRegistry } from '../registry';
import { ensureSeeded } from '../ensureSeeded';

/**
 * atlas:seed — load the committed seed data (boundaries, the thematic layers, rivers) into the
 * database, through the same loader atlas:build uses, and nothing else: no build state, no
 * GeoServer. For CI and for a test database. To build an atlas, use atlas:up or atlas:build.
 */
async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  try {
    const outcomes = await ensureSeeded(pool);
    for (const o of outcomes) console.log(`  ${o.action.padEnd(10)} ${o.id.padEnd(20)} ${o.detail}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

Root `package.json`, after `"atlas:verify"`: `"atlas:seed": "npm run atlas:seed -w @webatlas/atlas-data --"` (add the comma to the line above).

- [ ] **Step 3: Run**

Record `SELECT count(*) FROM app.dataset_versions` first. Then:

1. `npm run atlas:seed`. On the dev machine, whose active versions carry the old labels again after API test runs: expect `relabelled` for the eight layers (or `unchanged` for any already current), `unchanged` for `admin_boundaries`. **The version count must not change.**
2. `npm run atlas:seed` again: every line `unchanged`.
3. The test file with `DATABASE_URL` set: 5 pass.
4. `npm run test -w @webatlas/atlas-data` and `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`: pass.

If step 1 reports `loaded` for a layer, read why before going on (`npm run atlas:adopt` prints the reason a version cannot be re-labelled): a new version is not wrong, but it is not what this machine should need.

- [ ] **Step 4: Commit**

```bash
git add packages/atlas-data package.json
git commit -m "feat(atlas-data): ensureSeeded và atlas:seed — nạp dữ liệu seed bằng chính bộ nạp của build

Dành cho kiểm thử và CI: đưa ranh giới, bảy lớp chuyên đề và sông về đúng
nội dung đã commit. Phiên bản do lệnh seed cũ nạp được đổi nhãn chứ không
nạp lại; nội dung đã có thì không làm gì. Không ghi trạng thái build,
không gọi GeoServer, và không bao giờ nạp đè lên chỉnh sửa.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The API tests seed through the loader

**Files:**
- Create: `apps/api/src/test/globalSetup.ts`
- Modify: `apps/api/vitest.config.ts`, `apps/api/package.json` (devDependency)
- Move and rewrite: `apps/api/src/db/seeds/seed.test.ts` → `apps/api/src/db/seededLayers.test.ts`
- Move and trim: `apps/api/src/db/seeds/adminBoundaries.test.ts` → `apps/api/src/db/adminBoundaries.test.ts`
- Move: `apps/api/src/db/seeds/ingestRivers.stamp.test.ts` → `apps/api/src/db/riversStamping.test.ts`; `apps/api/src/db/seeds/reachSeed.test.ts` → `apps/api/src/db/reachSeed.test.ts`
- Modify: `apps/api/src/modules/versions/integration.test.ts`, `apps/api/src/db/riversIdentity.test.ts`
- Move and trim: `apps/api/src/geoserver/publish.test.ts` → `apps/api/src/geoserver/publication.test.ts`

**Interfaces:**
- Consumes: `ensureSeeded`, `ALL_DATASETS`, `resolveStageFile` from `@webatlas/atlas-data`; `SEED_LAYER_COLUMNS`, `RIVER_WAY_COLUMNS` from `@webatlas/shared`.
- Produces: after this task no test imports anything under `apps/api/src/db/seeds/` or `apps/api/src/geoserver/publish.ts`, so Task 3 can delete them.

- [ ] **Step 1: Global setup**

`apps/api/package.json`: add `"@webatlas/atlas-data": "*"` to `devDependencies`; `npm install`.

`apps/api/src/test/globalSetup.ts`:

```ts
import 'dotenv/config';
import pg from 'pg';
import { ensureSeeded } from '@webatlas/atlas-data';

/**
 * Once per test run, before any suite: the thematic layers the suites read are brought to the
 * committed seed content, through the loader atlas:build uses. Content that is already there is
 * left alone, so repeated runs add no dataset versions (they used to add one per layer per run).
 * If a layer carries steward edits over different content this fails rather than load over them.
 */
export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (apps/api/.env)');
  const pool = new pg.Pool({ connectionString });
  try {
    const changed = (await ensureSeeded(pool)).filter((o) => o.action !== 'unchanged');
    for (const o of changed) console.log(`[seed] ${o.action} ${o.id}: ${o.detail}`);
  } finally {
    await pool.end();
  }
}
```

`apps/api/vitest.config.ts`: inside `test: {`, add `globalSetup: ['./src/test/globalSetup.ts'],` with the comment `// Seeds the thematic layers once per run; see the file.`

- [ ] **Step 2: Rewrite `seed.test.ts` as `seededLayers.test.ts`**

```bash
git mv apps/api/src/db/seeds/seed.test.ts apps/api/src/db/seededLayers.test.ts
```

Edits:
- Imports: `'../pool'` → `'./pool'`; delete `import { runSeeds } from './run';`; add `import { ensureSeeded } from '@webatlas/atlas-data';`.
- Delete the `beforeAll(async () => { await runSeeds(); });` block: the global setup seeds. Remove `beforeAll` from the vitest import.
- `describe('seeds', …)` → `describe('the seeded layers', …)`.
- The `thuyhe.geojson` test: keep only its second half, as `it('rivers never comes from thuyhe.geojson', …)`: the active `rivers` version's source is not `thuyhe.geojson`. Delete the first query (it asserted about a `runSeeds()` call made a minute ago).
- Replace the test `'re-running appends a version rather than mutating the active one in place'` with:

  ```ts
  it('seeding again creates no version and leaves the active one in place', async () => {
    // The old seed command appended a version of every layer on every run. The loader is keyed
    // to file content, so an unchanged file changes nothing.
    const state = async () => (await getPool().query(
      `SELECT (SELECT count(*)::int FROM app.dataset_versions) AS n,
              (SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active) AS active`)).rows[0];
    const before = await state();
    const out = await ensureSeeded(getPool());
    expect(out.every((o) => o.action === 'unchanged'), JSON.stringify(out)).toBe(true);
    expect(await state()).toEqual(before);
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.flood_zones WHERE dataset_version_id = $1 AND NOT deleted`, [before.active]);
    expect(rows[0].n).toBe(2);
  }, 120_000);
  ```
- In `'seeds lakes as an active version from OSM water bodies'`: `toMatchObject({ source: 'OSM water bodies', is_active: true })` → `expect(ver[0].is_active).toBe(true); expect(ver[0].source).toMatch(/^osm-lakes-region\.geojson@sha256:[0-9a-f]{64}$/);`. Rewrite the comment above the label assertion: the label is still `version N`.
- In `'records provenance from the seed registry on the version row'`: rename to `'records the content it was loaded from on the version row'`; `expect(rows[0].source).toBe('thuydienvietnam.geojson')` → `expect(rows[0].source).toMatch(/^dams\.geojson@sha256:[0-9a-f]{64}$/)`.
- Delete the test `'a second seed run creates a new active version and leaves the prior one addressable'` (the behaviour is gone; a prior version staying addressable is covered by `integration.test.ts`).
- In `'each seeded layer has an active ingest version whose feature_count matches its rows'`: update the comment (rivers is loaded by its own dataset) and keep the body.
- `describe('administrative stamping during seed', …)` → `describe('administrative stamping of the seeded layers', …)`.

- [ ] **Step 3: The other tests that used the old code**

`apps/api/src/db/riversIdentity.test.ts`: `import { RIVERS_HYDRO_LAYER } from './seeds/ingestRivers';` → `import { RIVER_WAY_COLUMNS } from '@webatlas/shared';`, and in the last test `RIVERS_HYDRO_LAYER.columns({ … }, 0)` → `RIVER_WAY_COLUMNS({ … }, 0)`; rename it `'prefixes the id the rivers load writes'`.

`apps/api/src/modules/versions/integration.test.ts`:
- Replace `import { SEED_LAYERS } from '../../db/seeds/registry';` with

  ```ts
  import { SEED_LAYER_COLUMNS } from '@webatlas/shared';
  import { resolveStageFile } from '@webatlas/atlas-data';
  import type { FeatureLoadSpec } from '@webatlas/versioning';

  /** The stations seed file, loaded straight through the versioning core. */
  const stations: FeatureLoadSpec = {
    table: 'stations',
    file: resolveStageFile({ file: 'seeds/stations.geojson' }),
    columns: SEED_LAYER_COLUMNS.stations,
  };
  ```
  and delete the two `const stations = SEED_LAYERS.find((l) => l.table === 'stations')!;` lines inside the tests, which now use the constant above. Merge the `FeatureLoadSpec` type import into the existing `@webatlas/versioning` import.
- Replace the third test (`'ingests OSM waterways as the rivers version…'`, which calls `ingestHydroRivers` twice) with:

  ```ts
  it('rivers is one active ingest version holding all three levels', async () => {
    // Loaded by the rivers dataset's load-geojson stage (two files, one version); the load itself,
    // with its hierarchy and gates, is tested in packages/atlas-data (loadGeojson.db.test.ts).
    const pool = getPool();
    const svc = versionsService(pool);
    const active = await svc.getActiveVersionId('rivers');
    expect(active).not.toBeNull();
    const { rows: chain } = await pool.query<{ kind: string; source: string }>(
      `WITH RECURSIVE c AS (
         SELECT id, kind, source, parent_version_id FROM app.dataset_versions WHERE id = $1
         UNION ALL
         SELECT v.id, v.kind, v.source, v.parent_version_id FROM app.dataset_versions v JOIN c ON v.id = c.parent_version_id
       ) SELECT kind, source FROM c WHERE kind = 'ingest'`, [active]);
    expect(chain).toHaveLength(1);
    expect(chain[0].source).toMatch(/^osm-rivers-region\.geojson\+hydrorivers-region\.geojson@sha256:[0-9a-f]{64}$/);
    const { rows } = await pool.query<{ level: number }>(
      `SELECT DISTINCT feature_level AS level FROM water.rivers_active ORDER BY 1`);
    expect(rows.map((r) => r.level)).toEqual([1, 2, 3]);
  });
  ```

`adminBoundaries.test.ts`:

```bash
git mv apps/api/src/db/seeds/adminBoundaries.test.ts apps/api/src/db/adminBoundaries.test.ts
```

- `'../pool'` → `'./pool'`; delete the `loadAdminBoundaries` import and the whole `beforeAll` (the global setup loads the boundaries); remove `beforeAll` from the vitest import.
- `describe('loadAdminBoundaries', …)` → `describe('the administrative boundaries', …)`.
- Delete the last test (`'is idempotent — loading twice leaves the same counts'`): replacement of the two tables is tested in `packages/atlas-data` (`loadGeojson.db.test.ts`, "non-versioned mode replaces the target tables").

```bash
git mv apps/api/src/db/seeds/ingestRivers.stamp.test.ts apps/api/src/db/riversStamping.test.ts
git mv apps/api/src/db/seeds/reachSeed.test.ts apps/api/src/db/reachSeed.test.ts
```

- `riversStamping.test.ts`: `'../pool'` → `'./pool'`.
- `reachSeed.test.ts`: the seed path has one `../` fewer: `'../../../../../packages/atlas-data/data/seeds/hydrorivers-region.geojson'` → `'../../../../packages/atlas-data/data/seeds/hydrorivers-region.geojson'`. Check any other relative path in the file (it reads the prep script for region codes) the same way.

`publication.test.ts`:

```bash
git mv apps/api/src/geoserver/publish.test.ts apps/api/src/geoserver/publication.test.ts
```

- Delete `import { nativeNameFor } from './publish';` and the whole `describe('nativeNameFor', …)` block (the mapping now lives in the dataset descriptors, tested in `packages/atlas-data`).
- Add `import { ALL_DATASETS } from '@webatlas/atlas-data';` and, above the `describe`:

  ```ts
  /** The relation each public layer is published over, from the registry's publish stages. */
  const NATIVE_NAME = new Map(
    ALL_DATASETS.flatMap((d) => d.stages).flatMap((s) =>
      s.type === 'publish-geoserver' ? [[s.layer, s.nativeName ?? `${s.layer}_active`] as const] : [])
  );
  ```
- In `'backs every published layer with its active-version view'`: `nativeNameFor(l)` → `NATIVE_NAME.get(l)`.
- The comment `(npm run publish:geoserver)` → `(npm run atlas:build)`.

- [ ] **Step 4: Run, twice, and count versions**

```bash
npx tsc -p apps/api/tsconfig.json --noEmit
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions"   # A
npm run test:api
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions"   # B
npm run test:api
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions"   # C
```

Expected: both runs pass. **C equals B**: the second run adds no versions (the spec's criterion). B may differ from A only if Task 1 Step 3 was not run on this database first.

If C is greater than B, find which suite leaks: `SELECT layer_key, kind, source, label, ingested_at FROM app.dataset_versions ORDER BY ingested_at DESC LIMIT 20`. A suite that leaves a version behind is a defect of that suite's cleanup; fix it there and say so in the commit.

Record the new `test:api` total (four tests are deleted and two replaced, so expect 439 − 4 = 435, less any test moved elsewhere).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api package-lock.json
git commit -m "test(api): dữ liệu kiểm thử được nạp bằng bộ nạp của sổ đăng ký, một lần mỗi lượt chạy

globalSetup gọi ensureSeeded trước mọi suite; không suite nào còn gọi
runSeeds hay ingestHydroRivers. Lượt chạy thứ hai không thêm phiên bản nào
(trước đây mỗi lượt thêm một phiên bản cho mỗi lớp). Các kiểm thử về dữ
liệu đã nạp rời khỏi db/seeds; kiểm thử của chính lệnh seed cũ được thay
bằng kiểm thử hành vi mới.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the old commands

**Files:**
- Delete: `apps/api/src/db/seeds/` (`run.ts`, `registry.ts`, `ingestRivers.ts`, `ingestReaches.ts`, `adminBoundaries.ts`, `lakeType.ts`), `apps/api/src/geoserver/publish.ts`
- Modify: `apps/api/package.json`, root `package.json`, `apps/api/src/scripts/buildRiverHierarchy.ts`, `packages/atlas-data/tools/prune-hydrosheds-versions.mjs`, `packages/shared/src/legend.ts` (comment), `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rnE "db/seeds/|seeds/(run|registry|ingestRivers|ingestReaches|adminBoundaries|lakeType)|geoserver/publish'|from './publish'" apps packages --include=*.ts --include=*.mjs | grep -v node_modules`
Expected: no output. (`apps/api/src/db/seeds/data/dem` may still exist on a machine as an ignored directory of old DEM files; it is not in git.)

- [ ] **Step 2: Delete and unhook**

```bash
git rm -r apps/api/src/db/seeds
git rm apps/api/src/geoserver/publish.ts
```

`apps/api/package.json`: delete the scripts `seed`, `ingest:rivers` and `publish:geoserver`.
Root `package.json`: delete `seed` and `publish:geoserver`.

`apps/api/src/scripts/buildRiverHierarchy.ts`: in the doc comment, replace "To actually rebuild, delete the version and re-run `npm run ingest:rivers -w @webatlas/api`." with "To actually rebuild, delete the version and run `npm run atlas:build -- --force rivers`: with no active version the load is new content, and activation builds the hierarchy." and the log line `re-run \`npm run ingest:rivers\` to rebuild` with `to rebuild, see this script's header`.

`packages/atlas-data/tools/prune-hydrosheds-versions.mjs:42`: `'Hãy chạy seed + ingest:rivers để OSM thành active trước.'` → `'Hãy chạy npm run atlas:build để OSM thành active trước.'`

`packages/shared/src/legend.ts`: the comment in `LEGEND_ATTRIBUTION` that says the hazard layers "are seeded from local placeholder data (db/seeds/registry.ts)" → "(packages/atlas-data/src/descriptors/layers.ts)". `npm run build:shared`, and `git add -f packages/shared/dist/legend.js` if it changed.

`.github/workflows/ci.yml`, `api` job: replace the three lines

```yaml
      - run: npm run seed
```
…the comment block above `ingest:rivers`…
```yaml
      - run: npm run ingest:rivers -w @webatlas/api
```

with

```yaml
      # Ranh giới, bảy lớp chuyên đề và sông, nạp bằng chính bộ nạp của atlas:build nhưng không
      # ghi trạng thái build và không cần GeoServer. Kiểm thử của packages/versioning dùng dữ
      # liệu này; bộ kiểm thử API tự gọi lại ensureSeeded (không làm gì khi dữ liệu đã có).
      - run: npm run atlas:seed
```

- [ ] **Step 3: Verify**

| Command | Expected |
|---|---|
| `npx tsc -p apps/api/tsconfig.json --noEmit`, same for `packages/atlas-data`, `packages/versioning` | no errors |
| `npm run test:api` | as recorded in Task 2 |
| `npm run test:versioning`, `test:shared`, `test -w @webatlas/atlas-data`, `test:web` | 51, 119, pass, 543 |
| `npm run seed`; `npm run ingest:rivers -w @webatlas/api`; `npm run publish:geoserver` | each fails: `Missing script` |
| `npm run rivers:hierarchy -w @webatlas/api` | exits 0, pinned figures unchanged |
| `npm run atlas:status`, `npm run atlas:verify` | all `ok`; 50 of 50 |
| `grep -rn "npm run seed\|ingest:rivers\|publish:geoserver" apps packages .github --include=* \| grep -v node_modules \| grep -v dist/` | only `lineage.test.ts` and `run.test.ts`, which use `ingest:rivers` as an argv example for a `run` stage |

Change those two test literals to a script that exists (`['run', 'reference:build', '-w', '@webatlas/api']`), so no file names a command that is gone.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api packages package.json .github
git commit -m "refactor: bỏ các lệnh seed, ingest:rivers và publish:geoserver cùng mã của chúng

Sổ đăng ký đã nạp và công bố các lớp này bằng load-geojson và
publish-geoserver; kiểm thử và CI nạp qua ensureSeeded / atlas:seed.
rivers:hierarchy (chỉ kiểm tra, không ghi) được giữ lại.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Documents

**Files:** `README.md`, `docs/runbooks/README.md`, `docs/runbooks/*.md` that name an old command, `docs/architecture/database-architecture.md`, `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md`

- [ ] **Step 1: Find every mention**

Run: `grep -rn "npm run seed\|ingest:rivers\|publish:geoserver\|runSeeds\|ingestRivers\|db/seeds" README.md docs/runbooks docs/architecture`

- [ ] **Step 2: Rewrite each**

- `README.md`, workspace scripts table: delete the `npm run seed` and `npm run publish:geoserver` rows; add `` | `npm run atlas:seed` | Load the committed seed data without building: for CI and a test database (no GeoServer, no build state) | ``. In the API-workspace scripts sentence drop `ingest:rivers`. The "Regenerating OSM water data" steps 6–7 (`npm run seed`, `npm run ingest:rivers`) become one step: `npm run atlas:build` (a changed seed file makes its dataset stale and is loaded as a new version; if the layer has steward edits it stops and names `--supersede-edits`). Remove the paragraph that explains `ingest:rivers` must run after `seed`.
- `docs/runbooks/README.md`: the sentence "The old commands (…) still work" lists what remains: only `reference:build` and `contours:generate`, which the registry runs as `run` stages. Step 3's parenthesis about `npm run seed` still existing: delete. The "Upgrading an existing database" note: replace "Run `npm run seed -w @webatlas/api` and `npm run ingest:rivers -w @webatlas/api` again" with "`npm run atlas:build -- --force admin_boundaries`, which re-stamps every layer". The line "`npm run publish:geoserver` is superseded by `atlas:build` and kept until Plan C": delete.
- `docs/architecture/database-architecture.md`, the Plan C paragraph: all three parts are done; say what the end state is (the registry loads and publishes every thematic layer; tests and CI seed through `ensureSeeded` / `atlas:seed`; the old commands are gone) in the present tense, without "remains".
- Spec `2026-09-30-registry-steps-2-5-design.md`, §11 "Test setup": append "**Amended 2026-10-04 (Plan C-3):** the helper takes no layer list and runs once per test run from a Vitest global setup; it re-labels a version the old command loaded before loading anything. CI, which this design had parked, runs the same function through a command, `npm run atlas:seed`, because the `packages/versioning` suite needs seeded data and cannot import `atlas-data`."

- [ ] **Step 3: Commit**

```bash
git add README.md docs
git commit -m "docs: tài liệu theo trạng thái sau kế hoạch C — không còn lệnh seed cũ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fresh-clone acceptance (controller-run)

The same proof as Plan B's Task 12, on the new load path: a machine with nothing reaches a verified atlas with one command.

- [ ] **Step 1: Prepare a clean clone and a throwaway stack**

```bash
ACCEPT="<scratchpad>/atlas-accept-c3"
git clone --branch feat/registry-plan-c3 "C:/Users/quock/Documents/Projects/webatlas" "$ACCEPT"
netsh interface ipv4 show excludedportrange protocol=tcp     # pick two free ports outside every range
```

In the clone: `npm install`; copy `infra/.env.example` to `infra/.env` and `apps/api/.env.example` to `apps/api/.env`; set `POSTGRES_PORT` and `GEOSERVER_PORT` in `infra/.env` to the two free ports and point `DATABASE_URL`, `ASSISTANT_DATABASE_URL` and `GEOSERVER_URL` in `apps/api/.env` at them. Every command in the clone runs with `COMPOSE_PROJECT_NAME=webatlas_accept_c3`.

Nothing is copied into the clone's `data/cache`: the run downloads the basemap extract and the DEM tiles itself.

- [ ] **Step 2: Run it, timed, with a log**

```bash
cd "$ACCEPT" && { echo "START $(date '+%F %T')"; COMPOSE_PROJECT_NAME=webatlas_accept_c3 npm run atlas:up 2>&1; echo "EXIT $? $(date '+%F %T')"; } > atlas-up.log 2>&1
```

Expected: exit 0; the log shows the nine `load-geojson` datasets loading (`admin: replaced …`, `dams: 151 features in a new version …`, …, `rivers: 23119 features in a new version …`), and `all 50 checks passed`.

If it fails: read the log, fix the cause on the branch with a test, commit, pull in the clone, and re-run `atlas:up` (it resumes). Record every run, as Plan B's notes do.

- [ ] **Step 3: Check the result in the clone**

1. `npm run atlas:status`: every dataset `ok`.
2. `npm run atlas:verify`: `all 50 checks passed`.
3. `npm run atlas:up` again: `executed 0`; the version count in the clone's database does not change.
4. `npm run atlas:seed`: every line `unchanged`.
5. `SELECT layer_key, source, feature_count FROM app.dataset_versions WHERE is_active ORDER BY 1` in the clone's database: eight rows, each source `…@sha256:<64 hex>`, counts 151 / 2 / 2 / 2 / 3868 / 23119 / 2 / 2.

- [ ] **Step 4: Record the measurement**

In `README.md`, "Getting started", update the measured time and its date with this run's figures, in the same sentence shape (duration, line speed if measured, what was cached). In this plan's execution notes: the timing table per step, as in Plan B's Task 12 notes.

- [ ] **Step 5: Tear down**

Ask the user before deleting the throwaway stack and clone, as before:

```bash
docker compose -p webatlas_accept_c3 -f "$ACCEPT/infra/docker-compose.yml" --env-file "$ACCEPT/infra/.env" down -v
rm -rf "$ACCEPT"
```

Confirm afterwards that `webatlas-db-1` and `webatlas-geoserver-1` are still up and their volumes present.

---

### Task 6: CI, pull request, notes

- [ ] **Step 1:** `git push -u origin feat/registry-plan-c3`; `gh pr create --base main` with a Vietnamese body: `## Tóm tắt`, `## Kiểm chứng` (suite totals; the version count before and after two `test:api` runs; the acceptance run's time and result), `## Khác với spec` (the four decisions above), `## Lưu ý` (stacked on #21 and #20; a machine built before runs `npm run atlas:adopt` then `atlas:build`; the commands that no longer exist), `## Việc còn lại sau kế hoạch C` (the deferred list below).
- [ ] **Step 2:** Watch CI. Expected: all four jobs pass; the `api` job's log shows `atlas:seed` loading the nine datasets on the empty database, and the API suite's `[seed]` lines absent (already loaded).
- [ ] **Step 3:** Append `## Execution notes` to this plan; commit; push.

## Deferred, for a follow-up after Plan C

From Plan B's reviews, unchanged by this plan:

- `atlas:build`, `atlas:verify`, `atlas:status` and `atlas:adopt` ignore `--compose` (`ATLAS_COMPOSE_FILE` works, undocumented).
- A second clone shares the compose project name `webatlas`; the isolation recipe lives only in plan notes.
- No lock against two builds running at once.
- `atlas:up --only X` prints the full success hint for a partial atlas.
- The geometry column type of a basemap table is decided by its first chunk (latent).
- Old pinned basemap zips stay in the cache.
- The fixture's `build` takes the extract name from the descriptor, and reads the database in several sessions.
- The timing-sensitive `select_within` test against the 5 s analysis timeout.

New, from Plan C:

- `packages/shared/dist` is ignored and tracked at once; two tracked outputs (`attribute-schema`, `map-view`) have no source.
- A forced `rivers` rebuild with unchanged content re-stamps and does not rebuild the hierarchy; after a change to the hierarchy algorithm the version has to be deleted first.

---

## Execution notes (2026-10-04, inline in the controller session)

| Task | Commit | Result |
|---|---|---|
| 1. `ensureSeeded`, `atlas:seed` | `48a67a1` | 5 database tests |
| 2. API tests seed through the loader | `02a193c` | `test:api` 434 |
| 3. Remove the old commands | `7e27e20` | six source files, three scripts, two root aliases |
| 4. Documents | `2d549f5` | |
| 5. Acceptance | (this commit: README figure) | passed on the first run |
| 6. PR #22 | run 37197598921 | `shared`, `web`, `atlas-data`, `api` all pass |

**Criterion 1: a second API test run adds no versions.** On the dev stack `app.dataset_versions` held 241 rows before, 241 after the first `npm run test:api`, 241 after the second. Before this plan one run added 22.

On the dev machine the first `npm run atlas:seed` printed `unchanged admin_boundaries` and `relabelled` for the eight layers (their active versions carried the old labels again after earlier test runs), with the count at 241 before and after; the second printed nine `unchanged`.

**Criterion 2: fresh-clone acceptance.** Clean clone of `feat/registry-plan-c3` at `2d549f5`, compose project `webatlas_accept_c3`, PostgreSQL on 45432 and GeoServer on 48080, nothing copied into `data/cache`. One run of `npm run atlas:up`: START 18:05:38, `EXIT 0` 18:24:43, **19 min 5 s**; `executed 31, skipped 0`; `all 50 checks passed`.

| Step | Time |
|---|---|
| preflight | 2 s |
| stack up, db and GeoServer ready | 39 s |
| atlas-tools image (cached) | 7 s |
| migrations | not measured, see below |
| `admin_boundaries` and the seven layers (load + publish) | 3 s |
| `rivers` (23,119 features in one version, hierarchy and gates, 2 publishes) | 43 s |
| basemap fetch (688 MB) | 1 min 45 s |
| basemap load (peak 990 MB) | 5 min 16 s |
| basemap feature types, styles, five groups | 13 s |
| `reference_entities` | 8 s |
| `dem` (18 tiles: download and clip 1 min 56 s, load 1 min 22 s) | 3 min 20 s |
| `contours` | 4 min 58 s |
| verify | 8 s |

The thematic data, which Plan B's acceptance loaded in 23 s (seeds) plus 73 s (rivers) through the old commands, now loads in 46 s.

*Measurement caveat.* The log was timestamped by a shell loop that calls `date` once per line. On this machine that is slow enough to hold back a process that prints fast: the 1,180 lines of migration output took 86 s to pass through it, where the same migrations took 6 s in Plan B's run. So the migration row is not a measurement, and the 19 min 5 s total includes about a minute of overhead from the logging itself. The other steps print little and are not affected.

Then, in the clone:

- `atlas:status`: all fourteen datasets `ok`. `atlas:verify`: `all 50 checks passed`.
- A second `atlas:up`: `executed 0, skipped 31`, `all 50 checks passed`; 15 version rows before and after.
- `atlas:seed`: nine `unchanged`; 15 rows.
- Active versions: `dams` 151, `drought_points` 2, `flood_generation` 2, `flood_zones` 2, `lakes` 3868, `rivers` 23119, `saltwater_intrusion` 2, `stations` 2, each with a `…@sha256:` source.
- The 15 rows are those eight plus seven empty `seed:<layer>` placeholders (label `version 1`, `feature_count` 0, inactive) that migration `1000000000004_dataset-versions` inserts on any new database. That is why the loaded versions are labelled `version 2` (`lakes`, added by a later migration, `version 1`). The old commands behaved the same.
- Cache in the clone: 1.4 GB.

**CI (run 37197598921).** On the empty database `atlas:seed` printed `replaced admin_boundaries` and `loaded` for the eight layers, with the same content hashes as the dev machine. Then: `test:versioning` 51; the three atlas-data database test files 17; `test:api` 420 passed and 14 skipped, with no `[seed]` line from its global setup (nothing left to do).

**Final numbers, dev stack.** `test:api` 434; `test:versioning` 51; `test:shared` 119; atlas-data 350 passed and 43 skipped, plus 17 database tests; `test:web` 543. `npm run seed`, `npm run ingest:rivers -w @webatlas/api` and `npm run publish:geoserver` each answer `Missing script`. `rivers:hierarchy` exits 0 (588 rivers, 439 names, 4,716 named reaches). `atlas:verify` 50 of 50.

**Deviations from this plan**

- Task 3: `ensureSeeded.db.test.ts` was added to the CI step that runs the atlas-data database tests. The two `run`-stage test literals now use `reference:build`. A comment in `ensureSeeded.ts` named the removed command; reworded.
- Task 2: `test:api` ends at 434, not 435: the three `nativeNameFor` tests, the second-seed-run test and the `loadAdminBoundaries` idempotency test went (5); two tests were replaced one for one.
- Task 5 Step 5 (tear-down) waits for the user's word.
