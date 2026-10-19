import type { PoolClient } from 'pg';
import { resolvedSql } from './resolve';
import { bumpRevision } from './drafts';
import { ConflictError, NotFoundError } from './errors';

/**
 * Columns that are bookkeeping, not content: two rows with the same external_id are the same
 * feature state when their jsonb minus these keys is equal. Row ids, version, the current flag,
 * audit stamps and the administrative codes (derived from the geometry at activation) differ
 * between a re-ingested row and its predecessor without the feature having changed.
 */
export const CONTENT_EXCLUDED_KEYS = [
  'id', 'dataset_version_id', 'is_current', 'created_at', 'updated_at',
  'created_by', 'updated_by', 'province_codes', 'ward_codes',
] as const;

/** One feature the draft changed that also changed upstream since the draft's parent. */
export interface Conflict {
  externalId: string;
  /** Content at the draft's parent; null when absent there or a tombstone. */
  base: Record<string, unknown> | null;
  /** Content at the active version; null when absent there or a tombstone. */
  current: Record<string, unknown> | null;
  /** The draft's own stored row; `deleted: true` when the draft removes the feature. */
  draft: Record<string, unknown>;
}

export type ConflictChoice = 'mine' | 'theirs';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const EXCLUDED_SQL = `ARRAY[${CONTENT_EXCLUDED_KEYS.map((k) => `'${k}'`).join(', ')}]::text[]`;

function checkLayer(layerKey: string): void {
  if (!IDENTIFIER.test(layerKey)) throw new Error(`"${layerKey}" is not a layer key`);
}

/** `select` for resolvedSql: the external_id as text and the row's content jsonb. */
const CONTENT_SELECT = `external_id::text AS ext, to_jsonb(resolved) - ${EXCLUDED_SQL} AS content`;

/**
 * The external_ids whose content differs between the resolved states of two versions. A feature
 * present on one side only (absent, or a tombstone, on the other) counts as changed.
 */
export async function changedFeatures(
  client: PoolClient, layerKey: string, fromVersionId: string, toVersionId: string
): Promise<Set<string>> {
  checkLayer(layerKey);
  const { rows } = await client.query<{ ext: string }>(
    `SELECT coalesce(a.ext, b.ext) AS ext
       FROM (${resolvedSql(layerKey, CONTENT_SELECT, '$1')}) a
       FULL OUTER JOIN (${resolvedSql(layerKey, CONTENT_SELECT, '$2')}) b ON a.ext = b.ext
      WHERE coalesce(a.ext, b.ext) IS NOT NULL
        AND (a.ext IS NULL OR b.ext IS NULL OR a.content IS DISTINCT FROM b.content)`,
    [fromVersionId, toVersionId]
  );
  return new Set(rows.map((r) => r.ext));
}

/** The external_ids the draft stores a row for (edits, creations and tombstones). */
export async function touchedFeatures(client: PoolClient, layerKey: string, draftId: string): Promise<Set<string>> {
  checkLayer(layerKey);
  const { rows } = await client.query<{ ext: string }>(
    `SELECT DISTINCT external_id::text AS ext FROM water.${layerKey}
      WHERE dataset_version_id = $1 AND external_id IS NOT NULL`,
    [draftId]
  );
  return new Set(rows.map((r) => r.ext));
}

