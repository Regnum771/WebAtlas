import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Target } from '../targets';
import type { Tokens } from '../tokens';
import { emitTokensCss } from './tokensCss';

/**
 * The GeoNode/MapStore theme (K7): the --wa-* tokens, then src/geonode/geonode.css, which maps them onto
 * MapStore's --ms-* variables and styles the WebATLAS header. infra/docker-compose.platform.yml mounts
 * generated/geonode/ into the GeoNode containers as a template directory, and the overridden
 * custom_theme.html snippet includes this file inside a <style> element.
 */
const SOURCE = fileURLToPath(new URL('../geonode/geonode.css', import.meta.url));

export function emitGeonodeCss(t: Tokens): string {
  return `${emitTokensCss(t)}\n${readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n')}`;
}

export const geonodeTargets: readonly Target[] = [
  { id: 'geonode-css', path: 'geonode/webatlas-theme/geonode.css', emit: emitGeonodeCss },
];
