import type { FastifyRequest } from 'fastify';
import { ForbiddenError, AuthError } from '../errors';
import type { Role } from '../modules/users/repository';

export function authorize(...roles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!request.currentUser) throw new AuthError();
    if (!roles.includes(request.currentUser.role)) throw new ForbiddenError('Insufficient role');
  };
}
