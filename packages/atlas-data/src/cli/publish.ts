import pg from 'pg';
import { loadDevEnv } from './env';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { parseBuildArgs } from './args';
import { applyCompose } from './composeFlag';
import { selectDatasets } from './select';
import { BuildLockedError, withBuildLock } from '../buildLock';
import { executeStage } from '../stages';
import { publishStages } from '../publishStages';

/**
 * atlas:publish [--only a,b] [--except c] [--compose file]
 *
 * Re-runs only the GeoServer publish stages of the selected datasets, e.g. after GeoServer was
 * replaced by GeoNode's. Data and recorded build state are left alone: atlas:status cannot see a
 * GeoServer that lost its configuration, so atlas:build would skip these stages.
 */
async function main(): Promise<void> {
  const envFile = loadDevEnv();
  if (envFile) console.log(`(environment from ${envFile})`);
  validateRegistry();

  let datasets = ALL_DATASETS;
  try {
    const args = parseBuildArgs(applyCompose(process.argv.slice(2), 'atlas:publish').rest);
    if (args.force.length > 0 || args.supersedeEdits.length > 0) {
      throw new Error('atlas:publish takes --only/--except only: it never loads data');
    }
    datasets = selectDatasets(ALL_DATASETS, { only: args.only, except: args.except }).selected;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString, keepAlive: true });
  let failed = 0;
  try {
    await withBuildLock(pool, 'atlas:publish', async () => {
      for (const dataset of datasets) {
        for (const stage of publishStages(dataset)) {
          const ctx = { datasetId: dataset.id, forced: false, supersedeEdits: false, log: (l: string) => console.log(l) };
          try {
            const { summary } = await executeStage(pool, stage, ctx);
            console.log(`ok      ${dataset.id}: ${summary}`);
          } catch (err) {
            failed += 1;
            console.error(`failed  ${dataset.id}: ${err instanceof Error ? err.message : String(err)}`);
            break;
          }
        }
      }
    });
  } catch (err) {
    if (!(err instanceof BuildLockedError)) throw err;
    console.error(err.message);
    failed += 1;
  } finally {
    await pool.end();
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
