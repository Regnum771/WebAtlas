import type { Pool, PoolClient } from 'pg';
import { versionsRepository } from './repository';
import { ConflictError, NotFoundError } from '../../errors';

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
    },

    // Open a draft edit-version branching off the layer's current active version.
    // The draft is inactive: it holds a steward's in-progress edits and only becomes
    // "the map" when commitEditDraft flips it. All queries run on the caller's client
    // so the draft and the feature rows written into it share one transaction.
    async openEditDraft(client: PoolClient, layerKey: string, actorId?: string | null): Promise<string> {
      const active = await client.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`,
        [layerKey]
      );
      const parent = active.rows[0]?.id;
      // An edit version must branch from something (the kind↔parent check constraint
      // enforces this too); a layer with no active version has no state to edit.
      if (!parent) throw new ConflictError(`no active version for layer ${layerKey}`);
      const label = `${new Date().toISOString().slice(0, 10)} edits`;
      const { rows } = await client.query(
        `INSERT INTO app.dataset_versions
           (layer_key, kind, parent_version_id, source, label, ingested_by, is_active)
         VALUES ($1, 'edit', $2, 'edit session', $3, $4, false)
         RETURNING id`,
        [layerKey, parent, label, actorId ?? null]
      );
      return rows[0].id as string;
    },

    // Publish the draft: record what it stores, then make it the layer's active version.
    async commitEditDraft(client: PoolClient, layerKey: string, draftId: string): Promise<void> {
      // feature_count for an edit version is the number of rows it stores (the changed
      // features, tombstones included) — not the resolved total, which is inherited.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM water.${layerKey} WHERE dataset_version_id = $1`,
        [draftId]
      );
      await client.query(
        `UPDATE app.dataset_versions SET feature_count = $1 WHERE id = $2`,
        [rows[0].n, draftId]
      );
      await svc.activate(client, layerKey, draftId);
    },

    // Throw the draft away: its pending rows first (they reference the version row), then
    // the version itself. The active version never moved, so this leaves no trace.
    async discardEditDraft(client: PoolClient, layerKey: string, draftId: string): Promise<void> {
      await client.query(`DELETE FROM water.${layerKey} WHERE dataset_version_id = $1`, [draftId]);
      await client.query(`DELETE FROM app.dataset_versions WHERE id = $1`, [draftId]);
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
