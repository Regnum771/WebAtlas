import type { Pool, PoolClient } from 'pg';
import {
  NotFoundError as VersioningNotFoundError, bumpRevision, discardDraft, lockDraft, openDraft, touchedFeatures,
} from '@webatlas/versioning';
import { AppError, NotFoundError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import { getUnitTree } from '../../authz/unitTree';
import { getLayer, type LayerDef } from '../../layers/registry';
import type { CurrentUser } from '../../types/fastify';
import { createInDraft, removeInDraft, updateInDraft, type FeatureWarning } from '../layers/draftOps';
import { featuresRepository, type BBox, type EditCopyFeatureRow } from '../layers/repository';
import { assertCanRead, bumpMap, lockMapForWrite, type Queryable } from './access';
import {
  DEFAULT_LIMIT, LAYER_NOT_FOUND, MAX_LIMIT, NEXT_POSITION, checkStyle, deleteLayerRow, loadSummary, patchLayerRow,
  type GeoJsonGeometry,
} from './freeLayers';
import type { LayerSummary } from './maps';

/*
 * Edit-copy layers: a personal map's "Sửa lớp X" layer is a pointer to a P2 durable draft of the
 * official layer X (spec P3a). Its features are the draft's resolved state; every write goes into
 * the draft through draftOps, under the map's revision guard.
 *
 * Lock order, the same in every write here and in maps.remove: the map row first
 * (lockMapForWrite), then the draft's version row. No jurisdiction check: a personal draft is
 * checked when it is published (U7).
 */

export const DRAFT_GONE = 'Bản nháp của lớp này không còn.';

const byExternalId = new Intl.Collator('en', { numeric: true }).compare;

interface EditCopyRow { id: string; layerKey: string; draftId: string | null }

function draftGone(): AppError {
  return new AppError(410, 'DRAFT_GONE', DRAFT_GONE);
}

/** An edit-copy layer of this map; 404 when the id is not in this map or is another kind. */
async function loadEditCopy(q: Queryable, mapId: string, layerId: string): Promise<EditCopyRow> {
  const { rows } = await q.query<EditCopyRow>(
    `SELECT id, layer_key AS "layerKey", draft_id AS "draftId"
       FROM workspace.map_layers WHERE id = $1 AND map_id = $2 AND kind = 'edit_copy'`,
    [layerId, mapId]
  );
  if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
  return rows[0];
}

/** The layer's draft id; 410 once the draft has been discarded (draft_id goes NULL). */
function draftOf(layer: EditCopyRow): string {
  if (layer.draftId === null) throw draftGone();
  return layer.draftId;
}

type FeatureOut = { type: 'Feature'; id: string; geometry: unknown; properties: Record<string, unknown> };
function toFeature(r: EditCopyFeatureRow): FeatureOut {
  return { type: 'Feature', id: r.id, geometry: r.geometry, properties: r.properties };
}

/** Re-read a row the operation just wrote, in the read shape. */
async function readRow(client: PoolClient, def: LayerDef, rowId: string): Promise<FeatureOut> {
  const row = await featuresRepository(client).editCopyFeatureById(client, def, rowId);
  return toFeature(row!);
}

/*
 * Reads: the layer's current official rows plus the draft's changes on top, through
 * featuresRepository.editCopyFeaturesInBBox (which documents the algorithm). That SQL names the
 * layer's base table, so it lives in layers/repository.ts, where the activeReads guard allows it.
 */

/**
 * An update or delete of a feature the draft holds no row for yet copies the feature's CURRENT
 * official row (the one the read showed), not the row in the draft's chain: after the layer has
 * moved on, the chain's row is stale, and a feature added upstream is not in the chain at all.
 * A feature the draft already holds a row for is edited in the draft, as in P2.
 *
 * Accepted consequence: at publish (rebase), a feature that changed or was added upstream and
 * was then edited here differs between the draft's parent and the active version, so it counts
 * as a conflict; the owner resolves it with "mine", which keeps this edit.
 */
const FROM_SHOWN_STATE = { untouchedFrom: 'active' } as const;

export function editCopiesService(pg: Pool) {
  /**
   * One feature write: lock the map (404/403/409 MAP_CHANGED), then the owner's personal draft,
   * run the draftOps call, and record it as a new revision of both the draft and the map.
   */
  async function editDraft<T>(
    user: CurrentUser, mapId: string, layerId: string, expectedRevision: number,
    op: (client: PoolClient, def: LayerDef, draftId: string) => Promise<T>
  ): Promise<{ out: T; revision: number }> {
    return inTransaction(pg, async (client) => {
      await lockMapForWrite(client, mapId, user, expectedRevision);
      const layer = await loadEditCopy(client, mapId, layerId);
      const draftId = draftOf(layer);
      const def = getLayer(layer.layerKey);
      try {
        await lockDraft(client, draftId, { ownerId: user.id, requireStatus: 'personal' });
      } catch (e) {
        // The map's owner owns the draft, so "not found" here means the version is no longer
        // a draft at all (published): there is nothing left to edit.
        if (e instanceof VersioningNotFoundError) throw draftGone();
        throw e;
      }
      const out = await op(client, def, draftId);
      await bumpRevision(client, draftId);
      return { out, revision: await bumpMap(client, mapId) };
    });
  }

  return {
    async addLayer(
      user: CurrentUser, mapId: string,
      input: { layerKey: string; title?: string; style?: Record<string, unknown>; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      const def = getLayer(input.layerKey);
      const style = input.style ?? {};
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        checkStyle(style);
        const draft = await openDraft(client, def.key, user.id);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO workspace.map_layers (map_id, kind, title, position, style, layer_key, draft_id)
           VALUES ($1, 'edit_copy', $2, ${NEXT_POSITION}, $3::jsonb, $4, $5)
           RETURNING id`,
          [mapId, input.title ?? `Sửa lớp ${def.title}`, JSON.stringify(style), def.key, draft.id]
        );
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, rows[0].id), revision };
      });
    },

    async updateLayer(
      user: CurrentUser, mapId: string, layerId: string,
      input: { title?: string; style?: Record<string, unknown>; position?: number; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await loadEditCopy(client, mapId, layerId);
        await patchLayerRow(client, mapId, layerId, input);
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, layerId), revision };
      });
    },

    /**
     * Delete the layer and discard its draft in one transaction. A version that is no longer a
     * draft (published) is shared data now and is left alone, as in maps.remove; the lock makes
     * a publish between this read and discardDraft skip the version instead of failing.
     */
    async removeLayer(
      user: CurrentUser, mapId: string, layerId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        const layer = await loadEditCopy(client, mapId, layerId);
        if (layer.draftId !== null) {
          const { rows } = await client.query(
            `SELECT id FROM app.dataset_versions WHERE id = $1 AND draft_status IS NOT NULL FOR UPDATE`,
            [layer.draftId]
          );
          if (rows[0]) await discardDraft(client, layer.draftId);
        }
        await deleteLayerRow(client, mapId, layerId);
        return { revision: await bumpMap(client, mapId) };
      });
    },

    /**
     * The edit copy's features inside `bbox`, capped at `limit`. Readable by the owner and by
     * share recipients alike: access is the map's, not the draft's.
     */
    async features(
      user: CurrentUser, mapId: string, layerId: string, opts: { bbox: BBox; limit?: number }
    ) {
      await assertCanRead(pg, mapId, user);
      const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      return inTransaction(pg, async (client) => {
        // One snapshot for the layer row, the rows and the changed list.
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const layer = await loadEditCopy(client, mapId, layerId);
        const draftId = draftOf(layer);
        const def = getLayer(layer.layerKey);
        const rows = await featuresRepository(client).editCopyFeaturesInBBox(client, def, draftId, opts.bbox, limit);
        const changed = [...(await touchedFeatures(client, def.key, draftId))].sort(byExternalId);
        return {
          type: 'FeatureCollection' as const,
          features: rows.slice(0, limit).map(toFeature),
          truncated: rows.length > limit,
          changed,
        };
      });
    },

    async addFeature(
      user: CurrentUser, mapId: string, layerId: string,
      input: { geometry: GeoJsonGeometry; properties: Record<string, unknown>; expectedRevision: number }
    ): Promise<{ feature: FeatureOut; warnings: FeatureWarning[]; revision: number }> {
      const tree = await getUnitTree(pg);
      const { out, revision } = await editDraft(user, mapId, layerId, input.expectedRevision, async (client, def, draftId) => {
        const r = await createInDraft(client, def, draftId, { geometry: input.geometry, properties: input.properties }, user.id, tree);
        return { feature: await readRow(client, def, r.feature.id), warnings: r.warnings };
      });
      return { ...out, revision };
    },

    async updateFeature(
      user: CurrentUser, mapId: string, layerId: string, featureId: string,
      input: { geometry?: GeoJsonGeometry; properties?: Record<string, unknown>; expectedRevision: number }
    ): Promise<{ feature: FeatureOut; warnings: FeatureWarning[]; revision: number }> {
      const tree = await getUnitTree(pg);
      const { out, revision } = await editDraft(user, mapId, layerId, input.expectedRevision, async (client, def, draftId) => {
        const r = await updateInDraft(
          client, def, draftId, featureId, { geometry: input.geometry, properties: input.properties }, user.id, tree,
          FROM_SHOWN_STATE
        );
        return { feature: await readRow(client, def, r.feature.id), warnings: r.warnings };
      });
      return { ...out, revision };
    },

    async removeFeature(
      user: CurrentUser, mapId: string, layerId: string, featureId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      const { revision } = await editDraft(user, mapId, layerId, input.expectedRevision,
        (client, def, draftId) => removeInDraft(client, def, draftId, featureId, user.id, FROM_SHOWN_STATE));
      return { revision };
    },
  };
}

export type EditCopiesService = ReturnType<typeof editCopiesService>;
