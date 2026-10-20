import type { Pool, PoolClient } from 'pg';
import { getLayer } from '../../layers/registry';
import { featuresRepository, type FeatureFilter, type FeatureRow } from './repository';
import { auditService } from '../audit/service';
import { versionsService, openDraft, StaleDraftError } from '@webatlas/versioning';
import { ConflictError, NotFoundError } from '../../errors';
import type { Permission, UnitTree } from '@webatlas/shared';
import { assertCan } from '../../authz/assert';
import { suggestManagingUnit } from '../admin-units/repository';
import type { CurrentUser } from '../../types/fastify';
import {
  assertKnownUnit, fieldError, placementWarnings, prepare, unitOf,
  type FeatureInput, type FeatureResult, type FeatureWarning,
} from './draftOps';

export type { FeatureInput, FeatureResult, FeatureWarning } from './draftOps';

/** Who is writing, and the unit tree their grants are resolved against. */
export interface Access { user: CurrentUser; tree: UnitTree }

/**
 * Direct publish until P4 (global constraints): every write publishes at once, so it needs the
 * operation's permission AND submission.review on the managing unit.
 */
function authorize(access: Access, permission: Permission, unit: string): void {
  assertCan(access.user, permission, unit, access.tree);
  assertCan(access.user, 'submission.review', unit, access.tree);
}

