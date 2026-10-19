import type { FastifyInstance } from 'fastify';
import { requireAdmin, requirePermission } from '../../authz/assert';
import { listUsers, createUser, updateUser, deleteUser, setUserGroups } from './controller';

export default async function usersRoutes(app: FastifyInstance) {
  // users.manage holders list users and change memberships (within the no-escalation rule);
  // creating, editing and deleting accounts stays with admin.
  const managers = { preHandler: [app.authenticate, requirePermission('users.manage')] };
  const adminOnly = { preHandler: [app.authenticate, requireAdmin()] };
  app.get('/', managers, listUsers);
  app.put('/:id/groups', managers, setUserGroups);
  app.post('/', adminOnly, createUser);
  app.put('/:id', adminOnly, updateUser);
  app.delete('/:id', adminOnly, deleteUser);
}
