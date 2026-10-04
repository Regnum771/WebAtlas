import type { PoolClient } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';
import { resolvedSql } from './resolve';

/**
 * Move the layer's current flag to the rows `versionId` resolves to. Called by activate() only,
 * after the active pointer has moved and in the same transaction, so readers in other
 * transactions see the old state or the new one, never a mix.
 *
 * Diff-only: two statements, each writing just the rows whose flag actually changes. Re-activating
 * content that resolves to the same rows therefore rewrites nothing (an UPDATE rewrites the row and
 * every index entry, including the partial `WHERE is_current` indexes). The end state is identical
 * to "clear everything, then set the resolved rows"; `resolvedSql` stays the single definition of
 * the resolved set.
 */
export async function refreshCurrentRows(client: PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<void> {
  await client.query(
    `UPDATE water.${layerKey} t SET is_current = false
     WHERE t.is_current AND NOT EXISTS (SELECT 1 FROM (${resolvedSql(layerKey)}) r WHERE r.id = t.id)`,
    [versionId]
  );
  await client.query(
    `UPDATE water.${layerKey} SET is_current = true WHERE NOT is_current AND id IN (${resolvedSql(layerKey)})`,
    [versionId]
  );
}
