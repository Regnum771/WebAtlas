import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { LayerDef } from '../../layers/registry';
import { geomInsertSql } from './geometry';
import { ConflictError, NotFoundError } from '../../errors';

/**
 * Only level-3 rivers (OSM ways) are edited by hand (user decision 2026-09-29). Level 1 is
 * derived: activate() rebuilds each river's name and geometry from its ways on every
 * commit, so a direct edit would be silently reverted in the same commit. Level 2 is
 * ingested HydroRIVERS topology. To change a river, a steward edits its ways.
 *
 * Also why copy-on-write below may copy only the registry's attribute columns: a level-3
 * way carries no hierarchy source data (its parent link is recomputed on commit), whereas
 * a copied level-1/2 row would lose feature_level and flows_into -- which is exactly what
 * happened before this guard existed.
 */
async function assertHandEditable(client: PoolClient, def: LayerDef, id: string): Promise<void> {
  if (def.key !== 'rivers') return;
  const { rows } = await client.query<{ feature_level: number }>(
    `SELECT feature_level FROM ${def.table} WHERE id = $1`, [id]
  );
  if (rows[0] && rows[0].feature_level !== 3) {
    throw new ConflictError(
      'Chỉ sửa hoặc xoá được đường sông OSM (cấp 3). Sông cấp 1 được dựng lại từ các đường ' +
        'của nó mỗi lần lưu, còn đoạn cấp 2 là dữ liệu HydroRIVERS nhập vào.'
    );
  }
}

// Steward-created features have no upstream id, but the §4 resolver keys on
// external_id with DISTINCT ON — which collapses every NULL-external_id row into a
// single resolved row, silently dropping features. So mint a unique one.
//
// Integer layers (dams, rivers) can't hold a uuid string, so allocate a number above
// the upstream range: a later upstream ingest re-uses the source's own ids, which live
// far below this floor, so it can never collide with a steward-minted id. The scan is
// unscoped by version and runs on the session client, so rows this session already
// created are counted and successive creates keep incrementing.
const EDIT_EXTERNAL_ID_FLOOR = 1_000_000;

async function mintExternalId(client: PoolClient, def: LayerDef): Promise<string | number> {
  if (def.externalIdType === 'text') return `edit:${randomUUID()}`;
  // max+1 is a read-then-write: two concurrent edit sessions would otherwise scan the
  // same max and mint the same id into two DIFFERENT draft versions, which the
  // per-version (dataset_version_id, external_id) unique index cannot catch. Once both
  // drafts commit the §4 resolver's DISTINCT ON (external_id) collapses the pair,
  // silently dropping a feature. A transaction-scoped advisory lock keyed on the table
  // name serialises the scan-and-insert across sessions and is released automatically
  // when the session transaction ends — no unlock path to leak, and no schema change
  // (a per-layer sequence would need a migration per layer and would still drift from
  // the floor after an upstream ingest raises max above it).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [def.table]);
  const { rows } = await client.query(
    `SELECT greatest(coalesce(max(external_id), 0), ${EDIT_EXTERNAL_ID_FLOOR}) + 1 AS next
     FROM ${def.table}`
  );
  return Number(rows[0].next);
}

export interface FeatureRow {
  id: string;
  geometry: unknown | null;            // parsed GeoJSON geometry
  properties: Record<string, unknown>; // attribute columns only
}

/** The row an edit acts on, and whether that row already belongs to the session's draft. */
export interface EditSource {
  rowId: string;
  inDraft: boolean;
}

export interface FeatureFilter {
  province?: string;
  ward?: string;
}

/**
 * Reads come from the active-version view, NOT the base table: the base table holds every
 * version, so listing from it also returned superseded rows (604 rows for 151 dams, measured
 * at the time of writing). Writes still target the base table by draft version -- only the
 * read side changed.
 */
function activeRelation(def: LayerDef): string {
  // Rivers list their level-3 OSM ways (water.rivers_detail, migration 20): the rows the
  // map's rivers layer draws and the only level a steward edits (assertHandEditable).
  // rivers_active would list 23,000 rows -- every river three times, as its entity, its
  // HydroRIVERS reaches and its ways.
  if (def.key === 'rivers') return 'water.rivers_detail';
  return `${def.table}_active`;
}

