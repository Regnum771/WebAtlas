# Map Versioning & Provenance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-overwrite seed pipeline into a versioned, provenance-recording store where every ingest creates a full standalone version and every steward edit session publishes a copy-on-write version, with the live map always serving one unambiguous "active" version.

**Architecture:** A new `app.dataset_versions` registry is the spine and provenance record. Each `water.*` feature table gains `dataset_version_id` and a `deleted` tombstone. A single resolver (`versions` module) answers "the feature set for version V" — a flat filter for ingest versions, a parent-chain walk for edit versions. Ingest and steward edits both route through this model; GeoServer serves per-layer SQL views that resolve the active version, so clients are unchanged.

**Tech Stack:** TypeScript (ESM, `.ts`), PostgreSQL + PostGIS, `node-pg-migrate` (`.cjs` migrations), `pg` (raw SQL, `Pool`), Vitest (DB-backed integration tests), Fastify.

## Global Constraints

- **Migrations are `node-pg-migrate` `.cjs` files** using the `pgm` builder API; place in `apps/api/src/db/migrations/`. Filename prefix is a monotonically increasing 13-digit timestamp; next is `1000000000004`. Every migration has `exports.up` and `exports.down`.
- **Feature tables live in schema `water`; the versions registry lives in schema `app`.** The seven thematic layers are exactly: `dams`, `rivers`, `stations`, `flood_zones`, `drought_points`, `saltwater_intrusion`, `flood_generation` (from `EDITABLE_LAYER_KEYS` in `@webatlas/shared`).
- **`app.audit_log` and `auditService` are unchanged** — the within-session fine trail stays exactly as-is. Do not touch `apps/api/src/modules/audit/`.
- **Two version kinds, stored differently:** `ingest` = full standalone (flat filter); `edit` = copy-on-write off a parent (chain walk). Exactly one resolver knows the difference.
- **The active-version invariant is a DB constraint**, not app logic: a partial unique index forbids two active versions of one layer.
- **`feature_count` semantics:** for an `ingest` version, the resolved row total it holds; for an `edit` version, the number of features the session *changed* (rows it stores), never the resolved total.
- **Edit versions are discrete releases** — linear off their parent, no branch/merge, no rebasing later edits onto an older active pointer.
- **DB-backed tests** use `getPool()` / `closePool()` from `apps/api/src/db/pool.ts` and require a migrated database with `DATABASE_URL` set. Follow the existing style in `apps/api/src/db/schema.test.ts` and `apps/api/src/modules/layers/service.test.ts`. Run tests with `npm test` (from `apps/api`), which runs `vitest run`.
- **Out of scope (do not build):** timeline scrubber UI, satellite/temporal raster, actual HydroSHEDS data, branch/merge, arbitrary-timestamp reconstruction, audit read-side (restore/diff), cross-layer relationships, version pruning/retention. New HTTP routes for edit sessions are **not** in this plan — the edit-session model is built at the service/repository layer as the seam a later frontend sub-spec consumes.

---

## File Structure

**New files:**
- `apps/api/src/db/migrations/1000000000004_dataset-versions.cjs` — the `dataset_versions` registry, per-table `dataset_version_id` + `deleted`, external_id uniqueness change, backfill v1.
- `apps/api/src/db/migrations/1000000000005_active-version-views.cjs` — per-layer `water.<layer>_active` resolving views.
- `apps/api/src/modules/versions/repository.ts` — raw-SQL access to `app.dataset_versions` and the §4 resolver query.
- `apps/api/src/modules/versions/service.ts` — version lifecycle (create ingest version, create/commit/discard edit draft, resolve).
- `apps/api/src/modules/versions/repository.test.ts` — resolver + registry constraint tests.
- `apps/api/src/modules/versions/service.test.ts` — ingest-as-version, edit-session commit/discard tests.

**Modified files:**
- `apps/api/src/db/seeds/registry.ts` — `SeedLayer` gains `source` / `label` provenance metadata.
- `apps/api/src/db/seeds/run.ts` — ingest-as-version transaction (§6) replacing in-place `ON CONFLICT` overwrite.
- `apps/api/src/db/seeds/seed.test.ts` — assert seeding creates an active ingest version and a second run creates a second version.
- `apps/api/src/modules/layers/repository.ts` — feature insert/update/remove become version-aware (write to a target `dataset_version_id`, tombstone on delete).
- `apps/api/src/modules/layers/service.ts` — edit-session working state (§7): `create`/`update`/`remove` route to an open draft edit-version.
- `apps/api/src/modules/layers/service.test.ts` — edit-session behavior tests.
- `apps/api/src/geoserver/publish.ts` — publish the `_active` views (repoint `nativeName`).

---

## §5 serving decision (locked)

GeoServer keeps serving one featuretype per layer, but its `nativeName` points at a SQL view `water.<layer>_active` that applies the §4 resolver over that layer's active version. Resolution lives in the DB; the app layer and clients are unchanged. This is realized in Task 7 (views) and Task 8 (GeoServer repoint).

---

## Version-kind reference (used by every task)

```
kind        parent_version_id   resolution                         deleted set?
----        -----------------   ----------                         ------------
ingest      NULL (enforced)     flat: WHERE dataset_version_id = V   never
                                       AND NOT deleted
edit        NOT NULL (enforced) chain walk from V up to root ingest, yes (tombstones)
                                nearest-version-wins per external_id,
                                tombstones absent
```

---

### Task 1: `dataset_versions` registry table + constraints (migration, up/down only)

Creates the registry table and its constraints. No feature-table changes yet — this task is independently testable as "the spine exists and refuses bad rows."

**Files:**
- Create: `apps/api/src/db/migrations/1000000000004_dataset-versions.cjs`
- Test: `apps/api/src/modules/versions/repository.test.ts` (constraints portion)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: table `app.dataset_versions` with columns
  `id uuid pk`, `layer_key text notNull`, `kind app.dataset_version_kind notNull` (enum `'ingest' | 'edit'`),
  `parent_version_id uuid null → app.dataset_versions(id)`, `source text notNull`, `source_version text null`,
  `label text notNull`, `ingested_at timestamptz notNull default now()`, `ingested_by uuid null → app.users(id)`,
  `feature_count integer null`, `is_active boolean notNull default false`, `notes text null`.
  Partial unique index `dataset_versions_active_per_layer` on `(layer_key) where is_active`.
  Check constraint `dataset_versions_kind_parent` enforcing kind↔parent nullness.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/versions/repository.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';

