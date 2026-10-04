/**
 * What other workspaces may import. The pipeline itself is run through its CLIs (`atlas:*`); this
 * entry exists for the API's test setup, which seeds through the same loader the build uses.
 */
export const PACKAGE_NAME = '@webatlas/atlas-data';
export { ensureSeeded, type SeedAction, type SeedOutcome } from './ensureSeeded';
export { ALL_DATASETS } from './registry';
export { resolveStageFile } from './paths';
