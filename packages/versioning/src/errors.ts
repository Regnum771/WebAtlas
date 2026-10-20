import type { Conflict } from './rebase';

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

/** An edit draft was opened on a version that is no longer active, so committing it is refused. */
export class StaleDraftError extends ConflictError {}

/**
 * Publishing refused: features the draft changed also changed in the published data since the
 * draft's parent. A StaleDraftError, so the API keeps answering 409 STALE_EDIT.
 */
export class DraftConflictError extends StaleDraftError {
  constructor(public readonly conflicts: Conflict[]) {
    super(`Bản nháp xung đột với dữ liệu đã xuất bản ở ${conflicts.length} đối tượng.`);
  }
}

/** The draft is not in a state that accepts edits (only `personal` drafts are editable). */
export class DraftNotEditableError extends ConflictError {}

/** The draft's revision moved since the caller read it: someone else changed it. */
export class DraftRevisionError extends ConflictError {}
