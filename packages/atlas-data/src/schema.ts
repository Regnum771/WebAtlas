import { posix, win32 } from 'node:path';
import { z } from 'zod';
import type { Dataset } from './types';

/**
 * A path that stays inside data/cache: relative on both platforms' rules, and with no `..`
 * segment under either separator. Checked here so a descriptor cannot even be defined
 * with a path that escapes the cache, whichever OS it was written on.
 */
const cacheRelativePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !posix.isAbsolute(p) &&
      !win32.isAbsolute(p) &&
      // Drive-relative forms (`D:evil.zip`, `C:`) are not absolute to win32 but still leave the cache.
      !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..'),
    'must be a relative path inside data/cache, with no ".." segment'
  );

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
  // Every variant is strict: zod would otherwise strip a typo'd key (`nativename`, `sha265`) and
  // the stage would silently publish the default relation or lose its pin.
  z
    .object({
      type: z.literal('fetch-http'),
      url: z.string().url(),
      into: cacheRelativePath,
      sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('load-geojson'),
      file: z.string().min(1),
      table: z.string().min(1),
      columns: z.function(),
    })
    .strict(),
  z.object({ type: z.literal('sql'), statement: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('publish-geoserver'),
      layer: z.string().min(1),
      nativeName: z.string().min(1).optional(),
      style: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('run'),
      in: z.enum(['host', 'tools']),
      argv: z.array(z.string().min(1)).min(1),
      produces: z.string().min(1),
      // Both required: the escape hatch cannot be constructed untracked (spec §2).
      promoteTo: z.string().min(1),
      promoteBy: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'promoteBy must be YYYY-MM-DD')
        // The regex alone accepts impossible dates like 2026-02-30 (JS Date parsing
        // silently rolls those over to March). Re-render through Date and compare the
        // ISO calendar date back to the input: a real date round-trips, an impossible
        // one does not. Number.isNaN guards non-date strings so this never throws
        // (Date#toISOString throws RangeError on an Invalid Date).
        .refine((v) => {
          const d = new Date(`${v}T00:00:00Z`);
          return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        }, 'promoteBy must be a real calendar date (e.g. 2026-02-30 is invalid)'),
    })
    // A leftover `command` string would be silently stripped by zod and the stage would
    // run nothing a reader expects; reject it so the argv migration cannot half-happen.
    .strict(),
]);

export const datasetSchema = z.object({
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