afterAll(async () => {
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key LIKE 'zz_%'`);
  await closePool();
});

async function insertVersion(fields: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(fields);
  const vals = Object.values(fields);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await getPool().query(
    `INSERT INTO app.dataset_versions (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    vals
  );
  return rows[0].id;
}

describe('app.dataset_versions constraints', () => {
  it('accepts an ingest version with a null parent', async () => {
    const id = await insertVersion({
      layer_key: 'zz_ok', kind: 'ingest', source: 'seed', label: 'version 1', is_active: false,
    });
    expect(id).toBeTruthy();
  });

  it('rejects an ingest version that has a parent', async () => {
    const parent = await insertVersion({
      layer_key: 'zz_bad_ingest', kind: 'ingest', source: 'seed', label: 'v1', is_active: false,
    });
    await expect(insertVersion({
      layer_key: 'zz_bad_ingest', kind: 'ingest', source: 'seed', label: 'v2',
      parent_version_id: parent, is_active: false,
    })).rejects.toThrow(/dataset_versions_kind_parent|check constraint/i);
  });

  it('rejects an edit version with a null parent', async () => {
    await expect(insertVersion({
      layer_key: 'zz_bad_edit', kind: 'edit', source: 'edit session', label: 'edits', is_active: false,
    })).rejects.toThrow(/dataset_versions_kind_parent|check constraint/i);
  });

  it('refuses two active versions of the same layer', async () => {
    await insertVersion({
      layer_key: 'zz_active', kind: 'ingest', source: 'seed', label: 'v1', is_active: true,
    });
    await expect(insertVersion({
      layer_key: 'zz_active', kind: 'ingest', source: 'seed', label: 'v2', is_active: true,
    })).rejects.toThrow(/dataset_versions_active_per_layer|unique/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: FAIL — `relation "app.dataset_versions" does not exist`.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/db/migrations/1000000000004_dataset-versions.cjs`:

```javascript
/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType({ schema: 'app', name: 'dataset_version_kind' }, ['ingest', 'edit']);

  pgm.createTable(
    { schema: 'app', name: 'dataset_versions' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      layer_key: { type: 'text', notNull: true },
      kind: { type: 'app.dataset_version_kind', notNull: true },
      parent_version_id: {
        type: 'uuid',
        references: { schema: 'app', name: 'dataset_versions' },
        onDelete: 'CASCADE',
      },
      source: { type: 'text', notNull: true },
      source_version: { type: 'text' },
      label: { type: 'text', notNull: true },
      ingested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      ingested_by: { type: 'uuid', references: { schema: 'app', name: 'users' }, onDelete: 'SET NULL' },
      feature_count: { type: 'integer' },
      is_active: { type: 'boolean', notNull: true, default: false },
      notes: { type: 'text' },
    }
  );

  // Every version query filters by layer_key.
  pgm.createIndex({ schema: 'app', name: 'dataset_versions' }, 'layer_key');

  // "The current map" is always unambiguous: one active version per layer.
  pgm.createIndex({ schema: 'app', name: 'dataset_versions' }, 'layer_key', {
    name: 'dataset_versions_active_per_layer',
    unique: true,
    where: 'is_active',
  });

  // ingest ⇒ null parent; edit ⇒ non-null parent.
  pgm.addConstraint({ schema: 'app', name: 'dataset_versions' }, 'dataset_versions_kind_parent', {
    check: `(kind = 'ingest' AND parent_version_id IS NULL) OR (kind = 'edit' AND parent_version_id IS NOT NULL)`,
  });
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'app', name: 'dataset_versions' });
  pgm.dropType({ schema: 'app', name: 'dataset_version_kind' });
};
```

- [ ] **Step 4: Apply the migration**

Run (from `apps/api`): `npm run migrate:up`
Expected: migration `1000000000004_dataset-versions` runs, "Migrations complete".

- [ ] **Step 5: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: PASS (all four constraint tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/1000000000004_dataset-versions.cjs apps/api/src/modules/versions/repository.test.ts
git commit -m "feat(api): add app.dataset_versions registry with kind/parent + active constraints"
```

---

### Task 2: Feature tables gain `dataset_version_id` + `deleted`, per-version uniqueness, backfill v1

Extends the same migration file (`1000000000004`) to alter every `water.*` table and backfill existing rows as each layer's "version 1". Kept in Task 1's migration file because the two are one atomic schema change; split into its own task because it is independently testable ("existing data became version 1, still served").

**Files:**
- Modify: `apps/api/src/db/migrations/1000000000004_dataset-versions.cjs`
- Test: `apps/api/src/modules/versions/repository.test.ts` (backfill portion, appended)

**Interfaces:**
- Consumes: `app.dataset_versions` (Task 1).
- Produces: each `water.<layer>` table has `dataset_version_id uuid notNull → app.dataset_versions(id)` (indexed) and `deleted boolean notNull default false`; the old global unique index on `external_id` is dropped and replaced by unique `(dataset_version_id, external_id)`. After migrate, every layer has exactly one `is_active` ingest version and every existing feature carries its `dataset_version_id`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/versions/repository.test.ts`:

```typescript
const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

describe('backfill: existing data is version 1', () => {
  it('each thematic layer has exactly one active ingest version', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS n FROM app.dataset_versions
         WHERE layer_key = $1 AND kind = 'ingest' AND is_active`,
        [layer]
      );
      expect(rows[0].n).toBe(1);
    }
  });

  it('every feature row carries a dataset_version_id', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS bad FROM water.${layer} WHERE dataset_version_id IS NULL`
      );
      expect(rows[0].bad).toBe(0);
    }
  });

  it('has a composite (dataset_version_id, external_id) unique index and no global external_id unique', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='water' AND tablename=$1`,
        [layer]
      );
      const defs = rows.map((r) => r.indexdef);
      const hasComposite = defs.some(
        (d) => /unique/i.test(d) && /dataset_version_id/i.test(d) && /external_id/i.test(d)
      );
      const hasGlobal = defs.some(
        (d) => /unique/i.test(d) && /\(external_id\)/i.test(d) && !/dataset_version_id/i.test(d)
      );
      expect(hasComposite, `${layer} composite unique`).toBe(true);
      expect(hasGlobal, `${layer} global unique removed`).toBe(false);
    }
  });

  it('has a deleted column defaulting to false', async () => {
    for (const layer of THEMATIC) {
      const { rows } = await getPool().query(
        `SELECT count(*)::int AS n FROM water.${layer} WHERE deleted = false`
      );
      const { rows: total } = await getPool().query(`SELECT count(*)::int AS n FROM water.${layer}`);
      expect(rows[0].n).toBe(total[0].n);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: FAIL — `column "dataset_version_id" does not exist`.

- [ ] **Step 3: Extend the migration**

In `apps/api/src/db/migrations/1000000000004_dataset-versions.cjs`, add the thematic-table list at the top of the file (after `exports.shorthands`):

```javascript
const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];
```

Append inside `exports.up`, after the constraint block, the column additions and backfill:

```javascript
  for (const name of THEMATIC) {
    const tbl = { schema: 'water', name };

    // Nullable first so we can backfill, then set NOT NULL.
    pgm.addColumn(tbl, {
      dataset_version_id: { type: 'uuid', references: { schema: 'app', name: 'dataset_versions' } },
      deleted: { type: 'boolean', notNull: true, default: false },
    });

    // One "version 1" ingest version per layer, active, holding all current rows.
    // A DO block keeps the whole backfill in one server-side statement.
    pgm.sql(`
      DO $$
      DECLARE
        v_id uuid;
        v_count integer;
      BEGIN
        SELECT count(*) INTO v_count FROM water.${name};
        INSERT INTO app.dataset_versions (layer_key, kind, source, label, feature_count, is_active)
        VALUES ('${name}', 'ingest', 'seed:${name}', 'version 1', v_count, true)
        RETURNING id INTO v_id;
        UPDATE water.${name} SET dataset_version_id = v_id;
      END $$;
    `);

    pgm.alterColumn(tbl, 'dataset_version_id', { notNull: true });
    pgm.createIndex(tbl, 'dataset_version_id');

    // external_id uniqueness moves from global to per-version.
    pgm.dropIndex(tbl, 'external_id', { name: `${name}_external_id_unique_index`, ifExists: true });
    pgm.createIndex(tbl, ['dataset_version_id', 'external_id'], { unique: true });
  }
```

> Note: the dropped index name is `<name>_external_id_unique_index` — node-pg-migrate's `generateIndexName` produces `${table.name}_${cols}${uniq}_index` (schema-qualified separately), verified against `node_modules/node-pg-migrate/dist/operations/indexes/shared.js`. `ifExists: true` keeps the drop tolerant, but the name must be right: a wrong name silently leaves the old global unique index in place, which breaks the second-ingest case in Task 5.

Prepend to `exports.down`, before the existing `dropTable`/`dropType`:

```javascript
  const THEMATIC_DOWN = [
    'dams', 'rivers', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation',
  ];
  for (const name of THEMATIC_DOWN) {
    const tbl = { schema: 'water', name };
    pgm.dropIndex(tbl, ['dataset_version_id', 'external_id'], { ifExists: true });
    pgm.dropColumn(tbl, ['dataset_version_id', 'deleted']);
    pgm.createIndex(tbl, 'external_id', { unique: true });
  }
```

- [ ] **Step 4: Re-run the migration cleanly**

Because Task 1's migration already ran, roll it back and re-apply so the extended version takes effect:

Run (from `apps/api`): `npm run migrate:down && npm run migrate:up`
Expected: down removes `1000000000004`, up re-applies it with the table alterations and backfill. "Migrations complete".

- [ ] **Step 5: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: PASS (constraints + all four backfill tests).

- [ ] **Step 6: Verify the schema test still passes (no regression)**

Run (from `apps/api`): `npm test -- src/db/schema.test.ts`
Expected: PASS — the seven tables and their 4326 geometry columns are intact.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/1000000000004_dataset-versions.cjs apps/api/src/modules/versions/repository.test.ts
git commit -m "feat(api): version-stamp feature tables + backfill existing data as version 1"
```

---

### Task 3: Version resolver (§4) — the one place the two kinds diverge

The resolver query answering "give me the feature ids for version V." A flat filter for ingest versions; a `distinct on (external_id)` over the parent chain (nearest-wins, tombstones absent) for edit versions. This is the seam §5 and the future scrubber call.

**Files:**
- Create: `apps/api/src/modules/versions/repository.ts`
- Test: `apps/api/src/modules/versions/repository.test.ts` (resolver portion, appended)

**Interfaces:**
- Consumes: `app.dataset_versions`, the version-stamped `water.*` tables.
- Produces: `versionsRepository(pg: Pool)` with
  - `getVersion(id: string): Promise<DatasetVersion | null>`
  - `getActiveVersionId(layerKey: string): Promise<string | null>`
  - `chainToRoot(versionId: string): Promise<string[]>` — ordered `[V, parent, …, rootIngest]`.
  - `resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]>` — the effective feature `id`s (uuid pk) for version V, tombstones excluded.
  - `resolvedSql(layerKey: string, chain: string[]): string` — a SQL fragment (a `SELECT id …`) resolving the chain, reused by the §5 view builder in Task 7.
  - `DatasetVersion` type: `{ id: string; layerKey: string; kind: 'ingest' | 'edit'; parentVersionId: string | null; isActive: boolean; featureCount: number | null; label: string; source: string; }`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/versions/repository.test.ts`:

```typescript
import { versionsRepository } from './repository';

describe('versionsRepository resolver (§4)', () => {
  const pg = () => getPool();
  const madeVersions: string[] = [];

  afterAll(async () => {
    // dataset_versions cascade to child edit versions; feature rows FK to them, so
    // delete feature rows first for our synthetic layer, then versions.
    await pg().query(`DELETE FROM water.dams WHERE dataset_version_id = ANY($1)`, [madeVersions]);
    await pg().query(`DELETE FROM app.dataset_versions WHERE id = ANY($1)`, [madeVersions]);
  });

  async function newIngest(): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO app.dataset_versions (layer_key, kind, source, label, is_active)
       VALUES ('dams', 'ingest', 'test', 'ingest', false) RETURNING id`
    );
    madeVersions.push(rows[0].id);
    return rows[0].id;
  }
  async function newEdit(parent: string): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label, is_active)
       VALUES ('dams', 'edit', $1, 'edit session', 'edits', false) RETURNING id`,
      [parent]
    );
    madeVersions.push(rows[0].id);
    return rows[0].id;
  }
  // Insert a dam row into a version. Returns its uuid pk.
  async function addFeature(versionId: string, externalId: number, opts: { deleted?: boolean; name?: string } = {}): Promise<string> {
    const { rows } = await pg().query(
      `INSERT INTO water.dams (external_id, name, dataset_version_id, deleted, geom)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(105.8, 21.0), 4326)) RETURNING id`,
      [externalId, opts.name ?? `f${externalId}`, versionId, opts.deleted ?? false]
    );
    return rows[0].id;
  }

  it('resolves an ingest version as a flat set', async () => {
    const v = await newIngest();
    const a = await addFeature(v, 1001);
    const b = await addFeature(v, 1002);
    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', v);
    expect(new Set(ids)).toEqual(new Set([a, b]));
  });

  it('resolves an edit version: parent overlaid by session changes, tombstones absent', async () => {
    const ingest = await newIngest();
    const keep = await addFeature(ingest, 2001, { name: 'orig-keep' });
    await addFeature(ingest, 2002, { name: 'orig-changed' });
    await addFeature(ingest, 2003, { name: 'orig-deleted' });

    const edit = await newEdit(ingest);
    const changed = await addFeature(edit, 2002, { name: 'edited' });      // update overlays parent
    await addFeature(edit, 2003, { deleted: true });                        // tombstone removes parent feature
    const added = await addFeature(edit, 2004, { name: 'new-in-edit' });   // brand-new feature

    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', edit);
    // keep (inherited), changed (nearest wins), added (new). 2003 tombstoned => absent.
    expect(new Set(ids)).toEqual(new Set([keep, changed, added]));
  });

  it('resolves a two-deep edit chain nearest-wins', async () => {
    const ingest = await newIngest();
    await addFeature(ingest, 3001, { name: 'v0' });
    const edit1 = await newEdit(ingest);
    await addFeature(edit1, 3001, { name: 'v1' });
    const edit2 = await newEdit(edit1);
    const v2row = await addFeature(edit2, 3001, { name: 'v2' });

    const ids = await versionsRepository(pg()).resolveFeatureIds('dams', edit2);
    expect(ids).toEqual([v2row]); // the edit2 row wins over edit1 and ingest
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: FAIL — `Cannot find module './repository'`.

- [ ] **Step 3: Write the resolver**

Create `apps/api/src/modules/versions/repository.ts`:

```typescript
import type { Pool } from 'pg';

export interface DatasetVersion {
  id: string;
  layerKey: string;
  kind: 'ingest' | 'edit';
  parentVersionId: string | null;
  isActive: boolean;
  featureCount: number | null;
  label: string;
  source: string;
}

function rowToVersion(r: Record<string, unknown>): DatasetVersion {
  return {
    id: r.id as string,
    layerKey: r.layer_key as string,
    kind: r.kind as 'ingest' | 'edit',
    parentVersionId: (r.parent_version_id as string | null) ?? null,
    isActive: r.is_active as boolean,
    featureCount: (r.feature_count as number | null) ?? null,
    label: r.label as string,
    source: r.source as string,
  };
}

export function versionsRepository(pg: Pool) {
  const repo = {
    async getVersion(id: string): Promise<DatasetVersion | null> {
      const { rows } = await pg.query(`SELECT * FROM app.dataset_versions WHERE id = $1`, [id]);
      return rows[0] ? rowToVersion(rows[0]) : null;
    },

    async getActiveVersionId(layerKey: string): Promise<string | null> {
      const { rows } = await pg.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`,
        [layerKey]
      );
      return rows[0]?.id ?? null;
    },

    // Ordered [V, parent, …, root ingest].
    async chainToRoot(versionId: string): Promise<string[]> {
      const { rows } = await pg.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_version_id, 0 AS depth
             FROM app.dataset_versions WHERE id = $1
           UNION ALL
           SELECT v.id, v.parent_version_id, c.depth + 1
             FROM app.dataset_versions v
             JOIN chain c ON v.id = c.parent_version_id
         )
         SELECT id FROM chain ORDER BY depth`,
        [versionId]
      );
      return rows.map((r) => r.id as string);
    },

    // A SQL fragment selecting the effective feature ids for a resolved chain.
    // For a single-element chain (ingest) this is the flat filter; for a longer
    // chain it is nearest-version-wins per external_id with tombstones removed.
    resolvedSql(layerKey: string, chain: string[]): string {
      // chain[0] is nearest (highest priority), last is root ingest.
      const values = chain
        .map((id, i) => `('${id}'::uuid, ${i})`)
        .join(', ');
      // priority: lower number = nearer = wins.
      return `
        SELECT id FROM (
          SELECT DISTINCT ON (t.external_id) t.id, t.deleted
          FROM water.${layerKey} t
          JOIN (VALUES ${values}) AS pri(version_id, priority)
            ON t.dataset_version_id = pri.version_id
          ORDER BY t.external_id, pri.priority
        ) resolved
        WHERE NOT resolved.deleted`;
    },

    async resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      const chain = await repo.chainToRoot(versionId);
      const { rows } = await pg.query(repo.resolvedSql(layerKey, chain));
      return rows.map((r) => r.id as string);
    },
  };
  return repo;
}

export type VersionsRepository = ReturnType<typeof versionsRepository>;
```

> Design note: `resolvedSql` works for both kinds. An ingest version's chain is a single element, so the `DISTINCT ON` collapses to the flat filter `WHERE dataset_version_id = V AND NOT deleted`. Ingest versions never set `deleted`, so the tombstone filter is a no-op there. `layerKey` is only ever an internal registry key (never user input), so interpolating it into the table name is safe; version ids are DB-generated uuids.

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/modules/versions/repository.test.ts`
Expected: PASS (constraints + backfill + all three resolver tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/versions/repository.ts apps/api/src/modules/versions/repository.test.ts
git commit -m "feat(api): version resolver — flat for ingest, chain-walk nearest-wins for edit"
```

---

### Task 4: Versions service — create ingest version, atomic active-flip

The service layer that ingest (§6) and edit sessions (§7) both call. This task delivers the ingest half: create a full standalone version and atomically flip it active within a caller-supplied transaction client.

**Files:**
- Create: `apps/api/src/modules/versions/service.ts`
- Test: `apps/api/src/modules/versions/service.test.ts` (ingest portion)

**Interfaces:**
- Consumes: `versionsRepository` (Task 3).
- Produces: `versionsService(pg: Pool)` with, at minimum for this task:
  - `createIngestVersion(client, args): Promise<string>` where
    `args = { layerKey: string; source: string; sourceVersion?: string | null; label: string; ingestedBy?: string | null }`
    and `client` is a `pg.PoolClient` already inside a transaction. Inserts a `kind='ingest'`, `parent=null`, `is_active=false` row, returns its id. Does **not** flip active (the caller loads features first, then calls `activate`).
  - `activate(client, layerKey, versionId): Promise<void>` — clears the layer's current active flag and sets `versionId` active, in the caller's transaction. Also sets `feature_count` to the resolved row total for the version.
  - Type `IngestVersionArgs` exported for §6's use.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/versions/service.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';

const LAYER = 'zz_svc_dams'; // synthetic layer key; no real table needed for active-flip test

afterAll(async () => {
  await getPool().query(`DELETE FROM app.dataset_versions WHERE layer_key = $1`, [LAYER]);
  await closePool();
});

describe('versionsService ingest lifecycle', () => {
  it('creates an inactive ingest version, then activates it, clearing any prior active', async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const svc = versionsService(pool);

      const v1 = await svc.createIngestVersion(client, { layerKey: LAYER, source: 'seed', label: 'v1' });
      await svc.activate(client, LAYER, v1);

      const v2 = await svc.createIngestVersion(client, { layerKey: LAYER, source: 'seed', label: 'v2' });
      // Before activation, v1 is still the only active one.
      const mid = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
      );
      expect(mid.rows.map((r) => r.id)).toEqual([v1]);

      await svc.activate(client, LAYER, v2);
      const after = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [LAYER]
      );
      expect(after.rows.map((r) => r.id)).toEqual([v2]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/modules/versions/service.test.ts`
Expected: FAIL — `Cannot find module './service'`.

- [ ] **Step 3: Write the service (ingest half)**

Create `apps/api/src/modules/versions/service.ts`:

```typescript
import type { Pool, PoolClient } from 'pg';
import { versionsRepository } from './repository';

export interface IngestVersionArgs {
  layerKey: string;
  source: string;
  sourceVersion?: string | null;
  label: string;
  ingestedBy?: string | null;
}

export function versionsService(pg: Pool) {
  const repo = versionsRepository(pg);

  const svc = {
    async createIngestVersion(client: PoolClient, args: IngestVersionArgs): Promise<string> {
      const { rows } = await client.query(
        `INSERT INTO app.dataset_versions
           (layer_key, kind, parent_version_id, source, source_version, label, ingested_by, is_active)
         VALUES ($1, 'ingest', NULL, $2, $3, $4, $5, false)
         RETURNING id`,
        [args.layerKey, args.source, args.sourceVersion ?? null, args.label, args.ingestedBy ?? null]
      );
      return rows[0].id as string;
    },

    // Atomically make versionId the active version for its layer.
    async activate(client: PoolClient, layerKey: string, versionId: string): Promise<void> {
      // Clear current active first so the partial-unique index never sees two.
      await client.query(
        `UPDATE app.dataset_versions SET is_active = false WHERE layer_key = $1 AND is_active`,
        [layerKey]
      );
      await client.query(
        `UPDATE app.dataset_versions SET is_active = true WHERE id = $1`,
        [versionId]
      );
    },

    resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      return repo.resolveFeatureIds(layerKey, versionId);
    },
    getActiveVersionId(layerKey: string): Promise<string | null> {
      return repo.getActiveVersionId(layerKey);
    },
    getVersion(id: string) {
      return repo.getVersion(id);
    },
  };
  return svc;
}

export type VersionsService = ReturnType<typeof versionsService>;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/modules/versions/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/versions/service.ts apps/api/src/modules/versions/service.test.ts
git commit -m "feat(api): versionsService — create ingest version + atomic active-flip"
```

---

### Task 5: Ingest creates a full version (§6) — seed registry + run rewrite

Rewrites the seed/ingest path from truncate-and-overwrite to append-a-version. `SEED_LAYERS` gains provenance; `runSeeds` wraps each layer in one transaction: create version → load features stamped with it → activate. Failure rolls back with the prior version untouched.

**Files:**
- Modify: `apps/api/src/db/seeds/registry.ts`
- Modify: `apps/api/src/db/seeds/run.ts`
- Modify: `apps/api/src/db/seeds/seed.test.ts`

**Interfaces:**
- Consumes: `versionsService.createIngestVersion` / `activate` (Task 4).
- Produces: `SeedLayer` gains `source: string` and `label: string` fields. `seedLayer(client, layer, versionId)` inserts each feature stamped with `versionId` (no `ON CONFLICT`; a fresh version starts empty). `runSeeds()` return shape unchanged (`Record<string, number>` of layer→count).

- [ ] **Step 1: Write the failing test**

Modify `apps/api/src/db/seeds/seed.test.ts` — add a describe block asserting versioning behavior. Append after the existing `describe('seeds', …)`:

```typescript
describe('seeds create dataset versions (§6)', () => {
  it('each seeded layer has an active ingest version whose feature_count matches its rows', async () => {
    for (const layer of ['dams', 'rivers', 'stations']) {
      const { rows } = await getPool().query(
        `SELECT feature_count FROM app.dataset_versions
         WHERE layer_key = $1 AND kind = 'ingest' AND is_active`,
        [layer]
      );
      expect(rows).toHaveLength(1);
      const { rows: live } = await getPool().query(
        `SELECT count(*)::int AS n FROM water.${layer} WHERE NOT deleted`
      );
      expect(rows[0].feature_count).toBe(live[0].n);
    }
  });

  it('a second seed run creates a new active version and leaves the prior one addressable', async () => {
    const before = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
    );
    const priorActive = before.rows[0].id;

    await runSeeds();

    const versions = await getPool().query(
      `SELECT count(*)::int AS n FROM app.dataset_versions WHERE layer_key = 'stations'`
    );
    expect(versions.rows[0].n).toBeGreaterThanOrEqual(2);

    const active = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'stations' AND is_active`
    );
    expect(active.rows[0].id).not.toBe(priorActive); // active moved to the new version

    // The prior version is still there and its rows still resolvable.
    const prior = await getPool().query(
      `SELECT count(*)::int AS n FROM water.stations WHERE dataset_version_id = $1`,
      [priorActive]
    );
    expect(prior.rows[0].n).toBe(2);
  });
});
```

Also delete/replace the existing `'is idempotent (re-running does not duplicate rows)'` test — it asserted the old overwrite semantics (`count unchanged after re-run`), which no longer holds because a re-run now appends a new version. Replace that single `it(...)` with:

```typescript
  it('re-running appends a version rather than mutating the active one in place', async () => {
    const activeBefore = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active`
    );
    await runSeeds();
    const activeAfter = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'flood_zones' AND is_active`
    );
    expect(activeAfter.rows[0].id).not.toBe(activeBefore.rows[0].id);
    // The new active version still holds exactly the 2 source features.
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.flood_zones WHERE dataset_version_id = $1 AND NOT deleted`,
      [activeAfter.rows[0].id]
    );
    expect(rows[0].n).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/db/seeds/seed.test.ts`
Expected: FAIL — the new active version is not created (still overwriting in place), so `feature_count` / new-version assertions fail.

- [ ] **Step 3: Add provenance metadata to the seed registry**

In `apps/api/src/db/seeds/registry.ts`, add `source` and `label` to the `SeedLayer` interface and to every entry. Change the interface:

```typescript
export interface SeedLayer {
  table: string;
  file: string;
  /** provenance: origin of this dataset (recorded on the dataset_versions row). */
  source: string;
  /** human name for the version timeline. */
  label: string;
  /** true if the source geometry is a single Polygon that must be wrapped as MultiPolygon */
  multiPolygon?: boolean;
  /** true if the source geometry is a single LineString/MultiLineString to normalise as MultiLineString */
  multiLine?: boolean;
  columns: (props: Record<string, unknown>, index: number) => Record<string, unknown>;
}
```

Add `source` + `label` to each of the seven entries. Use the source filename as `source` and `'version 1'` as `label` (matching the backfill convention). For example, `dams`:

```typescript
  {
    table: 'dams',
    file: resolve(webPublic, 'thuydienvietnam.geojson'),
    source: 'thuydienvietnam.geojson',
    label: 'version 1',
    columns: (p) => ({
      external_id: p.ID,
      name: p.Vietnamese,
      name_en: p.English_hy,
      wattage_mw: p.Wattage_PL,
      annual_output: p['Quantity_('],
      year_launched: p.Year_of_la,
      year_operational: p.Year_of_op,
      status: assignDamStatus(p.ID),
    }),
  },
```

Apply the same two fields to the other six: `rivers` → `source: 'thuyhe.geojson'`; `stations` → `source: 'stations.geojson'`; `flood_zones` → `source: 'flood_zones.geojson'`; `drought_points` → `source: 'drought_points.geojson'`; `saltwater_intrusion` → `source: 'saltwater_intrusion.geojson'`; `flood_generation` → `source: 'flood_generation.geojson'`. All get `label: 'version 1'`.

- [ ] **Step 4: Rewrite the ingest transaction**

Replace `apps/api/src/db/seeds/run.ts` entirely with the append-a-version path:

```typescript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import type pg from 'pg';
import { getPool, closePool } from '../pool';
import { SEED_LAYERS, type SeedLayer } from './registry';
import { versionsService } from '../../modules/versions/service';

function geomExpr(layer: SeedLayer): string {
  // $GEOM is the feature geometry as a GeoJSON string
  const base = `ST_SetSRID(ST_GeomFromGeoJSON($GEOM), 4326)`;
  if (layer.multiPolygon || layer.multiLine) return `ST_Multi(${base})`;
  return base;
}

// Load every feature of `layer` into a fresh version, stamped with versionId.
// No ON CONFLICT: a new version starts empty, so there is nothing to conflict with.
export async function loadLayerFeatures(
  client: pg.PoolClient,
  layer: SeedLayer,
  versionId: string
): Promise<number> {
  const fc = JSON.parse(readFileSync(layer.file, 'utf8'));
  const features: Array<{ geometry: unknown; properties: Record<string, unknown> }> = fc.features;
  let count = 0;

  for (const [index, f] of features.entries()) {
    const cols = layer.columns(f.properties, index);
    const colNames = Object.keys(cols);
    const values = Object.values(cols);
    const hasGeometry = f.geometry != null;

    if (!hasGeometry) {
      // eslint-disable-next-line no-console
      console.warn(
        `water.${layer.table}: feature external_id=${String(cols.external_id)} has no geometry; storing NULL`
      );
    }

    const colPlaceholders = colNames.map((_, i) => `$${i + 1}`);
    const geomParamIndex = colNames.length + 1;
    const geomSql = hasGeometry ? geomExpr(layer).replace('$GEOM', `$${geomParamIndex}`) : 'NULL';
    const versionParamIndex = hasGeometry ? colNames.length + 2 : colNames.length + 1;

    const sql = `
      INSERT INTO water.${layer.table} (${colNames.join(', ')}, geom, dataset_version_id)
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

export async function runSeeds(): Promise<Record<string, number>> {
  const pool = getPool();
  const client = await pool.connect();
  const versions = versionsService(pool);
  const result: Record<string, number> = {};
  try {
    for (const layer of SEED_LAYERS) {
      await client.query('BEGIN');
      const versionId = await versions.createIngestVersion(client, {
        layerKey: layer.table,
        source: layer.source,
        label: layer.label,
      });
      result[layer.table] = await loadLayerFeatures(client, layer, versionId);
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
        [result[layer.table], versionId]
      );
      await versions.activate(client, layer.table, versionId);
      await client.query('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`seeded water.${layer.table}: ${result[layer.table]} features (version ${versionId})`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return result;
}

// Run when invoked directly (npm run seed), but not when imported (e.g. by seed.test.ts).
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (isMainModule) {
  runSeeds()
    .then(() => closePool())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
      return closePool();
    });
}
```

> Note: `layerKey` here is `layer.table`, which is the bare table name (`'dams'`, `'rivers'`, …), matching the `layer_key` values the backfill and the resolver use. The `versionsService.activate` call sets `is_active` after `feature_count` is known.

- [ ] **Step 5: Reset seed data so tests start clean**

Because the backfill migration already created "version 1" rows and the old overwrite left one row-set per table, run a fresh seed to establish versioned data through the new path:

Run (from `apps/api`): `npm run seed`
Expected: `seeded water.<table>: N features (version …)` for all seven layers, no errors.

- [ ] **Step 6: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/db/seeds/seed.test.ts`
Expected: PASS — including the new `§6` describe block and the replaced re-run test. (The `dams=371`, `rivers=2013`, mock-layer counts still hold because a fresh version reloads the full source.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/seeds/registry.ts apps/api/src/db/seeds/run.ts apps/api/src/db/seeds/seed.test.ts
git commit -m "feat(api): ingest appends a full standalone version instead of overwriting (§6)"
```

---

### Task 6: Edit sessions publish as a copy-on-write version (§7)

Replaces in-place mutation in `layers/service.ts` with an edit-session model at the service/repo layer. A steward's edits accumulate in a `draft` edit-version off the active version; commit flips it active, discard deletes it. The repository learns to write feature rows into a target version and to tombstone on delete. `audit_log` recording is unchanged.

**Files:**
- Modify: `apps/api/src/modules/layers/repository.ts`
- Modify: `apps/api/src/modules/layers/service.ts`
- Modify: `apps/api/src/modules/versions/service.ts` (add edit-draft methods)
- Test: `apps/api/src/modules/layers/service.test.ts`

**Interfaces:**
- Consumes: `versionsService` (Tasks 4), `versionsRepository.getActiveVersionId` / `resolveFeatureIds` (Task 3), `auditService` (unchanged).
- Produces:
  - `versionsService` gains:
    - `openEditDraft(client, layerKey, actorId?): Promise<string>` — inserts a `kind='edit'`, `parent_version_id = <current active>`, `is_active=false`, `label = '<date> edits'` draft; returns its id. Throws `ConflictError` if there is no active version to branch from.
    - `commitEditDraft(client, layerKey, draftId): Promise<void>` — sets `feature_count` to the number of rows the draft stores (changed features), then `activate`s the draft.
    - `discardEditDraft(client, draftId): Promise<void>` — deletes the draft's feature rows then the draft version row.
  - `featuresService(pg)` gains an `editSession(layerKey, actorId?)` factory returning `{ update(id, input), remove(id), create(input), commit(), discard() }`, each operating against the open draft. The existing top-level `create/update/remove` remain for reads/tests but are re-expressed to open-commit a single-change session (see Step 5) so no caller writes the live active version directly.
  - `featuresRepository` gains `insertIntoVersion(def, versionId, {...})`, `upsertChangeInVersion(def, versionId, externalId, {...})`, and `tombstoneInVersion(def, versionId, externalId)`.

- [ ] **Step 1: Write the failing test**

Replace the body of `apps/api/src/modules/layers/service.test.ts` with edit-session coverage (keeps the unknown-layer and geometry-type checks, adds session behavior):

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { featuresService } from './service';
import { versionsService } from '../versions/service';
import { GeometryError, NotFoundError } from '../../errors';

const TEST_NAME = 'svc-test-dam@webatlas.test';

async function activeVersionId(layer: string): Promise<string> {
  const { rows } = await getPool().query(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layer]
  );
  return rows[0].id;
}
async function resolvedCount(layer: string): Promise<number> {
  const v = await activeVersionId(layer);
  const ids = await versionsService(getPool()).resolveFeatureIds(layer, v);
  return ids.length;
}

describe('featuresService edit sessions (§7)', () => {
  const svc = () => featuresService(getPool());

  afterAll(async () => {
    await getPool().query(`DELETE FROM water.dams WHERE name = $1`, [TEST_NAME]);
    await closePool();
  });

  it('rejects an unknown layer key with NotFoundError', async () => {
    await expect(svc().list('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a wrong-type geometry with GeometryError', async () => {
    const feature = { geometry: { type: 'LineString', coordinates: [[105, 21], [106, 22]] }, properties: { name: TEST_NAME } };
    const s = await svc().editSession('dams');
    await expect(s.create(feature)).rejects.toBeInstanceOf(GeometryError);
    await s.discard();
  });

  it('edits before commit do not change what the active version resolves', async () => {
    const beforeCount = await resolvedCount('dams');
    const s = await svc().editSession('dams');
    await s.create({ geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: TEST_NAME } });
    // Active version unchanged until commit.
    expect(await resolvedCount('dams')).toBe(beforeCount);
    await s.discard();
    // Discard leaves no trace.
    expect(await resolvedCount('dams')).toBe(beforeCount);
  });

  it('commit publishes one labeled edit-version and makes the new feature resolve', async () => {
    const beforeCount = await resolvedCount('dams');
    const s = await svc().editSession('dams');
    await s.create({ geometry: { type: 'Point', coordinates: [105.8, 21.0] }, properties: { name: TEST_NAME } });
    await s.commit();

    expect(await resolvedCount('dams')).toBe(beforeCount + 1);
    const active = await getPool().query(
      `SELECT kind, label FROM app.dataset_versions WHERE id = $1`, [await activeVersionId('dams')]
    );
    expect(active.rows[0].kind).toBe('edit');
  });

  it('records each edit in audit_log even though rows go to the draft version', async () => {
    const s = await svc().editSession('dams');
    const row = await s.create({ geometry: { type: 'Point', coordinates: [105.9, 21.1] }, properties: { name: TEST_NAME } });
    await s.commit();
    const audit = await getPool().query(
      `SELECT action FROM app.audit_log WHERE table_name = 'water.dams' AND feature_id = $1`, [row.id]
    );
    expect(audit.rows.map((r) => r.action)).toContain('create');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/modules/layers/service.test.ts`
Expected: FAIL — `editSession is not a function`.

- [ ] **Step 3: Add edit-draft methods to `versionsService`**

In `apps/api/src/modules/versions/service.ts`, import `ConflictError` and add three methods inside the `svc` object (after `activate`):

```typescript
    async openEditDraft(client: PoolClient, layerKey: string, actorId?: string | null): Promise<string> {
      const active = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`, [layerKey]
      );
      const parent = active.rows[0]?.id;
      if (!parent) throw new ConflictError(`no active version for layer ${layerKey}`);
      const label = `${new Date().toISOString().slice(0, 10)} edits`;
      const { rows } = await client.query(
        `INSERT INTO app.dataset_versions
           (layer_key, kind, parent_version_id, source, label, ingested_by, is_active)
         VALUES ($1, 'edit', $2, 'edit session', $3, $4, false)
         RETURNING id`,
        [layerKey, parent, label, actorId ?? null]
      );
      return rows[0].id as string;
    },

    async commitEditDraft(client: PoolClient, layerKey: string, draftId: string): Promise<void> {
      // feature_count for an edit version = rows it stores (changed features), not the resolved total.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM water.${layerKey} WHERE dataset_version_id = $1`, [draftId]
      );
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`, [rows[0].n, draftId]
      );
      await svc.activate(client, layerKey, draftId);
    },

    async discardEditDraft(client: PoolClient, layerKey: string, draftId: string): Promise<void> {
      await client.query(`DELETE FROM water.${layerKey} WHERE dataset_version_id = $1`, [draftId]);
      await client.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [draftId]);
    },
```

Add the import at the top of the file:

```typescript
import { ConflictError } from '../../errors';
```

> `layerKey` is `def.table`'s bare key (e.g. `'dams'`), the registry-owned table name — never user input — so interpolating it into the `water.<layerKey>` reference is safe, consistent with the resolver.

- [ ] **Step 4: Add version-targeted writes to `featuresRepository`**

In `apps/api/src/modules/layers/repository.ts`, add three methods to the returned object (after `remove`). These mirror the existing `insert`/`update` shaping but target a specific `dataset_version_id` and use the `deleted` tombstone.

**Every one takes the session's `client: PoolClient` as its first parameter and runs all its queries on it** — never on `pg` — so the writes live inside the session transaction. Add `import type { Pool, PoolClient } from 'pg';` at the top of the file (it currently imports only `Pool`).

Each of these also needs a version-scoped read helper, because `findById` runs on the pool and cannot see uncommitted rows. Add this alongside them:

```typescript
    // findById restricted to the session's transaction — sees uncommitted rows.
    async findByIdOnClient(client: PoolClient, def: LayerDef, id: string): Promise<FeatureRow | null> {
      const { rows } = await client.query(`${selectSql(def)} WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    },
```

```typescript
    // Insert a brand-new feature row into a specific version.
    async insertIntoVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      input: { attrs: Record<string, unknown>; geometryJson: string | null; actorId?: string }
    ): Promise<FeatureRow> {
      const cols = Object.keys(input.attrs);
      const vals = Object.values(input.attrs);
      const params: unknown[] = [...vals];
      const colList = [...cols];
      const valPlaceholders = cols.map((_, i) => `$${i + 1}`);
      if (input.geometryJson !== null) {
        params.push(input.geometryJson);
        colList.push(def.geomColumn);
        valPlaceholders.push(geomInsertSql(def, params.length));
      }
      params.push(versionId); colList.push('dataset_version_id'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null); colList.push('created_by'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null); colList.push('updated_by'); valPlaceholders.push(`$${params.length}`);
      const insertSql = `INSERT INTO ${def.table} (${colList.join(', ')})
                         VALUES (${valPlaceholders.join(', ')})
                         RETURNING id`;
      const { rows } = await client.query(insertSql, params);
      return (await this.findByIdOnClient(client, def, rows[0].id))!;
    },

    // Apply an attribute/geometry change to a row that already lives in the draft version.
    async updateOnClient(
      client: PoolClient,
      def: LayerDef,
      id: string,
      input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }
    ): Promise<FeatureRow | null> {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, v] of Object.entries(input.attrs)) { params.push(v); sets.push(`${k} = $${params.length}`); }
      if (input.geometryJson !== undefined) {
        if (input.geometryJson === null) {
          sets.push(`${def.geomColumn} = NULL`);
        } else {
          params.push(input.geometryJson);
          sets.push(`${def.geomColumn} = ${geomInsertSql(def, params.length)}`);
        }
      }
      params.push(input.actorId ?? null); sets.push(`updated_by = $${params.length}`);
      sets.push(`updated_at = now()`);
      params.push(id);
      await client.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      return this.findByIdOnClient(client, def, id);
    },

    // Write a copy-on-write row for an existing (inherited) feature into the draft version.
    // Copies the inherited row's external_id/geom, then applies the attribute changes.
    async upsertChangeInVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      sourceId: string,
      input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }
    ): Promise<FeatureRow> {
      // Is there already a row for this feature in the draft? Match by external_id of the source row.
      const src = await client.query(
        `SELECT external_id FROM ${def.table} WHERE id = $1`, [sourceId]
      );
      const externalId = src.rows[0]?.external_id;
      const existing = await client.query(
        `SELECT id FROM ${def.table} WHERE dataset_version_id = $1 AND external_id = $2`,
        [versionId, externalId]
      );
      if (existing.rows[0]) {
        return (await this.updateOnClient(client, def, existing.rows[0].id, input))!;
      }
      // Copy the inherited row into the draft version, then apply changes.
      // def.attributeColumns already includes `name`, so it is not listed separately.
      const copyCols = `${def.attributeColumns.join(', ')}`;
      const copy = await client.query(
        `INSERT INTO ${def.table} (external_id, ${copyCols}, ${def.geomColumn}, dataset_version_id, created_by, updated_by)
         SELECT external_id, ${copyCols}, ${def.geomColumn}, $1, $2, $2
         FROM ${def.table} WHERE id = $3
         RETURNING id`,
        [versionId, input.actorId ?? null, sourceId]
      );
      return (await this.updateOnClient(client, def, copy.rows[0].id, input))!;
    },

    // Mark an inherited feature deleted within the draft version (tombstone).
    async tombstoneInVersion(client: PoolClient, def: LayerDef, versionId: string, sourceId: string): Promise<void> {
      const src = await client.query(`SELECT external_id FROM ${def.table} WHERE id = $1`, [sourceId]);
      const externalId = src.rows[0]?.external_id;
      const existing = await client.query(
        `SELECT id FROM ${def.table} WHERE dataset_version_id = $1 AND external_id = $2`,
        [versionId, externalId]
      );
      if (existing.rows[0]) {
        await client.query(`UPDATE ${def.table} SET deleted = true WHERE id = $1`, [existing.rows[0].id]);
        return;
      }
      await client.query(
        `INSERT INTO ${def.table} (external_id, dataset_version_id, deleted, ${def.geomColumn})
         SELECT external_id, $1, true, ${def.geomColumn} FROM ${def.table} WHERE id = $2`,
        [versionId, sourceId]
      );
    },
```

> Note on `name`: every registry `attributeSchema` includes `name`, so `def.attributeColumns` already contains it (`attributeColumns = Object.keys(schema.shape)` in `layers/registry.ts`). The copy SQL above therefore lists `${copyCols}` only — do not add a separate `name,`, which would duplicate the column and fail.

- [ ] **Step 5: Rewrite `featuresService` to use edit sessions**

Replace `apps/api/src/modules/layers/service.ts` with the session-based version. The top-level `create/update/remove` become thin single-change sessions so no path writes the active version directly; `editSession` exposes the multi-change flow.

```typescript
import type { Pool, PoolClient } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService } from '../audit/service';
import { versionsService } from '../versions/service';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown> };

async function prepare(pg: Pool, def: LayerDef, input: FeatureInput, geometryRequired: boolean) {
  const attrs = validate(def.attributeSchema, input.properties ?? {}) as Record<string, unknown>;
  const owned: Record<string, unknown> = {};
  for (const c of def.attributeColumns) if (c in attrs) owned[c] = attrs[c];
  const geometryJson = geometryRequired || input.geometry !== undefined
    ? assertGeometry(def, input.geometry)
    : undefined;
  if (typeof geometryJson === 'string') await assertValidInPg(pg, def, geometryJson);
  return { attrs: owned, geometryJson };
}

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const audit = auditService(pg);
  const versions = versionsService(pg);

  // A working edit session over one layer, backed by a draft edit-version.
  async function editSession(key: string, actorId?: string) {
    const def = getLayer(key);
    const client = await pg.connect();
    await client.query('BEGIN');
    let draftId: string;
    try {
      draftId = await versions.openEditDraft(client, def.key, actorId);
    } catch (e) {
      await client.query('ROLLBACK'); client.release(); throw e;
    }

    async function fail(e: unknown): Promise<never> {
      await client.query('ROLLBACK'); client.release(); throw e;
    }

    return {
      draftId: () => draftId,
      async create(input: FeatureInput): Promise<FeatureRow> {
        try {
          const { attrs, geometryJson } = await prepare(pg, def, input, true);
          const row = await repo.insertIntoVersion(client, def, draftId, { attrs, geometryJson: geometryJson ?? null, actorId });
          await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row });
          return row;
        } catch (e) { return fail(e); }
      },
      async update(id: string, input: FeatureInput): Promise<FeatureRow> {
        try {
          // Read on the client: the target may be a row created earlier in this session.
          const before = await repo.findByIdOnClient(client, def, id);
          if (!before) throw new NotFoundError('Feature not found');
          const { attrs, geometryJson } = await prepare(pg, def, input, false);
          const after = await repo.upsertChangeInVersion(client, def, draftId, id, { attrs, geometryJson, actorId });
          await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after });
          return after;
        } catch (e) { return fail(e); }
      },
      async remove(id: string): Promise<void> {
        try {
          const before = await repo.findByIdOnClient(client, def, id);
          if (!before) throw new NotFoundError('Feature not found');
          await repo.tombstoneInVersion(client, def, draftId, id);
          await audit.record({ userId: actorId, action: 'delete', tableName: def.table, featureId: id, before });
        } catch (e) { return fail(e); }
      },
      async commit(): Promise<void> {
        try {
          await versions.commitEditDraft(client, def.key, draftId);
          await client.query('COMMIT'); client.release();
        } catch (e) { return fail(e); }
      },
      async discard(): Promise<void> {
        try {
          await versions.discardEditDraft(client, def.key, draftId);
          await client.query('COMMIT'); client.release();
        } catch (e) { return fail(e); }
      },
    };
  }

  return {
    async list(key: string): Promise<FeatureRow[]> { return repo.list(getLayer(key)); },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },
    editSession,

    // Backward-compatible single-change helpers: each opens a session, applies one
    // change, and commits — so no caller writes the active version in place.
    async create(key: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const s = await editSession(key, actorId);
      const row = await s.create(input);
      await s.commit();
      return row;
    },
    async update(key: string, id: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const s = await editSession(key, actorId);
      const row = await s.update(id, input);
      await s.commit();
      return row;
    },
    async remove(key: string, id: string, actorId?: string): Promise<void> {
      const s = await editSession(key, actorId);
      await s.remove(id);
      await s.commit();
    },
  };
}
```

> **Transaction discipline (required):** every write in a session — feature rows AND the version lifecycle — must run on the session's single `PoolClient` inside one `BEGIN`/`COMMIT`. Do **not** write feature rows on the pool while the lifecycle runs on the client: uncommitted draft rows would be invisible to `commitEditDraft`'s count, and `discard` would leave orphan rows the rollback never removes. The version-targeted repository methods (Step 4) therefore take an explicit `client: PoolClient` as their first parameter, and the `versionsService` draft methods already do. Reads (`findById` for audit `before`) may use the pool, but any read of rows written earlier in the same session must use `client`.

- [ ] **Step 6: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/modules/layers/service.test.ts`
Expected: PASS (all edit-session tests).

