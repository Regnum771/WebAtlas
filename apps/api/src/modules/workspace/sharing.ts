import type { Pool, PoolClient } from 'pg';
import { NotFoundError as VersioningNotFoundError, copyDraft } from '@webatlas/versioning';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import { MAP_NOT_FOUND, OWNER_ONLY, mapRole, type Queryable } from './access';
import { loadDetail, type MapDetail } from './maps';

/*
 * Sharing a personal map with users or access groups, and copying a map one can see.
 *
 * Shares are not content: adding or removing one leaves the map's revision alone, so they take
 * no expectedRevision. Who a share reaches is decided at read time by sharedWithUserSql (a group
 * share follows the group's membership as it is now). Only the owner manages shares; a recipient
 * gets 403, anyone else the map's 404.
 */

export const SELF_SHARE = 'Không thể chia sẻ với chính mình.';
export const UNKNOWN_USER = 'Không tìm thấy người dùng này.';
export const UNKNOWN_GROUP = 'Không tìm thấy nhóm này.';
export const SHARE_NOT_FOUND = 'Không tìm thấy lượt chia sẻ này.';
const COPY_PREFIX = 'Bản sao của ';
/** workspace.maps.title is 1 to 200 characters (CHECK). */
const TITLE_MAX = 200;
const TARGETS_MAX = 10;

export interface Share {
  id: string;
  userId: string | null;
  groupId: string | null;
  /** The user's full name (or email when it has none), or the group's name. */
  name: string;
  createdAt: Date;
}

export type ShareTarget = { userId: string } | { groupId: string };

export interface ShareTargets {
  users: Array<{ id: string; name: string; email: string }>;
  groups: Array<{ id: string; name: string }>;
}

const SHARE_SELECT = `
  SELECT s.id, s.user_id AS "userId", s.group_id AS "groupId",
         COALESCE(NULLIF(u.full_name, ''), u.email::text, g.name) AS name,
         s.created_at AS "createdAt"
    FROM workspace.map_shares s
    LEFT JOIN app.users u ON u.id = s.user_id
    LEFT JOIN app.access_groups g ON g.id = s.group_id`;

/** 404 for a map the user cannot see (or that does not exist), 403 for a recipient. */
async function assertOwner(q: Queryable, mapId: string, user: CurrentUser): Promise<void> {
  const role = await mapRole(q, mapId, user.id);
  if (role === null) throw new NotFoundError(MAP_NOT_FOUND);
  if (role !== 'owner') throw new ForbiddenError(OWNER_ONLY);
}

/**
 * assertOwner inside a share write. FOR KEY SHARE keeps the map from being deleted until the
 * transaction ends (so the insert cannot hit a vanished map), without blocking content writes,
 * which never touch the key.
 */
