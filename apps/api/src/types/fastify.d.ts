import type { Pool } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
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
