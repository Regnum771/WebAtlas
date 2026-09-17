import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { executeSql } from './sql';

const DB = process.env.DATABASE_URL;

describe.skipIf(!DB)('executeSql against a real database', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lets a lone non-transactional statement run, proving the stage adds no transaction', async () => {
    await expect(
      executeSql(pool, { type: 'sql', statement: 'VACUUM app.dataset_demo' })
    ).resolves.toBeUndefined();
  });

  it('rejects a non-transactional statement combined with another one in the same stage', async () => {
    await expect(
      executeSql(pool, { type: 'sql', statement: 'SELECT 1; VACUUM app.dataset_demo' })
    ).rejects.toThrow(/transaction block/i);
  });

  it('rolls back a multi-statement string whole when a later statement fails', async () => {
    try {
      await expect(
        executeSql(pool, {
          type: 'sql',
          statement:
            "INSERT INTO app.dataset_demo (id, note) VALUES (-424242, 'atlasdata test'); SELECT 1/0",
        })
      ).rejects.toThrow();

      const { rows } = await pool.query(
        'SELECT count(*) FROM app.dataset_demo WHERE id = -424242'
      );
      expect(Number(rows[0].count)).toBe(0);
    } finally {
      await pool.query('DELETE FROM app.dataset_demo WHERE id = -424242');
    }
  });
});
