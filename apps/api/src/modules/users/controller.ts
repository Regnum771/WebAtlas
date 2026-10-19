import type { FastifyRequest, FastifyReply } from 'fastify';
import { validate } from '../../lib/validate';
import { usersService } from './service';
import { accessGroupsService } from '../access-groups/service';
import { SetUserGroupsBody } from '../access-groups/schemas';
import { CreateUserBody, UpdateUserBody, UserIdParams } from './schemas';

export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ users: await usersService(req.server.pg).list() });
}
export async function createUser(req: FastifyRequest, reply: FastifyReply) {
  const body = validate(CreateUserBody, req.body);
  const user = await usersService(req.server.pg).create(body, req.currentUser?.id);
  reply.code(201).send({ user });
}
export async function updateUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(UserIdParams, req.params);
  const patch = validate(UpdateUserBody, req.body);
  const user = await usersService(req.server.pg).update(id, patch, req.currentUser?.id);
  reply.send({ user });
}
export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(UserIdParams, req.params);
  await usersService(req.server.pg).remove(id, req.currentUser?.id);
  reply.code(204).send();
}
export async function setUserGroups(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(UserIdParams, req.params);
  const { groupIds } = validate(SetUserGroupsBody, req.body);
  // The route guard has already authenticated the request.
  const groups = await accessGroupsService(req.server.pg).setUserGroups(id, groupIds, req.currentUser!);
  reply.send({ groups });
}
