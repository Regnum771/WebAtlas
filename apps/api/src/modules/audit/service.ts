import type { Pool } from 'pg';

export function auditService(pg: Pool) {
  return {
    async record(entry: {
      userId?: string; action: 'create' | 'update' | 'delete';
      tableName: string; featureId?: string | null; before?: unknown; after?: unknown;
    }): Promise<void> {
      await pg.query(
        `INSERT INTO app.audit_log (user_id, action, table_name, feature_id, before, after)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.userId ?? null, entry.action, entry.tableName, entry.featureId ?? null,
         entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null]
      );
    },
  };
}
