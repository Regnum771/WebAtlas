import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { runProcess } from '../process';
import { REPO_ROOT } from '../paths';
import { composeArgs, composeEnv } from '../compose';

type RunStage = Extract<Stage, { type: 'run' }>;

/**
 * npm's own CLI script, so host stages can run `node npm-cli.js …` with no shell.
 * `spawn('npm', …, { shell: false })` fails with ENOENT on Windows, where npm is a .cmd shim
 * (measured 2026-09-30). npm sets npm_execpath for every script it runs; outside npm, the
 * script sits beside node (Windows) or in ../lib (Unix).
 */
export function npmCli(env: NodeJS.ProcessEnv = process.env, execPath: string = process.execPath): string {
  const fromNpm = env.npm_execpath;
  // Only npm's own script that really exists: under yarn/pnpm npm_execpath names their CLI,
  // and a stale value would otherwise make every host stage fail obscurely.
  if (fromNpm && basename(fromNpm) === 'npm-cli.js' && existsSync(fromNpm)) return fromNpm;
  const dir = dirname(execPath);
  const candidates = [
    join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`cannot locate npm-cli.js beside ${execPath}; run atlas commands through npm (npm run atlas:build)`);
  }
  return found;
}

/** The process a run stage starts (spec §7). Pure apart from npmCli's file check. */
export function commandFor(stage: RunStage, repoRoot: string = REPO_ROOT): { file: string; args: string[]; cwd: string } {
  if (stage.in === 'host') {
    return { file: process.execPath, args: [npmCli(), ...stage.argv], cwd: repoRoot };
  }
  // -T: stdin is not a TTY (the runner ignores stdin). --no-deps: never start or recreate db/geoserver
  // from here — atlas:up owns the stack's lifecycle.
  return {
    file: 'docker',
    args: [...composeArgs(process.env, repoRoot), '--profile', 'tools', 'run', '--rm', '-T', '--no-deps', 'tools', ...stage.argv],
    cwd: repoRoot,
  };
}

/**
 * Execute a run stage. A non-zero exit fails it with the last lines of output and the command
 * that re-runs this dataset alone (U-3). `resolve` is injectable so tests can substitute a
 * `node -e` process for npm or docker.
 */
export async function executeRun(
  _pool: Pool,
  stage: RunStage,
  ctx: StageContext,
  resolve: typeof commandFor = commandFor
): Promise<StageResult> {
  const { file, args, cwd } = resolve(stage);
  const outcome = await runProcess(file, args, {
    label: ctx.datasetId,
    log: ctx.log,
    cwd,
    // Tools stages: let infra/.env govern compose interpolation (see compose.ts).
    env: stage.in === 'tools' ? composeEnv() : undefined,
  });
  if (outcome.code !== 0) {
    const why = outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.code}`;
    throw new Error(
      [
        `${stage.in} command failed (${why}): ${stage.argv.join(' ')}`,
        ...outcome.tail.map((l) => `  | ${l}`),
        `re-run: npm run atlas:build -- --only ${ctx.datasetId}`,
      ].join('\n')
    );
  }
  return { summary: stage.argv.join(' ') };
}
