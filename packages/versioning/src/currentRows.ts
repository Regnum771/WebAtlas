import type { PoolClient } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';
import { resolvedSql } from './resolve';

/**
 * Move the layer's current flag to the rows `versionId` resolves to. Called by activate() only,
 * after the active pointer has moved and in the same transaction, so readers in other
 * transactions see the old state or the new one, never a mix.
 */
export async function refreshCurrentRows(client: PoolClient, layerKey: EditableLayerKey, versionId: string): Promise<void> {
  await client.query(`UPDATE water.${layerKey} SET is_current = false WHERE is_current`);
  await client.query(`UPDATE water.${layerKey} SET is_current = true WHERE id IN (${resolvedSql(layerKey)})`, [versionId]);
}
