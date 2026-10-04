# Plan C-1: the `packages/versioning` boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the versioning core out of `apps/api` into a new workspace package, `@webatlas/versioning`, and the seed attribute mappings into `@webatlas/shared`, with no change in behaviour, so that Plan C-2's `load-geojson` stage in `packages/atlas-data` can use them without importing an app.

**Architecture:** A source-exported TypeScript package (no build step: every consumer runs through `tsx` or Vitest) holding the versions service and repository, admin-code stamping, the river hierarchy and its gates, the feature loader, and two HTTP-free base error classes. `apps/api` imports all of it through the package and deletes its own copies, so nothing exists twice. The tests of the moved code move with it and run against the same database.

**Tech Stack:** TypeScript 6, Node 22, `pg` 8, Vitest 3, npm workspaces, Fastify (API error mapping), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md`, §7 "`packages/versioning` (new, D4)" and §14 Plan C. Plan C is delivered as three plans and three PRs (user decision 2026-10-04): **C-1 this plan**, C-2 the `load-geojson` stage and datasets, C-3 the switch-over (test seeding, CI, removal of the old commands, acceptance).

## Global Constraints

- Branch `feat/registry-plan-c1`, from `main` at `dab2bfb`. One PR at the end.
- **No behaviour change.** Every moved test must pass with only its import lines edited. If a moved test needs any other edit, stop and report.
- Dependencies point one way: `apps/api → packages/versioning → packages/shared`. No package imports an app (spec §7).
- The old commands keep working throughout: `npm run seed`, `npm run ingest:rivers -w @webatlas/api`, `npm run rivers:hierarchy -w @webatlas/api`, `npm run atlas:build` (spec NFR-7).
- Moves are `git mv`, so history follows the files.
- Commit messages are Vietnamese Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `packages/shared/dist` is tracked in git: after changing `packages/shared/src`, run `npm run build:shared` and commit `dist` with it.
- Test counts before this plan, on the dev stack: `test:api` 487, `test:shared` 108, `test -w @webatlas/atlas-data` 321 passed and 26 skipped. After it: `test:api` 435, `test -w @webatlas/versioning` 55, `test:shared` 118, atlas-data unchanged. 49 API tests move to the package and 4 dam-status tests to shared; the plan adds 13 new tests (4 errors, 1 error handler, 2 `loadFeatures`, 6 mappings). The moved counts come from counting `it(` in the files; if the real totals differ by a parametrised test, record the real numbers and carry on.

**Two deviations from the spec's wording, both deliberate:**

1. *Errors.* The spec says the API's error classes "extend" the package's base classes. They cannot: the API's `NotFoundError` and `ConflictError` already extend `AppError`, which carries the HTTP status. The package instead exports plain `NotFoundError` and `ConflictError`, and the API's error handler maps them to the same 404 and 409 responses. The HTTP behaviour is unchanged, which is what the spec's sentence is for.
2. *Packaging.* `packages/shared` is consumed through a built, tracked `dist`. `packages/versioning` is consumed as source (`exports` points at `src/index.ts`): it is server-only, every consumer already runs TypeScript directly, and a second tracked `dist` would be a second thing to forget to rebuild.

## File Structure

| File | Responsibility |
|---|---|
| `packages/versioning/package.json`, `tsconfig.json`, `vitest.config.ts` (create) | The package and its test settings (same serialisation and timeouts as the API suite) |
| `packages/versioning/src/index.ts` (create) | The public surface |
| `packages/versioning/src/errors.ts` (create) | `NotFoundError`, `ConflictError`, no HTTP knowledge |
| `packages/versioning/src/testEnv.ts`, `testPool.ts` (create) | Test-only: load `apps/api/.env`, hand out one pool |
| `packages/versioning/src/{repository,service,adminStamp,riverHierarchy,riverGates}.ts` (moved) | From `apps/api/src/modules/versions/` and `apps/api/src/db/` |
| `packages/versioning/src/loadFeatures.ts` (create) | `loadFeatures`, from `loadLayerFeatures` in `apps/api/src/db/seeds/run.ts` |
| `packages/versioning/src/*.test.ts` (moved) | The six test files of the moved code |
| `packages/shared/src/seed-columns.ts` (create) | `ColumnMap`, the seven layers' and the two river sources' column maps |
| `packages/shared/src/dam-status.ts` (modify) | Gains `assignDamStatus` |
| `apps/api/src/plugins/errorHandler.ts` (modify) | Maps the package's errors to 404 and 409 |
| `apps/api/src/db/seeds/{registry,run,ingestRivers,ingestReaches}.ts` (modify) | Use the package and the shared maps |
| `.github/workflows/ci.yml`, root `package.json`, `README.md`, `docs/architecture/database-architecture.md` (modify) | Run and describe the new package |

---

### Task 1: Scaffold `@webatlas/versioning` with its error classes

**Files:**
- Create: `packages/versioning/package.json`, `packages/versioning/tsconfig.json`, `packages/versioning/vitest.config.ts`
- Create: `packages/versioning/src/errors.ts`, `packages/versioning/src/errors.test.ts`, `packages/versioning/src/index.ts`
- Create: `packages/versioning/src/testEnv.ts`, `packages/versioning/src/testPool.ts`
- Modify: root `package.json` (one script)

**Interfaces:**
- Produces: package `@webatlas/versioning` resolvable from any workspace; `NotFoundError`, `ConflictError` (both `extends Error`, `name` set to the class name, default messages `'Not found'` and `'Conflict'`); test helpers `getPool(): pg.Pool` and `closePool(): Promise<void>` in `src/testPool.ts`.

- [ ] **Step 1: Write the package manifest and configs**

`packages/versioning/package.json`:

```json
{
  "name": "@webatlas/versioning",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@webatlas/shared": "*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^24.13.2",
    "@types/pg": "^8.11.10",
    "dotenv": "^16.4.5",
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
```

`packages/versioning/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`packages/versioning/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests moved here from apps/api unchanged, and they share its database. Same settings
    // as apps/api/vitest.config.ts, for the same reasons: files run one at a time because suites
    // clean up their own rows, and the timeouts are integration budgets, not unit ones.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['./src/testEnv.ts'],
  },
});
```

- [ ] **Step 2: Write the test helpers**

`packages/versioning/src/testEnv.ts`:

```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Test-only. The package has no .env of its own: its tests run against the API's database, so
// when DATABASE_URL is not already set (CI sets it) it is read from apps/api/.env.
if (!process.env.DATABASE_URL) {
  const apiEnv = fileURLToPath(new URL('../../../apps/api/.env', import.meta.url));
  if (existsSync(apiEnv)) config({ path: apiEnv });
}
```

`packages/versioning/src/testPool.ts`:

```ts
import pg from 'pg';

// Test-only: one pool per test file, like apps/api/src/db/pool.ts. Not exported from index.ts.
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```

- [ ] **Step 3: Write the failing error test**

`packages/versioning/src/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ConflictError, NotFoundError } from './index';

describe('versioning errors', () => {
  it('are plain Errors named after their class, so a caller can map them without importing HTTP', () => {
    const nf = new NotFoundError('Version x not found for layer dams');
    expect(nf).toBeInstanceOf(Error);
    expect(nf.name).toBe('NotFoundError');
    expect(nf.message).toBe('Version x not found for layer dams');
    const c = new ConflictError('no active version for layer dams');
    expect(c).toBeInstanceOf(Error);
    expect(c.name).toBe('ConflictError');
  });

  it('are distinct classes', () => {
    expect(new NotFoundError()).not.toBeInstanceOf(ConflictError);
    expect(new ConflictError()).not.toBeInstanceOf(NotFoundError);
  });

  it('have default messages', () => {
    expect(new NotFoundError().message).toBe('Not found');
    expect(new ConflictError().message).toBe('Conflict');
  });

  it('carry no HTTP status: that mapping belongs to the API', () => {
    expect('statusCode' in new NotFoundError()).toBe(false);
    expect('statusCode' in new ConflictError()).toBe(false);
  });
});
```

- [ ] **Step 4: Link the workspace and run the test to see it fail**

Run: `npm install` (links `node_modules/@webatlas/versioning`; `package-lock.json` gains the workspace entry), then `npm run test -w @webatlas/versioning`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 5: Implement**

`packages/versioning/src/errors.ts`:

```ts
/**
 * What the versioning core throws. No HTTP knowledge here: apps/api's error handler maps
 * NotFoundError to 404 and ConflictError to 409 (apps/api/src/plugins/errorHandler.ts), and the
 * dataset pipeline reports them as a failed stage.
 */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = new.target.name;
  }
}

