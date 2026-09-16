import pg from 'pg';
import { ALL_DATASETS, validateRegistry } from '../registry';
import { topologicalOrder } from '../graph';
import { stageKey, stageHashPlan, readStageState } from '../state';

async function main(): Promise<void> {
  validateRegistry();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });

  try {
    // D1 deviation from the brief: hashes are now chained stage-to-stage and across
    // datasets (see state.ts stageHashPlan), so recomputing them here with a local
    // upstream-hash walk over stageInputHash would disagree with the runner about what
    // is stale. Using the same shared plan the runner uses guarantees atlas:status and
    // atlas:build agree.
    const ordered = topologicalOrder(ALL_DATASETS);
    const plan = stageHashPlan(ordered);

    for (const d of ordered) {
      const hashes = plan.get(d.id)!;
      const marks: string[] = [];

      for (const [i, stage] of d.stages.entries()) {
        const key = stageKey(i, stage);
        const hash = hashes[i];

        const prior = await readStageState(pool, d.id, key);
        if (!prior) marks.push(`${key}: missing`);
        else if (prior.status !== 'ok') marks.push(`${key}: failed`);
        else if (prior.input_hash !== hash) marks.push(`${key}: stale`);
        else marks.push(`${key}: ok`);
      }

      console.log(`${d.id.padEnd(20)} ${marks.join('  ')}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
