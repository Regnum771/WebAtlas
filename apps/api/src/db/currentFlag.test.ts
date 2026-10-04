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
