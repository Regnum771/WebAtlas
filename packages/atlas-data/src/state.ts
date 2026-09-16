import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Stage } from './types';

/**
 * Stable identifier for a stage within its dataset. Position is included because a
 * dataset may legitimately hold two stages of the same type.
 */
export function stageKey(stageIndex: number, stage: Stage): string {
  return `${stageIndex}:${stage.type}`;
}

/**
 * Canonical form for hashing: object keys sorted recursively so key order never
 * affects the hash; arrays keep their order (order inside a stage's config is
 * meaningful); functions become their source text so editing a column mapping
 * invalidates the stage (JSON.stringify would otherwise drop them silently).
 */
function canonical(value: unknown): unknown {
  if (typeof value === 'function') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, canonical(obj[k])])
    );
  }
  return value;
}

/**
 * Hash of everything that should force a rerun: the stage's own configuration plus its
 * upstreams' hashes.
 *
 * Key order is irrelevant: object keys are sorted recursively before hashing, so a
 * cosmetic reorder of a stage's fields does not mark it stale.
 *
 * Upstream order is irrelevant, but the number of upstreams matters: hashes are
 * encoded as a JSON array (after sorting) rather than joined with a separator, so
 * `[]` and `['']` hash differently — "no upstreams" is distinct from "one upstream
 * with no recorded hash".
 *
 * Function-valued fields (load-geojson's `columns`) are serialised via toString() so
 * that editing a column mapping invalidates the stage — including a pure reformat,
 * a known, accepted cost.
 */
export function stageInputHash(stage: Stage, upstreamHashes: string[]): string {
  const payload = JSON.stringify({
    stage: canonical(stage),
    upstream: [...upstreamHashes].sort(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export async function readStageState(
  pool: Pool,
  datasetId: string,
  stage: string
): Promise<{ input_hash: string; status: string } | null> {
  const { rows } = await pool.query<{ input_hash: string; status: string }>(
    `SELECT input_hash, status FROM app.dataset_stage_state
      WHERE dataset_id = $1 AND stage = $2`,
    [datasetId, stage]
  );
  return rows[0] ?? null;
}

export async function writeStageState(
  pool: Pool,
  datasetId: string,
  stage: string,
  inputHash: string,
  status: 'ok' | 'failed'
): Promise<void> {
  await pool.query(
    `INSERT INTO app.dataset_stage_state (dataset_id, stage, input_hash, status, produced_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (dataset_id, stage)
       DO UPDATE SET input_hash = EXCLUDED.input_hash,
                     status     = EXCLUDED.status,
                     produced_at = now()`,
    [datasetId, stage, inputHash, status]
  );
}
