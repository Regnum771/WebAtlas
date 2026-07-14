import type { Pool } from 'pg';
import type { LayerDef } from '../../layers/registry';
import { geomInsertSql } from './geometry';

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
    async insert(def: LayerDef, input: { attrs: Record<string, unknown>; geometryJson: string | null; actorId?: string }): Promise<FeatureRow> {
      const cols = Object.keys(input.attrs);
      const vals = Object.values(input.attrs);
      const params: unknown[] = [...vals];
      const colList = [...cols];
      const valPlaceholders = cols.map((_, i) => `$${i + 1}`);
      // geometry
      if (input.geometryJson !== null) {
        params.push(input.geometryJson);
        colList.push(def.geomColumn);
        valPlaceholders.push(geomInsertSql(def, params.length));
      }
      // created_by / updated_by
      params.push(input.actorId ?? null);
      colList.push('created_by'); valPlaceholders.push(`$${params.length}`);
      params.push(input.actorId ?? null);
      colList.push('updated_by'); valPlaceholders.push(`$${params.length}`);
      const insertSql = `INSERT INTO ${def.table} (${colList.join(', ')})
                         VALUES (${valPlaceholders.join(', ')})
                         RETURNING id`;
      const { rows } = await pg.query(insertSql, params);
      return (await this.findById(def, rows[0].id))!;
    },
    async update(def: LayerDef, id: string, input: { attrs: Record<string, unknown>; geometryJson?: string | null; actorId?: string }): Promise<FeatureRow | null> {
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
      if (sets.length === 0) return this.findById(def, id);
      params.push(id);
      const { rowCount } = await pg.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if ((rowCount ?? 0) === 0) return null;
      return this.findById(def, id);
    },
    async remove(def: LayerDef, id: string): Promise<boolean> {
      const { rowCount } = await pg.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
export type FeaturesRepository = ReturnType<typeof featuresRepository>;
