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

/** Copy for a resolution made against an active version that has since been replaced. */
export const STALE_RESOLUTION_MESSAGE = 'Dữ liệu đã xuất bản lại thay đổi; hãy xem lại xung đột.';

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

/**
 * changedFeatures restricted to `ids`. The filter sits on each resolved side, where the planner
 * pushes it below DISTINCT ON, so only those features are resolved and turned into jsonb: a
 * full side of rivers costs seconds, and this runs inside the publish transaction.
 */
async function changedAmong(
  client: PoolClient, layerKey: string, fromVersionId: string, toVersionId: string, ids: string[]
): Promise<Set<string>> {
  const side = (param: string) =>
    `SELECT * FROM (${resolvedSql(layerKey, CONTENT_SELECT, param)}) s WHERE ext = ANY($3::text[])`;
  const { rows } = await client.query<{ ext: string }>(
    `SELECT coalesce(a.ext, b.ext) AS ext
       FROM (${side('$1')}) a
       FULL OUTER JOIN (${side('$2')}) b ON a.ext = b.ext
      WHERE a.ext IS NULL OR b.ext IS NULL OR a.content IS DISTINCT FROM b.content`,
    [fromVersionId, toVersionId, ids]
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

/**
 * The draft's parent and the layer's active version. Read once per public call: the conflict
 * check and the write after it must see the same pair, or a rebase could re-parent onto a
 * version its check never compared against.
 */
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
 * The draft's open conflicts between the given parent and active version (spec §3): the
 * features it touched whose content changed between the two, minus those already resolved
 * against this active version. Ordered by externalId.
 */
async function conflictsAt(
  client: PoolClient, layerKey: string, draftId: string, parentId: string, activeId: string
): Promise<Conflict[]> {
  if (parentId === activeId) return [];
  const touched = [...(await touchedFeatures(client, layerKey, draftId))];
  if (touched.length === 0) return [];
  const changed = await changedAmong(client, layerKey, parentId, activeId, touched);
  const done = await client.query<{ external_id: string }>(
    `SELECT external_id FROM app.draft_resolutions WHERE draft_id = $1 AND against_version_id = $2`,
    [draftId, activeId]
  );
  const resolved = new Set(done.rows.map((r) => r.external_id));
  const ids = touched.filter((e) => changed.has(e) && !resolved.has(e)).sort(byExternalId);
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
 * The draft's open conflicts against the layer's active version, and which version that is. A
 * caller resolving them passes `activeId` back to resolveConflict, so a choice is never recorded
 * against a version the user did not see.
 */
export async function listConflicts(
  client: PoolClient, layerKey: string, draftId: string
): Promise<{ activeId: string; conflicts: Conflict[] }> {
  checkLayer(layerKey);
  const { parentId, activeId } = await versionsOf(client, layerKey, draftId);
  return { activeId, conflicts: await conflictsAt(client, layerKey, draftId, parentId, activeId) };
}

/**
 * Resolve one open conflict as seen against `againstVersionId` (the activeId listConflicts
 * returned). Refused when that is no longer the active version, or when the feature is not in
 * the current conflict list. `theirs` drops the draft's row for the feature, so the draft takes
 * the upstream state; `mine` keeps the row and records the choice against `againstVersionId`
 * (it lapses if the active version moves again before the rebase). Either way the draft
 * changed, so its revision is bumped.
 *
 * The caller holds the draft lock (lockDraft) in this transaction.
 */
export async function resolveConflict(
  client: PoolClient, layerKey: string, draftId: string, externalId: string, choice: ConflictChoice,
  againstVersionId: string
): Promise<void> {
  checkLayer(layerKey);
  const { parentId, activeId } = await versionsOf(client, layerKey, draftId);
  if (againstVersionId !== activeId) throw new ConflictError(STALE_RESOLUTION_MESSAGE);
  const open = await conflictsAt(client, layerKey, draftId, parentId, activeId);
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
  } else {
    await client.query(
      `INSERT INTO app.draft_resolutions (draft_id, external_id, against_version_id, choice)
       VALUES ($1, $2, $3, 'mine')
       ON CONFLICT (draft_id, external_id) DO UPDATE
         SET against_version_id = EXCLUDED.against_version_id, choice = EXCLUDED.choice, resolved_at = now()`,
      [draftId, externalId, againstVersionId]
    );
  }
  await bumpRevision(client, draftId);
}

/**
 * Move the draft onto the layer's active version, feature by feature (spec §3). Nothing to do
 * when its parent is already active. With open conflicts nothing changes and they are returned.
 * Otherwise the draft is re-parented onto the very active version its conflict check compared
 * against: its stored rows now sit on that state, its resolutions are dropped and its revision
 * is bumped. `activeId` is that version in every case.
 *
 * The caller holds the draft lock (lockDraft) in this transaction. The active row is not locked
 * here: a concurrent activation can still move it, which publishDraft guards against.
 */
export async function rebaseDraft(
  client: PoolClient, layerKey: string, draftId: string
): Promise<{ rebased: boolean; activeId: string; conflicts: Conflict[] }> {
  checkLayer(layerKey);
  const { parentId, activeId } = await versionsOf(client, layerKey, draftId);
  if (parentId === activeId) return { rebased: false, activeId, conflicts: [] };
  const conflicts = await conflictsAt(client, layerKey, draftId, parentId, activeId);
  if (conflicts.length > 0) return { rebased: false, activeId, conflicts };
  await client.query(`UPDATE app.dataset_versions SET parent_version_id = $1 WHERE id = $2`, [activeId, draftId]);
  await client.query(`DELETE FROM app.draft_resolutions WHERE draft_id = $1`, [draftId]);
  await bumpRevision(client, draftId);
  return { rebased: true, activeId, conflicts: [] };
}
