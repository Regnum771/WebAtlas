import type { Pool } from 'pg';
import { getLayer, type LayerDef } from '../../layers/registry';
import { featuresRepository, type FeatureRow } from './repository';
import { assertGeometry, assertValidInPg } from './geometry';
import { auditService } from '../audit/service';
import { versionsService } from '../versions/service';
import { validate } from '../../lib/validate';
import { ConflictError, NotFoundError } from '../../errors';

type FeatureInput = { geometry?: unknown; properties?: Record<string, unknown> };

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

    async function fail(e: unknown): Promise<never> {
      if (!settled) {
        settled = true;
        await client.query('ROLLBACK');
        client.release();
      }
      throw e;
    }

    function assertOpen() {
      if (settled) throw new ConflictError('This edit session has already ended');
    }

    return {
      draftId: () => draftId,
      isSettled: () => settled,

      async create(input: FeatureInput): Promise<FeatureRow> {
        assertOpen();
        try {
          const { attrs, geometryJson } = await prepare(pg, def, input, true);
          const row = await repo.insertIntoVersion(client, def, draftId, {
            attrs, geometryJson: geometryJson ?? null, actorId,
          });
          await audit.record({ userId: actorId, action: 'create', tableName: def.table, featureId: row.id, after: row });
          return row;
        } catch (e) { return fail(e); }
      },

      async update(id: string, input: FeatureInput): Promise<FeatureRow> {
        assertOpen();
        try {
          // Read on the client: the target may be a row created earlier in this session.
          const before = await repo.findByIdOnClient(client, def, id);
          if (!before) throw new NotFoundError('Feature not found');
          const { attrs, geometryJson } = await prepare(pg, def, input, false);
          const after = await repo.upsertChangeInVersion(client, def, draftId, id, { attrs, geometryJson, actorId });
          await audit.record({ userId: actorId, action: 'update', tableName: def.table, featureId: id, before, after });
          return after;
        } catch (e) { return fail(e); }
      },

      async remove(id: string): Promise<void> {
        assertOpen();
        try {
          const before = await repo.findByIdOnClient(client, def, id);
          if (!before) throw new NotFoundError('Feature not found');
          await repo.tombstoneInVersion(client, def, draftId, id);
          await audit.record({ userId: actorId, action: 'delete', tableName: def.table, featureId: id, before });
        } catch (e) { return fail(e); }
      },

      // Publish the draft as the layer's active version.
      async commit(): Promise<void> {
        assertOpen();
        try {
          await versions.commitEditDraft(client, def.key, draftId);
          settled = true;
          await client.query('COMMIT');
          client.release();
        } catch (e) { return fail(e); }
      },

      // Throw the draft away. Idempotent and safe after a failed operation already
      // rolled the session back — in that case there is nothing left to discard.
      async discard(): Promise<void> {
        if (settled) return;
        try {
          await versions.discardEditDraft(client, def.key, draftId);
          settled = true;
          await client.query('COMMIT');
          client.release();
        } catch (e) { return fail(e); }
      },
    };
  }

  // Run one change in its own session, committing on success and discarding on failure
  // so a rejected single change never leaves a dangling draft or a checked-out client.
  async function singleChange<T>(key: string, actorId: string | undefined, apply: (s: EditSession) => Promise<T>): Promise<T> {
    const session = await editSession(key, actorId);
    let result: T;
    try {
      result = await apply(session);
    } catch (e) {
      // A failed operation already rolled back and released; discard() is a no-op then.
      await session.discard();
      throw e;
    }
    await session.commit();
    return result;
  }

  return {
    async list(key: string): Promise<FeatureRow[]> { return repo.list(getLayer(key)); },
    async get(key: string, id: string): Promise<FeatureRow | null> { return repo.findById(getLayer(key), id); },
    editSession,

    // Single-change helpers: each opens a session, applies one change, and commits — so
    // no caller writes the active version in place. Each publishes its own edit-version.
    async create(key: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      return singleChange(key, actorId, (s) => s.create(input));
    },
    async update(key: string, id: string, input: FeatureInput, actorId?: string): Promise<FeatureRow> {
      return singleChange(key, actorId, (s) => s.update(id, input));
    },
    async remove(key: string, id: string, actorId?: string): Promise<void> {
      return singleChange(key, actorId, (s) => s.remove(id));
    },
  };
}