- [ ] **Step 7: Run the full API test suite (no regression)**

Run (from `apps/api`): `npm test`
Expected: PASS — resolver, seeds, layers, schema, and existing suites all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/versions/service.ts apps/api/src/modules/layers/repository.ts apps/api/src/modules/layers/service.ts apps/api/src/modules/layers/service.test.ts
git commit -m "feat(api): steward edits publish as copy-on-write edit-version (§7)"
```

---

### Task 7: Active-version resolving views (§5 — DB side)

Adds per-layer SQL views `water.<layer>_active` that resolve the active version via the §4 chain logic, expressed as pure SQL so GeoServer can serve them. A migration creates the views; because the active version can change (edit commit, second ingest), the views must resolve the *currently* active version at query time, not bake in an id.

**Files:**
- Create: `apps/api/src/db/migrations/1000000000005_active-version-views.cjs`
- Test: `apps/api/src/db/schema.test.ts` (append active-view checks)

**Interfaces:**
- Consumes: `app.dataset_versions`, version-stamped `water.*` tables.
- Produces: view `water.<layer>_active` per thematic layer, returning the resolved feature rows (same columns as the base table, tombstones excluded) for whatever version is currently active — a flat filter when the active version is an ingest version, the recursive chain resolve when it is an edit version.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/db/schema.test.ts` (inside a new describe):

