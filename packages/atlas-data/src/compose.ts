import { join } from 'node:path';
import { REPO_ROOT } from './paths';

/**
 * Keys docker compose interpolates into infra/docker-compose.yml from infra/.env. Removed from the
 * environment of every docker compose child: loadDevEnv copies apps/api/.env into process.env, and a
 * variable present in the environment OVERRIDES infra/.env during interpolation — silently changing
 * credentials, and able to make `compose run` recreate a running service (Plan A final review).
 */
export const COMPOSE_INTERPOLATED_KEYS = [
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT',
  'GEOSERVER_ADMIN_USER', 'GEOSERVER_ADMIN_PASSWORD', 'GEOSERVER_PORT', 'ASSISTANT_DB_PASSWORD',
] as const;

export function composeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of COMPOSE_INTERPOLATED_KEYS) delete out[k];
  return out;
}

/** The compose file every docker call uses. `atlas:up --compose <file>` sets ATLAS_COMPOSE_FILE (spec §9). */
export function composeFile(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string {
  return env.ATLAS_COMPOSE_FILE ?? join(repoRoot, 'infra', 'docker-compose.yml');
}

export function composeArgs(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string[] {
  return ['compose', '-f', composeFile(env, repoRoot)];
}
