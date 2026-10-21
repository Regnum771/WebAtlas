import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { openDraft } from '@webatlas/versioning';
import { runStages } from '@webatlas/versioning/testing';
import { getPool, closePool } from './pool';
import { bumpMap } from '../modules/workspace/access';
import { activeRelation, featuresRepository, type BBox } from '../modules/layers/repository';
import { getLayer, type LayerDef } from '../layers/registry';

afterAll(async () => {
  await closePool();
});

// Schema-level checks for migration 28 (workspace.files, workspace.jobs, quota_bytes and the
// SQL functions shared by the API and the worker). All but the cascade test run inside a
// transaction that is always rolled back.

const ASSISTANT = 'webatlas_assistant';
const GIB = '1073741824';
const email = (who: string) => `p3b-files-jobs-${who}@webatlas.test`;
const FUNCTIONS = [
  'workspace.bump_map(uuid)',
  'workspace.usage_bytes(uuid)',
  'workspace.edit_copy_rows(regclass,regclass,uuid,text,text[],geometry,integer)',
] as const;

async function inRolledBackTx(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

async function insertUser(c: pg.Pool | pg.PoolClient, who: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash, role) VALUES ($1, 'x', 'viewer') RETURNING id::text AS id`,
    [email(who)]
  );
  return rows[0].id;
}

async function insertMap(c: pg.Pool | pg.PoolClient, owner: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO workspace.maps (owner_id, title) VALUES ($1, 'probe') RETURNING id::text AS id`,
    [owner]
  );
  return rows[0].id;
}

async function insertFreeLayer(c: pg.PoolClient, map: string, position: number): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO workspace.map_layers (map_id, kind, title, position, geometry_type)
     VALUES ($1, 'free', 'l', $2, 'point') RETURNING id::text AS id`,
    [map, position]
  );
  return rows[0].id;
}

async function insertFile(
  c: pg.Pool | pg.PoolClient, owner: string, path: string, size: number, deleteAfter: string | null = null
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes, delete_after)
     VALUES ($1, 'upload', $2, 'a.gpkg', 'application/geopackage+sqlite3', $3, now() + $4::interval)
     RETURNING id::text AS id`,
    [owner, path, size, deleteAfter]
  );
  return rows[0].id;
}