```typescript
describe('active-version views (§5)', () => {
  const tables = [
    'dams', 'rivers', 'stations', 'flood_zones',
    'drought_points', 'saltwater_intrusion', 'flood_generation',
  ];

  it('has a <layer>_active view for every thematic layer', async () => {
    for (const t of tables) {
      const { rows } = await getPool().query(
        `SELECT 1 FROM information_schema.views WHERE table_schema='water' AND table_name=$1`,
        [`${t}_active`]
      );
      expect(rows.length, `${t}_active`).toBe(1);
    }
  });

  it('the active view returns the active version rows (matches the resolver)', async () => {
    // For a backfilled/seeded ingest-active layer, the view count equals live non-deleted rows.
    const { rows: viaView } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
    const { rows: active } = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key = 'dams' AND is_active`
    );
    const { rows: direct } = await getPool().query(
      `SELECT count(*)::int AS n FROM water.dams WHERE dataset_version_id = $1 AND NOT deleted`,
      [active.rows[0].id]
    );
    expect(viaView[0].n).toBe(direct[0].n);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/db/schema.test.ts`
Expected: FAIL — `relation "water.dams_active" does not exist`.

- [ ] **Step 3: Write the views migration**

Create `apps/api/src/db/migrations/1000000000005_active-version-views.cjs`. The view uses a recursive CTE to build the active version's chain, then `DISTINCT ON (external_id)` nearest-wins, tombstones excluded. For an ingest active version the chain is one element and it degenerates to the flat filter.

```javascript
/* eslint-disable camelcase */
exports.shorthands = undefined;

