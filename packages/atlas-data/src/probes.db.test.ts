import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { Pool } from 'pg';
import { probeContext, rowCount, viewCount, wfsAnswers } from './probes';

const DB = process.env.DATABASE_URL;
const GS = process.env.GEOSERVER_URL;

describe.skipIf(!DB || !GS)('probes against the dev stack (read-only)', () => {
  let pool: Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DB }); });
  afterAll(async () => { await pool.end(); });

  it('counts the 34 provinces', async () => {
    const r = await rowCount('admin.provinces', 'SELECT count(*)::text AS n FROM admin.provinces', 34)(probeContext(pool));
    expect(r).toEqual({ ok: true, detail: 'admin.provinces: 34' });
  });

  it('counts an active view and reads its WFS layer', async () => {
    const ctx = probeContext(pool);
    expect((await viewCount('dams')(ctx)).ok).toBe(true);
    expect((await wfsAnswers('dams')(ctx)).ok).toBe(true);
  }, 60_000);
});
