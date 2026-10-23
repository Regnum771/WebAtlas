import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { discardDraft } from '@webatlas/versioning';
import { inTransaction } from '../../lib/transaction';
import { storeRoot, unlinkInStore } from './fileStore';

/** A map unused for this long gets an inactivity notice. */
export const INACTIVE_NOTICE_DAYS = 180;
/** A map is archived this long after its notice, unless activity cleared the notice first. */
export const ARCHIVE_AFTER_NOTICE_DAYS = 30;
/** A personal draft that no map references is left alone this long before it counts as orphaned. */
export const ORPHAN_DRAFT_GRACE_HOURS = 24;
/** An archived map's imported originals are kept this long after archiving (spec: "another 90 days"). */
export const ORIGINALS_KEEP_DAYS = 90;
/** A file in the store with no workspace.files row is left alone this long before it counts as orphaned. */
export const ORPHAN_FILE_GRACE_MS = 24 * 60 * 60 * 1000;
/** The store's trees that hold files the API or the worker wrote. Nothing else under the root is touched. */
const STORE_TREES = ['uploads', 'cog', 'exports'];

/**
 * Narrows a cleanup to some owners and/or drafts. Without a scope a cleanup acts on the whole
 * database (what the CLI wants); tests always pass their own. The map sweeps (markInactive,
 * archiveNoticed) read only ownerIds: a scope that names drafts alone touches no maps.
 */
export interface CleanupScope {
  ownerIds?: string[];
  draftIds?: string[];
}

/** The owners a map or file sweep covers: null (everyone) without a scope, else scope.ownerIds or none. */
function mapOwners(scope?: CleanupScope): string[] | null {
  return scope ? scope.ownerIds ?? [] : null;
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
    [now, cutoff, mapOwners(scope)]
  );
  return rowCount ?? 0;
}

/**
 * Archive unarchived maps whose notice is older than ARCHIVE_AFTER_NOTICE_DAYS, one transaction
 * per map: its edit-copy drafts are discarded, archived_at is set, and the map's imported
 * originals are given ORIGINALS_KEEP_DAYS more (markArchivedOriginals). Free features are kept.
 * Returns how many were archived.
 *
 * Do not schedule before P4 delivers inactivity notices. Until then nobody is told that a map
 * is about to be archived, and only writes refresh last_activity_at, so a map that is only being
 * read can reach this point and lose its drafts, which cannot be undone. The CLI
 * (scripts/workspaceCleanup.ts) runs it only when given --archive.
 */
