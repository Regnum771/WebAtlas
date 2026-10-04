# Plan C-2: the `load-geojson` stage and its datasets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The registry loads the thematic data itself: `admin_boundaries`, the seven thematic layers and `rivers` become datasets built by a real `load-geojson` stage, keyed to file content, replacing the two `run` stages that wrap `npm run seed` and `npm run ingest:rivers`.

**Architecture:** A `load-geojson` stage names a layer and one or more GeoJSON files. The stage's input hash includes each file's sha256, so the registry notices an edited file. Its executor opens one transaction and calls a core function, `applyLoadGeojson`, which works on the caller's client: for a versioned layer it compares the content-derived `source` with the root of the layer's active version chain and either re-stamps administrative codes (unchanged content), refuses (steward edits on top, not superseded), or creates, loads and activates a new ingest version through `@webatlas/versioning`. For `admin_boundaries` it replaces the tables. `atlas:adopt` re-labels a machine's existing versions so nothing is reloaded.

**Tech Stack:** TypeScript 6, Node 22, `pg` 8, zod 3, Vitest 3, PostgreSQL 16 + PostGIS 3.4, `@webatlas/versioning`, `@webatlas/shared`.

**Spec:** `docs/superpowers/specs/2026-09-30-registry-steps-2-5-design.md` §10 "After step 5", §11, §12. Second of the three Plan C parts (C-1 `2026-10-04-plan-C1-versioning-package.md`; C-3 follows).

## Global Constraints

- Branch `feat/registry-plan-c2`, cut from `feat/registry-plan-c1` (PR #20, open). The PR targets `main`; until #20 merges it also shows C-1's commits.
- **The old commands keep working** until C-3 removes them: `npm run seed`, `npm run ingest:rivers -w @webatlas/api`, `npm run publish:geoserver`, and CI's `api` job, which runs the first two. They read the relocated files.
- Edit guard message, verbatim (spec §11): `<layer> has steward edits on top of its last load; loading new content would hide them. Re-run with --supersede-edits <layer> to proceed.`
- Version `source` format, verbatim (spec §11): `<file names joined by +>@sha256:<sha256 of the concatenated file hashes>`.
- `--supersede-edits` is parsed fail-closed, is separate from `--force`, and an id it names must be in the selected set (spec §11).
- No stage may write over steward edits unless that dataset is named in `--supersede-edits`. `--force` alone never does.
- `provinces-34.geojson` and `wards-region.geojson` stay in `apps/web/public` (the map loads them); `admin_boundaries` reads them there (spec §11, C-2).
- Database tests are gated on `DATABASE_URL` and must be shown to execute. They run the core inside a transaction they roll back, so they leave nothing behind.
- Commit messages are Vietnamese Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Baseline before this plan, dev stack: `test:api` 439, `test:versioning` 51, `test:shared` 118, atlas-data 321 passed and 26 skipped, `test:web` 543; `atlas:verify` 29 checks.

**Decisions this plan makes where the spec is silent or has moved on:**

1. *The dams attribution is already done.* `LEGEND_ATTRIBUTION.layer_dams` exists and is tested in `packages/shared` and `apps/web` (supervisor-feedback track). This plan only corrects the comment that names the file's old path.
2. *Stage shape.* The spec's file entry has `multiLine` only. Three layers need a single polygon wrapped as a MultiPolygon, so the entry also takes `multiPolygon`. A file entry also takes `root: 'repo'` for the two boundary files that live outside `data/`.
3. *Adoption count.* The spec compares a version's `feature_count` with "the file's feature count". For `rivers` the stored count includes the level-1 rivers the hierarchy derives, so adoption compares the files' features with the version's rows of level 2 and 3.
4. *Tests on real layers.* The spec says database tests use `__atlasdata_test__*` layers. The loader writes to `water.<layer>` and stamps through `@webatlas/versioning`, which accepts real layer keys only. The tests therefore use real layers inside a transaction that is always rolled back.
5. *The admin loader's column maps* go to `packages/shared` beside the others. `apps/api/src/db/seeds/adminBoundaries.ts` keeps its own copy until C-3 deletes it with the old `seed` command.

## File Structure

| File | Responsibility |
|---|---|
| `packages/atlas-data/src/types.ts`, `schema.ts` (modify) | The `load-geojson` stage shape and its validation |
| `packages/atlas-data/src/paths.ts` (modify) | `DATA_DIR`, `resolveStageFile` |
| `packages/atlas-data/src/fileHash.ts` (create) | sha256 of a stage's files; the version `source` string |
| `packages/atlas-data/src/state.ts` (modify) | Stage hashes include file hashes |
| `packages/atlas-data/data/seeds/*.geojson` (moved) | The committed seed files |
| `packages/atlas-data/src/stages/loadGeojson.ts` (create) | `applyLoadGeojson` (core, on a client) and `executeLoadGeojson` (transaction) |
| `packages/atlas-data/src/stages/loadGeojson.db.test.ts` (create) | The six behaviours of spec §12, against the database |
| `packages/atlas-data/src/cli/args.ts`, `select.ts`, `build.ts`, `up.ts`; `runner.ts`; `stages/index.ts` (modify) | `--supersede-edits` from the command line to the stage |
| `packages/atlas-data/src/adoptLegacy.ts` (create), `adopt.ts` (modify) | Re-label an existing machine's versions |
| `packages/atlas-data/src/descriptors/{adminBoundaries,layers,rivers}.ts` (create/modify), `seeds.ts` (delete), `index.ts` | The new dataset graph |
| `packages/shared/src/seed-columns.ts` (modify) | `ADMIN_PROVINCE_COLUMNS`, `ADMIN_WARD_COLUMNS` |
| `apps/api/src/db/seeds/*.ts`, `packages/atlas-data/tools/*` (modify) | Paths to the relocated files |
| `.github/workflows/ci.yml`, `README.md`, runbooks, architecture (modify) | Run and describe it |

---

### Task 1: The stage shape, file hashing, and hash-aware stage plans

**Files:**
- Modify: `packages/atlas-data/src/types.ts`, `schema.ts`, `paths.ts`, `state.ts`
- Create: `packages/atlas-data/src/fileHash.ts`, `packages/atlas-data/src/fileHash.test.ts`
- Modify tests: `schema.test.ts`, `state.test.ts`, `registry.test.ts`, `stages/index.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // types.ts
  export interface LoadGeojsonFile {
    /** Relative path: under packages/atlas-data/data by default, under the repo root when root is 'repo'. */
    file: string;
    root?: 'data' | 'repo';
    columns: ColumnMap;
    /** Non-versioned mode only: the schema-qualified table, e.g. 'admin.provinces'. */
    target?: string;
    multiLine?: boolean;
    multiPolygon?: boolean;
  }
  // Stage variant
  | { type: 'load-geojson'; layer: string; versioned: boolean; files: LoadGeojsonFile[]; legacySource?: string }

  // paths.ts
  export const DATA_DIR: string;                                   // packages/atlas-data/data
  export function resolveStageFile(f: { file: string; root?: 'data' | 'repo' }): string;

  // fileHash.ts
  export type FileHasher = (absolutePath: string) => string;      // sha256 hex
  export const sha256OfFile: FileHasher;
  export function stageFileHashes(stage: Extract<Stage, { type: 'load-geojson' }>, hash?: FileHasher): string[];
  export function versionSource(stage: Extract<Stage, { type: 'load-geojson' }>, hash?: FileHasher): string;

  // state.ts
  export function stageInputHash(stage: Stage, upstreamHashes: string[], hash?: FileHasher): string;
  export function stageHashPlan(orderedDatasets: Dataset[], hash?: FileHasher): Map<string, string[]>;
  ```
- `hash` defaults to `sha256OfFile`, so the four callers of `stageHashPlan` (`runner.ts`, `adopt.ts`, `status.ts`, `verify.ts`) need no change.

- [ ] **Step 1: Write the failing tests**

`packages/atlas-data/src/fileHash.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256OfFile, stageFileHashes, versionSource } from './fileHash';
import { resolveStageFile, DATA_DIR } from './paths';
import { REPO_ROOT } from './paths';
import type { Stage } from './types';

const dir = mkdtempSync(join(tmpdir(), 'file-hash-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stage = (files: Array<{ file: string }>): Extract<Stage, { type: 'load-geojson' }> => ({
  type: 'load-geojson', layer: 'rivers', versioned: true,
  files: files.map((f) => ({ ...f, columns: () => ({}) })),
});
const fake = (p: string) => `hash-of-${p.split(/[\\/]/).pop()}`;

describe('file hashing for load-geojson', () => {
  it('hashes file content, not its timestamp', () => {
    const f = join(dir, 'a.geojson');
    writeFileSync(f, '{"type":"FeatureCollection","features":[]}');
    const first = sha256OfFile(f);
    writeFileSync(f, '{"type":"FeatureCollection","features":[]}');
    expect(sha256OfFile(f)).toBe(first);
    expect(first).toBe(createHash('sha256').update('{"type":"FeatureCollection","features":[]}').digest('hex'));
  });

  it('fails with the path when a file is missing', () => {
    expect(() => sha256OfFile(join(dir, 'nope.geojson'))).toThrow(/nope\.geojson/);
  });

  it('resolves a stage file under data/ by default and under the repo root when asked', () => {
    expect(resolveStageFile({ file: 'seeds/dams.geojson' })).toBe(join(DATA_DIR, 'seeds', 'dams.geojson'));
    expect(resolveStageFile({ file: 'apps/web/public/provinces-34.geojson', root: 'repo' }))
      .toBe(join(REPO_ROOT, 'apps', 'web', 'public', 'provinces-34.geojson'));
  });

  it('hashes every file of a stage, in order', () => {
    expect(stageFileHashes(stage([{ file: 'seeds/a.geojson' }, { file: 'seeds/b.geojson' }]), fake))
      .toEqual(['hash-of-a.geojson', 'hash-of-b.geojson']);
  });

  it('builds the version source from the file names and the hash of their hashes', () => {
    const src = versionSource(stage([{ file: 'seeds/a.geojson' }, { file: 'seeds/b.geojson' }]), fake);
    const digest = createHash('sha256').update('hash-of-a.geojsonhash-of-b.geojson').digest('hex');
    expect(src).toBe(`a.geojson+b.geojson@sha256:${digest}`);
  });
});
```

In `packages/atlas-data/src/state.test.ts`, replace the test that builds two `load-geojson` stages differing only in `columns` (the one around line 42, using `{ type: 'load-geojson', file: 'f', table: 't', columns: … }`) with the new shape, and add two tests after it:

```ts
  it('hashes a load-geojson column mapping by its source text', () => {
    const mk = (columns: (p: Record<string, unknown>) => Record<string, unknown>): Stage => ({
      type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'seeds/f.geojson', columns }],
    });
    const same = () => 'h';
    expect(stageInputHash(mk((p) => ({ x: p.a })), [], same)).not.toBe(stageInputHash(mk((p) => ({ x: p.b })), [], same));
  });

  it('a load-geojson stage is stale when a file changes content, and only then', () => {
    const s: Stage = { type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'seeds/f.geojson', columns: () => ({}) }] };
    expect(stageInputHash(s, [], () => 'v1')).toBe(stageInputHash(s, [], () => 'v1'));
    expect(stageInputHash(s, [], () => 'v1')).not.toBe(stageInputHash(s, [], () => 'v2'));
  });

  it('other stage types never touch the file hasher', () => {
    const boom = () => { throw new Error('hashed a file'); };
    expect(() => stageInputHash({ type: 'sql', statement: 'SELECT 1' }, [], boom)).not.toThrow();
  });
```

In `packages/atlas-data/src/schema.test.ts`, replace the `load-geojson` line inside `'sql and load-geojson stages reject stray keys too'` and add a block:

```ts
  describe('load-geojson', () => {
    const base = { type: 'load-geojson' as const, layer: 'dams', versioned: true };
    const file = { file: 'seeds/dams.geojson', columns: () => ({}) };
    it('accepts a versioned layer with one file', () => {
      expect(() => defineDataset(withStage({ ...base, files: [file], legacySource: 'thuydienvietnam.geojson' }))).not.toThrow();
    });
    it('rejects no files, a stray key, and a path that leaves its root', () => {
      expect(() => defineDataset(withStage({ ...base, files: [] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [file], tabel: 't' } as never))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, file: '../x.geojson' }] }))).toThrow();
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, file: '/abs/x.geojson' }] }))).toThrow();
    });
    it('a versioned stage may not name a target table, and a non-versioned one must', () => {
      expect(() => defineDataset(withStage({ ...base, files: [{ ...file, target: 'admin.provinces' }] }))).toThrow(/target/);
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [file] }))).toThrow(/target/);
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [{ ...file, target: 'admin.provinces' }] }))).not.toThrow();
      expect(() => defineDataset(withStage({ ...base, layer: 'admin', versioned: false, files: [{ ...file, target: 'provinces; DROP' }] }))).toThrow();
    });
  });
```

(`withStage` is the helper already in that file. Replace the old stray-key `load-geojson` assertion with `expect(() => defineDataset(withStage({ type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'a.geojson', columns: () => ({}) }], c: 1 } as never))).toThrow();`.)

`registry.test.ts:63` and `stages/index.test.ts:15` use a `load-geojson` stage as "a type with no executor". After Task 3 every type has one, so in **this** task only change their stage literal to the new shape (`{ type: 'load-geojson', layer: 'dams', versioned: true, files: [{ file: 'f.geojson', columns: () => ({}) }] }`); Task 3 rewrites those two tests.

- [ ] **Step 2: Run to see them fail**

Run: `npm run test -w @webatlas/atlas-data`
Expected: `fileHash.test.ts` fails to import; the new schema and state tests fail to compile or assert.

- [ ] **Step 3: Implement**

`types.ts`: add the interface and replace the `load-geojson` variant:

```ts
/** One GeoJSON file of a load-geojson stage. */
export interface LoadGeojsonFile {
  /** Relative path: under packages/atlas-data/data by default, under the repo root when `root` is 'repo'. */
  file: string;
  root?: 'data' | 'repo';
  columns: ColumnMap;
  /** Non-versioned mode only: the schema-qualified table the file replaces, e.g. `admin.provinces`. */
  target?: string;
  /** Normalise a LineString or MultiLineString as MultiLineString. */
  multiLine?: boolean;
  /** Wrap a single Polygon as MultiPolygon. */
  multiPolygon?: boolean;
}
```

```ts
  | {
      type: 'load-geojson';
      /** The editable layer key (its table is `water.<layer>`), or a label for a non-versioned load. */
      layer: string;
      /** true: one ingest version per content (spec §11). false: the target tables are replaced. */
      versioned: boolean;
      files: LoadGeojsonFile[];
      /** The `source` string the old seed command wrote, so atlas:adopt can re-label that version. */
      legacySource?: string;
    }
```

`paths.ts`, append:

```ts
/** Committed inputs (data/seeds) and git-ignored downloads (data/cache). */
export const DATA_DIR = join(PACKAGE_ROOT, 'data');

/** Where a load-geojson file lives: under data/ unless the stage says it is repo-relative. */
export function resolveStageFile(f: { file: string; root?: 'data' | 'repo' }): string {
  return join(f.root === 'repo' ? REPO_ROOT : DATA_DIR, ...f.file.split('/'));
}
```

`fileHash.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Stage } from './types';
import { resolveStageFile } from './paths';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

/** sha256 of a file's content, hex. Injected wherever stage hashes are planned, so tests need no files. */
export type FileHasher = (absolutePath: string) => string;

export const sha256OfFile: FileHasher = (absolutePath) => {
  let content: Buffer;
  try {
    content = readFileSync(absolutePath);
  } catch (err) {
    throw new Error(`load-geojson: cannot read ${absolutePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return createHash('sha256').update(content).digest('hex');
};

/** The content hash of each file of the stage, in the stage's order. */
export function stageFileHashes(stage: LoadStage, hash: FileHasher = sha256OfFile): string[] {
  return stage.files.map((f) => hash(resolveStageFile(f)));
}

/**
 * The `source` recorded on the ingest version: file names joined by `+`, then the sha256 of the
 * concatenated file hashes (spec §11). Two loads of the same bytes get the same source, which is
 * how an unchanged file creates no version.
 */
export function versionSource(stage: LoadStage, hash: FileHasher = sha256OfFile): string {
  const names = stage.files.map((f) => basename(f.file)).join('+');
  const digest = createHash('sha256').update(stageFileHashes(stage, hash).join('')).digest('hex');
  return `${names}@sha256:${digest}`;
}
```

`state.ts`: import `import { sha256OfFile, stageFileHashes, type FileHasher } from './fileHash';`, and change the two functions:

```ts
export function stageInputHash(stage: Stage, upstreamHashes: string[], hash: FileHasher = sha256OfFile): string {
  const payload = JSON.stringify({
    stage: canonical(stage),
    // A load-geojson stage is its configuration plus the bytes it loads: editing a file must make
    // it stale, and touching a file without changing it must not (spec §11).
    ...(stage.type === 'load-geojson' ? { files: stageFileHashes(stage, hash) } : {}),
    upstream: [...upstreamHashes].sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}
```

`stageHashPlan(orderedDatasets: Dataset[], hash: FileHasher = sha256OfFile)`, passing `hash` to `stageInputHash(stage, inputs, hash)`. Update its doc comment: it is no longer pure; it reads the files of `load-geojson` stages, once per call.

`schema.ts`: add a path check beside `cacheRelativePath` and replace the `load-geojson` variant:

```ts
/** A relative path with no `..` segment, under whichever root the stage names. */
const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) => !posix.isAbsolute(p) && !win32.isAbsolute(p) && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..'),
    'must be a relative path with no ".." segment'
  );

const loadGeojsonFile = z
  .object({
    file: relativePath,
    root: z.enum(['data', 'repo']).optional(),
    columns: z.function(),
    // Interpolated into SQL by the non-versioned loader: schema.table, lower-case identifiers only.
    target: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/).optional(),
    multiLine: z.boolean().optional(),
    multiPolygon: z.boolean().optional(),
  })
  .strict();
