import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { ResolvedLoad } from './stages/loadGeojson';

export type LegacyAdoption =
  /** The active chain already rests on this content, loaded with this mapping revision. */
  | { result: 'current'; versionId: string }
  | { result: 'relabelled'; versionId: string }
  | { result: 'mismatch'; detail: string };

/** The mapping revision in force when the old seed command existed: only it can be assumed of an unlabelled load. */
const FIRST_MAPPING = 'mapping-1';

function featureCount(path: string): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { features: unknown[] }).features.length;
}

/**
 * Decide whether the layer's active chain already rests on this load, and if it does so under an
 * older label, give it the current one (spec §11, C-1). A version's identity is the content of its
 * files (`source`) plus the revision of the column mapping that loaded it (`source_version`).
 *
 * Re-labelled, never reloaded:
 * - a version the old seed command loaded: its source is the descriptor's `legacySource`;
 * - a version loaded from this content before mapping revisions were recorded.
 * Both only while the descriptor is still at its first mapping revision (what an unlabelled load
 * must have used), and only when the version holds exactly the files' features. The rows compared
 * are the loaded ones: for rivers that excludes the level-1 rivers the hierarchy derives.
 *
 * On the caller's client, inside the caller's transaction.
 */
export async function adoptLegacySource(client: PoolClient, load: ResolvedLoad): Promise<LegacyAdoption> {
  // The root of the active chain: the ingest every edit on top of it inherits from.
  const { rows } = await client.query<{ id: string; kind: string; source: string; source_version: string | null }>(
    `WITH RECURSIVE chain AS (
       SELECT id, kind, source, source_version, parent_version_id, 0 AS depth
         FROM app.dataset_versions WHERE layer_key = $1 AND is_active
       UNION ALL
       SELECT v.id, v.kind, v.source, v.source_version, v.parent_version_id, c.depth + 1
         FROM app.dataset_versions v JOIN chain c ON v.id = c.parent_version_id
     )
     SELECT id, kind, source, source_version FROM chain ORDER BY depth DESC LIMIT 1`,
    [load.layer]
  );
  const root = rows[0];
  if (!root) return { result: 'mismatch', detail: `${load.layer} has no active version` };
  if (root.kind === 'ingest' && root.source === load.source && root.source_version === load.mapping) {
    return { result: 'current', versionId: root.id };
  }

  const sameContent = root.source === load.source;
  const unlabelled = sameContent ? root.source_version === null : root.source === load.legacySource;
  if (root.kind !== 'ingest' || !unlabelled || load.mapping !== FIRST_MAPPING) {
    const detail = sameContent
      ? `${load.layer}: the active load used ${root.source_version ?? 'an unrecorded mapping'}, the descriptor is at ${load.mapping}`
      : `${load.layer}: the active load's source is "${root.source}", ` +
        (load.legacySource === undefined ? 'and the descriptor declares no legacySource' : `not "${load.legacySource}"`);
    return { result: 'mismatch', detail };
  }

  const want = load.files.reduce((n, f) => n + featureCount(f.path), 0);
  const derived = load.layer === 'rivers' ? ' AND feature_level <> 1' : '';
  const have = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM water.${load.layer} WHERE dataset_version_id = $1${derived}`,
    [root.id]
  );
  if (have.rows[0].n !== want) {
    return {
      result: 'mismatch',
      detail: `${load.layer}: the active load holds ${have.rows[0].n} rows, the files hold ${want} features`,
    };
  }
  await client.query(`UPDATE app.dataset_versions SET source = $1, source_version = $2 WHERE id = $3`, [
    load.source,
    load.mapping,
    root.id,
  ]);
  return { result: 'relabelled', versionId: root.id };
}