const THEMATIC = [
  'dams', 'rivers', 'stations', 'flood_zones',
  'drought_points', 'saltwater_intrusion', 'flood_generation',
];

function viewSql(layer) {
  return `
    CREATE VIEW water.${layer}_active AS
    WITH RECURSIVE active AS (
      SELECT id FROM app.dataset_versions WHERE layer_key = '${layer}' AND is_active
    ),
    chain AS (
      SELECT v.id, v.parent_version_id, 0 AS depth
        FROM app.dataset_versions v JOIN active a ON v.id = a.id
      UNION ALL
      SELECT p.id, p.parent_version_id, c.depth + 1
        FROM app.dataset_versions p JOIN chain c ON p.id = c.parent_version_id
    ),
    resolved AS (
      SELECT DISTINCT ON (t.external_id) t.*
        FROM water.${layer} t JOIN chain c ON t.dataset_version_id = c.id
        ORDER BY t.external_id, c.depth
    )
    SELECT * FROM resolved WHERE NOT deleted;
  `;
}

exports.up = (pgm) => {
  for (const layer of THEMATIC) {
    pgm.sql(viewSql(layer));
  }
};

exports.down = (pgm) => {
  for (const layer of THEMATIC) {
    pgm.sql(`DROP VIEW IF EXISTS water.${layer}_active;`);
  }
};
```

- [ ] **Step 4: Apply the migration**

Run (from `apps/api`): `npm run migrate:up`
Expected: `1000000000005_active-version-views` runs, "Migrations complete".

- [ ] **Step 5: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/db/schema.test.ts`
Expected: PASS — the seven views exist and `dams_active` matches the direct resolver count.

