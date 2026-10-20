import { getPool, closePool } from '../db/pool';
import { archiveNoticed, discardOrphanDrafts, markInactive } from '../modules/workspace/cleanup';

// Run periodically: notice inactive personal maps, archive the noticed ones, drop orphan drafts.
async function main() {
  const pg = getPool();
  const now = new Date();
  const noticed = await markInactive(pg, now);
  const archived = await archiveNoticed(pg, now);
  const orphans = await discardOrphanDrafts(pg, now);
  console.log(`marked inactive: ${noticed}; archived: ${archived}; orphan drafts discarded: ${orphans}`);
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
