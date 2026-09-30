import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readStageState, writeStageState, invalidateStageState } from './state';

const DB = process.env.DATABASE_URL;

describe.skipIf(!DB)('stage state database writes', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertLineage(datasetId: string): Promise<void> {
    await pool.query(
      `INSERT INTO app.dataset_lineage (dataset_id, statement, licence) VALUES ($1, $2, $3)`,
      [datasetId, 'test statement', 'CC0-1.0']
    );
  }

  async function cleanup(datasetId: string): Promise<void> {
    await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId]);
  }

  it('returns null for a stage with no row', async () => {
    const id = '__atlasdata_test__no-row';
    try {
      await insertLineage(id);
      expect(await readStageState(pool, id, '0:sql')).toBeNull();
    } finally {
      await cleanup(id);
    }
  });

  it('writes then reads back the input hash and status', async () => {
    const id = '__atlasdata_test__write-read';
    try {
      await insertLineage(id);
      await writeStageState(pool, id, '0:sql', 'a'.repeat(64), 'ok');

      const state = await readStageState(pool, id, '0:sql');
      expect(state).toEqual({ input_hash: 'a'.repeat(64), status: 'ok' });
    } finally {
      await cleanup(id);
    }
  });

  it('overwrites the same (dataset_id, stage) with new values instead of duplicating', async () => {
    const id = '__atlasdata_test__overwrite';
    try {
      await insertLineage(id);
      await writeStageState(pool, id, '0:sql', 'a'.repeat(64), 'ok');
      await writeStageState(pool, id, '0:sql', 'b'.repeat(64), 'failed');

      const { rows } = await pool.query(
        `SELECT input_hash, status FROM app.dataset_stage_state WHERE dataset_id = $1 AND stage = $2`,
        [id, '0:sql']
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ input_hash: 'b'.repeat(64), status: 'failed' });
    } finally {
      await cleanup(id);
    }
  });

  it('rejects writing state for a dataset id with no lineage row', async () => {
    const id = '__atlasdata_test__no-lineage';
    await expect(writeStageState(pool, id, '0:sql', 'a'.repeat(64), 'ok')).rejects.toMatchObject({
      code: '23503',
    });
  });

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
});
