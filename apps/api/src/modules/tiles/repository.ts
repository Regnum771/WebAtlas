import type { Pool } from 'pg';
import { LAYER_ATTRIBUTE_MAP } from '@webatlas/shared';

export const TILE_LAYERS = ['rivers', 'lakes', 'rivers_overview'] as const;
export type TileLayer = (typeof TILE_LAYERS)[number];

/** Where each tile layer's rows come from: the active-state views (S1), so the partial indexes serve the tile envelope. */
const SOURCE: Record<TileLayer, string> = {
  rivers: 'water.rivers_detail',
  lakes: 'water.lakes_active',
  rivers_overview: 'water.rivers_overview',
};

/** The properties each tile feature carries: what the web app's styles, popups and ROI candidates read. */
function propertiesSql(layer: TileLayer): string {
  if (layer === 'rivers_overview') return 't.name_key, t.name, t.stream_order';
  const iso = Object.entries(LAYER_ATTRIBUTE_MAP[layer].attributes).map(([db, name]) => `t.${db} AS "${name}"`);
  return [`t.id::text AS id`, `'${layer}'::text AS "layerKey"`, ...iso].join(', ');
}

/**
 * One tile: $1 z, $2 x, $3 y. ST_AsMVTGeom clips to the tile (64-unit buffer, so line joins and
 * polygon edges do not show seams) and simplifies to its 4096-unit grid. The bounding-box test is
 * on the stored 4326 geometry, so the views' partial GiST index (migration 22) serves it.
 */
export function tileSql(layer: TileLayer): string {
  return `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS b),
    features AS (
      SELECT ST_AsMVTGeom(ST_Transform(t.geom, 3857), bounds.b, 4096, 64, true) AS geom, ${propertiesSql(layer)}
        FROM ${SOURCE[layer]} t, bounds
       WHERE t.geom && ST_Transform(bounds.b, 4326)
    )
    SELECT ST_AsMVT(features.*, '${layer}', 4096, 'geom') AS tile FROM features WHERE geom IS NOT NULL`;
}

export async function activeVersions(db: Pool): Promise<{ rivers: string | null; lakes: string | null }> {
  const { rows } = await db.query<{ layer_key: 'rivers' | 'lakes'; id: string }>(
    `SELECT layer_key, id::text AS id FROM app.dataset_versions WHERE is_active AND layer_key IN ('rivers', 'lakes')`
  );
  const out = { rivers: null as string | null, lakes: null as string | null };
  for (const r of rows) out[r.layer_key] = r.id;
  return out;
}
