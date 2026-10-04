import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { Stage } from './types';
import type { ResolvedLoad } from './stages/loadGeojson';

type LoadStage = Extract<Stage, { type: 'load-geojson' }>;

export type LegacyAdoption =
  /** The active chain already rests on this content. */
  | { result: 'current' }
  | { result: 'relabelled'; versionId: string }
  | { result: 'mismatch'; detail: string };

function featureCount(path: string): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { features: unknown[] }).features.length;
}

/**
 * Give the layer's existing ingest version the content-derived `source` (spec §11, C-1), so the
 * first build after adoption finds its content already loaded instead of loading it again.
 *
 * Only when that version is what the old seed command loaded from these same files: its source is
 * the descriptor's `legacySource`, and it holds exactly the files' features. The rows compared are
 * the loaded ones: for rivers that excludes the level-1 rivers the hierarchy derives.
 *
 * On the caller's client, inside the caller's transaction.
 */
export async function adoptLegacySource(
  client: PoolClient,
  stage: LoadStage,
  load: ResolvedLoad
): Promise<LegacyAdoption> {
  // The root of the active chain: the ingest every edit on top of it inherits from.
  const { rows } = await client.query<{ id: string; kind: string; source: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, kind, source, parent_version_id, 0 AS depth
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       UNION ALL
       SELECT v.id, v.kind, v.source, v.parent_version_id, c.depth + 1
         FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
     )
     SELECT id, kind, source FROM chain ORDER BY depth DESC LIMIT 1`,
    [stage.layer]
  );
  const root = rows[0];
  if (!root) return { result: 'mismatch', detail: `${stage.layer} has no active version` };
  if (root.kind === 'ingest' && root.source === load.source) return { result: 'current' };
  if (root.kind !== 'ingest' || stage.legacySource === undefined || root.source !== stage.legacySource) {
    const expected = stage.legacySource === undefined ? 'and the descriptor declares no legacySource' : `not "${stage.legacySource}"`;
    return { result: 'mismatch', detail: `${stage.layer}: the active load's source is "${root.source}", ${expected}` };
  }

  const want = load.files.reduce((n, f) => n + featureCount(f.path), 0);
  const derived = stage.layer === 'rivers' ? ' AND feature_level <> 1' : '';
  const have = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.${stage.layer} WHERE dataset_version_id = $1${derived}`,
    [root.id]
  );
  if (have.rows[0].n !== want) {
    return {
      result: 'mismatch',
      detail: `${stage.layer}: the active load holds ${have.rows[0].n} rows, the files hold ${want} features`,
    };
  }
  await client.query(`UPDATE app.dataset_versions SET source = $1 WHERE id = $2`, [load.source, root.id]);
  return { result: 'relabelled', versionId: root.id };
}
