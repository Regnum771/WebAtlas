import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The only module that knows the directory layout. Resolved from this file's own URL, so the path
 * arithmetic is right from src/ or from dist/ (both sit one level below the package root). That
 * is all it promises: the CLI runs through tsx, and the tsc output is not a standalone node entry
 * point (bundler module resolution, extensionless imports).
 */
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Downloads and intermediates. Git-ignored (spec §7). */
export const DATA_CACHE = join(PACKAGE_ROOT, 'data', 'cache');
/** Committed inputs (data/seeds) and git-ignored downloads (data/cache). */
export const DATA_DIR = join(PACKAGE_ROOT, 'data');

/** Where a load-geojson file lives: under data/ unless the stage says it is repo-relative. */
export function resolveStageFile(f: { file: string; root?: 'data' | 'repo' }): string {
  return join(f.root === 'repo' ? REPO_ROOT : DATA_DIR, ...f.file.split('/'));
}
