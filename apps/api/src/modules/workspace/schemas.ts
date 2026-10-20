import { z } from 'zod';

const Title = z.string().trim().min(1).max(200);
const Description = z.string().max(2000);
/** The map revision the caller last saw; required on every write to a map's content. */
const ExpectedRevision = z.number().int().min(0);

export const MapIdParams = z.object({ mapId: z.string().uuid() });

export const CreateMapBody = z.object({
  title: Title,
  description: Description.optional(),
});

export const UpdateMapBody = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    expectedRevision: ExpectedRevision,
  })
  .refine((b) => b.title !== undefined || b.description !== undefined, {
    message: 'Nothing to update',
  });

export const DeleteMapBody = z.object({ expectedRevision: ExpectedRevision });
