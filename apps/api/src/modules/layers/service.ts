import type { Pool } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService } from '../audit/service';
import { validate } from '../../lib/validate';
import { NotFoundError } from '../../errors';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown> };

async function prepare(pg: Pool, def: LayerDef, input: FeatureInput, geometryRequired: boolean) {
  const attrs = validate(def.attributeSchema, input.properties ?? {}) as Record<string, unknown>;
  // Only persist keys the layer actually owns.
  const owned: Record<string, unknown> = {};
  for (const c of def.attributeColumns) if (c in attrs) owned[c] = attrs[c];
  const geometryJson = geometryRequired || input.geometry !== undefined
    ? assertGeometry(def, input.geometry)
    : undefined;
  if (typeof geometryJson === 'string') await assertValidInPg(pg, def, geometryJson);
  return { attrs: owned, geometryJson };
}

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const audit = auditService(pg);
  return {
    async list(key: string): Promise<FeatureRow[]> { return repo.list(getLayer(key)); },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },

    async create(key: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const def = getLayer(key);
      const { attrs, geometryJson } = await prepare(pg, def, input, true);
      const row = await repo.insert(def, { attrs, geometryJson: geometryJson ?? null, actorId });
      await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row });
      return row;
    },

    async update(key: string, id: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      const def = getLayer(key);
      const before = await repo.findById(def, id);
      if (!before) throw new NotFoundError('Feature not found');
      const { attrs, geometryJson } = await prepare(pg, def, input, false);
      const after = await repo.update(def, id, { attrs, geometryJson, actorId });
      await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after });
      return after!;
    },

    async remove(key: string, id: string, actorId?: string): Promise<void> {
      const def = getLayer(key);
      const before = await repo.findById(def, id);
      if (!before) throw new NotFoundError('Feature not found');
      await repo.remove(def, id);
      await audit.record({ userId: actorId, action: 'delete', tableName: def.table, featureId: id, before });
    },
  };
}
