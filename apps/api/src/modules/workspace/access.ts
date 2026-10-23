import type { Pool, PoolClient } from 'pg';
import { ForbiddenError, NotFoundError } from '../../errors';
import type { CurrentUser } from '../../types/fastify';

export type Queryable = Pick<Pool, 'query'>;
export type MapRole = 'owner' | 'recipient';

export const MAP_NOT_FOUND = 'Không tìm thấy bản đồ.';
export const OWNER_ONLY = 'Chỉ người tạo bản đồ được sửa bản đồ này.';

/**
 * SQL predicate: map `m` is shared with the user in parameter `$userParam`, either directly or
 * through an access group the user belongs to right now. Used by the "shared with me" list, as a
 * predicate over every map so the planner can join it. It is the same rule as the 'recipient'
 * branch of workspace.map_role (migration 30), which mapRole and the worker call; change both
 * together (mapRole.test.ts checks that they agree).
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
 * The rule lives in SQL (workspace.map_role, migration 30) so that the worker applies the same one.
 */
export async function mapRole(q: Queryable, mapId: string, userId: string): Promise<MapRole | null> {
  const { rows } = await q.query<{ role: MapRole | null }>(
    `SELECT workspace.map_role($1, $2) AS role`,
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
 * The map row stayed locked past MAP_LOCK_TIMEOUT (a running import holds it for the whole job).
 * Mapped to 409 MAP_BUSY by the error handler; nothing was changed.
 */
export class MapBusyError extends Error {
  constructor(mapId: string) {
    super(`Map ${mapId} is locked by another write`);
    this.name = 'MapBusyError';
  }
}

/** How long a write waits for the map row before it gives up with MapBusyError. */
export const MAP_LOCK_TIMEOUT = '3s';
/** Postgres lock_not_available: a lock_timeout ran out. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Lock the map row for the rest of the transaction and check that `user` may write it at
 * `expectedRevision`. Order matters: visibility first (404), then ownership (403), then the
 * revision (409), so that neither a stranger nor a recipient learns the revision.
 *
 * The wait for the row is bounded: a write during a running import fails fast with MapBusyError
 * instead of hanging until the import ends (and holding up the client's queue of writes to the
 * map). The bound covers this lock only; the transaction's own lock_timeout is put back after it.
 */
export async function lockMapForWrite(
  client: PoolClient, mapId: string, user: CurrentUser, expectedRevision: number
): Promise<{ revision: number }> {
  const { rows: setting } = await client.query<{ previous: string }>(
    `SELECT current_setting('lock_timeout') AS previous, set_config('lock_timeout', $1, true)`,
    [MAP_LOCK_TIMEOUT]
  );
  let rows: { owner_id: string; revision: number }[];
  try {
    ({ rows } = await client.query<{ owner_id: string; revision: number }>(
      `SELECT owner_id, revision FROM workspace.maps
        WHERE id = $1 AND archived_at IS NULL
        FOR UPDATE`,
      [mapId]
    ));
  } catch (e) {
    if ((e as { code?: string }).code === LOCK_NOT_AVAILABLE) throw new MapBusyError(mapId);
    throw e;
  }
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [setting[0].previous]);
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

/**
 * Record a change to the map's content: next revision, fresh activity. Returns the new revision.
 * The rule lives in SQL (workspace.bump_map, migration 28) so that the worker applies the same one.
 */
export async function bumpMap(client: PoolClient, mapId: string): Promise<number> {
  const { rows } = await client.query<{ revision: number | null }>(
    `SELECT workspace.bump_map($1) AS revision`,
    [mapId]
  );
  const revision = rows[0]?.revision ?? null;
  if (revision === null) throw new NotFoundError(MAP_NOT_FOUND);
  return revision;
}
