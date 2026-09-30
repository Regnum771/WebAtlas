# Registry Plan A — Rebuild Cascade and the `run`, `fetch-http` and `publish-geoserver` Stages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the registry able to execute real datasets. That means:
- invalidating downstream state before a stage runs (I3), with `--force`;
- recording what each stage actually ran (I4);
- executing `run`, `fetch-http` and `publish-geoserver` stages;
- proving it all on the real `rivers` dataset.

**Architecture:**
- Stage execution moves behind one executor table (`src/stages/index.ts`). Each executor returns a one-line summary of what it did, and the runner turns that into the ISO 19115 process step.
- The runner deletes downstream stage state before executing, computed over the whole registry.
- `run` stages start processes without a shell: host `npm` commands via npm's own `npm-cli.js`, and tools commands via `docker compose run`.
- `fetch-http` downloads atomically into `packages/atlas-data/data/cache`.
- `publish-geoserver` is a self-contained port of the API's GeoServer publishing.

**Tech Stack:** TypeScript (ES2023, `verbatimModuleSyntax`), zod, `pg`, vitest, Node 22 built-ins (`child_process`, `readline`, `fetch`, `stream`, `process.loadEnvFile`).

**Spec:** [`2026-09-30-registry-steps-2-5-design.md`](../specs/2026-09-30-registry-steps-2-5-design.md) §7–§8 and §14 row A. Base spec: [`2026-09-16-dataset-registry-and-one-command-build-design.md`](../specs/2026-09-16-dataset-registry-and-one-command-build-design.md).

## Global Constraints

- **Branch** `feat/registry-steps-2-5` (spec committed at `1127beb`). Node `>=22 <23`, npm `>=10`.
- **No new runtime dependencies** in `packages/atlas-data`. Use Node built-ins only (the package depends on `pg` and `zod` and nothing else).
- **No process is ever started through a shell** (`shell: false` always, spec NFR-2).
  - **Deviation from spec §7, measured on this machine:** `spawn('npm', …, { shell: false })` fails with `ENOENT` on Windows, because `npm` is a `.cmd` shim, and Node ≥ 20.12 refuses to start `.cmd` files without a shell.
  - Host stages therefore run `process.execPath` with npm's `npm-cli.js` as the first argument. The path comes from `npm_execpath` when set, otherwise it is found beside `node`. That is shell-free on every OS.
- **Commands:** no command in this plan may run `docker compose down`, with or without `-v`.
- **Old commands keep working** (spec NFR-7). `npm run seed`, `npm run ingest:rivers -w @webatlas/api` and `npm run publish:geoserver` are not touched. `apps/api/src/geoserver/publish.ts` stays until Plan C removes it; the port in Task 6 is a deliberate, temporary duplicate.
- **Database-backed tests** are gated `describe.skipIf(!process.env.DATABASE_URL)`. GeoServer-backed tests are gated on `GEOSERVER_URL`. Both **must be shown to execute**, not skip. Run them with the dev environment exported (Git Bash, from the repo root):
  ```bash
  set -a; . apps/api/.env; set +a
  ```
  Test datasets and layers use the `__atlasdata_test__` prefix, never a real id.
- **Typecheck:** `npm run build -w @webatlas/atlas-data` (tsc, which excludes tests) must pass before every commit. vitest does not typecheck.
- **Commits** are in Vietnamese and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Measured Baselines (2026-09-30, `main` at `5ac6c01`)

- **atlas-data tests:** 14 files / 102 tests pass with `DATABASE_URL` exported.
- **`npm run atlas:status`:** `demo 0:sql: ok 1:sql: ok` and `hydrorivers 0:run: missing`. The runner cannot execute `run`: `runner.ts` `executeStage` throws `Stage type "run" is not implemented yet`.
- **`npm run ingest:rivers -w @webatlas/api` on this machine:** an existing active version is re-activated. That rebuilds the hierarchy and takes about a minute, with `0 rows would change`.
- **GeoServer:** `webatlas:rivers` is published with `nativeName = rivers_detail` (by `apps/api/src/geoserver/publish.ts`).

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/atlas-data/src/paths.ts` | `REPO_ROOT`, `PACKAGE_ROOT`, `DATA_CACHE`: the only place that knows the directory layout |
| `packages/atlas-data/src/stages/index.ts` | The executor table: `executeStage`, `hasExecutor`, `StageContext`, `StageResult` |
| `packages/atlas-data/src/process.ts` | `runProcess`: shell-free spawn, prefixed line streaming, heartbeat, last-N tail |
| `packages/atlas-data/src/stages/run.ts` | `npmCli`, `commandFor`, `executeRun` |
| `packages/atlas-data/src/stages/fetchHttp.ts` | `executeFetchHttp`: atomic download into `data/cache` |
| `packages/atlas-data/src/geoserver.ts` | `geoserverEnv`, `gsRequest`, `publishLayer`: GeoServer REST, ported from `apps/api/src/geoserver/{client,publish}.ts` |
| `packages/atlas-data/src/stages/publishGeoserver.ts` | `executePublishGeoserver` |
| `packages/atlas-data/src/cli/env.ts` | `loadDevEnv`: load `apps/api/.env` when `DATABASE_URL` is unset |
| `packages/atlas-data/src/descriptors/rivers.ts` | Renamed from `hydrorivers.ts`; argv form, plus a publish stage |
| Tests beside each: `process.test.ts`, `stages/run.test.ts`, `stages/fetchHttp.test.ts`, `geoserver.test.ts`, `stages/publishGeoserver.live.test.ts`, `cli/env.test.ts`, `stages/index.test.ts` | |

**Modified**

| File | Change |
|---|---|
| `packages/atlas-data/src/types.ts` | `run` gains `in` and `argv` (replacing `command`); `publish-geoserver` gains `nativeName` |
| `packages/atlas-data/src/schema.ts` | The above, plus `fetch-http` `into` must stay inside `data/cache` |
| `packages/atlas-data/src/debt.ts` | The overdue message uses `argv` |
| `packages/atlas-data/src/lineage.ts` | `processStep()`: the I4 description |
| `packages/atlas-data/src/state.ts` | `invalidateStageState()` |
| `packages/atlas-data/src/graph.ts` | `transitiveDependents()` |
| `packages/atlas-data/src/runner.ts` | Executor table, I3 cascade, `force`, `universe`, `log`, I4 steps |
| `packages/atlas-data/src/stages/sql.ts` | Returns a `StageResult` |
| `packages/atlas-data/src/registry.ts` | Rejects stage types with no executor |
| `packages/atlas-data/src/cli/args.ts`, `select.ts`, `build.ts`, `status.ts` | `--force`; `loadDevEnv`; `universe` |
| `packages/atlas-data/src/descriptors/index.ts` | `rivers` instead of `hydrorivers` |
| `.gitignore` | `packages/atlas-data/data/cache/` |

---

### Task 1: The `run` stage takes an argument vector; `fetch-http` stays inside the cache

**Files:**
- Modify: `packages/atlas-data/src/types.ts`, `src/schema.ts`, `src/debt.ts`, `src/descriptors/index.ts`
- Rename: `src/descriptors/hydrorivers.ts` → `src/descriptors/rivers.ts`
- Test: `src/schema.test.ts`, `src/debt.test.ts`, `src/registry.test.ts`

**Interfaces:**
- Produces: these stage types, which every later task uses:
  - `Extract<Stage, { type: 'run' }>` = `{ type: 'run'; in: 'host' | 'tools'; argv: string[]; produces: string; promoteTo: string; promoteBy: string }`
  - `Extract<Stage, { type: 'publish-geoserver' }>` = `{ type: 'publish-geoserver'; layer: string; nativeName?: string; style?: string }`
  - the dataset `rivers`, exported from `src/descriptors/rivers.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/schema.test.ts`, replace every `command: './x.sh'` in the existing `run` fixtures with `in: 'host', argv: ['./x.sh']`. The `@ts-expect-error` lines stay where they are. Then append:

```ts
describe('run stage argv (spec §7)', () => {
  const run = (extra: Record<string, unknown>) => ({
    ...valid,
    stages: [{ type: 'run', produces: 'out', promoteTo: 'sql', promoteBy: '2099-01-01', ...extra }],
  });

  it('accepts in + argv', () => {
    expect(() => defineDataset(run({ in: 'host', argv: ['run', 'x'] }) as never)).not.toThrow();
  });

  it('rejects a leftover command string even beside a valid argv (a shell would re-parse it)', () => {
    // in + argv are valid, so only .strict() can reject this; the Step 8 mutation relies on it.
    expect(() => defineDataset(run({ in: 'host', argv: ['x'], command: 'npm run x' }) as never)).toThrow();
  });

  it('rejects an empty argv', () => {
    expect(() => defineDataset(run({ in: 'tools', argv: [] }) as never)).toThrow();
  });

  it('rejects an unknown execution place', () => {
    expect(() => defineDataset(run({ in: 'cloud', argv: ['x'] }) as never)).toThrow();
  });
});

describe('fetch-http into (spec §8: downloads stay inside data/cache)', () => {
  const fetchStage = (into: string) => ({
    ...valid,
    stages: [{ type: 'fetch-http' as const, url: 'https://example.org/a.zip', into }],
  });

  it('accepts a relative path', () => {
    expect(() => defineDataset(fetchStage('basemap/vietnam.zip'))).not.toThrow();
  });

  it.each(['../escape.zip', 'a/../../escape.zip', '/abs/path.zip', 'C:\\abs\\path.zip', 'a\\..\\..\\x'])(
    'rejects %s',
    (into) => {
      expect(() => defineDataset(fetchStage(into))).toThrow();
    }
  );
});
```

In `src/debt.test.ts`, change the `withRunStage` fixture's stage to:

```ts
{ type: 'run', in: 'tools', argv: ['prep_dem.py'], produces: 'dem.tif', promoteTo: 'fetch-cog', promoteBy },
```

and add inside `describe('assertNoOverdueEscapeHatches', …)`:

```ts
  it('names the overdue command by its argv', () => {
    expect(() => assertNoOverdueEscapeHatches([withRunStage('2026-01-01')], TODAY)).toThrow(
      /run "prep_dem\.py"/
    );
  });