export type EditSession = Awaited<ReturnType<ReturnType<typeof featuresService>['editSession']>>;

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const audit = auditService(pg);
  const versions = versionsService(pg);

  // ---- Transitional shim: Task 6 (P2) rewrites this service on durable drafts and deletes it ----
  // The session still lives in one transaction and behaves exactly as in P1: it opens a draft
  // and publishes it with a no-op guard. That adds no permission check at publish, and needs
  // none yet: P1's op-time `authorize` checks above still run inside the session, before every
  // write. Two P1 behaviours are kept on purpose until Task 6 replaces them:
  // - the published version keeps P1's source and label ("YYYY-MM-DD edits");
  // - a session whose layer moved on is refused as stale (singleChange retries it once)
  //   instead of being rebased, which publishDraft would otherwise do.
  async function openSessionDraft(client: PoolClient, layerKey: string, actorId?: string): Promise<string> {
    // Internal callers and tests open sessions without an actor; the draft then has no owner,
    // which nothing reads because it is published in the same transaction.
    const draft = await openDraft(client, layerKey, actorId ?? (null as unknown as string));
    await client.query(
      `UPDATE app.dataset_versions SET source = 'edit session', label = $2 WHERE id = $1`,
      [draft.id, `${new Date().toISOString().slice(0, 10)} edits`]
    );
    return draft.id;
  }
  async function publishSessionDraft(client: PoolClient, layerKey: string, draftId: string): Promise<void> {
    // P1's stale check, under the same active-row lock publishDraft takes (re-taking it there
    // is a no-op in this transaction).
    const active = await client.query<{ id: string }>(
      `SELECT id FROM app.dataset_versions WHERE layer_key = $1 AND is_active FOR NO KEY UPDATE`,
      [layerKey]
    );
    const draft = await client.query<{ parent: string }>(
      `SELECT parent_version_id AS parent FROM app.dataset_versions WHERE id = $1`, [draftId]
    );
    if (draft.rows[0]?.parent !== active.rows[0]?.id) {
      throw new StaleDraftError(
        `layer ${layerKey} changed since this edit session started (its draft ${draftId} was opened on ${draft.rows[0]?.parent}). Reopen the session and redo the edits.`
      );
    }
    await versions.publishDraft(client, layerKey, draftId, async () => {});
  }

  /**
   * A working edit session over one layer, backed by a draft edit-version.
   *
   * The session checks out a single PoolClient and holds one BEGIN open across every
   * call. Both the feature rows and the version lifecycle are written on that client,
   * so the draft version and its rows commit or vanish together: were the rows written
   * on the pool instead, publishDraft could not count them and discard would leave
   * orphans behind.
   *
   * The session owns the client until it settles — via commit(), discard(), or a failed
   * operation, which rolls back. A caller that abandons a session without settling it
   * leaks that client, so callers must settle in a finally block.
   */
  async function editSession(key: string, actorId?: string) {
    const def = getLayer(key);
    const client = await pg.connect();
    await client.query('BEGIN');
    let draftId: string;
    try {
      draftId = await openSessionDraft(client, def.key, actorId);
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }

    // Once the session settles the client goes back to the pool and may already belong
    // to someone else, so every entry point must refuse to touch it again. Without this
    // a `discard()` after a failed `create()` would run ROLLBACK and DELETE on another
    // caller's connection.
    let settled = false;
    // Release is tracked separately from settlement: `settled` also guards ROLLBACK,
    // which must NOT run once COMMIT has been issued, but the client must go back to
    // the pool on every path — including a COMMIT that throws. Collapsing the two into
    // one flag leaked the client whenever COMMIT failed.
    let released = false;
    function release() {
      // pg throws on a double release, so this must fire exactly once.
      if (released) return;
      released = true;
      client.release();
    }

    async function fail(e: unknown): Promise<never> {
      if (!settled) {
        settled = true;
        try { await client.query('ROLLBACK'); } catch { /* transaction already ended */ }
      }
      release();
      throw e;
    }

    function assertOpen() {
      if (settled) throw new ConflictError('This edit session has already ended');
    }

    return {
      draftId: () => draftId,
      isSettled: () => settled,

      // `access` is given on every request path (the single-change helpers below); without it
      // the session performs no permission check, which only internal callers and tests rely on.
      async create(input: FeatureInput, access?: Access): Promise<FeatureRow> {
        assertOpen();
        try {
          const { attrs, geometryJson } = await prepare(pg, def, input, true);
          // Every feature has a managing unit: given, or suggested from the geometry. Neither
          // is possible without a geometry, so the caller has to choose one.
          if (attrs.managing_unit === undefined) {
            if (typeof geometryJson !== 'string') throw fieldError('managing_unit', 'Chọn đơn vị chủ quản');
            attrs.managing_unit = await suggestManagingUnit(client, geometryJson);
          }
          if (access) {
            const unit = attrs.managing_unit as string;
            assertKnownUnit(access.tree, unit);
            authorize(access, 'feature.create', unit);
          }
          const row = await repo.insertIntoVersion(client, def, draftId, {
            attrs, geometryJson: geometryJson ?? null, actorId,
          });
          await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row, source: input.source }, client);
          return row;
        } catch (e) { return fail(e); }
      },

      async update(id: string, input: FeatureInput, access?: Access): Promise<FeatureRow> {
        assertOpen();
        try {
          // Apply the edit on the feature's current state, not on the (possibly outdated)
          // row the request names. Read on the client: the target may be a row created
          // earlier in this session.
          const source = await repo.resolveEditSource(client, def, draftId, id);
          const before = await repo.findByIdOnClient(client, def, source.rowId);
          if (!before) throw new NotFoundError('Feature not found');
          // Checked on the current row's unit, not the named row's: another user may have
          // moved the feature to a unit outside this user's jurisdiction meanwhile.
          const current = unitOf(before);
          if (access) authorize(access, 'feature.update', current);
          const { attrs, geometryJson } = await prepare(pg, def, input, false);
          const next = attrs.managing_unit as string | undefined;
          if (access && next !== undefined && next !== current) {
            assertKnownUnit(access.tree, next);
            authorize(access, 'feature.update', next);
          }
          const after = await repo.upsertChangeInVersion(client, def, draftId, source, { attrs, geometryJson, actorId });
          // feature_id is the id the request named; before.id / after.id are the rows actually
          // read and written; the stable feature key is external_id.
          await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after, source: input.source }, client);
          return after;
        } catch (e) { return fail(e); }
      },

      async remove(id: string, access?: Access): Promise<void> {
        assertOpen();
        try {
          const source = await repo.resolveEditSource(client, def, draftId, id);
          const before = await repo.findByIdOnClient(client, def, source.rowId);
          if (!before) throw new NotFoundError('Feature not found');
          if (access) authorize(access, 'feature.delete', unitOf(before));
          await repo.tombstoneInVersion(client, def, draftId, source);
          // feature_id is the id the request named; before.id / after.id are the rows actually
          // read and written; the stable feature key is external_id.
          await audit.record({ userId: actorId, action: 'delete', tableName: def.table, featureId: id, before }, client);
        } catch (e) { return fail(e); }
      },

      // See draftOps.placementWarnings: a warning, never a refusal.
      async placementWarnings(row: FeatureRow, tree: UnitTree): Promise<FeatureWarning[]> {
        assertOpen();
        try {
          return await placementWarnings(client, def, row, tree);
        } catch (e) { return fail(e); }
      },

      // Publish the draft as the layer's active version.
      async commit(): Promise<void> {
        assertOpen();
        // Settle up front: after this point the session is over either way, and a
        // failing COMMIT must not be followed by a second ROLLBACK attempt from fail().
        settled = true;
        try {
          // Derived values are rebuilt by the write path itself (architecture doc §9):
          // publishDraft() calls versions.activate(), and stamping administrative codes
          // is activate()'s own obligation, so nothing is called explicitly here.
          await publishSessionDraft(client, def.key, draftId);
          await client.query('COMMIT');
        } catch (e) {
          // Safe even if COMMIT itself failed: the transaction is already ended, so
          // this is a no-op that throws, and we swallow it to surface the real error.
          try { await client.query('ROLLBACK'); } catch { /* transaction already ended */ }
          throw e;
        } finally {
          release();
        }
      },

      // Throw the session away. Audit rows are written inside the session transaction, so
      // the whole transaction is rolled back: the draft version, its rows and their audit
      // rows vanish together (a COMMIT here would keep audit rows for changes that never
      // landed). Idempotent and safe after a failed operation already rolled the session
      // back — in that case there is nothing left to discard.
      async discard(): Promise<void> {
        if (settled) return;
        settled = true;
        try {
          await client.query('ROLLBACK');
        } catch (e) {
          // A failed ROLLBACK leaves the connection in an unknown state: hand it back to the
          // pool with the error so the pool destroys it instead of reusing it. Not rethrown:
          // discard() runs on error paths and must not mask the caller's original error.
          released = true;
          client.release(e as Error);
          return;
        }
        release();
      },
    };
  }

  // Run one change in its own session, committing on success and discarding on failure
  // so a rejected single change never leaves a dangling draft or a checked-out client.
  // A stale commit (another edit landed between open and commit) is only seconds old here,
  // and redoing the change on a fresh session equals the two requests arriving a moment
  // apart, so it is retried once; a second refusal propagates. The audit rows are written on
  // the session's transaction, so the refused attempt leaves none behind.
  // Because of that retry, `apply` may run twice: it must act only through the session it
  // is given and have no side effects outside it.
  async function singleChange<T>(key: string, actorId: string | undefined, apply: (s: EditSession) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const session = await editSession(key, actorId);
      let result: T;
      try {
        result = await apply(session);
      } catch (e) {
        // A failed operation already rolled back and released; discard() is a no-op then.
        await session.discard();
        throw e;
      }
      try {
        await session.commit();
        return result;
      } catch (e) {
        if (!(e instanceof StaleDraftError) || attempt >= 2) throw e;
      }
    }
  }

  return {
    async list(key: string, filter: FeatureFilter = {}): Promise<FeatureRow[]> {
      return repo.list(getLayer(key), filter);
    },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },
    editSession,
    singleChange,

    // Single-change helpers: each opens a session, applies one change, and commits — so
    // no caller writes the active version in place. Each publishes its own edit-version.
    // The jurisdiction checks run inside the session, on its client, before any write; on a
    // stale retry they run again against the fresh state.
    async create(key: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree): Promise<FeatureResult> {
      return singleChange(key, actor.id, async (s) => {
        const feature = await s.create(input, { user: actor, tree });
        return { feature, warnings: await s.placementWarnings(feature, tree) };
      });
    },
    async update(key: string, id: string, input: FeatureInput, actor: CurrentUser, tree: UnitTree): Promise<FeatureResult> {
      return singleChange(key, actor.id, async (s) => {
        const feature = await s.update(id, input, { user: actor, tree });
        return { feature, warnings: await s.placementWarnings(feature, tree) };
      });
    },
    async remove(key: string, id: string, actor: CurrentUser, tree: UnitTree): Promise<void> {
      return singleChange(key, actor.id, (s) => s.remove(id, { user: actor, tree }));
    },
  };
}