```

```ts
  z
    .object({
      type: z.literal('load-geojson'),
      // Interpolated into SQL as water.<layer>: a lower-case identifier.
      layer: z.string().regex(/^[a-z_][a-z0-9_]*$/),
      versioned: z.boolean(),
      files: z.array(loadGeojsonFile).min(1),
      legacySource: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((s, ctx) => {
      for (const [i, f] of s.files.entries()) {
        if (s.versioned && f.target !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['files', i, 'target'], message: 'target is for a non-versioned load; a versioned layer loads into water.<layer>' });
        }
        if (!s.versioned && f.target === undefined) {
          ctx.addIssue({ code: 'custom', path: ['files', i, 'target'], message: 'a non-versioned load must name its target table' });
        }
      }
    }),
```

`z.discriminatedUnion` does not accept a `superRefine`d member in zod 3. If it rejects it, move the two target rules out of the stage variant and into a `superRefine` on `datasetSchema` that walks `d.stages`, keeping the same messages and paths (`['stages', stageIndex, 'files', i, 'target']`).

- [ ] **Step 4: Run and commit**

Run: `npm run test -w @webatlas/atlas-data`, `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`
Expected: all pass; the count rises by the new tests. `npm run atlas:status` still shows every dataset `ok` (no descriptor uses the stage yet).

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): stage load-geojson — hình dạng mới và băm theo nội dung tệp

Stage nêu lớp và một hay nhiều tệp GeoJSON. Hash đầu vào của stage gồm
sha256 của từng tệp, nên sửa tệp thì stage thành cũ, còn chạm vào tệp mà
không đổi nội dung thì không.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Relocate the seed data

**Files:**
- Move: `apps/api/src/db/seeds/data/*.geojson` (ten files) → `packages/atlas-data/data/seeds/`
- Move: `apps/web/public/thuydienvietnam.geojson` → `packages/atlas-data/data/seeds/dams.geojson`
- Modify (paths): `apps/api/src/db/seeds/registry.ts`, `ingestRivers.ts`, `ingestReaches.ts`, and any API test that reads a seed file
- Modify (paths): `packages/atlas-data/tools/build-osm-seeds.mjs`, `clip-to-region.mjs`, `report-dam-crosscheck.mjs`, `prep-hydrosheds.sh`, `prep_hydrosheds.py`
- Modify: `packages/shared/src/legend.ts` (comment), `README.md`, `docs/runbooks/README.md`, `.gitignore`

**Interfaces:**
- Produces: `packages/atlas-data/data/seeds/{dams,stations,flood_zones,drought_points,saltwater_intrusion,flood_generation,osm-lakes-region,osm-rivers-region,hydrorivers-region,hydrorivers-vn,hydrolakes-vn}.geojson`. Task 5's descriptors name them as `seeds/<name>.geojson`.
- The version `source` strings the old commands write do **not** change (`'thuydienvietnam.geojson'` stays the dams source): Task 4's adoption matches on them.

- [ ] **Step 1: Move the files**

```bash
mkdir -p packages/atlas-data/data/seeds
for f in drought_points flood_generation flood_zones hydrolakes-vn hydrorivers-region hydrorivers-vn osm-lakes-region osm-rivers-region saltwater_intrusion stations; do
  git mv "apps/api/src/db/seeds/data/$f.geojson" "packages/atlas-data/data/seeds/$f.geojson"
done
git mv apps/web/public/thuydienvietnam.geojson packages/atlas-data/data/seeds/dams.geojson
git check-ignore -v packages/atlas-data/data/seeds/dams.geojson; echo "ignored? $?"   # expect exit 1: not ignored
```

- [ ] **Step 2: Point everything at the new location**

`apps/api/src/db/seeds/registry.ts`: replace the three path constants with

```ts
// apps/api/src/db/seeds -> repo root is five levels up. The seed files live with the dataset
// pipeline since Plan C-2; this command reads them there until C-3 removes it.
const repoRoot = resolve(here, '../../../../..');
const seedData = resolve(repoRoot, 'packages/atlas-data/data/seeds');
```

and the dams entry's `file` with `resolve(seedData, 'dams.geojson')` (its `source: 'thuydienvietnam.geojson'` stays, with a comment: `// The file was renamed dams.geojson; the source string is what existing versions carry.`). Delete the now-unused `webPublic`.

`ingestRivers.ts` and `ingestReaches.ts`: replace `resolvePath(here, 'data/osm-rivers-region.geojson')` and `resolvePath(here, 'data/hydrorivers-region.geojson')` with `resolvePath(here, '../../../../../packages/atlas-data/data/seeds/<name>.geojson')`.

Tools:

| File | Old | New |
|---|---|---|
| `build-osm-seeds.mjs:17` | `path.join(repoRoot, 'apps/api/src/db/seeds/data')` | `path.join(repoRoot, 'packages/atlas-data/data/seeds')` |
| `clip-to-region.mjs:16` | same | same |
| `clip-to-region.mjs:33` | `path.join(repoRoot, 'apps/web/public/thuydienvietnam.geojson')` | `path.join(dataDir, 'dams.geojson')` |
| `report-dam-crosscheck.mjs:44` | `'apps/web/public/thuydienvietnam.geojson'` | `'packages/atlas-data/data/seeds/dams.geojson'` |
| `prep-hydrosheds.sh:23` | `OUT="$SCRIPT_DIR/../src/db/seeds/data"` (already stale since Plan B moved the script) | `OUT="$SCRIPT_DIR/../data/seeds"` |
| `prep_hydrosheds.py:96` | comment naming `apps/api/src/db/seeds/data/` | `packages/atlas-data/data/seeds/` |

Then find the rest:

Run: `grep -rn "db/seeds/data\|thuydienvietnam" apps packages docs/runbooks README.md .gitignore --include=* 2>/dev/null | grep -v node_modules | grep -v "docs/superpowers/"`
Expected after editing: only the `source: 'thuydienvietnam.geojson'` line, its comment, `seed.test.ts`'s assertion on that source, and the `legacySource` Task 5 adds. For every other hit: a test that reads a seed file gets the new path; README and runbook text gets the new path; `.gitignore`'s `apps/api/src/db/seeds/data/dem/` line and its comment are deleted (the directory is gone).

`packages/shared/src/legend.ts`: in the comment above `ODV_CC_BY_SA`, replace `apps/web/public/thuydienvietnam.geojson` with `packages/atlas-data/data/seeds/dams.geojson`. Run `npm run build:shared`; a comment-only change leaves `dist/*.js` unchanged and may touch nothing.

- [ ] **Step 3: Verify the old commands still work**

Run: `npx tsc -p apps/api/tsconfig.json --noEmit`, then `npm run test:api`, `npm run build:web`
Expected: no type errors; 439 pass (`seed.test.ts` and `integration.test.ts` run the full seed and river ingest from the new location); the web app builds without the dams file in `public`.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api/src/db/seeds apps/web/public packages/atlas-data packages/shared/src/legend.ts README.md docs/runbooks .gitignore
git status --short   # eleven renames (R), the path edits, nothing else
git commit -m "refactor: dữ liệu seed chuyển về packages/atlas-data/data/seeds

Mười tệp từ apps/api/src/db/seeds/data và tệp đập từ apps/web/public
(đổi tên thành dams.geojson; ứng dụng web không nạp tệp này). Lệnh seed
cũ và các script chuẩn bị dữ liệu đọc ở vị trí mới. Chuỗi source ghi trên
phiên bản không đổi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The loader

**Files:**
- Create: `packages/atlas-data/src/stages/loadGeojson.ts`, `packages/atlas-data/src/stages/loadGeojson.db.test.ts`
- Modify: `packages/atlas-data/src/stages/index.ts`, `packages/atlas-data/package.json` (dependency), `packages/atlas-data/src/registry.test.ts`, `stages/index.test.ts`
- Modify: `packages/shared/src/seed-columns.ts`, `seed-columns.test.ts` (admin maps); rebuild `packages/shared/dist`

**Interfaces:**
- Consumes: `versionsService`, `stampAdminCodes`, `loadFeatures` from `@webatlas/versioning`; `resolveStageFile`, `sha256OfFile`, `versionSource` from Task 1.
- Produces:

  ```ts
  // stages/index.ts — StageContext gains one field
  /** True when the dataset was named in --supersede-edits: a load may replace steward edits. */
  supersedeEdits: boolean;

  // stages/loadGeojson.ts
  export interface LoadOutcome { action: 'loaded' | 'restamped' | 'replaced'; summary: string; versionId?: string }
  export interface ResolvedLoad {
    layer: string; versioned: boolean; source: string;
    files: Array<{ path: string; columns: ColumnMap; target?: string; multiLine?: boolean; multiPolygon?: boolean }>;
  }
  export function resolveLoad(stage: Extract<Stage, { type: 'load-geojson' }>): ResolvedLoad;
  /** On the caller's client, inside the caller's transaction. */
  export function applyLoadGeojson(pool: Pool, client: PoolClient, load: ResolvedLoad, opts: { supersedeEdits: boolean }): Promise<LoadOutcome>;
  export const executeLoadGeojson: Executor<'load-geojson'>;   // BEGIN … COMMIT around applyLoadGeojson
  ```
- C-3's `ensureSeeded` calls `resolveLoad` + `executeLoadGeojson`. Task 4's adoption uses `resolveLoad`.

- [ ] **Step 1: Add the admin column maps to shared (test first)**

Append to `packages/shared/src/seed-columns.test.ts`, inside the `describe`:

```ts
  it('map a province and a ward from the boundary files, coercing codes to text', () => {
    expect(ADMIN_PROVINCE_COLUMNS({ code: 66, name: 'Đắk Lắk', nameEn: 'Dak Lak', fullName: 'Tỉnh Đắk Lắk', areaKm2: 18096.4 }, 0))
      .toEqual({ code: '66', name: 'Đắk Lắk', name_en: 'Dak Lak', full_name: 'Tỉnh Đắk Lắk', area_km2: 18096.4 });
    expect(ADMIN_PROVINCE_COLUMNS({ code: '01', name: 'Hà Nội' }, 0))
      .toEqual({ code: '01', name: 'Hà Nội', name_en: null, full_name: null, area_km2: null });
    expect(ADMIN_WARD_COLUMNS({ code: 24133, provinceCode: 66, name: 'Buôn Ma Thuột' }, 0))
      .toEqual({ code: '24133', province_code: '66', name: 'Buôn Ma Thuột', name_en: null, full_name: null, area_km2: null });
  });