/** The draft's parent and the layer's active version. */
async function versionsOf(
  client: PoolClient, layerKey: string, draftId: string
): Promise<{ parentId: string; activeId: string }> {
  const draft = await client.query<{ parent: string }>(
    `SELECT parent_version_id AS parent FROM app.dataset_versions
      WHERE id = $1 AND layer_key = $2 AND draft_status IS NOT NULL`,
    [draftId, layerKey]
  );
  if (!draft.rows[0]) throw new NotFoundError(`Draft ${draftId} not found for layer ${layerKey}`);
  const active = await client.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`,
    [layerKey]
  );
  if (!active.rows[0]) throw new ConflictError(`no active version for layer ${layerKey}`);
  return { parentId: draft.rows[0].parent, activeId: active.rows[0].id };
}

const byExternalId = new Intl.Collator('en', { numeric: true }).compare;

/**
 * The draft's open conflicts (spec §3): the features it touched whose content changed between
 * its parent and the active version, minus those already resolved against this active version.
 * A resolution made against an earlier active version no longer counts. Ordered by externalId.
 */
export async function listConflicts(client: PoolClient, layerKey: string, draftId: string): Promise<Conflict[]> {
  checkLayer(layerKey);
  const { parentId, activeId } = await versionsOf(client, layerKey, draftId);
  if (parentId === activeId) return [];
  const touched = await touchedFeatures(client, layerKey, draftId);
  if (touched.size === 0) return [];
  const changed = await changedFeatures(client, layerKey, parentId, activeId);
  const done = await client.query<{ external_id: string }>(
    `SELECT external_id FROM app.draft_resolutions WHERE draft_id = $1 AND against_version_id = $2`,
    [draftId, activeId]
  );
  const resolved = new Set(done.rows.map((r) => r.external_id));
  const ids = [...touched].filter((e) => changed.has(e) && !resolved.has(e)).sort(byExternalId);
  if (ids.length === 0) return [];

  type Side = { ext: string; content: Record<string, unknown> };
  const sideAt = async (versionId: string): Promise<Map<string, Record<string, unknown>>> => {
    const { rows } = await client.query<Side>(
      `SELECT ext, content FROM (${resolvedSql(layerKey, CONTENT_SELECT, '$1')}) r WHERE ext = ANY($2::text[])`,
      [versionId, ids]
    );
    return new Map(rows.map((r) => [r.ext, r.content]));
  };
  const base = await sideAt(parentId);
  const current = await sideAt(activeId);
  // The draft's own stored row, read directly: a tombstone is a row here, not an absence.
  const own = await client.query<Side>(
    `SELECT external_id::text AS ext, to_jsonb(t) - ${EXCLUDED_SQL} AS content
       FROM water.${layerKey} t WHERE dataset_version_id = $1 AND external_id::text = ANY($2::text[])`,
    [draftId, ids]
  );
  const draft = new Map(own.rows.map((r) => [r.ext, r.content]));
  return ids.map((externalId) => ({
    externalId,
    base: base.get(externalId) ?? null,
    current: current.get(externalId) ?? null,
    draft: draft.get(externalId)!,
  }));
}

/**
 * Resolve one open conflict. `theirs` drops the draft's row for the feature, so the draft takes
 * the upstream state; `mine` keeps the row and records the choice against the current active
 * version (it lapses if the active version moves again before the rebase). Refuses a feature
 * that is not in the current conflict list.
 *
 * The caller holds the draft lock (lockDraft) in this transaction.
 */
export async function resolveConflict(
  client: PoolClient, layerKey: string, draftId: string, externalId: string, choice: ConflictChoice
): Promise<void> {
  checkLayer(layerKey);
  const open = await listConflicts(client, layerKey, draftId);
  if (!open.some((c) => c.externalId === externalId)) {
    throw new ConflictError(`Feature ${externalId} is not in conflict in draft ${draftId}`);
  }
  if (choice === 'theirs') {
    await client.query(
      `DELETE FROM water.${layerKey} WHERE dataset_version_id = $1 AND external_id::text = $2`,
      [draftId, externalId]
    );
    // A choice recorded against an earlier active version is moot once the row is gone.
    await client.query(
      `DELETE FROM app.draft_resolutions WHERE draft_id = $1 AND external_id = $2`,
      [draftId, externalId]
    );
    return;
  }
  const { activeId } = await versionsOf(client, layerKey, draftId);
  await client.query(
    `INSERT INTO app.draft_resolutions (draft_id, external_id, against_version_id, choice)
     VALUES ($1, $2, $3, 'mine')
     ON CONFLICT (draft_id, external_id) DO UPDATE
       SET against_version_id = EXCLUDED.against_version_id, choice = EXCLUDED.choice, resolved_at = now()`,
    [draftId, externalId, activeId]
  );
}

/**
 * Move the draft onto the layer's active version, feature by feature (spec §3). Nothing to do
 * when its parent is already active. With open conflicts nothing changes and they are returned.
 * Otherwise the draft is re-parented: its stored rows now sit on the active state, its
 * resolutions (made against the old parent) are dropped and its revision is bumped.
 *
 * The caller holds the draft lock (lockDraft) in this transaction. The active row is not locked
 * here: a concurrent activation can still move it, which publishDraft guards against.
 */
export async function rebaseDraft(
  client: PoolClient, layerKey: string, draftId: string
): Promise<{ rebased: boolean; conflicts: Conflict[] }> {
  checkLayer(layerKey);
  const { parentId, activeId } = await versionsOf(client, layerKey, draftId);
  if (parentId === activeId) return { rebased: false, conflicts: [] };
  const conflicts = await listConflicts(client, layerKey, draftId);
  if (conflicts.length > 0) return { rebased: false, conflicts };
  await client.query(`UPDATE app.dataset_versions SET parent_version_id = $1 WHERE id = $2`, [activeId, draftId]);
  await client.query(`DELETE FROM app.draft_resolutions WHERE draft_id = $1`, [draftId]);
  await bumpRevision(client, draftId);
  return { rebased: true, conflicts: [] };
}
