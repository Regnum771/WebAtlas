import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config/env';
import { AuthError } from '../errors';
import { usersRepository } from '../modules/users/repository';
import { loadGrants } from '../authz/grants';

export default fp(async (app) => {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });

  app.decorate('authenticate', async (request) => {
    let payload: { sub: string };
    try {
      payload = await request.jwtVerify();
    } catch {
      throw new AuthError('Invalid or expired token');
    }
    const user = await usersRepository(app.pg).findById(payload.sub);
    if (!user || !user.is_active) throw new AuthError('User not found or inactive');
    // Grants are re-read on every request, so a revoked membership applies at once.
    const grants = await loadGrants(app.pg, user.id);
    request.currentUser = { id: user.id, email: user.email, role: user.role, isAdmin: user.role === 'admin', grants };
  });
});