```

and add `ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS` to that file's import from `./seed-columns`. Run `npm run test:shared`: it fails (not exported). Then append to `packages/shared/src/seed-columns.ts`:

```ts
/**
 * The administrative boundaries, from the same two files the browser loads
 * (apps/web/public/provinces-34.geojson, wards-region.geojson). Codes are text: '01' is not 1.
 */
export const ADMIN_PROVINCE_COLUMNS: ColumnMap = (p) => ({
  code: String(p.code),
  name: String(p.name),
  name_en: p.nameEn ?? null,
  full_name: p.fullName ?? null,
  area_km2: p.areaKm2 ?? null,
});

export const ADMIN_WARD_COLUMNS: ColumnMap = (p) => ({
  code: String(p.code),
  province_code: String(p.provinceCode),
  name: String(p.name),
  name_en: p.nameEn ?? null,
  full_name: p.fullName ?? null,
  area_km2: p.areaKm2 ?? null,
});
```

Run `npm run test:shared` (119 pass), `npm run build:shared`, and stage `packages/shared/dist/seed-columns.{js,d.ts}` with `git add -f`.

- [ ] **Step 2: Write the failing loader tests**

In `packages/atlas-data/package.json`, add `"@webatlas/versioning": "*"` and `"@webatlas/shared": "*"` to `dependencies` (shared is already imported; declare it), then `npm install`.

`packages/atlas-data/src/stages/loadGeojson.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { versionsService } from '@webatlas/versioning';
import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS, ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS } from '@webatlas/shared';
import { applyLoadGeojson, type ResolvedLoad } from './loadGeojson';
import { resolveStageFile } from '../paths';

/**
 * The loader against a real database, on real layers. Every test runs the core inside a
 * transaction and ROLLS IT BACK, so no version, feature or boundary row outlives it. (The spec
 * asks for synthetic `__atlasdata_test__` layers; the loader stamps through @webatlas/versioning,
 * which accepts real layer keys only, so rollback is the isolation instead.)
 */
const DB = process.env.DATABASE_URL;
const dir = mkdtempSync(join(tmpdir(), 'load-geojson-'));
let pool: pg.Pool;

beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await pool?.end();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A two-station load whose content, and so whose source, is determined by `tag`. */
function stations(tag: string): ResolvedLoad {
  const body = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: `${tag}-1`, name: 'Buôn Ma Thuột' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: `${tag}-2`, name: 'Đà Lạt' } },
    ],
  });
  const path = join(dir, `stations-${tag}.geojson`);
  writeFileSync(path, body);
  return {
    layer: 'stations', versioned: true, source: `stations.geojson@sha256:${sha(sha(body))}`,
    files: [{ path, columns: (p) => ({ external_id: p.id, name: p.name }) }],
  };
}

async function inRollback<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const versionCount = async (c: pg.PoolClient, layer: string) =>
  Number((await c.query(`SELECT count(*)::text AS n FROM app.dataset_versions WHERE layer_key = $1`, [layer])).rows[0].n);
