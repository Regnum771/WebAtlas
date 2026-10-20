import type { Pool, PoolClient } from 'pg';
import { ForbiddenError, NotFoundError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';

export type Queryable = Pick<Pool, 'query'>;
export type MapRole = 'owner' | 'recipient';

export const MAP_NOT_FOUND = 'Không tìm thấy bản đồ.';
export const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';

/**
 * SQL predicate: map `m` is shared with the user in parameter `$userParam`, either directly or
 * through an access group the user belongs to right now. Used by mapRole and the "shared with
 * me" list so that both answer the same question the same way.
 */
export function sharedWithUserSql(userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM workspace.map_shares s
    WHERE s.map_id = m.id
      AND (s.user_id = ${userParam}
           OR s.group_id IN (SELECT ug.group_id FROM app.user_groups ug WHERE ug.user_id = ${userParam}))
  )`;
}

/**
 * The user's role on a map, or null when the user may not see it at all. An archived map is
 * null for everyone, its owner included. Admin rights play no part: admin sees no one's maps.
 */
export async function mapRole(q: Queryable, mapId: string, userId: string): Promise<MapRole | null> {
  const { rows } = await q.query<{ role: MapRole | null }>(
    `SELECT CASE
              WHEN m.owner_id = $2 THEN 'owner'
              WHEN ${sharedWithUserSql('$2')} THEN 'recipient'
            END AS role
       FROM workspace.maps m
      WHERE m.id = $1 AND m.archived_at IS NULL`,
    [mapId, userId]
  );
  return rows[0]?.role ?? null;
}

/**
 * Throws the same 404 for a map the user may not see as for one that does not exist, so a
 * stranger cannot tell the two apart.
 */
export async function assertCanRead(q: Queryable, mapId: string, user: CurrentUser): Promise<MapRole> {
  const role = await mapRole(q, mapId, user.id);
  if (role === null) throw new NotFoundError(MAP_NOT_FOUND);
  return role;
}

/** The map moved since the caller read it. Mapped to 409 MAP_CHANGED by the error handler. */
export class MapRevisionError extends Error {
  constructor(mapId: string, expected: number, actual: number) {
    super(`Map ${mapId} is at revision ${actual}, expected ${expected}`);
    this.name = 'MapRevisionError';
  }
}

/**
 * Lock the map row for the rest of the transaction and check that `user` may write it at
 * `expectedRevision`. Order matters: visibility first (404), then ownership (403), then the
 * revision (409), so that neither a stranger nor a recipient learns the revision.
 */
export async function lockMapForWrite(
  client: PoolClient, mapId: string, user: CurrentUser, expectedRevision: number
): Promise<{ revision: number }> {
  const { rows } = await client.query<{ owner_id: string; revision: number }>(
    `SELECT owner_id, revision FROM workspace.maps
      WHERE id = $1 AND archived_at IS NULL
      FOR UPDATE`,
    [mapId]
  );
  const map = rows[0];
  if (!map) throw new NotFoundError(MAP_NOT_FOUND);
  if (map.owner_id !== user.id) {
    const role = await mapRole(client, mapId, user.id);
    if (role === null) throw new NotFoundError(MAP_NOT_FOUND);
    throw new ForbiddenError(OWNER_ONLY);
  }
  if (map.revision !== expectedRevision) throw new MapRevisionError(mapId, expectedRevision, map.revision);
  return { revision: map.revision };
}

/** Record a change to the map's content: next revision, fresh activity. Returns the new revision. */
export async function bumpMap(client: PoolClient, mapId: string): Promise<number> {
  const { rows } = await client.query<{ revision: number }>(
    `UPDATE workspace.maps
        SET revision = revision + 1,
            updated_at = now(),
            last_activity_at = now(),
            inactivity_notice_at = NULL
      WHERE id = $1
      RETURNING revision`,
    [mapId]
  );
  if (!rows[0]) throw new NotFoundError(MAP_NOT_FOUND);
  return rows[0].revision;
}
