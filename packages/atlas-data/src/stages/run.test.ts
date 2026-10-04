import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { commandFor, executeRun, npmCli } from './run';
import type { Stage } from '../types';

type RunStage = Extract<Stage, { type: 'run' }>;
const stage = (over: Partial<RunStage>): RunStage => ({
  type: 'run', in: 'host', argv: ['--version'], produces: 'p', promoteTo: 'x', promoteBy: '2099-01-01', ...over,
});
const pool = {} as Pool;

describe('npmCli', () => {
  const realCli = npmCli({}, process.execPath);

  it("prefers npm_execpath when it is npm's own CLI script and exists", () => {
    expect(npmCli({ npm_execpath: realCli }, '/nowhere/node')).toBe(realCli);
  });

  it.each(['/x/yarn.js', '/x/pnpm-cli.js', '/x/npm/bin/npm-cli.js'])(
    'ignores npm_execpath=%s (not npm, or missing) and falls through to the lookup beside node',
    (p) => {
      expect(npmCli({ npm_execpath: p }, process.execPath)).toBe(realCli);
      expect(() => npmCli({ npm_execpath: p }, '/nowhere/node')).toThrow(/cannot locate npm-cli\.js/);
    }
  );

  it('otherwise finds npm-cli.js beside the running node', () => {
    const found = npmCli({}, process.execPath);
    expect(found.endsWith('npm-cli.js')).toBe(true);
  });

  it('throws a clear error when neither exists', () => {
    expect(() => npmCli({}, '/nowhere/node')).toThrow(/cannot locate npm-cli\.js/);
  });
});

describe('commandFor', () => {
  it('host: node + npm-cli.js + argv, from the repo root, never a shell', () => {
    const c = commandFor(stage({ argv: ['run', 'ingest:rivers', '-w', '@webatlas/api'] }), '/repo');
    expect(c.file).toBe(process.execPath);
    expect(c.args[0].endsWith('npm-cli.js')).toBe(true);
    expect(c.args.slice(1)).toEqual(['run', 'ingest:rivers', '-w', '@webatlas/api']);
    expect(c.cwd).toBe('/repo');
  });

  it('tools: docker compose run in the tools profile, on the repo compose file', () => {
    const c = commandFor(stage({ in: 'tools', argv: ['python', 'prep_dem.py', '--mainland'] }), '/repo');
    expect(c.file).toBe('docker');
    expect(c.args).toEqual([
      'compose', '-f', join('/repo', 'infra', 'docker-compose.yml'), '--profile', 'tools',
      'run', '--rm', '-T', '--no-deps', 'tools', 'python', 'prep_dem.py', '--mainland',
    ]);
  });
});

describe('executeRun', () => {
  const ctx = (lines: string[]) => ({ datasetId: 'rivers', forced: false, log: (l: string) => lines.push(l) });
  const viaNode = (script: string) => () => ({ file: process.execPath, args: ['-e', script], cwd: process.cwd() });

  it('succeeds on exit 0 and summarises the argv', async () => {
    const lines: string[] = [];
    await expect(executeRun(pool, stage({ argv: ['a', 'b'] }), ctx(lines), viaNode('console.log("ok")'))).resolves.toEqual({
      summary: 'a b',
    });
    expect(lines).toContain('[rivers] ok');
  });

  it('fails with the tail and the command that re-runs just this dataset', async () => {
    const run = executeRun(pool, stage({}), ctx([]), viaNode('console.log("last words"); process.exit(2)'));
    await expect(run).rejects.toThrow(/exit 2/);
    await expect(run).rejects.toThrow(/\| last words/);
    await expect(run).rejects.toThrow(/re-run: npm run atlas:build -- --only rivers$/m);
    await expect(run).rejects.not.toThrow(/--force/);
  });

  it('really runs npm on the host (argv --version)', async () => {
    const lines: string[] = [];
    await executeRun(pool, stage({ argv: ['--version'] }), ctx(lines));
    expect(lines.some((l) => /^\[rivers\] \d+\.\d+\.\d+$/.test(l))).toBe(true);
  }, 30_000);
  it("a tools stage's process does not see the interpolated compose keys", async () => {
    const saved = process.env.POSTGRES_PASSWORD;
    process.env.POSTGRES_PASSWORD = 'from-apps-api-env';
    try {
      const lines: string[] = [];
      await executeRun(
        pool,
        stage({ in: 'tools', argv: ['x'] }),
        ctx(lines),
        () => ({ file: process.execPath, args: ['-e', 'console.log(process.env.POSTGRES_PASSWORD ?? "unset")'], cwd: process.cwd() })
      );
      expect(lines).toContain('[rivers] unset');
    } finally {
      if (saved === undefined) delete process.env.POSTGRES_PASSWORD; else process.env.POSTGRES_PASSWORD = saved;
    }
  });
});