```

In `src/registry.test.ts`, change the `bad-date` fixture's stage to `{ type: 'run', in: 'host', argv: ['x'], produces: 'y', promoteTo: 'sql', promoteBy: '2026-02-30' }`, and add:

```ts
  it('registers the rivers dataset under its layer key, not "hydrorivers" (spec C-9)', () => {
    const ids = ALL_DATASETS.map((d) => d.id);
    expect(ids).toContain('rivers');
    expect(ids).not.toContain('hydrorivers');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/schema.test.ts src/debt.test.ts src/registry.test.ts`
Expected: FAIL. The leftover-`command` case passes validation where it should throw, `argv` fixtures fail validation, and `rivers` is not registered.

- [ ] **Step 3: Change the types**

In `src/types.ts`, replace the `publish-geoserver` and `run` members of `Stage` with:

```ts
  | {
      type: 'publish-geoserver';
      /** The public layer name, e.g. `rivers` → `webatlas:rivers`. */
      layer: string;
      /** The relation behind it. Defaults to `<layer>_active`, the active-version view. */
      nativeName?: string;
      /** A default style to assign, by name. */
      style?: string;
    }
  | {
      type: 'run';
      /**
       * Where it executes (spec §7):
       * - 'host': `npm` on this machine, and `argv` is npm's arguments;
       * - 'tools': inside the atlas-tools container (Plan B), and `argv` is the container command.
       */
      in: 'host' | 'tools';
      /** An argument vector, never a command string: nothing is ever re-parsed by a shell. */
      argv: string[];
      produces: string;
      /** Which built-in stage should eventually absorb this. */
      promoteTo: string;
      /** ISO date (YYYY-MM-DD). A past date fails the build. */
      promoteBy: string;
    };
```

and document `fetch-http`'s `into`:

```ts
  | {
      type: 'fetch-http';
      url: string;
      /** A relative path inside packages/atlas-data/data/cache. */
      into: string;
      sha256?: string;
    }
```

- [ ] **Step 4: Change the schema**

In `src/schema.ts`, add at the top:

```ts
import { posix, win32 } from 'node:path';

/**
 * A path that stays inside data/cache: relative on both platforms' rules, and with no `..`
 * segment under either separator. Checked here so a descriptor cannot even be defined
 * with a path that escapes the cache, whichever OS it was written on.
 */
const cacheRelativePath = z
  .string()
  .min(1)
  .refine(
    (p) => !posix.isAbsolute(p) && !win32.isAbsolute(p) && !p.split(/[\\/]/).includes('..'),
    'must be a relative path inside data/cache, with no ".." segment'
  );
```

Replace the `fetch-http`, `publish-geoserver` and `run` members of `stageSchema` with:

```ts
  z.object({
    type: z.literal('fetch-http'),
    url: z.string().url(),
    into: cacheRelativePath,
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }),
```

```ts
  z.object({
    type: z.literal('publish-geoserver'),
    layer: z.string().min(1),
    nativeName: z.string().min(1).optional(),
    style: z.string().optional(),
  }),
```

```ts
  z
    .object({
      type: z.literal('run'),
      in: z.enum(['host', 'tools']),
      argv: z.array(z.string().min(1)).min(1),
      produces: z.string().min(1),
      // Both required: the escape hatch cannot be constructed untracked (spec §2).
      promoteTo: z.string().min(1),
      promoteBy: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'promoteBy must be YYYY-MM-DD')
        // The regex alone accepts impossible dates like 2026-02-30 (JS Date parsing
        // silently rolls those over to March). Re-render through Date and compare the
        // ISO calendar date back to the input: a real date round-trips, an impossible
        // one does not. Number.isNaN guards non-date strings so this never throws
        // (Date#toISOString throws RangeError on an Invalid Date).
        .refine((v) => {
          const d = new Date(`${v}T00:00:00Z`);
          return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        }, 'promoteBy must be a real calendar date (e.g. 2026-02-30 is invalid)'),
    })
    // A leftover `command` string would be silently stripped by zod and the stage would
    // run nothing a reader expects; reject it so the argv migration cannot half-happen.
    .strict(),
```

- [ ] **Step 5: Change the debt message**

In `src/debt.ts`, replace the `overdue.push(...)` template's command part:

```ts
        overdue.push(
          `  ${d.id}: run "${stage.argv.join(' ')}" had promoteBy ${stage.promoteBy}, ` +
            `should have been promoted to "${stage.promoteTo}"`
        );
```

- [ ] **Step 6: Rename the rivers descriptor**

```bash
git mv packages/atlas-data/src/descriptors/hydrorivers.ts packages/atlas-data/src/descriptors/rivers.ts
```

Replace the whole of `src/descriptors/rivers.ts` with:

```ts
import { defineDataset } from '../schema';

/**
 * Sông ba cấp trong MỘT phiên bản: đường thuỷ OSM (cấp 3), đoạn HydroRIVERS (cấp 2), và
 * sông có tên (cấp 1) mà versionsService.activate() dựng lại khi phiên bản được kích hoạt.
 *
 * Id là khoá lớp `rivers` chứ không phải `hydrorivers` (spec C-9): hàng trạng thái cũ
 * dưới id `hydrorivers` chỉ có trên máy dev và vô hại.
 *
 * Còn là cửa thoát `run` cho tới khi load-geojson có (Plan C, spec §11). Lệnh chạy trên
 * máy chủ qua npm, không qua shell.
 */
export const rivers = defineDataset({
  id: 'rivers',
  kind: 'vector',
  editable: true,
  lineage: {
    statement:
      'Đoạn sông HydroRIVERS v10 chọn theo sáu tỉnh vùng công tác, nối tên từ đường thuỷ OSM, ' +
      'dựng thành phân cấp sông ba cấp.',
    // The combined product is under the more restrictive of its two sources: OSM's ODbL
    // share-alike binds any database derived from it, including the level-1 rivers.
    licence: 'ODbL-1.0',
    sources: [
      {
        citation: 'HydroSHEDS HydroRIVERS v1.0 (Asia)',
        licence: 'CC-BY-4.0',
        uri: 'https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_as_shp.zip',
        resolution: '15 arc-seconds',
      },
      { citation: 'OpenStreetMap waterways', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' },
    ],
  },
  stages: [
    {
      type: 'run',
      in: 'host',
      argv: ['run', 'ingest:rivers', '-w', '@webatlas/api'],
      produces: 'water.rivers (levels 1-3) + app.dataset_versions row',
      promoteTo: 'load-geojson',
      promoteBy: '2026-12-31',
    },
  ],
});
```

Replace the whole of `src/descriptors/index.ts` with:

```ts
import { demo } from './demo';
import { rivers } from './rivers';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo, rivers];
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npm test -w @webatlas/atlas-data -- src/schema.test.ts src/debt.test.ts src/registry.test.ts && npm run build -w @webatlas/atlas-data`
Expected: PASS, and tsc exits 0.

Then run the whole package: `npm test -w @webatlas/atlas-data`. Expected: all pass. `runner.test.ts` does not construct `run` stages; if any other test does, convert its `command` to `in`/`argv` the same way.

- [ ] **Step 8: Mutation check**

Remove `.strict()` from the `run` schema. The test "rejects a leftover command string even beside a valid argv" must fail. Restore it by re-applying the edit; never use `git checkout --` on a file with uncommitted work.

- [ ] **Step 9: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): stage run nhận argv và nơi chạy; fetch-http chỉ ghi trong data/cache; hydrorivers đổi id thành rivers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One executor table; process steps record what ran (I4)

**Files:**
- Create: `packages/atlas-data/src/stages/index.ts`, `src/stages/index.test.ts`, `src/paths.ts`
- Modify: `src/stages/sql.ts`, `src/lineage.ts`, `src/runner.ts`
- Test: `src/lineage.test.ts`, `src/stages/sql.test.ts`, `src/runner.test.ts`

**Interfaces:**
- Consumes: the Task 1 stage types.
- Produces:
  - `interface StageContext { datasetId: string; forced: boolean; log: (line: string) => void }`
  - `interface StageResult { summary: string }`
  - `executeStage(pool: Pool, stage: Stage, ctx: StageContext): Promise<StageResult>`
  - `hasExecutor(type: Stage['type']): boolean`
  - Tasks 4–6 add their executors by editing the `EXECUTORS` literal in `stages/index.ts`.
  - `processStep(key: string, stage: Stage, inputHash: string, summary: string): { description: string; tool: string }`
  - `REPO_ROOT`, `PACKAGE_ROOT`, `DATA_CACHE` (absolute paths, as strings)
  - `runBuild(pool, datasets, options?: BuildOptions)` with `interface BuildOptions { universe?: Dataset[]; force?: string[]; log?: (line: string) => void }`. `universe` and `force` are wired up in Task 3; here they are only declared.

- [ ] **Step 1: Write the failing tests**

Append to `src/lineage.test.ts`:

```ts
import { processStep } from './lineage';

describe('processStep (I4: record what ran, not just that it ran)', () => {
  const hash = 'a3f9c2e1b7d4' + '0'.repeat(52);

  it('names the stage, the 12-char hash prefix, and the summary', () => {
    const { description, tool } = processStep('0:sql', { type: 'sql', statement: 'SELECT 1' }, hash, 'SELECT 1');
    expect(description).toBe('stage 0:sql · a3f9c2e1b7d4 · SELECT 1');
    expect(tool).toBe('sql');
  });

  it('collapses whitespace in the summary', () => {
    const { description } = processStep('0:sql', { type: 'sql', statement: 'x' }, hash, 'INSERT  INTO\n   t\tVALUES (1)');
    expect(description).toBe('stage 0:sql · a3f9c2e1b7d4 · INSERT INTO t VALUES (1)');
  });

  it('caps the description at 200 characters, ending with …', () => {
    const { description } = processStep('0:sql', { type: 'sql', statement: 'x' }, hash, 'y'.repeat(500));
    expect(description).toHaveLength(200);
    expect(description.endsWith('…')).toBe(true);
  });

  it('uses the joined argv as the tool for a run stage', () => {
    const stage = {
      type: 'run' as const, in: 'host' as const, argv: ['run', 'ingest:rivers', '-w', '@webatlas/api'],
      produces: 'p', promoteTo: 'load-geojson', promoteBy: '2099-01-01',
    };
    expect(processStep('0:run', stage, hash, 'run ingest:rivers -w @webatlas/api').tool).toBe(
      'run ingest:rivers -w @webatlas/api'
    );
  });
});
```

Create `src/stages/index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { executeStage, hasExecutor } from './index';

const ctx = { datasetId: 'd', forced: false, log: () => {} };

describe('executor table', () => {
  it('has an executor for sql', () => {
    expect(hasExecutor('sql')).toBe(true);
  });

  it('reports a stage type with no executor by name', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(
      executeStage(pool, { type: 'load-geojson', file: 'f', table: 't', columns: () => ({}) }, ctx)
    ).rejects.toThrow(/"load-geojson" has no executor/);
  });

  it('returns the sql statement as the summary', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    await expect(executeStage(pool, { type: 'sql', statement: 'SELECT 1' }, ctx)).resolves.toEqual({
      summary: 'SELECT 1',
    });
  });
});
```

In `src/runner.test.ts`, add this test inside `describe('runBuild', …)`:

```ts
  it('records the executed statement in the process step, not just "completed" (I4)', async () => {
    const stepRows: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INTO app.dataset_lineage_step')) stepRows.push(params![1] as string);
      return { rows: [] };
    });
    const pool = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as Pool;
    await runBuild(pool, [ds('a', 'SELECT 42')]);
    expect(stepRows).toHaveLength(1);
    expect(stepRows[0]).toMatch(/^stage 0:sql · [0-9a-f]{12} · SELECT 42$/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/lineage.test.ts src/stages/index.test.ts src/runner.test.ts`
Expected: FAIL. `processStep` and `./index` do not exist, and the step reads `stage 0:sql completed`.

- [ ] **Step 3: Add `paths.ts`**

Create `src/paths.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The only module that knows the directory layout. Resolved from this file's own URL, so it
 * is right whether the code runs from src/ (tsx, vitest) or dist/ (tsc output): both sit one
 * level below the package root.
 */
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Downloads and intermediates. Git-ignored (spec §7). */
export const DATA_CACHE = join(PACKAGE_ROOT, 'data', 'cache');
```

- [ ] **Step 4: Add the executor table**

Create `src/stages/index.ts`:

```ts
import type { Pool } from 'pg';
import type { Stage } from '../types';
import { executeSql } from './sql';

/** What a stage needs to know besides its own configuration. */
export interface StageContext {
  datasetId: string;
  /** True when the dataset was named in --force: re-do work even if its output exists. */
  forced: boolean;
  /** Where progress lines go. The runner passes console.log; tests pass a collector. */
  log: (line: string) => void;
}

/** What a stage reports back: a one-line account of what it actually did (I4). */
export interface StageResult {
  summary: string;
}

type Executor<T extends Stage['type']> = (
  pool: Pool,
  stage: Extract<Stage, { type: T }>,
  ctx: StageContext
) => Promise<StageResult>;

/**
 * One executor per stage type. A type missing here cannot run, and validateRegistry rejects
 * any descriptor that uses one, so the failure happens at load time rather than halfway
 * through a build (spec §8).
 */
const EXECUTORS: { [K in Stage['type']]?: Executor<K> } = {
  sql: executeSql,
};

export function hasExecutor(type: Stage['type']): boolean {
  return EXECUTORS[type] !== undefined;
}

export async function executeStage(pool: Pool, stage: Stage, ctx: StageContext): Promise<StageResult> {
  const exec = EXECUTORS[stage.type] as
    | ((pool: Pool, stage: Stage, ctx: StageContext) => Promise<StageResult>)
    | undefined;
  if (!exec) throw new Error(`Stage type "${stage.type}" has no executor`);
  return exec(pool, stage, ctx);
}
```

Replace the function in `src/stages/sql.ts` (keep its doc comment) with:

```ts
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';

export async function executeSql(
  pool: Pool,
  stage: Extract<Stage, { type: 'sql' }>,
  _ctx: StageContext
): Promise<StageResult> {
  await pool.query(stage.statement);
  return { summary: stage.statement };
}
```

Check `src/stages/sql.test.ts` and `src/stages/sql.db.test.ts`. Where they call `executeSql(pool, stage)`, pass a third argument `{ datasetId: 't', forced: false, log: () => {} }`. Where they assert a `void` return, assert `{ summary: <statement> }` instead.

- [ ] **Step 5: Add `processStep`**

Append to `src/lineage.ts`:

```ts
import type { Stage } from './types';

const STEP_CAP = 200;

/**
 * The ISO 19115 process step for one executed stage (I4): which stage, the first 12 characters
 * of the input hash that ties it to the exact descriptor configuration, and what it did.
 * Rows are append-only and ON DELETE RESTRICT, so this has to be right the first time.
 */
export function processStep(
  key: string,
  stage: Stage,
  inputHash: string,
  summary: string
): { description: string; tool: string } {
  const collapsed = summary.replace(/\s+/g, ' ').trim();
  let description = `stage ${key} · ${inputHash.slice(0, 12)} · ${collapsed}`;
  if (description.length > STEP_CAP) description = `${description.slice(0, STEP_CAP - 1)}…`;
  const tool = stage.type === 'run' ? stage.argv.join(' ') : stage.type;
  return { description, tool };
}
```

Merge the `Stage` import into the existing `import type { Dataset } from './types';` line, as `import type { Dataset, Stage } from './types';`.

- [ ] **Step 6: Use them in the runner**

In `src/runner.ts`:
- replace the import `import { executeSql } from './stages/sql';` with `import { executeStage } from './stages/index';`;
- replace `import { upsertLineage, appendProcessStep } from './lineage';` with `import { upsertLineage, appendProcessStep, processStep } from './lineage';`;
- change `import type { Dataset, Stage } from './types';` to `import type { Dataset } from './types';`;
- delete the local `executeStage` function at the bottom of the file.

Add above `runBuild`:

```ts
export interface BuildOptions {
  /** Datasets whose state a stage's execution may invalidate. Defaults to `datasets` (Task 3). */
  universe?: Dataset[];
  /** Dataset ids whose every stage executes regardless of the skip rule (Task 3). */
  force?: string[];
  /** Where stage output goes. Defaults to console.log. */
  log?: (line: string) => void;
}
```

Change the signature to `export async function runBuild(pool: Pool, datasets: Dataset[], options: BuildOptions = {}): Promise<BuildReport>`, and add as the first line of its body:

```ts
  const log = options.log ?? ((line: string) => console.log(line));
```

Replace the stage-execution block (`try { await executeStage(pool, stage); stageExecuted = true; } catch …`) and the lines after it up to `report.executed.push(current);` with:

```ts
        let summary = '';
        try {
          ({ summary } = await executeStage(pool, stage, { datasetId: d.id, forced: false, log }));
          stageExecuted = true;
        } catch (err) {
          report.failed.push(current);
          report.errors[current] = errorMessage(err);
          broken.add(d.id);
          failedAt = i;
          try {
            await writeStageState(pool, d.id, key, hash, 'failed');
          } catch {
            // Best-effort: a failure here must not hide the execution error above.
          }
          break;
        }

        // Recorded before the state write: lineage is written from what actually ran,
        // so it cannot drift (spec §3). If the state write below then fails, the stage
        // reruns and appends a second, accurate step — over-recording a re-execution,
        // never under-recording one. The description names what ran (I4).
        const step = processStep(key, stage, hash, summary);
        await appendProcessStep(pool, d.id, step.description, step.tool);
        await writeStageState(pool, d.id, key, hash, 'ok');
        report.executed.push(current);
```

Update the doc comment above `runBuild`: stages are now dispatched through `stages/index.ts`, and each returns a summary that becomes the process step.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS, and tsc exits 0. If a `runner.test.ts` case asserted the old `Stage type "…" is not implemented yet` text, change it to `/has no executor/`.

- [ ] **Step 8: Mutation check**

In `processStep`, replace `collapsed` with `summary` in the description template. "collapses whitespace" must fail. Restore it.

- [ ] **Step 9: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): bảng executor chung; bước quy trình ghi đúng lệnh đã chạy (I4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Invalidate downstream before running (I3), and `--force`

**Files:**
- Modify: `packages/atlas-data/src/graph.ts`, `src/state.ts`, `src/runner.ts`, `src/cli/args.ts`, `src/cli/select.ts`, `src/cli/build.ts`
- Test: `src/graph.test.ts`, `src/runner.test.ts`, `src/cli/args.test.ts`, `src/cli/select.test.ts`, `src/state.db.test.ts`

**Interfaces:**
- Consumes: `executeStage`, `StageContext` (Task 2), `BuildOptions` (Task 2).
- Produces:
  - `transitiveDependents(datasets: Dataset[], id: string): string[]`, sorted;
  - `invalidateStageState(pool, datasetId: string, laterStages: string[], dependentIds: string[]): Promise<void>`;
  - `parseBuildArgs(argv)` → `{ only: string[]; except: string[]; force: string[] }`;
  - `assertForceSelected(force: string[], all: Dataset[], selected: Dataset[]): void`;
  - `runBuild` honouring `options.universe` and `options.force`.

- [ ] **Step 1: Write the failing tests**

Append to `src/graph.test.ts`:

```ts
import { transitiveDependents } from './graph';

describe('transitiveDependents', () => {
  const g = (id: string, dependsOn?: string[]) => ({
    id, kind: 'derived' as const, dependsOn,
    lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
    stages: [{ type: 'sql' as const, statement: 'SELECT 1' }],
  });
  const graph = [g('dem'), g('contours', ['dem']), g('hillshade', ['contours']), g('basemap')];

  it('follows chains of any depth', () => {
    expect(transitiveDependents(graph, 'dem')).toEqual(['contours', 'hillshade']);
  });

  it('is empty for a leaf and never includes the dataset itself', () => {
    expect(transitiveDependents(graph, 'hillshade')).toEqual([]);
    expect(transitiveDependents(graph, 'basemap')).toEqual([]);
  });
});
```

In `src/runner.test.ts`, replace the `memoryPool()` helper with this version. It understands the invalidation `DELETE` and exposes `state`:

```ts
function memoryPool(opts: { failDelete?: boolean; failStatement?: string } = {}) {
  const state = new Map<string, { input_hash: string; status: string }>();
  const steps: string[] = [];
  const executed: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    // Must precede the read branch below: the DELETE also contains "FROM app.dataset_stage_state".
    if (sql.startsWith('DELETE FROM app.dataset_stage_state')) {
      if (opts.failDelete) throw new Error('invalidation failed');
      const [id, later, deps] = params as [string, string[], string[]];
      for (const k of [...state.keys()]) {
        const [ds, st] = k.split('|');
        if ((ds === id && later.includes(st)) || deps.includes(ds)) state.delete(k);
      }
      return { rows: [] };
    }
    if (sql.includes('FROM app.dataset_stage_state')) {
      const row = state.get(`${params![0]}|${params![1]}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params![0]}|${params![1]}`, {
        input_hash: params![2] as string,
        status: params![3] as string,
      });
      return { rows: [] };
    }
    if (sql.includes('INTO app.dataset_lineage_step')) {
      steps.push(params![0] as string);
      return { rows: [] };
    }
    if (opts.failStatement && sql === opts.failStatement) throw new Error('boom');
    if (sql.startsWith('SELECT') || sql.startsWith('REFRESH')) executed.push(sql);
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  return { pool: { query, connect } as unknown as Pool, steps, executed, state };
}
```

Then add, inside `describe('runBuild', …)`:

```ts
  describe('cascade (I3) — shaped like dem → contours', () => {
    const twoStage = (id: string, a: string, b: string, dependsOn?: string[]): Dataset => ({
      ...ds(id, a, dependsOn),
      stages: [{ type: 'sql', statement: a }, { type: 'sql', statement: b }],
    });
    const dem = () => twoStage('dem', 'SELECT 1', 'SELECT 2');
    const contours = () => ds('contours', 'SELECT 3', ['dem']);

    it('forcing the upstream re-runs its later stages and its dependent', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const second = await runBuild(ctx.pool, [dem(), contours()], { force: ['dem'] });
      expect(second.executed).toEqual(['dem/0:sql', 'dem/1:sql', 'contours/0:sql']);
    });

    it('invalidates a dependent that is excluded from this build, via the universe', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      await runBuild(ctx.pool, [dem()], { force: ['dem'], universe: [dem(), contours()] });
      expect(ctx.state.has('contours|0:sql')).toBe(false);
      expect(ctx.state.get('dem|1:sql')?.status).toBe('ok');
    });

    it('a skip invalidates nothing', async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const second = await runBuild(ctx.pool, [dem(), contours()]);
      expect(second.executed).toEqual([]);
      expect(ctx.state.get('contours|0:sql')?.status).toBe('ok');
    });

    it("leaves the dependent's state gone when a forced upstream fails mid-way", async () => {
      await runBuild(ctx.pool, [dem(), contours()]);
      const failing = memoryPool({ failStatement: 'SELECT 2' });
      // Seed the failing pool with the successful state first.
      for (const [k, v] of ctx.state) failing.state.set(k, v);
      const report = await runBuild(failing.pool, [dem(), contours()], { force: ['dem'] });
      expect(report.failed).toEqual(['dem/1:sql']);
      expect(report.blocked).toContain('contours/0:sql');
      expect(failing.state.has('contours|0:sql')).toBe(false);
    });

    it('does not execute a stage whose invalidation failed', async () => {
      const failing = memoryPool({ failDelete: true });
      const report = await runBuild(failing.pool, [ds('a', 'SELECT 7')]);
      expect(failing.executed).toEqual([]);
      expect(report.failed).toEqual(['a/0:sql']);
      expect(report.errors['a/0:sql']).toMatch(/invalidation failed/);
    });
  });
