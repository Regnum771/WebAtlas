import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../authz/assert';
import { listUsers, createUser, updateUser, deleteUser } from './controller';

export default async function usersRoutes(app: FastifyInstance) {
  // Admin only for now; users.manage holders are let in by P1 Task 5.
  const adminOnly = { preHandler: [app.authenticate, requireAdmin()] };
  app.get('/', adminOnly, listUsers);
  app.post('/', adminOnly, createUser);
  app.put('/:id', adminOnly, updateUser);
  app.delete('/:id', adminOnly, deleteUser);
}
