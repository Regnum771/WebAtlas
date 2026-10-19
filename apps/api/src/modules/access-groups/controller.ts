import type { FastifyRequest, FastifyReply } from 'fastify';
import { validate } from '../../lib/validate';
import { accessGroupsService } from './service';
import { CreateGroupBody, GroupIdParams, UpdateGroupBody } from './schemas';

export async function listGroups(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ groups: await accessGroupsService(req.server.pg).list() });
}
export async function createGroup(req: FastifyRequest, reply: FastifyReply) {
  const body = validate(CreateGroupBody, req.body);
  const group = await accessGroupsService(req.server.pg).create(body, req.currentUser?.id);
  reply.code(201).send({ group });
}
export async function updateGroup(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(GroupIdParams, req.params);
  const patch = validate(UpdateGroupBody, req.body);
  const group = await accessGroupsService(req.server.pg).update(id, patch, req.currentUser?.id);
  reply.send({ group });
}
export async function deleteGroup(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(GroupIdParams, req.params);
  await accessGroupsService(req.server.pg).remove(id, req.currentUser?.id);
  reply.code(204).send();
}
export async function listMembers(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(GroupIdParams, req.params);
  reply.send({ members: await accessGroupsService(req.server.pg).members(id) });
}
