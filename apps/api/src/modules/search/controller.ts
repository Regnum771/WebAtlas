import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { searchService } from './service';

const SearchQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function search(req: FastifyRequest, reply: FastifyReply) {
  const { q, limit } = validate(SearchQuery, req.query);
  const results = await searchService(req.server.pg).search(q, limit);
  reply.send({ results });
}
