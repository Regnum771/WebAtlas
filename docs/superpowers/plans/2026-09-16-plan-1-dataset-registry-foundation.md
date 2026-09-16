# Dataset Registry Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `packages/atlas-data` workspace with a validated dataset registry, dependency graph, ISO 19115 lineage, stage-state idempotence, and a runner — proven end-to-end on one trivial dataset via `atlas:build` and `atlas:status`.

**Architecture:** A new npm workspace holds typed dataset descriptors. A registry validates them and builds a dependency graph; a runner walks that graph in topological order, skipping stages whose input hash is unchanged, and records an ISO 19115-shaped lineage row per stage execution. This plan implements one stage type (`sql`); the remaining stage types land in Plan 2.

**Tech Stack:** TypeScript (ES2023, `verbatimModuleSyntax`), npm workspaces, zod for descriptor validation, `pg` for PostGIS access, vitest, node-pg-migrate.

**Spec:** [`2026-09-16-dataset-registry-and-one-command-build-design.md`](../specs/2026-09-16-dataset-registry-and-one-command-build-design.md)

## Global Constraints

- Node `>=22 <23`, npm `>=10` (root `package.json` `engines`) — do not change these.
- New workspace lives at `packages/atlas-data`. Same repository. This is a directory boundary, not a repository split.
- `tsconfig.json` mirrors `packages/shared`: `target es2023`, `module esnext`, `moduleResolution bundler`, `strict`, `verbatimModuleSyntax`, `declaration`, `noUnusedLocals`, `noUnusedParameters`.
- Migrations stay in `apps/api/src/db/migrations` — one migration chain for the whole repo. Do not create a second chain in the new workspace.
- Migration filenames continue the existing sequence: the next free number is `1000000000013` (`1000000000012` is taken by `1000000000012_dataset-sources-attribution.cjs` from the contours branch).
- All new lineage tables live in the `app` schema (INV-1: PostGIS is the single source of truth).
- Snapshot versioning (`app.dataset_versions`) is **not modified by this plan**. See spec §0.
- Tests use a synthetic dataset. No test in this plan may depend on the real basemap, DEM, or contour data.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run inside a transaction block — relevant to the `sql` stage.
- No command in this plan may invoke `docker compose down`, with or without `-v`.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/atlas-data/package.json` | Workspace manifest; `prepare` builds via tsc, matching `packages/shared` |
| `packages/atlas-data/tsconfig.json` | Compiler config mirroring `packages/shared` |
| `packages/atlas-data/src/types.ts` | `Dataset`, `Stage`, `Lineage`, `ColumnMap` type definitions only |
| `packages/atlas-data/src/schema.ts` | zod schemas validating descriptors; `defineDataset()` |
| `packages/atlas-data/src/graph.ts` | Topological order, cycle detection, `--except` dependent expansion |
| `packages/atlas-data/src/lineage.ts` | Lineage upsert, process-step append, transitive licence resolution |
| `packages/atlas-data/src/state.ts` | Stage input hashing; stage-state read/write |
| `packages/atlas-data/src/runner.ts` | Walk the graph, execute stages, record state and lineage |
| `packages/atlas-data/src/stages/sql.ts` | The `sql` stage executor |
| `packages/atlas-data/src/cli/build.ts` | `atlas:build` entry point |
| `packages/atlas-data/src/cli/status.ts` | `atlas:status` entry point |
| `packages/atlas-data/src/descriptors/index.ts` | Collects descriptors; the registry's input |
| `apps/api/src/db/migrations/1000000000013_dataset-lineage.cjs` | `app.dataset_lineage`, `_source`, `_step`, `app.dataset_stage_state`, and the scaffolding table `app.dataset_demo` used by Task 10 |

**Modified**

| File | Change |
|---|---|
| `package.json` (root) | Add `atlas:build` / `atlas:status` script pass-throughs |

Files are split by responsibility, not layer: `graph.ts` is pure logic with no database access and is unit-testable without a connection; `lineage.ts` and `state.ts` own their own tables and nothing else.

---

### Task 1: Workspace skeleton

Creates the workspace and proves it builds, type-checks, and runs tests before any real logic depends on it.

**Files:**
- Create: `packages/atlas-data/package.json`
- Create: `packages/atlas-data/tsconfig.json`
- Create: `packages/atlas-data/src/index.ts`
- Test: `packages/atlas-data/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `@webatlas/atlas-data` workspace, importable by later tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@webatlas/atlas-data', () => {
  it('is wired as a workspace and exports from its entry point', () => {
    expect(PACKAGE_NAME).toBe('@webatlas/atlas-data');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data`
Expected: FAIL — npm reports no workspace named `@webatlas/atlas-data`.

- [ ] **Step 3: Create the workspace manifest**

Create `packages/atlas-data/package.json`. `prepare` mirrors `packages/shared` so `npm ci` builds `dist/` automatically:

```json
{
  "name": "@webatlas/atlas-data",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.13.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^24.13.2",
    "@types/pg": "^8.11.10",
    "typescript": "~6.0.2",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 4: Create the compiler config**

Create `packages/atlas-data/tsconfig.json`, mirroring `packages/shared/tsconfig.json` with `types: ["node"]` added because this package reads the filesystem and environment:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 5: Create the entry point**

Create `packages/atlas-data/src/index.ts`:

```ts
export const PACKAGE_NAME = '@webatlas/atlas-data';
```

- [ ] **Step 6: Install so npm links the new workspace**

Run: `npm install`
Expected: completes without error; `packages/atlas-data/node_modules` exists.

> The root `package.json` already declares `"workspaces": ["apps/*", "packages/*"]`, so the new directory is picked up with no change to that file.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test -w @webatlas/atlas-data`
Expected: PASS — 1 test.

- [ ] **Step 8: Verify it type-checks**

Run: `npm run build -w @webatlas/atlas-data`
Expected: exit 0; `packages/atlas-data/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 9: Commit**

```bash
git add packages/atlas-data package-lock.json
git commit -m "feat(atlas-data): khởi tạo workspace cho đường ống dữ liệu"
```

---

### Task 2: Descriptor types and validation

Defines what a dataset declares, and rejects malformed descriptors at load time rather than mid-build.

**Files:**
- Create: `packages/atlas-data/src/types.ts`
- Create: `packages/atlas-data/src/schema.ts`
- Test: `packages/atlas-data/src/schema.test.ts`

**Interfaces:**
- Consumes: Task 1's workspace.
- Produces:
  - `type Dataset`, `type Stage`, `type Lineage`, `type ColumnMap` from `./types`
  - `defineDataset(d: Dataset): Dataset` from `./schema` — validates and returns, throws `ZodError` on invalid input.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineDataset } from './schema';

const valid = {
  id: 'demo',
  kind: 'derived' as const,
  lineage: {
    statement: 'Synthetic dataset used to prove the runner.',
    licence: 'CC0-1.0',
    sources: [],
  },
  stages: [{ type: 'sql' as const, statement: 'SELECT 1' }],
};

describe('defineDataset', () => {
  it('accepts a well-formed descriptor and returns it', () => {
    expect(defineDataset(valid).id).toBe('demo');
  });

  it('rejects a descriptor with no stages, which could never produce anything', () => {
    expect(() => defineDataset({ ...valid, stages: [] })).toThrow();
  });

  it('rejects lineage with no licence, because export cannot ship an unlicensed layer', () => {
    expect(() =>
      defineDataset({ ...valid, lineage: { ...valid.lineage, licence: '' } })
    ).toThrow();
  });

  it('rejects a run stage missing its promotion fields', () => {
    expect(() =>
      defineDataset({
        ...valid,
        // @ts-expect-error deliberately omitting promoteTo/promoteBy
        stages: [{ type: 'run', command: './x.sh', produces: 'out' }],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- schema`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Write the types**

Create `packages/atlas-data/src/types.ts`:

```ts
/** Map a GeoJSON feature's properties to { column: value }, excluding geometry. */
export type ColumnMap = (
  props: Record<string, unknown>,
  index: number
) => Record<string, unknown>;

/** Declared upstream provenance. ISO 19115 LI_Source. */
export interface LineageSource {
  citation: string;
  licence: string;
  uri?: string;
  resolution?: string;
}

/** ISO 19115 LI_Lineage. Process steps are appended by the runner, not declared. */
export interface Lineage {
  statement: string;
  licence: string;
  sources: LineageSource[];
}

export type Stage =
  | { type: 'fetch-http'; url: string; into: string; sha256?: string }
  | { type: 'load-geojson'; file: string; table: string; columns: ColumnMap }
  | { type: 'sql'; statement: string }
  | { type: 'publish-geoserver'; layer: string; style?: string }
  | {
      type: 'run';
      command: string;
      produces: string;
      /** Which built-in stage should eventually absorb this. */
      promoteTo: string;
      /** ISO date (YYYY-MM-DD). A past date fails the build — see Task 3. */
      promoteBy: string;
    };

export interface Dataset {
  id: string;
  kind: 'vector' | 'raster' | 'derived';
  lineage: Lineage;
  dependsOn?: string[];
  editable?: boolean;
  stages: Stage[];
}
```

- [ ] **Step 4: Write the validation schema**

Create `packages/atlas-data/src/schema.ts`:

```ts
import { z } from 'zod';
import type { Dataset } from './types';

const sourceSchema = z.object({
  citation: z.string().min(1),
  licence: z.string().min(1),
  uri: z.string().url().optional(),
  resolution: z.string().optional(),
});

const lineageSchema = z.object({
  statement: z.string().min(1),
  // Non-empty by design: an unlicensed dataset cannot be exported (spec §3).
  licence: z.string().min(1),
  sources: z.array(sourceSchema),
});

const stageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fetch-http'),
    url: z.string().url(),
    into: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }),
  z.object({
    type: z.literal('load-geojson'),
    file: z.string().min(1),
    table: z.string().min(1),
    columns: z.function(),
  }),
  z.object({ type: z.literal('sql'), statement: z.string().min(1) }),
  z.object({
    type: z.literal('publish-geoserver'),
    layer: z.string().min(1),
    style: z.string().optional(),
  }),
  z.object({
    type: z.literal('run'),
    command: z.string().min(1),
    produces: z.string().min(1),
    // Both required: the escape hatch cannot be constructed untracked (spec §2).
    promoteTo: z.string().min(1),
    promoteBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'promoteBy must be YYYY-MM-DD'),
  }),
]);

const datasetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['vector', 'raster', 'derived']),
  lineage: lineageSchema,
  dependsOn: z.array(z.string()).optional(),
  editable: z.boolean().optional(),
  // At least one: a dataset with no stages can never be materialised.
  stages: z.array(stageSchema).min(1),
});

/** Validate a descriptor at module load. Throws ZodError on invalid input. */
export function defineDataset(d: Dataset): Dataset {
  datasetSchema.parse(d);
  return d;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- schema`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-data/src/types.ts packages/atlas-data/src/schema.ts packages/atlas-data/src/schema.test.ts
git commit -m "feat(atlas-data): kiểu dữ liệu và kiểm tra hợp lệ cho bản mô tả tập dữ liệu"
```

---

### Task 3: The escape-hatch debt rule

A `run` stage whose `promoteBy` date has passed must fail the build. Without this test the rule is only a promise (spec §2, §6).

**Files:**
- Create: `packages/atlas-data/src/debt.ts`
- Test: `packages/atlas-data/src/debt.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `Stage` from `./types`.
- Produces: `assertNoOverdueEscapeHatches(datasets: Dataset[], today?: Date): void` from `./debt` — throws `Error` listing every overdue stage.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/debt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertNoOverdueEscapeHatches } from './debt';
import type { Dataset } from './types';

const withRunStage = (promoteBy: string): Dataset => ({
  id: 'dem',
  kind: 'raster',
  lineage: { statement: 's', licence: 'CC-BY-NC-SA-4.0', sources: [] },
  stages: [
    { type: 'run', command: 'prep_dem.py', produces: 'dem.tif', promoteTo: 'fetch-cog', promoteBy },
  ],
});

const TODAY = new Date('2026-09-16T00:00:00Z');

describe('assertNoOverdueEscapeHatches', () => {
  it('passes when the promotion date is still in the future', () => {
    expect(() => assertNoOverdueEscapeHatches([withRunStage('2026-12-31')], TODAY)).not.toThrow();
  });

  it('fails the build when a promotion date has passed', () => {
    expect(() => assertNoOverdueEscapeHatches([withRunStage('2026-01-01')], TODAY)).toThrow(
      /dem.*promoteBy 2026-01-01/s
    );
  });

  it('names every overdue stage, not just the first', () => {
    const a = withRunStage('2026-01-01');
    const b = { ...withRunStage('2026-02-02'), id: 'basemap' };
    expect(() => assertNoOverdueEscapeHatches([a, b], TODAY)).toThrow(/dem[\s\S]*basemap/);
  });

  it('ignores datasets with no run stages', () => {
    const clean: Dataset = {
      id: 'demo',
      kind: 'derived',
      lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
      stages: [{ type: 'sql', statement: 'SELECT 1' }],
    };
    expect(() => assertNoOverdueEscapeHatches([clean], TODAY)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- debt`
Expected: FAIL — cannot resolve `./debt`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/debt.ts`:

```ts
import type { Dataset } from './types';

/**
 * The `run` stage is a temporary escape hatch (spec §2). Each one declares when it
 * must be promoted to a built-in. Once that date passes this throws, which fails the
 * registry test and therefore the build — the hatch cannot quietly become permanent.
 *
 * `today` is injectable so the test does not depend on the wall clock.
 */
export function assertNoOverdueEscapeHatches(datasets: Dataset[], today: Date = new Date()): void {
  const overdue: string[] = [];

  for (const d of datasets) {
    for (const stage of d.stages) {
      if (stage.type !== 'run') continue;
      if (new Date(`${stage.promoteBy}T00:00:00Z`) < today) {
        overdue.push(
          `  ${d.id}: run "${stage.command}" had promoteBy ${stage.promoteBy}, ` +
            `should have been promoted to "${stage.promoteTo}"`
        );
      }
    }
  }

  if (overdue.length > 0) {
    throw new Error(
      `Escape-hatch promotion overdue for ${overdue.length} stage(s):\n${overdue.join('\n')}`
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- debt`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/debt.ts packages/atlas-data/src/debt.test.ts
git commit -m "feat(atlas-data): lối thoát hiểm quá hạn làm hỏng build"
```

---

### Task 4: Dependency graph

Topological ordering, cycle detection, and `--except` expansion to dependents. Pure logic, no database.

**Files:**
- Create: `packages/atlas-data/src/graph.ts`
- Test: `packages/atlas-data/src/graph.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `./types`.
- Produces, all from `./graph`:
  - `topologicalOrder(datasets: Dataset[]): Dataset[]` — throws on a cycle or unknown dependency.
  - `withDependencies(datasets: Dataset[], ids: string[]): Dataset[]` — for `--only`.
  - `withoutDependents(datasets: Dataset[], ids: string[]): Dataset[]` — for `--except`.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { topologicalOrder, withDependencies, withoutDependents } from './graph';
import type { Dataset } from './types';

const ds = (id: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// contours depends on dem; rivers_overview depends on rivers. Mirrors the real graph.
const graph = [ds('contours', ['dem']), ds('dem'), ds('rivers_overview', ['rivers']), ds('rivers')];

describe('topologicalOrder', () => {
  it('places every dependency before its dependents', () => {
    const order = topologicalOrder(graph).map((d) => d.id);
    expect(order.indexOf('dem')).toBeLessThan(order.indexOf('contours'));
    expect(order.indexOf('rivers')).toBeLessThan(order.indexOf('rivers_overview'));
  });

  it('throws on a cycle rather than looping forever', () => {
    expect(() => topologicalOrder([ds('a', ['b']), ds('b', ['a'])])).toThrow(/cycle/i);
  });

  it('throws when a dependency is not registered, naming the missing id', () => {
    expect(() => topologicalOrder([ds('contours', ['nope'])])).toThrow(/nope/);
  });
});

describe('withDependencies (--only)', () => {
  it('includes the requested dataset and everything it needs', () => {
    const ids = withDependencies(graph, ['contours']).map((d) => d.id).sort();
    expect(ids).toEqual(['contours', 'dem']);
  });
});

describe('withoutDependents (--except)', () => {
  it('excludes the named dataset AND everything downstream of it', () => {
    // Excluding dem must also exclude contours: a dependent cannot be built
    // without its parent (spec §4).
    const ids = withoutDependents(graph, ['dem']).map((d) => d.id).sort();
    expect(ids).toEqual(['rivers', 'rivers_overview']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- graph`
Expected: FAIL — cannot resolve `./graph`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/graph.ts`:

```ts
import type { Dataset } from './types';

function index(datasets: Dataset[]): Map<string, Dataset> {
  return new Map(datasets.map((d) => [d.id, d]));
}

/**
 * Depth-first topological sort. `visiting` detects cycles: re-entering a node that is
 * still on the stack means the graph loops, which must fail loudly rather than hang.
 */
export function topologicalOrder(datasets: Dataset[]): Dataset[] {
  const byId = index(datasets);
  const out: Dataset[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string, trail: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle: ${[...trail, id].join(' -> ')}`);
    }
    const d = byId.get(id);
    if (!d) {
      throw new Error(`Unknown dependency "${id}" (referenced by ${trail.at(-1) ?? 'root'})`);
    }
    visiting.add(id);
    for (const dep of d.dependsOn ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    done.add(id);
    out.push(d);
  };

  for (const d of datasets) visit(d.id, []);
  return out;
}

/** --only: the named datasets plus everything they transitively depend on. */
export function withDependencies(datasets: Dataset[], ids: string[]): Dataset[] {
  const byId = index(datasets);
  const keep = new Set<string>();

  const walk = (id: string): void => {
    if (keep.has(id)) return;
    const d = byId.get(id);
    if (!d) throw new Error(`Unknown dataset "${id}"`);
    keep.add(id);
    for (const dep of d.dependsOn ?? []) walk(dep);
  };

  for (const id of ids) walk(id);
  return datasets.filter((d) => keep.has(d.id));
}

/**
 * --except: the named datasets AND everything downstream of them. A dependent cannot
 * be materialised without its parent, so excluding `dem` must also exclude `contours`.
 */
export function withoutDependents(datasets: Dataset[], ids: string[]): Dataset[] {
  const drop = new Set(ids);
  let changed = true;

  // Iterate to a fixed point so exclusion propagates through chains of any depth.
  while (changed) {
    changed = false;
    for (const d of datasets) {
      if (drop.has(d.id)) continue;
      if ((d.dependsOn ?? []).some((dep) => drop.has(dep))) {
        drop.add(d.id);
        changed = true;
      }
    }
  }

  return datasets.filter((d) => !drop.has(d.id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- graph`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/graph.ts packages/atlas-data/src/graph.test.ts
git commit -m "feat(atlas-data): đồ thị phụ thuộc, thứ tự tô-pô và phát hiện chu trình"
```

---

### Task 5: Lineage and stage-state schema

The tables that replace `basemap.dataset_sources` and that make stage-level idempotence possible.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000013_dataset-lineage.cjs`
- Test: `apps/api/src/db/datasetLineage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `app.dataset_lineage`, `app.dataset_lineage_source`, `app.dataset_lineage_step`, `app.dataset_stage_state`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/db/datasetLineage.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from './pool';

afterAll(async () => { await closePool(); });

async function columns(table: string): Promise<string[]> {
  const { rows } = await getPool().query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = $1 ORDER BY column_name`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

describe('dataset lineage schema', () => {
  it('app.dataset_lineage holds one row per dataset with a licence', async () => {
    expect(await columns('dataset_lineage')).toEqual(
      expect.arrayContaining(['dataset_id', 'statement', 'licence', 'updated_at'])
    );
  });

  it('app.dataset_lineage_source records declared upstreams (LI_Source)', async () => {
    expect(await columns('dataset_lineage_source')).toEqual(
      expect.arrayContaining(['dataset_id', 'citation', 'licence', 'uri', 'resolution'])
    );
  });

  it('app.dataset_lineage_step records executions (LI_ProcessStep)', async () => {
    expect(await columns('dataset_lineage_step')).toEqual(
      expect.arrayContaining(['dataset_id', 'description', 'ran_at', 'tool'])
    );
  });

  it('app.dataset_stage_state keys on dataset + stage, carrying the input hash', async () => {
    expect(await columns('dataset_stage_state')).toEqual(
      expect.arrayContaining(['dataset_id', 'stage', 'input_hash', 'status', 'produced_at'])
    );
  });

  it('app.dataset_demo exists for the Task 10 demo dataset to populate', async () => {
    // Created here rather than by the demo's sql stage: in this repo migrations create
    // tables and pipeline code only populates them.
    expect(await columns('dataset_demo')).toEqual(expect.arrayContaining(['id', 'note']));
  });

  it('re-registering a dataset replaces its lineage row rather than duplicating it', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app.dataset_lineage (dataset_id, statement, licence)
       VALUES ('__test__', 'a', 'CC0-1.0')
       ON CONFLICT (dataset_id) DO UPDATE SET statement = EXCLUDED.statement`
    );
    await pool.query(
      `INSERT INTO app.dataset_lineage (dataset_id, statement, licence)
       VALUES ('__test__', 'b', 'CC0-1.0')
       ON CONFLICT (dataset_id) DO UPDATE SET statement = EXCLUDED.statement`
    );
    const { rows } = await pool.query(
      `SELECT statement FROM app.dataset_lineage WHERE dataset_id = '__test__'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).toBe('b');
    await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = '__test__'`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:api -- datasetLineage`
Expected: FAIL — the tables do not exist, so `columns()` returns `[]`.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000013_dataset-lineage.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * Lý lịch nguồn theo hình dạng ISO 19115, bắt buộc cho MỌI tập dữ liệu.
 *
 * Thay cho basemap.dataset_sources, vốn chỉ phủ được basemap.* và phải cập nhật bằng
 * tay — nên nó đúng cho tới khi có người quên. Ở đây các bước xử lý do chính bộ chạy
 * ghi ra, nên lý lịch không thể lệch khỏi thực tế.
 *
 * Vì sao nằm ở `app` chứ không phải `basemap`: nó mô tả mọi tập dữ liệu, kể cả water.*.
 *
 * Bảng cũ basemap.dataset_sources KHÔNG bị xoá ở migration này — nó được gỡ sau khi
 * các tập dữ liệu basemap đã chuyển sang sổ đăng ký (bước 4 của lộ trình di trú).
 *
 * app.dataset_demo là giàn giáo cho tập dữ liệu `demo` dùng để chứng minh bộ chạy. Tạo
 * nó ở đây chứ không để stage sql của bộ chạy tự tạo, vì quy ước của repo này là
 * migration tạo bảng còn mã đường ống chỉ đổ dữ liệu vào. Gỡ cùng tập dữ liệu demo khi
 * các tập dữ liệu thật đã chuyển sang sổ đăng ký.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage (
      dataset_id text PRIMARY KEY,
      statement   text NOT NULL,
      -- NOT NULL có chủ đích: một lớp không rõ giấy phép thì không xuất bản được.
      licence     text NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage_source (
      id         bigserial PRIMARY KEY,
      dataset_id text NOT NULL REFERENCES app.dataset_lineage(dataset_id) ON DELETE CASCADE,
      citation   text NOT NULL,
      licence    text NOT NULL,
      uri        text,
      resolution text
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS dataset_lineage_source_dataset_idx
             ON app.dataset_lineage_source (dataset_id)`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_lineage_step (
      id          bigserial PRIMARY KEY,
      dataset_id  text NOT NULL REFERENCES app.dataset_lineage(dataset_id) ON DELETE CASCADE,
      description text NOT NULL,
      tool        text,
      ran_at      timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS dataset_lineage_step_dataset_idx
             ON app.dataset_lineage_step (dataset_id, ran_at DESC)`);

  // Trạng thái theo TỪNG STAGE, không phải từng tập dữ liệu: sửa một phép ánh xạ cột
  // phải khiến đúng stage đó chạy lại, mà không đụng tới một lần tải DEM 40 phút.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_stage_state (
      dataset_id  text NOT NULL,
      stage       text NOT NULL,
      input_hash  text NOT NULL,
      status      text NOT NULL CHECK (status IN ('ok', 'failed')),
      produced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (dataset_id, stage)
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.dataset_demo (
      id   integer PRIMARY KEY,
      note text NOT NULL
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS app.dataset_demo');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_stage_state');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage_step');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage_source');
  pgm.sql('DROP TABLE IF EXISTS app.dataset_lineage');
};
```

- [ ] **Step 4: Apply the migration**

Run: `npm run migrate:up -w @webatlas/api`
Expected: `Migrations complete!`, naming `1000000000013_dataset-lineage`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:api -- datasetLineage`
Expected: PASS — 6 tests.

- [ ] **Step 6: Verify the migration reverses cleanly**

Run: `npm run migrate:down -w @webatlas/api && npm run migrate:up -w @webatlas/api`
Expected: both exit 0. A migration that cannot roll back is a migration you cannot deploy confidently.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/1000000000013_dataset-lineage.cjs apps/api/src/db/datasetLineage.test.ts
git commit -m "feat(api): bảng lý lịch nguồn theo ISO 19115 và trạng thái từng stage"
```

---

### Task 6: Lineage writes and transitive licence resolution

Records lineage from descriptors, appends a process step per stage execution, and computes the licence set a dataset inherits through `dependsOn`.

**Files:**
- Create: `packages/atlas-data/src/lineage.ts`
- Test: `packages/atlas-data/src/lineage.test.ts`

**Interfaces:**
- Consumes: `Dataset` from `./types`; the tables from Task 5.
- Produces, all from `./lineage`:
  - `upsertLineage(pool: Pool, d: Dataset): Promise<void>`
  - `appendProcessStep(pool: Pool, datasetId: string, description: string, tool: string): Promise<void>`
  - `resolveLicences(datasets: Dataset[], id: string): string[]` — pure; sorted, de-duplicated.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/lineage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveLicences } from './lineage';
import type { Dataset } from './types';

const ds = (id: string, licence: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence, sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

// The real case: contours are derived from the DEM, which is FABDEM (non-commercial).
const graph = [
  ds('dem', 'CC-BY-NC-SA-4.0'),
  ds('contours', 'CC-BY-NC-SA-4.0', ['dem']),
  ds('rivers', 'ODbL-1.0'),
  ds('atlas', 'CC0-1.0', ['contours', 'rivers']),
];

describe('resolveLicences', () => {
  it('returns a dataset’s own licence when it derives from nothing', () => {
    expect(resolveLicences(graph, 'rivers')).toEqual(['ODbL-1.0']);
  });

  it('inherits an upstream licence transitively — contours carry FABDEM’s terms', () => {
    expect(resolveLicences(graph, 'contours')).toEqual(['CC-BY-NC-SA-4.0']);
  });

  it('accumulates every licence in the ancestry, which is what export must honour', () => {
    expect(resolveLicences(graph, 'atlas')).toEqual([
      'CC-BY-NC-SA-4.0',
      'CC0-1.0',
      'ODbL-1.0',
    ]);
  });

  it('throws on an unknown dataset rather than silently returning nothing', () => {
    expect(() => resolveLicences(graph, 'nope')).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- lineage`
Expected: FAIL — cannot resolve `./lineage`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/lineage.ts`:

```ts
import type { Pool } from 'pg';
import type { Dataset } from './types';

/** Write the descriptor's declared lineage. Idempotent — re-registering replaces. */
export async function upsertLineage(pool: Pool, d: Dataset): Promise<void> {
  await pool.query(
    `INSERT INTO app.dataset_lineage (dataset_id, statement, licence, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (dataset_id)
       DO UPDATE SET statement = EXCLUDED.statement,
                     licence   = EXCLUDED.licence,
                     updated_at = now()`,
    [d.id, d.lineage.statement, d.lineage.licence]
  );

  // Declared sources are replaced wholesale: they describe the descriptor as it is now,
  // not a history. Process-step history lives in dataset_lineage_step instead.
  await pool.query(`DELETE FROM app.dataset_lineage_source WHERE dataset_id = $1`, [d.id]);
  for (const s of d.lineage.sources) {
    await pool.query(
      `INSERT INTO app.dataset_lineage_source (dataset_id, citation, licence, uri, resolution)
       VALUES ($1, $2, $3, $4, $5)`,
      [d.id, s.citation, s.licence, s.uri ?? null, s.resolution ?? null]
    );
  }
}

/**
 * Append an ISO 19115 LI_ProcessStep. Called by the runner after each stage, so lineage
 * is a by-product of execution and cannot drift from what actually ran.
 */
export async function appendProcessStep(
  pool: Pool,
  datasetId: string,
  description: string,
  tool: string
): Promise<void> {
  await pool.query(
    `INSERT INTO app.dataset_lineage_step (dataset_id, description, tool)
     VALUES ($1, $2, $3)`,
    [datasetId, description, tool]
  );
}

/**
 * Every licence that applies to a dataset, including those inherited through dependsOn.
 *
 * Pure and synchronous: it reads the descriptor graph, not the database, so export and
 * CI can ask the question without a connection. Sorted and de-duplicated so callers can
 * compare results directly.
 */
export function resolveLicences(datasets: Dataset[], id: string): string[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const found = new Set<string>();
  const seen = new Set<string>();

  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const d = byId.get(current);
    if (!d) throw new Error(`Unknown dataset "${current}"`);
    found.add(d.lineage.licence);
    for (const s of d.lineage.sources) found.add(s.licence);
    for (const dep of d.dependsOn ?? []) walk(dep);
  };

  walk(id);
  return [...found].sort();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- lineage`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/lineage.ts packages/atlas-data/src/lineage.test.ts
git commit -m "feat(atlas-data): ghi lý lịch nguồn và tính giấy phép kế thừa"
```

---

### Task 7: Stage input hashing

Determines whether a stage needs to run. This is what makes `atlas:build` resumable rather than restartable.

**Files:**
- Create: `packages/atlas-data/src/state.ts`
- Test: `packages/atlas-data/src/state.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `Stage` from `./types`.
- Produces, from `./state`:
  - `stageKey(stageIndex: number, stage: Stage): string` — stable identifier for the state table.
  - `stageInputHash(stage: Stage, upstreamHashes: string[]): string` — 64-char hex.
  - `readStageState(pool, datasetId, stage): Promise<{ input_hash: string; status: string } | null>`
  - `writeStageState(pool, datasetId, stage, hash, status): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stageKey, stageInputHash } from './state';
import type { Stage } from './types';

const sql = (statement: string): Stage => ({ type: 'sql', statement });

describe('stageKey', () => {
  it('combines position and type so two sql stages stay distinguishable', () => {
    expect(stageKey(0, sql('SELECT 1'))).toBe('0:sql');
    expect(stageKey(1, sql('SELECT 1'))).toBe('1:sql');
  });
});

describe('stageInputHash', () => {
  it('is stable for identical input', () => {
    expect(stageInputHash(sql('SELECT 1'), [])).toBe(stageInputHash(sql('SELECT 1'), []));
  });

  it('changes when the stage config changes, which is what marks it stale', () => {
    expect(stageInputHash(sql('SELECT 1'), [])).not.toBe(stageInputHash(sql('SELECT 2'), []));
  });

  it('changes when an upstream hash changes, so dependents rebuild', () => {
    expect(stageInputHash(sql('SELECT 1'), ['a'])).not.toBe(stageInputHash(sql('SELECT 1'), ['b']));
  });

  it('does not depend on the order upstream hashes are supplied', () => {
    expect(stageInputHash(sql('SELECT 1'), ['a', 'b'])).toBe(
      stageInputHash(sql('SELECT 1'), ['b', 'a'])
    );
  });

  it('hashes a function-valued field by source, so editing a column map invalidates it', () => {
    const a: Stage = { type: 'load-geojson', file: 'f', table: 't', columns: (p) => ({ x: p.a }) };
    const b: Stage = { type: 'load-geojson', file: 'f', table: 't', columns: (p) => ({ x: p.b }) };
    expect(stageInputHash(a, [])).not.toBe(stageInputHash(b, []));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- state`
Expected: FAIL — cannot resolve `./state`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/state.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Stage } from './types';

/**
 * Stable identifier for a stage within its dataset. Position is included because a
 * dataset may legitimately hold two stages of the same type.
 */
export function stageKey(stageIndex: number, stage: Stage): string {
  return `${stageIndex}:${stage.type}`;
}

/**
 * Hash of everything that should force a rerun: the stage's own configuration plus its
 * upstreams' hashes.
 *
 * Function-valued fields (load-geojson's `columns`) are serialised via toString() so
 * that editing a column mapping invalidates the stage. JSON.stringify drops functions
 * silently, which would make such an edit invisible — a stale load with no signal.
 *
 * Upstream hashes are sorted so ordering never affects the result.
 */
export function stageInputHash(stage: Stage, upstreamHashes: string[]): string {
  const config = JSON.stringify(stage, (_key, value) =>
    typeof value === 'function' ? value.toString() : value
  );
  return createHash('sha256')
    .update(config)
    .update('\u0000')
    .update([...upstreamHashes].sort().join('\u0000'))
    .digest('hex');
}

export async function readStageState(
  pool: Pool,
  datasetId: string,
  stage: string
): Promise<{ input_hash: string; status: string } | null> {
  const { rows } = await pool.query<{ input_hash: string; status: string }>(
    `SELECT input_hash, status FROM app.dataset_stage_state
      WHERE dataset_id = $1 AND stage = $2`,
    [datasetId, stage]
  );
  return rows[0] ?? null;
}

export async function writeStageState(
  pool: Pool,
  datasetId: string,
  stage: string,
  inputHash: string,
  status: 'ok' | 'failed'
): Promise<void> {
  await pool.query(
    `INSERT INTO app.dataset_stage_state (dataset_id, stage, input_hash, status, produced_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (dataset_id, stage)
       DO UPDATE SET input_hash = EXCLUDED.input_hash,
                     status     = EXCLUDED.status,
                     produced_at = now()`,
    [datasetId, stage, inputHash, status]
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- state`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/state.ts packages/atlas-data/src/state.test.ts
git commit -m "feat(atlas-data): băm đầu vào theo stage để dựng lại được từ giữa chừng"
```

---

### Task 8: The `sql` stage executor

The one stage type this plan implements. Chosen first because it needs no network and no filesystem, so the runner can be proven end-to-end without them.

**Files:**
- Create: `packages/atlas-data/src/stages/sql.ts`
- Test: `packages/atlas-data/src/stages/sql.test.ts`

**Interfaces:**
- Consumes: `Stage` from `../types`.
- Produces: `executeSql(pool: Pool, stage: Extract<Stage, { type: 'sql' }>): Promise<void>` from `./stages/sql`.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/stages/sql.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { executeSql } from './sql';
import type { Pool } from 'pg';

const fakePool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as Pool;

describe('executeSql', () => {
  it('runs the statement on the pool', async () => {
    const pool = fakePool();
    await executeSql(pool, { type: 'sql', statement: 'SELECT 1' });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('does not wrap the statement in a transaction', async () => {
    // REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block,
    // and rivers_overview is refreshed exactly that way. Wrapping would break it.
    const pool = fakePool();
    await executeSql(pool, {
      type: 'sql',
      statement: 'REFRESH MATERIALIZED VIEW CONCURRENTLY water.rivers_overview',
    });
    const issued = (pool.query as unknown as { mock: { calls: string[][] } }).mock.calls.flat();
    expect(issued).not.toContain('BEGIN');
  });

  it('propagates a failure so the runner can mark the stage failed', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Pool;
    await expect(executeSql(pool, { type: 'sql', statement: 'SELECT 1' })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- stages/sql`
Expected: FAIL — cannot resolve `./sql`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/stages/sql.ts`:

```ts
import type { Pool } from 'pg';
import type { Stage } from '../types';

/**
 * Run a statement against the pool.
 *
 * Deliberately NOT wrapped in a transaction. REFRESH MATERIALIZED VIEW CONCURRENTLY —
 * how water.rivers_overview is rebuilt — cannot execute inside a transaction block, and
 * that is the first real use of this stage. Statements needing atomicity say so
 * themselves with their own BEGIN/COMMIT.
 */
export async function executeSql(
  pool: Pool,
  stage: Extract<Stage, { type: 'sql' }>
): Promise<void> {
  await pool.query(stage.statement);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- stages/sql`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/stages/sql.ts packages/atlas-data/src/stages/sql.test.ts
git commit -m "feat(atlas-data): stage sql, cố ý không bọc giao dịch"
```

---

### Task 9: The runner

Walks the graph, skips unchanged stages, executes the rest, and records state and lineage.

**Files:**
- Create: `packages/atlas-data/src/runner.ts`
- Test: `packages/atlas-data/src/runner.test.ts`

**Interfaces:**
- Consumes: `topologicalOrder` (Task 4), `upsertLineage`/`appendProcessStep` (Task 6), `stageKey`/`stageInputHash`/`readStageState`/`writeStageState` (Task 7), `executeSql` (Task 8).
- Produces: `runBuild(pool: Pool, datasets: Dataset[]): Promise<BuildReport>` from `./runner`, where

```ts
interface BuildReport {
  executed: string[];   // "datasetId/stageKey"
  skipped: string[];
  failed: string[];
  blocked: string[];    // skipped because an upstream failed
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/runner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBuild } from './runner';
import type { Dataset } from './types';
import type { Pool } from 'pg';

const ds = (id: string, statement: string, dependsOn?: string[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  dependsOn,
  stages: [{ type: 'sql', statement }],
});

/** Minimal in-memory stand-in for the state + lineage tables. */
function memoryPool() {
  const state = new Map<string, string>();
  const steps: string[] = [];
  const executed: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM app.dataset_stage_state')) {
      const hash = state.get(`${params![0]}|${params![1]}`);
      return { rows: hash ? [{ input_hash: hash, status: 'ok' }] : [] };
    }
    if (sql.includes('INTO app.dataset_stage_state')) {
      state.set(`${params![0]}|${params![1]}`, params![2] as string);
      return { rows: [] };
    }
    if (sql.includes('INTO app.dataset_lineage_step')) {
      steps.push(params![0] as string);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT') || sql.startsWith('REFRESH')) executed.push(sql);
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, steps, executed };
}

describe('runBuild', () => {
  let ctx: ReturnType<typeof memoryPool>;
  beforeEach(() => { ctx = memoryPool(); });

  it('executes dependencies before dependents', async () => {
    const report = await runBuild(ctx.pool, [ds('b', 'SELECT 2', ['a']), ds('a', 'SELECT 1')]);
    expect(report.executed).toEqual(['a/0:sql', 'b/0:sql']);
  });

  it('performs the work once when run twice', async () => {
    const graph = [ds('a', 'SELECT 1')];
    await runBuild(ctx.pool, graph);
    const second = await runBuild(ctx.pool, graph);
    expect(second.executed).toEqual([]);
    expect(second.skipped).toEqual(['a/0:sql']);
  });

  it('reruns a stage whose descriptor changed', async () => {
    await runBuild(ctx.pool, [ds('a', 'SELECT 1')]);
    const second = await runBuild(ctx.pool, [ds('a', 'SELECT 999')]);
    expect(second.executed).toEqual(['a/0:sql']);
  });

  it('writes one lineage process step per executed stage, and none for a skip', async () => {
    const graph = [ds('a', 'SELECT 1')];
    await runBuild(ctx.pool, graph);
    expect(ctx.steps).toEqual(['a']);
    await runBuild(ctx.pool, graph);
    expect(ctx.steps).toEqual(['a']);
  });

  it('blocks dependents of a failed stage but not independent branches', async () => {
    const failing = { ...ds('a', 'FAIL ME'), stages: [{ type: 'sql' as const, statement: 'FAIL ME' }] };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'FAIL ME') throw new Error('boom');
        return { rows: [] };
      }),
    } as unknown as Pool;

    const report = await runBuild(pool, [failing, ds('b', 'SELECT 2', ['a']), ds('c', 'SELECT 3')]);
    expect(report.failed).toEqual(['a/0:sql']);
    expect(report.blocked).toEqual(['b']);
    expect(report.executed).toContain('c/0:sql');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- runner`
Expected: FAIL — cannot resolve `./runner`.

- [ ] **Step 3: Write the implementation**

Create `packages/atlas-data/src/runner.ts`:

```ts
import type { Pool } from 'pg';
import type { Dataset } from './types';
import { topologicalOrder } from './graph';
import { upsertLineage, appendProcessStep } from './lineage';
import { stageKey, stageInputHash, readStageState, writeStageState } from './state';
import { executeSql } from './stages/sql';

export interface BuildReport {
  executed: string[];
  skipped: string[];
  failed: string[];
  blocked: string[];
}

export async function runBuild(pool: Pool, datasets: Dataset[]): Promise<BuildReport> {
  const report: BuildReport = { executed: [], skipped: [], failed: [], blocked: [] };
  const hashes = new Map<string, string>();   // dataset id -> last stage hash
  const broken = new Set<string>();           // datasets that failed or are downstream of one

  for (const d of topologicalOrder(datasets)) {
    // A dependent cannot be built on a parent that failed. Skip it, but keep going —
    // halting the whole run over one failure wastes an hours-long build.
    if ((d.dependsOn ?? []).some((dep) => broken.has(dep))) {
      broken.add(d.id);
      report.blocked.push(d.id);
      continue;
    }

    await upsertLineage(pool, d);
    const upstream = (d.dependsOn ?? []).map((dep) => hashes.get(dep) ?? '');
    let datasetFailed = false;

    for (const [i, stage] of d.stages.entries()) {
      const key = stageKey(i, stage);
      const label = `${d.id}/${key}`;
      const hash = stageInputHash(stage, upstream);

      const prior = await readStageState(pool, d.id, key);
      if (prior?.status === 'ok' && prior.input_hash === hash) {
        report.skipped.push(label);
        hashes.set(d.id, hash);
        continue;
      }

      try {
        await executeStage(pool, stage);
      } catch {
        await writeStageState(pool, d.id, key, hash, 'failed');
        report.failed.push(label);
        broken.add(d.id);
        datasetFailed = true;
        break;
      }

      await writeStageState(pool, d.id, key, hash, 'ok');
      // Lineage is written from what actually ran, so it cannot drift (spec §3).
      await appendProcessStep(pool, d.id, `stage ${key} completed`, stage.type);
      report.executed.push(label);
      hashes.set(d.id, hash);
    }

    if (datasetFailed) continue;
  }

  return report;
}

async function executeStage(pool: Pool, stage: Dataset['stages'][number]): Promise<void> {
  switch (stage.type) {
    case 'sql':
      return executeSql(pool, stage);
    default:
      // Plan 2 adds fetch-http, load-geojson, publish-geoserver and run.
      throw new Error(`Stage type "${stage.type}" is not implemented yet`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w @webatlas/atlas-data -- runner`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-data/src/runner.ts packages/atlas-data/src/runner.test.ts
git commit -m "feat(atlas-data): bộ chạy theo thứ tự tô-pô, bỏ qua stage không đổi"
```

---

### Task 10: Registry, CLI, and the trivial dataset

Ties everything together and proves the foundation end-to-end, which is what spec §7 step 1 requires.

**Files:**
- Create: `packages/atlas-data/src/descriptors/demo.ts`
- Create: `packages/atlas-data/src/descriptors/index.ts`
- Create: `packages/atlas-data/src/registry.ts`
- Create: `packages/atlas-data/src/cli/build.ts`
- Create: `packages/atlas-data/src/cli/status.ts`
- Modify: `packages/atlas-data/package.json` (add `atlas:build`, `atlas:status`)
- Modify: `package.json` (root — add pass-through scripts)
- Test: `packages/atlas-data/src/registry.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: `ALL_DATASETS: Dataset[]` and `validateRegistry(today?: Date): void` from `./registry`.

- [ ] **Step 1: Write the failing test**

Create `packages/atlas-data/src/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ALL_DATASETS, validateRegistry } from './registry';
import { topologicalOrder } from './graph';

describe('registry', () => {
  it('holds at least one dataset', () => {
    expect(ALL_DATASETS.length).toBeGreaterThan(0);
  });

  it('every dataset declares a non-empty licence — export depends on it', () => {
    for (const d of ALL_DATASETS) expect(d.lineage.licence.length).toBeGreaterThan(0);
  });

  it('dataset ids are unique', () => {
    const ids = ALL_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the dependency graph is acyclic and fully resolvable', () => {
    expect(() => topologicalOrder(ALL_DATASETS)).not.toThrow();
  });

  it('no escape hatch is overdue for promotion', () => {
    expect(() => validateRegistry()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w @webatlas/atlas-data -- registry`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write the trivial dataset**

Create `packages/atlas-data/src/descriptors/demo.ts`. This is the "one trivial dataset" of spec §7 step 1 — it proves the machinery without depending on any real data:

```ts
import { defineDataset } from '../schema';

/**
 * Tập dữ liệu tối giản để chứng minh bộ chạy hoạt động từ đầu tới cuối mà không cần
 * bất kỳ dữ liệu thật nào. Nó ghi hai dòng vào app.dataset_demo, nên "đã dựng" là thứ
 * quan sát được.
 *
 * Bảng do migration 1000000000013 tạo, KHÔNG phải do stage ở đây: quy ước của repo là
 * migration tạo bảng, mã đường ống chỉ đổ dữ liệu. Hai stage chứ không phải một, để
 * chứng minh thứ tự stage trong cùng một tập dữ liệu.
 */
export const demo = defineDataset({
  id: 'demo',
  kind: 'derived',
  lineage: {
    statement: 'Bảng tổng hợp tối giản, sinh ra tại chỗ để kiểm chứng sổ đăng ký.',
    licence: 'CC0-1.0',
    sources: [],
  },
  stages: [
    {
      type: 'sql',
      statement: `INSERT INTO app.dataset_demo (id, note)
                  VALUES (1, 'materialised by the atlas runner')
                  ON CONFLICT (id) DO NOTHING`,
    },
    {
      type: 'sql',
      statement: `INSERT INTO app.dataset_demo (id, note)
                  VALUES (2, 'second stage, proving in-dataset stage order')
                  ON CONFLICT (id) DO NOTHING`,
    },
  ],
});
```

- [ ] **Step 4: Write the descriptor index and registry**

Create `packages/atlas-data/src/descriptors/index.ts`:

```ts
import { demo } from './demo';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [demo];
```

Create `packages/atlas-data/src/registry.ts`:

```ts
import type { Dataset } from './types';
import { DESCRIPTORS } from './descriptors/index';
import { topologicalOrder } from './graph';
import { assertNoOverdueEscapeHatches } from './debt';

export const ALL_DATASETS: Dataset[] = DESCRIPTORS;

/**
 * Every check that must hold before a build may start. Called by the CLI and asserted
 * by the registry test, so a malformed registry fails in CI rather than mid-build.
 */
export function validateRegistry(today: Date = new Date()): void {
  const ids = ALL_DATASETS.map((d) => d.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate dataset ids: ${[...new Set(duplicates)].join(', ')}`);
  }
  topologicalOrder(ALL_DATASETS);            // throws on cycles / unknown dependencies
  assertNoOverdueEscapeHatches(ALL_DATASETS, today);
}
```

- [ ] **Step 5: Write the CLI entry points**

Create `packages/atlas-data/src/cli/build.ts`:

```ts
import pg from 'pg';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { withDependencies, withoutDependents } from '../graph';
import { runBuild } from '../runner';

function listArg(flag: string): string[] {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : [];
}

async function main(): Promise<void> {
  validateRegistry();

  const only = listArg('--only');
  const except = listArg('--except');
  let datasets = ALL_DATASETS;
  if (only.length > 0) datasets = withDependencies(datasets, only);
  if (except.length > 0) datasets = withoutDependents(datasets, except);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });

  try {
    const report = await runBuild(pool, datasets);
    console.log(`executed ${report.executed.length}, skipped ${report.skipped.length}`);
    for (const s of report.executed) console.log(`  built   ${s}`);
    for (const s of report.failed) console.log(`  FAILED  ${s}`);
    for (const s of report.blocked) console.log(`  blocked ${s} (upstream failed)`);
    if (report.failed.length > 0 || report.blocked.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

Create `packages/atlas-data/src/cli/status.ts`:

```ts
import pg from 'pg';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { topologicalOrder } from '../graph';
import { stageKey, stageInputHash, readStageState } from '../state';

async function main(): Promise<void> {
  validateRegistry();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });

  try {
    // Upstream hashes must be tracked exactly as runner.ts tracks them. Passing [] here
    // would compute a different hash for any dataset with dependsOn, and status would
    // report "stale" for a dataset the build considers current — a disagreement between
    // the two commands that would look like a bug in the build.
    const hashes = new Map<string, string>();

    for (const d of topologicalOrder(ALL_DATASETS)) {
      const upstream = (d.dependsOn ?? []).map((dep) => hashes.get(dep) ?? '');
      const marks: string[] = [];

      for (const [i, stage] of d.stages.entries()) {
        const key = stageKey(i, stage);
        const hash = stageInputHash(stage, upstream);
        hashes.set(d.id, hash);

        const prior = await readStageState(pool, d.id, key);
        if (!prior) marks.push(`${key}: missing`);
        else if (prior.status !== 'ok') marks.push(`${key}: failed`);
        else if (prior.input_hash !== hash) marks.push(`${key}: stale`);
        else marks.push(`${key}: ok`);
      }

      console.log(`${d.id.padEnd(20)} ${marks.join('  ')}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 6: Add the scripts**

In `packages/atlas-data/package.json`, add to `scripts`:

```json
    "atlas:build": "tsx src/cli/build.ts",
    "atlas:status": "tsx src/cli/status.ts"
```

and add `"tsx": "^4.19.2"` to `devDependencies` (matching the version `apps/api` already uses).

In the root `package.json`, add to `scripts`:

```json
    "atlas:build": "npm run atlas:build -w @webatlas/atlas-data",
    "atlas:status": "npm run atlas:status -w @webatlas/atlas-data"
```

- [ ] **Step 7: Install and run the registry tests**

Run: `npm install && npm run test -w @webatlas/atlas-data -- registry`
Expected: PASS — 5 tests.

- [ ] **Step 8: Prove it end to end against a real database**

> **The CLI reads `DATABASE_URL` from the environment and does not load a `.env` file.**
> `apps/api` gets one via `import 'dotenv/config'`, but that resolves relative to its own
> working directory and this is a different workspace. Export it for these steps; giving
> the pipeline its own environment handling belongs with `atlas:up` in Plan 3.

Run:
```bash
docker compose -f infra/docker-compose.yml up -d
npm run migrate:up -w @webatlas/api

export DATABASE_URL=$(grep -E '^DATABASE_URL=' apps/api/.env | cut -d= -f2-)
npm run atlas:build
```
Expected output contains `executed 2, skipped 0`, listing `demo/0:sql` and `demo/1:sql`.

- [ ] **Step 9: Prove idempotence and status**

Run (same shell, `DATABASE_URL` still exported): `npm run atlas:build`
Expected: `executed 0, skipped 2` — the second run performs no work.

Run: `npm run atlas:status`
Expected: `demo   0:sql: ok  1:sql: ok`

- [ ] **Step 10: Verify lineage was recorded by execution, not declaration**

Run:
```bash
docker compose -f infra/docker-compose.yml exec -T db \
  psql -U webatlas -d webatlas -c \
  "SELECT dataset_id, description, tool FROM app.dataset_lineage_step ORDER BY ran_at"
```
Expected: exactly two rows for `demo`, one per stage, each with `tool = sql`. Two rows and not four confirms the second build wrote no steps.

- [ ] **Step 11: Run the whole suite to check for regressions**

Run: `npm run test:api && npm run test -w @webatlas/atlas-data && npm run test:shared`
Expected: all pass. `test:api` will show the basemap-dependent failures already known from PR #17 — those are unrelated to this plan and must not be "fixed" here.

- [ ] **Step 12: Commit**

```bash
git add packages/atlas-data package.json package-lock.json
git commit -m "feat(atlas-data): sổ đăng ký, CLI atlas:build/status, chứng minh trên một tập dữ liệu"
```

---

## What this plan deliberately leaves out

Each becomes its own plan, written against the API this one produces rather than a predicted one:

| Deferred | Why |
|---|---|
| `fetch-http`, `load-geojson`, `publish-geoserver`, `run` stages | Plan 2. The runner's `executeStage` throws a clear "not implemented yet" for each. |
| `atlas:verify`, `atlas:up` | Plan 3. Both need stage types this plan does not implement. |
| Migrating the 7 `SEED_LAYERS`, rivers, basemap, DEM, contours | Spec §7 steps 2–4, after Plan 2. |
| Dropping `basemap.dataset_sources` | Only safe once basemap datasets are registered — migration step 4. |
| Moving `apps/api/scripts` into the workspace | Migration step 4, with the scripts that use them. |
| Fixing the `apps/web/public` boundary violation | Migration step 2, with the dams descriptor. |
