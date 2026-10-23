import { getPool, closePool } from '../db/pool';
import {
  archiveNoticed, deleteExpiredFiles, discardOrphanDrafts, markInactive,
} from '../modules/workspace/cleanup';
import { parseCleanupArgs, runReconcile, type CleanupFlags } from '../modules/workspace/cleanupCli';

/*
 * Run periodically: notice inactive personal maps, discard orphan drafts and remove the files
 * whose delete_after has passed (exports after 7 days, archived maps' originals after 90, COGs of
 * deleted raster layers). Expired exports are only ever removed by this run, so it must be
 * scheduled.
 *
 * --archive    also archive the maps whose notice is older than ARCHIVE_AFTER_NOTICE_DAYS, which
 *              discards their drafts for good. Do not schedule it before P4 delivers inactivity
 *              notices: until then nobody is told, and only writes count as activity, so a map
 *              that is only being read would be archived without warning.
 * --reconcile  also list the orphan files a crash or an interrupted job left in the store (files
 *              with no workspace.files row, older than 24 h). Lists only; deletes nothing.
 * --apply      with --reconcile: delete them. Refused (exit 1, nothing deleted) when
 *              WORKSPACE_FILES_DIR is relative, when workspace.files has no rows, or when the
 *              orphans are more than 50 files or 20 % of the store's files.
 * --force      with --reconcile: lift the 50-file / 20 % guard (the other refusals stay).
 *
 * npm run workspace:cleanup -w @webatlas/api                          (notice + orphan drafts + expired files)
 * npm run workspace:cleanup -w @webatlas/api -- --archive             (also archive; not before P4)
 * npm run workspace:cleanup -w @webatlas/api -- --reconcile           (also list store orphans)
 * npm run workspace:cleanup -w @webatlas/api -- --reconcile --apply   (also delete them)
 */
async function main() {
  let flags: CleanupFlags;
  try {
    flags = parseCleanupArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 2;
    return;
  }
  const pg = getPool();
  const now = new Date();
  const noticed = await markInactive(pg, now);
  const archived = flags.archive ? await archiveNoticed(pg, now) : null;
  const orphans = await discardOrphanDrafts(pg, now);
  // Every run, archive or not: the files are swept after archiving, which only marks originals.
  // Only files a row names (delete_after passed) are removed here.
  const expiredFiles = await deleteExpiredFiles(pg, now);
  const ran = [
    'markInactive', ...(flags.archive ? ['archiveNoticed'] : []), 'discardOrphanDrafts', 'deleteExpiredFiles',
    ...(flags.reconcile ? [flags.apply ? 'reconcileStore (apply)' : 'reconcileStore (dry run)'] : []),
  ];
  console.log(
    `steps run: ${ran.join(', ')}` +
      `${flags.archive ? '' : ' (archiveNoticed skipped: pass --archive to run it)'}` +
      `${flags.reconcile ? '' : ' (reconcileStore skipped: pass --reconcile to list store orphans)'}`
  );
  console.log(
    `marked inactive: ${noticed}; ` +
      `archived: ${archived === null ? 'not run' : archived}; ` +
      `orphan drafts discarded: ${orphans}; ` +
      `expired files removed: ${expiredFiles}`
  );
  if (flags.reconcile) process.exitCode = await runReconcile(pg, now, flags);
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
