import { describe, it, expect, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { executeRun } from './run';
import { runProcess } from '../process';
import { composeArgs, composeEnv } from '../compose';

/**
 * Opt-in (ATLAS_TOOLS_TESTS=1): builds the atlas-tools image and runs real commands in it. Needs
 * Docker and the dev stack up (the psql check reaches `db`).
 */
const ON = process.env.ATLAS_TOOLS_TESTS === '1';
const lines: string[] = [];
const ctx = { datasetId: 'tools', forced: false, log: (l: string) => lines.push(l) };
const tools = (argv: string[]) =>
  ({ type: 'run' as const, in: 'tools' as const, argv, produces: 'p', promoteTo: 'x', promoteBy: '2099-01-01' });

describe.skipIf(!ON)('the atlas-tools image', () => {
  beforeAll(async () => {
    const r = await runProcess('docker', [...composeArgs(), '--profile', 'tools', 'build', 'tools'], {
      label: 'build', log: () => {}, env: composeEnv(),
    });
    expect(r.code).toBe(0);
  }, 1_800_000);

  it('has the Python geo stack', async () => {
    await expect(
      executeRun({} as Pool, tools(['python3', '-c', 'import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests; print("py ok")']), ctx)
    ).resolves.toBeDefined();
    expect(lines).toContain('[tools] py ok');
  }, 300_000);

  it('has raster2pgsql, psql, bash and curl', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'command -v raster2pgsql psql curl >/dev/null && echo bins ok']), ctx);
    expect(lines).toContain('[tools] bins ok');
  }, 300_000);

  it('sees the repository at /repo', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'test -f packages/shared/src/contours.ts && echo repo ok']), ctx);
    expect(lines).toContain('[tools] repo ok');
  }, 300_000);

  it('reaches the database with the credentials from infra/.env', async () => {
    await executeRun({} as Pool, tools(['psql', '-tAc', 'SELECT 41 + 1']), ctx);
    expect(lines).toContain('[tools] 42');
  }, 300_000);

  it('runs scripts with LF line endings', async () => {
    await executeRun({} as Pool, tools(['bash', '-n', 'packages/atlas-data/tools/load-dem.sh']), ctx);
  }, 300_000);
});
