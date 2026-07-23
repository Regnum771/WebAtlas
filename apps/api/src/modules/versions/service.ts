import type { Pool, PoolClient } from 'pg';
import { versionsRepository } from './repository';
import { NotFoundError } from '../../errors';

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
