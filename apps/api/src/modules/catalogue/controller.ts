import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError, ConflictError, MALFORMED_UPLOAD, ValidationError } from '../../errors';
import { validate } from '../../lib/validate';
import type { CurrentUser } from '../../types/fastify';
import { catalogueRepository } from './repository';
import { IdParams, SearchQuery, TimeseriesBody } from './schemas';
import { NEEDS_SSO, catalogueUploadsService } from './uploads';

function userOf(req: FastifyRequest): CurrentUser {
  if (!req.currentUser) throw new AuthError();
  return req.currentUser;
}

export async function search(req: FastifyRequest, reply: FastifyReply) {
  const query = validate(SearchQuery, req.query);
  reply.send(await catalogueRepository(req.server.pg).search(req.currentUser, query));
}

export async function getItem(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(IdParams, req.params);
  reply.send(await catalogueRepository(req.server.pg).get(req.currentUser, id));
}

/** One multipart field, `file`. Multipart is registered for the catalogue routes only (server.ts). */
export async function createUpload(req: FastifyRequest, reply: FastifyReply) {
  const user = userOf(req);
  if (!user.oidcSubject) {
    // Refused before the body is read (it is drained, not buffered).
    req.raw.resume();
    throw new ConflictError(NEEDS_SSO);
  }
  if (!req.isMultipart()) throw new ValidationError();
  let part: Awaited<ReturnType<FastifyRequest['file']>>;
  try {
    part = await req.file();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('FST_')) throw err;
    throw new ValidationError(MALFORMED_UPLOAD);
  }
  if (!part) throw new ValidationError();
  if (part.fieldname !== 'file') {
    part.file.resume(); // let the request body drain
    throw new ValidationError();
  }
  const file = part.file;
  try {
    const { upload } = await catalogueUploadsService(req.server.pg).upload(user, {
      filename: part.filename, mimetype: part.mimetype, file,
    });
    reply.code(201).send({ upload: { id: upload.id, originalName: upload.originalName, sizeBytes: upload.sizeBytes } });
  } catch (err) {
    // The body broke off inside the file: a malformed request, not a server fault (as workspace uploads).
    if (file.destroyed && !file.readableEnded) throw new ValidationError(MALFORMED_UPLOAD);
    throw err;
  }
}

export async function createTimeseries(req: FastifyRequest, reply: FastifyReply) {
  const body = validate(TimeseriesBody, req.body);
  reply.code(202).send(await catalogueUploadsService(req.server.pg).enqueue(userOf(req), body));
}
