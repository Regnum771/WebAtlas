import type { PoolClient } from 'pg';
import { COUNTRY_UNIT, type Permission, type UnitTree } from '@webatlas/shared';
import type { LayerDef } from '../../layers/registry';
import { assertCan } from '../../authz/assert';
import type { CurrentUser } from '../../types/fastify';
import { assertKnownUnit } from './draftOps';

/** Who is writing, and the unit tree their grants are resolved against. */
export interface Access { user: CurrentUser; tree: UnitTree }

/**
 * Publishing makes a change live, so until submissions exist (P4) it needs the operation's
 * permission AND submission.review on the unit. The unit must be one the tree knows.
 */
function authorize(access: Access, permission: Permission, unit: string): void {
  assertKnownUnit(access.tree, unit);
  assertCan(access.user, permission, unit, access.tree);
  assertCan(access.user, 'submission.review', unit, access.tree);
}

const byExternalId = new Intl.Collator('en', { numeric: true }).compare;

/**
 * The publish guard: may `access` make every row of the draft live? Runs inside publishDraft,
 * after the rebase, so the draft's parent is the active version and `is_current` marks the state
 * each change lands on. Every stored row of the draft is read, not only the touched external_ids,
 * so no row goes live unchecked. Per row (spec section 3):
 * - no external_id: it cannot be matched to a published feature, so it fails closed, checked as
 *   an update on VN and on the row's own unit;
 * - no current row, and the draft's row is not a tombstone: a create, checked on the draft
 *   row's unit;
 * - the draft's row is a tombstone and there is a current row: a delete, checked on the current
 *   unit; a tombstone with no current row (created and deleted inside the draft) changes nothing
 *   published and is skipped;
 * - otherwise an update, checked on the current unit, and also on the draft row's unit when the
 *   change moves the feature to another unit.
 * A unit that is missing counts as national (VN), the strictest reading. The first refusal throws
 * (NO_PERMISSION or OUT_OF_JURISDICTION, as in P1), so a draft goes live whole or not at all.
 * Admin bypasses.
 */
export async function assertDraftPublishable(
  client: PoolClient, def: LayerDef, draftId: string, access: Access
): Promise<void> {
  if (access.user.isAdmin) return;
  const { rows } = await client.query<{
    ext: string | null; deleted: boolean; draft_unit: string | null; has_current: boolean;
    current_unit: string | null;
  }>(
    `SELECT d.external_id::text AS ext, d.deleted, d.managing_unit AS draft_unit,
            c.id IS NOT NULL AS has_current, c.managing_unit AS current_unit
       FROM ${def.table} d
       LEFT JOIN ${def.table} c ON c.external_id = d.external_id AND c.is_current
      WHERE d.dataset_version_id = $1`,
    [draftId]
  );
  // A stable order, so the same draft is always refused with the same error: rows without an
  // external_id first, then by external_id.
  rows.sort((a, b) => (a.ext === null ? (b.ext === null ? 0 : -1) : b.ext === null ? 1 : byExternalId(a.ext, b.ext)));
  for (const r of rows) {
    const current = r.current_unit ?? COUNTRY_UNIT;
    const next = r.draft_unit ?? COUNTRY_UNIT;
    if (r.ext === null) {
      authorize(access, 'feature.update', COUNTRY_UNIT);
      if (next !== COUNTRY_UNIT) authorize(access, 'feature.update', next);
      continue;
    }
    // Created and deleted again inside the draft: nothing published changes, so nothing to check.
    if (!r.has_current && r.deleted) continue;
    if (!r.has_current) {
      authorize(access, 'feature.create', next);
    } else if (r.deleted) {
      authorize(access, 'feature.delete', current);
    } else {
      authorize(access, 'feature.update', current);
      if (next !== current) authorize(access, 'feature.update', next);
    }
  }
}