export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = new.target.name;
  }
}
```

`packages/versioning/src/index.ts`:

```ts
/**
 * The versioning core: dataset versions, activation and its obligations (river hierarchy, gates,
 * administrative codes), and loading features into a version. Depends on `pg` and
 * `@webatlas/shared` only, so both the API and the dataset pipeline can use it (spec §7, D4).
 */
export { ConflictError, NotFoundError } from './errors';
```

- [ ] **Step 6: Run the test and the type check**

Run: `npm run test -w @webatlas/versioning` and `npm run typecheck -w @webatlas/versioning`
Expected: 4 tests pass; no type errors.

- [ ] **Step 7: Add the root script and commit**

In root `package.json`, after `"test:api:live"`:

```json
    "test:versioning": "npm run test -w @webatlas/versioning",
```

```bash
git add packages/versioning package.json package-lock.json
git commit -m "feat(versioning): gói @webatlas/versioning — khung gói và hai lớp lỗi không gắn HTTP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Move the versioning core and its tests

**Files:**
- Move: `apps/api/src/modules/versions/{repository,service}.ts` and `{repository,service,activate-stamping,riverHierarchy-hook}.test.ts` → `packages/versioning/src/`
- Move: `apps/api/src/db/{adminStamp,riverHierarchy,riverGates}.ts` and `{adminStamp,riverHierarchy}.test.ts` → `packages/versioning/src/`
- Modify: `packages/versioning/src/index.ts`
- Modify: `apps/api/package.json` (dependency), `apps/api/src/plugins/errorHandler.ts`, `apps/api/src/plugins/errorHandler.test.ts`
- Modify (imports only): `apps/api/src/modules/layers/service.ts`, `apps/api/src/modules/layers/service.test.ts`, `apps/api/src/scripts/buildRiverHierarchy.ts`, `apps/api/src/db/seeds/run.ts`, `apps/api/src/db/seeds/ingestRivers.ts`, `apps/api/src/modules/versions/integration.test.ts`

**Interfaces:**
- Consumes: `NotFoundError`, `ConflictError`, `getPool`, `closePool` from Task 1.
- Produces, all from `@webatlas/versioning`: `versionsService(pool)` with `createIngestVersion`, `activate`, `openEditDraft`, `commitEditDraft`, `discardEditDraft`, `resolveFeatureIds`, `getActiveVersionId`, `getVersion`; types `VersionsService`, `IngestVersionArgs`; `versionsRepository(pool)`, types `VersionsRepository`, `DatasetVersion`; `stampAdminCodes(client, layerKey, versionId)`; `buildRiverHierarchy`, `materialiseResolved`, and the constants `MATCH_SAMPLES`, `MATCH_MIN_VOTES`, `MATCH_TOLERANCE_DEG`, `MATCH_MAX_MEDIAN_M`, `MATCH_KNN_WINDOW`, `BRIDGED_CONFIDENCE`; `assertRiverGates`, `RIVER_BASELINE`, type `RiverBaseline`. Signatures are exactly today's.

- [ ] **Step 1: Write the failing API test for the error mapping**

In `apps/api/src/plugins/errorHandler.test.ts`, add the import and two routes, then a test.

After `import { ForbiddenError, ConflictError } from '../errors';` add:

```ts
import { ConflictError as VersioningConflictError, NotFoundError as VersioningNotFoundError } from '@webatlas/versioning';
```

After `app.get('/conflict', async () => { throw new ConflictError('dup'); });` add:

```ts
  app.get('/versioning-not-found', async () => { throw new VersioningNotFoundError('Version v not found for layer dams'); });
  app.get('/versioning-conflict', async () => { throw new VersioningConflictError('no active version for layer dams'); });
```

Inside `describe('error handler', …)`, add:

```ts
  it('maps the versioning package errors to the same 404 and 409 the API classes give', async () => {
    // The package knows nothing about HTTP. Before it existed, the versions service threw the
    // API's own classes, so these two responses must not change.
    const nf = await app.inject({ method: 'GET', url: '/versioning-not-found' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Version v not found for layer dams' } });
    const c = await app.inject({ method: 'GET', url: '/versioning-conflict' });
    expect(c.statusCode).toBe(409);
    expect(c.json()).toEqual({ error: { code: 'CONFLICT', message: 'no active version for layer dams' } });
  });
```

- [ ] **Step 2: Add the dependency and run the test to see it fail**

In `apps/api/package.json`, in `dependencies`, after `"@webatlas/shared": "*",` add `"@webatlas/versioning": "*",`. Run `npm install`.

Run: `npm run test -w @webatlas/api -- src/plugins/errorHandler.test.ts`
Expected: the new test FAILS with status 500 where 404 is expected.

- [ ] **Step 3: Map the errors in the handler**

In `apps/api/src/plugins/errorHandler.ts`, replace the import line and the first branch of the handler:

```ts
import { AppError, ConflictError, InternalError, NotFoundError } from '../errors';
import { ConflictError as VersioningConflictError, NotFoundError as VersioningNotFoundError } from '@webatlas/versioning';
```

```ts
    if (err instanceof AppError) {
      appErr = err;
    } else if (err instanceof VersioningNotFoundError) {
      // The versioning package throws its own, HTTP-free classes; they keep the responses the
      // versions service gave when it lived here and threw the API's.
      appErr = new NotFoundError(err.message);
    } else if (err instanceof VersioningConflictError) {
      appErr = new ConflictError(err.message);
    } else if ((err as { statusCode?: number }).statusCode === 429) {
```

Delete the line `void NotFoundError; // referenced by modules; keep import tree-shake-safe` (the import is used now).

Run: `npm run test -w @webatlas/api -- src/plugins/errorHandler.test.ts`
Expected: all pass.

- [ ] **Step 4: Move the files**

```bash
git mv apps/api/src/modules/versions/repository.ts              packages/versioning/src/repository.ts
git mv apps/api/src/modules/versions/service.ts                 packages/versioning/src/service.ts
git mv apps/api/src/modules/versions/repository.test.ts         packages/versioning/src/repository.test.ts
git mv apps/api/src/modules/versions/service.test.ts            packages/versioning/src/service.test.ts
git mv apps/api/src/modules/versions/activate-stamping.test.ts  packages/versioning/src/activate-stamping.test.ts
git mv apps/api/src/modules/versions/riverHierarchy-hook.test.ts packages/versioning/src/riverHierarchy-hook.test.ts
git mv apps/api/src/db/adminStamp.ts          packages/versioning/src/adminStamp.ts
git mv apps/api/src/db/adminStamp.test.ts     packages/versioning/src/adminStamp.test.ts
git mv apps/api/src/db/riverHierarchy.ts      packages/versioning/src/riverHierarchy.ts
git mv apps/api/src/db/riverHierarchy.test.ts packages/versioning/src/riverHierarchy.test.ts
git mv apps/api/src/db/riverGates.ts          packages/versioning/src/riverGates.ts
```

`apps/api/src/modules/versions/` now holds only `integration.test.ts`, which stays: it exercises the seed registry, which is the API's until Plan C-3.

- [ ] **Step 5: Fix the imports inside the package**

`packages/versioning/src/service.ts`, the four moved imports become siblings:

```ts
import { versionsRepository } from './repository';
import { stampAdminCodes } from './adminStamp';
import { buildRiverHierarchy } from './riverHierarchy';
import { assertRiverGates, RIVER_BASELINE } from './riverGates';
import { ConflictError, NotFoundError } from './errors';
```

In each moved test, only the pool import changes:

| File | Old line | New line |
|---|---|---|
| `repository.test.ts`, `service.test.ts`, `activate-stamping.test.ts`, `riverHierarchy-hook.test.ts` | `import { getPool, closePool } from '../../db/pool';` | `import { getPool, closePool } from './testPool';` |
| `adminStamp.test.ts`, `riverHierarchy.test.ts` | `import { getPool, closePool } from './pool';` | `import { getPool, closePool } from './testPool';` |

`repository.ts`, `adminStamp.ts`, `riverHierarchy.ts` and `riverGates.ts` need no edit: they import only `pg`, `@webatlas/shared` and each other by `./` paths that still hold.

Then check nothing else in the moved files points outside the package:

Run: `grep -n "from '\.\./" packages/versioning/src/*.ts`
Expected: no output.

- [ ] **Step 6: Export the moved code**

Replace `packages/versioning/src/index.ts` with:

```ts
/**
 * The versioning core: dataset versions, activation and its obligations (river hierarchy, gates,
 * administrative codes), and loading features into a version. Depends on `pg` and
 * `@webatlas/shared` only, so both the API and the dataset pipeline can use it (spec §7, D4).
 */
export { ConflictError, NotFoundError } from './errors';
export { versionsService, type IngestVersionArgs, type VersionsService } from './service';
export { versionsRepository, type DatasetVersion, type VersionsRepository } from './repository';
export { stampAdminCodes } from './adminStamp';
export {
  buildRiverHierarchy,
  materialiseResolved,
  MATCH_SAMPLES,
  MATCH_MIN_VOTES,
  MATCH_TOLERANCE_DEG,
  MATCH_MAX_MEDIAN_M,
  MATCH_KNN_WINDOW,
  BRIDGED_CONFIDENCE,
} from './riverHierarchy';
export { assertRiverGates, RIVER_BASELINE, type RiverBaseline } from './riverGates';
```

- [ ] **Step 7: Point the API at the package**

