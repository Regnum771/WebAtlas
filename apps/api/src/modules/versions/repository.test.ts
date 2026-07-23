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