const active = async (c: pg.PoolClient, layer: string) =>
  (await c.query<{ id: string; kind: string; source: string; feature_count: number | null }>(
    `SELECT id, kind, source, feature_count FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer])).rows[0];

describe.skipIf(!DB)('load-geojson against the database', () => {
  it('loads new content as one active ingest version, stamped and counted', async () => {
    await inRollback(async (c) => {
      const before = await versionCount(c, 'stations');
      const load = stations('a');
      const out = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(out.action).toBe('loaded');
      expect(out.summary).toMatch(/2 features/);
      expect(await versionCount(c, 'stations')).toBe(before + 1);
      const v = await active(c, 'stations');
      expect(v).toMatchObject({ id: out.versionId, kind: 'ingest', source: load.source, feature_count: 2 });
      const { rows } = await c.query<{ p: string[] }>(
        `SELECT province_codes AS p FROM water.stations WHERE dataset_version_id = $1 ORDER BY external_id`, [v.id]);
      // Stamped by activate(): both points are inside the six provinces.
      expect(rows.every((r) => r.p.length === 1)).toBe(true);
    });
  });

  it('content idempotency: the same content creates no version and re-stamps the active chain', async () => {
    await inRollback(async (c) => {
      const load = stations('a');
      const first = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      const before = await versionCount(c, 'stations');
      // Wipe the codes so a re-stamp is observable.
      await c.query(`UPDATE water.stations SET province_codes = '{}' WHERE dataset_version_id = $1`, [first.versionId]);
      const again = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(again.action).toBe('restamped');
      expect(await versionCount(c, 'stations')).toBe(before);
      expect((await active(c, 'stations')).id).toBe(first.versionId);
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM water.stations WHERE dataset_version_id = $1 AND province_codes <> '{}'`, [first.versionId]);
      expect(Number(rows[0].n)).toBe(2);
    });
  });

  it('the edit guard: new content over steward edits fails, naming the flag', async () => {
    await inRollback(async (c) => {
      await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const svc = versionsService(pool);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      expect((await active(c, 'stations')).kind).toBe('edit');
      const before = await versionCount(c, 'stations');
      await expect(applyLoadGeojson(pool, c, stations('b'), { supersedeEdits: false })).rejects.toThrow(
        'stations has steward edits on top of its last load; loading new content would hide them. Re-run with --supersede-edits stations to proceed.'
      );
      expect(await versionCount(c, 'stations')).toBe(before);
      expect((await active(c, 'stations')).id).toBe(draft);
    });
  });

  it('unchanged content under steward edits re-stamps the whole chain and leaves the edits active', async () => {
    await inRollback(async (c) => {
      const load = stations('a');
      const root = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      const svc = versionsService(pool);
      const draft = await svc.openEditDraft(c, 'stations');
      await svc.commitEditDraft(c, 'stations', draft);
      const out = await applyLoadGeojson(pool, c, load, { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      expect(out.summary).toMatch(/2 versions/);
      expect((await active(c, 'stations')).id).toBe(draft);
      expect(root.versionId).not.toBe(draft);
    });
  });

  it('--supersede-edits loads the new content over the edits', async () => {
    await inRollback(async (c) => {
      await applyLoadGeojson(pool, c, stations('a'), { supersedeEdits: false });
      const svc = versionsService(pool);
      await svc.commitEditDraft(c, 'stations', await svc.openEditDraft(c, 'stations'));
      const next = stations('b');
      const out = await applyLoadGeojson(pool, c, next, { supersedeEdits: true });
      expect(out.action).toBe('loaded');
      expect(await active(c, 'stations')).toMatchObject({ kind: 'ingest', source: next.source });
    });
  });

  it('loads the two river files into one version; activation builds the hierarchy and passes the gates', async () => {
    await inRollback(async (c) => {
      const ways = resolveStageFile({ file: 'seeds/osm-rivers-region.geojson' });
      const reaches = resolveStageFile({ file: 'seeds/hydrorivers-region.geojson' });
      const out = await applyLoadGeojson(pool, c, {
        layer: 'rivers', versioned: true, source: 'osm-rivers-region.geojson+hydrorivers-region.geojson@sha256:test',
        files: [
          { path: ways, columns: RIVER_WAY_COLUMNS, multiLine: true },
          { path: reaches, columns: RIVER_REACH_COLUMNS, multiLine: true },
        ],
      }, { supersedeEdits: true });
      expect(out.action).toBe('loaded');
      const { rows } = await c.query<{ level: number; n: string }>(
        `SELECT feature_level AS level, count(*)::text AS n FROM water.rivers WHERE dataset_version_id = $1 GROUP BY 1 ORDER BY 1`,
        [out.versionId]);
      expect(rows.map((r) => [r.level, Number(r.n)])).toEqual([[1, 588], [2, 13045], [3, 9486]]);
      // feature_count is taken after activation, so it includes the derived level-1 rivers.
      expect((await active(c, 'rivers')).feature_count).toBe(588 + 13045 + 9486);
    });
  }, 600_000);

  it('non-versioned mode replaces the target tables', async () => {
    await inRollback(async (c) => {
      // A sentinel proves replacement, not upsert.
      await c.query(
        `INSERT INTO admin.provinces (code, name, geom)
         VALUES ('zz', 'sentinel', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,0 0))'), 4326)))`);
      const out = await applyLoadGeojson(pool, c, {
        layer: 'admin', versioned: false, source: 'unused',
        files: [
          { path: resolveStageFile({ file: 'apps/web/public/provinces-34.geojson', root: 'repo' }), columns: ADMIN_PROVINCE_COLUMNS, target: 'admin.provinces', multiPolygon: true },
          { path: resolveStageFile({ file: 'apps/web/public/wards-region.geojson', root: 'repo' }), columns: ADMIN_WARD_COLUMNS, target: 'admin.wards', multiPolygon: true },
        ],
      }, { supersedeEdits: false });
      expect(out.action).toBe('replaced');
      const p = await c.query<{ n: string; z: string }>(
        `SELECT count(*)::text AS n, count(*) FILTER (WHERE code = 'zz')::text AS z FROM admin.provinces`);
      expect([Number(p.rows[0].n), Number(p.rows[0].z)]).toEqual([34, 0]);
      const w = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM admin.wards`);
      expect(Number(w.rows[0].n)).toBeGreaterThan(0);
      expect(out.summary).toMatch(/admin\.provinces 34/);
    });
  }, 120_000);
});
```

Run: `DATABASE_URL=… npx vitest run src/stages/loadGeojson.db.test.ts` from `packages/atlas-data` (take `DATABASE_URL` from `apps/api/.env`; never echo it)
Expected: FAIL, cannot import `./loadGeojson`. Confirm the output says the suite ran, not that it was skipped.

- [ ] **Step 3: Implement the loader**

`packages/atlas-data/src/stages/loadGeojson.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import { EDITABLE_LAYER_KEYS, type ColumnMap, type EditableLayerKey } from '@webatlas/shared';
import { loadFeatures, stampAdminCodes, versionsService } from '@webatlas/versioning';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { resolveStageFile } from '../paths';
import { versionSource } from '../fileHash';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

/** A load-geojson stage with its files resolved to absolute paths and its content source computed. */
export interface ResolvedLoad {
  layer: string;
  versioned: boolean;
  /** `<file names>@sha256:<hash of the file hashes>` (spec §11). Unused in non-versioned mode. */
  source: string;
  files: Array<{ path: string; columns: ColumnMap; target?: string; multiLine?: boolean; multiPolygon?: boolean }>;
}

export interface LoadOutcome {
  /** loaded: a new ingest version. restamped: unchanged content. replaced: non-versioned tables. */
  action: 'loaded' | 'restamped' | 'replaced';
  summary: string;
  /** The active chain's root after the call (versioned mode). */
  versionId?: string;
}

export function resolveLoad(stage: LoadStage): ResolvedLoad {
  return {
    layer: stage.layer,
    versioned: stage.versioned,
    source: versionSource(stage),
    files: stage.files.map((f) => ({
      path: resolveStageFile(f),
      columns: f.columns,
      target: f.target,
      multiLine: f.multiLine,
      multiPolygon: f.multiPolygon,
    })),
  };
}

const isEditable = (layer: string): layer is EditableLayerKey =>
  (EDITABLE_LAYER_KEYS as readonly string[]).includes(layer);

/** The layer's active version and its chain down to the root ingest, nearest first. On `client`. */
async function activeChain(
  client: PoolClient,
  layer: string
): Promise<Array<{ id: string; kind: string; source: string }>> {
  const { rows } = await client.query<{ id: string; kind: string; source: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, kind, source, parent_version_id, 0 AS depth
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       UNION ALL
       SELECT v.id, v.kind, v.source, v.parent_version_id, c.depth + 1
         FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
     )
     SELECT id, kind, source FROM chain ORDER BY depth`,
    [layer]
  );
  return rows;
}

async function loadVersioned(
  pool: Pool,
  client: PoolClient,
  load: ResolvedLoad,
  opts: { supersedeEdits: boolean }
): Promise<LoadOutcome> {
  const chain = await activeChain(client, load.layer);
  const root = chain[chain.length - 1];

  // Unchanged content: the active chain already rests on this exact load. Create nothing, activate
  // nothing; but the boundaries may have changed (they are upstream of every layer), so every
  // version of the chain gets its administrative codes again (spec C-5).
  if (root && root.kind === 'ingest' && root.source === load.source) {
    if (isEditable(load.layer)) {
      for (const v of chain) await stampAdminCodes(client, load.layer, v.id);
    }
    return {
      action: 'restamped',
      versionId: root.id,
      summary: `${load.layer}: content unchanged; re-stamped ${chain.length} version${chain.length === 1 ? '' : 's'}`,
    };
  }

  // New content. Edits sit on top of the previous load: replacing it would hide them, and nothing
  // replays them yet. Only an explicit --supersede-edits may do that; --force never does.
  if (chain[0]?.kind === 'edit' && !opts.supersedeEdits) {
    throw new Error(
      `${load.layer} has steward edits on top of its last load; loading new content would hide them. ` +
        `Re-run with --supersede-edits ${load.layer} to proceed.`
    );
  }

  const versions = versionsService(pool);
  const versionId = await versions.createIngestVersion(client, { layerKey: load.layer, source: load.source });
  for (const f of load.files) {
    await loadFeatures(
      client,
      { table: load.layer, file: f.path, columns: f.columns, multiLine: f.multiLine, multiPolygon: f.multiPolygon },
      versionId
    );
  }
  // activate() owns the layer's obligations: river hierarchy and gates, then administrative codes.
  await versions.activate(client, load.layer, versionId);
  // Counted after activation: for rivers it inserts the derived level-1 rows into this version.
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.${load.layer} WHERE dataset_version_id = $1`,
    [versionId]
  );
  await client.query(`UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`, [rows[0].n, versionId]);
  return {
    action: 'loaded',
    versionId,
    summary: `${load.layer}: ${rows[0].n} features in a new version from ${load.source}`,
  };
}

/** Insert every feature of `file` into `target` (schema.table, validated by the descriptor schema). */
async function insertPlain(
  client: PoolClient,
  target: string,
  f: ResolvedLoad['files'][number]
): Promise<number> {
  const fc = JSON.parse(readFileSync(f.path, 'utf8')) as {
    features: Array<{ geometry: unknown; properties: Record<string, unknown> }>;
  };
  const base = 'ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)';
  const geom = f.multiLine || f.multiPolygon ? `ST_Multi(${base})` : base;
  for (const [index, feature] of fc.features.entries()) {
    const cols = f.columns(feature.properties, index);
    const names = Object.keys(cols);
    await client.query(
      `INSERT INTO ${target} (${names.join(', ')}, geom)
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, ${geom.replace('$GEOM', `$${names.length + 1}`)})`,
      [...Object.values(cols), JSON.stringify(feature.geometry)]
    );
  }
  return fc.features.length;
}

/**
 * Non-versioned: the target tables are a closed set, so they are replaced, not upserted — a unit
 * dropped from the source must disappear. Deleted in reverse file order (wards reference provinces
 * with ON DELETE RESTRICT), loaded in file order.
 */
async function loadReplacing(client: PoolClient, load: ResolvedLoad): Promise<LoadOutcome> {
  for (const f of [...load.files].reverse()) await client.query(`DELETE FROM ${f.target}`);
  const parts: string[] = [];
  for (const f of load.files) parts.push(`${f.target} ${await insertPlain(client, f.target!, f)}`);
  return { action: 'replaced', summary: `${load.layer}: replaced ${parts.join(', ')}` };
}

/**
 * The load itself, on the caller's client and inside the caller's transaction: every read is on
 * that client, so a caller (the stage below, or a test that rolls back) sees one consistent state.
 */
export async function applyLoadGeojson(
  pool: Pool,
  client: PoolClient,
  load: ResolvedLoad,
  opts: { supersedeEdits: boolean }
): Promise<LoadOutcome> {
  return load.versioned ? loadVersioned(pool, client, load, opts) : loadReplacing(client, load);
}

/** The stage: one transaction on one client around the load (spec §11). */
export async function executeLoadGeojson(pool: Pool, stage: LoadStage, ctx: StageContext): Promise<StageResult> {
  const load = resolveLoad(stage);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await applyLoadGeojson(pool, client, load, { supersedeEdits: ctx.supersedeEdits });
    await client.query('COMMIT');
    ctx.log(outcome.summary);
    return { summary: outcome.summary };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

`stages/index.ts`: add `supersedeEdits: boolean;` to `StageContext` with the doc comment from Interfaces, import `executeLoadGeojson`, and add `'load-geojson': executeLoadGeojson,` to `EXECUTORS`. Every literal `StageContext` in the tests gains `supersedeEdits: false`; the compiler names them.

`runner.ts`, for now: pass `supersedeEdits: false` in the `executeStage` context (Task 4 wires the flag).

`registry.test.ts` and `stages/index.test.ts`: the "no executor" tests need a type that has none. Replace their stage literal with `{ type: 'no-such-stage' } as unknown as Stage` and the expected message with `/no-such-stage.*no executor/s` (registry) and `/"no-such-stage" has no executor/` (stages). `validateRegistry` runs the schema first, which would reject the unknown type: in `registry.test.ts` assert `toThrow(/bad-no-executor/)` only, since either the schema or the executor check may reject it first, and add a direct test in `stages/index.test.ts` that `hasExecutor('load-geojson')` is true.

- [ ] **Step 4: Run the loader tests**

Run: `DATABASE_URL=… npx vitest run src/stages/loadGeojson.db.test.ts` from `packages/atlas-data`
Expected: 7 tests pass. The rivers test takes about a minute.

Then confirm nothing was left behind:

```bash
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions; SELECT count(*) FROM admin.provinces WHERE code = 'zz'"
```

Expected: the version count is what it was before the run (198 on 2026-10-04) and the sentinel count is 0.

- [ ] **Step 5: Run everything and commit**

Run: `npm run test -w @webatlas/atlas-data`, `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`, `npm run test:shared`
Expected: all pass (the database tests skip here, with no `DATABASE_URL`).

```bash
git add packages/atlas-data packages/shared/src package-lock.json
git add -f packages/shared/dist/seed-columns.js packages/shared/dist/seed-columns.d.ts
git commit -m "feat(atlas-data): bộ nạp load-geojson — phiên bản theo nội dung, đóng dấu lại, chặn ghi đè chỉnh sửa

Nội dung không đổi thì không tạo phiên bản nào, chỉ đóng dấu lại mã hành
chính cho cả chuỗi đang hoạt động. Nội dung mới mà lớp đang có chỉnh sửa
của người quản lý thì dừng, trừ khi có --supersede-edits. Chế độ không
phiên bản thay toàn bộ bảng đích (ranh giới hành chính). Lõi chạy trên
client và transaction của người gọi.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `--supersede-edits`, and adopting an existing machine

**Files:**
- Modify: `packages/atlas-data/src/cli/args.ts`, `args.test.ts`, `select.ts`, `select.test.ts`, `build.ts`, `up.ts`
- Modify: `packages/atlas-data/src/runner.ts`, `runner.test.ts`
- Create: `packages/atlas-data/src/adoptLegacy.ts`, `packages/atlas-data/src/adoptLegacy.db.test.ts`
- Modify: `packages/atlas-data/src/adopt.ts`, `adopt.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // cli/args.ts
  export interface BuildArgs { only: string[]; except: string[]; force: string[]; supersedeEdits: string[] }
  // cli/select.ts
  export function assertSupersedeSelected(ids: string[], all: Dataset[], selected: Dataset[]): void;
  // runner.ts
  export interface BuildOptions { …; /** Dataset ids whose load may replace steward edits. */ supersedeEdits?: string[] }
  // adoptLegacy.ts
  export type LegacyAdoption =
    | { result: 'current' }                 // the active chain already rests on this content
    | { result: 'relabelled'; versionId: string }
    | { result: 'mismatch'; detail: string };
  export function adoptLegacySource(client: PoolClient, stage: Extract<Stage, { type: 'load-geojson' }>, load: ResolvedLoad): Promise<LegacyAdoption>;
  // adopt.ts
  export type AdoptResult = 'adopted' | 'has-state' | 'no-probe' | 'probe-failed' | 'needs-build';
  ```

- [ ] **Step 1: Write the failing tests**

`args.test.ts`, add:

```ts
  describe('--supersede-edits', () => {
    it('parses a list, in either form', () => {
      expect(parseBuildArgs(['--supersede-edits', 'dams,lakes']).supersedeEdits).toEqual(['dams', 'lakes']);
      expect(parseBuildArgs(['--supersede-edits=rivers']).supersedeEdits).toEqual(['rivers']);
      expect(parseBuildArgs([]).supersedeEdits).toEqual([]);
    });
    it('fails closed: no value, an empty id, given twice', () => {
      expect(() => parseBuildArgs(['--supersede-edits'])).toThrow(/requires a value/);
      expect(() => parseBuildArgs(['--supersede-edits', '--force', 'dams'])).toThrow(/requires a value/);
      expect(() => parseBuildArgs(['--supersede-edits', 'dams,,lakes'])).toThrow(/empty dataset id/);
      expect(() => parseBuildArgs(['--supersede-edits', 'a', '--supersede-edits', 'b'])).toThrow(/more than once/);
    });
    it('is not implied by --force', () => {
      expect(parseBuildArgs(['--force', 'dams']).supersedeEdits).toEqual([]);
    });
  });
```

`select.test.ts`, add (with `ds` being that file's dataset helper):

```ts
  describe('assertSupersedeSelected', () => {
    const all = [ds('admin_boundaries'), ds('dams', ['admin_boundaries']), ds('lakes', ['admin_boundaries'])];
    it('accepts ids that are registered and selected', () => {
      expect(() => assertSupersedeSelected(['dams'], all, all)).not.toThrow();
    });
    it('rejects an unknown id and one that --only or --except removed', () => {
      expect(() => assertSupersedeSelected(['damz'], all, all)).toThrow(/--supersede-edits names unknown dataset "damz"/);
      expect(() => assertSupersedeSelected(['lakes'], all, [all[0], all[1]])).toThrow(/--supersede-edits lakes is not in the selected set/);
    });
  });
```

`runner.test.ts`: the file runs real `sql` stages through an in-memory pool, so wrap `executeStage` to see the context it is given. At the top of the file, after the imports:

```ts
// Calls through to the real executeStage; the wrapper only records the context each stage was given.
vi.mock('./stages/index', async (original) => {
  const actual = await original<typeof import('./stages/index')>();
  return { ...actual, executeStage: vi.fn(actual.executeStage) };
});
import { executeStage } from './stages/index';
```

and inside `describe('runBuild', …)`:

```ts
  it('tells a stage whether its dataset may supersede steward edits', async () => {
    vi.mocked(executeStage).mockClear();
    const { pool } = memoryPool();
    await runBuild(pool, [ds('a', 'SELECT 1'), ds('b', 'SELECT 2')], { supersedeEdits: ['b'] });
    const seen = vi.mocked(executeStage).mock.calls.map(([, , c]) => [c.datasetId, c.supersedeEdits]);
    expect(seen).toEqual([['a', false], ['b', true]]);
  });

  it('never supersedes edits because a dataset was forced', async () => {
    vi.mocked(executeStage).mockClear();
    const { pool } = memoryPool();
    await runBuild(pool, [ds('a', 'SELECT 1')], { force: ['a'] });
    expect(vi.mocked(executeStage).mock.calls.map(([, , c]) => [c.forced, c.supersedeEdits])).toEqual([[true, false]]);
  });
```

`adoptLegacy.db.test.ts` (gated on `DATABASE_URL`, rolled back like Task 3's):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { loadFeatures, versionsService } from '@webatlas/versioning';
import { adoptLegacySource } from './adoptLegacy';
import type { ResolvedLoad } from './stages/loadGeojson';
import type { Stage } from './types';

const DB = process.env.DATABASE_URL;
const dir = mkdtempSync(join(tmpdir(), 'adopt-legacy-'));
let pool: pg.Pool;
beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => { rmSync(dir, { recursive: true, force: true }); await pool?.end(); });

const path = join(dir, 'stations.geojson');
writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'al-1', name: 'A' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: 'al-2', name: 'B' } },
] }));
const columns = (p: Record<string, unknown>) => ({ external_id: p.id, name: p.name });
const stage = { type: 'load-geojson', layer: 'stations', versioned: true, legacySource: 'stations.geojson',
  files: [{ file: 'seeds/stations.geojson', columns }] } as Extract<Stage, { type: 'load-geojson' }>;
