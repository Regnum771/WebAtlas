import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { login } from './service';

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = validate(LoginBody, req.body);
  const result = await login(req.server, email, password);
  reply.send(result);
}

export async function meHandler(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ user: req.currentUser });
}
