import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { upsertLineage, appendProcessStep } from './lineage';
import type { Dataset } from './types';

const DB = process.env.DATABASE_URL;

const ds = (id: string, sources: { citation: string; licence: string }[]): Dataset => ({
  id,
  kind: 'derived',
  lineage: { statement: 'test statement', licence: 'CC0-1.0', sources },
  stages: [{ type: 'sql', statement: 'SELECT 1' }],
});

describe.skipIf(!DB)('lineage database writes', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function cleanup(datasetId: string): Promise<void> {
    await pool.query(`DELETE FROM app.dataset_lineage_step WHERE dataset_id = $1`, [datasetId]);
    await pool.query(`DELETE FROM app.dataset_lineage WHERE dataset_id = $1`, [datasetId]);
  }

  it('writes the lineage row and its sources, replacing sources on re-registration', async () => {
    const id = '__atlasdata_test__basic';
    try {
      await upsertLineage(
        pool,
        ds(id, [
          { citation: 'first source', licence: 'CC0-1.0' },
          { citation: 'second source', licence: 'ODbL-1.0' },
        ])
      );

      await upsertLineage(pool, ds(id, [{ citation: 'replacement source', licence: 'CC0-1.0' }]));

      const { rows: lineageRows } = await pool.query(
        `SELECT dataset_id FROM app.dataset_lineage WHERE dataset_id = $1`,
        [id]
      );
      expect(lineageRows).toHaveLength(1);

      const { rows: sourceRows } = await pool.query(
        `SELECT citation FROM app.dataset_lineage_source WHERE dataset_id = $1`,
        [id]
      );
      expect(sourceRows).toHaveLength(1);
      expect(sourceRows[0].citation).toBe('replacement source');
    } finally {
      await cleanup(id);
    }
  });

  it('rolls back the whole write when a source insert fails, leaving the original sources intact', async () => {
    const id = '__atlasdata_test__atomic';
    try {
      await upsertLineage(
        pool,
        ds(id, [
          { citation: 'original one', licence: 'CC0-1.0' },
          { citation: 'original two', licence: 'ODbL-1.0' },
        ])
      );

      const badDataset = ds(id, [
        { citation: 'good source', licence: 'CC0-1.0' },
        { citation: 'bad source', licence: null as unknown as string },
      ]);

      await expect(upsertLineage(pool, badDataset)).rejects.toThrow();

      const { rows: sourceRows } = await pool.query(
        `SELECT citation, licence FROM app.dataset_lineage_source WHERE dataset_id = $1 ORDER BY citation`,
        [id]
      );
      expect(sourceRows).toHaveLength(2);
      expect(sourceRows.map((r) => r.citation)).toEqual(['original one', 'original two']);
    } finally {
      await cleanup(id);
    }
  });

  it('appends a process step after lineage exists', async () => {
    const id = '__atlasdata_test__step';
    try {
      await upsertLineage(pool, ds(id, []));
      await appendProcessStep(pool, id, 'ran the fetch stage', 'curl');

      const { rows } = await pool.query(
        `SELECT description, tool FROM app.dataset_lineage_step WHERE dataset_id = $1`,
        [id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].description).toBe('ran the fetch stage');
      expect(rows[0].tool).toBe('curl');
    } finally {
      await cleanup(id);
    }
  });

  it('rejects a process step for a dataset with no lineage row', async () => {
    const id = '__atlasdata_test__no-lineage';
    await expect(
      appendProcessStep(pool, id, 'should not be written', 'curl')
    ).rejects.toThrow();
  });
});
