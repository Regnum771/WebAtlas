import { z } from 'zod';

export const CATALOGUE_KINDS = ['vector', 'raster', 'timeseries', 'map', 'document'] as const;

export const SearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(CATALOGUE_KINDS).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export const IdParams = z.object({ id: z.string().uuid() });

/** GET /api/catalogue/recent: how many entries, 6 by default, at most 20. */
export const RecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

/** The clocks a HEC-RAS `Time Date Stamp` may be read in (it carries no zone of its own). */
export const HDF_TIME_ZONES = ['Asia/Ho_Chi_Minh', 'UTC'] as const;

/** [minLon, minLat, maxLon, maxLat] in EPSG:4326: finite, on the globe, min below max. */
export const Clip4326 = z
  .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine(([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n, {
    message: 'Khung cắt phải nằm trong [-180, -90, 180, 90] với giá trị nhỏ trước giá trị lớn.',
  });

export const TimeseriesBody = z.object({
  fileId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  abstract: z.string().max(5000).optional(),
  // Mirrors times.PATTERNS in packages/atlas-data/tools/timeseries/times.py.
  timePattern: z.enum(['YYYYMMDD', 'YYYYMMDDHHmm', 'YYYYDDD']).optional(),
  timesCsvFileId: z.string().uuid().optional(),
  hdfArea: z.string().trim().min(1).max(200).optional(),
  every: z.union([z.literal(1), z.literal(4)]).default(4),
  // NetCDF only: the extent each grid is cut to (the worker reads the whole globe otherwise).
  clip4326: Clip4326.optional(),
  // HEC-RAS only: the clock of the model's time stamps; the worker converts them to UTC.
  hdfTimeZone: z.enum(HDF_TIME_ZONES).default('Asia/Ho_Chi_Minh'),
});
