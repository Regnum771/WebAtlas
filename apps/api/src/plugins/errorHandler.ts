import fp from 'fastify-plugin';
import { AppError, InternalError, NotFoundError } from '../errors';

export default fp(async (app) => {
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.setErrorHandler((err, req, reply) => {
    // @fastify/rate-limit sets statusCode 429; Fastify validation sets err.validation
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if ((err as { statusCode?: number }).statusCode === 429) {
      appErr = new AppError(429, 'RATE_LIMITED', 'Too many requests');
    } else {
      req.log.error(err);
      appErr = new InternalError();
    }
    if (appErr.statusCode >= 500) req.log.error(err);
    reply.code(appErr.statusCode).send({
      error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
    });
  });
  void NotFoundError; // referenced by modules; keep import tree-shake-safe
});
