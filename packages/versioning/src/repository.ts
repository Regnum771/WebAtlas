import type { Pool } from 'pg';
import { resolvedSql } from './resolve';

export interface DatasetVersion {
  id: string;
  layerKey: string;
  kind: 'ingest' | 'edit';
  parentVersionId: string | null;
  isActive: boolean;
  featureCount: number | null;
  label: string;
  source: string;
}

function rowToVersion(r: Record<string, unknown>): DatasetVersion {
  return {
    id: r.id as string,
    layerKey: r.layer_key as string,
    kind: r.kind as 'ingest' | 'edit',
    parentVersionId: (r.parent_version_id as string | null) ?? null,
    isActive: r.is_active as boolean,
    featureCount: (r.feature_count as number | null) ?? null,
    label: r.label as string,
    source: r.source as string,
  };
}

export function versionsRepository(pg: Pool) {
  const repo = {
    async getVersion(id: string): Promise<DatasetVersion | null> {
      const { rows } = await pg.query(`SELECT * FROM app.dataset_versions WHERE id = $1`, [id]);
      return rows[0] ? rowToVersion(rows[0]) : null;
    },

    async getActiveVersionId(layerKey: string): Promise<string | null> {
      const { rows } = await pg.query(
        `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active`,
        [layerKey]
      );
      return rows[0]?.id ?? null;
    },

    // An unknown version resolves to no features rather than to every feature.
    async resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      const { rows } = await pg.query(resolvedSql(layerKey), [versionId]);
      return rows.map((r) => r.id as string);
    },
  };
  return repo;
}

export type VersionsRepository = ReturnType<typeof versionsRepository>;
