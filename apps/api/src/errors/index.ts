export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) { super(400, 'VALIDATION_ERROR', message, details); }
}
export class AuthError extends AppError {
  constructor(message = 'Authentication required') { super(401, 'AUTH_ERROR', message); }
}
export class ForbiddenError extends AppError {
  // `code` lets a client tell refusals apart (e.g. NO_PERMISSION vs OUT_OF_JURISDICTION).
  constructor(message = 'Forbidden', code = 'FORBIDDEN', details?: unknown) { super(403, code, message, details); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') { super(404, 'NOT_FOUND', message); }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict') { super(409, 'CONFLICT', message); }
}
export class GeometryError extends AppError {
  constructor(message = 'Invalid geometry', details?: unknown) { super(422, 'GEOMETRY_ERROR', message, details); }
}
/** An uploaded file over the per-file limit (multipart's own "file too large" maps here too). */
export class FileTooLargeError extends AppError {
  constructor() { super(413, 'FILE_TOO_LARGE', 'Tệp lớn hơn 200 MB.'); }
}
/** A workspace upload whose multipart body cannot be parsed (no boundary, cut short, ...). */
export const MALFORMED_UPLOAD = 'Yêu cầu tải lên không hợp lệ.';
/** Storing a file would take its owner over their quota. */
export class QuotaExceededError extends AppError {
  constructor(message: string) { super(413, 'QUOTA_EXCEEDED', message); }
}
export class InternalError extends AppError {
  constructor(message = 'Internal server error') { super(500, 'INTERNAL_ERROR', message); }
}