const load: ResolvedLoad = { layer: 'stations', versioned: true, source: 'stations.geojson@sha256:abc', files: [{ path, columns }] };

/** An active ingest version as the OLD seed command left it: legacy source, feature_count set. */
async function legacyVersion(c: pg.PoolClient, source: string, featureCount: number | null) {
  const svc = versionsService(pool);
  const id = await svc.createIngestVersion(c, { layerKey: 'stations', source });
  await loadFeatures(c, { table: 'stations', file: path, columns }, id);
  await c.query(`UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`, [featureCount, id]);
  await svc.activate(c, 'stations', id);
  return id;
}

async function inRollback<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); return await fn(c); } finally { await c.query('ROLLBACK'); c.release(); }
}

describe.skipIf(!DB)('adopting a version the old seed command loaded', () => {
  it('re-labels the active ingest version when its legacy source and row count match the file', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson', 2);
      expect(await adoptLegacySource(c, stage, load)).toEqual({ result: 'relabelled', versionId: id });
      const { rows } = await c.query(`SELECT source FROM app.dataset_versions WHERE id = $1`, [id]);
      expect(rows[0].source).toBe('stations.geojson@sha256:abc');
      // And now it is current: a second adoption changes nothing.
      expect(await adoptLegacySource(c, stage, load)).toEqual({ result: 'current' });
    });
  });

  it('refuses when the rows do not match the file, and says why', async () => {
    await inRollback(async (c) => {
      const id = await legacyVersion(c, 'stations.geojson', 2);
      await c.query(`DELETE FROM water.stations WHERE dataset_version_id = $1 AND external_id = 'al-2'`, [id]);
      const r = await adoptLegacySource(c, stage, load);
      expect(r.result).toBe('mismatch');
      expect((r as { detail: string }).detail).toMatch(/1 rows.*2 features/);
    });
  });

  it('refuses a different source, an edit on top, and a layer with no active version', async () => {
    await inRollback(async (c) => {
      await legacyVersion(c, 'something-else.geojson', 2);
      expect((await adoptLegacySource(c, stage, load)).result).toBe('mismatch');
    });
    await inRollback(async (c) => {
      await legacyVersion(c, 'stations.geojson', 2);
      const svc = versionsService(pool);
      await svc.commitEditDraft(c, 'stations', await svc.openEditDraft(c, 'stations'));
      // Edits on top of a legacy load: the root is still re-labelled, the edits stay active.
      expect((await adoptLegacySource(c, stage, load)).result).toBe('relabelled');
    });
    await inRollback(async (c) => {
      await c.query(`UPDATE app.dataset_versions SET is_active = false WHERE layer_key = 'stations'`);
      expect((await adoptLegacySource(c, stage, load)).result).toBe('mismatch');
    });
  });
});
```

`adopt.test.ts`: mock the re-labelling, which has its own database test above. After the existing `vi.mock('./stages/index', …)` line add:

```ts
vi.mock('./adoptLegacy', () => ({ adoptLegacySource: vi.fn() }));
import { adoptLegacySource } from './adoptLegacy';
```

The existing `vi.mock('./stages/index', …)` factory must keep working now that `adopt.ts` also imports `./stages/loadGeojson`: that is a different module, so nothing changes there. Add a dataset helper and two tests:

```ts
/** A versioned layer dataset over a seed file that exists, so the stage hash can be planned. */
const layerDs = (probe: Dataset['probe']): Dataset => ({
  id: 'stations', kind: 'vector', lineage: { statement: 's', licence: 'CC0-1.0', sources: [] },
  stages: [{
    type: 'load-geojson', layer: 'stations', versioned: true, legacySource: 'stations.geojson',
    files: [{ file: 'seeds/stations.geojson', columns: () => ({}) }],
  }],
  probe,
});

  it('leaves a layer for the build when its existing version cannot be shown to be this content', async () => {
    vi.mocked(adoptLegacySource).mockResolvedValueOnce({
      result: 'mismatch', detail: 'stations: the active load holds 1 rows, the files hold 2 features',
    });
    const m = memoryPool();
    const out = await adoptDatasets(m.pool, [layerDs(async () => ({ ok: true, detail: 'water.stations_active: 2' }))], ctx);
    expect(out).toEqual([{
      id: 'stations', result: 'needs-build',
      detail: 'stations: the active load holds 1 rows, the files hold 2 features; atlas:build will load it',
    }]);
    // Nothing recorded: the next build must run the load.
    expect(m.state.size).toBe(0);
    expect(m.steps).toEqual([]);
  });

  it('adopts a layer whose existing version was re-labelled, or was already current', async () => {
    for (const adoption of [{ result: 'relabelled' as const, versionId: 'v1' }, { result: 'current' as const }]) {
      vi.mocked(adoptLegacySource).mockResolvedValueOnce(adoption);
      const m = memoryPool();
      const d = layerDs(async () => ({ ok: true, detail: 'water.stations_active: 2' }));
      const out = await adoptDatasets(m.pool, [d], ctx);
      expect(out[0].result).toBe('adopted');
      expect(m.state.get('stations|0:load-geojson')).toEqual({ input_hash: stageHashPlan([d]).get('stations')![0], status: 'ok' });
    }
  });
