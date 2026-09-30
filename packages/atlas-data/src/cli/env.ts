import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../paths';

/**
 * Load the dev environment (DATABASE_URL, GEOSERVER_*) from apps/api/.env when DATABASE_URL is
 * not already set, so `npm run atlas:build` works from a fresh shell. An explicit environment
 * always wins: nothing is loaded when DATABASE_URL is present, and process.loadEnvFile never
 * overrides a variable that is already set. Returns the file it loaded, or null.
 */
export function loadDevEnv(file: string = join(REPO_ROOT, 'apps', 'api', '.env')): string | null {
  if (process.env.DATABASE_URL) return null;
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}