```

In `src/cli/args.test.ts`, add `force: []` to **every** existing `toEqual({ only: …, except: … })` expectation. The return value gains the key; nothing else about those tests changes. Then append:

```ts
describe('--force', () => {
  it('parses the space and = forms', () => {
    expect(parseBuildArgs(['--force', 'dem,contours']).force).toEqual(['dem', 'contours']);
    expect(parseBuildArgs(['--force=dem']).force).toEqual(['dem']);
  });

  it('fails closed on a missing value, an empty id, or a repeat', () => {
    expect(() => parseBuildArgs(['--force'])).toThrow(/--force requires a value/);
    expect(() => parseBuildArgs(['--force', 'dem,,x'])).toThrow(/empty dataset id/);
    expect(() => parseBuildArgs(['--force', 'a', '--force', 'b'])).toThrow(/more than once/);
  });
});
```

Append to `src/cli/select.test.ts`:

```ts
import { assertForceSelected } from './select';

describe('assertForceSelected', () => {
  it('accepts forced ids inside the selection', () => {
    const { selected } = selectDatasets(graph, { only: [], except: [] });
    expect(() => assertForceSelected(['dem'], graph, selected)).not.toThrow();
  });

  it('rejects an unknown id', () => {
    expect(() => assertForceSelected(['nope'], graph, graph)).toThrow(/unknown dataset "nope"/);
  });

  it('rejects forcing a dataset that --except removed (a contradiction, not a no-op)', () => {
    const { selected } = selectDatasets(graph, { only: [], except: ['dem'] });
    expect(() => assertForceSelected(['dem'], graph, selected)).toThrow(/not in the selected set/);
  });
});
```

Append to `src/state.db.test.ts`, inside its `describe.skipIf(!DB)(…)` block. It reuses that file's `insertLineage` and `cleanup` helpers:

```ts
  it('invalidateStageState deletes later stages and every stage of the dependents, nothing else', async () => {
    const up = '__atlasdata_test__inv-up';
    const down = '__atlasdata_test__inv-down';
    const other = '__atlasdata_test__inv-other';
    for (const id of [up, down, other]) await insertLineage(id);
    try {
      for (const [id, st] of [[up, '0:sql'], [up, '1:sql'], [down, '0:sql'], [other, '0:sql']]) {
        await writeStageState(pool, id, st, 'h', 'ok');
      }
      await invalidateStageState(pool, up, ['1:sql'], [down]);
      expect(await readStageState(pool, up, '0:sql')).not.toBeNull();
      expect(await readStageState(pool, up, '1:sql')).toBeNull();
      expect(await readStageState(pool, down, '0:sql')).toBeNull();
      expect(await readStageState(pool, other, '0:sql')).not.toBeNull();
    } finally {
      await pool.query(`DELETE FROM app.dataset_stage_state WHERE dataset_id = ANY($1)`, [[up, down, other]]);
      for (const id of [up, down, other]) await cleanup(id);
    }
  });
