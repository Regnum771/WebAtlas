import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The only module that knows the directory layout. Resolved from this file's own URL, so it
 * is right whether the code runs from src/ (tsx, vitest) or dist/ (tsc output): both sit one
 * level below the package root.
 */
export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Downloads and intermediates. Git-ignored (spec §7). */
export const DATA_CACHE = join(PACKAGE_ROOT, 'data', 'cache');
