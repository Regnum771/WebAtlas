import fp from 'fastify-plugin';
import { AppError, ConflictError, InternalError, NotFoundError } from '../errors';
import { ConflictError as VersioningConflictError, NotFoundError as VersioningNotFoundError, StaleDraftError } from '@webatlas/versioning';

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
    } else if (err instanceof StaleDraftError) {
      // Distinct code so a client can tell "someone else saved first" from other 409s.
      appErr = new AppError(409, 'STALE_EDIT', err.message);
    } else if (err instanceof VersioningConflictError) {
      appErr = new ConflictError(err.message);
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
