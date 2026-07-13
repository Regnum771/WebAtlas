import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config/env';
import { AuthError } from '../errors';
import { usersRepository } from '../modules/users/repository';

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
    request.currentUser = { id: user.id, email: user.email, role: user.role };
  });
});
