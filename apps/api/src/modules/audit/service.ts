import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

export interface EditSource { document: string; provider: string }

export function auditService(pg: Pool) {
  return {
    async record(entry: {
      userId?: string; action: 'create' | 'update' | 'delete';
      tableName: string; featureId?: string | null; before?: unknown; after?: unknown;
      source?: EditSource;
    }, db: Queryable = pg): Promise<void> {
      // Pass an edit session's client as `db` so the audit row commits or rolls back with the change.
      await db.query(
        `INSERT INTO app.audit_log (user_id, action, table_name, feature_id, before, after, source_document, source_provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [entry.userId ?? null, entry.action, entry.tableName, entry.featureId ?? null,
         entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null,
         entry.source?.document ?? null, entry.source?.provider ?? null]
      );
    },
  };
}
