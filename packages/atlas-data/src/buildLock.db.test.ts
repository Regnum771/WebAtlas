import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { BuildLockedError, withBuildLock } from './buildLock';

const DB = process.env.DATABASE_URL;
let pool: pg.Pool;
beforeAll(() => { if (DB) pool = new pg.Pool({ connectionString: DB }); });
afterAll(async () => { await pool?.end(); });

describe.skipIf(!DB)('the build lock', () => {
  it('lets one build run and refuses a second while it does, by name', async () => {
    let second: unknown;
    const result = await withBuildLock(pool, 'atlas:build', async () => {
      second = await withBuildLock(pool, 'atlas:up', async () => 'ran').catch((e: unknown) => e);
      return 'first';
    });
    expect(result).toBe('first');
    expect(second).toBeInstanceOf(BuildLockedError);
    expect((second as Error).message).toMatch(/^atlas:up: another atlas build is running against this database/);
  });

  it('is free again afterwards, also when the build threw', async () => {
    await expect(withBuildLock(pool, 'atlas:build', async () => { throw new Error('stage failed'); })).rejects.toThrow('stage failed');
    expect(await withBuildLock(pool, 'atlas:build', async () => 'ran')).toBe('ran');
  });
});