```

Add `invalidateStageState` to that file's import from `./state`.

- [ ] **Step 2: Run them to verify they fail**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data`
Expected: FAIL. `transitiveDependents`, `invalidateStageState`, `assertForceSelected` and `--force` do not exist, and forced datasets are skipped. Confirm that the `state.db.test.ts` suite **ran** (it is listed with tests, not as skipped).

- [ ] **Step 3: `transitiveDependents`**

Append to `src/graph.ts`:

```ts
/**
 * Every dataset that depends on `id`, directly or through a chain, sorted. Never includes `id`
 * itself. The runner invalidates these before executing any stage of `id` (I3).
 */
export function transitiveDependents(datasets: Dataset[], id: string): string[] {
  const found = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of datasets) {
      if (d.id === id || found.has(d.id)) continue;
      if ((d.dependsOn ?? []).some((dep) => dep === id || found.has(dep))) {
        found.add(d.id);
        changed = true;
      }
    }
  }
  return [...found].sort();
}
```

- [ ] **Step 4: `invalidateStageState`**

Append to `src/state.ts`:

```ts
/**
 * I3: forget the state of a dataset's later stages and of every stage of its transitive
 * dependents, in one statement, BEFORE a stage executes. Written first so a crash at any point
 * can only leave downstream stages missing, never falsely ok.
 *
 * The SQL deliberately begins with "DELETE FROM app.dataset_stage_state": runner.test.ts's
 * in-memory pool dispatches on that prefix.
 */
export async function invalidateStageState(
  pool: Pool,
  datasetId: string,
  laterStages: string[],
  dependentIds: string[]
): Promise<void> {
  await pool.query(
    `DELETE FROM app.dataset_stage_state
      WHERE (dataset_id = $1 AND stage = ANY($2::text[]))
         OR dataset_id = ANY($3::text[])`,
    [datasetId, laterStages, dependentIds]
  );
}
```

- [ ] **Step 5: The runner**

In `src/runner.ts`:
- change the imports to `import { topologicalOrder, transitiveDependents } from './graph';` and add `invalidateStageState` to the import from `./state`;
- after the `log` line at the top of `runBuild`, add:

```ts
  // The universe is the whole registry, not the selected set (spec §8): a dependent excluded
  // by --except is still invalidated, so atlas:status reports it missing until built.
  const universe = options.universe ?? datasets;
  const force = new Set(options.force ?? []);
```

- inside the per-dataset loop, just after `const hashes = plan.get(d.id)!;`, add:

```ts
    const forced = force.has(d.id);
    const dependents = transitiveDependents(universe, d.id);
```

- replace the skip test `if (prior?.status === 'ok' && prior.input_hash === hash) {` with:

```ts
        if (!forced && prior?.status === 'ok' && prior.input_hash === hash) {
```

- replace the execution line inside the stage `try` with:

```ts
          // I3: invalidate downstream BEFORE executing. If this throws, the stage never runs:
          // an upstream must not execute while its dependents still look current.
          const later = d.stages.slice(i + 1).map((s, j) => stageKey(i + 1 + j, s));
          await invalidateStageState(pool, d.id, later, dependents);
          ({ summary } = await executeStage(pool, stage, { datasetId: d.id, forced, log }));
          stageExecuted = true;
```

Update `runBuild`'s doc comment with one paragraph each on invalidation-before-execute and on `force`.

- [ ] **Step 6: `--force` parsing and selection**

In `src/cli/args.ts`:
- change `export interface BuildArgs { only: string[]; except: string[]; }` to add `force: string[];`;
- change `const FLAGS = ['--only', '--except'] as const;` to `const FLAGS = ['--only', '--except', '--force'] as const;`;
- change the return value to:

```ts
  return {
    only: values['--only'] !== undefined ? splitIds('--only', values['--only']) : [],
    except: values['--except'] !== undefined ? splitIds('--except', values['--except']) : [],
    force: values['--force'] !== undefined ? splitIds('--force', values['--force']) : [],
  };
```

Append to `src/cli/select.ts`:

