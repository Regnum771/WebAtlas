/**
 * The versioning core: dataset versions, activation and its obligations (river hierarchy, gates,
 * administrative codes), and loading features into a version. Depends on `pg` and
 * `@webatlas/shared` only, so both the API and the dataset pipeline can use it (spec §7, D4).
 */
export { ConflictError, NotFoundError } from './errors';
