import { getPool, closePool } from '../db/pool';
import { archiveNoticed, discardOrphanDrafts, markInactive } from '../modules/workspace/cleanup';

/*
 * Run periodically: notice inactive personal maps and discard orphan drafts.
 *
 * --archive  also archive the maps whose notice is older than ARCHIVE_AFTER_NOTICE_DAYS, which
 *            discards their drafts for good. Do not schedule it before P4 delivers inactivity
 *            notices: until then nobody is told, and only writes count as activity, so a map
 *            that is only being read would be archived without warning.
 *
 * npm run workspace:cleanup -w @webatlas/api               (notice + orphan drafts)
 * npm run workspace:cleanup -w @webatlas/api -- --archive  (also archive; not before P4)
 */
async function main() {
  const archive = process.argv.slice(2).includes('--archive');
  const pg = getPool();
  const now = new Date();
  const noticed = await markInactive(pg, now);
  const archived = archive ? await archiveNoticed(pg, now) : null;
  const orphans = await discardOrphanDrafts(pg, now);
  const ran = ['markInactive', ...(archive ? ['archiveNoticed'] : []), 'discardOrphanDrafts'];
  console.log(`steps run: ${ran.join(', ')}${archive ? '' : ' (archiveNoticed skipped: pass --archive to run it)'}`);
  console.log(
    `marked inactive: ${noticed}; ` +
      `archived: ${archived === null ? 'not run' : archived}; ` +
      `orphan drafts discarded: ${orphans}`
  );
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
