import type { Pool, PoolClient } from 'pg';
import { discardDraft } from '@webatlas/versioning';
import { inTransaction } from '../../lib/transaction';

/** A map unused for this long gets an inactivity notice. */
export const INACTIVE_NOTICE_DAYS = 180;
/** A map is archived this long after its notice, unless activity cleared the notice first. */
export const ARCHIVE_AFTER_NOTICE_DAYS = 30;
/** A personal draft that no map references is left alone this long before it counts as orphaned. */
export const ORPHAN_DRAFT_GRACE_HOURS = 24;

/**
 * Narrows a cleanup to some owners and/or drafts. Without a scope a cleanup acts on the whole
 * database (what the CLI wants); tests always pass their own.
 */
export interface CleanupScope {
  ownerIds?: string[];
  draftIds?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Set the inactivity notice on unarchived maps with no activity for INACTIVE_NOTICE_DAYS and no
 * notice yet. Returns how many were marked. Delivery of the notice (P4) reads this column.
 */
export async function markInactive(pg: Pool, now: Date, scope?: CleanupScope): Promise<number> {
  const cutoff = new Date(now.getTime() - INACTIVE_NOTICE_DAYS * DAY_MS);
  const { rowCount } = await pg.query(
    `UPDATE workspace.maps
        SET inactivity_notice_at = $1
      WHERE archived_at IS NULL AND inactivity_notice_at IS NULL AND last_activity_at < $2
        AND ($3::uuid[] IS NULL OR owner_id = ANY($3::uuid[]))`,
    [now, cutoff, scope?.ownerIds ?? null]
  );
  return rowCount ?? 0;
}

/**
 * Archive unarchived maps whose notice is older than ARCHIVE_AFTER_NOTICE_DAYS, one transaction
 * per map: its edit-copy drafts are discarded and archived_at is set. Free features are kept
 * (P3b decides what happens to files). Returns how many were archived.
 */
export async function archiveNoticed(pg: Pool, now: Date, scope?: CleanupScope): Promise<number> {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_NOTICE_DAYS * DAY_MS);
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM workspace.maps
      WHERE archived_at IS NULL AND inactivity_notice_at < $1
        AND ($2::uuid[] IS NULL OR owner_id = ANY($2::uuid[]))
      ORDER BY id`,
    [cutoff, scope?.ownerIds ?? null]
  );
  let archived = 0;
  for (const { id } of rows) {
    const done = await inTransaction(pg, async (client) => {
      // Re-check under the row lock: the owner may have written (clearing the notice) since the scan.
      const locked = await client.query(
        `SELECT 1 FROM workspace.maps
          WHERE id = $1 AND archived_at IS NULL AND inactivity_notice_at < $2
          FOR UPDATE`,
        [id, cutoff]
      );
      if (locked.rowCount === 0) return false;
      await discardMapDrafts(client, id);
      await client.query(`UPDATE workspace.maps SET archived_at = $2 WHERE id = $1`, [id, now]);
      return true;
    });
    if (done) archived++;
  }
  return archived;
}

/** Same locking as mapsService.remove: version rows locked as read, published versions skipped. */
async function discardMapDrafts(client: PoolClient, mapId: string): Promise<void> {
  const { rows } = await client.query<{ draft_id: string }>(
    `SELECT l.draft_id
       FROM workspace.map_layers l
       JOIN app.dataset_versions v ON v.id = l.draft_id
      WHERE l.map_id = $1 AND l.kind = 'edit_copy' AND v.draft_status IS NOT NULL
      ORDER BY l.draft_id
      FOR UPDATE OF v`,
    [mapId]
  );
  for (const { draft_id } of rows) await discardDraft(client, draft_id);
}

/**
 * Why an unreferenced personal draft is an orphan: every committed personal draft belongs to a
 * workspace map layer. Direct writes open and publish their draft inside one transaction, and
 * edit-copy layers are the only way P3 keeps a draft across requests. A personal draft that no
 * map_layers.draft_id references and that is older than the grace period therefore has no
 * owner-visible home. Any new caller that keeps a draft outside a map must attach it to a map
 * layer or extend this predicate; otherwise it is discarded after the grace period.
 *
 * Discard personal drafts that nothing owns: ingested_by is NULL (the owner is gone), or no map
 * layer references the draft and it has not been touched for ORPHAN_DRAFT_GRACE_HOURS. Submitted
 * and returned drafts belong to the review flow and are never touched. Without a scope it acts
 * on the whole database; a scope keeps only drafts owned by scope.ownerIds or listed in
 * scope.draftIds. Returns how many were discarded.
 */
export async function discardOrphanDrafts(pg: Pool, now: Date, scope?: CleanupScope): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_DRAFT_GRACE_HOURS * HOUR_MS);
  const orphanSql = `
    v.draft_status = 'personal'
    AND (v.ingested_by IS NULL
         OR (v.updated_at < $1
             AND NOT EXISTS (SELECT 1 FROM workspace.map_layers l WHERE l.draft_id = v.id)))
    AND (($2::uuid[] IS NULL AND $3::uuid[] IS NULL)
         OR v.ingested_by = ANY($2::uuid[]) OR v.id = ANY($3::uuid[]))`;
  const scopeArgs = [scope?.ownerIds ?? null, scope?.draftIds ?? null];
  const { rows } = await pg.query<{ id: string }>(
    `SELECT v.id FROM app.dataset_versions v WHERE ${orphanSql} ORDER BY v.id`,
    [cutoff, ...scopeArgs]
  );
  let discarded = 0;
  for (const { id } of rows) {
    const done = await inTransaction(pg, async (client) => {
      // Re-check under the row lock: a draft may have been referenced, published or removed meanwhile.
      const locked = await client.query(
        `SELECT 1 FROM app.dataset_versions v WHERE v.id = $4 AND ${orphanSql} FOR UPDATE OF v`,
        [cutoff, ...scopeArgs, id]
      );
      if (locked.rowCount === 0) return false;
      await discardDraft(client, id);
      return true;
    });
    if (done) discarded++;
  }
  return discarded;
}

export interface OwnerSummary {
  userId: string;
  email: string;
  maps: number;
  layers: number;
  features: number;
  bytes: number;
}

/** Per owner: counts and stored size of free features, archived maps included (their rows are kept). No titles, no content. */
export async function adminSummary(pg: Pool): Promise<OwnerSummary[]> {
  const { rows } = await pg.query<{
    user_id: string; email: string; maps: number; layers: number; features: number; bytes: string;
  }>(
    `SELECT u.id AS user_id, u.email,
            (SELECT count(*) FROM workspace.maps m WHERE m.owner_id = u.id)::int AS maps,
            count(l.id)::int AS layers,
            COALESCE(sum(f.n), 0)::int AS features,
            COALESCE(sum(f.bytes), 0)::bigint AS bytes
       FROM app.users u
       JOIN workspace.maps m ON m.owner_id = u.id
       LEFT JOIN workspace.map_layers l ON l.map_id = m.id
       LEFT JOIN LATERAL (
              SELECT count(*) AS n, sum(pg_column_size(x.geom) + pg_column_size(x.properties)) AS bytes
                FROM workspace.features x WHERE x.layer_id = l.id
            ) f ON true
      GROUP BY u.id, u.email
      ORDER BY bytes DESC, u.email`
  );
  return rows.map((r) => ({
    userId: r.user_id, email: r.email, maps: r.maps, layers: r.layers, features: r.features, bytes: Number(r.bytes),
  }));
}
