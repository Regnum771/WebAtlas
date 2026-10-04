# S1 Active Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve each layer's active state from a stored `is_current` flag instead of resolving the version chain on every read, and keep only the versions that matter.

**Architecture:** One migration adds `is_current` and partial indexes to the eight `water.<layer>` tables, backfills the flag, and turns each `water.<layer>_active` view into a plain filter. `versionsService.activate()` in `packages/versioning` maintains the flag and then prunes old versions, using one shared resolver (`resolvedSql`). The API's hand-written resolution workarounds (`candidateCtes`, `layerTable`, search's `layerCtes`) are deleted and their callers query the views directly.

**Tech Stack:** PostgreSQL 16 + PostGIS 3.4, node-pg-migrate (`.cjs` migrations), TypeScript, `pg`, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-04-active-data-current-flag-design.md`

## Global Constraints

- The eight thematic layers are exactly: `dams`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation`, `lakes`, `rivers` (`EDITABLE_LAYER_KEYS` in `@webatlas/shared`).
- `is_current = true` exactly when the row is what the layer's active chain resolves its feature to and that row is not a tombstone.
- Only `versionsService.activate()` writes `is_current`. Nothing else may.
- Every `water.<layer>_active` view keeps its name, its columns and their order.
- Retention per layer: the active chain, the two most recent ingest versions outside it (`EARLIER_LOADS_KEPT = 2`) with all their descendants, and every pinned version with its chain to the root.
- Pins: `app.version_pins (version_id uuid NOT NULL REFERENCES app.dataset_versions(id) ON DELETE RESTRICT, holder text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (version_id, holder))`.
- The active state is read through the `*_active` views only.
- Code comments are English. Translate any Vietnamese comment in a file you touch. User-facing strings (UI text, error messages, assistant replies) are not comments and stay as they are.
- Commit messages: Vietnamese Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `packages/shared/dist` is gitignored but tracked: if you rebuild it, `git add -f` only files you meant to change. This plan should not touch it.
- Never print `DATABASE_URL` or any password. Where a command needs it, it is read from `apps/api/.env` without echoing: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '\r')"` (from the repo root; use `../../apps/api/.env` from a package directory).
- Work on branch `feat/active-data-s1` (it exists, with the spec commit).

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/db/migrations/1000000000022_current-flag.cjs` (new) | Schema: `is_current`, partial indexes, backfill, filter views, `app.version_pins`, `ingested_at` default |
| `apps/api/src/db/currentFlag.test.ts` (new) | Schema facts of the migration |
| `packages/versioning/src/resolve.ts` (new) | `resolvedSql`: the one definition of what a version resolves to |
| `packages/versioning/src/currentRows.ts` (new) | `refreshCurrentRows`: move the flag to the resolved rows of a version |
| `packages/versioning/src/retention.ts` (new) | `pruneVersions`, `assertPrunable`, `EARLIER_LOADS_KEPT` |
| `packages/versioning/src/service.ts` | `activate()` calls `refreshCurrentRows` and `pruneVersions` |
| `packages/versioning/src/repository.ts` | `resolveFeatureIds` uses `resolvedSql`; `chainToRoot` and the old `resolvedSql(layer, chain)` go |
| `packages/versioning/src/riverHierarchy.ts` | `materialiseResolved` uses `resolvedSql` |
| `packages/versioning/src/index.ts` | Exports the new functions |
| `packages/versioning/src/currentRows.test.ts`, `retention.test.ts` (new) | Database tests |
| `packages/atlas-data/src/stages/loadGeojson.ts`, `ensureSeeded.ts` | Prune on the "unchanged" paths |
| `apps/api/src/modules/assistant/tools/data/helpers.ts` and eight callers, `search/repository.ts`, `roi/resolve.ts` | Read through the views |
| `apps/api/src/db/activeReads.test.ts` (new) | Guard: no direct base-table reads |
| `docs/architecture/database-architecture.md` | How the active state is stored and served, and retention |

---

### Task 1: Migration — the flag, the filter views, pins

**Files:**
- Create: `apps/api/src/db/migrations/1000000000022_current-flag.cjs`
- Create: `apps/api/src/db/currentFlag.test.ts`

**Interfaces:**
- Produces: column `water.<layer>.is_current boolean NOT NULL DEFAULT false` on the eight tables; the eight views as `SELECT <cols> FROM water.<layer> WHERE is_current`; table `app.version_pins`; `app.dataset_versions.ingested_at DEFAULT clock_timestamp()`.

Note: between this task and Task 2, a new activation leaves the flags stale (nothing maintains them yet). Do not run the full API suite in between; Task 2 follows directly.

- [ ] **Step 1: Record the baseline (before any change)**

From the repo root, on the dev stack:

```bash
q() { MSYS_NO_PATHCONV=1 docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "$1"; }
for v in lakes_active rivers_active rivers_detail; do
  echo "$v: $(q "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM water.$v WHERE geom && ST_MakeEnvelope(108.0, 12.6, 108.1, 12.7, 4326)" | grep 'Execution Time')"
done
q "SELECT layer_key, count(*) FROM app.dataset_versions GROUP BY 1 ORDER BY 1" | tr '\n' ' '
```

Then the activation baseline. Save as `packages/versioning/measure-activation.local.ts` (do not commit it; delete it in Task 5):

```ts
import pg from 'pg';
import { versionsService } from './src/index';

// Re-activates the active rivers version three times, each inside a rolled-back transaction.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = 'rivers' AND is_active`
  );
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    await client.query('BEGIN');
    const started = Date.now();
    await versionsService(pool).activate(client, 'rivers', rows[0].id);
    times.push(Date.now() - started);
    await client.query('ROLLBACK');
  }
  console.log(`rivers activate ms: ${times.join(', ')}`);
} finally {
  client.release();
  await pool.end();
}
```

Run:

```bash
cd packages/versioning && export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2- | tr -d '\r')" && npx tsx measure-activation.local.ts; unset DATABASE_URL; cd ../..
```

Write all four numbers into the plan's Execution notes (Task 5 compares against them). Expected order of magnitude: lakes about 1.4 s, rivers_active about 0.55 s, rivers_detail about 0.25 s, 241 versions.

- [ ] **Step 2: Write the failing schema test**

Create `apps/api/src/db/currentFlag.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';
import { getPool, closePool } from './pool';

afterAll(async () => {
  await closePool();
});

/** The ids the active chain resolves to, computed the way the views did before migration 22. */
async function resolvedActiveIds(layer: string): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(
    `WITH RECURSIVE active AS (
       SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active
     ),
     chain AS (
       SELECT v.id, v.parent_version_id, 0 AS depth FROM app.dataset_versions v JOIN active a ON v.id = a.id
       UNION ALL
       SELECT p.id, p.parent_version_id, c.depth + 1 FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
     ),
     resolved AS (
       SELECT DISTINCT ON (t.external_id) t.id, t.deleted
         FROM water.${layer} t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
     )
     SELECT id::text AS id FROM resolved WHERE NOT deleted ORDER BY id`,
    [layer]
  );
  return rows.map((r) => r.id);
}