export async function archiveNoticed(pg: Pool, now: Date, scope?: CleanupScope): Promise<number> {
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_NOTICE_DAYS * DAY_MS);
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM workspace.maps
      WHERE archived_at IS NULL AND inactivity_notice_at < $1
        AND ($2::uuid[] IS NULL OR owner_id = ANY($2::uuid[]))
      ORDER BY id`,
    [cutoff, mapOwners(scope)]
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
      await markArchivedOriginals(client, id, now);
      return true;
    });
    if (done) archived++;
  }
  return archived;
}

/**
 * Give the originals of a map just archived ORIGINALS_KEEP_DAYS from `now`: every upload that an
 * import job of this map read (params.fileId), unless an import job of a map that is not archived
 * read it too. That map still shows what came from the file, so the file is kept as long as it is.
 * A later date already set is never brought forward. Runs after archived_at is set, so this map
 * no longer counts as live. Importing the file again into a live map clears the date
 * (jobs.ts enqueueImport).
 */
async function markArchivedOriginals(client: PoolClient, mapId: string, now: Date): Promise<void> {
  const keepUntil = new Date(now.getTime() + ORIGINALS_KEEP_DAYS * DAY_MS);
  await client.query(
    `UPDATE workspace.files f
        SET delete_after = GREATEST(f.delete_after, $2)
      WHERE f.kind = 'upload'
        AND EXISTS (SELECT 1 FROM workspace.jobs j
                     WHERE j.kind = 'import' AND j.map_id = $1 AND j.params->>'fileId' = f.id::text)
        AND NOT EXISTS (SELECT 1 FROM workspace.jobs j JOIN workspace.maps m ON m.id = j.map_id
                         WHERE j.kind = 'import' AND m.archived_at IS NULL AND j.params->>'fileId' = f.id::text)`,
    [mapId, keepUntil]
  );
}

/**
 * Remove the files whose delete_after has passed: an export after its 7 days, an archived map's
 * original after its 90, a COG whose raster layer or map was deleted. One transaction per file:
 * the row is locked and re-checked, the file is unlinked from the store (a file already gone is
 * fine), then the row is deleted. A file that cannot be removed (a path outside the store, a
 * permission error) is logged and its row kept for a person to look at; the sweep goes on.
 * Returns how many files were removed.
 *
 * This runs outside any request: the API only sets delete_after, and never unlinks in a request.
 */
export async function deleteExpiredFiles(
  pg: Pool, now: Date, scope?: Pick<CleanupScope, 'ownerIds'>
): Promise<number> {
  const owners = mapOwners(scope); // the files of these owners, or of everyone without a scope
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM workspace.files
      WHERE delete_after < $1 AND ($2::uuid[] IS NULL OR owner_id = ANY($2::uuid[]))
      ORDER BY delete_after, id`,
    [now, owners]
  );
  let removed = 0;
  for (const { id } of rows) {
    try {
      const done = await inTransaction(pg, async (client) => {
        const locked = await client.query<{ path: string }>(
          `SELECT path FROM workspace.files WHERE id = $1 AND delete_after < $2 FOR UPDATE`, [id, now]
        );
        if (!locked.rows[0]) return false; // removed, or given more time, since the scan
        await unlinkInStore(locked.rows[0].path);
        await client.query(`DELETE FROM workspace.files WHERE id = $1`, [id]);
        return true;
      });
      if (done) removed++;
    } catch (err) {
      console.warn(`deleteExpiredFiles: file ${id} kept: ${(err as Error).message}`);
    }
  }
  return removed;
}

/**
 * Remove orphan files from the store: regular files under uploads/, cog/ and exports/ that are
 * older than `olderThanMs` (by the newest of mtime, ctime and birthtime; ORPHAN_FILE_GRACE_MS by
 * default) and that no workspace.files
 * row names. They are what a crash or an interrupted job leaves: an export's .work-* files, a
 * COG's .part temporaries, a file written before its row was committed. The grace period keeps
 * clear of a job that is still writing.
 *
 * Read-only walk, never following a link: a symbolic link (or a Windows junction) is skipped, as
 * is anything that is not a regular file or a directory. A file that has a row is never touched;
 * directories are never removed. Each file goes through unlinkInStore, which refuses a path
 * outside the store root. Returns how many files were removed.
 */
export async function reconcileStore(
  pg: Pool, now: Date, opts: { olderThanMs?: number } = {}
): Promise<{ removed: number }> {
  const cutoff = now.getTime() - (opts.olderThanMs ?? ORPHAN_FILE_GRACE_MS);
  const root = storeRoot();
  const candidates: string[] = []; // store-relative, with '/' as workspace.files writes them

  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      // Dirent types come from the entry itself: a link reads as a link, not as its target.
      if (entry.isDirectory()) {
        await walk(abs, childRel);
      } else if (entry.isFile()) {
        const info = await lstat(abs);
        // Age from the newest of the three times: a copy (fs.copyFile, as sharing.ts copyCog
        // does) keeps the source's mtime on Windows and macOS, so a COG copied a moment ago,
        // whose row commits only with the whole map copy, would otherwise look a day old.
        const touched = Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs);
        if (info.isFile() && touched < cutoff) candidates.push(childRel);
      }
    }
  }

  for (const tree of STORE_TREES) {
    const abs = path.join(root, tree);
    try {
      const info = await lstat(abs);
      if (!info.isDirectory()) continue; // missing, a file, or a link: not walked
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    await walk(abs, tree);
  }

  let removed = 0;
  const BATCH = 500;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const { rows } = await pg.query<{ path: string }>(
      `SELECT path FROM workspace.files WHERE path = ANY($1::text[])`, [batch]
    );
    const known = new Set(rows.map((r) => r.path));
    for (const rel of batch) {
      if (known.has(rel)) continue;
      try {
        await unlinkInStore(rel);
        removed++;
      } catch (err) {
        console.warn(`reconcileStore: ${rel} kept: ${(err as Error).message}`);
      }
    }
  }
  return { removed };
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