```ts
/**
 * --force must name datasets that are both registered and selected. Forcing a dataset that
 * --only/--except removed is a contradiction, reported as a usage error rather than
 * silently doing nothing.
 */
export function assertForceSelected(force: string[], all: Dataset[], selected: Dataset[]): void {
  const known = new Set(all.map((d) => d.id));
  const chosen = new Set(selected.map((d) => d.id));
  for (const id of force) {
    if (!known.has(id)) throw new Error(`atlas:build: --force names unknown dataset "${id}"`);
    if (!chosen.has(id)) {
      throw new Error(`atlas:build: --force ${id} is not in the selected set (removed by --only/--except)`);
    }
  }
}
```

In `src/cli/build.ts`:
- import `assertForceSelected` alongside `selectDatasets`;
- add `let force: string[] = [];` next to `let excluded…`;
- in the `try`, change the destructuring to `const { only, except, force: forced } = parseBuildArgs(process.argv.slice(2));` and add, after the empty-selection check, `assertForceSelected(forced, ALL_DATASETS, datasets); force = forced;`;
- change the build call to:

```ts
    const report = await runBuild(pool, datasets, { universe: ALL_DATASETS, force });
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS. The `state.db.test.ts` suite shows as run.

- [ ] **Step 8: Mutation checks**

1. Comment out the `await invalidateStageState(...)` line. "forcing the upstream re-runs … its dependent" and "leaves the dependent's state gone" must fail. Restore it.
2. Change `options.universe ?? datasets` to `datasets`. "invalidates a dependent that is excluded … via the universe" must fail. Restore it.

- [ ] **Step 9: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): vô hiệu trạng thái hạ nguồn trước khi chạy stage (I3); thêm --force

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `run` executor

**Files:**
- Create: `packages/atlas-data/src/process.ts`, `src/process.test.ts`, `src/stages/run.ts`, `src/stages/run.test.ts`
- Modify: `src/stages/index.ts`

**Interfaces:**
- Consumes: `StageContext`, `StageResult` (Task 2); `REPO_ROOT` (Task 2); the `run` stage type (Task 1).
- Produces:
  - `runProcess(file: string, args: string[], opts: { label: string; log: (line: string) => void; cwd?: string; env?: NodeJS.ProcessEnv; heartbeatMs?: number; tailLines?: number }): Promise<{ code: number | null; signal: NodeJS.Signals | null; tail: string[] }>`
  - `npmCli(env?: NodeJS.ProcessEnv, execPath?: string): string`
  - `commandFor(stage: RunStage, repoRoot?: string): { file: string; args: string[]; cwd: string }`
  - `executeRun(pool, stage, ctx, resolve?: typeof commandFor): Promise<StageResult>`

- [ ] **Step 1: Write the failing tests**

Create `src/process.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runProcess } from './process';

const node = process.execPath;

function collector() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

describe('runProcess', () => {
  it('streams each output line with the label prefix and reports the exit code', async () => {
    const c = collector();
    const out = await runProcess(node, ['-e', 'console.log("a"); console.error("b"); process.exit(3)'], {
      label: 'rivers', log: c.log,
    });
    expect(out.code).toBe(3);
    expect(c.lines).toEqual(expect.arrayContaining(['[rivers] a', '[rivers] b']));
  });

  it('keeps only the last N lines as the tail', async () => {
    const out = await runProcess(node, ['-e', 'for (let i = 1; i <= 30; i++) console.log("l" + i)'], {
      label: 't', log: () => {}, tailLines: 20,
    });
    expect(out.tail).toHaveLength(20);
    expect(out.tail[0]).toBe('l11');
    expect(out.tail[19]).toBe('l30');
  });

  it('passes arguments literally — no shell ever re-parses them (NFR-2)', async () => {
    const c = collector();
    await runProcess(node, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a;b', '&&', '$(x)'], {
      label: 't', log: c.log,
    });
    expect(c.lines).toContain('[t] ["a;b","&&","$(x)"]');
  });

  it('prints a heartbeat while the process is silent', async () => {
    const c = collector();
    await runProcess(node, ['-e', 'setTimeout(() => {}, 400)'], { label: 'dem', log: c.log, heartbeatMs: 100 });
    expect(c.lines.some((l) => /^\[dem\] … still running \(\d+ s\)$/.test(l))).toBe(true);
  });

  it('rejects when the executable cannot be started', async () => {
    await expect(runProcess('definitely-not-a-real-binary-xyz', [], { label: 't', log: () => {} })).rejects.toThrow();
  });
});
```

Create `src/stages/run.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { commandFor, executeRun, npmCli } from './run';
import type { Stage } from '../types';

type RunStage = Extract<Stage, { type: 'run' }>;
const stage = (over: Partial<RunStage>): RunStage => ({
  type: 'run', in: 'host', argv: ['--version'], produces: 'p', promoteTo: 'x', promoteBy: '2099-01-01', ...over,
});
const pool = {} as Pool;

describe('npmCli', () => {
  it("prefers npm_execpath when it is npm's own CLI script", () => {
    expect(npmCli({ npm_execpath: '/x/npm/bin/npm-cli.js' }, '/usr/bin/node')).toBe('/x/npm/bin/npm-cli.js');
  });

  it('otherwise finds npm-cli.js beside the running node', () => {
    const found = npmCli({}, process.execPath);
    expect(found.endsWith('npm-cli.js')).toBe(true);
  });

  it('throws a clear error when neither exists', () => {
    expect(() => npmCli({}, '/nowhere/node')).toThrow(/cannot locate npm-cli\.js/);
  });
});

describe('commandFor', () => {
  it('host: node + npm-cli.js + argv, from the repo root, never a shell', () => {
    const c = commandFor(stage({ argv: ['run', 'ingest:rivers', '-w', '@webatlas/api'] }), '/repo');
    expect(c.file).toBe(process.execPath);
    expect(c.args[0].endsWith('npm-cli.js')).toBe(true);
    expect(c.args.slice(1)).toEqual(['run', 'ingest:rivers', '-w', '@webatlas/api']);
    expect(c.cwd).toBe('/repo');
  });

  it('tools: docker compose run in the tools profile, on the repo compose file', () => {
    const c = commandFor(stage({ in: 'tools', argv: ['python', 'prep_dem.py', '--mainland'] }), '/repo');
    expect(c.file).toBe('docker');
    expect(c.args).toEqual([
      'compose', '-f', join('/repo', 'infra', 'docker-compose.yml'), '--profile', 'tools',
      'run', '--rm', 'tools', 'python', 'prep_dem.py', '--mainland',
    ]);
  });
});

describe('executeRun', () => {
  const ctx = (lines: string[]) => ({ datasetId: 'rivers', forced: false, log: (l: string) => lines.push(l) });
  const viaNode = (script: string) => () => ({ file: process.execPath, args: ['-e', script], cwd: process.cwd() });

  it('succeeds on exit 0 and summarises the argv', async () => {
    const lines: string[] = [];
    await expect(executeRun(pool, stage({ argv: ['a', 'b'] }), ctx(lines), viaNode('console.log("ok")'))).resolves.toEqual({
      summary: 'a b',
    });
    expect(lines).toContain('[rivers] ok');
  });

  it('fails with the tail and the command that re-runs just this dataset', async () => {
    const run = executeRun(pool, stage({}), ctx([]), viaNode('console.log("last words"); process.exit(2)'));
    await expect(run).rejects.toThrow(/exit 2/);
    await expect(run).rejects.toThrow(/\| last words/);
    await expect(run).rejects.toThrow(/npm run atlas:build -- --only rivers --force rivers/);
  });

  it('really runs npm on the host (argv --version)', async () => {
    const lines: string[] = [];
    await executeRun(pool, stage({ argv: ['--version'] }), ctx(lines));
    expect(lines.some((l) => /^\[rivers\] \d+\.\d+\.\d+$/.test(l))).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/process.test.ts src/stages/run.test.ts`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: `runProcess`**

Create `src/process.ts`:

```ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface RunProcessOptions {
  /** Prefix for every line, usually the dataset id: `[label] …`. */
  label: string;
  log: (line: string) => void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Silence longer than this prints `[label] … still running (N s)`. Default 30 s (NFR-4). */
  heartbeatMs?: number;
  /** How many trailing lines to keep for the failure message. Default 20 (U-3). */
  tailLines?: number;
}

export interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  tail: string[];
}

/**
 * Start `file` with `args` and NO shell (NFR-2): arguments reach the process exactly as given,
 * so nothing in an argv can be re-parsed as `;`, `&&` or a substitution. Resolves with the exit
 * code whatever it is — deciding what a non-zero exit means is the caller's job. Rejects only
 * when the process cannot be started at all.
 */
export function runProcess(file: string, args: string[], opts: RunProcessOptions): Promise<ProcessOutcome> {
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const tailMax = opts.tailLines ?? 20;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tail: string[] = [];
    const child = spawn(file, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let timer: NodeJS.Timeout;
    const beat = (): void => {
      opts.log(`[${opts.label}] … still running (${Math.round((Date.now() - started) / 1000)} s)`);
      timer = setTimeout(beat, heartbeatMs);
    };
    timer = setTimeout(beat, heartbeatMs);

    const onLine = (line: string): void => {
      tail.push(line);
      if (tail.length > tailMax) tail.shift();
      opts.log(`[${opts.label}] ${line}`);
      clearTimeout(timer);
      timer = setTimeout(beat, heartbeatMs);
    };
    createInterface({ input: child.stdout! }).on('line', onLine);
    createInterface({ input: child.stderr! }).on('line', onLine);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, tail });
    });
  });
}
```

- [ ] **Step 4: `executeRun`**

Create `src/stages/run.ts`:

```ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { runProcess } from '../process';
import { REPO_ROOT } from '../paths';

type RunStage = Extract<Stage, { type: 'run' }>;

/**
 * npm's own CLI script, so host stages can run `node npm-cli.js …` with no shell.
 * `spawn('npm', …, { shell: false })` fails with ENOENT on Windows, where npm is a .cmd shim
 * (measured 2026-09-30). npm sets npm_execpath for every script it runs; outside npm, the
 * script sits beside node (Windows) or in ../lib (Unix).
 */
export function npmCli(env: NodeJS.ProcessEnv = process.env, execPath: string = process.execPath): string {
  const fromNpm = env.npm_execpath;
  if (fromNpm && /npm-cli\.js$/.test(fromNpm)) return fromNpm;
  const dir = dirname(execPath);
  const candidates = [
    join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`cannot locate npm-cli.js beside ${execPath}; run atlas commands through npm (npm run atlas:build)`);
  }
  return found;
}

