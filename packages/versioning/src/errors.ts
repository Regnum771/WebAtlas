/**
 * What the versioning core throws. No HTTP knowledge here: apps/api's error handler maps
 * NotFoundError to 404 and ConflictError to 409 (apps/api/src/plugins/errorHandler.ts), and the
 * dataset pipeline reports them as a failed stage.
 */
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = new.target.name;
  }
}

export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message);
    this.name = new.target.name;
  }
}
