import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { inVietnam, VIETNAM_BOUNDS } from '../../lib/geo';
import { elevationService } from './service';
import { DEM_SOURCE } from './repository';

const ElevationQuery = z
  .object({
    lon: z.coerce.number(),
    lat: z.coerce.number(),
  })
  .refine(({ lon, lat }) => inVietnam(lon, lat), {
    message: `Toạ độ ngoài phạm vi Việt Nam (${VIETNAM_BOUNDS.west}-${VIETNAM_BOUNDS.east}°E, ${VIETNAM_BOUNDS.south}-${VIETNAM_BOUNDS.north}°N).`,
  });

/**
 * GET /api/elevation?lon=&lat=
 *
 * Always 200 with a `status` the caller can branch on, rather than 404 for "no value
 * here" or 503 for "DEM not loaded". Both are ordinary, expected outcomes for a readout
 * that fires as the cursor moves, and turning them into errors would put red entries in
 * the browser console on every pan past the coastline.
 */
export async function elevation(req: FastifyRequest, reply: FastifyReply) {
  const { lon, lat } = validate(ElevationQuery, req.query);
  const result = await elevationService(req.server.pg).at(lon, lat);
  reply.send(
    result.status === 'ok'
      ? { status: 'ok', elevationM: result.elevationM, source: DEM_SOURCE }
      : { status: result.status, elevationM: null, source: null }
  );
}
