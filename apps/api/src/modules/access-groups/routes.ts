import type { FastifyInstance } from 'fastify';
import { requireAdmin, requirePermission } from '../../authz/assert';
import { createGroup, deleteGroup, listGroups, listMembers, updateGroup } from './controller';

export default async function accessGroupsRoutes(app: FastifyInstance) {
  // users.manage holders read groups to assign them; only admin defines them.
  const readers = { preHandler: [app.authenticate, requirePermission('users.manage')] };
  const adminOnly = { preHandler: [app.authenticate, requireAdmin()] };
  app.get('/', readers, listGroups);
  app.get('/:id/members', readers, listMembers);
  app.post('/', adminOnly, createGroup);
  app.put('/:id', adminOnly, updateGroup);
  app.delete('/:id', adminOnly, deleteGroup);
}
