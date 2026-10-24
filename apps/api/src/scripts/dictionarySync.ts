import { getPool, closePool } from '../db/pool';
import { runSync } from '../modules/dictionary/sync';

/*
 * Syncs the code data dictionary (packages/shared/src/dictionary) into app.dictionary_* (spec
 * §2.1). Runs after migrate:up; atlas:up calls it. New entries are inserted, locked fields and
 * unedited fields follow the code, staff edits are kept unless the code no longer allows them
 * (then reverted, with history), and entries removed from code are retired. A second run in a row
 * changes nothing.
 *
 * --dry-run   do everything in a transaction that is rolled back, and print what a real run would do.
 *
 * npm run dictionary:sync -w @webatlas/api
 * npm run dictionary:sync -w @webatlas/api -- --dry-run
 */
const USAGE = 'usage: npm run dictionary:sync -w @webatlas/api [-- --dry-run]';

async function main() {
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') dryRun = true;
    else {
      console.error(`unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
  }
  const r = await runSync(getPool(), { dryRun });
  console.log(
    `${dryRun ? 'dry run (nothing written): ' : ''}` +
      `added: ${r.added}; updated: ${r.updated}; retired: ${r.retired}; edits reverted: ${r.reverted}`
  );
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
