import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { listUsers, createUser, updateUser, deleteUser } from './controller';

export default async function usersRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, authorize('admin')] };
  app.get('/', adminOnly, listUsers);
  app.post('/', adminOnly, createUser);
  app.put('/:id', adminOnly, updateUser);
  app.delete('/:id', adminOnly, deleteUser);
}
