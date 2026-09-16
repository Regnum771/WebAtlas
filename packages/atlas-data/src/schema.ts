import { z } from 'zod';
import type { Dataset } from './types';

const sourceSchema = z.object({
  citation: z.string().min(1),
  licence: z.string().min(1),
  uri: z.string().url().optional(),
  resolution: z.string().optional(),
});

const lineageSchema = z.object({
  statement: z.string().min(1),
  // Non-empty by design: an unlicensed dataset cannot be exported (spec §3).
  licence: z.string().min(1),
  sources: z.array(sourceSchema),
});

const stageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fetch-http'),
    url: z.string().url(),
    into: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }),
  z.object({
    type: z.literal('load-geojson'),
    file: z.string().min(1),
    table: z.string().min(1),
    columns: z.function(),
  }),
  z.object({ type: z.literal('sql'), statement: z.string().min(1) }),
  z.object({
    type: z.literal('publish-geoserver'),
    layer: z.string().min(1),
    style: z.string().optional(),
  }),
  z.object({
    type: z.literal('run'),
    command: z.string().min(1),
    produces: z.string().min(1),
    // Both required: the escape hatch cannot be constructed untracked (spec §2).
    promoteTo: z.string().min(1),
    promoteBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'promoteBy must be YYYY-MM-DD'),
  }),
]);

const datasetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['vector', 'raster', 'derived']),
  lineage: lineageSchema,
  dependsOn: z.array(z.string()).optional(),
  editable: z.boolean().optional(),
  // At least one: a dataset with no stages can never be materialised.
  stages: z.array(stageSchema).min(1),
});

/** Validate a descriptor at module load. Throws ZodError on invalid input. */
export function defineDataset(d: Dataset): Dataset {
  datasetSchema.parse(d);
  return d;
}
