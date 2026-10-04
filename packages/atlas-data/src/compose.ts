import { isAbsolute, join, resolve } from 'node:path';
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
  // Case-insensitive: on Windows environment names are, and a copy of process.env is a plain object,
  // so `Postgres_Password` would otherwise survive and still be interpolated by compose.
  const drop = new Set<string>(COMPOSE_INTERPOLATED_KEYS.map((k) => k.toUpperCase()));
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!drop.has(k.toUpperCase())) out[k] = v;
  return out;
}

/** The compose file every docker call uses. `atlas:up --compose <file>` sets ATLAS_COMPOSE_FILE (spec §9). */
export function composeFile(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string {
  // Relative to the repository: docker runs there (cli/system.ts), whichever workspace npm is in.
  const file = env.ATLAS_COMPOSE_FILE;
  if (!file) return join(repoRoot, 'infra', 'docker-compose.yml');
  return isAbsolute(file) ? file : resolve(repoRoot, file);
}

export function composeArgs(env: NodeJS.ProcessEnv = process.env, repoRoot: string = REPO_ROOT): string[] {
  return ['compose', '-f', composeFile(env, repoRoot)];
}
