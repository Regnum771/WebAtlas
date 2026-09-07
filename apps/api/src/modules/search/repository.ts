import type { Pool } from 'pg';
import type { EditableLayerKey } from '@webatlas/shared';

export interface SearchHit {
  layerKey: EditableLayerKey;
  featureId: string;
  name: string;
  lonLat: [number, number];
}

// Only the layers with names worth matching; hazard-zone layers have none.
const SEARCHABLE: EditableLayerKey[] = ['dams', 'lakes', 'rivers', 'stations'];

/** Trigram search across the named layers, ordered by similarity.
 *  ST_PointOnSurface keeps line/polygon results navigable. */
export async function searchByName(pool: Pool, q: string, limit: number): Promise<SearchHit[]> {
  const unions = SEARCHABLE.map(
    (key) => `
      SELECT '${key}'::text AS layer_key, id::text AS feature_id, name,
             ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
             similarity(name, $1) AS sim
      FROM water.${key}_active
      WHERE geom IS NOT NULL AND name IS NOT NULL AND name % $1`
  ).join(' UNION ALL ');

  const { rows } = await pool.query(
    `${unions} ORDER BY sim DESC, name ASC LIMIT $2`,
    [q, limit]
  );

  return rows.map((r) => ({
    layerKey: r.layer_key as EditableLayerKey,
    featureId: r.feature_id,
    name: r.name,
    lonLat: [Number(r.lon), Number(r.lat)],
  }));
}
