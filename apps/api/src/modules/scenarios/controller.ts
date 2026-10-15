import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FLOOD_SCENARIO_IDS } from '@webatlas/shared';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';
import { framePath, getImpacts, getPlan, getRoads, getScenario, listScenarios } from './repository';

const NOT_FOUND = 'Không có kịch bản lũ này.';

const IdParams = z.object({ id: z.string() });
const FrameParams = z.object({ id: z.enum(FLOOD_SCENARIO_IDS), hour: z.string().regex(/^\d{1,3}$/).transform(Number) });
const HourQuery = z.object({ hour: z.coerce.number().int() });

function scenarioId(params: unknown) {
  const { id } = validate(IdParams, params);
  const known = (FLOOD_SCENARIO_IDS as readonly string[]).includes(id);
  if (!known) throw new NotFoundError(NOT_FOUND);
  return id as (typeof FLOOD_SCENARIO_IDS)[number];
}

function found<T>(value: T | null): T {
  if (value === null) throw new NotFoundError(NOT_FOUND);
  return value;
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  reply.send(await listScenarios(req.server.pg));
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  reply.send(found(await getScenario(req.server.pg, scenarioId(req.params))));
}

export async function impacts(req: FastifyRequest, reply: FastifyReply) {
  const id = scenarioId(req.params);
  const { hour } = validate(HourQuery, req.query);
  reply.send(found(await getImpacts(req.server.pg, id, hour)));
}

export async function plan(req: FastifyRequest, reply: FastifyReply) {
  reply.send(found(await getPlan(req.server.pg, scenarioId(req.params))));
}

export async function roads(req: FastifyRequest, reply: FastifyReply) {
  reply.send(found(await getRoads(req.server.pg, scenarioId(req.params))));
}

export async function frame(req: FastifyRequest, reply: FastifyReply) {
  const parsed = FrameParams.safeParse(req.params);
  if (!parsed.success) throw new NotFoundError(NOT_FOUND);
  const file = framePath(parsed.data.id, parsed.data.hour);
  try {
    await access(file);
  } catch {
    throw new NotFoundError('Không có khung ngập cho giờ này.');
  }
  reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=3600');
  return reply.send(createReadStream(file));
}
