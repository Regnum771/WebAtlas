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
 * is about to be archived, and only writes and the owner's own reads (mapsService.get) refresh
 * last_activity_at, so a map that only its recipients read can reach this point and lose its
 * drafts, which cannot be undone. The CLI (scripts/workspaceCleanup.ts) runs it only when given
 * --archive.
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
 * The import job statuses that make an upload one of the archived map's originals: one that is
 * waiting, running or done. A failed import left nothing in the map. (Keeping the file for a
 * live map takes a succeeded import: markArchivedOriginals.)
 */
const LIVE_IMPORT_STATUSES = `('queued', 'running', 'succeeded')`;

/**
 * Give the originals of a map just archived ORIGINALS_KEEP_DAYS from `now`: every upload that a
 * live import job (LIVE_IMPORT_STATUSES) of this map read (params.fileId), unless a succeeded
 * import job of a map that is not archived read it too. That map shows what came from the file,
 * so the file is kept as long as it is. An import into a live map that has not succeeded (queued,
 * running or failed) put nothing there yet, so it does not keep the file: if it succeeds the
 * worker clears the date (worker.py keep_imported_original), and while it is queued or running
 * deleteExpiredFiles leaves the file alone (BEING_IMPORTED). A later date already set is never
 * brought forward. Runs after archived_at is set, so this map no longer counts as live.
 */
async function markArchivedOriginals(client: PoolClient, mapId: string, now: Date): Promise<void> {
  const keepUntil = new Date(now.getTime() + ORIGINALS_KEEP_DAYS * DAY_MS);
  await client.query(
    `UPDATE workspace.files f
        SET delete_after = GREATEST(f.delete_after, $2)
      WHERE f.kind = 'upload'
        AND EXISTS (SELECT 1 FROM workspace.jobs j
                     WHERE j.kind = 'import' AND j.status IN ${LIVE_IMPORT_STATUSES}
                       AND j.map_id = $1 AND j.params->>'fileId' = f.id::text)
        AND NOT EXISTS (SELECT 1 FROM workspace.jobs j JOIN workspace.maps m ON m.id = j.map_id
                         WHERE j.kind = 'import' AND j.status = 'succeeded'
                           AND m.archived_at IS NULL AND j.params->>'fileId' = f.id::text)`,
    [mapId, keepUntil]
  );
}

/**
 * An upload that a queued or running import job reads is not removed, even past its
 * delete_after: the job would fail on a missing file. Once the job succeeds the worker clears the
 * date; once it fails, the next sweep removes the file. `f` is the workspace.files row.
 */
const BEING_IMPORTED = `(f.kind = 'upload' AND EXISTS (
  SELECT 1 FROM workspace.jobs j
   WHERE j.kind = 'import' AND j.status IN ('queued', 'running') AND j.params->>'fileId' = f.id::text))`;

/**
 * Remove the files whose delete_after has passed: an export after its 7 days, an archived map's
 * original after its 90, a COG whose raster layer or map was deleted. One transaction per file:
 * the row is locked and re-checked, the file is unlinked from the store (a file already gone is
 * fine), then the row is deleted. A file that cannot be removed (a path outside the store, a
 * permission error) is logged and its row kept for a person to look at; the sweep goes on. An
 * upload that a queued or running import reads waits (BEING_IMPORTED).
 * Returns how many files were removed.
 *
 * This runs outside any request: the API only sets delete_after, and never unlinks in a request.
 */
