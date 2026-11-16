import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Target } from '../targets';
import type { Tokens } from '../tokens';
import { emitTokensCss } from './tokensCss';

/**
 * The Dagster frame stylesheet (K8): the --wa-* tokens, then src/dagster/dagster.css. The dagster-frame
 * nginx (infra/platform/dagster-frame) mounts generated/dagster/ and serves this at /__webatlas/dagster.css.
 */
const SOURCE = fileURLToPath(new URL('../dagster/dagster.css', import.meta.url));

export function emitDagsterCss(t: Tokens): string {
  return `${emitTokensCss(t)}\n${readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n')}`;
}

export const dagsterTargets: readonly Target[] = [
  { id: 'dagster-css', path: 'dagster/dagster.css', emit: emitDagsterCss },
];