- [ ] **Step 6: Verify an edit commit flows through the view**

Add one more test to the same `active-version views` describe:

```typescript
  it('reflects an edit-version commit (new feature appears via the view)', async () => {
    const NAME = 'view-flow@webatlas.test';
    const { rows: b } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
    // Simulate a committed edit-version off the active ingest.
    const active = await getPool().query(
      `SELECT id FROM app.dataset_versions WHERE layer_key='dams' AND is_active`
    );
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const edit = await client.query(
        `INSERT INTO app.dataset_versions (layer_key, kind, parent_version_id, source, label)
         VALUES ('dams','edit',$1,'edit session','view test') RETURNING id`, [active.rows[0].id]
      );
      await client.query(
        `INSERT INTO water.dams (external_id, name, dataset_version_id, geom)
         VALUES (999999, $1, $2, ST_SetSRID(ST_MakePoint(105.8,21.0),4326))`,
        [NAME, edit.rows[0].id]
      );
      await client.query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='dams' AND is_active`);
      await client.query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [edit.rows[0].id]);
      await client.query('COMMIT');
    } finally { client.release(); }

    const { rows: a } = await getPool().query(`SELECT count(*)::int AS n FROM water.dams_active`);
    expect(a[0].n).toBe(b[0].n + 1);

    // Restore active pointer and clean up so the suite is repeatable.
    await getPool().query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='dams' AND is_active`);
    await getPool().query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [active.rows[0].id]);
    await getPool().query(`DELETE FROM water.dams WHERE name=$1`, [NAME]);
    await getPool().query(`DELETE FROM app.dataset_versions WHERE label='view test' AND layer_key='dams'`);
  });
```