async function lockOwnedMap(client: PoolClient, mapId: string, user: CurrentUser): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM workspace.maps WHERE id = $1 AND archived_at IS NULL FOR KEY SHARE`, [mapId]
  );
  if (!rows[0]) throw new NotFoundError(MAP_NOT_FOUND);
  await assertOwner(client, mapId, user);
}

async function loadShare(q: Queryable, shareId: string): Promise<Share> {
  const { rows } = await q.query<Share>(`${SHARE_SELECT} WHERE s.id = $1`, [shareId]);
  return rows[0];
}

/** `q` as a LIKE pattern matching it anywhere, with its own wildcards taken literally. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The copy's title, cut to the column's limit (counted in characters, as Postgres does). */
function copyTitle(title: string): string {
  return Array.from(`${COPY_PREFIX}${title}`).slice(0, TITLE_MAX).join('');
}

/**
 * A copy of the edit copy's draft owned by `ownerId`, or null when there is no draft to copy:
 * discarded (the layer's draft_id is already NULL) or no longer a draft (published).
 */
async function copyLayerDraft(client: PoolClient, draftId: string | null, ownerId: string): Promise<string | null> {
  if (draftId === null) return null;
  try {
    return (await copyDraft(client, draftId, ownerId)).id;
  } catch (e) {
    // Thrown before copyDraft writes anything, so the transaction is still usable.
    if (e instanceof VersioningNotFoundError) return null;
    throw e;
  }
}

export function sharingService(pg: Pool) {
  return {
    async list(user: CurrentUser, mapId: string): Promise<Share[]> {
      await assertOwner(pg, mapId, user);
      const { rows } = await pg.query<Share>(
        `${SHARE_SELECT} WHERE s.map_id = $1 ORDER BY s.created_at, s.id`, [mapId]
      );
      return rows;
    },

    /**
     * Share the map with one active user or one group. Sharing again with the same target
     * returns the existing share with `created: false`.
     */
    async add(user: CurrentUser, mapId: string, target: ShareTarget): Promise<{ share: Share; created: boolean }> {
      return inTransaction(pg, async (client) => {
        await lockOwnedMap(client, mapId, user);
        let column: 'user_id' | 'group_id';
        let targetId: string;
        if ('userId' in target) {
          // Compared as stored, so an id sent in another letter case is still recognised as one's own.
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM app.users WHERE id = $1 AND is_active`, [target.userId]
          );
          if (!rows[0]) throw new ValidationError(UNKNOWN_USER, { field: 'userId' });
          if (rows[0].id === user.id) throw new ValidationError(SELF_SHARE, { field: 'userId' });
          [column, targetId] = ['user_id', rows[0].id];
        } else {
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM app.access_groups WHERE id = $1`, [target.groupId]
          );
          if (!rows[0]) throw new ValidationError(UNKNOWN_GROUP, { field: 'groupId' });
          [column, targetId] = ['group_id', rows[0].id];
        }
        // The conflict target names the partial unique index for this column.
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO workspace.map_shares (map_id, ${column}, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (map_id, ${column}) WHERE ${column} IS NOT NULL DO NOTHING
           RETURNING id`,
          [mapId, targetId, user.id]
        );
        if (inserted.rows[0]) return { share: await loadShare(client, inserted.rows[0].id), created: true };
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM workspace.map_shares WHERE map_id = $1 AND ${column} = $2`, [mapId, targetId]
        );
        return { share: await loadShare(client, existing.rows[0].id), created: false };
      });
    },

    async remove(user: CurrentUser, mapId: string, shareId: string): Promise<void> {
      await inTransaction(pg, async (client) => {
        await lockOwnedMap(client, mapId, user);
        const { rowCount } = await client.query(
          `DELETE FROM workspace.map_shares WHERE id = $1 AND map_id = $2`, [shareId, mapId]
        );
        if (!rowCount) throw new NotFoundError(SHARE_NOT_FOUND);
      });
    },

    /**
     * Who the caller can share with: active users other than the caller, and access groups,
     * whose name (or, for users, email) contains `q`, case-insensitively. At most 10 of each.
     */
    async targets(user: CurrentUser, q: string): Promise<ShareTargets> {
      const pattern = containsPattern(q);
      const [users, groups] = await Promise.all([
        pg.query<ShareTargets['users'][number]>(
          `SELECT id, COALESCE(NULLIF(full_name, ''), email::text) AS name, email::text AS email
             FROM app.users
            WHERE id <> $1 AND is_active AND (full_name ILIKE $2 OR email::text ILIKE $2)
            ORDER BY name, email
            LIMIT ${TARGETS_MAX}`,
          [user.id, pattern]
        ),
        pg.query<ShareTargets['groups'][number]>(
          `SELECT id, name FROM app.access_groups WHERE name ILIKE $1 ORDER BY name LIMIT ${TARGETS_MAX}`,
          [pattern]
        ),
      ]);
      return { users: users.rows, groups: groups.rows };
    },

    /**
     * An independent copy of a map the user can see (owner or recipient), owned by the user and
     * starting at revision 0: free layers with their features, edit copies each with a copy of
     * its draft on the same parent (copyDraft), a layer whose draft is gone with no draft. The
     * copy shares nothing with the source, so later edits, deletions or a revoked share on
     * either side leave the other alone.
     *
     * One transaction. The source map row is held FOR SHARE: every content write locks it FOR
     * UPDATE first (lockMapForWrite), so the source cannot change while it is being copied, and
     * the lock order (map, then draft) is the one every edit-copy write uses.
     */
    async copy(user: CurrentUser, mapId: string): Promise<MapDetail> {
      return inTransaction(pg, async (client) => {
        const { rows: src } = await client.query<{ title: string; description: string }>(
          `SELECT title, description FROM workspace.maps
            WHERE id = $1 AND archived_at IS NULL FOR SHARE`,
          [mapId]
        );
        if (!src[0] || (await mapRole(client, mapId, user.id)) === null) throw new NotFoundError(MAP_NOT_FOUND);

        const { rows: made } = await client.query<{ id: string }>(
          `INSERT INTO workspace.maps (owner_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
          [user.id, copyTitle(src[0].title), src[0].description]
        );
        const copyId = made[0].id;

        const { rows: layers } = await client.query<{ id: string; kind: string; draft_id: string | null }>(
          `SELECT id, kind, draft_id FROM workspace.map_layers WHERE map_id = $1 ORDER BY position`, [mapId]
        );
        for (const layer of layers) {
          const draftId = layer.kind === 'edit_copy' ? await copyLayerDraft(client, layer.draft_id, user.id) : null;
          const { rows: copied } = await client.query<{ id: string }>(
            `INSERT INTO workspace.map_layers
               (map_id, kind, title, position, style, geometry_type, fields, layer_key, draft_id)
             SELECT $1, kind, title, position, style, geometry_type, fields, layer_key, $3
               FROM workspace.map_layers WHERE id = $2
             RETURNING id`,
            [copyId, layer.id, draftId]
          );
          // Only free layers hold features today; copying by layer keeps any kind's features.
          await client.query(
            `INSERT INTO workspace.features (layer_id, geom, properties, source_row, source_crs)
             SELECT $1, geom, properties, source_row, source_crs
               FROM workspace.features WHERE layer_id = $2 ORDER BY id`,
            [copied[0].id, layer.id]
          );
        }
        return loadDetail(client, copyId, 'owner');
      });
    },
  };
}

export type SharingService = ReturnType<typeof sharingService>;
