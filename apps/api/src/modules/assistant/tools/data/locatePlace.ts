// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ToolFactory } from '../types';

/**
 * How many candidates to hand back. The model needs enough to disambiguate a
 * repeated name without paying for a gazetteer dump; the first row is the one
 * it should use in practice, the rest are there so it can notice ambiguity.
 */
const MAX_MATCHES = 5;

/**
 * Below this length a containment match is noise: 'Ea' appears inside dozens of
 * Central Highlands names, so a two-letter gazetteer row would "match" almost
 * any query string it was tested against.
 */
const MIN_CONTAINMENT_LENGTH = 4;

export const locatePlaceTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'locate_place',
    description:
      'Resolve a Vietnamese place name (city, town, ward, village) to its coordinates. Call this FIRST whenever a question names a place and you need its position — never supply coordinates from your own memory.',
    inputSchema: z.object({
      name: z.string().min(2).describe('Place name as the user wrote it, e.g. "Buôn Ma Thuột"'),
    }),
    run: async (input) => {
      const name = input.name.trim();
      // Two passes, in one statement so the ordering is decided by Postgres and
      // not by which query happened to run: an exact case-insensitive hit always
      // outranks a containment hit, and population breaks ties within each tier.
      // Containment runs both ways — the query may carry an administrative
      // prefix the gazetteer omits ('thành phố Buôn Ma Thuột'), or be a bare
      // fragment of a longer stored name.
      const { rows } = await ctx.pool.query<{
        name: string;
        fclass: string;
        population: number | null;
        lon: number;
        lat: number;
      }>(
        `SELECT name, fclass,
                NULLIF(population, 0)::int AS population,
                ST_X(geometry) AS lon, ST_Y(geometry) AS lat
           FROM basemap.places_region
          WHERE name IS NOT NULL
            AND (lower(name) = lower($1)
                 OR (length(name) >= $2
                     AND ($1 ILIKE '%' || name || '%' OR name ILIKE '%' || $1 || '%')))
          ORDER BY (lower(name) = lower($1)) DESC,
                   population DESC NULLS LAST
          LIMIT $3`,
        [name, MIN_CONTAINMENT_LENGTH, MAX_MATCHES]
      );

      // The gazetteer is basemap reference data, not a versioned thematic layer,
      // so there is no layer key or dataset version to report — but the call
      // still has to appear in provenance, because a coordinate the model used
      // is exactly the kind of thing a reader needs to see the source of.
      ctx.provenance({
        tool: 'locate_place',
        layerKey: null,
        rowCount: rows.length,
        datasetVersion: null,
      });

      if (rows.length === 0) {
        // Deliberately offers nothing to fall back on. The failure mode this
        // tool exists to stop is the model answering anyway from memory, so the
        // message tells it what to do instead of leaving the gap open.
        return `Không tìm thấy địa danh "${name}" trong dữ liệu. Hãy nói với người dùng là chưa xác định được vị trí này; TUYỆT ĐỐI không tự suy ra toạ độ.`;
      }
      return JSON.stringify({ query: name, rows });
    },
  });
