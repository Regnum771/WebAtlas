/**
 * The versioning core: dataset versions, activation and its obligations (river hierarchy, gates,
 * administrative codes), and loading features into a version. Depends on `pg` and
 * `@webatlas/shared` only, so both the API and the dataset pipeline can use it (spec §7, D4).
 */
export { ConflictError, NotFoundError, StaleDraftError } from './errors';
export { versionsService, type IngestVersionArgs, type VersionsService } from './service';
export { versionsRepository, type DatasetVersion, type VersionsRepository } from './repository';
export { stampAdminCodes } from './adminStamp';
export {
  buildRiverHierarchy,
  materialiseResolved,
  MATCH_SAMPLES,
  MATCH_MIN_VOTES,
  MATCH_TOLERANCE_DEG,
  MATCH_MAX_MEDIAN_M,
  MATCH_KNN_WINDOW,
  BRIDGED_CONFIDENCE,
} from './riverHierarchy';
export { assertRiverGates, RIVER_BASELINE, type RiverBaseline } from './riverGates';
export { loadFeatures, type FeatureLoadSpec } from './loadFeatures';
export { resolvedSql } from './resolve';
export { refreshCurrentRows } from './currentRows';
export { assertPrunable, EARLIER_LOADS_KEPT, pruneVersions } from './retention';
