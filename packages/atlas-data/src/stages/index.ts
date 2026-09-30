import type { Pool } from 'pg';
import type { Stage } from '../types';
import { executeSql } from './sql';
import { executeRun } from './run';
import { executeFetchHttp } from './fetchHttp';
import { executePublishGeoserver } from './publishGeoserver';

/** What a stage needs to know besides its own configuration. */
export interface StageContext {
  datasetId: string;
  /** True when the dataset was named in --force: re-do work even if its output exists. */
  forced: boolean;
  /** Where progress lines go. The runner passes console.log; tests pass a collector. */
  log: (line: string) => void;
}

/** What a stage reports back: a one-line account of what it actually did (I4). */
export interface StageResult {
  summary: string;
}

type Executor<T extends Stage['type']> = (
  pool: Pool,
  stage: Extract<Stage, { type: T }>,
  ctx: StageContext
) => Promise<StageResult>;

/**
 * One executor per stage type. A type missing here cannot run, and validateRegistry rejects
 * any descriptor that uses one, so the failure happens at load time rather than halfway
 * through a build (spec §8).
 */
const EXECUTORS: { [K in Stage['type']]?: Executor<K> } = {
  sql: executeSql,
  run: executeRun,
  'fetch-http': executeFetchHttp,
  'publish-geoserver': executePublishGeoserver,
};

export function hasExecutor(type: Stage['type']): boolean {
  return EXECUTORS[type] !== undefined;
}

export async function executeStage(pool: Pool, stage: Stage, ctx: StageContext): Promise<StageResult> {
  const exec = EXECUTORS[stage.type] as
    | ((pool: Pool, stage: Stage, ctx: StageContext) => Promise<StageResult>)
    | undefined;
  if (!exec) throw new Error(`Stage type "${stage.type}" has no executor`);
  return exec(pool, stage, ctx);
}
