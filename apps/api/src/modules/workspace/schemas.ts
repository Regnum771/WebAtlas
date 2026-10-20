import { z } from 'zod';
import { EDITABLE_LAYER_KEYS } from '@webatlas/shared';

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

// --- Layers and features ------------------------------------------------------------------

export const LayerParams = z.object({ mapId: z.string().uuid(), layerId: z.string().uuid() });
/** A free layer's feature: a workspace.features id (bigint). */
export const FeatureParams = LayerParams.extend({ featureId: z.string().regex(/^\d{1,18}$/) });
/** An edit copy's feature: the water.<layer> row id (uuid) that its read returns. */
export const EditCopyFeatureParams = LayerParams.extend({ featureId: z.string().uuid() });

const FieldType = z.enum(['text', 'number', 'date']);
const FieldDef = z.object({ name: z.string().trim().min(1).max(63), type: FieldType });
const Fields = z
  .array(FieldDef)
  .max(50)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const f of fields) {
      const key = f.name.toLowerCase();
      if (key === 'id' || seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate or reserved field name "${f.name}"` });
        return;
      }
      seen.add(key);
    }
  });
const JsonObject = z.record(z.unknown());

/** Body of POST /maps/:mapId/layers once the dispatcher has seen kind = 'free'. */
export const AddFreeLayerBody = z.object({
  kind: z.literal('free'),
  title: Title,
  geometryType: z.enum(['point', 'line', 'polygon']),
  fields: Fields,
  style: JsonObject.optional(),
  expectedRevision: ExpectedRevision,
});

/** Body of POST /maps/:mapId/layers once the dispatcher has seen kind = 'edit_copy'. */
export const AddEditCopyLayerBody = z.object({
  kind: z.literal('edit_copy'),
  layerKey: z.enum(EDITABLE_LAYER_KEYS),
  title: Title.optional(),
  style: JsonObject.optional(),
  expectedRevision: ExpectedRevision,
});

export const UpdateLayerBody = z
  .object({
    title: Title.optional(),
    style: JsonObject.optional(),
    position: z.number().int().min(0).optional(),
    expectedRevision: ExpectedRevision,
  })
  .refine((b) => b.title !== undefined || b.style !== undefined || b.position !== undefined, {
    message: 'Nothing to update',
  });

export const RemoveBody = z.object({ expectedRevision: ExpectedRevision });

const GeometryInput = z.object({ type: z.string().min(1), coordinates: z.array(z.unknown()) }).passthrough();

export const AddFeatureBody = z.object({
  geometry: GeometryInput,
  properties: JsonObject.default({}),
  expectedRevision: ExpectedRevision,
});

export const UpdateFeatureBody = z
  .object({
    geometry: GeometryInput.optional(),
    properties: JsonObject.optional(),
    expectedRevision: ExpectedRevision,
  })
  .refine((b) => b.geometry !== undefined || b.properties !== undefined, { message: 'Nothing to update' });

const BBox = z
  .string()
  .transform((s) => s.split(',').map((p) => (p.trim() === '' ? NaN : Number(p))))
  .refine((a) => a.length === 4 && a.every(Number.isFinite), { message: 'bbox must be minX,minY,maxX,maxY' })
  .transform((a) => a as [number, number, number, number]);
const Limit = z.coerce.number().int().min(1);

export const FeaturesQuery = z.object({
  bbox: BBox.optional(),
  limit: Limit.optional(),
});

/** An edit copy is read by bounding box only: an official layer can be far too big to send whole. */
export const EditCopyFeaturesQuery = z.object({
  bbox: BBox,
  limit: Limit.optional(),
});