```

(The two tests go inside `describe('adoptDatasets', …)`; `layerDs` beside `ds`.)

- [ ] **Step 2: Run to see them fail, then implement**

`cli/args.ts`: add `supersedeEdits: string[]` to `BuildArgs`, `'--supersede-edits'` to `FLAGS`, and `supersedeEdits: values['--supersede-edits'] !== undefined ? splitIds('--supersede-edits', values['--supersede-edits']) : []` to the result. The existing loop already handles both forms, the missing value and the repeat.

`cli/select.ts`, append:

```ts
/**
 * --supersede-edits must name datasets that are registered and selected, exactly as --force must:
 * naming one that will not be built is a contradiction, reported as a usage error (spec §11).
 */
export function assertSupersedeSelected(ids: string[], all: Dataset[], selected: Dataset[]): void {
  const known = new Set(all.map((d) => d.id));
  const chosen = new Set(selected.map((d) => d.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`atlas:build: --supersede-edits names unknown dataset "${id}"`);
    if (!chosen.has(id)) {
      throw new Error(`atlas:build: --supersede-edits ${id} is not in the selected set (removed by --only/--except)`);
    }
  }
}
```

`cli/build.ts` and `cli/up.ts`: destructure `supersedeEdits` from `parseBuildArgs`, call `assertSupersedeSelected(supersedeEdits, ALL_DATASETS, datasets)` after `assertForceSelected`, and pass `supersedeEdits` to `runBuild(pool, datasets, { universe: ALL_DATASETS, force, supersedeEdits })`.

`runner.ts`: add the option to `BuildOptions`, `const supersede = new Set(options.supersedeEdits ?? []);`, and pass `supersedeEdits: supersede.has(d.id)` in the `executeStage` context in place of Task 3's `false`.

`adoptLegacy.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { Stage } from './types';
import type { ResolvedLoad } from './stages/loadGeojson';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

export type LegacyAdoption =
  | { result: 'current' }
  | { result: 'relabelled'; versionId: string }
  | { result: 'mismatch'; detail: string };

function featureCount(path: string): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { features: unknown[] }).features.length;
}

/**
 * Give the layer's existing ingest version the content-derived `source` (spec §11, C-1), so the
 * first build after adoption finds its content already loaded instead of loading it again.
 *
 * Only when that version is what the old seed command loaded from these same files: its source is
 * the descriptor's `legacySource`, and it holds exactly the files' features. The rows compared are
 * the loaded ones: for rivers that excludes the level-1 rivers the hierarchy derives.
 */
export async function adoptLegacySource(client: PoolClient, stage: LoadStage, load: ResolvedLoad): Promise<LegacyAdoption> {
  const { rows } = await client.query<{ id: string; kind: string; source: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, kind, source, parent_version_id, 0 AS depth
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       UNION ALL
       SELECT v.id, v.kind, v.source, v.parent_version_id, c.depth + 1
         FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
     )
     SELECT id, kind, source FROM chain ORDER BY depth DESC LIMIT 1`,
    [stage.layer]
  );
  const root = rows[0];
  if (!root) return { result: 'mismatch', detail: `${stage.layer} has no active version` };
  if (root.kind === 'ingest' && root.source === load.source) return { result: 'current' };
  if (root.kind !== 'ingest' || stage.legacySource === undefined || root.source !== stage.legacySource) {
    return {
      result: 'mismatch',
      detail: `${stage.layer}: the active load's source is "${root.source}", not ${stage.legacySource === undefined ? 'adoptable (no legacySource declared)' : `"${stage.legacySource}"`}`,
    };
  }
  const want = load.files.reduce((n, f) => n + featureCount(f.path), 0);
  const derived = stage.layer === 'rivers' ? ' AND feature_level <> 1' : '';
  const have = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.${stage.layer} WHERE dataset_version_id = $1${derived}`,
    [root.id]
  );
  if (have.rows[0].n !== want) {
    return {
      result: 'mismatch',
      detail: `${stage.layer}: the active load holds ${have.rows[0].n} rows, the files hold ${want} features`,
    };
  }
  await client.query(`UPDATE app.dataset_versions SET source = $1 WHERE id = $2`, [load.source, root.id]);
  return { result: 'relabelled', versionId: root.id };
}
```

`adopt.ts`: add `'needs-build'` to `AdoptResult`. After the probe passes and before `upsertLineage`, for every versioned `load-geojson` stage of the dataset run `adoptLegacySource` on one client inside one transaction:

```ts
    // A versioned layer is adopted only if its existing version can be shown to be this content.
    // Otherwise the dataset is left for the build, which loads one new version (the edit guard
    // still applies). Re-labelling and the state rows commit or roll back together.
    const loads = d.stages.filter((s): s is Extract<Stage, { type: 'load-geojson' }> => s.type === 'load-geojson' && s.versioned);
    if (loads.length > 0) {
      const client = await pool.connect();
      let refused: string | undefined;
      try {
        await client.query('BEGIN');
        for (const s of loads) {
          const a = await adoptLegacySource(client, s, resolveLoad(s));
          if (a.result === 'mismatch') { refused = a.detail; break; }
        }
        await client.query(refused ? 'ROLLBACK' : 'COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      if (refused) {
        out.push({ id: d.id, result: 'needs-build', detail: `${refused}; atlas:build will load it` });
        continue;
      }
    }
```