/** Runs `sql` under a savepoint and returns the error it raised. */
async function failure(c: pg.PoolClient, sql: string, params: unknown[]): Promise<{ code?: string }> {
  await c.query('SAVEPOINT probe');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT probe');
    return e as { code?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT probe');
  throw new Error(`expected the statement to fail: ${sql}`);
}

/** workspace.edit_copy_rows called the way the API will call it for `def`. */
async function editCopyRows(
  c: pg.PoolClient, def: LayerDef, draftId: string, bbox: BBox | null, limit: number | null
): Promise<unknown[]> {
  const { rows } = await c.query(
    `SELECT id, geometry, properties
       FROM workspace.edit_copy_rows($1::regclass, $2::regclass, $3, $4, $5::text[],
                                     CASE WHEN $6::float8 IS NULL THEN NULL
                                          ELSE ST_MakeEnvelope($6, $7, $8, $9, 4326) END,
                                     $10)`,
    [def.table, activeRelation(def), draftId, def.geomColumn, def.attributeColumns, ...(bbox ?? [null, null, null, null]), limit]
  );
  return rows;
}

const VIETNAM: BBox = [100, 5, 115, 25];

describe('migration 28: files, jobs, quota and shared functions', () => {
  it('files and jobs reject bad kinds and statuses', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'checks');
      await insertFile(c, owner, 'uploads/ok.gpkg', 10);
      const fileKind = await failure(
        c,
        `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
         VALUES ($1, 'bogus', 'x', 'x', 'x', 1)`,
        [owner]
      );
      expect(fileKind.code).toBe('23514');
      const fileSize = await failure(
        c,
        `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
         VALUES ($1, 'upload', 'y', 'y', 'y', -1)`,
        [owner]
      );
      expect(fileSize.code).toBe('23514');
      const dupPath = await failure(
        c,
        `INSERT INTO workspace.files (owner_id, kind, path, original_name, content_type, size_bytes)
         VALUES ($1, 'cog', 'uploads/ok.gpkg', 'y', 'y', 1)`,
        [owner]
      );
      expect(dupPath.code).toBe('23505');

      const { rows: job } = await c.query<{ status: string; steps: unknown; progress: number }>(
        `INSERT INTO workspace.jobs (owner_id, kind, params) VALUES ($1, 'import', '{}'::jsonb)
         RETURNING status, steps, progress`,
        [owner]
      );
      expect(job[0]).toEqual({ status: 'queued', steps: [], progress: 0 });
      const jobKind = await failure(
        c, `INSERT INTO workspace.jobs (owner_id, kind, params) VALUES ($1, 'bogus', '{}'::jsonb)`, [owner]
      );
      expect(jobKind.code).toBe('23514');
      const jobStatus = await failure(
        c, `INSERT INTO workspace.jobs (owner_id, kind, status, params) VALUES ($1, 'export', 'done', '{}'::jsonb)`, [owner]
      );
      expect(jobStatus.code).toBe('23514');
      const jobProgress = await failure(
        c, `INSERT INTO workspace.jobs (owner_id, kind, progress, params) VALUES ($1, 'export', 101, '{}'::jsonb)`, [owner]
      );
      expect(jobProgress.code).toBe('23514');
    });
  });

  it('a raster layer needs raster metadata', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'raster');
      const map = await insertMap(c, owner);
      const file = await insertFile(c, owner, 'cogs/r.tif', 1000);
      const bare = await failure(
        c, `INSERT INTO workspace.map_layers (map_id, kind, title, position) VALUES ($1, 'raster', 'r', 0)`, [map]
      );
      expect(bare.code).toBe('23514');
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO workspace.map_layers (map_id, kind, title, position, file_id, raster)
         VALUES ($1, 'raster', 'r', 0, $2, '{"bands": 1}'::jsonb) RETURNING id::text AS id`,
        [map, file]
      );
      // Deleting the file leaves the layer, with no file.
      await c.query(`DELETE FROM workspace.files WHERE id = $1`, [file]);
      const after = await c.query<{ file_id: string | null }>(
        `SELECT file_id FROM workspace.map_layers WHERE id = $1`, [rows[0].id]
      );
      expect(after.rows).toEqual([{ file_id: null }]);
    });
  });

  it('quota_bytes defaults to 1 GiB', async () => {
    await inRolledBackTx(async (c) => {
      const user = await insertUser(c, 'quota');
      const { rows } = await c.query<{ quota_bytes: string }>(
        `SELECT quota_bytes FROM app.users WHERE id = $1`, [user]
      );
      expect(rows[0].quota_bytes).toBe(GIB);
      const negative = await failure(c, `UPDATE app.users SET quota_bytes = -1 WHERE id = $1`, [user]);
      expect(negative.code).toBe('23514');
    });
  });

  it('bump_map behaves like bumpMap', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'bump');
      const map = await insertMap(c, owner);
      await c.query(
        `UPDATE workspace.maps
            SET revision = 3,
                updated_at = now() - interval '20 days',
                last_activity_at = now() - interval '20 days',
                inactivity_notice_at = now() - interval '1 day'
          WHERE id = $1`,
        [map]
      );
      const { rows } = await c.query<{ revision: number }>(`SELECT workspace.bump_map($1) AS revision`, [map]);
      expect(rows[0].revision).toBe(4);
      const state = await c.query<{ revision: number; notice: boolean; updated: boolean; active: boolean }>(
        `SELECT revision,
                inactivity_notice_at IS NULL AS notice,
                updated_at = now() AS updated,
                last_activity_at = now() AS active
           FROM workspace.maps WHERE id = $1`,
        [map]
      );
      expect(state.rows[0]).toEqual({ revision: 4, notice: true, updated: true, active: true });

      // The TS wrapper is a call to the function: same next revision, and a 404 for no map.
      expect(await bumpMap(c, map)).toBe(5);
      const missing = await c.query<{ revision: number | null }>(
        `SELECT workspace.bump_map(gen_random_uuid()) AS revision`
      );
      expect(missing.rows[0].revision).toBeNull();
      await expect(bumpMap(c, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('Không tìm thấy bản đồ.');
    });
  });

  it('usage_bytes counts live files and free features, not expired files', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'usage');
      const other = await insertUser(c, 'usage-other');
      const empty = await c.query<{ bytes: string }>(`SELECT workspace.usage_bytes($1) AS bytes`, [owner]);
      expect(empty.rows[0].bytes).toBe('0');

      await insertFile(c, owner, 'uploads/live.gpkg', 1000);
      await insertFile(c, owner, 'exports/later.zip', 500, '1 day');
      await insertFile(c, owner, 'exports/expired.zip', 7000, '-1 day');
      await insertFile(c, other, 'uploads/other.gpkg', 9000);

      const map = await insertMap(c, owner);
      const archived = await insertMap(c, owner);
      await c.query(`UPDATE workspace.maps SET archived_at = now() WHERE id = $1`, [archived]);
      const otherMap = await insertMap(c, other);
      for (const [m, n] of [[map, 2], [archived, 1], [otherMap, 3]] as const) {
        const layer = await insertFreeLayer(c, m, 0);
        for (let i = 0; i < n; i++) {
          await c.query(
            `INSERT INTO workspace.features (layer_id, geom, properties)
             VALUES ($1, ST_SetSRID(ST_MakePoint(105 + $2::int, 21), 4326), jsonb_build_object('name', 'feature ' || $2))`,
            [layer, i]
          );
        }
      }
      const { rows: expected } = await c.query<{ bytes: string }>(
        `SELECT sum(pg_column_size(f.geom) + pg_column_size(f.properties))::bigint AS bytes
           FROM workspace.features f
           JOIN workspace.map_layers l ON l.id = f.layer_id
           JOIN workspace.maps m ON m.id = l.map_id
          WHERE m.owner_id = $1`,
        [owner]
      );
      const featureBytes = Number(expected[0].bytes);
      expect(featureBytes).toBeGreaterThan(0);
      const { rows } = await c.query<{ bytes: string }>(`SELECT workspace.usage_bytes($1) AS bytes`, [owner]);
      expect(Number(rows[0].bytes)).toBe(1000 + 500 + featureBytes);
    });
  });

  it('edit_copy_rows returns exactly what editCopyFeaturesInBBox returns (dams)', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'editcopy-dams');
      const def = getLayer('dams');
      const repo = featuresRepository(c);
      const draft = await openDraft(c, def.key, owner);
      const { rows: picked } = await c.query<{ id: string }>(
        `SELECT id::text AS id FROM water.dams_active WHERE geom IS NOT NULL ORDER BY id LIMIT 2`
      );
      const [changed, removed] = picked.map((r) => r.id);
      const src = await repo.resolveEditSource(c, def, draft.id, changed, { untouchedFrom: 'active' });
      await repo.upsertChangeInVersion(c, def, draft.id, src, { attrs: { name: 'p3b changed' }, actorId: owner });
      const gone = await repo.resolveEditSource(c, def, draft.id, removed, { untouchedFrom: 'active' });
      await repo.tombstoneInVersion(c, def, draft.id, gone);
      await c.query(
        `INSERT INTO water.dams (external_id, name, geom, dataset_version_id, managing_unit)
         VALUES (901101, 'p3b new', ST_SetSRID(ST_MakePoint(105.8, 21.0), 4326), $1, 'VN'),
                (901102, 'p3b no geometry', NULL, $1, 'VN')`,
        [draft.id]
      );

      // Same rows, same order, with and without truncation.
      for (const limit of [1000, 4]) {
        const ts = await repo.editCopyFeaturesInBBox(c, def, draft.id, VIETNAM, limit);
        const sql = await editCopyRows(c, def, draft.id, VIETNAM, limit + 1);
        expect(sql).toEqual(ts);
      }

      // No bbox, no limit: every official row the draft has not touched, plus the draft's own
      // live rows, those without geometry included.
      const all = (await editCopyRows(c, def, draft.id, null, null)) as Array<{
        id: string; geometry: unknown; properties: Record<string, unknown>;
      }>;
      const { rows: n } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM water.dams_active`);
      expect(all).toHaveLength(n[0].n - 1 + 2);
      expect(all.map((r) => r.id)).not.toContain(removed);
      expect(all.map((r) => r.id)).not.toContain(changed);
      expect(all.filter((r) => r.properties.name === 'p3b changed')).toHaveLength(1);
      const noGeom = all.find((r) => r.properties.external_id === '901102');
      expect(noGeom?.geometry).toBeNull();
      expect(Object.keys(noGeom!.properties).sort()).toEqual(['external_id', ...def.attributeColumns].sort());
    });
  });

  it('edit_copy_rows returns exactly what editCopyFeaturesInBBox returns (rivers)', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'editcopy-rivers');
      const def = getLayer('rivers');
      const repo = featuresRepository(c);
      const draft = await openDraft(c, def.key, owner);
      const { rows: way } = await c.query<{ id: string; x0: number; y0: number; x1: number; y1: number }>(
        `SELECT id::text AS id, ST_XMin(b) AS x0, ST_YMin(b) AS y0, ST_XMax(b) AS x1, ST_YMax(b) AS y1
           FROM (SELECT id, ST_Expand(geom, 0.05) AS b FROM water.rivers_detail
                  WHERE geom IS NOT NULL ORDER BY id LIMIT 1) w`
      );
      const src = await repo.resolveEditSource(c, def, draft.id, way[0].id, { untouchedFrom: 'active' });
      await repo.upsertChangeInVersion(c, def, draft.id, src, { attrs: { name: 'p3b changed way' }, actorId: owner });
      const bbox: BBox = [way[0].x0, way[0].y0, way[0].x1, way[0].y1];
      const ts = await repo.editCopyFeaturesInBBox(c, def, draft.id, bbox, 200);
      const sql = await editCopyRows(c, def, draft.id, bbox, 201);
      expect(ts.length).toBeGreaterThan(0);
      expect(sql).toEqual(ts);
      expect(ts.some((r) => r.properties.name === 'p3b changed way')).toBe(true);
    });
  });

  it('edit_copy_rows quotes the column names it is given', async () => {
    await inRolledBackTx(async (c) => {
      const owner = await insertUser(c, 'editcopy-quote');
      const draft = await openDraft(c, 'dams', owner);
      const err = await failure(
        c,
        `SELECT * FROM workspace.edit_copy_rows('water.dams', 'water.dams_active', $1, 'geom',
                                                ARRAY['name, 1) --'], NULL, 1)`,
        [draft.id]
      );
      expect(err.code).toBe('42703');
    });
  });

  it('deleting a user cascades to their files and jobs', async () => {
    const pool = getPool();
    try {
      const owner = await insertUser(pool, 'cascade');
      const map = await insertMap(pool, owner);
      const file = await insertFile(pool, owner, `uploads/p3b-files-jobs-cascade-${owner}.gpkg`, 10);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO workspace.jobs (owner_id, map_id, kind, params) VALUES ($1, $2, 'import', '{}'::jsonb)
         RETURNING id::text AS id`,
        [owner, map]
      );
      await pool.query(`DELETE FROM app.users WHERE id = $1`, [owner]);
      const gone = await pool.query<{ files: number; jobs: number }>(
        `SELECT (SELECT count(*) FROM workspace.files WHERE id = $1)::int AS files,
                (SELECT count(*) FROM workspace.jobs WHERE id = $2)::int AS jobs`,
        [file, rows[0].id]
      );
      expect(gone.rows[0]).toEqual({ files: 0, jobs: 0 });
    } finally {
      await runStages([
        async () => {
          await pool.query(`DELETE FROM app.users WHERE email = $1`, [email('cascade')]);
        },
      ]);
    }
  });

  it('the assistant role can use none of it', async () => {
    const pool = getPool();
    for (const t of ['workspace.files', 'workspace.jobs']) {
      const r = await pool.query<{ ok: boolean }>(
        `SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [ASSISTANT, t]
      );
      expect(r.rows[0].ok, t).toBe(false);
    }
    for (const f of FUNCTIONS) {
      for (const role of [ASSISTANT, 'public']) {
        const r = await pool.query<{ ok: boolean }>(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, f]
        );
        expect(r.rows[0].ok, `${role} ${f}`).toBe(false);
      }
    }
  });
});