Run (from `apps/api`): `npm test -- src/db/schema.test.ts`
Expected: PASS — the view reflects the newly-active edit version.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/1000000000005_active-version-views.cjs apps/api/src/db/schema.test.ts
git commit -m "feat(api): per-layer active-version resolving views (§5 DB side)"
```

---

### Task 8: GeoServer serves the active-version views (§5 — serving side)

Repoints GeoServer's per-layer featuretype `nativeName` from the base table to its `_active` view. Published layer names stay identical, so WFS consumers see the active version unchanged.

**Files:**
- Modify: `apps/api/src/geoserver/publish.ts`
- Test: `apps/api/src/geoserver/publish.test.ts`

**Interfaces:**
- Consumes: the `water.<layer>_active` views (Task 7).
- Produces: `ensureLayer` publishes each featuretype with public `name = <layer>` but `nativeName = <layer>_active`, so the served data is the resolved active version. Public layer identity (`webatlas:dams`, …) is unchanged.

- [ ] **Step 1: Read the existing publish test to match its style**

Run: open `apps/api/src/geoserver/publish.test.ts` and note how it asserts request bodies (it likely stubs `gsRequest`). Confirm the assertion hook before writing the failing test.

- [ ] **Step 2: Write the failing test**

Append to `apps/api/src/geoserver/publish.test.ts` a check that the published featuretype uses the `_active` view as `nativeName` while keeping the public `name`. Adapt the exact stubbing to the file's existing pattern; the essential assertion:

```typescript
it('publishes each layer against its _active view as nativeName', async () => {
  // Arrange: stub gsExists to report nothing exists (force create path),
  // capture gsRequest bodies (follow the existing test's stubbing approach).
  const bodies = await capturePublishBodies(); // helper mirroring existing test setup
  const dams = bodies.find((b) => b?.featureType?.name === 'dams');
  expect(dams).toBeDefined();
  expect(dams.featureType.name).toBe('dams');
  expect(dams.featureType.nativeName).toBe('dams_active');
});
```

> If the existing test does not expose a body-capturing helper, add a minimal one alongside it using the same mock mechanism already imported there. Do not introduce a new mocking library.

- [ ] **Step 3: Run test to verify it fails**

Run (from `apps/api`): `npm test -- src/geoserver/publish.test.ts`
Expected: FAIL — `nativeName` is currently `table` (`'dams'`), not `'dams_active'`.

- [ ] **Step 4: Update `ensureLayer`**

In `apps/api/src/geoserver/publish.ts`, change the published featuretype so `nativeName` points at the view. The public `name` stays the bare layer key:

```typescript
async function ensureLayer(table: string): Promise<void> {
  const view = `${table}_active`;
  const ftPath = `/workspaces/${WS}/datastores/${STORE}/featuretypes`;
  if (await gsExists(`${ftPath}/${table}`)) return;
  const body = {
    featureType: {
      name: table,          // public layer name is unchanged (webatlas:dams, …)
      nativeName: view,     // …but it is backed by the active-version resolving view
      srs: 'EPSG:4326',
      enabled: true,
    },
  };
  const res = await gsRequest('POST', ftPath, body);
  if (!res.ok) throw new Error(`publish ${table} failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `apps/api`): `npm test -- src/geoserver/publish.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run (from `apps/api`): `npm test`
Expected: PASS — entire API suite green.

```bash
git add apps/api/src/geoserver/publish.ts apps/api/src/geoserver/publish.test.ts
git commit -m "feat(api): GeoServer serves per-layer active-version views (§5 serving side)"
```

---

### Task 9: Full-path integration verification + mid-ingest rollback

One end-to-end test proving the spec's headline guarantees together: a second ingest leaves the prior version addressable and served; a mid-ingest failure rolls back with the old version still active; the active view is unchanged for consumers across all of it.

**Files:**
- Create: `apps/api/src/modules/versions/integration.test.ts`

**Interfaces:**
- Consumes: everything above (`runSeeds`/`loadLayerFeatures`, `versionsService`, the `_active` views).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/versions/integration.test.ts`:

```typescript
import { describe, it, expect, afterAll } from 'vitest';
import { getPool, closePool } from '../../db/pool';
import { versionsService } from './service';
import { loadLayerFeatures } from '../../db/seeds/run';
import { SEED_LAYERS } from '../../db/seeds/registry';

afterAll(async () => { await closePool(); });

describe('versioning integration (§6 rollback + addressability)', () => {
  it('a mid-ingest failure rolls back, leaving the previously-active version active and served', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const stations = SEED_LAYERS.find((l) => l.table === 'stations')!;

    const activeBefore = await svc.getActiveVersionId('stations');
    const { rows: servedBefore } = await pool.query(`SELECT count(*)::int AS n FROM water.stations_active`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v = await svc.createIngestVersion(client, { layerKey: 'stations', source: 'test', label: 'doomed' });
      await loadLayerFeatures(client, stations, v);
      // Simulate a failure after partial load, before activate.
      throw new Error('boom');
    } catch (e) {
      await client.query('ROLLBACK');
      expect((e as Error).message).toBe('boom');
    } finally {
      client.release();
    }

    // Active pointer never moved; the doomed version left no committed rows.
    expect(await svc.getActiveVersionId('stations')).toBe(activeBefore);
    const { rows: servedAfter } = await pool.query(`SELECT count(*)::int AS n FROM water.stations_active`);
    expect(servedAfter[0].n).toBe(servedBefore[0].n);
    const { rows: doomed } = await pool.query(
      `SELECT count(*)::int AS n FROM app.dataset_versions WHERE label = 'doomed'`
    );
    expect(doomed[0].n).toBe(0);
  });

  it('a prior version stays directly resolvable after a new ingest supersedes it', async () => {
    const pool = getPool();
    const svc = versionsService(pool);
    const priorActive = await svc.getActiveVersionId('stations')!;
    const priorIds = await svc.resolveFeatureIds('stations', priorActive!);

    // New successful ingest of the same layer.
    const stations = SEED_LAYERS.find((l) => l.table === 'stations')!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const v = await svc.createIngestVersion(client, { layerKey: 'stations', source: 'test', label: 'superseder' });
      await loadLayerFeatures(client, stations, v);
      await svc.activate(client, 'stations', v);
      await client.query('COMMIT');
    } finally { client.release(); }

    // Prior version still addressable with its original feature set.
    const stillThere = await svc.resolveFeatureIds('stations', priorActive!);
    expect(new Set(stillThere)).toEqual(new Set(priorIds));

    // Cleanup: restore prior active, drop the superseder.
    const superseder = await pool.query(
      `SELECT id FROM app.dataset_versions WHERE label = 'superseder' AND layer_key = 'stations'`
    );
    const supId = superseder.rows[0].id;
    await pool.query(`UPDATE app.dataset_versions SET is_active=false WHERE layer_key='stations' AND is_active`);
    await pool.query(`UPDATE app.dataset_versions SET is_active=true WHERE id=$1`, [priorActive]);
    await pool.query(`DELETE FROM water.stations WHERE dataset_version_id=$1`, [supId]);
    await pool.query(`DELETE FROM app.dataset_versions WHERE id=$1`, [supId]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run (from `apps/api`): `npm test -- src/modules/versions/integration.test.ts`
Expected: initially the test may reveal a real gap (e.g. `loadLayerFeatures` not exported, or view mismatch); fix the smallest cause. Once the machinery from Tasks 1–8 is correct, expected: PASS.

> If it fails because `loadLayerFeatures` isn't exported, confirm Task 5 Step 4 exported it (it does). If the rollback test shows the doomed version persisting, the ingest is not fully inside the transaction — re-check that `createIngestVersion` uses the passed `client`, not the pool.

- [ ] **Step 3: Full suite**

Run (from `apps/api`): `npm test`
Expected: PASS — the complete API suite, all versioning behavior green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/versions/integration.test.ts
git commit -m "test(api): end-to-end ingest rollback + prior-version addressability"
```

---

## Self-Review

**Spec coverage:**
- §1 two version kinds → Task 3 resolver (kind-aware), Task 1 enum + check constraint. ✓
- §2 `dataset_versions` registry (all columns, constraints) → Task 1. ✓
- §3 feature-table version column + `deleted` + per-version uniqueness + backfill v1 → Task 2. ✓
- §4 resolver (flat ingest / chain edit, nearest-wins, tombstones) → Task 3. ✓
- §5 serving active version (view + GeoServer, no client change) → Tasks 7 (DB view) + 8 (GeoServer repoint). ✓
- §6 ingest creates full version (transactional, rollback-safe) → Task 5 + rollback proof in Task 9. ✓
- §7 edit sessions copy-on-write (working state/commit/discard, audit unchanged) → Task 6. ✓
- Backfill correctness / constraints / resolver / ingest / edit / serving / no-client-regression testing table → covered across Tasks 1–9. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" left. Task 8 Step 1 asks the implementer to read the existing publish test to match its stubbing style rather than inventing a mock API blind — this is a deliberate "match the existing pattern" instruction, with the essential assertion spelled out, not a placeholder.

**Type consistency:** `versionsService`/`versionsRepository` method names (`createIngestVersion`, `activate`, `openEditDraft`, `commitEditDraft`, `discardEditDraft`, `resolveFeatureIds`, `getActiveVersionId`, `chainToRoot`, `resolvedSql`) are consistent across Tasks 3–9. `loadLayerFeatures` (Task 5) is consumed by Task 9. `layerKey` is consistently the bare table key (`'dams'`), matching `layer_key` in the registry, backfill, resolver, and views. `IngestVersionArgs` defined in Task 4, used in Task 5. `def.key` vs `def.table`: `openEditDraft` takes the bare key (`def.key`), which equals the `layer_key` value — consistent.

One known simplification is flagged inline (Task 6 Step 5 note): the edit-session repository writes run on the pool while the version lifecycle runs on the session's `client`. This is called out as acceptable for the single-steward model with a documented tightening path, rather than left as a silent gap.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-map-versioning-foundation.md`.
