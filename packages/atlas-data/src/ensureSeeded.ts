import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Dataset, Stage } from './types';
import { topologicalOrder } from './graph';
import { ALL_DATASETS } from './registry';
import { adoptLegacySource } from './adoptLegacy';
import { applyLoadGeojson, resolveLoad, type ResolvedLoad } from './stages/loadGeojson';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

export type SeedAction = 'unchanged' | 'relabelled' | 'loaded' | 'replaced';

export interface SeedOutcome {
  id: string;
  action: SeedAction;
  detail: string;
}

const featureCount = (path: string): number =>
  (JSON.parse(readFileSync(path, 'utf8')) as { features: unknown[] }).features.length;

/** A non-versioned load is in place when each target table holds exactly its file's features. */
async function replacedTablesCurrent(pool: Pool, load: ResolvedLoad): Promise<boolean> {
  for (const f of load.files) {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${f.target}`);
    if (rows[0].n !== featureCount(f.path)) return false;
  }
  return true;
}

async function seedOne(pool: Pool, stage: LoadStage): Promise<{ action: SeedAction; detail: string }> {
  const load = resolveLoad(stage);

  if (!stage.versioned && (await replacedTablesCurrent(pool, load))) {
    return { action: 'unchanged', detail: `${stage.layer}: already loaded` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let result: { action: SeedAction; detail: string };
    if (stage.versioned) {
      // First ask whether what is there is already this content: under the content-derived source
      // (nothing to do) or under the old seed command's label (re-label it, load nothing).
      const adoption = await adoptLegacySource(client, stage, load);
      if (adoption.result === 'current') {
        result = { action: 'unchanged', detail: `${stage.layer}: already loaded` };
      } else if (adoption.result === 'relabelled') {
        result = { action: 'relabelled', detail: `${stage.layer}: existing version re-labelled with its content source` };
      } else {
        // Missing, or different content. Never over steward edits: the loader refuses, and the
        // caller sees its message.
        const out = await applyLoadGeojson(pool, client, load, { supersedeEdits: false });
        result = { action: 'loaded', detail: out.summary };
      }
    } else {
      const out = await applyLoadGeojson(pool, client, load, { supersedeEdits: false });
      result = { action: 'replaced', detail: out.summary };
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bring the thematic data to the committed seed content: the boundaries, then every versioned
 * layer. For tests and CI, which need the data but not a build (spec §11, "Test setup").
 *
 * It uses the load-geojson core, so an unchanged file creates no version: a second call, and a
 * second test run, change nothing. It is NOT atlas:build: no stage state, no lineage, no GeoServer.
 * And it never hides steward edits: a layer with edits on top of other content fails here with the
 * loader's message, where `npm run seed` used to load over it.
 */
export async function ensureSeeded(pool: Pool, datasets: Dataset[] = ALL_DATASETS): Promise<SeedOutcome[]> {
  const out: SeedOutcome[] = [];
  for (const d of topologicalOrder(datasets)) {
    for (const stage of d.stages) {
      if (stage.type !== 'load-geojson') continue;
      out.push({ id: d.id, ...(await seedOne(pool, stage)) });
    }
  }
  return out;
}
