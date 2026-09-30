import type { Pool } from 'pg';
import type { Stage } from '../types';
import type { StageContext, StageResult } from './index';
import { defaultNativeName, geoserverEnv, publishLayer } from '../geoserver';

type PublishStage = Extract<Stage, { type: 'publish-geoserver' }>;

export async function executePublishGeoserver(
  _pool: Pool,
  stage: PublishStage,
  ctx: StageContext,
  env: NodeJS.ProcessEnv = process.env,
  f: typeof fetch = fetch
): Promise<StageResult> {
  const gs = geoserverEnv(env);
  const native = stage.nativeName ?? defaultNativeName(stage.layer);
  const outcome = await publishLayer(gs, { layer: stage.layer, nativeName: stage.nativeName, style: stage.style }, f);
  ctx.log(`[${ctx.datasetId}] ${gs.workspace}:${stage.layer} ${outcome}`);
  return { summary: `${gs.workspace}:${stage.layer} → ${native} (${outcome})` };
}
