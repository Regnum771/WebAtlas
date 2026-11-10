import { z } from 'zod';

export const CATALOGUE_KINDS = ['vector', 'raster', 'timeseries', 'map', 'document'] as const;

export const SearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(CATALOGUE_KINDS).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export const IdParams = z.object({ id: z.string().uuid() });

export const TimeseriesBody = z.object({
  fileId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  abstract: z.string().max(5000).optional(),
  // Mirrors times.PATTERNS in packages/atlas-data/tools/timeseries/times.py.
  timePattern: z.enum(['YYYYMMDD', 'YYYYMMDDHHmm', 'YYYYDDD']).optional(),
  timesCsvFileId: z.string().uuid().optional(),
  hdfArea: z.string().trim().min(1).max(200).optional(),
  every: z.union([z.literal(1), z.literal(4)]).default(4),
});