(Imports: `resolveLoad` from `./stages/loadGeojson`, `adoptLegacySource` from `./adoptLegacy`, `Stage` from `./types`.) `cli/adopt.ts` prints `o.result.padEnd(13)`: `needs-build` fits.

- [ ] **Step 3: Run and commit**

Run: `npm run test -w @webatlas/atlas-data`, the two `*.db.test.ts` files with `DATABASE_URL` set, `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`
Expected: all pass; the database tests execute and leave the version count unchanged.

```bash
git add packages/atlas-data/src
git commit -m "feat(atlas-data): --supersede-edits và tiếp nhận phiên bản do lệnh seed cũ nạp

--supersede-edits tách khỏi --force, phân tích kiểu đóng: thiếu giá trị,
id rỗng, lặp lại hay id không nằm trong tập được chọn đều là lỗi dùng lệnh.
atlas:adopt đổi nhãn source của phiên bản ingest đang hoạt động sang dạng
băm khi source cũ và số dòng khớp với tệp; không khớp thì để lại cho build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The new dataset graph

**Files:**
- Create: `packages/atlas-data/src/descriptors/adminBoundaries.ts`, `packages/atlas-data/src/descriptors/layers.ts`
- Modify: `packages/atlas-data/src/descriptors/rivers.ts`, `index.ts`, `descriptors.test.ts`
- Delete: `packages/atlas-data/src/descriptors/seeds.ts`
- Modify: `packages/atlas-data/src/lineage.ts` (process step `tool`), any test that names the `seeds` dataset

**Interfaces:**
- Produces: `DESCRIPTORS = [demo, adminBoundaries, dams, stations, floodZones, droughtPoints, saltwaterIntrusion, floodGeneration, lakes, rivers, basemap, referenceEntities, dem, contours]`. Dataset ids of the seven layers equal their layer keys, so `--supersede-edits dams` reads naturally.

- [ ] **Step 1: Rewrite the descriptor tests first**

In `descriptors.test.ts`:

```ts
  it('cover every runbook step (spec FR-2)', () => {
    expect(ALL_DATASETS.map((d) => d.id)).toEqual([
      'demo', 'admin_boundaries', 'dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion',
      'flood_generation', 'lakes', 'rivers', 'basemap', 'reference_entities', 'dem', 'contours',
    ]);
  });

  it('declare the ordering rules as dependsOn, not prose (spec FR-8)', () => {
    for (const id of ['dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes', 'rivers']) {
      expect(byId(id).dependsOn, id).toEqual(['admin_boundaries']);
    }
    expect(byId('reference_entities').dependsOn).toEqual(['basemap']);
    expect(byId('contours').dependsOn).toEqual(['dem']);
  });

  it('no thematic dataset is a run stage any more: each is one load-geojson and its publishes', () => {
    for (const id of ['dams', 'stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation', 'lakes']) {
      expect(byId(id).stages.map((s) => s.type), id).toEqual(['load-geojson', 'publish-geoserver']);
    }
    expect(byId('rivers').stages.map((s) => s.type)).toEqual(['load-geojson', 'publish-geoserver', 'publish-geoserver']);
    expect(byId('admin_boundaries').stages.map((s) => s.type)).toEqual(['load-geojson']);
  });

  it('every load-geojson file exists, and each versioned layer is an editable layer key', () => {
    for (const d of ALL_DATASETS) for (const s of d.stages) {
      if (s.type !== 'load-geojson') continue;
      for (const f of s.files) expect(existsSync(resolveStageFile(f)), `${d.id}: ${f.file}`).toBe(true);
      if (s.versioned) {
        expect(EDITABLE_LAYER_KEYS as readonly string[], d.id).toContain(s.layer);
        expect(s.layer, 'the dataset id is the layer key, so --supersede-edits <id> names the layer').toBe(d.id);
      }
    }
  });

  it('every editable layer is loaded by exactly one dataset', () => {
    const layers = ALL_DATASETS.flatMap((d) => d.stages).flatMap((s) => (s.type === 'load-geojson' && s.versioned ? [s.layer] : []));
    expect([...layers].sort()).toEqual([...EDITABLE_LAYER_KEYS].sort());
  });

  it('each versioned load names the source string the old seed command wrote, so machines can be adopted', () => {
    const legacy = Object.fromEntries(ALL_DATASETS.flatMap((d) => d.stages)
      .flatMap((s) => (s.type === 'load-geojson' && s.versioned ? [[s.layer, s.legacySource]] : [])));
    expect(legacy).toEqual({
      dams: 'thuydienvietnam.geojson', stations: 'stations.geojson', flood_zones: 'flood_zones.geojson',
      drought_points: 'drought_points.geojson', saltwater_intrusion: 'saltwater_intrusion.geojson',
      flood_generation: 'flood_generation.geojson', lakes: 'OSM water bodies', rivers: 'OSM waterways + HydroRIVERS v10',
    });
  });

  it('licences follow the table in spec §11', () => {
    const licence = (id: string) => byId(id).lineage.licence;
    expect(licence('dams')).toBe('CC-BY-SA-4.0');
    expect(licence('lakes')).toBe('ODbL-1.0');
    expect(licence('rivers')).toBe('ODbL-1.0');
    for (const id of ['stations', 'flood_zones', 'drought_points', 'saltwater_intrusion', 'flood_generation']) {
      expect(licence(id), id).toBe('LicenseRef-webatlas-synthetic');
      expect(byId(id).lineage.statement, id).toMatch(/minh hoạ|tổng hợp/i);
    }
    expect(licence('admin_boundaries')).toBe('MIT');
  });
```

Delete the old `'cover every runbook step'` and `'declare the ordering rules'` bodies these replace, and the assertion `expect(byId('rivers').dependsOn).toEqual(['seeds'])`. Add imports: `resolveStageFile` from `'../paths'`, `EDITABLE_LAYER_KEYS` from `'@webatlas/shared'`. The test `'every host stage names a real npm script'` keeps working: only `reference_entities` and `contours` have host stages now.

Run: `npx vitest run src/descriptors/descriptors.test.ts` from `packages/atlas-data`. Expected: FAIL (the datasets do not exist).

- [ ] **Step 2: Write the descriptors**

`descriptors/adminBoundaries.ts`:

```ts
import { ADMIN_PROVINCE_COLUMNS, ADMIN_WARD_COLUMNS } from '@webatlas/shared';
import { defineDataset } from '../schema';
import { allOf, rowCount } from '../probes';

/**
 * Province and ward boundaries after the 2025-07-01 reorganisation. Non-versioned: a closed set
 * that is replaced whole. Every thematic layer depends on it, because activation stamps each
 * feature with the province and ward codes it intersects; a boundary change therefore cascades to
 * every layer's re-stamp path (spec §11).
 *
 * The two files are read from apps/web/public, not from data/seeds: the map loads them there
 * (spec C-2). The exception ends when the map reads boundaries from GeoServer or the API.
 */
export const adminBoundaries = defineDataset({
  id: 'admin_boundaries',
  kind: 'vector',
  lineage: {
    statement:
      'Ranh giới 34 tỉnh và các xã của sáu tỉnh vùng công tác sau sắp xếp 01/7/2025, giản lược khoảng 11 m ' +
      'bằng fetch-boundaries.mjs; dùng để gán mã hành chính cho mọi lớp chuyên đề.',
    licence: 'MIT',
    sources: [
      {
        citation: 'thanglequoc/vietnamese-provinces-database (dữ liệu gốc: NXB Tài nguyên – Môi trường và Bản đồ)',
        licence: 'MIT',
        uri: 'https://github.com/thanglequoc/vietnamese-provinces-database',
      },
    ],
  },
  stages: [
    {
      type: 'load-geojson',
      layer: 'admin',
      versioned: false,
      files: [
        { file: 'apps/web/public/provinces-34.geojson', root: 'repo', target: 'admin.provinces', multiPolygon: true, columns: ADMIN_PROVINCE_COLUMNS },
        { file: 'apps/web/public/wards-region.geojson', root: 'repo', target: 'admin.wards', multiPolygon: true, columns: ADMIN_WARD_COLUMNS },
      ],
    },
  ],
  probe: allOf(
    rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34),
    rowCount('admin.wards', 'SELECT count(*)::text AS n FROM admin.wards')
  ),
});
```

`descriptors/layers.ts`:

```ts
import { SEED_LAYER_COLUMNS, type ColumnMap } from '@webatlas/shared';
import { defineDataset } from '../schema';
import { allOf, viewCount, wfsAnswers } from '../probes';
import type { Dataset, Lineage } from '../types';

/**
 * The seven thematic layers, one dataset each (spec §10): one load-geojson, one publish. Each
 * depends on admin_boundaries, whose codes activation stamps onto every feature. The dataset id is
 * the layer key.
 */
function thematic(
  layer: keyof typeof SEED_LAYER_COLUMNS,
  file: string,
  legacySource: string,
  lineage: Lineage,
  opts: { multiPolygon?: boolean } = {}
): Dataset {
  return defineDataset({
    id: layer,
    kind: 'vector',
    editable: true,
    dependsOn: ['admin_boundaries'],
    lineage,
    stages: [
      {
        type: 'load-geojson',
        layer,
        versioned: true,
        legacySource,
        files: [{ file: `seeds/${file}`, columns: SEED_LAYER_COLUMNS[layer] as ColumnMap, ...opts }],
      },
      { type: 'publish-geoserver', layer },
    ],
    probe: allOf(viewCount(layer), wfsAnswers(layer)),
  });
}

const SYNTHETIC = 'LicenseRef-webatlas-synthetic';
const synthetic = (what: string): Lineage => ({
  statement: `${what}: dữ liệu minh hoạ tổng hợp từ nguyên mẫu ban đầu, không phải số đo thực địa.`,
  licence: SYNTHETIC,
  sources: [{ citation: 'Synthetic demonstration data from the original prototype — not measurements', licence: SYNTHETIC }],
});

