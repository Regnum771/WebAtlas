import type { Pool } from 'pg';

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

    // Ordered [V, parent, …, root ingest]. Empty if the version does not exist.
    async chainToRoot(versionId: string): Promise<string[]> {
      const { rows } = await pg.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_version_id, 0 AS depth
             FROM app.dataset_versions WHERE id = $1
           UNION ALL
           SELECT v.id, v.parent_version_id, c.depth + 1
             FROM app.dataset_versions v
             JOIN chain c ON v.id = c.parent_version_id
         )
         SELECT id FROM chain ORDER BY depth`,
        [versionId]
      );
      return rows.map((r) => r.id as string);
    },

    // A SQL fragment selecting the effective feature ids for a resolved chain.
    // For a single-element chain (ingest) this is the flat filter; for a longer
    // chain it is nearest-version-wins per external_id with tombstones removed.
    resolvedSql(layerKey: string, chain: string[]): string {
      // An unknown/empty chain resolves to no features rather than to every feature.
      if (chain.length === 0) return `SELECT id FROM water.${layerKey} WHERE false`;
      // chain[0] is nearest (highest priority), last is root ingest.
      const values = chain
        .map((id, i) => `('${id}'::uuid, ${i})`)
        .join(', ');
      // priority: lower number = nearer = wins. The tombstone filter is applied
      // *after* DISTINCT ON picks the nearest row, so a tombstone suppresses the
      // inherited row instead of letting it resurface.
      return `
        SELECT id FROM (
          SELECT DISTINCT ON (t.external_id) t.id, t.deleted
          FROM water.${layerKey} t
          JOIN (VALUES ${values}) AS pri(version_id, priority)
            ON t.dataset_version_id = pri.version_id
          ORDER BY t.external_id, pri.priority
        ) resolved
        WHERE NOT resolved.deleted`;
    },

    async resolveFeatureIds(layerKey: string, versionId: string): Promise<string[]> {
      const chain = await repo.chainToRoot(versionId);
      const { rows } = await pg.query(repo.resolvedSql(layerKey, chain));
      return rows.map((r) => r.id as string);
    },
  };
  return repo;
}

export type VersionsRepository = ReturnType<typeof versionsRepository>;
