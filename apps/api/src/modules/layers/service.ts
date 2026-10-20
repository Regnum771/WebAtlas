import type { Pool, PoolClient } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureFilter, type FeatureRow } from './repository';
import { versionsService, openDraft } from '@webatlas/versioning';
import type { UnitTree } from '@webatlas/shared';
import type { CurrentUser } from '../../types/fastify';
import {
  createInDraft, removeInDraft, updateInDraft, type FeatureInput, type FeatureResult,
} from './draftOps';
import { assertDraftPublishable, type Access } from './publishAccess';

export type { FeatureInput, FeatureResult, FeatureWarning } from './draftOps';
export type { Access } from './publishAccess';

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const versions = versionsService(pg);

  /**
   * A direct write: open a draft, apply one operation, publish it and commit, all in one
   * transaction. The publish authorises every feature the draft touches (assertDraftPublishable)
   * and rebases the draft first when the layer moved on meanwhile; a real conflict refuses it
   * (409 STALE_EDIT). Any error rolls the whole transaction back, so no draft is left behind.
   */
  async function directWrite<T>(
    key: string, access: Access, op: (client: PoolClient, def: LayerDef, draftId: string) => Promise<T>
  ): Promise<T> {
    const def = getLayer(key);
    const client = await pg.connect();
    // Set when ROLLBACK itself fails: the connection is then in an unknown state, and releasing
    // it with the error makes the pool destroy it instead of reusing it.
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      const draft = await openDraft(client, def.key, access.user.id);
      // The published version keeps the source and label direct writes have always had, which
      // the version history shows.
      await client.query(
        `UPDATE app.dataset_versions SET source = 'edit session', label = $2 WHERE id = $1`,
        [draft.id, `${new Date().toISOString().slice(0, 10)} edits`]
      );
      const out = await op(client, def, draft.id);
      await versions.publishDraft(
        client, def.key, draft.id, (c) => assertDraftPublishable(c, def, draft.id, access)
      );
      await client.query('COMMIT');
      return out;
    } catch (e) {
      // Also safe after a failed COMMIT: the transaction is already over and this is a no-op.
      try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError as Error; }
      throw e;
    } finally {
      client.release(broken);
    }
  }

  return {
    async list(key: string, filter: FeatureFilter = {}): Promise<FeatureRow[]> {
      return repo.list(getLayer(key), filter);
    },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },

    // Direct writes: each publishes its own edit-version, so no caller writes the active version
    // in place. The actor is required; it owns the draft and is the one authorised at publish.
    async create(key: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree): Promise<FeatureResult> {
      return directWrite(key, { user: actor, tree }, (client, def, draftId) =>
        createInDraft(client, def, draftId, input, actor.id, tree));
    },
    async update(key: string, id: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree): Promise<FeatureResult> {
      return directWrite(key, { user: actor, tree }, (client, def, draftId) =>
        updateInDraft(client, def, draftId, id, input, actor.id, tree));
    },
    async remove(key: string, id: string, actor: CurrentUser, tree: UnitTree): Promise<void> {
      return directWrite(key, { user: actor, tree }, (client, def, draftId) =>
        removeInDraft(client, def, draftId, id, actor.id));
    },
  };
}
