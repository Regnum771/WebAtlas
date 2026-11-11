import type { Pool } from 'pg';
import { NotFoundError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { ITEM_NOT_FOUND, visibleItems } from '../catalogue/repository';
import { bumpMap, lockMapForWrite } from './access';
import { LAYER_NOT_FOUND, NEXT_POSITION, checkStyle, deleteLayerRow, loadSummary, patchLayerRow } from './freeLayers';
import type { LayerSummary } from './maps';

/*
 * Catalogue links (layer kind 'catalogue'): a personal-map layer that shows a catalogue entry
 * through the catalogue's own map proxy and holds no data of its own. It has a layer row (title,
 * style, place in the order) and no features, table or export. The summary's `catalogue` is the
 * entry as the reader sees it (freeLayers.ts withCatalogue).
 */

const TITLE_MAX = 200;

/** The link layer of this map, locked; 404 when the id is not a link of this map. */
async function assertLink(client: Pick<Pool, 'query'>, mapId: string, layerId: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM workspace.map_layers WHERE id = $1 AND map_id = $2 AND kind = 'catalogue' FOR UPDATE`,
    [layerId, mapId]
  );
  if (!rows[0]) throw new NotFoundError(LAYER_NOT_FOUND);
}

export function catalogueLinksService(pg: Pool) {
  return {
    /**
     * Link a catalogue entry into the map. Owner only, at the current revision (lockMapForWrite:
     * 404, 403, 409 in that order); then the entry must be one the owner may see, else the
     * catalogue's 404. The title defaults to the entry's.
     */
    async addLayer(
      user: CurrentUser, mapId: string,
      input: { resourceId: string; title?: string; style?: Record<string, unknown>; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      const style = input.style ?? {};
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        checkStyle(style);
        const item = (await visibleItems(client, user, [input.resourceId])).get(input.resourceId);
        if (!item) throw new NotFoundError(ITEM_NOT_FOUND);
        const title = (input.title ?? item.title).trim().slice(0, TITLE_MAX) || 'Dữ liệu Danh mục';
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO workspace.map_layers (map_id, kind, title, position, style, catalogue_resource_id)
           VALUES ($1, 'catalogue', $2, ${NEXT_POSITION}, $3::jsonb, $4)
           RETURNING id`,
          [mapId, title, JSON.stringify(style), item.id]
        );
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, rows[0].id, user), revision };
      });
    },

    /** Rename, restyle or move a link, through the layer-row helpers every kind shares. */
    async updateLayer(
      user: CurrentUser, mapId: string, layerId: string,
      input: { title?: string; style?: Record<string, unknown>; position?: number; expectedRevision: number }
    ): Promise<{ layer: LayerSummary; revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await assertLink(client, mapId, layerId);
        await patchLayerRow(client, mapId, layerId, input);
        const revision = await bumpMap(client, mapId);
        return { layer: await loadSummary(client, layerId, user), revision };
      });
    },

    /** Take the link off the map; the catalogue entry itself is untouched. */
    async removeLayer(
      user: CurrentUser, mapId: string, layerId: string, input: { expectedRevision: number }
    ): Promise<{ revision: number }> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await assertLink(client, mapId, layerId);
        await deleteLayerRow(client, mapId, layerId);
        return { revision: await bumpMap(client, mapId) };
      });
    },
  };
}
