import { z } from 'zod';
import { CRS_OPTIONS, EDITABLE_LAYER_KEYS } from '@webatlas/shared';

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
const FieldName = z.string().trim().min(1).max(63);
const FieldDef = z.object({ name: FieldName, type: FieldType });
/** A field in a layer PATCH: `from` names the declared field it renames. */
const FieldEdit = FieldDef.extend({ from: FieldName.optional() });

/** The Fields rules: at most 50, no duplicate names (ignoring case), `id` reserved. */
function fieldList<T extends z.ZodTypeAny>(def: T) {
  return z
    .array(def)
    .max(50)
    .superRefine((fields: Array<{ name: string }>, ctx) => {
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
}
const Fields = fieldList(FieldDef);
/** The fields of a free layer as they are to be: renamed (`from`), kept, added; any left out are removed. */
const FieldEdits = fieldList(FieldEdit).superRefine((fields: Array<{ from?: string }>, ctx) => {
  const sources = fields.flatMap((f) => (f.from === undefined ? [] : [f.from]));
  if (new Set(sources).size !== sources.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A field is renamed twice' });
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

/** `fields` is for a free layer only; the dispatcher refuses it on any other kind. */
export const UpdateLayerBody = z
  .object({
    title: Title.optional(),
    style: JsonObject.optional(),
    position: z.number().int().min(0).optional(),
    fields: FieldEdits.optional(),
    expectedRevision: ExpectedRevision,
  })
  .refine(
    (b) => b.title !== undefined || b.style !== undefined || b.position !== undefined || b.fields !== undefined,
    { message: 'Nothing to update' }
  );

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

// --- The layer table ----------------------------------------------------------------------

/** A table condition's operator; which ones a column takes depends on its type (layerQuery.ts). */
export const LayerQueryOp = z.enum(['contains', 'eq', 'neq', 'empty', 'notEmpty', 'lt', 'lte', 'gt', 'gte']);
/** A column name as the layer's rows carry it: not trimmed, since an imported key may hold spaces. */
const ColumnName = z.string().min(1).max(255);

/**
 * Body of POST .../layers/:layerId/query: the table's search box, conditions, "in view" box,
 * sort and page. Field names are checked against the layer's columns by compileQuery.
 */
export const LayerQueryBody = z.object({
  q: z.string().max(200).optional(),
  conditions: z
    .array(
      z.object({
        field: ColumnName,
        op: LayerQueryOp,
        value: z.union([z.string().max(200), z.number().finite()]).optional(),
        /** eq/neq on a number column only: match within this distance of the value (layerQuery.ts). */
        tolerance: z.number().finite().min(0).optional(),
      })
    )
    .max(10)
    .default([]),
  match: z.enum(['all', 'any']).default('all'),
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  sort: z.object({ field: ColumnName, dir: z.enum(['asc', 'desc']) }).optional(),
  offset: z.number().int().min(0).max(2_147_483_647).default(0),
  limit: z.number().int().min(1).max(500).default(100),
  /** A feature id whose position in the filtered, sorted list the answer also carries. */
  locate: z.string().min(1).max(64).optional(),
});

// --- Sharing ------------------------------------------------------------------------------

export const ShareParams = MapIdParams.extend({ shareId: z.string().uuid() });

/** Exactly one target: a user or an access group. */
export const AddShareBody = z.union([
  z.object({ userId: z.string().uuid() }).strict(),
  z.object({ groupId: z.string().uuid() }).strict(),
]);

export const ShareTargetsQuery = z.object({ q: z.string().trim().min(2).max(100) });

// --- Uploads ------------------------------------------------------------------------------

export const FileIdParams = z.object({ fileId: z.string().uuid() });

// --- Jobs ---------------------------------------------------------------------------------

/** A CrsOption id from @webatlas/shared. Checked here: findCrs would fall back instead of failing. */
const CrsId = z.string().refine((id) => CRS_OPTIONS.some((o) => o.id === id), { message: 'Unknown coordinate system' });
const ExportFormat = z.enum(['gpkg', 'geojson', 'shp']);
const LayerIds = z.array(z.string().uuid()).min(1).max(200);

export const ImportBody = z.object({
  fileId: z.string().uuid(),
  sourceCrs: CrsId.nullish(),
});

export const ExportBody = z.object({
  format: ExportFormat,
  crs: CrsId,
  layerIds: LayerIds.optional(),
});

/** The preview takes the export's choices as a query; layerIds is comma-separated (or repeated). */
export const ExportPreviewQuery = z.object({
  format: ExportFormat,
  crs: CrsId,
  layerIds: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : [v].flat().flatMap((s) => String(s).split(',')).map((s) => s.trim())),
    LayerIds.optional()
  ),
});

export const JobIdParams = z.object({ jobId: z.string().uuid() });
export const JobsQuery = z.object({ mapId: z.string().uuid().optional() });
