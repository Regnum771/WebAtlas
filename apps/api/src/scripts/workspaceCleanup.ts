import { getPool, closePool } from '../db/pool';
import {
  archiveNoticed, deleteExpiredFiles, discardOrphanDrafts, markInactive, reconcileStore,
} from '../modules/workspace/cleanup';

/*
 * Run periodically: notice inactive personal maps, discard orphan drafts, remove the files whose
 * delete_after has passed (exports after 7 days, archived maps' originals after 90, COGs of
 * deleted raster layers) and the orphan files a crash or an interrupted job left in the store.
 *
 * --archive  also archive the maps whose notice is older than ARCHIVE_AFTER_NOTICE_DAYS, which
 *            discards their drafts for good. Do not schedule it before P4 delivers inactivity
 *            notices: until then nobody is told, and only writes count as activity, so a map
 *            that is only being read would be archived without warning.
 *
 * npm run workspace:cleanup -w @webatlas/api               (notice + orphan drafts + files)
 * npm run workspace:cleanup -w @webatlas/api -- --archive  (also archive; not before P4)
 */
async function main() {
  const archive = process.argv.slice(2).includes('--archive');
  const pg = getPool();
  const now = new Date();
  const noticed = await markInactive(pg, now);
  const archived = archive ? await archiveNoticed(pg, now) : null;
  const orphans = await discardOrphanDrafts(pg, now);
  // Every run, archive or not: the files are swept after archiving, which only marks originals.
  const expiredFiles = await deleteExpiredFiles(pg, now);
  const store = await reconcileStore(pg, now);
  const ran = [
    'markInactive', ...(archive ? ['archiveNoticed'] : []), 'discardOrphanDrafts', 'deleteExpiredFiles', 'reconcileStore',
  ];
  console.log(`steps run: ${ran.join(', ')}${archive ? '' : ' (archiveNoticed skipped: pass --archive to run it)'}`);
  console.log(
    `marked inactive: ${noticed}; ` +
      `archived: ${archived === null ? 'not run' : archived}; ` +
      `orphan drafts discarded: ${orphans}; ` +
      `expired files removed: ${expiredFiles}; ` +
      `orphan store files removed: ${store.removed}`
  );
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