describe('migration 22: the current flag', () => {
  it.each(EDITABLE_LAYER_KEYS)('%s: the view serves exactly what the active chain resolves to', async (layer) => {
    const { rows } = await getPool().query<{ id: string }>(`SELECT id::text AS id FROM water.${layer}_active ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(await resolvedActiveIds(layer));
  });

  it.each(EDITABLE_LAYER_KEYS)('%s: the view is a plain filter on is_current', async (layer) => {
    const { rows } = await getPool().query<{ def: string }>(
      `SELECT pg_get_viewdef($1::regclass, true) AS def`, [`water.${layer}_active`]
    );
    expect(rows[0].def).toMatch(/WHERE\s+\w*\.?is_current/);
    expect(rows[0].def).not.toMatch(/RECURSIVE/);
  });

  it.each(EDITABLE_LAYER_KEYS)('%s: has partial indexes for the readers\' access paths', async (layer) => {
    const { rows } = await getPool().query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'water' AND tablename = $1 AND indexdef LIKE '%WHERE is_current%'`,
      [layer]
    );
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/USING gist \(geom\)/);
    expect(defs).toMatch(/USING gin \(province_codes\)/);
    expect(defs).toMatch(/USING gin \(ward_codes\)/);
    expect(defs).toMatch(/USING gin \(name gin_trgm_ops\)/);
    expect(defs).toMatch(/USING btree \(external_id\)/);
  });

  it('app.version_pins exists and refuses to lose a pinned version', async () => {
    const { rows } = await getPool().query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'app.version_pins'::regclass AND contype = 'f'`
    );
    expect(rows.map((r) => r.def)).toEqual(['FOREIGN KEY (version_id) REFERENCES app.dataset_versions(id) ON DELETE RESTRICT']);
  });

  it('versions created in one transaction get distinct ingested_at (clock_timestamp)', async () => {
    const { rows } = await getPool().query<{ d: string }>(
      `SELECT column_default AS d FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'dataset_versions' AND column_name = 'ingested_at'`
    );
    expect(rows[0].d).toBe('clock_timestamp()');
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `cd apps/api && npx vitest run src/db/currentFlag.test.ts`
Expected: FAIL. The equivalence cases pass (the views still resolve), the "plain filter", "partial indexes", `version_pins` and `clock_timestamp` cases fail (`relation "app.version_pins" does not exist`, regex mismatch).

- [ ] **Step 4: Write the migration**

Create `apps/api/src/db/migrations/1000000000022_current-flag.cjs`:

```js
/* eslint-disable camelcase */
exports.shorthands = undefined;

/**
 * The active state of each thematic layer, stored instead of computed (S1 spec,
 * docs/superpowers/specs/2026-10-04-active-data-current-flag-design.md).
 *
 * Until now every water.<layer>_active view walked the active version chain and kept the
 * nearest row per external_id on every read, before any predicate applied: an optimizer
 * fence. A map window returning 65 lakes took 1.4 s. From here on the answer is stored on
 * the rows as is_current, maintained by versionsService.activate() (packages/versioning),
 * and each view is a plain filter that PostgreSQL inlines, so a caller's predicate reaches
 * the partial indexes created below.
 *
 * The backfill writes data, an exception to "migrations create tables, the pipeline
 * populates": without it the views would return nothing until each layer's next activation.
 */
const LAYERS = [
  'dams', 'stations', 'flood_zones', 'drought_points',
  'saltwater_intrusion', 'flood_generation', 'lakes', 'rivers',
];
const LAYER_ARRAY = `ARRAY[${LAYERS.map((l) => `'${l}'`).join(', ')}]`;

exports.up = (pgm) => {
  // Distinct times for versions created in one transaction: retention orders loads by
  // ingested_at, and now() is frozen for the whole transaction.
  pgm.sql(`ALTER TABLE app.dataset_versions ALTER COLUMN ingested_at SET DEFAULT clock_timestamp()`);

  // Per layer, in this order: the column; the backfill, through the old view while it still
  // resolves; the view replaced, with the column list read from the old view so names and
  // order stay exactly as they were (rivers_detail and rivers_overview select from
  // rivers_active); then the partial indexes.
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active';
        EXECUTE format('ALTER TABLE water.%I ADD COLUMN is_current boolean NOT NULL DEFAULT false', l);
        EXECUTE format('UPDATE water.%I SET is_current = true WHERE id IN (SELECT id FROM water.%I)', l, l || '_active');
        EXECUTE format('CREATE OR REPLACE VIEW water.%I AS SELECT %s FROM water.%I WHERE is_current', l || '_active', cols, l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gist (geom) WHERE is_current', l || '_current_geom_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (province_codes) WHERE is_current', l || '_current_province_codes_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (ward_codes) WHERE is_current', l || '_current_ward_codes_idx', l);
        EXECUTE format('CREATE INDEX %I ON water.%I USING gin (name gin_trgm_ops) WHERE is_current', l || '_current_name_trgm', l);
        EXECUTE format('CREATE INDEX %I ON water.%I (external_id) WHERE is_current', l || '_current_external_id_idx', l);
        EXECUTE format('ANALYZE water.%I', l);
      END LOOP;
    END $$;
  `);

  // Versions a scenario (S4) branched from. Pruning never removes a pinned version or its
  // ancestors, and RESTRICT is the second guard.
  pgm.sql(`
    CREATE TABLE app.version_pins (
      version_id uuid NOT NULL REFERENCES app.dataset_versions(id) ON DELETE RESTRICT,
      holder text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (version_id, holder)
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS app.version_pins`);
  // The resolving views as migrations 5, 6, 18 and 19 left them, with an explicit column list
  // (not t.*) so that is_current can be dropped afterwards.
  pgm.sql(`
    DO $$
    DECLARE
      l text;
      cols text;
      tcols text;
    BEGIN
      FOREACH l IN ARRAY ${LAYER_ARRAY} LOOP
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
               string_agg('t.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
          INTO cols, tcols
          FROM information_schema.columns
         WHERE table_schema = 'water' AND table_name = l || '_active';
        EXECUTE format($v$
          CREATE OR REPLACE VIEW water.%I AS
          WITH RECURSIVE active AS (
            SELECT id FROM app.dataset_versions WHERE layer_key = %L AND is_active
          ),
          chain AS (
            SELECT v.id, v.parent_version_id, 0 AS depth
              FROM app.dataset_versions v JOIN active a ON v.id = a.id
            UNION ALL
            SELECT p.id, p.parent_version_id, c.depth + 1
              FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
          ),
          resolved AS (
            SELECT DISTINCT ON (t.external_id) %s
              FROM water.%I t JOIN chain c ON t.dataset_version_id = c.id
             ORDER BY t.external_id, c.depth
          )
          SELECT %s FROM resolved WHERE NOT deleted
        $v$, l || '_active', l, tcols, l, cols);
        EXECUTE format('DROP INDEX IF EXISTS water.%I, water.%I, water.%I, water.%I, water.%I',
          l || '_current_geom_idx', l || '_current_province_codes_idx', l || '_current_ward_codes_idx',
          l || '_current_name_trgm', l || '_current_external_id_idx');
        EXECUTE format('ALTER TABLE water.%I DROP COLUMN is_current', l);
      END LOOP;
    END $$;
  `);
  pgm.sql(`ALTER TABLE app.dataset_versions ALTER COLUMN ingested_at SET DEFAULT now()`);
};
```

- [ ] **Step 5: Migrate the dev database and run the test**

Run: `npm run migrate` (from the repo root). Expected: `Migrations complete!` with `1000000000022_current-flag` listed.
Run: `cd apps/api && npx vitest run src/db/currentFlag.test.ts`
Expected: PASS, 26 tests (8 + 8 + 8 + 2).

- [ ] **Step 6: Prove `down` and `up` again**

```bash
npm run migrate:down -w @webatlas/api && cd apps/api && npx vitest run src/db/currentFlag.test.ts -t "serves exactly"; cd ../.. && npm run migrate
```

Expected: after `down`, the eight "serves exactly" cases still PASS (resolving views restored, column gone). After `migrate`, the full file passes again. Also run `cd apps/api && npx vitest run src/db/riversLevelViews.test.ts src/db/schema.test.ts`. Expected: PASS (`rivers_detail` and `rivers_overview` survived the view replacement).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/1000000000022_current-flag.cjs apps/api/src/db/currentFlag.test.ts
git commit -F - <<'EOF'
feat(db): cờ is_current, view *_active thành bộ lọc, bảng app.version_pins

Migration 22 lưu trạng thái đang hoạt động của từng lớp lên chính các dòng (is_current), kèm
chỉ mục một phần WHERE is_current, và biến mỗi view water.<lớp>_active thành bộ lọc đơn giản
với đúng tên và cột như trước. Cờ được điền từ view cũ trước khi thay. Thêm app.version_pins
cho các kịch bản về sau, và ingested_at mặc định clock_timestamp() để các phiên bản tạo trong
cùng một transaction có thời điểm khác nhau.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: One resolver, and `activate()` maintains the flag

**Files:**
- Create: `packages/versioning/src/resolve.ts`
- Create: `packages/versioning/src/currentRows.ts`
- Create: `packages/versioning/src/currentRows.test.ts`
- Modify: `packages/versioning/src/service.ts` (`activate`, `resolveFeatureIds`)
- Modify: `packages/versioning/src/repository.ts` (remove `chainToRoot` and `resolvedSql(layer, chain)`; `resolveFeatureIds` uses the new resolver)
- Modify: `packages/versioning/src/riverHierarchy.ts` (`materialiseResolved`)
- Modify: `packages/versioning/src/index.ts`
- Modify: `apps/api/src/modules/layers/service.test.ts` (drop its use of the removed `resolvedSql(layer, chain)`)
- Modify: `packages/atlas-data/src/descriptors/descriptors.test.ts` (the `riverHierarchyCode` pin)

**Interfaces:**
- Consumes: the `is_current` column (Task 1).
- Produces:
  - `resolvedSql(layerKey: string, select?: string): string` — a full SELECT whose only parameter `$1` is a version id; returns `select` (default `'id'`) over the rows that version resolves to, tombstones removed. Exported from `@webatlas/versioning`.
  - `refreshCurrentRows(client: PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<void>`. Exported.

- [ ] **Step 1: Write the failing equivalence tests**

Create `packages/versioning/src/currentRows.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { loadFeatures, resolvedSql, versionsService } from './index';

// Every case runs on the real stations layer inside a transaction that is rolled back.
const dir = mkdtempSync(join(tmpdir(), 'current-rows-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});

const file = join(dir, 'stations.geojson');
writeFileSync(file, JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'cr-1', name: 'A' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [108.44, 11.94] }, properties: { id: 'cr-2', name: 'B' } },
  ],
}));
const columns = (p: Record<string, unknown>) => ({ external_id: p.id, name: p.name });

async function inRollback(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    // Keep the layer's existing versions out of retention (Task 3), so only this test's rows move.
    await c.query(`INSERT INTO app.version_pins (version_id, holder) SELECT id, 'currentRows.test' FROM app.dataset_versions`);
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

async function ingest(c: pg.PoolClient): Promise<string> {
  const svc = versionsService(getPool());
  const id = await svc.createIngestVersion(c, { layerKey: 'stations', source: 'currentRows.test' });
  await loadFeatures(c, { table: 'stations', file, columns }, id);
  await svc.activate(c, 'stations', id);
  return id;
}

const sorted = (ids: string[]) => [...ids].sort();
const flagged = async (c: pg.PoolClient) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM water.stations WHERE is_current`)).rows.map((r) => r.id));
const viewed = async (c: pg.PoolClient) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM water.stations_active`)).rows.map((r) => r.id));
const resolved = async (c: pg.PoolClient, versionId: string) =>
  sorted((await c.query<{ id: string }>(`SELECT id::text AS id FROM (${resolvedSql('stations')}) r`, [versionId])).rows.map((r) => r.id));

describe('the current flag follows activation', () => {
  it('an ingest: its rows are current, nothing else is, and the view serves exactly those', async () => {
    await inRollback(async (c) => {
      const v = await ingest(c);
      const ids = await resolved(c, v);
      expect(ids).toHaveLength(2);
      expect(await flagged(c)).toEqual(ids);
      expect(await viewed(c)).toEqual(ids);
    });
  });

  it('an edit commit: the changed row replaces its parent, a tombstone removes its feature', async () => {
    await inRollback(async (c) => {
      const base = await ingest(c);
      const svc = versionsService(getPool());
      const draft = await svc.openEditDraft(c, 'stations');
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id)
         SELECT external_id, 'A edited', geom, $1 FROM water.stations WHERE dataset_version_id = $2 AND external_id = 'cr-1'`,
        [draft, base]
      );
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id, deleted)
         SELECT external_id, name, geom, $1, true FROM water.stations WHERE dataset_version_id = $2 AND external_id = 'cr-2'`,
        [draft, base]
      );
      await svc.commitEditDraft(c, 'stations', draft);
      const ids = await resolved(c, draft);
      expect(await flagged(c)).toEqual(ids);
      expect(await viewed(c)).toEqual(ids);
      const { rows } = await c.query(`SELECT name FROM water.stations_active WHERE external_id IN ('cr-1', 'cr-2')`);
      expect(rows).toEqual([{ name: 'A edited' }]);
    });
  });

  it('a discarded draft changes no flag', async () => {
    await inRollback(async (c) => {
      await ingest(c);
      const before = await flagged(c);
      const svc = versionsService(getPool());
      const draft = await svc.openEditDraft(c, 'stations');
      await c.query(
        `INSERT INTO water.stations (external_id, name, geom, dataset_version_id)
         VALUES ('cr-3', 'C', ST_SetSRID(ST_MakePoint(108.1, 12.7), 4326), $1)`,
        [draft]
      );
      await svc.discardEditDraft(c, 'stations', draft);
      expect(await flagged(c)).toEqual(before);
    });
  });

  it('a second ingest: only the new rows are current', async () => {
    await inRollback(async (c) => {
      const first = await ingest(c);
      const second = await ingest(c);
      expect(await flagged(c)).toEqual(await resolved(c, second));
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1 AND is_current`, [first]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('resolvedSql', () => {
  it('resolves an unknown version to nothing, not to every feature', async () => {
    const { rows } = await getPool().query(resolvedSql('stations'), ['00000000-0000-0000-0000-000000000000']);
    expect(rows).toEqual([]);
  });

  it('refuses a layer key that is not an identifier', () => {
    expect(() => resolvedSql('stations; DROP TABLE x')).toThrow(/not a layer key/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/versioning && npx vitest run src/currentRows.test.ts`
Expected: FAIL to import: `resolvedSql` is not exported from `./index`.

- [ ] **Step 3: Write `resolve.ts`**

Create `packages/versioning/src/resolve.ts`:

```ts
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * The one definition of what a version resolves to. `$1` is the version id: its chain is the
 * version and its ancestors; per external_id the nearest version's row wins, and a tombstone
 * there removes the feature (the filter runs after DISTINCT ON, so a tombstone suppresses the
 * inherited row instead of letting it resurface). `select` names the columns to return from
 * the resolved rows.
 *
 * Used to set the current flag at activation, to resolve a version that is not active yet
 * (the river hierarchy and gates, during activation), and by resolveFeatureIds. The active
 * state itself is read from the water.<layer>_active views, never through this.
 */
export function resolvedSql(layerKey: string, select = 'id'): string {
  if (!IDENTIFIER.test(layerKey)) throw new Error(`resolvedSql: "${layerKey}" is not a layer key`);
  return `
    WITH RECURSIVE chain AS (
      SELECT id, parent_version_id, 0 AS depth FROM app.dataset_versions WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layerKey} t JOIN chain c ON t.dataset_version_id = c.id
       ORDER BY t.external_id, c.depth
    )
    SELECT ${select} FROM resolved WHERE NOT deleted`;
}
```

- [ ] **Step 4: Write `currentRows.ts`**

Create `packages/versioning/src/currentRows.ts`:

```ts
import type { PoolClient } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';
import { resolvedSql } from './resolve';

/**
 * Move the layer's current flag to the rows `versionId` resolves to. Called by activate() only,
 * after the active pointer has moved and in the same transaction, so readers in other
 * transactions see the old state or the new one, never a mix.
 */
export async function refreshCurrentRows(client: PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<void> {
  await client.query(`UPDATE water.${layerKey} SET is_current = false WHERE is_current`);
  await client.query(`UPDATE water.${layerKey} SET is_current = true WHERE id IN (${resolvedSql(layerKey)})`, [versionId]);
}
```

- [ ] **Step 5: Call it from `activate()`**

In `packages/versioning/src/service.ts`, add the import:

```ts
import { refreshCurrentRows } from './currentRows';
```

and at the end of `activate()`, after the `if (result.rowCount === 0) { throw … }` block, append:

```ts
      // The stored answer to "which rows are the map now" (S1). Here, after the pointer moved
      // and in the caller's transaction, because this is the one function every path to
      // "active" goes through. Only the thematic layers have the column.
      if ((EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
        await refreshCurrentRows(client, layerKey as EditableLayerKey, versionId);
      }
```

- [ ] **Step 6: One resolver in the repository and the hierarchy**

In `packages/versioning/src/repository.ts`:
- delete `chainToRoot` and `resolvedSql(layerKey, chain)` with their comments;
- add `import { resolvedSql } from './resolve';`;
- replace `resolveFeatureIds` with:

```ts
    // An unknown version resolves to no features rather than to every feature.
    async resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      const { rows } = await pg.query(resolvedSql(layerKey), [versionId]);
      return rows.map((r) => r.id as string);
    },
```

In `packages/versioning/src/riverHierarchy.ts`, add `import { resolvedSql } from './resolve';` and replace the `CREATE TEMP TABLE res_rivers AS …` statement in `materialiseResolved` with:

```ts
  await client.query(
    // Every column Task 7's supersede step copies onto a new row, not just the ones the vote
    // reads: a superseding row must carry the feature's full current state.
    `CREATE TEMP TABLE res_rivers AS ${resolvedSql(
      'rivers',
      'external_id, feature_level, name, code, stream_order, length_m, parent_external_id, flows_into_external_id, match_confidence, geom'
    )}`,
    [versionId]
  );
```

Update the doc comment of `materialiseResolved`: replace the sentence "Why temp tables and not water.rivers_active: … Same reasoning, same fix as search's repository." with "Why temp tables: the build reads the resolved set many times, and the version it builds is not active yet, so water.rivers_active (the active state) is not what it needs."

In `packages/versioning/src/index.ts`, add:

```ts
export { resolvedSql } from './resolve';
export { refreshCurrentRows } from './currentRows';
```

In `apps/api/src/modules/layers/service.test.ts`, in the test that calls `versionsRepository(getPool()).resolvedSql('dams', [...])` (around line 305): delete the block from the comment `// Distinct ids mean the resolver can keep both.` through `expect(resolved).toContain(rowB.id);`. The assertion above it (two distinct `external_id` values) already proves `DISTINCT ON` keeps both rows. Remove the `versionsRepository` import if it becomes unused.

- [ ] **Step 7: Run the versioning suite**

Run: `cd packages/versioning && npx tsc -p tsconfig.json --noEmit && npm test`
Expected: PASS, including the six new tests; `riverHierarchy.test.ts` ("reproduces the committed hierarchy exactly") passes, which shows the resolver change did not change the build's output.

- [ ] **Step 8: Update the river builder pin**

`riverHierarchy.ts` changed, so the pin test in atlas-data fails. Because Step 7 showed the output is unchanged, the rivers load keeps `mappingRevision` 1 and only the digest is updated.

Run: `cd packages/atlas-data && npx vitest run src/descriptors/descriptors.test.ts`
Expected: FAIL with `+   "riverHierarchyCode": "<new digest>"`. Put that digest in place of the old one in `descriptors.test.ts` and rerun. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/versioning/src apps/api/src/modules/layers/service.test.ts packages/atlas-data/src/descriptors/descriptors.test.ts
git commit -F - <<'EOF'
feat(versioning): activate() duy trì cờ is_current; một bộ giải phiên bản duy nhất

resolvedSql (resolve.ts) là định nghĩa duy nhất về việc một phiên bản giải ra những dòng nào;
activate() dùng nó để chuyển cờ is_current sang các dòng của phiên bản mới, trong cùng
transaction. repository.resolveFeatureIds và materialiseResolved của phân cấp sông dùng chung
nó. Đầu ra của bộ dựng phân cấp không đổi (kiểm thử dựng lại cho kết quả y hệt), nên chỉ cập
nhật digest ghim, không tăng mappingRevision.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Retention

**Files:**
- Create: `packages/versioning/src/retention.ts`
- Create: `packages/versioning/src/retention.test.ts`
- Modify: `packages/versioning/src/service.ts` (`activate`)
- Modify: `packages/versioning/src/index.ts`
- Modify: `packages/atlas-data/src/stages/loadGeojson.ts` (unchanged path)
- Modify: `packages/atlas-data/src/ensureSeeded.ts` (unchanged path)
- Modify: `packages/atlas-data/src/stages/loadGeojson.db.test.ts`, `packages/atlas-data/src/adoptLegacy.db.test.ts` (pin existing versions in `inRollback`)

**Interfaces:**
- Consumes: `app.version_pins` (Task 1); `refreshCurrentRows` in `activate()` (Task 2).
- Produces:
  - `EARLIER_LOADS_KEPT = 2`;
  - `pruneVersions(client: PoolClient, layerKey: EditableLayerKey): Promise<{ versions: number; rows: number }>`;
  - `assertPrunable(versions: Array<{ id: string; parent: string | null }>, doomed: ReadonlySet<string>, layerKey: string): void` (pure, throws).

  All exported from `@webatlas/versioning`.

- [ ] **Step 1: Write the failing tests**

Create `packages/versioning/src/retention.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from './testPool';
import { assertPrunable, EARLIER_LOADS_KEPT, loadFeatures, versionsService } from './index';

// The real stations layer, inside transactions that are rolled back. Unlike the other suites,
// existing versions are NOT pinned here: pruning them inside the transaction is the point.
const dir = mkdtempSync(join(tmpdir(), 'retention-'));
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await closePool();
});
const file = join(dir, 'stations.geojson');
writeFileSync(file, JSON.stringify({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [108.05, 12.68] }, properties: { id: 'rt-1', name: 'R' } }],
}));

async function inRollback(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

const svc = () => versionsService(getPool());

async function load(c: pg.PoolClient, label: string): Promise<string> {
  const id = await svc().createIngestVersion(c, { layerKey: 'stations', source: 'retention.test', label });
  await loadFeatures(c, { table: 'stations', file, columns: (p) => ({ external_id: p.id, name: p.name }) }, id);
  await svc().activate(c, 'stations', id);
  return id;
}

async function edit(c: pg.PoolClient): Promise<string> {
  const draft = await svc().openEditDraft(c, 'stations');
  await svc().commitEditDraft(c, 'stations', draft);
  return draft;
}

const stationVersions = async (c: pg.PoolClient) =>
  (await c.query<{ id: string }>(`SELECT id::text AS id FROM app.dataset_versions WHERE layer_key = 'stations'`)).rows
    .map((r) => r.id).sort();
const rowsOf = async (c: pg.PoolClient, versionId: string) =>
  (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1`, [versionId])).rows[0].n;

describe('retention', () => {
  it('keeps the active chain and the two most recent earlier loads with their edits, and removes the rest with their rows', async () => {
    expect(EARLIER_LOADS_KEPT).toBe(2);
    await inRollback(async (c) => {
      const l1 = await load(c, 'L1');
      const e1 = await edit(c); // on L1
      const l2 = await load(c, 'L2');
      const e2 = await edit(c); // on L2
      const l3 = await load(c, 'L3');
      const l4 = await load(c, 'L4');
      // Active chain: L4. Earlier loads, newest first: L3, L2 (with E2). L1 and E1 go, and so
      // does every version this layer had before the test.
      expect(await stationVersions(c)).toEqual([l2, e2, l3, l4].sort());
      expect(await rowsOf(c, l1)).toBe(0);
      expect(await rowsOf(c, e1)).toBe(0);
      expect(await rowsOf(c, l2)).toBe(1);
    });
  });

  it('keeps a pinned version and its chain to the root, however old', async () => {
    await inRollback(async (c) => {
      const l1 = await load(c, 'L1');
      const e1 = await edit(c);
      await c.query(`INSERT INTO app.version_pins (version_id, holder) VALUES ($1, 'scenario:test')`, [e1]);
      await load(c, 'L2');
      await load(c, 'L3');
      await load(c, 'L4');
      const kept = await stationVersions(c);
      expect(kept).toContain(e1);
      expect(kept).toContain(l1);
      expect(await rowsOf(c, l1)).toBe(1);
    });
  });

  it('the active state is unchanged by pruning', async () => {
    await inRollback(async (c) => {
      for (const label of ['L1', 'L2', 'L3', 'L4']) await load(c, label);
      const { rows } = await c.query(`SELECT name FROM water.stations_active WHERE external_id = 'rt-1'`);
      expect(rows).toEqual([{ name: 'R' }]);
    });
  });
});

describe('assertPrunable', () => {
  const versions = [
    { id: 'root', parent: null },
    { id: 'old-edit', parent: 'root' },
    { id: 'kept-edit', parent: 'old-edit' },
  ];

  it('passes when nothing kept descends from what is removed', () => {
    expect(() => assertPrunable(versions, new Set(['old-edit', 'kept-edit']), 'stations')).not.toThrow();
  });

  it('throws, removing nothing, when a kept version descends from a removed one (the cascade would take it)', () => {
    expect(() => assertPrunable(versions, new Set(['old-edit']), 'stations')).toThrow(
      /stations: kept version kept-edit descends from old-edit, which would be removed; nothing was removed/
    );
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/versioning && npx vitest run src/retention.test.ts`
Expected: FAIL: `assertPrunable` / `EARLIER_LOADS_KEPT` not exported.

- [ ] **Step 3: Write `retention.ts`**

Create `packages/versioning/src/retention.ts`:

```ts
import type { PoolClient } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';

/** How many ingest versions outside the active chain a layer keeps, newest first, with their edits. */
export const EARLIER_LOADS_KEPT = 2;

/**
 * `parent_version_id` cascades on delete, so removing a version removes every version built on
 * it. The kept set is closed under "ancestor of" by construction; this checks it anyway, before
 * anything is deleted.
 */
export function assertPrunable(
  versions: Array<{ id: string; parent: string | null }>,
  doomed: ReadonlySet<string>,
  layerKey: string
): void {
  for (const v of versions) {
    if (!doomed.has(v.id) && v.parent !== null && doomed.has(v.parent)) {
      throw new Error(
        `pruneVersions(${layerKey}): kept version ${v.id} descends from ${v.parent}, which would be removed; nothing was removed`
      );
    }
  }
}

/**
 * Remove the layer's versions that retention does not keep (S1 spec §3), with their rows. Kept:
 * the active chain; the EARLIER_LOADS_KEPT most recent ingest versions outside it, with every
 * version built on them; every version in app.version_pins, with its chain to the root.
 *
 * Runs on the caller's client and transaction: from activate() right after the current flag
 * moved, and from the loader's "content unchanged" path under the layer lock. A layer with no
 * active version is left alone: without an active chain there is nothing to measure "earlier"
 * against.
 */
export async function pruneVersions(
  client: PoolClient,
  layerKey: EditableLayerKey
): Promise<{ versions: number; rows: number }> {
  const { rows: all } = await client.query<{ id: string; parent: string | null; doomed: boolean; active: boolean }>(
    `WITH RECURSIVE
       active_chain AS (
         SELECT id, parent_version_id FROM app.dataset_versions WHERE layer_key = $1 AND is_active
         UNION ALL
         SELECT p.id, p.parent_version_id FROM app.dataset_versions p JOIN active_chain c ON p.id = c.parent_version_id
       ),
       earlier_roots AS (
         SELECT id FROM app.dataset_versions
          WHERE layer_key = $1 AND kind = 'ingest' AND id NOT IN (SELECT id FROM active_chain)
          ORDER BY ingested_at DESC, id DESC
          LIMIT $2
       ),
       earlier_trees AS (
         SELECT id FROM earlier_roots
         UNION ALL
         SELECT v.id FROM app.dataset_versions v JOIN earlier_trees t ON v.parent_version_id = t.id
       ),
       pinned AS (
         SELECT v.id, v.parent_version_id
           FROM app.dataset_versions v JOIN app.version_pins p ON p.version_id = v.id
          WHERE v.layer_key = $1
         UNION ALL
         SELECT p.id, p.parent_version_id FROM app.dataset_versions p JOIN pinned c ON p.id = c.parent_version_id
       ),
       kept AS (
         SELECT id FROM active_chain UNION SELECT id FROM earlier_trees UNION SELECT id FROM pinned
       )
     SELECT v.id::text AS id, v.parent_version_id::text AS parent,
            v.id NOT IN (SELECT id FROM kept) AS doomed, v.is_active AS active
       FROM app.dataset_versions v
      WHERE v.layer_key = $1`,
    [layerKey, EARLIER_LOADS_KEPT]
  );
  if (!all.some((v) => v.active)) return { versions: 0, rows: 0 };
  const doomed = all.filter((v) => v.doomed).map((v) => v.id);
  if (doomed.length === 0) return { versions: 0, rows: 0 };
  assertPrunable(all, new Set(doomed), layerKey);

  // Rows first: water.<layer>.dataset_version_id has no cascade.
  const removedRows = await client.query(`DELETE FROM water.${layerKey} WHERE dataset_version_id = ANY($1::uuid[])`, [doomed]);
  await client.query(`DELETE FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [doomed]);
  return { versions: doomed.length, rows: removedRows.rowCount ?? 0 };
}
```

- [ ] **Step 4: Prune at the end of `activate()`**

In `packages/versioning/src/service.ts` add `import { pruneVersions } from './retention';` and extend the block added in Task 2:

```ts
      if ((EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
        await refreshCurrentRows(client, layerKey as EditableLayerKey, versionId);
        // Retention (S1 spec §3), in the same transaction: a failure here rolls the
        // activation back with the previous version still active and still flagged.
        await pruneVersions(client, layerKey as EditableLayerKey);
      }
```

In `packages/versioning/src/index.ts` add:

```ts
export { assertPrunable, EARLIER_LOADS_KEPT, pruneVersions } from './retention';
```

- [ ] **Step 5: Run the versioning suite**

Run: `cd packages/versioning && npx tsc -p tsconfig.json --noEmit && npm test`
Expected: PASS. If an existing test fails because a version it created three or more loads earlier was pruned, pin that version in the test (`INSERT INTO app.version_pins (version_id, holder) VALUES ($1, '<test file name>')`, inside the test's own transaction, or delete the pin in its cleanup if it commits) and say so in the Execution notes. Do not raise `EARLIER_LOADS_KEPT`.

- [ ] **Step 6: Prune on the loader's and `ensureSeeded`'s "unchanged" paths**

In `packages/atlas-data/src/stages/loadGeojson.ts`, change the import to:

```ts
import { loadFeatures, pruneVersions, stampAdminCodes, versionsService } from '@webatlas/versioning';
```

and in `loadVersioned`, inside `if (adoption.result !== 'mismatch') {`, replace

```ts
    if (isEditable(load.layer)) {
      for (const v of chain) await stampAdminCodes(client, load.layer, v.id);
    }
```

with

```ts
    if (isEditable(load.layer)) {
      for (const v of chain) await stampAdminCodes(client, load.layer, v.id);
      // Nothing is activated here, so retention would otherwise wait for the next real load: an
      // existing machine's backlog goes on its next build instead. Under the layer lock taken above.
      await pruneVersions(client, load.layer);
    }
```

In `packages/atlas-data/src/ensureSeeded.ts`, add the import `import { pruneVersions } from '@webatlas/versioning';` and `import type { EditableLayerKey } from '@webatlas/shared';`, then in `seedOne`, replace

```ts
        const stamped = restamp ? (await applyLoadGeojson(pool, client, load, { supersedeEdits: false })).summary : null;
```

with

```ts
        const stamped = restamp ? (await applyLoadGeojson(pool, client, load, { supersedeEdits: false })).summary : null;
        // The loader prunes on its re-stamp path; without a re-stamp, retention runs here.
        if (!restamp) await pruneVersions(client, stage.layer as EditableLayerKey);
```

In `packages/atlas-data/src/stages/loadGeojson.db.test.ts` and `packages/atlas-data/src/adoptLegacy.db.test.ts`, inside each `inRollback` helper, right after `await c.query('BEGIN');` (the client variable is `client` in loadGeojson.db.test.ts), add:

```ts
    // Keep the layer's existing versions out of retention, so version counts measure only this test.
    await c.query(`INSERT INTO app.version_pins (version_id, holder) SELECT id, 'test' FROM app.dataset_versions`);
```

Add this test to `packages/atlas-data/src/stages/loadGeojson.db.test.ts`, after the test "holds the layer's version rows for the whole load":

```ts
  it('prunes a layer it finds unchanged, keeping the two most recent earlier loads', async () => {
    const stage = ALL_DATASETS.find((d) => d.id === 'stations')!.stages.find((s) => s.type === 'load-geojson')!;
    if (stage.type !== 'load-geojson') throw new Error('unreachable');
    await inRollback(async (c) => {
      // Three loads that were never activated, newer than every (pinned) existing version.
      const svc = versionsService(pool);
      const made: string[] = [];
      for (const label of ['old-1', 'old-2', 'old-3']) {
        made.push(await svc.createIngestVersion(c, { layerKey: 'stations', source: 'prune test', label }));
      }
      const out = await applyLoadGeojson(pool, c, resolveLoad(stage), { supersedeEdits: false });
      expect(out.action).toBe('restamped');
      const { rows } = await c.query<{ id: string }>(
        `SELECT id::text AS id FROM app.dataset_versions WHERE id = ANY($1::uuid[])`, [made]
      );
      // The two newest earlier loads stay; the oldest of the three goes.
      expect(rows.map((r) => r.id).sort()).toEqual([made[1], made[2]].sort());
    });
  });
```

- [ ] **Step 7: Run the atlas-data suites**

Run (from `packages/atlas-data`):

```bash
npx tsc -p tsconfig.json --noEmit && npm test
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2- | tr -d '\r')" && npx vitest run .db.test; unset DATABASE_URL
```

Expected: hermetic suite PASS; database tests PASS (the two GeoServer ones skip). `ensureSeeded.db.test.ts` prunes the dev database for real on its first call: that is retention doing its job.

- [ ] **Step 8: Commit**

```bash
git add packages/versioning/src packages/atlas-data/src
git commit -F - <<'EOF'
feat(versioning): giữ chuỗi đang hoạt động, hai lần nạp gần nhất và các phiên bản được ghim

pruneVersions xoá các phiên bản ngoài quy tắc giữ lại (cùng các dòng của chúng): chạy cuối
activate() trong cùng transaction, và trên nhánh "nội dung không đổi" của bộ nạp và
ensureSeeded, để máy đang có tồn đọng được dọn ở lần build kế tiếp. assertPrunable kiểm tra
trước khi xoá rằng không phiên bản nào được giữ lại nằm dưới một phiên bản bị xoá (khoá ngoại
cha xoá dây chuyền).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The API reads through the views

**Files:**
- Modify: `apps/api/src/modules/assistant/tools/data/helpers.ts` (delete `layerTable`, `candidateCtes`; rewrite `resolveFeature`; update doc comments)
- Modify: `apps/api/src/modules/assistant/tools/data/areaOf.ts`, `distanceBetween.ts`, `featuresInAdminUnit.ts`, `featuresInView.ts`, `relatedFeatures.ts`, `filterByAttribute.ts` (comment only)
- Modify: `apps/api/src/modules/analysis/ops/nearest.ts`, `apps/api/src/modules/analysis/ops/selectWithin.ts`
- Modify: `apps/api/src/modules/roi/resolve.ts` (`wholeRiverSource`)
- Modify: `apps/api/src/modules/search/repository.ts` (delete `layerCtes`)
- Create: `apps/api/src/db/activeReads.test.ts`

**Interfaces:**
- Consumes: the filter views (Task 1), kept current by `activate()` (Task 2).
- Produces: no new exports. `layerTable` and `candidateCtes` no longer exist.

- [ ] **Step 1: Write the failing guard test**

Create `apps/api/src/db/activeReads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

// Read and write the base tables on purpose: the layer registry names them, the layers
// repository writes edit drafts into them, and the scripts build derived data.
const ALLOWED = ['layers/registry.ts', 'modules/layers/repository.ts', 'scripts/'];

// A thematic base table in SQL text: water.<layer>, or water.${...}, not followed by a suffix
// such as _active, _detail or _overview.
const BASE_TABLE =
  /water\.(?:dams|stations|flood_zones|drought_points|saltwater_intrusion|flood_generation|lakes|rivers|\$\{[^}]+\})(?![a-z_]|\$\{)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'migrations' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the active state is read through the *_active views (S1 spec §2)', () => {
  it('no source file outside the allow-list names a thematic base table in code', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (ALLOWED.some((a) => rel.startsWith(a))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (BASE_TABLE.test(code)) offenders.push(`${rel}:${i + 1}: ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/api && npx vitest run src/db/activeReads.test.ts`
Expected: FAIL, listing `modules/assistant/tools/data/helpers.ts` (`return \`water.${key}\``), `modules/roi/resolve.ts` (two lines), and `modules/search/repository.ts` (several lines).

- [ ] **Step 3: helpers.ts**

In `apps/api/src/modules/assistant/tools/data/helpers.ts`:

- Delete `layerTable` (with its doc comment) and `candidateCtes` (with its doc comment).
- Replace the doc comment of `layerView` with:

```ts
/**
 * The active-state view for a layer: a plain filter on the rows' stored is_current flag
 * (migration 22), so a predicate on it reaches the table's partial indexes. This is the only
 * place in the data tools where any part of a query is built from a tool argument that is not
 * a bind parameter, and it goes through assertKnownLayer first.
 */
```

- In the doc comment of `entityPredicate`, replace the paragraph starting "Collection queries apply it twice, like any other predicate over candidateCtes" with:

```ts
 * Collection queries apply it in their WHERE clause, so a LIMIT or a nearest-neighbour
 * over-fetch is not spent on reaches and ways.
```

  Keep the rest of that comment.
- Replace the body of `resolveFeature` from `const table = layerTable(layerKey);` to the end of the function with:

```ts
  const view = layerView(layerKey); // allowlist check before any interpolation
  // Column names come from the shared constant map, never from tool input.
  const props = Object.keys(LAYER_ATTRIBUTE_MAP[layerKey].attributes)
    .map((c) => `'${c}', ${c}::text`)
    .join(', ');
  const geometrySql = opts.simplify === false ? 'ST_AsGeoJSON(geom, 7)::json' : simplifiedGeoJsonSql('geom');
  const { rows } = await db.query<ResolvedFeature>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            ${geometrySql} AS geometry,
            jsonb_build_object(${props}) AS properties
       FROM ${view}
      WHERE id = $1 AND geom IS NOT NULL`,
    [featureId]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: The assistant tools**

`areaOf.ts`: import `layerView` instead of `candidateCtes, layerTable`; delete the `const ctes = candidateCtes(...)` statement and its comment; the query becomes:

```ts
        ctx.pool.query(
          `SELECT name,
                  round((ST_Area(geom::geography) / 1000000)::numeric, 3)::float8 AS "areaKm2",
                  round((ST_Perimeter(geom::geography) / 1000)::numeric, 2)::float8 AS "perimeterKm"
             FROM ${layerView(input.layerKey)}
            WHERE id = $1`,
          [input.featureId]
        ),
```

  An id that is not the feature's current row (an older version's row) matches nothing, as before.

`distanceBetween.ts`: import `layerView` instead of `candidateCtes, layerTable`; delete both `candidateCtes` calls and their comment; the query becomes:

```ts
        ctx.pool.query(
          `SELECT a.name AS "fromName", b.name AS "toName",
                  round((ST_Distance(a.geom::geography, b.geom::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
             FROM ${layerView(input.fromLayerKey)} a, ${layerView(input.toLayerKey)} b
            WHERE a.id = $1 AND b.id = $2`,
          [input.fromFeatureId, input.toFeatureId]
        ),
```

`featuresInAdminUnit.ts`: import `layerView` instead of `candidateCtes, layerTable`. Replace the file's Vietnamese doc comment with:

```ts
/**
 * A relational query, not a geometric one: the administrative codes are stamped on every
 * feature in advance (packages/versioning, adminStamp.ts), and the view's partial GIN indexes
 * on province_codes / ward_codes serve the array test directly.
 */
```

  Delete the "Candidate step" comment, the `const ctes = …` statement and the "superset" comment; the query becomes:

```ts
      const { rows } = await ctx.pool.query<{ featureId: string; name: string | null; lon: number; lat: number; total: string }>(
        `SELECT id::text AS "featureId", name, ${POINT_SQL}, count(*) OVER () AS total
           FROM ${layerView(input.layerKey)}
          WHERE ${column} && ARRAY[$1] AND ${entityPredicate(input.layerKey)}
          ORDER BY name NULLS LAST
          LIMIT $2`,
        [input.code, ROW_LIMIT]
      );
```

  Change the comment above `const column = …` to end "…never from raw tool input, so this interpolation is safe the same way layerView's is."

`featuresInView.ts`: import `layerView` instead of `candidateCtes, layerTable`; delete the candidate comment, the `ctes` statement and the "superset" comment (keep the sentence about `count(*) OVER()`); the query becomes:

```ts
        ctx.pool.query<{ featureId: string; name: string | null; lon: number; lat: number; totalCount: string }>(
          `SELECT id::text AS "featureId", name, ${POINT_SQL}, count(*) OVER()::text AS "totalCount"
             FROM ${layerView(input.layerKey)}
            WHERE geom && ${envelope} AND ${entityPredicate(input.layerKey)}
            ORDER BY name NULLS LAST
            LIMIT ${ROW_LIMIT}`,
          bbox
        ),
```

`relatedFeatures.ts`: import `layerView` instead of `candidateCtes, layerTable`. The anchor query becomes:

```ts
        ctx.pool.query<{ name: string | null; geomWkt: string }>(
          `SELECT name, ST_AsText(geom) AS "geomWkt"
             FROM ${layerView(input.layerKey)}
            WHERE id = $1`,
          [input.featureId]
        ),
```

  and the related query (delete `relatedCtes` and the comment above it that mentions the candidate step running "across every dataset version"):

```ts
      const { rows } = await ctx.pool.query(
        `SELECT id::text AS "featureId", name, ${POINT_SQL},
                round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
           FROM ${layerView(input.relatedLayerKey)}
          WHERE ST_DWithin(geom, ST_GeomFromText($1, 4326), $2)
            AND ST_DWithin(geom::geography, ST_GeomFromText($1, 4326)::geography, $3)
            AND ${entityPredicate(input.relatedLayerKey)}
          ORDER BY ${distanceExpr}
          LIMIT ${ROW_LIMIT}`,
        [anchor.geomWkt, radiusDegrees, radiusM]
      );
```

  The planar `ST_DWithin` in degrees is what reaches the spatial index; the geography one is the exact radius. Keep `CONSERVATIVE_KM_PER_DEGREE` and its comment, replacing "re-applies the true radius on the much smaller resolved set" with "re-applies the true radius on the rows the index found".

`filterByAttribute.ts`: replace the long comment that begins `// Deliberately NOT using candidateCtes here` with:

```ts
      // ILIKE on an unindexed text column: the view is scanned once whatever the match, which
      // is cheap now that the view is a plain filter on is_current.
```

- [ ] **Step 5: Analysis and ROI**

`analysis/ops/selectWithin.ts`: import `layerView` instead of `candidateCtes` (and drop `layerTable` if imported); replace the loop body's query with:

```ts
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM ${layerView(key)}
        WHERE geom IS NOT NULL AND ${inArea.sql} AND ${entity}
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [inArea.param, MAX_RESULT_ITEMS]
    );
```

  Delete the `const ctes = …` line. In the function's doc comment, replace "The candidate step reaches the base table's index; the real predicate, NOT deleted and the entity predicate are re-applied after version resolution (handover §4.2)." with "The predicate reaches the view's partial indexes directly (S1)."

`analysis/ops/nearest.ts`: import `LAYER_LABELS, POINT_SQL, entityPredicate, layerView, type Queryable` (drop `candidateCtes`, `layerTable`). Replace the body of `queryNearest` from `const ctes = candidateCtes(` to the end of the function (fast path, fallback count and exact query) with:

```ts
  const view = layerView(q.layerKey);
  const distanceExpr = `ST_Distance(geom::geography, ${point}::geography)`;
  // The planar KNN (<->) reaches the view's partial spatial index; the over-fetch is then
  // re-ordered by true geodesic distance. The view holds one row per feature, so the over-fetch
  // returns min(layer size, overfetch) rows and cannot be starved by older versions' rows, which
  // is what the old exact-query fallback existed for.
  const { rows } = await db.query<NearestRow>(
    `SELECT id::text AS "featureId", name, ${POINT_SQL},
            round((${distanceExpr} / 1000)::numeric, 2)::float8 AS "distanceKm"
       FROM (SELECT id, name, geom FROM ${view}
              WHERE ${entity} AND ${notExcluded}
              ORDER BY geom <-> ${point}
              LIMIT $4) AS candidates
      ORDER BY ${distanceExpr}
      LIMIT $3`,
    [q.lon, q.lat, q.limit, overfetch, q.excludeId ?? null]
  );
  return rows;
}
```

  Keep `const point`, `const overfetch`, `const entity` (and the comment above it) and `const notExcluded` above it as they are. `POINT_SQL` reads only `geom`, which the subquery selects. Replace the comment on `NEAREST_OVERFETCH_FACTOR` with: "How many nearest-by-planar-distance candidates to take per requested result before re-ordering by geodesic distance. Planar and geodesic order differ only slightly at this latitude, so 20x is generous."

`roi/resolve.ts`: change the import to `import { resolveFeature, type Queryable } from '../assistant/tools/data/helpers';` and replace the two queries in `wholeRiverSource`:

```ts
  const { rows: [w] } = await db.query<{ parent: string | null }>(
    `SELECT parent_external_id AS parent FROM water.rivers_active WHERE id = $1`,
    [wayId]
  );
```

```ts
    const { rows: [r] } = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM water.rivers_active WHERE external_id = $1 AND feature_level = 1`,
      [w.parent]
    );
```

  and delete the two `candidateCtes(...)` statements.

- [ ] **Step 6: Search**

In `apps/api/src/modules/search/repository.ts`:

- Delete `layerCtes` and the long comment above it (from "The water.<layer>_active views resolve…" to the end of the paragraph about rivers' three levels). Replace that comment with:

```ts
// Each layer is searched through its active view, a plain filter that the partial trigram
// index serves (S1). Rivers carry three levels since the topology ingest; search means the
// ENTITY (entityPredicate): a level-1 row is one river, so "thu" returns Sông Thu Bồn once, not
// several of its OSM ways. Reaches (level 2) have no name at all.
```

- Replace `layerSelect`'s `FROM resolved_${key}` and `WHERE NOT deleted AND geom IS NOT NULL …` with:

```ts
      FROM water.${key}_active
      WHERE geom IS NOT NULL AND name IS NOT NULL AND name % $1
        AND ${entityPredicate(key)}`;
```

- In `searchByName`, delete `const ctes = …` and `const prelude = …`, and run `\`${selects.join(' UNION ALL ')} ORDER BY sim DESC, name ASC LIMIT $2\``. Replace the dedup comment with: "Self-defending, not just relying on the controller's allowlist refine: a duplicate token (`sources=dams,dams`) would return every hit twice, and anything outside the allowlist must never reach the SQL below, which interpolates these keys."

- [ ] **Step 7: Run the guard test, type-check, and the API suites that read layers**

```bash
cd apps/api && npx tsc -p tsconfig.json --noEmit && npx vitest run src/db/activeReads.test.ts src/modules/assistant src/modules/analysis src/modules/roi src/modules/search
```

Expected: tsc clean; the guard PASSES; every assistant, analysis, ROI and search test PASSES with its assertions unchanged. If a test fails, the rewrite is wrong, not the test: compare the query with the old one.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -F - <<'EOF'
refactor(api): đọc trạng thái đang hoạt động qua view *_active; bỏ candidateCtes và layerCtes

Hai bản chép tay của phép giải chuỗi phiên bản chỉ tồn tại để vòng qua view chậm. Nay view là
bộ lọc trên is_current và PostgreSQL inline được, nên các công cụ của trợ lý, phép phân tích,
ROI và tìm kiếm truy vấn thẳng view với đúng điều kiện của mình. Nhánh dự phòng của "gần nhất"
không còn cần vì view chỉ có một dòng mỗi đối tượng. Một kiểm thử chặn việc đọc thẳng bảng gốc.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verify on the dev stack, document, open the PR

**Files:**
- Modify: `docs/architecture/database-architecture.md`
- Modify: `docs/superpowers/plans/2026-10-04-active-data-s1.md` (Execution notes)
- Delete: `packages/versioning/measure-activation.local.ts`

- [ ] **Step 1: All suites**

From the repo root:

```bash
for p in packages/atlas-data packages/versioning apps/api; do npx tsc -p $p/tsconfig.json --noEmit && echo "tsc $p ok"; done
npm run test:versioning
npm run test:api
npm run test:shared
npm run test -w @webatlas/web
(cd packages/atlas-data && npm test && export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2- | tr -d '\r')" && npx vitest run .db.test)
```

Expected: everything PASSES. API 461 (434 + 26 in `currentFlag.test.ts` + 1 guard); versioning 52 + 6 (`currentRows.test.ts`) + 5 (`retention.test.ts`) = 63; atlas-data database tests 43 + 1 (Task 3, Step 6).

- [ ] **Step 2: Retention on dev**

```bash
npm run atlas:seed
q() { MSYS_NO_PATHCONV=1 docker exec webatlas-db-1 psql -U webatlas -d webatlas -At -c "$1"; }
q "SELECT layer_key, count(*) FILTER (WHERE kind = 'ingest') AS loads, count(*) AS versions FROM app.dataset_versions GROUP BY 1 ORDER BY 1"
```

Expected: at most 3 loads per layer; total versions about 24 (was 241).

- [ ] **Step 3: The success criteria**

```bash
for v in lakes_active rivers_active rivers_detail; do
  echo "$v: $(q "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM water.$v WHERE geom && ST_MakeEnvelope(108.0, 12.6, 108.1, 12.7, 4326)" | grep 'Execution Time')"
done
q "EXPLAIN SELECT * FROM water.lakes_active WHERE geom && ST_MakeEnvelope(108.0, 12.6, 108.1, 12.7, 4326)" | grep -i "index"
(cd packages/versioning && export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../apps/api/.env | cut -d= -f2- | tr -d '\r')" && npx tsx measure-activation.local.ts)
npm run atlas:status && npm run atlas:verify
```

Expected:
- each map-window query under 50 ms, and the plan for `lakes_active` shows `lakes_current_geom_idx`;
- rivers activation at most 2 s above the Task 1 baseline;
- `atlas:status` 14 `ok`;
- `atlas:verify` `all 50 checks passed`.

Then delete `packages/versioning/measure-activation.local.ts`.

- [ ] **Step 4: Document**

In `docs/architecture/database-architecture.md`, at the section that introduces the `*_active` views (search for "_active"), add a subsection:

```markdown
### How the active state is stored (since migration 22)

Each thematic table carries `is_current`: true exactly for the rows the layer's active
version chain resolves to, tombstones excluded. `versionsService.activate()` in
`packages/versioning` is the only writer. It moves the flag in the same transaction as the
active pointer, using `resolvedSql`, the one definition of what a version resolves to. Each
`water.<layer>_active` view is a plain `WHERE is_current` filter with partial indexes behind
it (geometry, admin codes, name trigram, `external_id`), so read the active state through the
views and never resolve the chain by hand.

Retention: after every activation, and when the loader finds a layer unchanged,
`pruneVersions` keeps the active chain, the two most recent earlier loads with their edits, and
every version listed in `app.version_pins` with its chain to the root; everything else goes,
rows first. Scenarios (S4) pin the versions they branched from.
```

  Where the document says that `rivers_active` (or the views generally) is an optimizer fence (around the 120 s measurement, near line 329), add after that paragraph: "This was true until migration 22; the views are now plain filters (see 'How the active state is stored')."

- [ ] **Step 5: Execution notes, commit, push, PR**

Append to this plan an `## Execution notes` section with the baseline numbers (Task 1, Step 1), the measured results (Step 3), the version counts (Step 2), the test totals, and any test that had to pin a version (Task 3, Step 5). Then:

```bash
git add docs/architecture/database-architecture.md docs/superpowers/plans/2026-10-04-active-data-s1.md
git commit -F - <<'EOF'
docs: S1 — cách lưu trạng thái đang hoạt động, chính sách giữ phiên bản, số đo trước và sau

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push -u origin feat/active-data-s1
```

Open a PR against `main` with a Vietnamese description: summary, the before/after table (map-window times, version count, activation time), the test totals, and the note that migration 22 backfills data. End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Watch CI until all four jobs pass. Merging is the user's call.

## Execution notes

Baseline (Task 1, before any change): lakes_active 1218 ms, rivers_active 1425 ms, rivers_detail 192 ms (map-window EXPLAIN ANALYZE); rivers activation 34.3 / 34.4 / 35.9 s; 241 versions (34 per small layer, 3 for rivers).

After S1 (dev stack): lakes_active 5.6 ms (Bitmap Index Scan on `lakes_current_geom_idx`), rivers_active 0.7 ms, rivers_detail 0.8 ms. Rivers activation (now including flag refresh and prune) 48.5 / 47.6 / 48.2 s, about 13 s above baseline, over the 2 s budget. Profiling shows the flag refresh (`refreshCurrentRows`) costs about 5 s (clear 1.7 s plus set 3.2 s, because it rewrites every current row twice); a diff-only refresh (`AND id NOT IN (...)` / `AND NOT is_current`) measured 0.2 s plus 0.3 s. Not applied in this PR; the remaining ~8 s is not yet attributed. Follow-up.

Versions after `atlas:seed` and pruning: dams 2, drought_points 3, flood_generation 3, flood_zones 3, lakes 3, rivers 3, saltwater_intrusion 3, stations 2 (22 total, was 241). `atlas:status` 14 ok; `atlas:verify` all 50 checks passed.

Tests: versioning 65, api 459, shared 119, web 543, atlas-data unit 381 (56 skipped), atlas-data database 42 (2 skipped: probes.db.test needs GeoServer env), all passing; tsc clean for atlas-data, versioning, api. The counts differ from the plan's expectations because reviews added and removed tests.

Tests that had to pin a version (Task 3, Step 5): none beyond the `inRollback` pins in loadGeojson.db.test.ts and adoptLegacy.db.test.ts; no assertion changed.

Behaviour change: `commitEditDraft` refuses a stale edit commit (ConflictError, HTTP 409).