| File | Old import | New import |
|---|---|---|
| `apps/api/src/modules/layers/service.ts` | `import { versionsService } from '../versions/service';` | `import { versionsService } from '@webatlas/versioning';` |
| `apps/api/src/modules/layers/service.test.ts` | its imports of `../versions/service` and `../versions/repository` | one import of the same names from `'@webatlas/versioning'` |
| `apps/api/src/scripts/buildRiverHierarchy.ts` | `import { buildRiverHierarchy } from '../db/riverHierarchy';` and `import { assertRiverGates, RIVER_BASELINE } from '../db/riverGates';` | `import { assertRiverGates, buildRiverHierarchy, RIVER_BASELINE } from '@webatlas/versioning';` |
| `apps/api/src/db/seeds/run.ts` | `import { versionsService } from '../../modules/versions/service';` | `import { versionsService } from '@webatlas/versioning';` |
| `apps/api/src/db/seeds/ingestRivers.ts` | `import { versionsService } from '../../modules/versions/service';` | `import { versionsService } from '@webatlas/versioning';` |
| `apps/api/src/modules/versions/integration.test.ts` | `import { versionsService } from './service';` | `import { versionsService } from '@webatlas/versioning';` |

Then find anything missed:

Run: `grep -rnE "versions/(service|repository)'|db/(adminStamp|riverHierarchy|riverGates)'|'\./(adminStamp|riverHierarchy|riverGates)'|'\./service'|'\./repository'" apps/api/src --include=*.ts`
Expected: no output. (Comments that mention `versions/service.ts` by name are fine; this pattern matches import specifiers only.)

- [ ] **Step 8: Type-check and run the suites**

Run, in order:
1. `npm run typecheck -w @webatlas/versioning`: no errors.
2. `npx tsc -p apps/api/tsconfig.json --noEmit`: no errors.
3. `npm run test -w @webatlas/versioning`: 53 tests pass (49 moved, 4 from Task 1). The pinned figures in `riverHierarchy.test.ts` (4,716 matched reaches, 439 names) must hold exactly.
4. `npm run test:api`: 439 tests pass (487, minus the 49 moved, plus the 1 new error-handler test).
5. `npm run rivers:hierarchy -w @webatlas/api`: exits 0, as before.

If a moved test fails, compare against `main` before changing anything: the code did not change, so a failure means an import resolved to something else, or the test relied on a setting of the API's Vitest config that `packages/versioning/vitest.config.ts` lacks.

- [ ] **Step 9: Commit**