export const dams = thematic('dams', 'dams.geojson', 'thuydienvietnam.geojson', {
  statement: 'Đập thuỷ điện Việt Nam tính đến tháng 10/2020, cắt theo sáu tỉnh vùng công tác; trạng thái vận hành là giá trị minh hoạ.',
  licence: 'CC-BY-SA-4.0',
  sources: [
    {
      citation: 'Open Development Vietnam, Hydropower plants in Vietnam by October 2020',
      licence: 'CC-BY-SA-4.0',
      uri: 'https://data.opendevelopmentmekong.net/en/dataset/hydropower-plants-in-vietnam-by-october-2020',
    },
  ],
});

export const stations = thematic('stations', 'stations.geojson', 'stations.geojson', synthetic('Trạm quan trắc'));
export const floodZones = thematic('flood_zones', 'flood_zones.geojson', 'flood_zones.geojson', synthetic('Vùng ngập lụt'), { multiPolygon: true });
export const droughtPoints = thematic('drought_points', 'drought_points.geojson', 'drought_points.geojson', synthetic('Điểm hạn hán'));
export const saltwaterIntrusion = thematic('saltwater_intrusion', 'saltwater_intrusion.geojson', 'saltwater_intrusion.geojson', synthetic('Xâm nhập mặn'));
export const floodGeneration = thematic('flood_generation', 'flood_generation.geojson', 'flood_generation.geojson', synthetic('Vùng sinh lũ'), { multiPolygon: true });

export const lakes = thematic('lakes', 'osm-lakes-region.geojson', 'OSM water bodies', {
  statement: 'Hồ và hồ chứa từ OpenStreetMap, cắt theo sáu tỉnh vùng công tác; có tên hồ, không có dung tích và chiều dài bờ.',
  licence: 'ODbL-1.0',
  sources: [{ citation: 'OpenStreetMap contributors (water bodies)', licence: 'ODbL-1.0', uri: 'https://www.openstreetmap.org/' }],
}, { multiPolygon: true });
```

`descriptors/rivers.ts`: keep the lineage and the probe; replace the doc comment's last paragraph, `dependsOn` and the first stage:

```ts
 * Một load-geojson nạp HAI tệp vào MỘT phiên bản (spec C-6): một phiên bản ingest không có cha,
 * nên nạp hai cấp vào hai phiên bản thì một cấp sẽ biến mất với mọi người đọc. Phụ thuộc
 * `admin_boundaries`: kích hoạt gán mã tỉnh/xã theo ranh giới.
```

```ts
  dependsOn: ['admin_boundaries'],
```

```ts
    {
      type: 'load-geojson',
      layer: 'rivers',
      versioned: true,
      legacySource: 'OSM waterways + HydroRIVERS v10',
      files: [
        { file: 'seeds/osm-rivers-region.geojson', columns: RIVER_WAY_COLUMNS, multiLine: true },
        { file: 'seeds/hydrorivers-region.geojson', columns: RIVER_REACH_COLUMNS, multiLine: true },
      ],
    },
```

with `import { RIVER_REACH_COLUMNS, RIVER_WAY_COLUMNS } from '@webatlas/shared';`.

`descriptors/index.ts`:

```ts
import { demo } from './demo';
import { adminBoundaries } from './adminBoundaries';
import { dams, stations, floodZones, droughtPoints, saltwaterIntrusion, floodGeneration, lakes } from './layers';
import { rivers } from './rivers';
import { basemap } from './basemap';
import { referenceEntities } from './referenceEntities';
import { dem } from './dem';
import { contours } from './contours';
import type { Dataset } from '../types';

/** Every registered dataset. Adding one means adding a line here and a descriptor file. */
export const DESCRIPTORS: Dataset[] = [
  demo, adminBoundaries, dams, stations, floodZones, droughtPoints, saltwaterIntrusion, floodGeneration, lakes,
  rivers, basemap, referenceEntities, dem, contours,
];
```

```bash
git rm packages/atlas-data/src/descriptors/seeds.ts
```

`lineage.ts`, `processStep`: a `load-geojson` step's `tool` should name what was loaded. Replace `const tool = stage.type === 'run' ? stage.argv.join(' ') : stage.type;` with

```ts
  const tool =
    stage.type === 'run' ? stage.argv.join(' ')
    : stage.type === 'load-geojson' ? `load-geojson ${stage.files.map((f) => f.file).join(' + ')}`
    : stage.type;
```

and add a case to `lineage.test.ts` beside the existing `processStep` tests asserting that string for a two-file stage.

Then: `grep -rn "'seeds'" packages/atlas-data/src` and fix each remaining reference (tests that used `seeds` as an example dataset id may keep it as a literal id of their own synthetic dataset; anything importing `./seeds` or `SEED_LAYERS` from it must change).

- [ ] **Step 3: Run and commit**

Run: `npm run test -w @webatlas/atlas-data`, `npx tsc -p packages/atlas-data/tsconfig.json --noEmit`
Expected: all pass.

```bash
git add -A packages/atlas-data/src
git commit -m "feat(atlas-data): admin_boundaries, bảy lớp chuyên đề và sông thành tập dữ liệu load-geojson

Tập seeds (một stage run bọc npm run seed) được thay bằng admin_boundaries
không phiên bản và bảy tập riêng, mỗi tập một load-geojson và một lần công
bố, đều phụ thuộc admin_boundaries. rivers nạp hai tệp vào một phiên bản.
Mỗi tập mang giấy phép và nguồn riêng (spec §11); năm lớp minh hoạ được
ghi rõ là dữ liệu tổng hợp.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate this machine, CI, documents, pull request (controller-run)

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/runbooks/README.md`, `docs/architecture/database-architecture.md`
- Modify: this plan (execution notes)

- [ ] **Step 1: Adopt the dev machine**

```bash
npm run atlas:status      # expect: missing admin_boundaries + eight layer datasets; ok for the rest
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions"   # record
npm run atlas:adopt
```

Expected from `atlas:adopt`: `adopted` for `admin_boundaries` and for each of the eight layer datasets (their active versions carry the legacy sources and the right row counts, checked on 2026-10-04), `has-state` for the datasets that were already tracked. Any `needs-build` line names its reason: read it before going on.

```bash
npm run atlas:status      # expect: every dataset ok
npm run atlas:build       # expect: executed 0 — adoption left nothing to do
docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "SELECT count(*) FROM app.dataset_versions; SELECT layer_key, source FROM app.dataset_versions WHERE is_active ORDER BY 1"
npm run atlas:verify      # expect: all 50 checks passed
```

Expected: the version count is unchanged by adopt and build; every active source now reads `<file>@sha256:<64 hex>`. The 50 checks are: demo 2; admin_boundaries 3; seven layers at 4 each; rivers 5; basemap, reference_entities, dem, contours at 3 each.

- [ ] **Step 2: Prove the three paths on the real machine**

1. **Idempotent rebuild.** `npm run atlas:build -- --force stations`: the load stage logs `stations: content unchanged; re-stamped 1 version`; the version count does not change.
2. **Changed content.** Not exercised on the live tables: it would mean committing a changed seed file or leaving a new version behind. New content, the edit guard and `--supersede-edits` are covered by Task 3's database tests on the real layers, under rollback. Record that here.
3. **Boundary cascade.** `npm run atlas:build -- --force admin_boundaries`: `admin_boundaries` replaces its tables, every layer dataset's load re-runs on the re-stamp path, publishes re-run, `executed` is 1 + 8 loads + 9 publishes = 18, no version is created. `npm run atlas:verify`: all 50 pass.

- [ ] **Step 3: The old commands still work**

Run: `npm run test:api` (439 pass; `seed.test.ts` and `integration.test.ts` still run `npm run seed`'s code path), then `npm run atlas:status`.
Expected: status still `ok`. The API tests created new versions with the legacy sources, which is the situation C-3 ends; the registry's state is unaffected. Record the version count after the run.

- [ ] **Step 4: Run the database tests in CI**

In `.github/workflows/ci.yml`, in the `api` job, after `- run: npm run test:versioning` add:

```yaml
      # Bộ nạp load-geojson và việc tiếp nhận phiên bản cũ: kiểm thử cần cơ sở dữ liệu thật, chạy
      # trong transaction rồi rollback. Chỉ hai tệp này: phần còn lại của atlas-data chạy ở job riêng.
      - run: npx vitest run src/stages/loadGeojson.db.test.ts src/adoptLegacy.db.test.ts
        working-directory: packages/atlas-data
```

- [ ] **Step 5: Documents**

- `README.md`: the dataset list (`Datasets: seeds, rivers, …`) becomes the fourteen ids, grouped: `admin_boundaries`; the seven layers; `rivers`; `basemap`, `reference_entities`, `dem`, `contours`; plus `demo`. Add a row to the day-to-day table: `` `npm run atlas:build -- --supersede-edits <layer>` `` — "Load new seed content over a layer that has steward edits on top. Without it the build stops rather than hide the edits; `--force` never implies it." Seed data paths already point at `packages/atlas-data/data/seeds` (Task 2).
- `docs/runbooks/README.md`: step 3 (the `seeds` dataset) and step 4 (rivers) describe `load-geojson` datasets, each rerun with `npm run atlas:build -- --only <id>`; say that an unchanged file creates no version.
- `docs/architecture/database-architecture.md`: the Plan C paragraph: C-2 done (the `load-geojson` executor and its datasets); C-3 remains (the old commands, test seeding, CI). The paragraph after it, which says the river ingest "departs from the rule" because the registry has no `load-geojson` executor, is no longer true: rewrite it to say rivers is a `load-geojson` dataset loading two files into one version.

- [ ] **Step 6: Full verification, commit, PR**

| Command | Expected |
|---|---|
| `npm run test -w @webatlas/atlas-data` | all pass; record the count |
| the two `*.db.test.ts` with `DATABASE_URL` | 7 + 3 pass, executed not skipped |
| `npm run test:shared`, `test:versioning`, `test:api`, `test:web` | 119, 51, 439, 543 |
| `npm run atlas:verify` | all 50 checks passed |

```bash
git add .github/workflows/ci.yml README.md docs
git commit -m "docs, ci: tập dữ liệu load-geojson — tài liệu và kiểm thử cơ sở dữ liệu trong CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/registry-plan-c2
gh pr create --base main --head feat/registry-plan-c2 --title "Kế hoạch C-2: stage load-geojson và các tập dữ liệu chuyên đề" --body-file <body>
```

PR body in Vietnamese: `## Tóm tắt`, `## Hành vi` (the four situations of spec §11 as a table), `## Khác với spec` (the five decisions at the top of this plan), `## Kiểm chứng` (the table above with real numbers, and Steps 1 to 3), `## Lưu ý` (stacked on #20; machines built before need `npm run atlas:adopt`; the old commands remain until C-3), `## Tiếp theo`. Watch CI; append `## Execution notes` to this plan; commit and push.
