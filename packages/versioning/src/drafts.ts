import type { PoolClient } from 'pg';
import { ConflictError, DraftNotEditableError, DraftRevisionError, NotFoundError } from './errors';

export type DraftStatus = 'personal' | 'submitted' | 'returned';

export interface DraftRow {
  id: string;
  layerKey: string;
  parentId: string;
  status: DraftStatus;
  revision: number;
  ownerId: string | null;
}

interface RawDraft {
  id: string;
  layer_key: string;
  parent_version_id: string;
  draft_status: DraftStatus;
  revision: number;
  ingested_by: string | null;
}

function toDraft(r: RawDraft): DraftRow {
  return {
    id: r.id,
    layerKey: r.layer_key,
    parentId: r.parent_version_id,
    status: r.draft_status,
    revision: r.revision,
    ownerId: r.ingested_by,
  };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const COLUMNS = `id, layer_key, parent_version_id, draft_status, revision, ingested_by`;

/** Open a personal draft branching off the layer's active version. Runs on the caller's client. */
export async function openDraft(client: PoolClient, layerKey: string, ownerId: string): Promise<DraftRow> {
  const active = await client.query<{ id: string }>(
    `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`,
    [layerKey]
  );
  const parent = active.rows[0]?.id;
  if (!parent) throw new ConflictError(`no active version for layer ${layerKey}`);
  const label = `${new Date().toISOString().slice(0, 10)} nháp`;
  const { rows } = await client.query<RawDraft>(
    `INSERT INTO app.dataset_versions
       (layer_key, kind, parent_version_id, source, label, ingested_by, is_active, draft_status, revision)
     VALUES ($1, 'edit', $2, 'draft', $3, $4, false, 'personal', 0)
     RETURNING ${COLUMNS}`,
    [layerKey, parent, label, ownerId]
  );
  return toDraft(rows[0]);
}

/**
 * Lock a draft row (SELECT ... FOR UPDATE) and check it. Not-found, wrong owner and
 * "not a draft" are indistinguishable on purpose.
 */
export async function lockDraft(
  client: PoolClient,
  draftId: string,
  opts: { ownerId?: string; expectedRevision?: number; requireStatus?: DraftStatus } = {}
): Promise<DraftRow> {
  const { rows } = await client.query<RawDraft>(
    `SELECT ${COLUMNS} FROM app.dataset_versions
     WHERE id = $1 AND draft_status IS NOT NULL FOR UPDATE`,
    [draftId]
  );
  const r = rows[0];
  if (!r || (opts.ownerId !== undefined && r.ingested_by !== opts.ownerId)) {
    throw new NotFoundError(`Draft ${draftId} not found`);
  }
  if (opts.requireStatus !== undefined && r.draft_status !== opts.requireStatus) {
    throw new DraftNotEditableError(`Draft ${draftId} is ${r.draft_status}, expected ${opts.requireStatus}`);
  }
  if (opts.expectedRevision !== undefined && r.revision !== opts.expectedRevision) {
    throw new DraftRevisionError(
      `Draft ${draftId} is at revision ${r.revision}, expected ${opts.expectedRevision}`
    );
  }
  return toDraft(r);
}

/** Record a change to the draft; returns the new revision. */
export async function bumpRevision(client: PoolClient, draftId: string): Promise<number> {
  const { rows } = await client.query<{ revision: number }>(
    `UPDATE app.dataset_versions SET revision = revision + 1, updated_at = now()
     WHERE id = $1 AND draft_status IS NOT NULL RETURNING revision`,
    [draftId]
  );
  if (!rows[0]) throw new NotFoundError(`Draft ${draftId} not found`);
  return rows[0].revision;
}

/** Delete a draft and its stored rows. Refuses anything that is not a draft. */
export async function discardDraft(client: PoolClient, draftId: string): Promise<void> {
  const { rows } = await client.query<{ layer_key: string; draft_status: DraftStatus | null }>(
    `SELECT layer_key, draft_status FROM app.dataset_versions WHERE id = $1 FOR UPDATE`,
    [draftId]
  );
  if (!rows[0]) throw new NotFoundError(`Draft ${draftId} not found`);
  if (!IDENTIFIER.test(rows[0].layer_key)) throw new Error(`invalid layer key ${rows[0].layer_key}`);
  if (rows[0].draft_status === null) {
    throw new ConflictError(`Version ${draftId} is not a draft and cannot be discarded`);
  }
  await client.query(`DELETE FROM water.${rows[0].layer_key} WHERE dataset_version_id = $1`, [draftId]);
  await client.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [draftId]);
}
