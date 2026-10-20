import type { Pool, PoolClient } from 'pg';
import type { LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService, type EditSource } from '../audit/service';
import { validate } from '../../lib/validate';
import { NotFoundError, ValidationError } from '../../errors';
import { COUNTRY_UNIT, type UnitTree } from '@webatlas/shared';
import { suggestManagingUnit } from '../admin-units/repository';

/**
 * Feature operations inside a draft, on the caller's client and in the caller's transaction.
 * They validate (attributes, geometry, the known-unit check, "managing unit required without
 * geometry") and write the draft's rows and their audit rows, but never authorise: a personal
 * draft is checked against jurisdiction when it is published (spec U7), not per operation.
 */

export type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown>; source?: EditSource };

/**
 * Where an update or delete copies a feature from when the draft holds no row for it yet:
 * 'draft' (default) is the draft's own chain, 'active' the layer's current official state.
 * See featuresRepository.resolveEditSource.
 */
export interface EditSourceOptions { untouchedFrom?: 'draft' | 'active' }

export interface FeatureWarning { code: 'OUTSIDE_MANAGING_UNIT'; message: string }
export interface FeatureResult { feature: FeatureRow; warnings: FeatureWarning[] }

// Same shape as a zod flatten(), so a client shows it next to the field like any other.
export function fieldError(field: string, message: string): ValidationError {
  return new ValidationError('Validation failed', { formErrors: [], fieldErrors: { [field]: [message] } });
}

export function assertKnownUnit(tree: UnitTree, unit: string): void {
  if (!tree.has(unit)) throw fieldError('managing_unit', 'Mã đơn vị không hợp lệ');
}

// A row without a unit predates the column's backfill or activation; treat it as national, the
// strictest reading, so a missing value never widens what a regional officer may touch.
export function unitOf(row: FeatureRow): string {
  const unit = row.properties.managing_unit;
  return typeof unit === 'string' ? unit : COUNTRY_UNIT;
}

export async function prepare(db: Pool | PoolClient, def: LayerDef, input: FeatureInput, geometryRequired: boolean) {
  const attrs = validate(def.attributeSchema, input.properties ?? {}) as Record<string, unknown>;
  // Only persist keys the layer actually owns.
  const owned: Record<string, unknown> = {};
  for (const c of def.attributeColumns) if (c in attrs) owned[c] = attrs[c];
  const geometryJson = geometryRequired || input.geometry !== undefined
    ? assertGeometry(def, input.geometry)
    : undefined;
  // assertValidInPg is `SELECT ST_IsValid(...$1)` — a pure function of its parameter that reads
  // no table, so it may run on the pool or on the operation's client. On a client, an
  // unparseable geometry fails the statement and so aborts the transaction; the caller rolls it
  // back on the GeometryError either way.
  if (typeof geometryJson === 'string') await assertValidInPg(db, def, geometryJson);
  return { attrs: owned, geometryJson };
}

// A warning, never a refusal: the saved geometry lies wholly outside its managing unit. The
// unit is left as it is (it is never recomputed from geometry once set); VN, which covers
// everything, never warns. Read on the client: the row is usually one it just wrote.
export async function placementWarnings(
  client: PoolClient, def: LayerDef, row: FeatureRow, tree: UnitTree
): Promise<FeatureWarning[]> {
  const unit = unitOf(row);
  if (unit === COUNTRY_UNIT || row.geometry === null) return [];
  if (!(await featuresRepository(client).isOutsideUnit(client, def, row.id, unit))) return [];
  const name = tree.get(unit)?.name ?? unit;
  return [{
    code: 'OUTSIDE_MANAGING_UNIT',
    message: `Đối tượng không còn nằm trong ${name}. Kiểm tra lại đơn vị chủ quản.`,
  }];
}

/** Add a new feature to the draft. */
export async function createInDraft(
  client: PoolClient, def: LayerDef, draftId: string, input: FeatureInput, actorId: string, tree: UnitTree
): Promise<FeatureResult> {
  const { attrs, geometryJson } = await prepare(client, def, input, true);
  // Every feature has a managing unit: given, or suggested from the geometry. Neither is
  // possible without a geometry, so the caller has to choose one.
  if (attrs.managing_unit === undefined) {
    if (typeof geometryJson !== 'string') throw fieldError('managing_unit', 'Chọn đơn vị chủ quản');
    attrs.managing_unit = await suggestManagingUnit(client, geometryJson);
  }
  assertKnownUnit(tree, attrs.managing_unit as string);
  const feature = await featuresRepository(client).insertIntoVersion(client, def, draftId, {
    attrs, geometryJson: geometryJson ?? null, actorId,
  });
  await auditService(client).record(
    { userId: actorId, action: 'create', tableName: def.table, featureId: feature.id, after: feature, source: input.source },
    client
  );
  return { feature, warnings: await placementWarnings(client, def, feature, tree) };
}

/**
 * Change a feature in the draft. `id` names any row of the feature; the change lands on the
 * draft's own row for it, copied from the draft's resolved state when the draft has none yet.
 */
export async function updateInDraft(
  client: PoolClient, def: LayerDef, draftId: string, id: string, input: FeatureInput, actorId: string, tree: UnitTree,
  opts: EditSourceOptions = {}
): Promise<FeatureResult> {
  const repo = featuresRepository(client);
  const source = await repo.resolveEditSource(client, def, draftId, id, opts);
  const before = await repo.findByIdOnClient(client, def, source.rowId);
  if (!before) throw new NotFoundError('Feature not found');
  const { attrs, geometryJson } = await prepare(client, def, input, false);
  const next = attrs.managing_unit as string | undefined;
  if (next !== undefined && next !== unitOf(before)) assertKnownUnit(tree, next);
  const feature = await repo.upsertChangeInVersion(client, def, draftId, source, { attrs, geometryJson, actorId });
  // feature_id is the id the request named; before.id / after.id are the rows actually read and
  // written; the stable feature key is external_id.
  await auditService(client).record(
    { userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after: feature, source: input.source },
    client
  );
  return { feature, warnings: await placementWarnings(client, def, feature, tree) };
}

/** Delete a feature in the draft (a tombstone row). */
export async function removeInDraft(
  client: PoolClient, def: LayerDef, draftId: string, id: string, actorId: string, opts: EditSourceOptions = {}
): Promise<void> {
  const repo = featuresRepository(client);
  const source = await repo.resolveEditSource(client, def, draftId, id, opts);
  const before = await repo.findByIdOnClient(client, def, source.rowId);
  if (!before) throw new NotFoundError('Feature not found');
  await repo.tombstoneInVersion(client, def, draftId, source);
  // feature_id is the id the request named; before.id / after.id are the rows actually read and
  // written; the stable feature key is external_id.
  await auditService(client).record(
    { userId: actorId, action: 'delete', tableName: def.table, featureId: id, before }, client
  );
}
