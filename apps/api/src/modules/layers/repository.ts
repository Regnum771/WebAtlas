import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { LayerDef } from '../../layers/registry';
import { geomInsertSql } from './geometry';
import { NotFoundError } from '../../errors';

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

function selectSql(def: LayerDef): string {
  const attrs = def.attributeColumns.map((c) => `'${c}', t.${c}`).join(', ');
  // jsonb_build_object over the fixed registry columns; geometry via ST_AsGeoJSON.
  return `SELECT t.id,
                 CASE WHEN t.${def.geomColumn} IS NULL THEN NULL
                      ELSE ST_AsGeoJSON(t.${def.geomColumn})::jsonb END AS geometry,
                 jsonb_build_object(${attrs}) AS properties
          FROM ${def.table} t`;
}

export function featuresRepository(pg: Pool) {
  return {
    async list(def: LayerDef): Promise<FeatureRow[]> {
      const { rows } = await pg.query(`${selectSql(def)} ORDER BY t.created_at DESC`);
      return rows;
    },
    async findById(def: LayerDef, id: string): Promise<FeatureRow | null> {
      const { rows } = await pg.query(`${selectSql(def)} WHERE t.id = $1`, [id]);
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
      const { rows } = await client.query(`${selectSql(def)} WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    },

    // Insert a brand-new feature row into a specific version.
    async insertIntoVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      input: { attrs: Record<string, unknown>; geometryJson: string | null; actorId?: string; externalId?: string | number }
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
      const externalId = input.externalId ?? await mintExternalId(client, def);
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

    // Copy-on-write: bring an inherited feature into the draft version and apply the
    // change there, leaving the parent version's row untouched. Re-editing a feature
    // already copied into the draft updates that copy rather than copying twice.
    async upsertChangeInVersion(
      client: PoolClient,
      def: LayerDef,
      versionId: string,
      sourceId: string,
      input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }
    ): Promise<FeatureRow> {
      const src = await client.query(
        `SELECT external_id, dataset_version_id FROM ${def.table} WHERE id = $1`, [sourceId]
      );
      if (!src.rows[0]) throw new NotFoundError('Feature not found');
      // The source row is already the draft's own (e.g. created earlier in this
      // session): edit it in place instead of copying it onto itself.
      if (src.rows[0].dataset_version_id === versionId) {
        return (await this.updateOnClient(client, def, sourceId, input))!;
      }
      const externalId = src.rows[0].external_id;
      const existing = await client.query(
        `SELECT id FROM ${def.table} WHERE dataset_version_id = $1 AND external_id = $2`,
        [versionId, externalId]
      );
      if (existing.rows[0]) {
        return (await this.updateOnClient(client, def, existing.rows[0].id, input))!;
      }
      // def.attributeColumns already includes `name`, so it is not listed separately.
      const copyCols = def.attributeColumns.join(', ');
      const copy = await client.query(
        `INSERT INTO ${def.table} (external_id, ${copyCols}, ${def.geomColumn}, dataset_version_id, created_by, updated_by)
         SELECT external_id, ${copyCols}, ${def.geomColumn}, $1, $2, $2
         FROM ${def.table} WHERE id = $3
         RETURNING id`,
        [versionId, input.actorId ?? null, sourceId]
      );
      return (await this.updateOnClient(client, def, copy.rows[0].id, input))!;
    },

    // Mark an inherited feature deleted within the draft version (tombstone). The
    // resolver drops a feature whose nearest row is a tombstone, so the parent
    // version keeps its row and still shows the feature when viewed directly.
    async tombstoneInVersion(client: PoolClient, def: LayerDef, versionId: string, sourceId: string): Promise<void> {
      const src = await client.query(
        `SELECT external_id, dataset_version_id FROM ${def.table} WHERE id = $1`, [sourceId]
      );
      if (!src.rows[0]) throw new NotFoundError('Feature not found');
      if (src.rows[0].dataset_version_id === versionId) {
        await client.query(`UPDATE ${def.table} SET deleted = true WHERE id = $1`, [sourceId]);
        return;
      }
      const externalId = src.rows[0].external_id;
      const existing = await client.query(
        `SELECT id FROM ${def.table} WHERE dataset_version_id = $1 AND external_id = $2`,
        [versionId, externalId]
      );
      if (existing.rows[0]) {
        await client.query(`UPDATE ${def.table} SET deleted = true WHERE id = $1`, [existing.rows[0].id]);
        return;
      }
      await client.query(
        `INSERT INTO ${def.table} (external_id, dataset_version_id, deleted, ${def.geomColumn})
         SELECT external_id, $1, true, ${def.geomColumn} FROM ${def.table} WHERE id = $2`,
        [versionId, sourceId]
      );
    },
  };
}
export type FeaturesRepository = ReturnType<typeof featuresRepository>;
