import type { Pool, PoolClient } from 'pg';
import { EDITABLE_LAYER_KEYS, type EditableLayerKey } from '@webatlas/shared';
import { versionsRepository } from './repository';
import { stampAdminCodes } from './adminStamp';
import { stampManagingUnits } from './managingUnit';
import { refreshCurrentRows } from './currentRows';
import { pruneVersions } from './retention';
import { buildRiverHierarchy } from './riverHierarchy';
import { assertRiverGates, RIVER_BASELINE } from './riverGates';
import { lockDraft } from './drafts';
import { rebaseDraft } from './rebase';
import { ConflictError, DraftConflictError, NotFoundError, StaleDraftError } from './errors';

/**
 * Lock the layer's active version row (FOR NO KEY UPDATE) and return its id. Waiting on another
 * transaction's activation can end with the locked row no longer active, in which case the
 * statement returns nothing (READ COMMITTED re-checks the row); the next attempt sees and locks
 * the version that replaced it.
 */
async function lockActiveRow(client: PoolClient, layerKey: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active FOR NO KEY UPDATE`,
      [layerKey]
    );
    if (rows[0]) return rows[0].id;
  }
  throw new ConflictError(`no active version for layer ${layerKey}`);
}

export interface IngestVersionArgs {
  layerKey: string;
  source: string;
  sourceVersion?: string | null;
  label?: string;
  ingestedBy?: string | null;
}

export function versionsService(pg: Pool) {
  const repo = versionsRepository(pg);

  const svc = {
    async createIngestVersion(client: PoolClient, args: IngestVersionArgs): Promise<string> {
      // Derive a sequential per-layer label ("version N") when the caller doesn't supply
      // one. Must be the highest label number EVER used for this layer, not a count of
      // surviving rows: counting rows goes backwards whenever an earlier version is
      // deleted (e.g. a prune), so the next created version would reuse a number that
      // was already assigned to a still-existing row, producing duplicate labels — which
      // is exactly the ambiguity this derivation exists to prevent (the timeline scrubber
      // needs distinguishable names). Taking the max is monotonic under deletion: pruning
      // old versions can never cause a later version to reuse a number. Labels that don't
      // match the "version N" shape (e.g. an explicitly-passed "HydroLAKES v10") are
      // ignored by the max, which is correct — they don't participate in the numeric
      // sequence. Computed inside the caller's transaction/client (not the pool) so a
      // concurrent ingest of the same layer can't read a stale value.
      const label = args.label ?? await (async () => {
        const { rows } = await client.query(
          `SELECT coalesce(max(substring(label from '^version ([0-9]+)$')::int), 0) AS n
           FROM app.dataset_versions
           WHERE layer_key = $1 AND kind = 'ingest' AND label ~ '^version [0-9]+$'`,
          [args.layerKey]
        );
        return `version ${rows[0].n + 1}`;
      })();
      const { rows } = await client.query(
        `INSERT INTO app.dataset_versions
           (layer_key, kind, parent_version_id, source, source_version, label, ingested_by, is_active)
         VALUES ($1, 'ingest', NULL, $2, $3, $4, $5, false)
         RETURNING id`,
        [args.layerKey, args.source, args.sourceVersion ?? null, label, args.ingestedBy ?? null]
      );
      return rows[0].id as string;
    },

    // Atomically make versionId the active version for its layer.
    async activate(client: PoolClient, layerKey: string, versionId: string): Promise<void> {
      // The river hierarchy is derived data with an owner, and this is that owner: the one
      // contract every path to "active" passes through -- ingest and edit commit today,
      // and any rollback path added later must come through here too. Leaving it in the ingest script instead is precisely how
      // rivers_overview went stale for two days (see the stamping comment below).
      //
      // BEFORE stampAdminCodes, not after: the rebuild INSERTS new level-1 rows, and
      // stampAdminCodes stamps every row of the version in one UPDATE. Reversed, every
      // rebuilt river ships with empty province_codes and features_in_admin_unit misses it.
      //
      // Gates run before the pointer moves, so a version that fails them is never
      // activated: the caller's transaction rolls back with the version still inactive.
      // The pinned match-rate floor applies to an ingest only (see assertRiverGates).
      if (layerKey === 'rivers') {
        const { rows } = await client.query<{ kind: string }>(
          `SELECT kind FROM app.dataset_versions WHERE id = $1 AND layer_key = $2`,
          [versionId, layerKey]
        );
        // Checked here as well as at the flip below: building against a version that
        // does not exist would resolve an empty chain and fail the gates with a
        // misleading "0 rivers" message instead of a not-found.
        if (!rows[0]) throw new NotFoundError(`Version ${versionId} not found for layer ${layerKey}`);
        await buildRiverHierarchy(client, versionId);
        await assertRiverGates(client, versionId, rows[0].kind === 'ingest' ? RIVER_BASELINE : null);
      }
      // A version cannot become active without its administrative codes (database
      // architecture doc §9): the refresh obligation lives here, in the one contract every
      // path to "active" passes through, not in each call site that happens to remember it.
      // That's exactly how rivers_overview went stale for two days — its refresh sat in a
      // single call site a programmatic caller didn't traverse. Scoped to the thematic
      // layers (EDITABLE_LAYER_KEYS): those are the only water.<layerKey> tables with
      // province_codes/ward_codes columns. Non-thematic layer_key values do occur — this
      // module's own tests activate synthetic keys (e.g. "zz_svc_dams") against no real
      // table on purpose, to exercise app.dataset_versions in isolation — and stamping them
      // would fail loudly against a table that doesn't exist. Runs on the caller's client,
      // inside the caller's transaction, same as every other call in this function.
      if ((EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
        await stampAdminCodes(client, layerKey as EditableLayerKey, versionId);
        // After the codes (the assignment rule reads them) and before refreshCurrentRows, so
        // is_current still marks the previous active state that rows inherit their unit from.
        await stampManagingUnits(client, layerKey as EditableLayerKey, versionId);
      }
      // Clear current active first (so the partial-unique index never sees two), then
      // activate versionId scoped to this layer, verifying it actually matched a row so a
      // nonexistent or cross-layer versionId fails loudly instead of leaving the layer with
      // no active version at all.
      await client.query(
        `UPDATE app.dataset_versions SET is_active = false WHERE layer_key = $1 AND is_active`,
        [layerKey]
      );
      const result = await client.query(
        `UPDATE app.dataset_versions SET is_active = true WHERE id = $1 AND layer_key = $2`,
        [versionId, layerKey]
      );
      if (result.rowCount === 0) {
        throw new NotFoundError(`Version ${versionId} not found for layer ${layerKey}`);
      }
      // The stored answer to "which rows are the map now" (S1). Here, after the pointer moved
      // and in the caller's transaction, because this is the one function every path to
      // "active" goes through. Only the thematic layers have the column.
      if ((EDITABLE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
        await refreshCurrentRows(client, layerKey as EditableLayerKey, versionId);
        // Retention (S1 spec §3), in the same transaction: a failure here rolls the
        // activation back with the previous version still active and still flagged.
        await pruneVersions(client, layerKey as EditableLayerKey);
      }
    },

    /**
     * Publish a draft: bring it onto the layer's active version, let the caller's guard decide
     * whether it may go live, then make it the active version. Everything runs on the caller's
     * client and transaction, so a refusal anywhere (conflicts, the guard, activation's gates)
     * rolls back to the draft as it was, still a draft and with nothing activated.
     *
     * `guard` is required, never optional: it is where the caller's publish authorisation runs.
     * It sees the rebased draft (its parent is the active version) and is still a draft.
     */
    async publishDraft(
      client: PoolClient, layerKey: string, draftId: string, guard: (client: PoolClient) => Promise<void>
    ): Promise<void> {
      // Hold the active row until commit, so no other publish or activation can move the pointer
      // between the rebase below and our own activation.
      const lockedActive = await lockActiveRow(client, layerKey);
      await lockDraft(client, draftId);
      const { activeId, conflicts } = await rebaseDraft(client, layerKey, draftId);
      if (conflicts.length > 0) throw new DraftConflictError(conflicts);
      if (activeId !== lockedActive) {
        // Unreachable while the lock holds; refuse rather than publish onto an unchecked state.
        throw new StaleDraftError(`layer ${layerKey}'s active version moved while draft ${draftId} was being published`);
      }
      await guard(client);
      // No longer a draft BEFORE activation: dataset_versions_draft_shape forbids an active row
      // that still has a draft status, and a CHECK is evaluated per statement.
      await client.query(`UPDATE app.dataset_versions SET draft_status = NULL WHERE id = $1`, [draftId]);
      await svc.activate(client, layerKey, draftId);
      // feature_count for an edit version is the number of rows it stores (the changed
      // features, tombstones included) — not the resolved total, which is inherited.
      // Counted AFTER activate(): for rivers, activate() writes the rows the hierarchy
      // rebuild superseded into this same version, and they are stored rows like any other.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM water.${layerKey} WHERE dataset_version_id = $1`,
        [draftId]
      );
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
        [rows[0].n, draftId]
      );
      // Conflict choices only mean something while the version is a draft.
      await client.query(`DELETE FROM app.draft_resolutions WHERE draft_id = $1`, [draftId]);
    },

    resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      return repo.resolveFeatureIds(layerKey, versionId);
    },
    getActiveVersionId(layerKey: string): Promise<string | null> {
      return repo.getActiveVersionId(layerKey);
    },
    getVersion(id: string) {
      return repo.getVersion(id);
    },
  };
  return svc;
}

export type VersionsService = ReturnType<typeof versionsService>;
