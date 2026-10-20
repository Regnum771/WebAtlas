import type { Pool, PoolClient } from 'pg';
import { bumpRevision, discardDraft, lockDraft, openDraft } from '@webatlas/versioning';
import type { UnitTree } from '@webatlas/shared';
import { getLayer, type LayerDef } from '../../layers/registry';
import { NotFoundError } from '../../errors';
import { inTransaction } from '../../lib/transaction';
import type { CurrentUser } from '../../types/fastify';
import type { FeatureRow } from './repository';
import {
  createInDraft, removeInDraft, updateInDraft, type FeatureInput, type FeatureWarning,
} from './draftOps';

export interface DraftOpOptions {
  /** The revision the caller last saw; the operation is refused (DRAFT_CHANGED) if it moved. */
  expectedRevision?: number;
}

export interface DraftEditResult { feature: FeatureRow; warnings: FeatureWarning[]; revision: number }

/**
 * Durable drafts: every call is its own short transaction, so a draft outlives the request that
 * edits it and a failed operation loses nothing but itself. Only the draft's owner reaches it
 * (anyone else gets 404, like a draft that does not exist), only a `personal` draft is edited,
 * and no operation checks jurisdiction: that happens when the draft is published.
 */
export function draftEditor(pg: Pool) {
  /**
   * Lock the actor's personal draft of layer `key` (refusing a stale `expectedRevision`), run
   * the operation, and record it as a new revision, all in one transaction.
   */
  async function editDraft<T>(
    key: string, draftId: string, actor: CurrentUser, opts: DraftOpOptions,
    op: (client: PoolClient, def: LayerDef) => Promise<T>
  ): Promise<{ out: T; revision: number }> {
    const def = getLayer(key);
    return inTransaction(pg, async (client) => {
      const draft = await lockDraft(client, draftId, {
        ownerId: actor.id, expectedRevision: opts.expectedRevision, requireStatus: 'personal',
      });
      if (draft.layerKey !== def.key) throw new NotFoundError(`Draft ${draftId} not found`);
      const out = await op(client, def);
      const revision = await bumpRevision(client, draftId);
      return { out, revision };
    });
  }

  return {
    /** Open a personal draft of layer `key`, owned by `actor`, on the layer's active version. */
    async open(key: string, actor: CurrentUser): Promise<{ draftId: string; revision: number }> {
      const def = getLayer(key);
      const draft = await inTransaction(pg, (client) => openDraft(client, def.key, actor.id));
      return { draftId: draft.id, revision: draft.revision };
    },

    async create(
      key: string, draftId: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree, opts: DraftOpOptions = {}
    ): Promise<DraftEditResult> {
      const { out, revision } = await editDraft(key, draftId, actor, opts,
        (client, def) => createInDraft(client, def, draftId, input, actor.id, tree));
      return { ...out, revision };
    },

    async update(
      key: string, draftId: string, id: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree,
      opts: DraftOpOptions = {}
    ): Promise<DraftEditResult> {
      const { out, revision } = await editDraft(key, draftId, actor, opts,
        (client, def) => updateInDraft(client, def, draftId, id, input, actor.id, tree));
      return { ...out, revision };
    },

    async remove(
      key: string, draftId: string, id: string, actor: CurrentUser, opts: DraftOpOptions = {}
    ): Promise<{ revision: number }> {
      const { revision } = await editDraft(key, draftId, actor, opts,
        (client, def) => removeInDraft(client, def, draftId, id, actor.id));
      return { revision };
    },

    /** Delete the actor's personal draft and its rows. The audit rows of its edits stay. */
    async discard(key: string, draftId: string, actor: CurrentUser): Promise<void> {
      const def = getLayer(key);
      await inTransaction(pg, async (client) => {
        const draft = await lockDraft(client, draftId, { ownerId: actor.id, requireStatus: 'personal' });
        if (draft.layerKey !== def.key) throw new NotFoundError(`Draft ${draftId} not found`);
        await discardDraft(client, draftId);
      });
    },
  };
}

export type DraftEditor = ReturnType<typeof draftEditor>;
