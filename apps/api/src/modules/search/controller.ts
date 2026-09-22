import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { SEARCH_SOURCES } from './repository';
import { searchService } from './service';

const SearchQuery = z.object({
  q: z.string().min(2, 'Từ khoá phải có ít nhất 2 ký tự'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  // Comma-separated. Omitted entirely (key absent from the query string) = the
  // four water layers, which is the behaviour every existing caller already
  // depends on -- preserved below by only treating `undefined` input as omitted.
  // A key that IS present but resolves to no usable token (`sources=` or
  // `sources=,,,`) is a caller error, not a silent empty success, so it is
  // refined to a 400 rather than falling back to the default.
  sources: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : s.split(',').map((t) => t.trim()).filter(Boolean)))
    .refine(
      (list) => list === undefined || list.length > 0,
      { message: 'Danh sách nguồn tìm kiếm (sources) rỗng hoặc không hợp lệ' }
    )
    .refine(
      (list) => list === undefined || list.every((t) => SEARCH_SOURCES.includes(t)),
      { message: `Nguồn tìm kiếm không hợp lệ; hợp lệ: ${SEARCH_SOURCES.join(', ')}` }
    ),
});

export async function search(req: FastifyRequest, reply: FastifyReply) {
  const { q, limit, sources } = validate(SearchQuery, req.query);
  const results = await searchService(req.server.pg).search(q, limit, sources);
  reply.send({ results });
}
