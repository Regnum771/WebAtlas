import type { Pool } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureFilter, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService, type EditSource } from '../audit/service';
import { versionsService, StaleDraftError } from '@webatlas/versioning';
import { validate } from '../../lib/validate';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { COUNTRY_UNIT, type Permission, type UnitTree } from '@webatlas/shared';
import { assertCan } from '../../authz/assert';
import { suggestManagingUnit } from '../admin-units/repository';
import type { CurrentUser } from '../../types/fastify';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown>; source?: EditSource };

/** Who is writing, and the unit tree their grants are resolved against. */
export interface Access { user: CurrentUser; tree: UnitTree }

export interface FeatureWarning { code: 'OUTSIDE_MANAGING_UNIT'; message: string }
export interface FeatureResult { feature: FeatureRow; warnings: FeatureWarning[] }

// Same shape as a zod flatten(), so a client shows it next to the field like any other.
function fieldError(field: string, message: string): ValidationError {
  return new ValidationError('Validation failed', { formErrors: [], fieldErrors: { [field]: [message] } });
}

function assertKnownUnit(tree: UnitTree, unit: string): void {
  if (!tree.has(unit)) throw fieldError('managing_unit', 'Mã đơn vị không hợp lệ');
}

/**
 * Direct publish until P4 (global constraints): every write publishes at once, so it needs the
 * operation's permission AND submission.review on the managing unit.
 */
function authorize(access: Access, permission: Permission, unit: string): void {
  assertCan(access.user, permission, unit, access.tree);
  assertCan(access.user, 'submission.review', unit, access.tree);
}

// A row without a unit predates the column's backfill or activation; treat it as national, the
// strictest reading, so a missing value never widens what a regional officer may touch.
function unitOf(row: FeatureRow): string {
  const unit = row.properties.managing_unit;
  return typeof unit === 'string' ? unit : COUNTRY_UNIT;
}

async function prepare(pg: Pool, def: LayerDef, input: FeatureInput, geometryRequired: boolean) {
  const attrs = validate(def.attributeSchema, input.properties ?? {}) as Record<string, unknown>;
  // Only persist keys the layer actually owns.
  const owned: Record<string, unknown> = {};
  for (const c of def.attributeColumns) if (c in attrs) owned[c] = attrs[c];
  const geometryJson = geometryRequired || input.geometry !== undefined
    ? assertGeometry(def, input.geometry)
    : undefined;
  // assertValidInPg is `SELECT ST_IsValid(...$1)` — a pure function of its parameter
  // that reads no table, so running it on the pool cannot miss session-written rows.
  if (typeof geometryJson === 'string') await assertValidInPg(pg, def, geometryJson);
  return { attrs: owned, geometryJson };
}

export type EditSession = Awaited<ReturnType<ReturnType<typeof featuresService>['editSession']>>;

export function featuresService(pg: Pool) {
  const repo = featuresRepository(pg);
  const audit = auditService(pg);
  const versions = versionsService(pg);

  /**
   * A working edit session over one layer, backed by a draft edit-version.
   *
   * The session checks out a single PoolClient and holds one BEGIN open across every
   * call. Both the feature rows and the version lifecycle are written on that client,
   * so the draft version and its rows commit or vanish together: were the rows written
   * on the pool instead, commitEditDraft could not count them and discard would leave
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
      draftId = await versions.openEditDraft(client, def.key, actorId);
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

      // A warning, never a refusal: the saved geometry lies wholly outside its managing unit.
      // The unit is left as it is (it is never recomputed from geometry once set); VN, which
      // covers everything, never warns.
      async placementWarnings(row: FeatureRow, tree: UnitTree): Promise<FeatureWarning[]> {
        assertOpen();
        try {
          const unit = unitOf(row);
          if (unit === COUNTRY_UNIT || row.geometry === null) return [];
          if (!(await repo.isOutsideUnit(client, def, row.id, unit))) return [];
          const name = tree.get(unit)?.name ?? unit;
          return [{
            code: 'OUTSIDE_MANAGING_UNIT',
            message: `Đối tượng không còn nằm trong ${name}. Kiểm tra lại đơn vị chủ quản.`,
          }];
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
          // commitEditDraft() calls versions.activate(), and stamping administrative codes
          // is activate()'s own obligation, so nothing is called explicitly here.
          await versions.commitEditDraft(client, def.key, draftId);
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
