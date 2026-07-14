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
  constructor(message = 'Forbidden') { super(403, 'FORBIDDEN', message); }
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
export class InternalError extends AppError {
  constructor(message = 'Internal server error') { super(500, 'INTERNAL_ERROR', message); }
}