/** The process a run stage starts (spec §7). Pure apart from npmCli's file check. */
export function commandFor(stage: RunStage, repoRoot: string = REPO_ROOT): { file: string; args: string[]; cwd: string } {
  if (stage.in === 'host') {
    return { file: process.execPath, args: [npmCli(), ...stage.argv], cwd: repoRoot };
  }
  return {
    file: 'docker',
    args: [
      'compose', '-f', join(repoRoot, 'infra', 'docker-compose.yml'), '--profile', 'tools',
      'run', '--rm', 'tools', ...stage.argv,
    ],
    cwd: repoRoot,
  };
}

/**
 * Execute a run stage. A non-zero exit fails it with the last lines of output and the command
 * that re-runs this dataset alone (U-3). `resolve` is injectable so tests can substitute a
 * `node -e` process for npm or docker.
 */
export async function executeRun(
  _pool: Pool,
  stage: RunStage,
  ctx: StageContext,
  resolve: typeof commandFor = commandFor
): Promise<StageResult> {
  const { file, args, cwd } = resolve(stage);
  const outcome = await runProcess(file, args, { label: ctx.datasetId, log: ctx.log, cwd });
  if (outcome.code !== 0) {
    const why = outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.code}`;
    throw new Error(
      [
        `${stage.in} command failed (${why}): ${stage.argv.join(' ')}`,
        ...outcome.tail.map((l) => `  | ${l}`),
        `re-run: npm run atlas:build -- --only ${ctx.datasetId} --force ${ctx.datasetId}`,
      ].join('\n')
    );
  }
  return { summary: stage.argv.join(' ') };
}
```

In `src/stages/index.ts`, import `executeRun` from `./run` and add `run: executeRun,` to `EXECUTORS`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS. `src/stages/index.test.ts`'s `hasExecutor` still holds, and `run` now has one.

- [ ] **Step 6: Mutation checks**

1. In `runProcess`, change `if (tail.length > tailMax) tail.shift();` to `if (tail.length > tailMax + 5) tail.shift();`. "keeps only the last N lines" must fail. Restore it.
2. In `executeRun`, drop the `re-run:` line. "fails with the tail and the command…" must fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): executor run — không qua shell, npm qua npm-cli.js, in dòng có tiền tố, nhịp chờ, đuôi lỗi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `fetch-http` executor

**Files:**
- Create: `packages/atlas-data/src/stages/fetchHttp.ts`, `src/stages/fetchHttp.test.ts`
- Modify: `src/stages/index.ts`, `.gitignore` (repo root)

**Interfaces:**
- Consumes: `StageContext`, `StageResult`, `DATA_CACHE` (Task 2).
- Produces: `executeFetchHttp(pool, stage, ctx, cacheDir?: string): Promise<StageResult>`. The summary is `<url> sha256:<64 hex>`.

- [ ] **Step 1: Write the failing tests**

Create `src/stages/fetchHttp.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { executeFetchHttp } from './fetchHttp';

const BODY = Buffer.from('x'.repeat(100_000));
const SHA = createHash('sha256').update(BODY).digest('hex');
const pool = {} as Pool;
const ctx = (forced = false) => ({ datasetId: 'basemap', forced, log: () => {} });

let server: Server;
let base: string;
let cache: string;
let hits: number;
let mode: 'ok' | 'cut' | 'missing';

beforeEach(async () => {
  hits = 0;
  mode = 'ok';
  cache = await mkdtemp(join(tmpdir(), 'atlas-fetch-'));
  server = createServer((req, res) => {
    hits++;
    if (mode === 'missing') { res.writeHead(404).end('no'); return; }
    res.writeHead(200, { 'Content-Length': String(BODY.length) });
    if (mode === 'cut') {
      res.write(BODY.subarray(0, 1000));
      setTimeout(() => req.socket.destroy(), 20); // die mid-body
      return;
    }
    res.end(BODY);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // So the "interrupted" test's readdir has a directory to read even if the executor failed early.
  await mkdir(join(cache, 'basemap'), { recursive: true });
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(cache, { recursive: true, force: true });
});

const stage = (over: Record<string, unknown> = {}) =>
  ({ type: 'fetch-http' as const, url: `${base}/a.zip`, into: 'basemap/a.zip', ...over });

describe('fetch-http', () => {
  it('downloads into the cache and records the content hash', async () => {
    const r = await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(r.summary).toBe(`${base}/a.zip sha256:${SHA}`);
    expect(await readFile(join(cache, 'basemap/a.zip'))).toEqual(BODY);
  });

  it('an interrupted download leaves neither the target nor a .part file', async () => {
    mode = 'cut';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache)).rejects.toThrow();
    expect(existsSync(join(cache, 'basemap/a.zip'))).toBe(false);
    expect(await readdir(join(cache, 'basemap'))).toEqual([]);
  });

  it('a sha256 mismatch fails before the rename and keeps the previous file', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    await writeFile(join(cache, 'basemap/a.zip'), 'previous');
    const pinned = stage({ sha256: 'f'.repeat(64) });
    await expect(executeFetchHttp(pool, pinned, ctx(true), cache)).rejects.toThrow(/sha256 mismatch/);
    expect(await readFile(join(cache, 'basemap/a.zip'), 'utf8')).toBe('previous');
  });

  it('an existing file is reused without a request, unless forced', async () => {
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(), cache);
    expect(hits).toBe(1);
    await executeFetchHttp(pool, stage(), ctx(true), cache);
    expect(hits).toBe(2);
  });

  it('an existing file that fails its pin is re-downloaded', async () => {
    await writeFile(join(cache, 'stale.zip'), 'stale');
    await executeFetchHttp(pool, stage({ into: 'stale.zip', sha256: SHA }), ctx(), cache);
    expect(hits).toBe(1);
    expect(await readFile(join(cache, 'stale.zip'))).toEqual(BODY);
  });

  it('fails on a non-2xx response', async () => {
    mode = 'missing';
    await expect(executeFetchHttp(pool, stage(), ctx(), cache)).rejects.toThrow(/404/);
  });

  it('refuses a path that escapes the cache even if validation was bypassed', async () => {
    await expect(executeFetchHttp(pool, stage({ into: '../escape.zip' }), ctx(), cache)).rejects.toThrow(/escapes/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/stages/fetchHttp.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

Create `src/stages/fetchHttp.ts`:

```ts
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { DATA_CACHE } from '../paths';

type FetchStage = Extract<Stage, { type: 'fetch-http' }>;
const PROGRESS_EVERY = 64 * 1024 * 1024;

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Download `stage.url` into `<cache>/<stage.into>` (spec §8).
 * - Written to `<target>.part` and renamed on completion: an interrupted download can never be
 *   taken for a finished one, and the .part is removed on any failure.
 * - A declared sha256 is checked BEFORE the rename, so a mismatch leaves the previous file intact.
 * - An existing file is reused (no request) when it satisfies the pin, or when there is no pin,
 *   unless the dataset is forced. Refreshing an unpinned `latest` source therefore takes --force
 *   (spec C-10); the fetched hash is always recorded so machines' downloads are distinguishable.
 */
export async function executeFetchHttp(
  _pool: Pool,
  stage: FetchStage,
  ctx: StageContext,
  cacheDir: string = DATA_CACHE
): Promise<StageResult> {
  const root = resolve(cacheDir);
  const target = resolve(root, stage.into);
  if (!target.startsWith(root + sep)) throw new Error(`fetch-http: "${stage.into}" escapes data/cache`);
  await mkdir(dirname(target), { recursive: true });

  if (!ctx.forced && existsSync(target)) {
    const have = await sha256File(target);
    if (!stage.sha256 || have === stage.sha256) {
      ctx.log(`[${ctx.datasetId}] ${stage.into} already present (sha256 ${have.slice(0, 12)})`);
      return { summary: `${stage.url} sha256:${have}` };
    }
    ctx.log(`[${ctx.datasetId}] ${stage.into} does not match its pin; downloading again`);
  }

  const part = `${target}.part`;
  try {
    const res = await fetch(stage.url);
    if (!res.ok || !res.body) throw new Error(`fetch-http: GET ${stage.url} returned ${res.status}`);

    const hash = createHash('sha256');
    let bytes = 0;
    let nextReport = PROGRESS_EVERY;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        if (bytes >= nextReport) {
          ctx.log(`[${ctx.datasetId}] downloaded ${Math.round(bytes / 1024 / 1024)} MB`);
          nextReport += PROGRESS_EVERY;
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), meter, createWriteStream(part));

    const got = hash.digest('hex');
    if (stage.sha256 && got !== stage.sha256) {
      throw new Error(`fetch-http: sha256 mismatch for ${stage.url}: expected ${stage.sha256}, got ${got}`);
    }
    await rename(part, target);
    return { summary: `${stage.url} sha256:${got}` };
  } finally {
    await rm(part, { force: true });
  }
}
```

In `src/stages/index.ts`, import `executeFetchHttp` from `./fetchHttp` and add `'fetch-http': executeFetchHttp,` to `EXECUTORS`.

Add to the repo root `.gitignore`, under the `# Exclude data directory` block:

```
# Registry downloads and intermediates (spec §7)
packages/atlas-data/data/cache/
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS.

- [ ] **Step 5: Mutation checks**

1. Move the `sha256` check to after `await rename(part, target);`. "a sha256 mismatch … keeps the previous file" must fail. Restore it.
2. Delete the `finally { await rm(part, …) }` block. "an interrupted download leaves neither … nor a .part" must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-data/src .gitignore
git commit -m "feat(atlas-data): executor fetch-http — tải nguyên tử vào data/cache, kiểm sha256 trước khi đổi tên

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `publish-geoserver` executor

**Files:**
- Create: `packages/atlas-data/src/geoserver.ts`, `src/geoserver.test.ts`, `src/stages/publishGeoserver.ts`, `src/stages/publishGeoserver.live.test.ts`
- Modify: `src/stages/index.ts`

**Interfaces:**
- Consumes: `StageContext`, `StageResult` (Task 2); the `publish-geoserver` stage type (Task 1).
- Produces:
  - `interface GeoServerEnv { url: string; user: string; password: string; workspace: string; db: { host: string; port: string; name: string; user: string; password: string } }`
  - `geoserverEnv(env?: NodeJS.ProcessEnv): GeoServerEnv`. It throws when `GEOSERVER_URL` is unset.
  - `publishLayer(gs: GeoServerEnv, spec: { layer: string; nativeName?: string; style?: string }, fetchImpl?: typeof fetch): Promise<'created' | 'repointed' | 'unchanged'>`
  - `executePublishGeoserver(pool, stage, ctx, env?, fetchImpl?): Promise<StageResult>`. The summary is `<workspace>:<layer> → <nativeName> (<outcome>)`.

- [ ] **Step 1: Write the failing tests**

Create `src/geoserver.test.ts`, which drives the branch logic with a scripted `fetch`:

```ts
import { describe, it, expect } from 'vitest';
import { geoserverEnv, publishLayer } from './geoserver';