function selectSql(def: LayerDef, relation: string): string {
  const attrs = def.attributeColumns.map((c) => `'${c}', t.${c}`).join(', ');
  // jsonb_build_object over the fixed registry columns; geometry via ST_AsGeoJSON.
  return `SELECT t.id,
                 CASE WHEN t.${def.geomColumn} IS NULL THEN NULL
                      ELSE ST_AsGeoJSON(t.${def.geomColumn})::jsonb END AS geometry,
                 jsonb_build_object(${attrs}) AS properties
          FROM ${relation} t`;
}

export function featuresRepository(pg: Pool) {
  return {
    async list(def: LayerDef, filter: FeatureFilter = {}): Promise<FeatureRow[]> {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.province) {
        params.push(filter.province);
        where.push(`t.province_codes && ARRAY[$${params.length}]`);
      }
      if (filter.ward) {
        params.push(filter.ward);
        where.push(`t.ward_codes && ARRAY[$${params.length}]`);
      }
      const sql = `${selectSql(def, activeRelation(def))}
                   ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY t.created_at DESC`;
      const { rows } = await pg.query(sql, params);
      return rows;
    },
    async findById(def: LayerDef, id: string): Promise<FeatureRow | null> {
      const { rows } = await pg.query(`${selectSql(def, def.table)} WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    },

    // ---- Version-targeted writes -------------------------------------------------
    // The former in-place insert/update/remove are gone: every feature write now
    // targets a draft edit-version, so nothing mutates the active version directly.
    // Every method below takes the edit session's client as its FIRST parameter and
    // runs all of its queries on it. Writing on the pool instead would put the rows
    // outside the session transaction: commitEditDraft's count would not see them and
    // discard would leave orphans the rollback never removes.

    // findById restricted to the session's transaction — sees its uncommitted rows.
    async findByIdOnClient(client: PoolClient, def: LayerDef, id: string): Promise<FeatureRow | null> {
      const { rows } = await client.query(`${selectSql(def, def.table)} WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    },

    // Insert a brand-new feature row into a specific version.
    async insertIntoVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      input: { attrs: Record<string, unknown>; geometryJson: string | null; actorId?: string }
    ): Promise<FeatureRow> {
      const cols = Object.keys(input.attrs);
      const vals = Object.values(input.attrs);
      const params: unknown[] = [...vals];
      const colList = [...cols];
      const valPlaceholders = cols.map((_, i) => `$${i + 1}`);
      if (input.geometryJson !== null) {
        params.push(input.geometryJson);
        colList.push(def.geomColumn);
        valPlaceholders.push(geomInsertSql(def, params.length));
      }
      // Always minted here: a caller-supplied id could not be validated for
      // per-version uniqueness, and no caller needed one.
      const externalId = await mintExternalId(client, def);
      params.push(externalId);
      colList.push('external_id'); valPlaceholders.push(`$${params.length}`);
      params.push(versionId);
      colList.push('dataset_version_id'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null);
      colList.push('created_by'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null);
      colList.push('updated_by'); valPlaceholders.push(`$${params.length}`);
      const insertSql = `INSERT INTO ${def.table} (${colList.join(', ')})
                         VALUES (${valPlaceholders.join(', ')})
                         RETURNING id`;
      const { rows } = await client.query(insertSql, params);
      return (await this.findByIdOnClient(client, def, rows[0].id))!;
    },

    // Apply an attribute/geometry change to a row that already lives in the draft version.
    async updateOnClient(
      client: PoolClient,
      def: LayerDef,
      id: string,
      input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }
    ): Promise<FeatureRow | null> {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, v] of Object.entries(input.attrs)) { params.push(v); sets.push(`${k} = $${params.length}`); }
      if (input.geometryJson !== undefined) {
        if (input.geometryJson === null) {
          sets.push(`${def.geomColumn} = NULL`);
        } else {
          params.push(input.geometryJson);
          sets.push(`${def.geomColumn} = ${geomInsertSql(def, params.length)}`);
        }
      }
      params.push(input.actorId ?? null); sets.push(`updated_by = $${params.length}`);
      sets.push(`updated_at = now()`);
      params.push(id);
      const { rowCount } = await client.query(
        `UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params
      );
      if ((rowCount ?? 0) === 0) return null;
      return this.findByIdOnClient(client, def, id);
    },

    // Resolve the row id an edit request names to the row the edit must act on, so the
    // edit lands on the feature's CURRENT state rather than on an outdated row that
    // another user's committed change has since superseded:
    //   1. the named row already belongs to this draft -> edit it in place;
    //   2. else the draft already holds a row for the same external_id -> that row;
    //   3. else the feature's current row (external_id match with is_current), which is
    //      then copied into the draft;
    //   4. no current row (the feature was deleted meanwhile) -> NotFoundError.
    async resolveEditSource(
      client: PoolClient,
      def: LayerDef,
      draftId: string,
      id: string
    ): Promise<EditSource> {
      const named = await client.query(
        `SELECT external_id, dataset_version_id, deleted FROM ${def.table} WHERE id = $1`, [id]
      );
      if (!named.rows[0]) throw new NotFoundError('Feature not found');
      // A tombstone in the draft means the feature was deleted earlier in this session.
      if (named.rows[0].dataset_version_id === draftId) {
        if (named.rows[0].deleted) throw new NotFoundError('Feature not found');
        return { rowId: id, inDraft: true };
      }
      const externalId = named.rows[0].external_id;
      const inDraft = await client.query(
        `SELECT id, deleted FROM ${def.table} WHERE dataset_version_id = $1 AND external_id = $2`,
        [draftId, externalId]
      );
      if (inDraft.rows[0]?.deleted) throw new NotFoundError('Feature not found');
      if (inDraft.rows[0]) return { rowId: inDraft.rows[0].id, inDraft: true };
      const current = await client.query(
        `SELECT id FROM ${def.table} WHERE external_id = $1 AND is_current`, [externalId]
      );
      if (!current.rows[0]) throw new NotFoundError('Feature not found');
      return { rowId: current.rows[0].id, inDraft: false };
    },

    // Copy-on-write: bring the feature's current row into the draft version and apply the
    // change there, leaving the parent version's row untouched. `source` comes from
    // resolveEditSource: a row already in the draft is updated in place, so re-editing
    // a feature never copies it twice.
    async upsertChangeInVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      source: EditSource,
      input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }
    ): Promise<FeatureRow> {
      await assertHandEditable(client, def, source.rowId);
      if (source.inDraft) {
        return (await this.updateOnClient(client, def, source.rowId, input))!;
      }
      // def.attributeColumns already includes `name`, so it is not listed separately.
      const copyCols = def.attributeColumns.join(', ');
      const copy = await client.query(
        `INSERT INTO ${def.table} (external_id, ${copyCols}, ${def.geomColumn}, dataset_version_id, created_by, updated_by)
         SELECT external_id, ${copyCols}, ${def.geomColumn}, $1, $2, $2
         FROM ${def.table} WHERE id = $3
         RETURNING id`,
        [versionId, input.actorId ?? null, source.rowId]
      );
      return (await this.updateOnClient(client, def, copy.rows[0].id, input))!;
    },

    // Mark a feature deleted within the draft version (tombstone). The resolver drops a
    // feature whose nearest row is a tombstone, so the parent version keeps its row and
    // still shows the feature when viewed directly. `source` comes from resolveEditSource.
    async tombstoneInVersion(client: PoolClient, def: LayerDef, versionId: string, source: EditSource): Promise<void> {
      await assertHandEditable(client, def, source.rowId);
      if (source.inDraft) {
        await client.query(`UPDATE ${def.table} SET deleted = true WHERE id = $1`, [source.rowId]);
        return;
      }
      await client.query(
        `INSERT INTO ${def.table} (external_id, dataset_version_id, deleted, ${def.geomColumn})
         SELECT external_id, $1, true, ${def.geomColumn} FROM ${def.table} WHERE id = $2`,
        [versionId, source.rowId]
      );
    },
  };
}
export type FeaturesRepository = ReturnType<typeof featuresRepository>;
