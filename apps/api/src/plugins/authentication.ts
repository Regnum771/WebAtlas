import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import { config } from '../config/env';
import { AuthError } from '../errors';
import { usersRepository } from '../modules/users/repository';
import { loadGrants } from '../authz/grants';

export default fp(async (app) => {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });

  async function verify(request: FastifyRequest) {
    let payload: { sub: string };
    try {
      payload = await request.jwtVerify();
    } catch {
      throw new AuthError('Invalid or expired token');
    }
    const repo = usersRepository(app.pg);
    const user = await repo.findById(payload.sub);
    if (!user || !user.is_active) throw new AuthError('User not found or inactive');
    // Grants are re-read on every request, so a revoked membership applies at once.
    const [grants, oidcSubject] = await Promise.all([loadGrants(app.pg, user.id), repo.oidcSubjectOf(user.id)]);
    request.currentUser = {
      id: user.id, email: user.email, role: user.role, isAdmin: user.role === 'admin', grants, oidcSubject,
    };
  }

  app.decorate('authenticate', async (request) => verify(request));

  // Public routes that show more to a signed-in caller: no Authorization header is anonymous,
  // a header that does not verify is still a 401 (a stale token must not silently read as public).
  app.decorate('authenticateOptional', async (request) => {
    if (!request.headers.authorization) return;
    await verify(request);
  });
});
