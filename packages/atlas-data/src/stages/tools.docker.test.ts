import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
const ctx = { datasetId: 'tools', forced: false, supersedeEdits: false, log: (l: string) => lines.push(l) };
const tools = (argv: string[]) =>
  ({ type: 'run' as const, in: 'tools' as const, argv, produces: 'p', promoteTo: 'x', promoteBy: '2099-01-01' });

describe.skipIf(!ON)('the atlas-tools image', () => {
  beforeAll(async () => {
    const r = await runProcess('docker', [...composeArgs(), '--profile', 'tools', 'build', 'tools'], {
      label: 'build', log: () => {}, env: composeEnv(),
    });
    expect(r.code).toBe(0);
  }, 1_800_000);

  beforeEach(() => {
    lines.length = 0;
  });

  it('has the Python geo stack', async () => {
    await executeRun({} as Pool, tools(['python3', '-c', 'import geopandas, pyogrio, rasterio, psycopg2, sqlalchemy, geoalchemy2, requests; print("py ok")']), ctx);
    expect(lines).toContain('[tools] py ok');
  }, 300_000);

  it('has raster2pgsql, psql, bash and curl', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'command -v raster2pgsql psql curl >/dev/null && echo bins ok']), ctx);
    expect(lines).toContain('[tools] bins ok');
  }, 300_000);

  it('has a raster2pgsql that reports a PostGIS release', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'raster2pgsql 2>&1 | head -3']), ctx);
    expect(lines.some((l) => /RELEASE: 3\.\d+/.test(l))).toBe(true);
  }, 300_000);

  it('receives the in-network environment the scripts require', async () => {
    await executeRun({} as Pool, tools(['bash', '-c',
      'for v in BASEMAP_DB_URL GEOSERVER_DB_PASSWORD GEOSERVER_ADMIN_PASSWORD PGHOST; do [ -n "${!v}" ] || { echo "missing $v"; exit 1; }; done; echo env ok']), ctx);
    expect(lines).toContain('[tools] env ok');
  }, 300_000);

  // `compose run -T` gives Python a pipe, not a TTY, so stdout is block-buffered: in Task 12
  // load_basemap.py's progress lines never reached the log during a 30+ minute load.
  it('runs Python unbuffered, so progress lines stream while a stage runs', async () => {
    // write_through is what PYTHONUNBUFFERED / -u sets on a non-TTY stdout (it is False without it).
    await executeRun({} as Pool, tools(['python3', '-c', 'import sys; print("unbuffered" if sys.stdout.write_through else "buffered")']), ctx);
    expect(lines).toContain('[tools] unbuffered');
  }, 300_000);

  it('load_basemap.py clips through the spatial index and writes in chunks', async () => {
    await executeRun({} as Pool, tools(['python3', 'packages/atlas-data/tools/basemap/test_load_basemap.py']), ctx);
    expect(lines).toContain('[tools] load_basemap checks passed');
  }, 300_000);

  it('sees the repository at /repo', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', 'test -f packages/shared/src/contours.ts && echo repo ok']), ctx);
    expect(lines).toContain('[tools] repo ok');
  }, 300_000);

  it('reaches the database with the credentials from infra/.env', async () => {
    await executeRun({} as Pool, tools(['psql', '-tAc', 'SELECT 41 + 1']), ctx);
    expect(lines).toContain('[tools] 42');
  }, 300_000);

  it('has no CR in any .sh or .py script', async () => {
    await executeRun({} as Pool, tools(['bash', '-c', "! grep -rlI $'\\r' packages/atlas-data/tools --include=*.sh --include=*.py"]), ctx);
  }, 300_000);
});
