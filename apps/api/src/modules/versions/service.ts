import type { Pool, PoolClient } from 'pg';
import { versionsRepository } from './repository';
import { NotFoundError } from '../../errors';

export interface IngestVersionArgs {
  layerKey: string;
  source: string;
  sourceVersion?: string | null;
  label: string;
  ingestedBy?: string | null;
}

export function versionsService(pg: Pool) {
  const repo = versionsRepository(pg);

  const svc = {
    async createIngestVersion(client: PoolClient, args: IngestVersionArgs): Promise<string> {
      const { rows } = await client.query(
        `INSERT INTO app.dataset_versions
           (layer_key, kind, parent_version_id, source, source_version, label, ingested_by, is_active)
         VALUES ($1, 'ingest', NULL, $2, $3, $4, $5, false)
         RETURNING id`,
        [args.layerKey, args.source, args.sourceVersion ?? null, args.label, args.ingestedBy ?? null]
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