const gs = geoserverEnv({
  GEOSERVER_URL: 'http://gs/geoserver', GEOSERVER_ADMIN_USER: 'admin', GEOSERVER_ADMIN_PASSWORD: 'pw',
  GEOSERVER_WORKSPACE: 'webatlas', GEOSERVER_DB_PASSWORD: 'dbpw',
});

type Call = { method: string; path: string; body?: unknown };

/** A fetch that answers from a script keyed by "METHOD path" and records every call. */
function scripted(routes: Record<string, { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const path = url.replace('http://gs/geoserver/rest', '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = routes[`${method} ${path}`] ?? { status: 404 };
    return new Response(hit.json ? JSON.stringify(hit.json) : 'x', { status: hit.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const READY = {
  'GET /workspaces/webatlas': { status: 200 },
  'GET /workspaces/webatlas/datastores/webatlas_water': { status: 200 },
};
const FT = '/workspaces/webatlas/datastores/webatlas_water/featuretypes';

describe('geoserverEnv', () => {
  it('fails clearly without GEOSERVER_URL', () => {
    expect(() => geoserverEnv({})).toThrow(/GEOSERVER_URL is not set/);
  });
});

describe('publishLayer', () => {
  it('leaves a layer that already points at the right relation untouched', async () => {
    const f = scripted({ ...READY, [`GET ${FT}/rivers`]: { status: 200, json: { featureType: { nativeName: 'rivers_detail' } } } });
    expect(await publishLayer(gs, { layer: 'rivers', nativeName: 'rivers_detail' }, f.impl)).toBe('unchanged');
    expect(f.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('repoints with PUT (so styles survive) and resets the catalog', async () => {
    const f = scripted({
      ...READY,
      [`GET ${FT}/rivers`]: { status: 200, json: { featureType: { nativeName: 'rivers_active' } } },
      [`PUT ${FT}/rivers`]: { status: 200 },
      'POST /reset': { status: 200 },
    });
    expect(await publishLayer(gs, { layer: 'rivers', nativeName: 'rivers_detail' }, f.impl)).toBe('repointed');
    expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({ featureType: { name: 'rivers', nativeName: 'rivers_detail' } });
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', path: '/reset' });
  });

  it('creates a missing layer on the <layer>_active view by default', async () => {
    const f = scripted({ ...READY, [`POST ${FT}`]: { status: 201 } });
    expect(await publishLayer(gs, { layer: 'dams' }, f.impl)).toBe('created');
    expect(f.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ featureType: { name: 'dams', nativeName: 'dams_active' } });
  });

  it('creates the workspace and datastore when missing', async () => {
    const f = scripted({
      'POST /workspaces': { status: 201 },
      'POST /workspaces/webatlas/datastores': { status: 201 },
      [`POST ${FT}`]: { status: 201 },
    });
    await publishLayer(gs, { layer: 'dams' }, f.impl);
    expect(f.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/workspaces', '/workspaces/webatlas/datastores', FT,
    ]);
  });

  it('fails the stage on any non-2xx response, naming status and path', async () => {
    const f = scripted({ ...READY, [`POST ${FT}`]: { status: 500 } });
    await expect(publishLayer(gs, { layer: 'dams' }, f.impl)).rejects.toThrow(/500/);
  });

  it('assigns a default style when one is given', async () => {
    const f = scripted({
      ...READY,
      [`GET ${FT}/dams`]: { status: 200, json: { featureType: { nativeName: 'dams_active' } } },
      'PUT /layers/webatlas:dams': { status: 200 },
    });
    await publishLayer(gs, { layer: 'dams', style: 'dams_style' }, f.impl);
    expect(f.calls.find((c) => c.path === '/layers/webatlas:dams')?.body).toEqual({
      layer: { defaultStyle: { name: 'dams_style' } },
    });
  });
});
```

Create `src/stages/publishGeoserver.live.test.ts`, which runs against the real GeoServer:

```ts
import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { executePublishGeoserver } from './publishGeoserver';

const GS = process.env.GEOSERVER_URL;
const ctx = { datasetId: '__atlasdata_test__', forced: false, log: () => {} };

describe.skipIf(!GS)('publish-geoserver against the running GeoServer', () => {
  it('publishing an already-published layer is idempotent and the layer still serves WFS', async () => {
    const r = await executePublishGeoserver({} as Pool, { type: 'publish-geoserver', layer: 'dams' }, ctx);
    expect(r.summary).toMatch(/^webatlas:dams → dams_active \((unchanged|repointed)\)$/);
    const res = await fetch(
      `${GS}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:dams&outputFormat=application/json&count=1`
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { features: unknown[] }).features.length).toBe(1);
  });

  // If GeoServer ever accepts this (it should refuse a feature type with no backing relation),
  // the test fails. Delete the created featuretype by hand and report it: never loosen the assertion.
  it('fails when the backing relation does not exist', async () => {
    await expect(
      executePublishGeoserver(
        {} as Pool,
        { type: 'publish-geoserver', layer: '__atlasdata_test__missing', nativeName: '__atlasdata_test__no_such_view' },
        ctx
      )
    ).rejects.toThrow();
  }, 30_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data -- src/geoserver.test.ts src/stages/publishGeoserver.live.test.ts`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Port the GeoServer client**

Create `src/geoserver.ts`:

```ts
/**
 * GeoServer REST, ported from apps/api/src/geoserver/{client,publish}.ts (spec §8). A deliberate,
 * temporary duplicate: the API's publish script keeps working until Plan C removes it (NFR-7), and
 * a package must not import an app. Unlike the original, every call takes its environment and fetch
 * explicitly, so it is testable without a GeoServer.
 */
export interface GeoServerEnv {
  url: string;
  user: string;
  password: string;
  workspace: string;
  db: { host: string; port: string; name: string; user: string; password: string };
}

export function geoserverEnv(env: NodeJS.ProcessEnv = process.env): GeoServerEnv {
  const url = env.GEOSERVER_URL;
  if (!url) throw new Error('GEOSERVER_URL is not set');
  return {
    url: url.replace(/\/$/, ''),
    user: env.GEOSERVER_ADMIN_USER ?? 'admin',
    password: env.GEOSERVER_ADMIN_PASSWORD ?? '',
    workspace: env.GEOSERVER_WORKSPACE ?? 'webatlas',
    db: {
      // GeoServer reaches Postgres over the compose network, hence `db`, not localhost.
      host: env.GEOSERVER_DB_HOST ?? 'db',
      port: env.GEOSERVER_DB_PORT ?? '5432',
      name: env.GEOSERVER_DB_NAME ?? 'webatlas',
      user: env.GEOSERVER_DB_USER ?? 'webatlas',
      password: env.GEOSERVER_DB_PASSWORD ?? '',
    },
  };
}

type Method = 'GET' | 'POST' | 'PUT';

async function gsRequest(gs: GeoServerEnv, f: typeof fetch, method: Method, path: string, body?: unknown): Promise<Response> {
  return f(`${gs.url}/rest${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${gs.user}:${gs.password}`).toString('base64'),
      // GeoServer content-negotiates and defaults to HTML without an explicit Accept.
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Any non-2xx fails the stage (spec §8), with the status, the path, and GeoServer's own text. */
async function expectOk(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`GeoServer ${what} failed: ${res.status} ${await res.text()}`);
}

export async function publishLayer(
  gs: GeoServerEnv,
  spec: { layer: string; nativeName?: string; style?: string },
  f: typeof fetch = fetch
): Promise<'created' | 'repointed' | 'unchanged'> {
  const ws = gs.workspace;
  const store = `${ws}_water`;
  const native = spec.nativeName ?? `${spec.layer}_active`;

  if ((await gsRequest(gs, f, 'GET', `/workspaces/${ws}`)).status !== 200) {
    await expectOk(await gsRequest(gs, f, 'POST', '/workspaces', { workspace: { name: ws } }), `create workspace ${ws}`);
  }
  if ((await gsRequest(gs, f, 'GET', `/workspaces/${ws}/datastores/${store}`)).status !== 200) {
    const entry = [
      { '@key': 'dbtype', $: 'postgis' },
      { '@key': 'host', $: gs.db.host },
      { '@key': 'port', $: gs.db.port },
      { '@key': 'database', $: gs.db.name },
      { '@key': 'schema', $: 'water' },
      { '@key': 'user', $: gs.db.user },
      { '@key': 'passwd', $: gs.db.password },
      { '@key': 'Expose primary keys', $: 'true' },
    ];
    await expectOk(
      await gsRequest(gs, f, 'POST', `/workspaces/${ws}/datastores`, { dataStore: { name: store, connectionParameters: { entry } } }),
      `create datastore ${store}`
    );
  }

  const ftPath = `/workspaces/${ws}/datastores/${store}/featuretypes`;
  let outcome: 'created' | 'repointed' | 'unchanged';
  const existing = await gsRequest(gs, f, 'GET', `${ftPath}/${spec.layer}`);
  if (existing.status === 200) {
    const current = (await existing.json()) as { featureType?: { nativeName?: string } };
    if (current.featureType?.nativeName === native) {
      outcome = 'unchanged';
    } else {
      // PUT, never delete-and-recreate: a delete drops the layer's styling, which this repo
      // cannot restore.
      await expectOk(
        await gsRequest(gs, f, 'PUT', `${ftPath}/${spec.layer}`, { featureType: { name: spec.layer, nativeName: native } }),
        `repoint ${spec.layer}`
      );
      outcome = 'repointed';
    }
  } else {
    await expectOk(
      await gsRequest(gs, f, 'POST', ftPath, {
        featureType: { name: spec.layer, nativeName: native, srs: 'EPSG:4326', enabled: true },
      }),
      `publish ${spec.layer}`
    );
    outcome = 'created';
  }

  if (spec.style) {
    await expectOk(
      await gsRequest(gs, f, 'PUT', `/layers/${ws}:${spec.layer}`, { layer: { defaultStyle: { name: spec.style } } }),
      `style ${spec.layer}`
    );
  }
  if (outcome === 'repointed') {
    // Repointing does not refresh GeoServer's cached attribute schema until the catalog resets.
    await expectOk(await gsRequest(gs, f, 'POST', '/reset'), 'catalog reset');
  }
  return outcome;
}
```

In the "assigns a default style" test, the scripted routes answer the featuretype GET with the matching relation, so the style PUT is the only write. That is correct as written.

- [ ] **Step 4: The executor**

Create `src/stages/publishGeoserver.ts`:

```ts
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { geoserverEnv, publishLayer } from '../geoserver';

type PublishStage = Extract<Stage, { type: 'publish-geoserver' }>;

export async function executePublishGeoserver(
  _pool: Pool,
  stage: PublishStage,
  ctx: StageContext,
  env: NodeJS.ProcessEnv = process.env,
  f: typeof fetch = fetch
): Promise<StageResult> {
  const gs = geoserverEnv(env);
  const native = stage.nativeName ?? `${stage.layer}_active`;
  const outcome = await publishLayer(gs, { layer: stage.layer, nativeName: stage.nativeName, style: stage.style }, f);
  ctx.log(`[${ctx.datasetId}] ${gs.workspace}:${stage.layer} ${outcome}`);
  return { summary: `${gs.workspace}:${stage.layer} → ${native} (${outcome})` };
}
```

In `src/stages/index.ts`, import it and add `'publish-geoserver': executePublishGeoserver,` to `EXECUTORS`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS. `publishGeoserver.live.test.ts` is listed as **run** (2 tests), not skipped.

- [ ] **Step 6: Mutation check**

In `publishLayer`, delete the `if (outcome === 'repointed') { … /reset … }` block. "repoints with PUT … and resets the catalog" must fail. Restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): executor publish-geoserver — trỏ lại bằng PUT, lỗi khi phản hồi không 2xx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Registry validation; `rivers` builds for real

**Files:**
- Create: `packages/atlas-data/src/cli/env.ts`, `src/cli/env.test.ts`
- Modify: `src/registry.ts`, `src/registry.test.ts`, `src/descriptors/rivers.ts`, `src/cli/build.ts`, `src/cli/status.ts`

**Interfaces:**
- Consumes: `hasExecutor` (Task 2); every executor (Tasks 2 and 4–6).
- Produces:
  - `loadDevEnv(file?: string): string | null`, which returns the file it loaded or null;
  - `validateRegistry` rejecting stage types with no executor;
  - the `rivers` dataset with two stages.

- [ ] **Step 1: Write the failing tests**

Append to `src/registry.test.ts`:

```ts
  it('rejects a stage type with no executor at load time, naming the dataset (spec §8)', () => {
    const bad = {
      id: 'bad-no-executor',
      kind: 'vector',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'load-geojson', file: 'f.geojson', table: 't', columns: () => ({}) }],
    } as unknown as Dataset;
    expect(() => validateRegistry([bad])).toThrow(/bad-no-executor.*load-geojson.*no executor/s);
  });

  it('rivers ingests on the host and then publishes rivers_detail', () => {
    const rivers = ALL_DATASETS.find((d) => d.id === 'rivers')!;
    expect(rivers.stages.map((s) => s.type)).toEqual(['run', 'publish-geoserver']);
    expect(rivers.stages[1]).toMatchObject({ layer: 'rivers', nativeName: 'rivers_detail' });
  });
```

Create `src/cli/env.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDevEnv } from './env';

const KEY = '__ATLASDATA_TEST_ENV__';
let dir = '';
const saved = process.env.DATABASE_URL;

afterEach(async () => {
  delete process.env[KEY];
  if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('loadDevEnv', () => {
  it('loads the dev env file when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    dir = await mkdtemp(join(tmpdir(), 'atlas-env-'));
    const file = join(dir, '.env');
    await writeFile(file, `${KEY}=from-file\nDATABASE_URL=postgres://x/y\n`);
    expect(loadDevEnv(file)).toBe(file);
    expect(process.env[KEY]).toBe('from-file');
  });

  it('does nothing when DATABASE_URL is already set — an explicit environment wins', async () => {
    process.env.DATABASE_URL = 'postgres://explicit/db';
    dir = await mkdtemp(join(tmpdir(), 'atlas-env-'));
    const file = join(dir, '.env');
    await writeFile(file, `${KEY}=from-file\n`);
    expect(loadDevEnv(file)).toBeNull();
    expect(process.env[KEY]).toBeUndefined();
  });

  it('returns null when the file does not exist', () => {
    delete process.env.DATABASE_URL;
    expect(loadDevEnv(join(tmpdir(), 'definitely-missing-atlas.env'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @webatlas/atlas-data -- src/registry.test.ts src/cli/env.test.ts`
Expected: FAIL. `load-geojson` passes validation, `rivers` has one stage, and `./env` does not exist.

- [ ] **Step 3: Registry validation**

In `src/registry.ts`, import `hasExecutor` from `./stages/index`, and add after the schema loop in `validateRegistry`:

```ts
  // A stage type with no executor would fail only when reached, after earlier stages had
  // already run. Reject it here, at load time (spec §8).
  for (const d of datasets) {
    for (const s of d.stages) {
      if (!hasExecutor(s.type)) {
        throw new Error(`Dataset "${d.id}" uses stage type "${s.type}", which has no executor`);
      }
    }
  }
```

- [ ] **Step 4: Rivers publishes**

In `src/descriptors/rivers.ts`, append to `stages`:

```ts
    // rivers_detail, not rivers_active: water.rivers holds all three levels, so the active view
    // would draw every river as its ways, reaches and entity stacked together.
    { type: 'publish-geoserver', layer: 'rivers', nativeName: 'rivers_detail' },
```

- [ ] **Step 5: The CLI finds its environment**

Create `src/cli/env.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../paths';

/**
 * Load the dev environment (DATABASE_URL, GEOSERVER_*) from apps/api/.env when DATABASE_URL is
 * not already set, so `npm run atlas:build` works from a fresh shell. An explicit environment
 * always wins: nothing is loaded when DATABASE_URL is present, and process.loadEnvFile never
 * overrides a variable that is already set. Returns the file it loaded, or null.
 */
export function loadDevEnv(file: string = join(REPO_ROOT, 'apps', 'api', '.env')): string | null {
  if (process.env.DATABASE_URL) return null;
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}
```

In `src/cli/build.ts` and `src/cli/status.ts`, import `loadDevEnv` from `./env` and call it as the first statement of `main()`:

```ts
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `set -a; . apps/api/.env; set +a; npm test -w @webatlas/atlas-data && npm run build -w @webatlas/atlas-data`
Expected: PASS. Every gated suite (state/lineage/sql db tests, and the live publish test) is listed as run.

- [ ] **Step 7: End to end — `rivers` builds for real**

From the repo root, in a **fresh shell with no exported variables** (this proves `loadDevEnv`):

```bash
npm run atlas:build -- --only rivers
```

Expected:
- `(environment from …apps\api\.env)`;
- `[rivers]`-prefixed lines from the ingest, taking about a minute, with heartbeats if it goes quiet;
- then `built rivers/0:run` and `built rivers/1:publish-geoserver`;
- exit code 0.

```bash
npm run atlas:status
```

Expected: `rivers  0:run: ok  1:publish-geoserver: ok`.

```bash
npm run atlas:build -- --only rivers
```

Expected: `executed 0, skipped 2`.

```bash
npm run atlas:build -- --only rivers --force rivers
```

Expected: both stages executed again, and exit code 0.

Check the process steps that were recorded:

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -Atc "SELECT description, tool FROM app.dataset_lineage_step WHERE dataset_id = 'rivers' ORDER BY id DESC LIMIT 4"
```

Expected: descriptions like `stage 0:run · <12 hex> · run ingest:rivers -w @webatlas/api` with tool `run ingest:rivers -w @webatlas/api`, and `stage 1:publish-geoserver · <12 hex> · webatlas:rivers → rivers_detail (unchanged)`.

Confirm the map layer still serves:

```bash
curl -s "http://localhost:8080/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webatlas:rivers&outputFormat=application/json&count=1" | head -c 200
```

Expected: a `FeatureCollection` with one feature.

Record the measured duration of the first build and of the forced build in this plan's Execution Notes (Step 9).

- [ ] **Step 8: Commit**

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): sổ đăng ký từ chối stage không có executor; rivers dựng thật (ingest + publish); CLI tự nạp apps/api/.env

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Execution notes**

Append an `## Execution Notes` section to this plan covering:
- each deviation taken;
- each mutation check's result;
- the Step 7 timings and outputs;
- the final `atlas-data` test count (files, tests, and how many were skipped — it must be zero skipped with the env exported).

Commit it:

```bash
git add docs/superpowers/plans/2026-09-30-plan-A-registry-run-stages.md
git commit -m "docs(plan): ghi chú thực thi kế hoạch A của sổ đăng ký

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final Verification

```bash
set -a; . apps/api/.env; set +a
npm test -w @webatlas/atlas-data          # all pass, 0 skipped
npm run build -w @webatlas/atlas-data     # tsc exit 0
npm run atlas:status                      # demo ok, rivers ok
npm test -w @webatlas/api -- src/geoserver/publish.test.ts   # the old publish path still passes
```

## Definition of Done

- **Cascade (I3):** executing a stage deletes its later stages' state and every transitive dependent's state first, over the whole registry. `--force` re-runs a dataset and cascades.
- **What ran (I4):** every process step names the stage, the 12-character hash prefix, and what ran.
- **Executors:** `run` (host via `npm-cli.js`; tools via `docker compose run`, wired but unexercised until Plan B), `fetch-http` and `publish-geoserver` all execute, and no process is ever started through a shell.
- **Validation:** a descriptor using a stage type with no executor fails at registry load.
- **Rivers for real:** `npm run atlas:build -- --only rivers` works from a fresh shell, and `atlas:status` shows both stages `ok`.
- **Old commands:** `npm run seed`, `ingest:rivers` and `publish:geoserver` are unchanged and still work.
