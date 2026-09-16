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
    try {
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
    } finally {
      await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = '__test__'`);
    }
  });

  it('rejects a lineage row with no licence', async () => {
    const pool = getPool();
    await expect(
      pool.query(
        `INSERT INTO app.dataset_lineage (dataset_id, statement, licence)
         VALUES ('__test__licence', 'a', NULL)`
      )
    ).rejects.toThrow();
  });

  it('rejects stage state for a dataset with no lineage row', async () => {
    const pool = getPool();
    await expect(
      pool.query(
        `INSERT INTO app.dataset_stage_state (dataset_id, stage, input_hash, status)
         VALUES ('__test__no-lineage', 'sql', 'h', 'ok')`
      )
    ).rejects.toThrow();
  });

  it('rejects deleting a lineage row that still has a process step', async () => {
    const pool = getPool();
    const datasetId = '__test__has-step';
    try {
      await pool.query(
        `INSERT INTO app.dataset_lineage (dataset_id, statement, licence)
         VALUES ($1, 'a', 'CC0-1.0')`,
        [datasetId]
      );
      await pool.query(
        `INSERT INTO app.dataset_lineage_step (dataset_id, description)
         VALUES ($1, 'ran once')`,
        [datasetId]
      );
      await expect(
        pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId])
      ).rejects.toThrow();
    } finally {
      await pool.query(`DELETE FROM app.dataset_lineage_step WHERE dataset_id = $1`, [datasetId]);
      await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId]);
    }
  });

  it('deleting a lineage row with stage state but no steps succeeds and cascades', async () => {
    const pool = getPool();
    const datasetId = '__test__has-stage-state';
    try {
      await pool.query(
        `INSERT INTO app.dataset_lineage (dataset_id, statement, licence)
         VALUES ($1, 'a', 'CC0-1.0')`,
        [datasetId]
      );
      await pool.query(
        `INSERT INTO app.dataset_stage_state (dataset_id, stage, input_hash, status)
         VALUES ($1, 'sql', 'h', 'ok')`,
        [datasetId]
      );
      await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId]);
      const { rows } = await pool.query(
        `SELECT * FROM app.dataset_stage_state WHERE dataset_id = $1`,
        [datasetId]
      );
      expect(rows).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM app.dataset_stage_state WHERE dataset_id = $1`, [datasetId]);
      await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId]);
    }
  });
});
