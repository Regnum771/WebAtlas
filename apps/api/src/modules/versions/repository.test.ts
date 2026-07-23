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