```bash
git add -A packages/versioning apps/api package-lock.json
git status --short   # renames (R) for the eleven moved files; M for the importers; nothing else
git commit -m "refactor(versioning): chuyển lõi phiên bản từ apps/api sang packages/versioning

versionsService và repository, đóng dấu mã hành chính, phân cấp sông và
các cổng kích hoạt chuyển nguyên trạng sang gói mới, kèm sáu tệp kiểm thử
(chỉ đổi dòng import). apps/api dùng chúng qua gói, không còn bản sao.
Trình xử lý lỗi của API ánh xạ NotFoundError/ConflictError của gói về
đúng 404 và 409 như trước.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `loadFeatures` in the package

**Files:**
- Create: `packages/versioning/src/loadFeatures.ts`, `packages/versioning/src/loadFeatures.test.ts`
- Modify: `packages/versioning/src/index.ts`
- Modify: `apps/api/src/db/seeds/run.ts`, `apps/api/src/db/seeds/registry.ts`, `apps/api/src/db/seeds/ingestRivers.ts`, `apps/api/src/modules/versions/integration.test.ts`

**Interfaces:**
- Produces: `loadFeatures(client: pg.PoolClient, spec: FeatureLoadSpec, versionId: string): Promise<number>` and

  ```ts
  export interface FeatureLoadSpec {
    /** The table under `water.`; also the layer key. From descriptor code, never from input. */
    table: string;
    /** Absolute path of a GeoJSON FeatureCollection. */
    file: string;
    /** Wrap a single Polygon as MultiPolygon. */
    multiPolygon?: boolean;
    /** Normalise a LineString or MultiLineString as MultiLineString. */
    multiLine?: boolean;
    /** Map a feature's properties to `{ column: value }`, excluding geometry. */
    columns: (props: Record<string, unknown>, index: number) => Record<string, unknown>;
  }
  ```
- The API's `SeedLayer` becomes `FeatureLoadSpec & { source: string }`. The name `loadLayerFeatures` is retired.

- [ ] **Step 1: Write the failing test**

`packages/versioning/src/loadFeatures.test.ts`. It uses the real `water.stations` table and a throwaway version that is rolled back, so it leaves nothing behind:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPool, closePool } from './testPool';
import { loadFeatures, versionsService, type FeatureLoadSpec } from './index';

const dir = mkdtempSync(join(tmpdir(), 'load-features-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});

function fixture(name: string, features: unknown[]): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
  return file;
}

describe('loadFeatures', () => {
  it('inserts every feature into the given version, mapping columns and storing NULL for a missing geometry', async () => {
    const spec: FeatureLoadSpec = {
      table: 'stations',
      file: fixture('stations.geojson', [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'lf-1', name: 'A' } },
        { type: 'Feature', geometry: null, properties: { id: 'lf-2', name: 'B' } },
      ]),
      columns: (p, index) => ({ external_id: p.id, name: `${String(p.name)}#${index}` }),
    };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await versionsService(pool).createIngestVersion(client, {
        layerKey: 'stations', source: 'loadFeatures.test', label: 'loadFeatures.test',
      });
      expect(await loadFeatures(client, spec, versionId)).toBe(2);
      const { rows } = await client.query<{ external_id: string; name: string; has_geom: boolean; srid: number | null }>(
        `SELECT external_id, name, geom IS NOT NULL AS has_geom, ST_SRID(geom) AS srid
           FROM water.stations WHERE dataset_version_id = $1 ORDER BY external_id`,
        [versionId]
      );
      expect(rows).toEqual([
        { external_id: 'lf-1', name: 'A#0', has_geom: true, srid: 4326 },
        { external_id: 'lf-2', name: 'B#1', has_geom: false, srid: null },
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('wraps a single polygon as a MultiPolygon when the spec asks for it', async () => {
    const square = [[[108, 12], [108.01, 12], [108.01, 12.01], [108, 12.01], [108, 12]]];
    const spec: FeatureLoadSpec = {
      table: 'flood_zones',
      multiPolygon: true,
      file: fixture('zones.geojson', [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: square }, properties: { id: 'lf-z1' } },
      ]),
      columns: (p) => ({ external_id: p.id, name: 'zone' }),
    };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const versionId = await versionsService(pool).createIngestVersion(client, {
        layerKey: 'flood_zones', source: 'loadFeatures.test', label: 'loadFeatures.test',
      });
      await loadFeatures(client, spec, versionId);
      const { rows } = await client.query<{ t: string }>(
        `SELECT GeometryType(geom) AS t FROM water.flood_zones WHERE dataset_version_id = $1`, [versionId]
      );
      expect(rows).toEqual([{ t: 'MULTIPOLYGON' }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test -w @webatlas/versioning -- src/loadFeatures.test.ts`
Expected: FAIL, `loadFeatures` is not exported from `./index`.

- [ ] **Step 3: Implement**

`packages/versioning/src/loadFeatures.ts` (the body is `loadLayerFeatures` from `apps/api/src/db/seeds/run.ts`, unchanged apart from the names):

```ts
import { readFileSync } from 'node:fs';
import type pg from 'pg';

/** What to load into one version of one layer. Comes from descriptor code, never from input. */
export interface FeatureLoadSpec {
  /** The table under `water.`; also the layer key. */
  table: string;
  /** Absolute path of a GeoJSON FeatureCollection. */
  file: string;
  /** Wrap a single Polygon as MultiPolygon. */
  multiPolygon?: boolean;
  /** Normalise a LineString or MultiLineString as MultiLineString. */
  multiLine?: boolean;
  /**
   * Map a feature's properties to `{ column: value }`, excluding geometry. `index` is the
   * feature's 0-based position in the file, for sources with no reliable per-feature key.
   */
  columns: (props: Record<string, unknown>, index: number) => Record<string, unknown>;
}

function geomExpr(spec: FeatureLoadSpec): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (spec.multiPolygon || spec.multiLine) return `ST_Multi(${base})`;
  return base;
}

/**
 * Load every feature of `spec.file` into `water.<spec.table>`, stamped with `versionId`, on the
 * caller's client and inside the caller's transaction. Returns the number of rows inserted.
 * No ON CONFLICT: a new version starts empty, so there is nothing to conflict with.
 */
export async function loadFeatures(
  client: pg.PoolClient,
  spec: FeatureLoadSpec,
  versionId: string
): Promise<number> {
  const fc = JSON.parse(readFileSync(spec.file, 'utf8'));
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = fc.features;
  let count = 0;

  for (const [index, f] of features.entries()) {
    const cols = spec.columns(f.properties, index);
    const colNames = Object.keys(cols);
    const values = Object.values(cols);
    const hasGeometry = f.geometry != null;

    if (!hasGeometry) {
      // eslint-disable-next-line no-console
      console.warn(
        `water.${spec.table}: feature external_id=${String(cols.external_id)} has no geometry; storing NULL`
      );
    }

    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = hasGeometry ? geomExpr(spec).replace('$GEOM', `$${geomParamIndex}`) : 'NULL';
    // With geometry the version is the parameter after it; without geometry no
    // geometry parameter is bound, so the version takes that slot instead.
    const versionParamIndex = hasGeometry ? colNames.length + 2 : colNames.length + 1;

    const sql = `
      INSERT INTO water.${spec.table} (${colNames.join(', ')}, geom, dataset_version_id)
      VALUES (${colPlaceholders.join(', ')}, ${geomSql}, $${versionParamIndex})
    `;
    const params = hasGeometry
      ? [...values, JSON.stringify(f.geometry), versionId]
      : [...values, versionId];
    await client.query(sql, params);
    count++;
  }
  return count;
}
```

Add to `packages/versioning/src/index.ts`:

```ts
export { loadFeatures, type FeatureLoadSpec } from './loadFeatures';
```

- [ ] **Step 4: Run the package tests**

Run: `npm run test -w @webatlas/versioning`
Expected: 55 tests pass.

- [ ] **Step 5: Use it from the API**

`apps/api/src/db/seeds/registry.ts`: replace the `SeedLayer` interface (the whole `export interface SeedLayer { … }` block) with:

```ts
import type { FeatureLoadSpec } from '@webatlas/versioning';

/** A load spec plus its provenance: the origin recorded on the dataset_versions row. */
export type SeedLayer = FeatureLoadSpec & { source: string };
```

(Move the `import type` line up with the other imports.)

`apps/api/src/db/seeds/run.ts`:
- Delete `geomExpr` and `loadLayerFeatures` (from `function geomExpr` to the closing brace of `loadLayerFeatures`), and the now-unused imports `readFileSync` and `type pg`.
- Change `import { versionsService } from '@webatlas/versioning';` to `import { loadFeatures, versionsService } from '@webatlas/versioning';`.
- Change `result[layer.table] = await loadLayerFeatures(client, layer, versionId);` to `result[layer.table] = await loadFeatures(client, layer, versionId);`.

`apps/api/src/db/seeds/ingestRivers.ts`:
- Delete `import { loadLayerFeatures } from './run';`.
- Change the package import to `import { loadFeatures, versionsService } from '@webatlas/versioning';`.
- Change the two calls `loadLayerFeatures(client, RIVERS_HYDRO_LAYER, versionId)` and `loadLayerFeatures(client, REACHES_LAYER, versionId)` to `loadFeatures(…)`.

`apps/api/src/modules/versions/integration.test.ts`:
- Delete `import { loadLayerFeatures } from '../../db/seeds/run';`.
- Change the package import to `import { loadFeatures, versionsService } from '@webatlas/versioning';`.
- Replace every `loadLayerFeatures(` with `loadFeatures(`.

Run: `grep -rn "loadLayerFeatures" apps packages --include=*.ts`
Expected: no output.

- [ ] **Step 6: Verify**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`, then `npm run test:api`
Expected: no type errors; 439 tests pass. `seed.test.ts` and `integration.test.ts` exercise the full seed and river ingest through `loadFeatures`.

- [ ] **Step 7: Commit**

```bash
git add packages/versioning apps/api/src/db/seeds apps/api/src/modules/versions/integration.test.ts
git commit -m "refactor(versioning): loadFeatures — nạp đối tượng vào một phiên bản, chuyển từ db/seeds/run.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Attribute mappings and `assignDamStatus` in `packages/shared`

**Files:**
- Create: `packages/shared/src/seed-columns.ts`, `packages/shared/src/seed-columns.test.ts`
- Modify: `packages/shared/src/dam-status.ts`, `packages/shared/src/index.ts`
- Move: `apps/api/src/db/seeds/damStatus.test.ts` → `packages/shared/src/assign-dam-status.test.ts`
- Delete: `apps/api/src/db/seeds/damStatus.ts`
- Modify: `apps/api/src/db/seeds/registry.ts`, `apps/api/src/db/seeds/ingestRivers.ts`, `apps/api/src/db/seeds/ingestReaches.ts`, `packages/atlas-data/src/types.ts`
- Rebuild and commit: `packages/shared/dist`

**Interfaces:**
- Produces, from `@webatlas/shared`:
  - `type ColumnMap = (props: Record<string, unknown>, index: number) => Record<string, unknown>`
  - `assignDamStatus(externalId: unknown): DamStatusSlug`
  - `SEED_LAYER_COLUMNS: Record<'dams' | 'stations' | 'flood_zones' | 'drought_points' | 'saltwater_intrusion' | 'flood_generation' | 'lakes', ColumnMap>`
  - `RIVER_WAY_COLUMNS: ColumnMap` (OSM ways, level 3) and `RIVER_REACH_COLUMNS: ColumnMap` (HydroRIVERS reaches, level 2)
- Plan C-2's `load-geojson` descriptors import these.

- [ ] **Step 1: Move the dam-status test and write the mapping test**

```bash
git mv apps/api/src/db/seeds/damStatus.test.ts packages/shared/src/assign-dam-status.test.ts
```

In it, replace the two import lines

```ts
import { assignDamStatus } from './damStatus';
import { DAM_STATUS_SLUGS } from '@webatlas/shared';
```

with

```ts
import { assignDamStatus, DAM_STATUS_SLUGS } from './dam-status';
```

`packages/shared/src/seed-columns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EDITABLE_LAYER_KEYS } from './index';
import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS, SEED_LAYER_COLUMNS } from './seed-columns';
import { assignDamStatus } from './dam-status';

describe('seed column maps', () => {
  it('cover every editable layer except rivers, which loads from two sources', () => {
    expect(Object.keys(SEED_LAYER_COLUMNS).sort()).toEqual(EDITABLE_LAYER_KEYS.filter((k) => k !== 'rivers').sort());
  });

  it('map a dam from the Open Development Vietnam field names, with its deterministic status', () => {
    const row = SEED_LAYER_COLUMNS.dams(
      { ID: 17, Vietnamese: 'Buôn Kuốp', English_hy: 'Buon Kuop', Wattage_PL: 280, 'Quantity_(': 1455, Year_of_la: 2003, Year_of_op: 2009 },
      0
    );
    expect(row).toEqual({
      external_id: 17, name: 'Buôn Kuốp', name_en: 'Buon Kuop', wattage_mw: 280,
      annual_output: 1455, year_launched: 2003, year_operational: 2009, status: assignDamStatus(17),
    });
  });

  it('map the synthetic layers from their camelCase properties', () => {
    expect(SEED_LAYER_COLUMNS.stations({ id: 's1', name: 'N', type: 'rain', status: 'ok', value: 3 }, 0))
      .toEqual({ external_id: 's1', name: 'N', station_type: 'rain', status: 'ok', value: 3 });
    expect(SEED_LAYER_COLUMNS.flood_zones({ id: 'f1', name: 'N', type: 'flood', area: 2, riskLevel: 'high' }, 0))
      .toEqual({ external_id: 'f1', name: 'N', hazard_type: 'flood', area: 2, risk_level: 'high' });
    expect(SEED_LAYER_COLUMNS.drought_points({ id: 'd1', name: 'N', riskLevel: 'low', status: 'ok', surveyDate: '2026-01-01' }, 0))
      .toEqual({ external_id: 'd1', name: 'N', risk_level: 'low', status: 'ok', survey_date: '2026-01-01' });
    expect(SEED_LAYER_COLUMNS.saltwater_intrusion({ id: 'x1', name: 'N', salinity: 4, riskLevel: 'low', status: 'ok' }, 0))
      .toEqual({ external_id: 'x1', name: 'N', salinity: 4, risk_level: 'low', status: 'ok' });
    expect(SEED_LAYER_COLUMNS.flood_generation({ id: 'g1', name: 'N', riskLevel: 'low', area: 5, flowRate: 9 }, 0))
      .toEqual({ external_id: 'g1', name: 'N', risk_level: 'low', area: 5, flow_rate: 9 });
  });

  it('map an OSM lake, leaving the HydroLAKES-only measures null', () => {
    expect(SEED_LAYER_COLUMNS.lakes({ osmId: 99, name: 'Hồ Lắk', lakeType: 'Lake' }, 0)).toEqual({
      external_id: 99, name: 'Hồ Lắk', lake_type: 'Lake', area_km2: null, volume_mcm: null, shore_len_km: null,
    });
  });

  it("prefix an OSM way id with 'osm:' so it can never be mistaken for a HYRIV_ID", () => {
    expect(RIVER_WAY_COLUMNS({ osmId: 123, waterway: 'river', name: 'Sông Ba', streamOrder: 4, lengthM: 1500 }, 0))
      .toEqual({ external_id: 'osm:123', code: 'river', name: 'Sông Ba', stream_order: 4, length_m: 1500 });
  });

  it('map a HydroRIVERS reach as a level-2 row, with a terminal reach flowing into NULL', () => {
    expect(RIVER_REACH_COLUMNS({ HYRIV_ID: 40001, NEXT_DOWN: 40002, ORD_STRA: 3, LENGTH_KM: 2.5 }, 0)).toEqual({
      external_id: 'hyriv:40001', feature_level: 2, flows_into_external_id: 'hyriv:40002',
      stream_order: 3, length_m: 2500, name: null,
    });
    expect(RIVER_REACH_COLUMNS({ HYRIV_ID: 40002, NEXT_DOWN: 0, ORD_STRA: 4, LENGTH_KM: 1 }, 0).flows_into_external_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:shared`
Expected: `assign-dam-status.test.ts` FAILS (`assignDamStatus` is not exported from `./dam-status`) and `seed-columns.test.ts` FAILS (cannot resolve `./seed-columns`).

- [ ] **Step 3: Implement**

Append to `packages/shared/src/dam-status.ts` (the function body is `apps/api/src/db/seeds/damStatus.ts`, unchanged):

```ts
/** Stable non-negative hash of a string (djb2-ish), same as the frontend hashCode. */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

/**
 * Deterministically assign a dam status slug from its external id.
 * Weighted ~70/18/12 (normal/xa_lu/nguy_hiem). Same id -> same slug (idempotent seed).
 */
export function assignDamStatus(externalId: unknown): DamStatusSlug {
  const bucket = hashString(String(externalId)) % 100;
  if (bucket < 70) return DAM_STATUS_SLUGS[0]; // binh_thuong
  if (bucket < 88) return DAM_STATUS_SLUGS[1]; // xa_lu
  return DAM_STATUS_SLUGS[2];                   // nguy_hiem
}
```

If `dam-status.ts` does not already declare `DamStatusSlug` and `DAM_STATUS_SLUGS` under those names, stop and report: the API file imported both from `@webatlas/shared`, so they must exist.

`packages/shared/src/seed-columns.ts`:

```ts
import { assignDamStatus } from './dam-status.js';

/** Map a GeoJSON feature's properties to `{ column: value }`, excluding geometry. */
export type ColumnMap = (props: Record<string, unknown>, index: number) => Record<string, unknown>;

/**
 * How each seed file's properties become columns of its `water.<layer>` table. Here, beside the
 * layer keys and attribute definitions, so the API's seed command and the dataset pipeline's
 * load-geojson stage read one mapping and cannot drift (INV-4).
 *
 * `rivers` is not in this record: it loads from two files with two mappings, below.
 */
export const SEED_LAYER_COLUMNS = {
  dams: (p) => ({
    external_id: p.ID,
    name: p.Vietnamese,
    name_en: p.English_hy,
    wattage_mw: p.Wattage_PL,
    annual_output: p['Quantity_('],
    year_launched: p.Year_of_la,
    year_operational: p.Year_of_op,
    status: assignDamStatus(p.ID),
  }),
  stations: (p) => ({ external_id: p.id, name: p.name, station_type: p.type, status: p.status, value: p.value }),
  flood_zones: (p) => ({ external_id: p.id, name: p.name, hazard_type: p.type, area: p.area, risk_level: p.riskLevel }),
  drought_points: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, status: p.status, survey_date: p.surveyDate }),
  saltwater_intrusion: (p) => ({ external_id: p.id, name: p.name, salinity: p.salinity, risk_level: p.riskLevel, status: p.status }),
  flood_generation: (p) => ({ external_id: p.id, name: p.name, risk_level: p.riskLevel, area: p.area, flow_rate: p.flowRate }),
  // OSM has lake names (HydroLAKES does not) and far better coverage. The cost: no
  // Vol_total / Shore_len, which OSM does not carry.
  lakes: (p) => ({
    external_id: p.osmId,
    name: p.name,
    lake_type: p.lakeType,
    area_km2: null,
    volume_mcm: null,
    shore_len_km: null,
  }),
} satisfies Record<string, ColumnMap>;

/**
 * OSM waterways as level-3 rows of water.rivers. Unlike HydroRIVERS, OSM has river names, and
 * `stream_order` here is a rank by waterway type, not a Strahler order.
 */
export const RIVER_WAY_COLUMNS: ColumnMap = (p) => ({
  // 'osm:' so an OSM way id can never be mistaken for a HYRIV_ID (migration 18).
  external_id: `osm:${String(p.osmId)}`,
  code: p.waterway,
  name: p.name,
  stream_order: p.streamOrder,
  // Computed from the geometry by build-osm-seeds.mjs; OSM has no such field.
  length_m: p.lengthM,
});

/**
 * HydroRIVERS reaches as level-2 rows of water.rivers. A reach row is the network edge: its
 * geometry is the span and flows_into_external_id its single outgoing adjacency.
 *
 * MAIN_RIV is in the seed file but deliberately not loaded: no column holds it, and overloading
 * `code` (the OSM waterway type at level 3) would make a column's meaning depend on the row's level.
 */
export const RIVER_REACH_COLUMNS: ColumnMap = (p) => ({
  external_id: `hyriv:${String(p.HYRIV_ID)}`,
  feature_level: 2,
  // HydroRIVERS writes 0 for a terminal reach -> NULL, "end of the network". A NEXT_DOWN that is
  // simply not in the file (a reach leaving the region) keeps its value: "the water goes somewhere
  // we do not hold" is a different fact, and collapsing both to NULL would hide it from the gates.
  flows_into_external_id: Number(p.NEXT_DOWN) === 0 ? null : `hyriv:${String(p.NEXT_DOWN)}`,
  // The true Strahler order (ORD_STRA). Level 3 keeps the OSM waterway rank: two different
  // measures that must not be compared.
  stream_order: p.ORD_STRA,
  length_m: Number(p.LENGTH_KM) * 1000,
  // HydroRIVERS has no names; the joined name is recorded on the link, never here.
  name: null,
});
```

In `packages/shared/src/index.ts`, after `export * from './dam-status.js';` add:

```ts
export * from './seed-columns.js';
```

- [ ] **Step 4: Run the shared tests and rebuild `dist`**

Run: `npm run test:shared`, then `npm run build:shared`
Expected: 118 tests pass (108, plus the 4 moved dam-status tests and the 6 new mapping tests). `packages/shared/dist` gains `seed-columns.js` and `seed-columns.d.ts`, and `dam-status.*` and `index.*` change.

- [ ] **Step 5: Use the shared maps from the API and the pipeline**

`apps/api/src/db/seeds/registry.ts`:
- Delete `import { assignDamStatus } from './damStatus';` and add `import { SEED_LAYER_COLUMNS } from '@webatlas/shared';`.
- Replace each layer's inline `columns: (p) => ({ … })` with `columns: SEED_LAYER_COLUMNS.<table>`: `dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`, `lakes`. Keep each entry's `table`, `file`, `source`, `multiPolygon` and its comments.

`apps/api/src/db/seeds/ingestRivers.ts`: add `import { RIVER_WAY_COLUMNS } from '@webatlas/shared';` and replace the `columns: (p) => ({ … })` of `RIVERS_HYDRO_LAYER` with `columns: RIVER_WAY_COLUMNS,`.

`apps/api/src/db/seeds/ingestReaches.ts`: add `import { RIVER_REACH_COLUMNS } from '@webatlas/shared';` and replace the `columns: (p) => ({ … })` of `REACHES_LAYER` with `columns: RIVER_REACH_COLUMNS,`. Keep the file's doc comment.

```bash
git rm apps/api/src/db/seeds/damStatus.ts
```

`packages/atlas-data/src/types.ts`: replace the local `ColumnMap` declaration (the doc comment and the `export type ColumnMap = …;` statement) with:

```ts
export type { ColumnMap } from '@webatlas/shared';
```

and, because `Stage` in the same file uses the type, add at the top: `import type { ColumnMap } from '@webatlas/shared';`.

Run: `grep -rn "damStatus'" apps packages --include=*.ts`
Expected: no output.

- [ ] **Step 6: Verify everything**

Run, in order:
1. `npx tsc -p apps/api/tsconfig.json --noEmit` and `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`: no errors.
2. `npm run test:api`: 435 tests pass (439, minus the 4 dam-status tests that moved). `riversIdentity.test.ts` still pins the `osm:` prefix through `RIVERS_HYDRO_LAYER`.
3. `npm run test -w @webatlas/atlas-data`: 321 passed, 26 skipped.
4. `npm run build:web`: succeeds (the web app consumes `packages/shared/dist`).
5. `git status --short packages/shared/dist`: only `dam-status.*`, `index.*` and the new `seed-columns.*`.

- [ ] **Step 7: Commit**

```bash
git add -A packages/shared apps/api/src/db/seeds packages/atlas-data/src/types.ts
git commit -m "refactor(shared): ánh xạ thuộc tính của dữ liệu seed và assignDamStatus chuyển sang packages/shared

Một bản duy nhất cho lệnh seed của API và stage load-geojson sắp có
(INV-4). Kiểu ColumnMap cũng nằm ở shared; atlas-data tái xuất nó.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: CI, documents, and the pull request

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/architecture/database-architecture.md`
- Modify: this plan (execution notes)

**Interfaces:**
- Consumes: everything above.
- Produces: PR against `main` with all checks green.

- [ ] **Step 1: Run the package's tests in CI**

The moved tests need the same database state as before (migrations, seeds, rivers), so they run in the `api` job, before the API suite. In `.github/workflows/ci.yml`, in the `api` job, replace

```yaml
      - run: python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
      - run: npm run test:api
```

with

```yaml
      - run: python3 packages/atlas-data/tools/fixtures/basemap_fixture.py verify
      # Lõi phiên bản nằm ở packages/versioning; kiểm thử của nó dùng chung cơ sở dữ liệu này
      # (đã migrate, seed và nạp sông ở các bước trên), nên chạy ngay trong job api.
      - run: npx tsc -p packages/versioning/tsconfig.json --noEmit
      - run: npm run test:versioning
      - run: npx tsc -p apps/api/tsconfig.json --noEmit
      - run: npm run test:api
```

(The API type check is new to CI too: until now nothing in CI type-checked `apps/api`, and this plan rewires its imports.)

- [ ] **Step 2: Update the documents**

`README.md`, in the monorepo layout block, after the `shared/` line add:

```
    versioning/     # @webatlas/versioning — dataset versions, activation, river hierarchy, feature loading (used by api and atlas-data)
```

and in the workspace scripts table, after the `npm run test:api` row add:

```
| `npm run test:versioning` | Run the versioning package's tests (needs the DB stack up and seeded) |
```

`docs/architecture/database-architecture.md`: around line 684, the sentence that says Plan C "moves the versioning core into its own package and adds the `load-geojson` executor" describes it as future work. Rewrite that sentence to say the versioning core now lives in `packages/versioning` (Plan C-1), and that the `load-geojson` executor and the removal of the old seed commands remain (Plans C-2 and C-3). Read the paragraph first and keep its other statements.

Run: `grep -rn "modules/versions/service\|db/adminStamp\|db/riverHierarchy\|db/riverGates\|seeds/damStatus" docs README.md --include=*.md | grep -v "docs/superpowers/"`
Expected: no output. If a runbook or the architecture document names an old path, update it to the `packages/versioning/src/` path. Specs and plans under `docs/superpowers/` are historical and stay as written.

- [ ] **Step 3: Full verification on the dev stack**

Run and record each result:

| Command | Expected |
|---|---|
| `npm run test:shared` | 118 passed |
| `npm run test:versioning` | 55 passed |
| `npm run test:api` | 435 passed |
| `npm run test -w @webatlas/atlas-data` | 321 passed, 26 skipped |
| `npm run test:web` | 543 passed |
| `npm run atlas:status` | every dataset `ok` (no descriptor changed, so nothing goes stale) |
| `npm run atlas:verify` | `all 29 checks passed` |
| `docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions"` before and after one more `npm run test:versioning` | recorded; C-3 will make this stable, C-1 only must not make it worse than `main` |

Total tests before: 487 + 108 = 595 across api and shared. After: 435 + 55 + 118 = 608, which is the 595 plus the 13 new tests of this plan (4 errors, 1 handler, 2 `loadFeatures`, 6 mappings).

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add .github/workflows/ci.yml README.md docs/architecture/database-architecture.md
git commit -m "ci: chạy kiểm thử và typecheck của packages/versioning; typecheck apps/api

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/registry-plan-c1
gh pr create --base main --head feat/registry-plan-c1 --title "Kế hoạch C-1: lõi phiên bản chuyển sang packages/versioning" --body-file <body>
```

The PR body, in Vietnamese like the earlier PRs: `## Tóm tắt` (what moved where, the dependency direction, that behaviour is unchanged), `## Hai chỗ khác với spec` (errors mapped in the handler; the package is consumed as source), `## Kiểm chứng` (the table from Step 3 with the real numbers), `## Tiếp theo` (C-2, C-3). End with the Claude Code attribution line.

- [ ] **Step 5: Watch CI and record the outcome**

```bash
gh run watch <id> --interval 20
gh pr checks <pr>
```

Expected: `shared`, `web`, `atlas-data`, `api` all pass. Then append `## Execution notes` to this plan (commit of each task, the numbers from Step 3, the CI run id, deviations), commit and push.
