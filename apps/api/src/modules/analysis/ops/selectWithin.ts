import {
  MAX_RESULT_ITEMS,
  capResultItems,
  type AnalysisResult,
  type AnalysisRow,
  type GeoJsonGeometry,
  type ResultGeometry,
} from '@webatlas/shared';
import { simplifiedGeoJsonSql } from '../../../lib/resultGeometry';
import {
  LAYER_LABELS, POINT_SQL, ROW_LIMIT, candidateCtes, layerTable, type Queryable,
} from '../../assistant/tools/data/helpers';
import { areaGeometry } from '../area';
import type { SelectWithinInput } from '../schemas';

const GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

/**
 * Features of each layer intersecting an area. The candidate step (`geom && area`)
 * reaches the GiST index on the base table; the real predicate and NOT deleted are
 * re-applied after version resolution (handover §4.2). `count(*) OVER ()` is
 * computed before LIMIT, so counts are full even when drawing is capped.
 */
export async function selectWithinOp(db: Queryable, input: SelectWithinInput): Promise<AnalysisResult> {
  const area = await areaGeometry(db, input);
  const summary: Record<string, number | string> = { 'Tổng số': 0 };
  const rows: AnalysisRow[] = [];
  const highlights: ResultGeometry[] = [];
  let total = 0;

  for (const key of input.layerKeys) {
    const ctes = candidateCtes(
      key,
      `SELECT external_id FROM ${layerTable(key)} WHERE geom && ${GEOM} AND ST_Intersects(geom, ${GEOM})`
    );
    const { rows: found } = await db.query<{
      featureId: string; name: string | null; lon: number; lat: number; geometry: GeoJsonGeometry; total: string;
    }>(
      `WITH RECURSIVE ${ctes}
       SELECT id::text AS "featureId", name, ${POINT_SQL},
              ${simplifiedGeoJsonSql('geom')} AS geometry,
              count(*) OVER () AS total
         FROM resolved
        WHERE NOT deleted AND geom IS NOT NULL AND ST_Intersects(geom, ${GEOM})
        ORDER BY name NULLS LAST
        LIMIT $2`,
      [area.geojson, MAX_RESULT_ITEMS]
    );
    const n = found.length > 0 ? Number(found[0].total) : 0;
    summary[LAYER_LABELS[key]] = n;
    total += n;
    for (const f of found) {
      highlights.push({
        geometry: f.geometry, role: 'highlight', layerKey: key, featureId: f.featureId,
        ...(f.name ? { label: f.name } : {}),
      });
      if (rows.length < ROW_LIMIT) {
        rows.push({ layerKey: key, featureId: f.featureId, name: f.name, lon: f.lon, lat: f.lat });
      }
    }
  }

  summary['Tổng số'] = total;
  summary['Diện tích vùng (km²)'] = Math.round(area.areaKm2 * 1000) / 1000;
  const capped = capResultItems([
    { geometry: area.display, role: 'input', ...(area.label ? { label: area.label } : {}) },
    ...highlights,
  ]);
  return {
    op: 'select_within',
    summary,
    rows,
    geometries: capped.items,
    truncated: capped.truncated || highlights.length < total,
  };
}
