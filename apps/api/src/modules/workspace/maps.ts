import type { Pool, PoolClient } from 'pg';
import { discardDraft } from '@webatlas/versioning';
import { NotFoundError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import {
  MAP_NOT_FOUND, assertCanRead, bumpMap, lockMapForWrite, sharedWithUserSql,
  type MapRole, type Queryable,
} from './access';

export type LayerKind = 'free' | 'edit_copy' | 'raster' | 'annotation';

export interface LayerSummary {
  id: string;
  kind: LayerKind;
  title: string;
  position: number;
  style: Record<string, unknown>;
  geometryType: 'point' | 'line' | 'polygon' | null;
  fields: unknown[];
  layerKey: string | null;
  draftId: string | null;
  /** Rows in workspace.features for a free layer; null for every other kind. */
  featureCount: number | null;
}

export interface MapSummary {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  updatedAt: Date;
  layerCount: number;
  role: MapRole;
}

export type MapDetail = MapSummary & { layers: LayerSummary[] };

// Every summary query selects these from `workspace.maps m JOIN app.users u`.
const SUMMARY_COLUMNS = `
  m.id, m.title, m.description, m.owner_id AS "ownerId",
  COALESCE(NULLIF(u.full_name, ''), u.email) AS "ownerName",
  m.revision, m.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM workspace.map_layers l WHERE l.map_id = m.id) AS "layerCount"`;

async function loadLayers(q: Queryable, mapId: string): Promise<LayerSummary[]> {
  const { rows } = await q.query<LayerSummary>(
    `SELECT l.id, l.kind, l.title, l.position, l.style, l.geometry_type AS "geometryType", l.fields,
            l.layer_key AS "layerKey", l.draft_id AS "draftId",
            CASE WHEN l.kind = 'free'
                 THEN (SELECT count(*)::int FROM workspace.features f WHERE f.layer_id = l.id)
            END AS "featureCount"
       FROM workspace.map_layers l
      WHERE l.map_id = $1
      ORDER BY l.position`,
    [mapId]
  );
  return rows;
}

/** The map's detail as seen by a user whose role has already been established. */
async function loadDetail(q: Queryable, mapId: string, role: MapRole): Promise<MapDetail> {
  const { rows } = await q.query<Omit<MapSummary, 'role'>>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM workspace.maps m JOIN app.users u ON u.id = m.owner_id
      WHERE m.id = $1 AND m.archived_at IS NULL`,
    [mapId]
  );
  // Archived or deleted between the role check and this read.
  if (!rows[0]) throw new NotFoundError(MAP_NOT_FOUND);
  return { ...rows[0], role, layers: await loadLayers(q, mapId) };
}

export function mapsService(pg: Pool) {
  return {
    async listMine(user: CurrentUser): Promise<MapSummary[]> {
      const { rows } = await pg.query<MapSummary>(
        `SELECT ${SUMMARY_COLUMNS}, 'owner' AS role
           FROM workspace.maps m JOIN app.users u ON u.id = m.owner_id
          WHERE m.owner_id = $1 AND m.archived_at IS NULL
          ORDER BY m.updated_at DESC, m.id`,
        [user.id]
      );
      return rows;
    },

    async listSharedWithMe(user: CurrentUser): Promise<MapSummary[]> {
      const { rows } = await pg.query<MapSummary>(
        `SELECT ${SUMMARY_COLUMNS}, 'recipient' AS role
           FROM workspace.maps m JOIN app.users u ON u.id = m.owner_id
          WHERE m.owner_id <> $1 AND m.archived_at IS NULL AND ${sharedWithUserSql('$1')}
          ORDER BY m.updated_at DESC, m.id`,
        [user.id]
      );
      return rows;
    },

    async create(user: CurrentUser, input: { title: string; description?: string }): Promise<MapDetail> {
      return inTransaction(pg, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO workspace.maps (owner_id, title, description)
           VALUES ($1, $2, $3) RETURNING id`,
          [user.id, input.title, input.description ?? '']
        );
        return loadDetail(client, rows[0].id, 'owner');
      });
    },

    async get(user: CurrentUser, mapId: string): Promise<MapDetail> {
      const role = await assertCanRead(pg, mapId, user);
      return loadDetail(pg, mapId, role);
    },

    async update(
      user: CurrentUser, mapId: string,
      input: { title?: string; description?: string; expectedRevision: number }
    ): Promise<MapDetail> {
      return inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await client.query(
          `UPDATE workspace.maps
              SET title = COALESCE($2, title), description = COALESCE($3, description)
            WHERE id = $1`,
          [mapId, input.title ?? null, input.description ?? null]
        );
        await bumpMap(client, mapId);
        return loadDetail(client, mapId, 'owner');
      });
    },

    /**
     * Delete the map with its layers, features and shares. The drafts behind its edit-copy
     * layers live in app.dataset_versions / water.*, which no cascade reaches, so they are
     * discarded first in the same transaction: a failed delete leaves both in place.
     */
    async remove(user: CurrentUser, mapId: string, input: { expectedRevision: number }): Promise<void> {
      await inTransaction(pg, async (client) => {
        await lockMapForWrite(client, mapId, user, input.expectedRevision);
        await discardEditCopyDrafts(client, mapId);
        await client.query(`DELETE FROM workspace.maps WHERE id = $1`, [mapId]);
      });
    },
  };
}

/**
 * Discard every draft behind the map's edit-copy layers. A version whose draft_status is NULL
 * has been published: it is shared data now, not this map's draft, and is left alone.
 */
async function discardEditCopyDrafts(client: PoolClient, mapId: string): Promise<void> {
  const { rows } = await client.query<{ draft_id: string }>(
    `SELECT l.draft_id
       FROM workspace.map_layers l
       JOIN app.dataset_versions v ON v.id = l.draft_id
      WHERE l.map_id = $1 AND l.kind = 'edit_copy' AND v.draft_status IS NOT NULL
      ORDER BY l.draft_id`,
    [mapId]
  );
  for (const { draft_id } of rows) await discardDraft(client, draft_id);
}

export type MapsService = ReturnType<typeof mapsService>;
