import type { Pool } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Grant } from '@webatlas/shared';
import type { Role } from '../modules/users/repository';

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  isAdmin: boolean;
  // Loaded from the database on every request; never carried in the JWT.
  grants: Grant[];
}

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