export async function deleteExpiredFiles(
  pg: Pool, now: Date, scope?: Pick<CleanupScope, 'ownerIds'>
): Promise<number> {
  const owners = mapOwners(scope); // the files of these owners, or of everyone without a scope
  const { rows } = await pg.query<{ id: string }>(
    `SELECT f.id FROM workspace.files f
      WHERE f.delete_after < $1 AND ($2::uuid[] IS NULL OR f.owner_id = ANY($2::uuid[]))
        AND NOT ${BEING_IMPORTED}
      ORDER BY f.delete_after, f.id`,
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
        // Checked in a statement of its own, after the row lock: enqueueImport holds that lock
        // while it inserts its job, so this statement's snapshot sees any job it committed.
        const importing = await client.query(
          `SELECT 1 FROM workspace.files f WHERE f.id = $1 AND ${BEING_IMPORTED}`, [id]
        );
        if (importing.rowCount) return false;
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

/** Reconciliation refuses to delete more orphans than this in one run, unless forced. */
export const RECONCILE_MAX_FILES = 50;
/** ... or more than this share of the regular files found under the store's trees, unless forced. */
export const RECONCILE_MAX_SHARE = 0.2;

/** An orphan file reconcileStore found: store-relative path, size and age (from the newest timestamp). */
export interface OrphanCandidate {
  path: string;
  sizeBytes: number;
  ageMs: number;
}

export interface ReconcileOptions {
  /** How old a file without a row must be to count as an orphan; ORPHAN_FILE_GRACE_MS by default. */
  olderThanMs?: number;
  /** Delete the candidates. Without it the run is a dry run: candidates are listed, nothing is deleted. */
  apply?: boolean;
  /** Lift the RECONCILE_MAX_FILES / RECONCILE_MAX_SHARE guard. The other refusals cannot be lifted. */
  force?: boolean;
}

export interface ReconcileResult {
  /** The absolute store root that was walked (empty when refused before walking). */
  root: string;
  /** Regular files found under uploads/, cog/ and exports/, with a row or not. */
  filesSeen: number;
  /** The orphans: old enough and named by no workspace.files row. */
  candidates: OrphanCandidate[];
  /** Why nothing was deleted, when a guard refused the run; null otherwise. */
  refused: string | null;
  /** How many candidates were unlinked (0 on a dry run or a refusal). */
  removed: number;
}

/**
 * Find, and with opts.apply remove, orphan files in the store: regular files under uploads/,
 * cog/ and exports/ that are older than `olderThanMs` (by the newest of mtime, ctime and
 * birthtime; ORPHAN_FILE_GRACE_MS by default) and that no workspace.files row names. They are
 * what a crash or an interrupted job leaves: an export's .work-* files, a COG's .part
 * temporaries, a file written before its row was committed. The grace period keeps clear of a
 * job that is still writing.
 *
 * A dry run by default. Everything here hinges on the store and the database belonging together:
 * pointed at a fresh, restored or test database, or at the wrong directory, every old file looks
 * like an orphan. So the run is refused, and nothing deleted, when
 * - WORKSPACE_FILES_DIR is relative (it would depend on the working directory);
 * - workspace.files has no row at all while there are candidates (an empty or foreign database);
 * - unless opts.force, the candidates are more than RECONCILE_MAX_FILES or more than
 *   RECONCILE_MAX_SHARE of the regular files under the three trees.
 * The guards are checked on a dry run too, so it reports what --apply would do.
 *
 * Read-only walk, never following a link: a symbolic link (or a Windows junction) is skipped, as
 * is anything that is not a regular file or a directory. A file that has a row is never touched;
 * directories are never removed. Each file goes through unlinkInStore, which refuses a path
 * outside the store root.
 */
export async function reconcileStore(
  pg: Pool, now: Date, opts: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const configured = process.env.WORKSPACE_FILES_DIR;
  if (configured && !path.isAbsolute(configured)) {
    return {
      root: '', filesSeen: 0, candidates: [], removed: 0,
      refused: `WORKSPACE_FILES_DIR is relative (${configured}); set it to an absolute path`,
    };
  }
  const cutoff = now.getTime() - (opts.olderThanMs ?? ORPHAN_FILE_GRACE_MS);
  const root = storeRoot();
  let filesSeen = 0;
  // Old enough to be an orphan; store-relative, with '/' as workspace.files writes them.
  const old: OrphanCandidate[] = [];

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
        if (!info.isFile()) continue;
        filesSeen++;
        if (touched < cutoff) old.push({ path: childRel, sizeBytes: info.size, ageMs: now.getTime() - touched });
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

  const candidates: OrphanCandidate[] = [];
  const BATCH = 500;
  for (let i = 0; i < old.length; i += BATCH) {
    const batch = old.slice(i, i + BATCH);
    const { rows } = await pg.query<{ path: string }>(
      `SELECT path FROM workspace.files WHERE path = ANY($1::text[])`, [batch.map((c) => c.path)]
    );
    const known = new Set(rows.map((r) => r.path));
    for (const c of batch) if (!known.has(c.path)) candidates.push(c);
  }

  const result: ReconcileResult = { root, filesSeen, candidates, refused: null, removed: 0 };
  if (candidates.length === 0) return result;

  const { rows: anyRow } = await pg.query<{ has_rows: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM workspace.files) AS has_rows`
  );
  if (!anyRow[0]?.has_rows) {
    result.refused =
      `workspace.files has no rows but the store has ${candidates.length} candidate(s): ` +
      'the database and WORKSPACE_FILES_DIR do not belong together';
    return result;
  }
  const overShare = candidates.length > RECONCILE_MAX_SHARE * filesSeen;
  if (!opts.force && (candidates.length > RECONCILE_MAX_FILES || overShare)) {
    result.refused =
      `${candidates.length} candidate(s) of ${filesSeen} file(s) is more than ` +
      `${RECONCILE_MAX_FILES} files or ${RECONCILE_MAX_SHARE * 100} % of the store; ` +
      'check that WORKSPACE_FILES_DIR and DATABASE_URL belong together, then pass --force';
    return result;
  }
  if (!opts.apply) return result;

  for (const c of candidates) {
    try {
      await unlinkInStore(c.path);
      result.removed++;
    } catch (err) {
      console.warn(`reconcileStore: ${c.path} kept: ${(err as Error).message}`);
    }
  }
  return result;
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
  /** The stored size of the owner's free features alone. */
  bytes: number;
  /** What counts against the quota: workspace.usage_bytes, live files included. */
  usageBytes: number;
  quotaBytes: number;
}

/**
 * Per owner, for every user who owns a map or a file: counts and stored size of free features,
 * archived maps included (their rows are kept), and the quota's usage and limit. No titles, no
 * content. Largest usage first.
 */
export async function adminSummary(pg: Pool): Promise<OwnerSummary[]> {
  const { rows } = await pg.query<{
    user_id: string; email: string; maps: number; layers: number; features: number; bytes: string;
    usage_bytes: string; quota_bytes: string;
  }>(
    `SELECT u.id AS user_id, u.email,
            (SELECT count(*) FROM workspace.maps m WHERE m.owner_id = u.id)::int AS maps,
            count(l.id)::int AS layers,
            COALESCE(sum(f.n), 0)::int AS features,
            COALESCE(sum(f.bytes), 0)::bigint AS bytes,
            workspace.usage_bytes(u.id) AS usage_bytes,
            u.quota_bytes
       FROM app.users u
       LEFT JOIN workspace.maps m ON m.owner_id = u.id
       LEFT JOIN workspace.map_layers l ON l.map_id = m.id
       LEFT JOIN LATERAL (
              SELECT count(*) AS n, sum(pg_column_size(x.geom) + pg_column_size(x.properties)) AS bytes
                FROM workspace.features x WHERE x.layer_id = l.id
            ) f ON true
      WHERE EXISTS (SELECT 1 FROM workspace.maps mm WHERE mm.owner_id = u.id)
         OR EXISTS (SELECT 1 FROM workspace.files fl WHERE fl.owner_id = u.id)
      GROUP BY u.id, u.email, u.quota_bytes
      ORDER BY usage_bytes DESC, bytes DESC, u.email`
  );
  return rows.map((r) => ({
    userId: r.user_id, email: r.email, maps: r.maps, layers: r.layers, features: r.features, bytes: Number(r.bytes),
    usageBytes: Number(r.usage_bytes), quotaBytes: Number(r.quota_bytes),
  }));
}
