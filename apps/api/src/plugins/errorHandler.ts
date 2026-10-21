import fp from 'fastify-plugin';
import { AppError, ConflictError, FileTooLargeError, InternalError, NotFoundError } from '../errors';
import {
  ConflictError as VersioningConflictError, NotFoundError as VersioningNotFoundError, StaleDraftError,
  DraftConflictError, DraftNotEditableError, DraftRevisionError,
} from '@webatlas/versioning';
import { MapRevisionError } from '../modules/workspace/access';

export default fp(async (app) => {
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.setErrorHandler((err, req, reply) => {
    // @fastify/rate-limit sets statusCode 429; Fastify validation sets err.validation
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if (err instanceof VersioningNotFoundError) {
      // The versioning package throws its own, HTTP-free classes; they keep the responses the
      // versions service gave when it lived here and threw the API's.
      appErr = new NotFoundError(err.message);
    } else if (err instanceof DraftRevisionError) {
      // The draft moved since the caller read it (another tab, or a resolution elsewhere).
      appErr = new AppError(409, 'DRAFT_CHANGED', 'Bản đồ đã thay đổi ở nơi khác.');
    } else if (err instanceof MapRevisionError) {
      // A personal map moved since the caller read it (another tab); nothing was changed.
      appErr = new AppError(409, 'MAP_CHANGED', 'Bản đồ đã thay đổi ở nơi khác.');
    } else if (err instanceof DraftNotEditableError) {
      appErr = new AppError(409, 'DRAFT_NOT_EDITABLE', 'Bản nháp đã được nộp, không sửa được nữa.');
    } else if (err instanceof DraftConflictError) {
      // Before StaleDraftError, which it extends: same code, plus the conflicting features.
      appErr = new AppError(409, 'STALE_EDIT', err.message, {
        conflicts: err.conflicts.map((c) => c.externalId),
      });
    } else if (err instanceof StaleDraftError) {
      // Distinct code so a client can tell "someone else saved first" from other 409s.
      appErr = new AppError(409, 'STALE_EDIT', err.message);
    } else if (err instanceof VersioningConflictError) {
      appErr = new ConflictError(err.message);
    } else if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      // @fastify/multipart's own over-the-limit error (workspace uploads).
      appErr = new FileTooLargeError();
    } else if ((err as { statusCode?: number }).statusCode === 429) {
      appErr = new AppError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu, vui lòng thử lại sau.');
    } else {
      req.log.error(err);
      appErr = new InternalError();
    }
    if (appErr.statusCode >= 500) req.log.error(err);
    reply.code(appErr.statusCode).send({
      error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
    });
  });
});
